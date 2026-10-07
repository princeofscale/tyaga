import { useEffect, useRef, useState } from "react";
import {
  Check,
  Plus,
  Timer,
  Trash2,
  Save,
  Pause,
  Play,
  RotateCcw,
  Info,
  Download,
} from "lucide-react";
import {
  MUSCLES,
  exerciseForEntry,
  entryName,
  recordingLabel,
  fmt,
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

type Props = {
  draft: Draft | null;
  update: (draft: Draft) => void;
  settings: Settings;
  saving: boolean;
  error: string;
  persistence: PersistenceStatus;
  onPick: () => void;
  onSave: () => void;
  onDiscard: () => void;
  onExport: () => void;
};
export default function WorkoutView({
  draft,
  update,
  settings,
  saving,
  error,
  persistence,
  onPick,
  onSave,
  onDiscard,
  onExport,
}: Props) {
  const [now, setNow] = useState(Date.now());
  const [announcement, setAnnouncement] = useState("");
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
  const startRest = () =>
    update({
      ...draft,
      restUntil: Date.now() + restSeconds * 1000,
      pausedRest: null,
    });
  return (
    <div className="workout-layout">
      <fieldset
        className="workout-main"
        disabled={saving}
        aria-label="Поля тренировки"
      >
        <div className="workout-meta">
          <label>
            Название тренировки
            <input
              value={w.name}
              maxLength={120}
              onChange={(e) => setWorkout({ ...w, name: e.target.value })}
            />
          </label>
          <label>
            Дата
            <input
              type="date"
              max={localDate(new Date(), w.timeZone ?? settings.timeZone)}
              value={w.date}
              onChange={(e) => setWorkout({ ...w, date: e.target.value })}
            />
            <small className="tiny">
              {w.timeZone ?? settings.timeZone ?? "Локальная дата"}
            </small>
          </label>
        </div>
        <div className="session-hint">
          <Info size={16} />
          <span>
            RIR — сколько повторений осталось в запасе. Он сохраняется отдельно
            и не умножает число подходов.
          </span>
        </div>
        {w.exercises.map((we, ei) => {
          const exercise = exerciseForEntry(we)!;
          const spec = exercise.recording;
          const timed = spec.type === "duration";
          const assistance = spec.loadMode === "assisted_bodyweight";
          const noLoad = spec.loadMode === "bodyweight";
          const heading =
            spec.loadMode === "per_implement"
              ? "Кг / гантель"
              : assistance
                ? "Помощь, кг"
                : spec.loadMode === "added_bodyweight"
                  ? "Доп. кг"
                  : spec.loadMode === "machine_stack"
                    ? "Стек, кг"
                    : noLoad
                      ? "Вес"
                      : "Вес, кг";
          return (
            <article className="exercise-card" key={we.exerciseId}>
              <div className="exercise-card-head">
                <span className="exercise-number">
                  {String(ei + 1).padStart(2, "0")}
                </span>
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
              <p
                className={`recording-hint ${exercise.catalogRevision === 1 ? "legacy-hint" : ""}`}
              >
                <Info size={14} />
                {exercise.source
                  ? `${timed ? "Длительность записывается в секундах." : "Вес и повторы записываются по твоему правилу."} Для этой записи wger тоннаж, 1ПМ и покрытие мышц не рассчитываются.`
                  : exercise.catalogRevision === 1
                    ? "Старая запись: правило веса и вариант неизвестны. Вес сохранится как введён; тоннаж и 1ПМ не вычисляются."
                    : `${recordingLabel(we)}. ${spec.implementCount === 2 ? "Используются две гантели / два блока. " : ""}${spec.repsMode === "per_side" ? "Повторы на сторону." : "Повторы всего движения."}`}
              </p>
              {we.progressionNote ? (
                <p className="progression-note">{we.progressionNote}</p>
              ) : null}
              {spec.laterality === "unilateral" ? (
                <label className="recording-field">
                  Выполненные стороны
                  <select
                    aria-label="Выполненные стороны"
                    value={we.performedSides ?? "both"}
                    onChange={(e) =>
                      patchExercise(ei, {
                        performedSides: e.target
                          .value as WorkoutExercise["performedSides"],
                      })
                    }
                  >
                    <option value="both">Обе — один парный подход</option>
                    <option value="left">Только левая</option>
                    <option value="right">Только правая</option>
                  </select>
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
                    Нужно для сохранения. Вес сравнивается только на этой
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
                  <span>Подход</span>
                  <span>{heading}</span>
                  <span>
                    {timed
                      ? "Секунды"
                      : spec.repsMode === "per_side"
                        ? "На сторону"
                        : "Повторы"}
                  </span>
                  <span>{timed ? "Км" : "RIR"}</span>
                  <span>Готово</span>
                  <span />
                </div>
                {we.sets.map((s, si) => (
                  <div className={`set-row ${s.done ? "done" : ""}`} key={s.id}>
                    <button
                      className={`set-kind ${s.warmup ? "warmup" : ""}`}
                      title="Переключить рабочий / разминочный подход"
                      aria-label={`Подход ${si + 1}: ${s.warmup ? "разминочный" : "рабочий"}. Переключить тип`}
                      onClick={() => changeSet(ei, si, { warmup: !s.warmup })}
                    >
                      {s.warmup ? "Р" : si + 1}
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
                      <Check size={19} />
                    </button>
                    <button
                      className="remove-set"
                      disabled={we.sets.length <= 1}
                      aria-label={`Удалить подход ${si + 1}`}
                      onClick={() =>
                        patchExercise(ei, {
                          sets: we.sets.filter((_, j) => j !== si),
                        })
                      }
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
              <button
                className="add-set"
                disabled={we.sets.length >= 30}
                onClick={() => {
                  const previous = we.sets.at(-1)!;
                  const next = makeSets(1, previous.weight, previous.reps).map(
                    (s) => ({
                      ...s,
                      ...(timed
                        ? {
                            reps: 1,
                            rir: null,
                            durationSeconds: previous.durationSeconds ?? 30,
                          }
                        : {}),
                      ...(assistance
                        ? { assistanceKg: previous.assistanceKg ?? 0 }
                        : {}),
                    }),
                  );
                  patchExercise(ei, { sets: [...we.sets, ...next] });
                }}
              >
                <Plus size={15} />
                Добавить подход
              </button>
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
      </fieldset>
      <aside className="workout-summary panel">
        <div className="eyebrow">
          {draft.editing
            ? "РЕДАКТИРОВАНИЕ"
            : draft.clock.runningSince === null
              ? "СЧЁТЧИК НА ПАУЗЕ"
              : "ТРЕНИРОВКА ИДЁТ"}
        </div>
        <div className="session-time">
          {elapsed}
          <span> мин</span>
        </div>
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
        <p className="tiny">
          Счётчик приостанавливается при закрытии или уходе из журнала. Минуты
          можно исправить перед сохранением.
          {draft.restored
            ? " Черновик восстановлен; продолжи счётчик при необходимости."
            : ""}
        </p>
        <div className="session-summary-stats">
          <span>
            Упражнения<b>{w.exercises.length}</b>
          </span>
          <span>
            Рабочие подходы<b>{workingSets([w])}</b>
          </span>
          <span>
            Внешний объём<b>{fmt(summary.total)} кг</b>
          </span>
        </div>
        {summary.omittedSets ? (
          <p className="tiny">
            {summary.omittedSets} подх. с массой тела, тренажёрами или
            неизвестным правилом веса не входят во внешний объём.
          </p>
        ) : null}
        <div className="rest-timer">
          <div className="card-label">
            <Timer size={16} />
            Отдых между подходами
          </div>
          <div
            className={remaining ? "rest-digits active" : "rest-digits"}
            aria-live="off"
          >
            {String(Math.floor(remaining / 60)).padStart(2, "0")}:
            {String(remaining % 60).padStart(2, "0")}
          </div>
          <div className="timer-buttons">
            <button
              className="icon-button"
              aria-label="Запустить таймер заново"
              onClick={startRest}
            >
              <RotateCcw size={18} />
            </button>
            <button
              className="icon-button"
              aria-label={
                draft.pausedRest !== null
                  ? "Продолжить таймер"
                  : "Приостановить таймер"
              }
              disabled={!remaining}
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
              {draft.pausedRest !== null ? (
                <Play size={18} />
              ) : (
                <Pause size={18} />
              )}
            </button>
            <button
              className="timer-plus"
              onClick={() =>
                update(
                  draft.pausedRest !== null
                    ? { ...draft, pausedRest: draft.pausedRest + 15 }
                    : {
                        ...draft,
                        restUntil:
                          Math.max(Date.now(), draft.restUntil ?? 0) + 15000,
                      },
                )
              }
            >
              +15 с
            </button>
          </div>
          <span className="tiny">Сохраняется вместе с черновиком</span>
          <span className="sr-only" role="status" aria-live="polite">
            {announcement}
          </span>
        </div>
        {error ? (
          <p className="inline-error" role="alert">
            {error}
          </p>
        ) : null}
        {persistence === "failed" ? (
          <div className="inline-error" role="alert">
            Черновик сейчас только в открытой форме: браузер не смог сохранить
            его. Не закрывай страницу до сохранения в аккаунт.
            <button className="text-button" onClick={onExport}>
              <Download size={15} />
              Скачать черновик
            </button>
          </div>
        ) : null}
        <button
          className="button primary full-width"
          onClick={onSave}
          disabled={
            saving ||
            !w.exercises.some((e) => e.sets.some((s) => s.done && !s.warmup))
          }
        >
          <Save size={17} />
          {saving
            ? "Сохраняем…"
            : draft.editing
              ? "Сохранить изменения"
              : "Завершить тренировку"}
        </button>
        <button
          className="text-button discard"
          disabled={saving}
          onClick={onDiscard}
        >
          {draft.editing ? "Отменить изменения" : "Отменить тренировку"}
        </button>
        <p className="tiny draft-note">
          {persistence === "saved"
            ? "Черновик сохранён на этом устройстве."
            : persistence === "pending"
              ? "Сохраняем черновик…"
              : "Локальное сохранение недоступно."}{" "}
          Завершённые тренировки — в аккаунте.
        </p>
      </aside>
    </div>
  );
}
