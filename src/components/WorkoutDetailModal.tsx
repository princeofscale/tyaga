import { Suspense, useMemo } from "react";
import { CalendarDays, Clock3, Dumbbell, Layers3, Trash2, Trophy } from "lucide-react";
import Modal from "./Modal";
import SessionInsights from "./SessionInsights";
import { AppleHealthPanel } from "./chunks";
import { DateText } from "../domain/DateText";
import { DeloadEngine } from "../domain/DeloadEngine";
import { HistoryInsights, type ExerciseInsight } from "../domain/HistoryInsights";
import { VolumeLabel } from "../domain/VolumeLabel";
import {
  entryName,
  exerciseForEntry,
  fmt,
  legacyMuscleLoad,
  localDate,
  recordedLoad,
  recordingLabel,
  recordingNote,
  type Settings,
  type Workout,
  type WorkoutExercise,
} from "../lib/model";
import type { AccountProfile } from "../lib/account";

/** «пн, 9 ноября» и «сб, 20 декабря 2025» для записи не текущего года. */
const dateLabel = (date: string, currentYear: string) => {
  const day = new Date(date + "T12:00:00").toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    ...(date.slice(0, 4) !== currentYear ? { year: "numeric" } : {}),
  });
  return `${HistoryInsights.weekday(date)}, ${day.replace(/\s?г\.$/, "")}`;
};

/** «+2,5 кг», «−1 подх.», «±0» — разница с прошлым разом. */
const signed = (value: number, unit: string) => {
  if (Math.abs(value) < 0.05) return "±0";
  return `${value > 0 ? "+" : "−"}${fmt(Math.abs(value))}${unit ? ` ${unit}` : ""}`;
};
const tonnageDelta = (kg: number) =>
  Math.abs(kg) >= 1000 ? signed(Math.round(kg / 100) / 10, "т") : signed(Math.round(kg), "кг");
const tone = (value: number) => (Math.abs(value) < 0.05 ? "is-flat" : value > 0 ? "is-up" : "is-down");

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
function SetLine({ entry, set, n, best }: { entry: WorkoutExercise; set: WorkoutExercise["sets"][number]; n: number; best: boolean }) {
  const spec = exerciseForEntry(entry)?.recording;
  return (
    <span
      className={`detail-set${set.warmup ? " is-warmup" : ""}${best ? " is-best" : ""}`}
      title={best ? "Лучший подход по расчётному 1ПМ" : undefined}
    >
      <i className="detail-set-n" aria-hidden="true">{set.warmup ? "Р" : n}</i>
      <span className="detail-set-body">
        {set.warmup ? <span className="sr-only">Разминка · </span> : ""}
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
    </span>
  );
}

function ExerciseScore({ insight }: { insight: ExerciseInsight }) {
  if (!insight.best) return null;
  const delta = insight.previousBest !== null ? insight.best.e1rm - insight.previousBest : null;
  return (
    <div className="detail-exercise-score">
      <span className="detail-e1rm" title="Расчётный 1ПМ лучшего рабочего подхода (Эпли)">
        1ПМ ≈ <b>{fmt(Math.round(insight.best.e1rm * 2) / 2)}</b> кг
      </span>
      {insight.record ? (
        <span className="record-badge">
          <Trophy size={12} aria-hidden="true" />
          Рекорд
        </span>
      ) : delta !== null ? (
        <span className={`detail-delta ${tone(delta)}`} title={insight.previousDate ? `Прошлый раз: ${DateText.day(insight.previousDate)}` : undefined}>
          {signed(Math.round(delta * 2) / 2, "кг")}
        </span>
      ) : null}
    </div>
  );
}

