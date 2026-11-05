import { quantity } from "../lib/quantity";
import { lazy, Suspense, useState, useEffect } from "react";
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
import { TrainingProgram, DAY_NAMES } from "../domain/TrainingProgram";
import {
  addCalendarDays,
  weekStart,
  localDate,
  exerciseForEntry,
  exerciseById,
  entryName,
  makeExerciseEntry,
  makeSets,
} from "../lib/model";
import ExerciseInfo from "./ExerciseInfo";
import type { Exercise, Routine, Workout } from "../lib/types";
import { ApiError } from "../services/ApiClient";
import Modal from "./Modal";
import Select from "./Select";
const ExerciseLibrary = lazy(() => import("./ExerciseLibrary"));

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
  const [info, setInfo] = useState<Exercise | null>(null);
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
    today = localDate(new Date(), props.timeZone);
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
      await props.onSave(
        asCopy
          ? {
              ...editor,
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
  async function starter(kind: Parameters<typeof TrainingProgram.starter>[0]) {
    setBusy(true);
    setError("");
    try {
      for (const r of TrainingProgram.starter(kind))
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
          onClick={() => open(TrainingProgram.empty())}
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
              {r.exercises.slice(0, 4).map((e) => (
                <span key={e.exerciseId}>{entryName(e)}</span>
              ))}
              {r.exercises.length > 4 ? (
                <span>Ещё {r.exercises.length - 4}</span>
              ) : null}
            </div>
            <small>
              {r.progression === "double"
                ? `Прогрессия: ${r.repMin}–${r.repMax} повт., шаг ${r.incrementKg} кг`
                : "Повторять структуру, брать веса из истории"}
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
            ] as const
          ).map((p) => (
            <button
              className="starter-card panel"
              key={p.id}
              disabled={busy}
              onClick={() => void starter(p.id)}
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
      {editor ? (
        <Modal
          title={
            editor.revision ? "Редактировать программу" : "Новая программа"
          }
          wide
          onClose={() => {
            if (!busy) {
              setEditor(null);
              props.onInitialUsed?.();
            }
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
                      setEditor({ ...editor, progression: v as Routine["progression"] })
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
                {editor.exercises.map((entry, index) => {
                  const exercise = exerciseForEntry(entry)!,
                    spec = exercise.recording;
                  return (
                    <article
                      className="routine-editor-exercise"
                      key={entry.exerciseId}
                    >
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
                          onClick={() =>
                            setEditor({
                              ...editor,
                              exercises: editor.exercises.filter(
                                (_, i) => i !== index,
                              ),
                            })
                          }
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                      <div className="form-grid three">
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
                            : "Начальный вес, кг"}
                          <input
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
                    </article>
                  );
                })}
              </div>
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
