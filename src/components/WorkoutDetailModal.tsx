import { Suspense } from "react";
import { CalendarDays, Clock3, Dumbbell, Trash2 } from "lucide-react";
import Modal from "./Modal";
import SessionInsights from "./SessionInsights";
import { AppleHealthPanel } from "./chunks";
import {
  entryName,
  exerciseForEntry,
  fmt,
  legacyMuscleLoad,
  recordedLoad,
  recordingLabel,
  recordingNote,
  volumeSummary,
  type Settings,
  type Workout,
  type WorkoutExercise,
} from "../lib/model";
import type { AccountProfile } from "../lib/account";

const dateLabel = (date: string, long = false) =>
  new Date(date + "T12:00:00").toLocaleDateString("ru-RU", {
    day: "numeric",
    month: long ? "long" : "short",
  });

/** Описание записи подхода: снаряд, стороны, замечания — как в сохранённой тренировке. */
function entryNote(e: WorkoutExercise) {
  const sides = e.performedSides
    ? e.performedSides === "both" ? "обе стороны" : e.performedSides === "left" ? "левая сторона" : "правая сторона"
    : "";
  return [
    recordingNote(e),
    e.machineSnapshot ? e.machineSnapshot.nickname : e.equipmentNote ?? "",
    sides,
  ].filter(Boolean).join(" · ");
}

/** Подход: сторона, амплитуда, вес/время и RIR. */
function SetLine({ entry, set }: { entry: WorkoutExercise; set: WorkoutExercise["sets"][number] }) {
  const spec = exerciseForEntry(entry)?.recording;
  return (
    <span>
      {set.warmup ? "Разминка · " : ""}
      {set.performedSides ? `${set.performedSides === "both" ? "обе стороны" : set.performedSides === "left" ? "левая" : "правая"} · ` : ""}
      {set.execution?.rom ? `ROM: ${set.execution.rom} · ` : ""}
      <b>
        {spec?.type === "duration" ? (
          `${set.durationSeconds} с`
        ) : (
          <>
            {spec?.loadMode === "bodyweight"
              ? "Без веса"
              : `${fmt(recordedLoad(entry, set))} ${recordingLabel(entry)}`}{" "}
            × {set.reps}
            {spec?.repsMode === "per_side" ? " / сторону" : ""}
          </>
        )}
      </b>
      {spec?.type !== "duration" ? (
        <small>RIR {set.rir ?? "—"}</small>
      ) : set.distanceKm !== undefined ? (
        <small>{set.distanceKm} км</small>
      ) : null}
    </span>
  );
}

type Props = {
  detail: Workout;
  settings: Settings;
  account: AccountProfile;
  demo: boolean;
  onClose: () => void;
  onDelete: (id: string) => void;
  onCreateProgram: (workout: Workout) => void;
  onRepeat: (workout: Workout) => void;
  onEdit: (workout: Workout) => void;
  onHealthSaved: (saved: Workout) => void;
};

/** Окно сохранённой тренировки: подходы, итоги, показатели часов и действия. */
export default function WorkoutDetailModal({
  detail, settings, account, demo,
  onClose, onDelete, onCreateProgram, onRepeat, onEdit, onHealthSaved,
}: Props) {
  return (
    <Modal title={detail.name} onClose={onClose} wide>
      <div className="workout-detail-meta">
        <span>
          <CalendarDays size={16} />
          {dateLabel(detail.date, true)}
        </span>
        <span>
          <Clock3 size={16} />
          {detail.duration} мин
        </span>
        <span>
          <Dumbbell size={16} />
          {fmt(volumeSummary([detail], "all").total)} кг
        </span>
      </div>
      {detail.exercises.map((e) => {
        const note = entryNote(e);
        return (
          <div className="detail-exercise" key={e.exerciseId}>
            <h3>{entryName(e)}</h3>
            {note ? <p className="tiny">{note}</p> : null}
            <div className="detail-sets">
              {e.sets.filter((s) => s.done).map((s) => (
                <SetLine key={s.id} entry={e} set={s} />
              ))}
            </div>
          </div>
        );
      })}
      {detail.exercises.some((e) => (e.catalogRevision ?? 1) === 1) ? (
        <details className="historical-calculation">
          <summary>Архивный расчёт подходов · методика 1</summary>
          <p>
            Это прежняя эвристика 1 / 0,5 с RIR-множителем. Она сохранена
            для проверки старых расчётов и не используется как измерение
            роста.
          </p>
          {legacyMuscleLoad([detail])
            .filter((m) => m.total > 0)
            .map((m) => (
              <p key={m.id}>
                {m.name}: {fmt(m.direct)} прямых + {fmt(m.indirect)}{" "}
                условных косвенных
              </p>
            ))}
        </details>
      ) : null}
      {detail.notes ? <p className="detail-notes">{detail.notes}</p> : null}
      <p className="history-value-note">
        Внешний объём включает только свободные веса с известным правилом
        записи. Тренажёры, масса тела и неопределённые старые записи
        показаны по подходам.
      </p>
      <details className="detail-insights">
        <summary>Итоги, мышцы и карточка для сторис</summary>
        <SessionInsights workout={detail} settings={settings} account={account} />
      </details>
      <Suspense fallback={<p className="tiny">Открываем показатели часов…</p>}>
        <AppleHealthPanel workout={detail} readOnly={demo} onSaved={onHealthSaved} />
      </Suspense>
      <div className="modal-actions">
        {!demo ? (
          <button className="text-button danger-text" onClick={() => onDelete(detail.id)}>
            <Trash2 size={15} />
            Удалить
          </button>
        ) : (
          <span className="tiny">Пример данных</span>
        )}
        <div className="button-group">
          <button className="button secondary" onClick={() => onCreateProgram(detail)}>
            В программу
          </button>
          <button className="button secondary" onClick={() => onRepeat(detail)}>
            Повторить
          </button>
          {!demo ? (
            <button className="button primary" onClick={() => onEdit(detail)}>
              Редактировать
            </button>
          ) : null}
        </div>
      </div>
    </Modal>
  );
}
