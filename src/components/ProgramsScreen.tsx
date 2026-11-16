import { quantity } from "../lib/quantity";
import { lazy, Suspense, useState, useEffect, useMemo, useRef } from "react";
import {
  CalendarDays,
  Check,
  Copy,
  Dumbbell,
  Pencil,
  Play,
  Plus,
  Save,
  Trash2,
} from "lucide-react";
import {
  TrainingProgram,
  DAY_NAMES,
  weightSourceSummary,
} from "../domain/TrainingProgram";
import {
  addCalendarDays,
  weekStart,
  localDate,
  exerciseForEntry,
  exerciseById,
  entryName,
  makeExerciseEntry,
  makeSets,
  fmt,
} from "../lib/model";
import ExerciseInfo from "./ExerciseInfo";
import type { Exercise, Routine, Workout } from "../lib/types";
import { ApiError } from "../services/ApiClient";
import Modal from "./Modal";
import Select from "./Select";
import { ExerciseLibrary } from "./chunks";
import { DeloadPlan, type DeloadPlanRecord } from "../domain/DeloadPlan";
import { dateLabel } from "../lib/calendar";
import { LaidDupPlan } from "../domain/LaidDupPlan";
import LaidDupModal from "./LaidDupModal";
import { LaidDupCard, LaidDupSchedule, LaidRoutineLine } from "./LaidDupPanel";