type Props = {
  detail: Workout;
  /** Весь журнал: прошлая такая же тренировка, рекорды и разница по упражнениям. */
  history: Workout[];
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

/** Окно сохранённой тренировки: подходы, итоги, сравнение с прошлым разом, показатели часов и действия. */
export default function WorkoutDetailModal({
  detail, history, settings, account, demo,
  onClose, onDelete, onCreateProgram, onRepeat, onEdit, onHealthSaved,
}: Props) {
  const currentYear = localDate(new Date(), settings.timeZone).slice(0, 4);
  const totals = useMemo(() => HistoryInsights.totals([detail]), [detail]);
  const previous = useMemo(() => HistoryInsights.previous(detail, history), [detail, history]);
  const before = useMemo(() => (previous ? HistoryInsights.totals([previous]) : null), [previous]);
  const insights = useMemo(() => HistoryInsights.exercises(detail, history), [detail, history]);
  return (
    <Modal title={detail.name} onClose={onClose} wide>
      <div className="workout-detail-meta">
        <span>
          <CalendarDays size={16} aria-hidden="true" />
          {dateLabel(detail.date, currentYear)}
        </span>
        <span>
          <Clock3 size={16} aria-hidden="true" />
          {detail.duration} мин
        </span>
        <span title={totals.tonnage > 0 ? "Свободные веса, включая разминку" : VolumeLabel.reason(totals.omittedSets)}>
          <Dumbbell size={16} aria-hidden="true" />
          {VolumeLabel.short(totals.tonnage)}
        </span>
        <span>
          <Layers3 size={16} aria-hidden="true" />
          {totals.sets} подх.
        </span>
      </div>
      {previous && before ? (
        <section className="detail-compare" aria-label="Сравнение с прошлой тренировкой">
          <p>
            С прошлой «{DeloadEngine.baseName(previous.name)}» · {DateText.dayInYear(previous.date, currentYear)}
          </p>
          <div className="detail-compare-row">
            {totals.tonnage > 0 && before.tonnage > 0 ? (
              <span className={tone(totals.tonnage - before.tonnage)}>
                <small>Тоннаж</small>
                <b>{tonnageDelta(totals.tonnage - before.tonnage)}</b>
              </span>
            ) : null}
            <span className={tone(totals.sets - before.sets)}>
              <small>Подходы</small>
              <b>{signed(totals.sets - before.sets, "")}</b>
            </span>
            <span className={`is-neutral ${tone(detail.duration - previous.duration)}`}>
              <small>Время</small>
              <b>{signed(detail.duration - previous.duration, "мин")}</b>
            </span>
          </div>
        </section>
      ) : null}
      {detail.exercises.map((e, i) => {
        const note = entryNote(e);
        const insight = insights[i];
        const sets = e.sets.filter((s) => s.done);
        let n = 0;
        return (
          <article className={`detail-exercise${insight?.record ? " is-record" : ""}`} key={`${e.exerciseId}-${i}`}>
            <header className="detail-exercise-head">
              <span className="detail-exercise-index" aria-hidden="true">{i + 1}</span>
              <div className="detail-exercise-title">
                <h3>{entryName(e)}</h3>
                {note ? <p className="tiny">{note}</p> : null}
              </div>
              {insight ? <ExerciseScore insight={insight} /> : null}
            </header>
            <div className="detail-sets">
              {sets.length ? (
                sets.map((s) => (
                  <SetLine key={s.id} entry={e} set={s} n={s.warmup ? 0 : ++n} best={insight?.best?.setId === s.id} />
                ))
              ) : (
                <span className="detail-sets-empty">Подходы не отмечены</span>
              )}
            </div>
          </article>
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
        Тоннаж — только свободные веса с известным правилом записи. Тренажёры,
        масса тела и неопределённые старые записи показаны по подходам.
      </p>
      <details className="detail-insights">
        <summary>Итоги, мышцы и карточка для сторис</summary>
        <SessionInsights workout={detail} settings={settings} account={account} />
      </details>
      <Suspense fallback={<p className="tiny">Открываем показатели часов…</p>}>
        <AppleHealthPanel workout={detail} readOnly={demo} onSaved={onHealthSaved} />
      </Suspense>
      <div className="modal-actions detail-actions">
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
