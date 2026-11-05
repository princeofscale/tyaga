import { useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  Plus,
  Minus,
  Trash2,
  Pause,
  Play,
  Info,
  Download,
  X,
} from "lucide-react";
import {
  MUSCLES,
  exerciseForEntry,
  entryName,
  recordingLabel,
  fmt,
  lastEntry,
  localDate,
  makeSets,
  volumeSummary,
  workingSets,
  type Workout,
  type SetEntry,
  type Settings,
  type WorkoutExercise,
} from "../lib/model";
import {
  checkpointDraft,
  elapsedMs,
  type Draft,
  type PersistenceStatus,
} from "../lib/draft";
export type { Draft } from "../lib/draft";
import { WarmupPlanner } from "../domain/WarmupPlanner";
import Select from "./Select";

type Props = {
  draft: Draft | null;
  update: (draft: Draft) => void;
  settings: Settings;
  history: Workout[];
  saving: boolean;
  error: string;
  persistence: PersistenceStatus;
  onPick: () => void;
  onSave: () => void;
  onDiscard: () => void;
  onExport: () => void;
  onMinimize: () => void;
};
const clock = (seconds: number) =>
  `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
/** "80 × 8" for the set at the same position (working or warm-up) last time. */
function previousLabel(entry: WorkoutExercise, previous?: SetEntry) {
  if (!previous) return "—";
  const spec = exerciseForEntry(entry)!.recording;
  if (spec.type === "duration") return `${previous.durationSeconds ?? 0} с`;
  if (spec.loadMode === "bodyweight") return `× ${previous.reps}`;
  if (spec.loadMode === "assisted_bodyweight")
    return `${fmt(previous.assistanceKg ?? 0)} × ${previous.reps}`;
  return `${fmt(previous.weight)} × ${previous.reps}`;
}
export default function WorkoutView({
  draft,
  update,
  settings,
  history,
  saving,
  error,
  persistence,
  onPick,
  onSave,
  onDiscard,
  onExport,
  onMinimize,
}: Props) {
  const [now, setNow] = useState(Date.now());
  const [announcement, setAnnouncement] = useState("");
  const [rirHelp, setRirHelp] = useState(false);
  const restSeconds = draft?.workout.restSeconds ?? settings.restSeconds;
  const announcedTimer = useRef<number | null>(null);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const remaining =
    draft?.pausedRest ??
    (draft?.restUntil
      ? Math.max(0, Math.ceil((draft.restUntil - now) / 1000))
      : 0);
  useEffect(() => {
    if (
      draft?.restUntil &&
      draft.pausedRest === null &&
      draft.restUntil <= now &&
      announcedTimer.current !== draft.restUntil
    ) {
      announcedTimer.current = draft.restUntil;
      setAnnouncement("Отдых завершён");
    } else if (remaining > 0) setAnnouncement("");
  }, [draft?.restUntil, draft?.pausedRest, now, remaining]);
  const exercises = draft?.workout.exercises;
  const workoutId = draft?.workout.id;
  const previous = useMemo(
    () =>
      new Map(
        (exercises ?? []).map((e) => {
          const sets = lastEntry(history, e, workoutId)?.sets.filter((s) => s.done) ?? [];
          return [
            e.exerciseId,
            {
              working: sets.filter((s) => !s.warmup),
              warmup: sets.filter((s) => s.warmup),
            },
          ];
        }),
      ),
    [history, exercises, workoutId],
  );
  if (!draft)
    return (
      <div className="empty-state">
        <div className="empty-icon">
          <Play size={30} />
        </div>
        <h2>Время сделать первый подход</h2>
        <p>Выбери упражнения и записывай вес, повторы и запас повторений.</p>
        <button className="button primary" onClick={onPick}>
          <Plus size={18} />
          Начать тренировку
        </button>
      </div>
    );
  const w = draft.workout;
  const setWorkout = (workout: Workout) => update({ ...draft, workout });
  const patchExercise = (ei: number, patch: Partial<WorkoutExercise>) =>
    setWorkout({
      ...w,
      exercises: w.exercises.map((e, i) => (i === ei ? { ...e, ...patch } : e)),
    });
  const changeSet = (ei: number, si: number, patch: Partial<SetEntry>) => {
    update({
      ...draft,
      workout: {
        ...w,
        exercises: w.exercises.map((e, i) =>
          i === ei
            ? {
                ...e,
                sets: e.sets.map((s, j) => (j === si ? { ...s, ...patch } : s)),
              }
            : e,
        ),
      },
      ...(patch.done
        ? {
            restUntil: Date.now() + restSeconds * 1000,
            pausedRest: null,
          }
        : {}),
    });
  };
  const elapsed = draft.manualDuration
    ? w.duration
    : Math.floor(elapsedMs(draft, now) / 60000);
  const summary = volumeSummary([w]);
  const warmupSummary = volumeSummary([w], "warmup");
  const warmupCount = w.exercises.reduce(
    (n, e) => n + e.sets.filter((s) => s.done && s.warmup).length,
    0,
  );
  const doneWorking = workingSets([w]);
  const resting = remaining > 0 || draft.pausedRest !== null;
  const shiftRest = (seconds: number) =>
    update(
      draft.pausedRest !== null
        ? { ...draft, pausedRest: Math.max(0, draft.pausedRest + seconds) }
        : {
            ...draft,
            restUntil: Math.max(Date.now(), draft.restUntil ?? 0) + seconds * 1000,
          },
    );
  return (
    <div className="workout-screen">
      <header className="workout-bar">
        <button
          className="icon-button"
          aria-label="Свернуть тренировку"
          onClick={onMinimize}
        >
          <ChevronDown size={24} />
        </button>
        <div className="workout-bar-title">
          <input
            aria-label="Название тренировки"
            value={w.name}
            maxLength={120}
            disabled={saving}
            onChange={(e) => setWorkout({ ...w, name: e.target.value })}
          />
          <span>
            {draft.manualDuration
              ? `${w.duration} мин`
              : draft.clock.runningSince === null
                ? `${clock(Math.floor(elapsedMs(draft, now) / 1000))} · пауза`
                : clock(Math.floor(elapsedMs(draft, now) / 1000))}
            {" · "}
            {doneWorking} раб. подх.
          </span>
        </div>
        <button
          className="button primary finish-button"
          aria-label={draft.editing ? "Сохранить изменения" : "Завершить тренировку"}
          onClick={onSave}
          disabled={
            saving ||
            !w.exercises.some((e) => e.sets.some((s) => s.done && !s.warmup))
          }
        >
          {saving ? "…" : draft.editing ? "Сохранить" : "Завершить"}
        </button>
      </header>
      {error ? (
        <p className="inline-error" role="alert">
          {error}
        </p>
      ) : null}
      {persistence === "failed" ? (
        <div className="inline-error" role="alert">
          Черновик сейчас только в открытой форме: не удалось сохранить его на
          устройстве. Не закрывай журнал до завершения тренировки.
          <button className="text-button" onClick={onExport}>
            <Download size={15} />
            Скачать черновик
          </button>
        </div>
      ) : null}
      <fieldset
        className="workout-main"
        disabled={saving}
        aria-label="Поля тренировки"
      >
        {!w.exercises.length ? (
          <p className="workout-empty">
            Добавь первое упражнение — веса подставим из прошлой тренировки.
          </p>
        ) : null}
        {w.exercises.map((we, ei) => {
          const exercise = exerciseForEntry(we)!;
          const spec = exercise.recording;
          const timed = spec.type === "duration";
          const assistance = spec.loadMode === "assisted_bodyweight";
          const noLoad = spec.loadMode === "bodyweight";
          const before = previous.get(we.exerciseId);
          const heading =
            spec.loadMode === "per_implement"
              ? "кг / гант."
              : assistance
                ? "Помощь"
                : spec.loadMode === "added_bodyweight"
                  ? "Доп. кг"
                  : spec.loadMode === "machine_stack"
                    ? "Стек"
                    : noLoad
                      ? "Вес"
                      : "кг";
          // Only unusual recording rules need words; plain barbell kg do not.
          const hint = exercise.source
            ? `${timed ? "Длительность в секундах. " : ""}Непроверенная запись базы: тоннаж, 1ПМ и покрытие мышц не считаются.`
            : exercise.catalogRevision === 1
              ? "Старая запись: правило веса неизвестно. Вес сохранится как введён; тоннаж и 1ПМ не считаются."
              : [
                  spec.loadMode === "per_implement" ? "Вес одной гантели." : "",
                  spec.implementCount === 2 ? "В работе две гантели / два блока." : "",
                  spec.repsMode === "per_side" ? "Повторы на сторону." : "",
                ]
                  .join(" ")
                  .trim();
          let working = 0;
          let warm = 0;
          return (
            <article className="exercise-card" key={we.exerciseId}>
              <div className="exercise-card-head">
                <div>
                  <h3>{entryName(we)}</h3>
                  <p>
                    {exercise.primary
                      .map((id) => MUSCLES.find((m) => m.id === id)!.short)
                      .join(" · ")}
                  </p>
                </div>
                <button
                  className="icon-button"
                  aria-label={`Убрать ${entryName(we)}`}
                  onClick={() =>
                    setWorkout({
                      ...w,
                      exercises: w.exercises.filter((_, i) => i !== ei),
                    })
                  }
                >
                  <Trash2 size={17} />
                </button>
              </div>
              {hint ? (
                <p
                  className={`recording-hint ${exercise.catalogRevision === 1 ? "legacy-hint" : ""}`}
                >
                  <Info size={14} />
                  {hint}
                </p>
              ) : null}
              {we.progressionNote ? (
                <p className="progression-note">{we.progressionNote}</p>
              ) : null}
              {spec.laterality === "unilateral" ? (
                <label className="recording-field">
                  Выполненные стороны
                  <Select
                    aria-label="Выполненные стороны"
                    value={we.performedSides ?? "both"}
                    onChange={(v) =>
                      patchExercise(ei, {
                        performedSides: v as WorkoutExercise["performedSides"],
                      })
                    }
                    options={[
                      { value: "both", label: "Обе — один парный подход" },
                      { value: "left", label: "Только левая" },
                      { value: "right", label: "Только правая" },
                    ]}
                  />
                </label>
              ) : null}
              {["machine_stack", "assisted_bodyweight"].includes(
                spec.loadMode,
              ) ? (
                <label className="recording-field">
                  Тренажёр / блок
                  <input
                    aria-label="Тренажёр / блок"
                    maxLength={120}
                    value={we.equipmentNote ?? ""}
                    placeholder="Например: верхний блок у окна"
                    onChange={(e) =>
                      patchExercise(ei, { equipmentNote: e.target.value })
                    }
                    required
                  />
                  <small className="tiny">
                    Нужно для сохранения: вес сравнивается только на этой
                    машине.
                  </small>
                </label>
              ) : null}
              {exercise.bodyweight && exercise.catalogRevision === 2 ? (
                <details className="recording-extra">
                  <summary>Записать массу тела (по желанию)</summary>
                  <label>
                    Масса тела, кг
                    <input
                      type="number"
                      min="20"
                      max="400"
                      step="0.1"
                      value={we.bodyMassKg ?? ""}
                      onChange={(e) =>
                        patchExercise(ei, {
                          bodyMassKg:
                            e.target.value === ""
                              ? undefined
                              : Number(e.target.value),
                        })
                      }
                    />
                  </label>
                  <p className="tiny">
                    Хранится как контекст; не превращается в нагрузку мышцы или
                    расчётный 1ПМ.
                  </p>
                </details>
              ) : null}
              <div className="sets-table">
                <div className="sets-header">
                  <span>#</span>
                  <span>Прошлый</span>
                  <span>{heading}</span>
                  <span>
                    {timed
                      ? "Сек"
                      : spec.repsMode === "per_side"
                        ? "Повт / ст."
                        : "Повт"}
                  </span>
                  {timed ? (
                    <span>Км</span>
                  ) : (
                    <button
                      className="rir-help"
                      aria-expanded={rirHelp}
                      aria-label="RIR: что это"
                      onClick={() => setRirHelp((v) => !v)}
                    >
                      RIR
                    </button>
                  )}
                  <span className="sr-only">Готово</span>
                </div>
                {rirHelp && !timed ? (
                  <p className="tiny rir-note">
                    RIR — сколько повторений осталось в запасе. Не обязателен;
                    фильтр «тяжёлых» подходов в прогрессе использует RIR ≤ 3.
                  </p>
                ) : null}
                {we.sets.map((s, si) => {
                  const index = s.warmup ? warm++ : working++;
                  const last = s.warmup
                    ? before?.warmup[index]
                    : before?.working[index];
                  const lastText = previousLabel(we, last);
                  return (
                    <div className={`set-row ${s.done ? "done" : ""}`} key={s.id}>
                      <button
                        className={`set-kind ${s.warmup ? "warmup" : ""}`}
                        title="Переключить рабочий / разминочный подход"
                        aria-label={`Подход ${si + 1}: ${s.warmup ? "разминочный" : "рабочий"}. Переключить тип`}
                        onClick={() => changeSet(ei, si, { warmup: !s.warmup })}
                      >
                        {s.warmup ? "Р" : index + 1}
                      </button>
                      <button
                        className="set-previous"
                        disabled={!last}
                        aria-label={
                          last
                            ? `Подставить прошлый результат: ${lastText}`
                            : "Прошлого результата нет"
                        }
                        onClick={() =>
                          last &&
                          changeSet(ei, si, {
                            weight: last.weight,
                            reps: last.reps,
                            ...(timed ? { durationSeconds: last.durationSeconds } : {}),
                            ...(assistance ? { assistanceKg: last.assistanceKg } : {}),
                          })
                        }
                      >
                        {lastText}
                      </button>
                      {noLoad ? (
                        <span
                          className="no-load-value"
                          aria-label="Без внешнего веса"
                        >
                          —
                        </span>
                      ) : (
                        <input
                          aria-label={`${entryName(we)}, подход ${si + 1}, ${assistance ? "помощь" : "вес"}`}
                          title={recordingLabel(we)}
                          type="number"
                          min="0"
                          max="1000"
                          step="0.5"
                          inputMode="decimal"
                          value={assistance ? (s.assistanceKg ?? 0) : s.weight}
                          onChange={(e) =>
                            changeSet(
                              ei,
                              si,
                              assistance
                                ? {
                                    assistanceKg: Number(e.target.value),
                                    weight: 0,
                                  }
                                : { weight: Number(e.target.value) },
                            )
                          }
                        />
                      )}
                      <input
                        aria-label={`${entryName(we)}, подход ${si + 1}, ${timed ? "секунды" : "повторы"}${!timed && spec.repsMode === "per_side" ? " на сторону" : ""}`}
                        type="number"
                        min="1"
                        max={timed ? "86400" : "200"}
                        inputMode="numeric"
                        value={timed ? (s.durationSeconds ?? 30) : s.reps}
                        onChange={(e) =>
                          changeSet(
                            ei,
                            si,
                            timed
                              ? {
                                  durationSeconds: Number(e.target.value),
                                  reps: 1,
                                }
                              : { reps: Number(e.target.value) },
                          )
                        }
                      />
                      <input
                        aria-label={`${entryName(we)}, подход ${si + 1}, ${timed ? "дистанция, км" : "RIR"}`}
                        type="number"
                        min="0"
                        max={timed ? "1000" : "10"}
                        step={timed ? "0.01" : "0.5"}
                        inputMode="decimal"
                        value={timed ? (s.distanceKm ?? "") : (s.rir ?? "")}
                        placeholder="—"
                        onChange={(e) =>
                          changeSet(
                            ei,
                            si,
                            timed
                              ? {
                                  distanceKm:
                                    e.target.value === ""
                                      ? undefined
                                      : Number(e.target.value),
                                }
                              : {
                                  rir:
                                    e.target.value === ""
                                      ? null
                                      : Number(e.target.value),
                                },
                          )
                        }
                      />
                      <button
                        className="set-check"
                        aria-label={`${s.done ? "Снять отметку" : "Отметить выполненным"}: ${entryName(we)}, подход ${si + 1}`}
                        aria-pressed={s.done}
                        onClick={() => changeSet(ei, si, { done: !s.done })}
                      >
                        <Check size={22} strokeWidth={3} />
                      </button>
                    </div>
                  );
                })}
              </div>
              <div className="set-actions">
                <button
                  className="add-set"
                  disabled={we.sets.length >= 30}
                  onClick={() => {
                    const last = we.sets.at(-1)!;
                    const next = makeSets(1, last.weight, last.reps).map(
                      (s) => ({
                        ...s,
                        ...(timed
                          ? {
                              reps: 1,
                              rir: null,
                              durationSeconds: last.durationSeconds ?? 30,
                            }
                          : {}),
                        ...(assistance
                          ? { assistanceKg: last.assistanceKg ?? 0 }
                          : {}),
                      }),
                    );
                    patchExercise(ei, { sets: [...we.sets, ...next] });
                  }}
                >
                  <Plus size={16} />
                  Подход
                </button>
                <button
                  className="add-set remove-last"
                  disabled={we.sets.length <= 1}
                  aria-label="Убрать последний подход"
                  onClick={() => patchExercise(ei, { sets: we.sets.slice(0, -1) })}
                >
                  <Minus size={16} />
                </button>
              </div>
              {!we.sets.some((s) => s.warmup) &&
              new WarmupPlanner(we).create().length > 0 ? (
                <div className="warmup-scaffold">
                  <button
                    className="text-button"
                    onClick={() =>
                      patchExercise(ei, {
                        sets: [...new WarmupPlanner(we).create(), ...we.sets],
                      })
                    }
                  >
                    <Plus size={15} />
                    Добавить 3 разминочных
                  </button>
                  <p className="tiny">40 / 60 / 80% рабочего веса — проверь и поправь.</p>
                </div>
              ) : null}
            </article>
          );
        })}
        <button
          className="button secondary full-width"
          disabled={w.exercises.length >= 30}
          onClick={onPick}
        >
          <Plus size={18} />
          Добавить упражнение
        </button>
        <details className="workout-details panel" open={draft.editing}>
          <summary>Детали тренировки</summary>
          <label>
            Дата
            <input
              type="date"
              max={localDate(new Date(), w.timeZone ?? settings.timeZone)}
              value={w.date}
              onChange={(e) => setWorkout({ ...w, date: e.target.value })}
            />
          </label>
          <div className="duration-controls">
            <label>
              Длительность, минуты
              <input
                aria-label="Длительность тренировки, минуты"
                disabled={saving}
                type="number"
                min="0"
                max="1440"
                value={elapsed}
                onChange={(e) =>
                  update({
                    ...checkpointDraft(draft, Date.now(), true),
                    manualDuration: true,
                    workout: { ...w, duration: Number(e.target.value) },
                  })
                }
              />
            </label>
            {!draft.editing ? (
              <button
                className="icon-button"
                disabled={saving}
                aria-label={
                  draft.clock.runningSince === null
                    ? "Продолжить счётчик тренировки"
                    : "Приостановить счётчик тренировки"
                }
                onClick={() =>
                  update(
                    draft.clock.runningSince === null
                      ? {
                          ...draft,
                          manualDuration: false,
                          restored: false,
                          clock: {
                            elapsedMs: draft.manualDuration
                              ? w.duration * 60000
                              : draft.clock.elapsedMs,
                            runningSince: Date.now(),
                          },
                        }
                      : checkpointDraft(draft, Date.now(), true),
                  )
                }
              >
                {draft.clock.runningSince === null ? (
                  <Play size={18} />
                ) : (
                  <Pause size={18} />
                )}
              </button>
            ) : null}
          </div>
          {draft.restored ? (
            <p className="tiny">
              Черновик восстановлен, счётчик на паузе — продолжи его кнопкой выше.
            </p>
          ) : null}
          <label className="notes-label">
            Заметки
            <textarea
              rows={3}
              placeholder="Как самочувствие? Что стоит помнить в следующий раз?"
              value={w.notes}
              maxLength={2000}
              onChange={(e) => setWorkout({ ...w, notes: e.target.value })}
            />
          </label>
          <div className="session-summary-stats">
            <span>
              Упражнения<b>{w.exercises.length}</b>
            </span>
            <span>
              Рабочие подходы<b>{doneWorking}</b>
            </span>
            <span>
              Рабочий тоннаж<b>{fmt(summary.total)} кг</b>
            </span>
            <span>
              Разминка<b>{warmupCount} подх. · {fmt(warmupSummary.total)} кг</b>
            </span>
          </div>
          {summary.omittedSets ? (
            <p className="tiny">
              {summary.omittedSets} подх. с массой тела, тренажёрами или
              неизвестным правилом веса не входят во внешний объём.
            </p>
          ) : null}
          <p className="tiny draft-note">
            {persistence === "saved"
              ? "Черновик сохранён на этом устройстве."
              : persistence === "pending"
                ? "Сохраняем черновик…"
                : "Локальное сохранение недоступно."}
          </p>
          <button
            className="text-button danger-text discard"
            disabled={saving}
            onClick={onDiscard}
          >
            {draft.editing ? "Отменить изменения" : "Отменить тренировку"}
          </button>
        </details>
      </fieldset>
      {resting ? (
        <section className="rest-bar" aria-label="Таймер отдыха">
          <div className="rest-progress">
            <span
              style={{
                width: `${Math.min(100, (100 * remaining) / Math.max(restSeconds, remaining, 1))}%`,
              }}
            />
          </div>
          <div className="rest-body">
            <div className="rest-copy">
              <span>{draft.pausedRest !== null ? "Отдых на паузе" : "Отдых"}</span>
              <span className="rest-digits active" aria-live="off">
                {clock(remaining)}
              </span>
            </div>
            <button aria-label="Минус 15 секунд" onClick={() => shiftRest(-15)}>
              −15
            </button>
            <button
              className="timer-plus"
              aria-label="Плюс 15 секунд"
              onClick={() => shiftRest(15)}
            >
              +15
            </button>
            <button
              className="icon-button"
              aria-label={
                draft.pausedRest !== null
                  ? "Продолжить таймер"
                  : "Приостановить таймер"
              }
              onClick={() =>
                update(
                  draft.pausedRest !== null
                    ? {
                        ...draft,
                        restUntil: Date.now() + draft.pausedRest * 1000,
                        pausedRest: null,
                      }
                    : { ...draft, pausedRest: remaining, restUntil: null },
                )
              }
            >
              {draft.pausedRest !== null ? <Play size={20} /> : <Pause size={20} />}
            </button>
            <button
              className="icon-button"
              aria-label="Пропустить отдых"
              onClick={() =>
                update({ ...draft, restUntil: null, pausedRest: null })
              }
            >
              <X size={20} />
            </button>
          </div>
        </section>
      ) : null}
      <span className="sr-only" role="status" aria-live="polite">
        {announcement}
      </span>
    </div>
  );
}