type Props = {
  routines: Routine[];
  workouts: Workout[];
  timeZone: string;
  personal: Exercise[];
  favorites: string[];
  onFavorite: (id: string) => void;
  onSave: (r: Routine) => Promise<Routine>;
  onDelete: (r: Routine) => Promise<void>;
  onStart: (r: Routine) => void;
  /** Действующая разгрузка на неделю (R04-REQ02) и её отмена. */
  deload?: DeloadPlanRecord | null;
  onCancelDeload?: () => void;
  initial?: Routine | null;
  onInitialUsed?: () => void;
};
export default function ProgramsScreen(props: Props) {
  const [editor, setEditor] = useState<Routine | null>(props.initial ?? null);
  const [offset, setOffset] = useState(0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [deleting, setDeleting] = useState<Routine | null>(null);
  const [picker, setPicker] = useState(false);
  /** R10: окно Лейда (создать / обновить максимумы / новый цикл) и расписание на 9 недель; цикл — по общему cycleId. */
  const [laid, setLaid] = useState<{ mode: "create" | "update" | "restart"; cycleId?: string } | null>(null);
  const [schedule, setSchedule] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [removed, setRemoved] = useState<{
    entry: Routine["exercises"][number];
    index: number;
  } | null>(null);
  const [info, setInfo] = useState<Exercise | null>(null);
  // R03-REQ03: закрытие редактора с несохранёнными правками спрашивает, а не стирает работу.
  const baseline = useRef<string | null>(null);
  const editing = !!editor;
  useEffect(() => {
    baseline.current = editing ? JSON.stringify(editorRef.current) : null;
    if (!editing) setAskClose(false);
  }, [editing]);
  const [askClose, setAskClose] = useState(false);
  const editorRef = useRef<Routine | null>(editor);
  editorRef.current = editor;
  const dirty = !!editor && baseline.current !== null && JSON.stringify(editor) !== baseline.current;
  const weightHints = useMemo(
    () => (editor ? new TrainingProgram(editor).weightHints(props.workouts, props.timeZone) : []),
    [editor, props.workouts, props.timeZone],
  );
  const closeEditor = () => {
    setEditor(null);
    setAskClose(false);
    props.onInitialUsed?.();
  };
  const initial = props.initial;
  useEffect(() => {
    if (initial) props.onInitialUsed?.();
  }, [initial]);
  const [conflict, setConflict] = useState<{ current: Routine | null } | null>(
    null,
  );
  const anchor = addCalendarDays(
      weekStart(new Date(), props.timeZone),
      offset * 7,
    ),
    today = localDate(new Date(), props.timeZone),
    hasCycle = props.routines.some((r) => !!r.cycle);
  const laidCycles = useMemo(() => LaidDupPlan.cycles(props.routines), [props.routines]);
  const cycleById = (id?: string) => laidCycles.find((c) => c[0].periodization!.cycleId === id) ?? laidCycles[0];
  /** isDeload walks the whole history per routine, so it stays off the keystroke path. */
  const deloadRoutineIds = useMemo(
    () =>
      new Set(
        props.routines
          .filter((r) => new TrainingProgram(r).isDeload(props.workouts, today))
          .map((r) => r.id),
      ),
    [props.routines, props.workouts, today],
  );
  const open = (routine: Routine) => {
    setEditor(structuredClone(routine));
    setError("");
    setConflict(null);
    props.onInitialUsed?.();
  };
  async function save(asCopy = false) {
    if (!editor) return;
    setBusy(true);
    setError("");
    try {
      TrainingProgram.validateRanges(editor);
      await props.onSave(
        asCopy
          ? {
              ...editor,
              periodization: undefined,
              id: crypto.randomUUID(),
              revision: 0,
              name: (editor.name + " (копия)").slice(0, 120),
            }
          : editor,
      );
      setEditor(null);
      setConflict(null);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409)
        setConflict({ current: e.data.currentRoutine ?? null });
      setError(e instanceof Error ? e.message : "Ошибка сохранения");
    } finally {
      setBusy(false);
    }
  }
  /** «Можно обновить максимум»: новые максимумы по свежим подходам, пересчёт плана с текущей недели. */
  async function recalc(cycle: Routine[]) {
    const first = cycle[0].periodization!;
    const suggestion = LaidDupPlan.suggestion(first, props.workouts, today);
    if (!suggestion.length) return;
    const maxes = { ...first.maxes };
    for (const s of suggestion) maxes[s.lift] = s.to;
    const position = LaidDupPlan.position(LaidDupPlan.weekOf(first.startMonday, today));
    const from = position.beforeStart ? 0 : position.week;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      for (const r of cycle) await props.onSave({ ...r, periodization: LaidDupPlan.withMaxes(r.periodization!, maxes, from) });
      setNotice(`Максимумы обновлены: новые веса — с недели ${from + 1}, прошлые недели не меняются.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось пересчитать план");
    } finally {
      setBusy(false);
    }
  }
  async function starter(
    kind: Parameters<typeof TrainingProgram.starter>[0] | "v2",
  ) {
    setBusy(true);
    setError("");
    try {
      const routines =
        kind === "v2"
          ? TrainingProgram.programV2()
          : TrainingProgram.starter(kind);
      // Same names are skipped, so a repeated click adds what is missing only.
      for (const r of routines)
        if (!props.routines.some((old) => old.name === r.name))
          await props.onSave(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось добавить пример");
    } finally {
      setBusy(false);
    }
  }
  const updateExercise = (
    i: number,
    patch: Partial<Routine["exercises"][number]>,
  ) =>
    setEditor((r) =>
      r
        ? {
            ...r,
            exercises: r.exercises.map((e, j) =>
              i === j ? { ...e, ...patch } : e,
            ),
          }
        : r,
    );
  /**
   * A movement range is stored as a pair: the API accepts two bounds or none.
   * The first edit fills a missing opposite bound from the routine. Clearing
   * keeps the other field intact; clearing both restores the routine range.
   */
  const setRepRange = (
    index: number,
    entry: Routine["exercises"][number],
    side: "min" | "max",
    raw: string,
  ) => {
    if (!editor) return;
    updateExercise(index, TrainingProgram.editRange(editor, entry, side, raw));
  };
  useEffect(() => {
    if (!editor) setRemoved(null);
  }, [editor]);
  useEffect(() => {
    if (!removed) return;
    const timer = window.setTimeout(() => setRemoved(null), 8000);
    return () => window.clearTimeout(timer);
  }, [removed]);
  const removeExercise = (index: number) => {
    if (!editor) return;
    setRemoved({ entry: editor.exercises[index], index });
    setEditor({
      ...editor,
      exercises: editor.exercises.filter((_, i) => i !== index),
    });
  };
  const restoreExercise = () => {
    if (!removed) return;
    setEditor((r) => {
      if (!r) return r;
      const exercises = [...r.exercises];
      exercises.splice(
        Math.min(removed.index, exercises.length),
        0,
        removed.entry,
      );
      return { ...r, exercises };
    });
    setRemoved(null);
  };
  const move = (i: number, direction: number) =>
    setEditor((r) => {
      if (!r || i + direction < 0 || i + direction >= r.exercises.length)
        return r;
      const exercises = [...r.exercises];
      [exercises[i], exercises[i + direction]] = [
        exercises[i + direction],
        exercises[i],
      ];
      return { ...r, exercises };
    });
  return (
    <div className="programs-screen">
      {props.deload ? (
        <div className="deload-active-banner" role="status">
          <span>
            <b>Разгрузка активна до {dateLabel(props.deload.until).replace(/\.$/, "")}.</b>{" "}
            {DeloadPlan.parameters(props.deload.mode, props.deload.sets)}: программы запускаются уменьшенными, сами они не изменены.
          </span>
          {props.onCancelDeload ? (
            <button type="button" className="button secondary" onClick={props.onCancelDeload}>
              Отменить
            </button>
          ) : null}
        </div>
      ) : null}
      <section className="week-planner panel">
        <div className="panel-header">
          <div>
            <span className="eyebrow">НЕДЕЛЬНЫЙ РИТМ</span>
            <h2>План на неделю</h2>
          </div>
          <div className="week-controls">
            <button
              aria-label="Предыдущая неделя плана"
              onClick={() => setOffset((n) => n - 1)}
            >
              Раньше
            </button>
            <button onClick={() => setOffset(0)}>Сегодня</button>
            <button
              aria-label="Следующая неделя плана"
              onClick={() => setOffset((n) => n + 1)}
            >
              Позже
            </button>
          </div>
        </div>
        <div className="program-week">
          {DAY_NAMES.map((day, index) => {
            const date = addCalendarDays(anchor, index),
              programs = props.routines.filter((r) => r.days.includes(index));
            const recorded = props.workouts.filter((w) => w.date === date);
            return (
              <div
                className={`program-day ${today === date ? "today" : ""}`}
                key={day}
              >
                <div className="program-day-label">
                  <span>{day}</span>
                  <b>{Number(date.slice(-2))}</b>
                </div>
                {programs.map((r) => {
                  const done = recorded.some((w) => w.routineId === r.id);
                  return (
                    <button
                      className={`day-session ${done ? "completed" : ""}`}
                      key={r.id}
                      onClick={() =>
                        date === today ? props.onStart(r) : open(r)
                      }
                    >
                      <span>
                        {done ? <Check size={14} /> : <Dumbbell size={14} />}
                      </span>
                      {r.name}
                      <small>
                        {done
                          ? "Записано"
                          : quantity(
                              r.exercises.length,
                              "упражнение",
                              "упражнения",
                              "упражнений",
                            )}
                      </small>
                    </button>
                  );
                })}
                {!programs.length ? (
                  <span className="rest-day">Свободный день</span>
                ) : null}
                {recorded
                  .filter((w) => !programs.some((r) => r.id === w.routineId))
                  .map((w) => (
                    <div className="day-recorded" key={w.id}>
                      <Check size={12} />
                      {w.name}
                    </div>
                  ))}
              </div>
            );
          })}
        </div>
        <p className="tiny planner-caption">
          Дни повторяются каждую неделю. Программу можно начать в любой день;
          выполненные сессии отмечаются по фактической дате.
        </p>
      </section>
      <div className="section-heading">
        <div>
          <span className="eyebrow">ТВОИ ШАБЛОНЫ</span>
          <h2>Сохранённые программы</h2>
        </div>
        <button
          className="button primary"
          onClick={() => open({ ...TrainingProgram.empty(), name: "" })}
        >
          <Plus size={18} />
          Создать программу
        </button>
      </div>
      {error && !editor && !deleting ? (
        <p className="error-banner" role="alert">
          {error}
        </p>
      ) : null}
      {notice && !editor ? (
        <p className="progression-note laid-notice" role="status">
          {notice}
        </p>
      ) : null}
      {laidCycles.map((cycle) => (
        <LaidDupCard
          key={cycle[0].periodization!.cycleId}
          cycle={cycle}
          workouts={props.workouts}
          today={today}
          busy={busy}
          onSchedule={() => setSchedule(cycle[0].periodization!.cycleId)}
          onUpdate={() =>
            setLaid({
              mode: LaidDupPlan.position(LaidDupPlan.weekOf(cycle[0].periodization!.startMonday, today)).finished ? "restart" : "update",
              cycleId: cycle[0].periodization!.cycleId,
            })
          }
          onRecalc={() => void recalc(cycle)}
        />
      ))}
      <div className="routine-grid">
        {props.routines.map((r) => (
          <article className="routine-card panel" key={r.id}>
            <div className="routine-card-top">
              <span className="feature-tag">
                {r.days.length
                  ? r.days.map((d) => DAY_NAMES[d]).join(" · ")
                  : "В ЛЮБОЙ ДЕНЬ"}
              </span>
              <button
                className="icon-button"
                aria-label={`Редактировать программу ${r.name}`}
                onClick={() => open(r)}
              >
                <Pencil size={17} />
              </button>
            </div>
            <h3>{r.name}</h3>
            {LaidDupPlan.periodizationOf(r) ? <LaidRoutineLine routine={r} workouts={props.workouts} today={today} /> : null}
            {deloadRoutineIds.has(r.id) ? (
              <p
                className="progression-note"
                style={{
                  margin: "12px 0 0",
                  padding: "10px 12px",
                  fontSize: "0.8rem",
                  color: "var(--text-soft)",
                }}
              >
                Разгрузочная неделя · половина подходов, 70% веса
              </p>
            ) : null}
            <p>
              {quantity(
                r.exercises.length,
                "упражнение",
                "упражнения",
                "упражнений",
              )}{" "}
              ·{" "}
              {quantity(
                new TrainingProgram(r).workingSets,
                "рабочий подход",
                "рабочих подхода",
                "рабочих подходов",
              )}
            </p>
            <div className="routine-exercise-names">
              {r.exercises.slice(0, 4).map((e) => {
                const planned =
                  e.repMin === undefined && e.repMax === undefined
                    ? null
                    : new TrainingProgram(r).range(e);
                return (
                  <span key={e.exerciseId}>
                    {entryName(e)}
                    {planned
                      ? ` · ${e.sets.filter((s) => !s.warmup).length} × ${planned.min === planned.max ? planned.min : `${planned.min}–${planned.max}`}`
                      : ""}
                  </span>
                );
              })}
              {r.exercises.length > 4 ? (
                <span>Ещё {r.exercises.length - 4}</span>
              ) : null}
            </div>
            <small>
              {r.progression === "double"
                ? `Прогрессия: ${r.repMin}–${r.repMax} повт., шаг ${r.incrementKg} кг`
                : "Повторять структуру, брать веса из истории"}
              {" · "}
              {weightSourceSummary(
                new TrainingProgram(r).weightSources(
                  props.workouts,
                  props.timeZone,
                  today,
                ),
              )}
            </small>
            <div className="routine-card-actions">
              <button
                className="button primary"
                onClick={() => props.onStart(r)}
              >
                <Play size={16} />
                Начать
              </button>
              <button
                className="icon-button"
                aria-label={`Копировать программу ${r.name}`}
                onClick={() =>
                  open({
                    ...r,
                    // Копия — обычная программа: в цикле Лейда у каждого дня одна запись.
                    periodization: undefined,
                    id: crypto.randomUUID(),
                    revision: 0,
                    name: (r.name + " (копия)").slice(0, 120),
                  })
                }
              >
                <Copy size={16} />
              </button>
              <button
                className="icon-button"
                aria-label={`Удалить программу ${r.name}`}
                onClick={() => {
                  setDeleting(r);
                  setError("");
                }}
              >
                <Trash2 size={16} />
              </button>
            </div>
          </article>
        ))}
      </div>
      {!props.routines.length ? (
        <div className="program-empty panel">
          <CalendarDays size={30} />
          <h3>Собери свой ритм</h3>
          <p>
            Создай программу или начни с примера. Упражнения, подходы, дни и
            веса можно изменить.
          </p>
        </div>
      ) : null}
      <section className="starter-plans">
        <div className="section-heading">
          <div>
            <h2>Отправная точка</h2>
            <p>Редактируемые примеры для знакомства с планировщиком.</p>
          </div>
        </div>
        <div className="starter-grid">
          {(
            [
              {
                id: "full",
                name: "Всё тело",
                note: "Одна программа · 3 дня",
                symbol: "01",
              },
              {
                id: "split",
                name: "Верх / низ",
                note: "Две программы · 4 дня",
                symbol: "02",
              },
              {
                id: "ppl",
                name: "Жимы / тяги / ноги",
                note: "Три программы · 3 дня",
                symbol: "03",
              },
              {
                id: "strength",
                name: "База 5 × 5",
                note: "Три движения · 3 дня",
                symbol: "04",
              },
              {
                id: "laid",
                name: "Дэвид Лейд · DUP · 9 недель · 6 дней",
                note: laidCycles.length
                  ? "Шесть программ · уже есть: обновить максимумы или создать ещё раз"
                  : "Шесть программ · веса от твоих максимумов, схема меняется по неделям",
                symbol: "06",
              },
              {
                id: "v2",
                name: "Программа v2 · 5 дней",
                note: hasCycle
                  ? "Пять программ · уже добавлена, кнопка добавит недостающие"
                  : "Пять программ · 5 дней, разгрузка каждую пятую неделю",
                symbol: "05",
              },
            ] as const
          ).map((p) => (
            <button
              className="starter-card panel"
              key={p.id}
              disabled={busy}
              onClick={() => (p.id === "laid" ? (setNotice(""), setLaid({ mode: "create" })) : void starter(p.id))}
            >
              <span>{p.symbol}</span>
              <b>{p.name}</b>
              <small>{p.note}</small>
              <Plus size={18} />
            </button>
          ))}
        </div>
        <p className="tiny">
          Примеры не учитывают твой опыт, ограничения и восстановление. Выбери
          подходящие движения и начальные веса.
        </p>
      </section>
      {laid ? (
        <LaidDupModal
          key={laid.mode}
          mode={laid.mode}
          routines={props.routines}
          cycle={laid.mode === "create" ? undefined : cycleById(laid.cycleId)}
          existing={laid.mode === "create" && laidCycles.length > 0}
          workouts={props.workouts}
          today={today}
          onSave={props.onSave}
          onClose={() => setLaid(null)}
          onDone={setNotice}
          onSwitch={(mode) => setLaid({ mode, cycleId: laidCycles[0]?.[0].periodization!.cycleId })}
        />
      ) : null}
      {schedule && cycleById(schedule) ? (
        <LaidDupSchedule
          cycle={cycleById(schedule)}
          workouts={props.workouts}
          today={today}
          busy={busy}
          onClose={() => setSchedule(null)}
          onUpdate={() => {
            const cycle = cycleById(schedule);
            setSchedule(null);
            setLaid({
              mode: LaidDupPlan.position(LaidDupPlan.weekOf(cycle[0].periodization!.startMonday, today)).finished ? "restart" : "update",
              cycleId: cycle[0].periodization!.cycleId,
            });
          }}
          onRecalc={() => void recalc(cycleById(schedule))}
        />
      ) : null}
      {editor ? (
        <Modal
          title={
            editor.revision ? "Редактировать программу" : "Новая программа"
          }
          wide
          onClose={() => {
            if (busy) return false;
            if (dirty) {
              setAskClose(true);
              return false;
            }
            closeEditor();
          }}
        >
          <form
            className="product-form"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <fieldset disabled={busy}>
              <label>
                Название программы
                <input
                  required
                  maxLength={120}
                  placeholder="Например, Мой push"
                  data-autofocus={editor.revision === 0 && editor.name === "" ? "" : undefined}
                  value={editor.name}
                  onChange={(e) =>
                    setEditor({ ...editor, name: e.target.value })
                  }
                />
              </label>
              <div>
                <p className="field-caption">Дни недели</p>
                <div className="day-picker">
                  {DAY_NAMES.map((d, i) => (
                    <button
                      type="button"
                      key={d}
                      aria-pressed={editor.days.includes(i)}
                      className={editor.days.includes(i) ? "active" : ""}
                      onClick={() =>
                        setEditor({
                          ...editor,
                          days: editor.days.includes(i)
                            ? editor.days.filter((x) => x !== i)
                            : [...editor.days, i].sort(),
                        })
                      }
                    >
                      {d}
                    </button>
                  ))}
                </div>
              </div>
              <div className="form-grid">
                <label>
                  Отдых, секунды
                  <input
                    type="number"
                    min={15}
                    max={600}
                    required
                    value={editor.restSeconds}
                    onChange={(e) =>
                      setEditor({
                        ...editor,
                        restSeconds: Number(e.target.value),
                      })
                    }
                  />
                </label>
                <label>
                  Правило прогрессии
                  <Select
                    value={editor.progression}
                    onChange={(v) =>
                      setEditor({
                        ...editor,
                        progression: v as Routine["progression"],
                      })
                    }
                    options={[
                      { value: "repeat", label: "Повторять веса и повторы" },
                      { value: "double", label: "Двойная прогрессия" },
                    ]}
                  />
                </label>
              </div>
              {editor.progression === "double" ? (
                <>
                  <div className="form-grid three">
                    <label>
                      Повторы от
                      <input
                        type="number"
                        min={1}
                        max={200}
                        required
                        value={editor.repMin}
                        onChange={(e) =>
                          setEditor({
                            ...editor,
                            repMin: Number(e.target.value),
                          })
                        }
                      />
                    </label>
                    <label>
                      Повторы до
                      <input
                        type="number"
                        min={editor.repMin}
                        max={200}
                        required
                        value={editor.repMax}
                        onChange={(e) =>
                          setEditor({
                            ...editor,
                            repMax: Number(e.target.value),
                          })
                        }
                      />
                    </label>
                    <label>
                      Шаг веса, кг
                      <input
                        type="number"
                        min={0.25}
                        max={50}
                        step={0.25}
                        required
                        value={editor.incrementKg}
                        onChange={(e) =>
                          setEditor({
                            ...editor,
                            incrementKg: Number(e.target.value),
                          })
                        }
                      />
                    </label>
                  </div>
                  <p className="tiny">
                    Прибавка предлагается для проверенных свободных весов, когда
                    все запланированные рабочие подходы выполнены на верхней
                    границе. Для остальных вариантов сохраняется прежний вес.
                  </p>
                </>
              ) : null}
              <div className="routine-editor-exercises">
                <p className="tiny">
                  У каждого упражнения может быть свой диапазон повторений.
                  Пустые поля «Повторы от» и «Повторы до» означают общий
                  диапазон программы.
                </p>
                {editor.exercises.map((entry, index) => {
                  const exercise = exerciseForEntry(entry)!,
                    spec = exercise.recording;
                  return (
                    <article
                      className="routine-editor-exercise"
                      key={entry.exerciseId}
                    >
                      <div className="routine-editor-head">
                        <div>
                          <span className="eyebrow">
                            {String(index + 1).padStart(2, "0")}
                          </span>
                          <h3>{entryName(entry)}</h3>
                        </div>
                        <div className="routine-order-controls">
                          <button
                            type="button"
                            disabled={index === 0}
                            onClick={() => move(index, -1)}
                          >
                            Выше
                          </button>
                          <button
                            type="button"
                            disabled={index === editor.exercises.length - 1}
                            onClick={() => move(index, 1)}
                          >
                            Ниже
                          </button>
                          <button
                            type="button"
                            className="icon-button"
                            aria-label={`Убрать из программы ${entryName(entry)}`}
                            onClick={() => removeExercise(index)}
                          >
                            <Trash2 size={17} />
                          </button>
                        </div>
                      </div>
                      <div className="routine-fields">
                        <label>
                          Подходы
                          <input
                            type="number"
                            min={1}
                            max={30}
                            value={entry.sets.length}
                            onChange={(e) => {
                              const count = Math.max(
                                1,
                                Math.min(30, Number(e.target.value) || 1),
                              );
                              updateExercise(index, {
                                sets: Array.from(
                                  { length: count },
                                  (_, i) =>
                                    entry.sets[i] ?? {
                                      ...makeSets(
                                        1,
                                        entry.sets[0]?.weight,
                                        entry.sets[0]?.reps,
                                      )[0],
                                      ...(spec.type === "duration"
                                        ? {
                                            rir: null,
                                            durationSeconds:
                                              entry.sets[0]?.durationSeconds ??
                                              30,
                                          }
                                        : {}),
                                    },
                                ),
                              });
                            }}
                          />
                        </label>
                        <label>
                          {spec.type === "duration" ? "Секунды" : "Повторы"}
                          <input
                            type="number"
                            min={1}
                            max={spec.type === "duration" ? 86400 : 200}
                            value={
                              spec.type === "duration"
                                ? (entry.sets[0].durationSeconds ?? 30)
                                : entry.sets[0].reps
                            }
                            onChange={(e) =>
                              updateExercise(index, {
                                sets: entry.sets.map((s) => ({
                                  ...s,
                                  ...(spec.type === "duration"
                                    ? {
                                        durationSeconds: Number(e.target.value),
                                      }
                                    : { reps: Number(e.target.value) }),
                                })),
                              })
                            }
                          />
                        </label>
                        <label>
                          {spec.loadMode === "assisted_bodyweight"
                            ? "Помощь, кг"
                            : "Вес, кг"}
                          <input
                            aria-label={
                              spec.loadMode === "assisted_bodyweight"
                                ? "Помощь, кг"
                                : "Начальный вес, кг"
                            }
                            type="number"
                            min={0}
                            max={1000}
                            step={0.5}
                            disabled={spec.loadMode === "bodyweight"}
                            value={
                              spec.loadMode === "assisted_bodyweight"
                                ? (entry.sets[0].assistanceKg ?? 0)
                                : entry.sets[0].weight
                            }
                            onChange={(e) =>
                              updateExercise(index, {
                                sets: entry.sets.map((s) => ({
                                  ...s,
                                  ...(spec.loadMode === "assisted_bodyweight"
                                    ? {
                                        assistanceKg: Number(e.target.value),
                                        weight: 0,
                                      }
                                    : { weight: Number(e.target.value) }),
                                })),
                              })
                            }
                          />
                        </label>
                      </div>
                      <details className="routine-more">
                        <summary>
                          <span>Ещё</span>
                            {spec.loadMode !== "bodyweight" && weightHints[index] ? (
                              <span className={`weight-source ${weightHints[index].source}`} data-source={weightHints[index].source}>
                                {weightHints[index].source === "history"
                                  ? `Начнёшь с веса из истории: ${fmt(weightHints[index].weightKg!)} кг`
                                  : weightHints[index].source === "plan"
                                    ? `Вес по плану: ${fmt(weightHints[index].weightKg!)} кг`
                                    : "Вес не задан — введи его или впиши в тренировке"}
                              </span>
                            ) : null}
                        </summary>
                        <div className="form-grid">
                          <label>
                            Повторы от
                            <input
                              type="number"
                              min={1}
                              max={200}
                              inputMode="numeric"
                              placeholder={String(editor.repMin)}
                              value={entry.repMin ?? ""}
                              onChange={(e) =>
                                setRepRange(index, entry, "min", e.target.value)
                              }
                            />
                          </label>
                          <label>
                            Повторы до
                            <input
                              type="number"
                              min={1}
                              max={200}
                              inputMode="numeric"
                              placeholder={String(editor.repMax)}
                              value={entry.repMax ?? ""}
                              onChange={(e) =>
                                setRepRange(index, entry, "max", e.target.value)
                              }
                            />
                          </label>
                        </div>
                        {["machine_stack", "assisted_bodyweight"].includes(
                          spec.loadMode,
                        ) ? (
                          <label>
                            Тренажёр / блок
                            <input
                              maxLength={120}
                              value={entry.equipmentNote ?? ""}
                              onChange={(e) =>
                                updateExercise(index, {
                                  equipmentNote: e.target.value,
                                })
                              }
                              placeholder="Название или расположение машины"
                            />
                          </label>
                        ) : null}
                      </details>
                    </article>
                  );
                })}
              </div>
              {removed ? (
                <div className="undo-bar" role="status">
                  <span>Упражнение убрано</span>
                  <button type="button" onClick={restoreExercise}>
                    Отменить
                  </button>
                </div>
              ) : null}
              <button
                type="button"
                className="button secondary full-width"
                disabled={editor.exercises.length >= 30}
                onClick={() => setPicker(true)}
              >
                <Plus size={18} />
                Добавить упражнение в программу
              </button>
              <label>
                Заметки к программе
                <textarea
                  rows={2}
                  maxLength={2000}
                  value={editor.notes}
                  onChange={(e) =>
                    setEditor({ ...editor, notes: e.target.value })
                  }
                />
              </label>
              {error ? (
                <p className="error-banner" role="alert">
                  {error}
                </p>
              ) : null}
              {conflict ? (
                <div className="conflict-actions">
                  {conflict.current ? (
                    <button
                      className="button secondary"
                      type="button"
                      onClick={() => open(conflict.current!)}
                    >
                      Загрузить актуальную версию
                    </button>
                  ) : null}
                  <button
                    className="button secondary"
                    type="button"
                    onClick={() => void save(true)}
                  >
                    Сохранить отдельную копию
                  </button>
                </div>
              ) : null}
              <button
                className="button primary full-width"
                type="submit"
                disabled={!editor.exercises.length}
              >
                <Save size={17} />
                {busy ? "Сохраняем…" : "Сохранить программу"}
              </button>
            </fieldset>
          </form>
        </Modal>
      ) : null}
      {picker && editor ? (
        <Modal
          title="Упражнения для программы"
          wide
          onClose={() => setPicker(false)}
        >
          <Suspense fallback={<p>Открываем библиотеку…</p>}>
            <ExerciseLibrary
              picker
              personal={props.personal}
              favorites={props.favorites}
              onFavorite={props.onFavorite}
              onDetail={(id) => setInfo(exerciseById(id) ?? null)}
              selectedIds={editor.exercises.map((e) => e.exerciseId)}
              limitReached={editor.exercises.length >= 30}
              onAdd={(id) =>
                setEditor((r) =>
                  r &&
                  !r.exercises.some((e) => e.exerciseId === id) &&
                  r.exercises.length < 30
                    ? {
                        ...r,
                        exercises: [...r.exercises, makeExerciseEntry(id)],
                      }
                    : r,
                )
              }
            />
          </Suspense>
          <button
            className="button primary full-width"
            onClick={() => setPicker(false)}
          >
            Готово
          </button>
        </Modal>
      ) : null}
      {info && editor ? (
        <Modal title={info.name} onClose={() => setInfo(null)}>
          <ExerciseInfo
            exercise={info}
            disabled={
              editor.exercises.some((e) => e.exerciseId === info.id) ||
              editor.exercises.length >= 30
            }
            onAdd={() => {
              setEditor({
                ...editor,
                exercises: [...editor.exercises, makeExerciseEntry(info.id)],
              });
              setInfo(null);
            }}
          />
        </Modal>
      ) : null}
      {editor && askClose ? (
        <Modal title="Сохранить программу?" onClose={() => setAskClose(false)}>
          <p>В программе «{editor.name || "без названия"}» есть несохранённые правки.</p>
          {!editor.exercises.length ? (
            <p className="tiny">Чтобы сохранить, добавь хотя бы одно упражнение.</p>
          ) : null}
          <div className="modal-actions">
            <button
              className="button primary"
              disabled={busy || !editor.exercises.length}
              onClick={() => {
                setAskClose(false);
                void save();
              }}
            >
              Сохранить
            </button>
            <button className="button danger" disabled={busy} onClick={closeEditor}>
              Не сохранять
            </button>
            <button className="button secondary" onClick={() => setAskClose(false)}>
              Продолжить правку
            </button>
          </div>
        </Modal>
      ) : null}
      {deleting ? (
        <Modal
          title="Удалить программу?"
          onClose={() => {
            if (!busy) setDeleting(null);
          }}
        >
          <p>
            «{deleting.name}» исчезнет из плана. Сохранённые тренировки
            останутся.
          </p>
          {error ? (
            <p className="error-banner" role="alert">
              {error}
            </p>
          ) : null}
          <button
            className="button danger full-width"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await props.onDelete(deleting);
                setDeleting(null);
              } catch (e) {
                setError(e instanceof Error ? e.message : "Ошибка удаления");
              } finally {
                setBusy(false);
              }
            }}
          >
            Удалить программу
          </button>
        </Modal>
      ) : null}
    </div>
  );
}
