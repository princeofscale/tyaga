import { memo, useEffect, useState } from "react";
import { Clock, Pause, Play } from "lucide-react";
import { elapsedMs, type Draft } from "../../lib/draft";
import { formatWorkoutClock } from "./formatWorkoutClock";

export const WorkoutAutoDuration = memo(function WorkoutAutoDuration({
  draft,
  manualClock,
  retro,
  estimatedMinutes,
}: {
  draft: Draft;
  manualClock: boolean;
  retro: boolean;
  estimatedMinutes: number;
}) {
  const running = !manualClock && !retro && draft.clock.runningSince !== null;
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!running) return;
    const sync = () => setNow(Date.now());
    const id = setInterval(sync, 1000);
    const onVis = () => {
      if (document.visibilityState === "visible") sync();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [running]);

  const elapsedSec = Math.floor(elapsedMs(draft, now) / 1000);
  const autoMin = Math.max(0, Math.round(elapsedSec / 60));
  const isHistoricalEdit = draft.editing;
  const displayMin = isHistoricalEdit
    ? draft.workout.duration
    : retro || manualClock
      ? estimatedMinutes
      : autoMin;
  const detail = isHistoricalEdit
    ? "Из сохранённой записи"
    : retro || manualClock
      ? "Расчёт по подходам"
      : draft.clock.runningSince === null
        ? `На паузе · ${formatWorkoutClock(elapsedSec)}`
        : `Идёт таймер · ${formatWorkoutClock(elapsedSec)}`;

  return (
    <div className="workout-auto-duration" role="status" aria-live="off">
      <div className="workout-auto-duration-head">
        <span className="workout-auto-duration-label">
          <Clock size={14} aria-hidden="true" />
          Длительность
        </span>
        <span className="workout-auto-pill">Авто</span>
      </div>
      <div className="workout-auto-duration-val">
        <strong>{displayMin}</strong>
        <span>мин</span>
        <small>{detail}</small>
      </div>
    </div>
  );
});

/** Изолированный живой таймер тренировки в шапке — тикает сам, не перерисовывая список упражнений. */
export const WorkoutLiveClock = memo(function WorkoutLiveClock({
  draft,
  manualClock,
  saving,
  onTogglePause,
}: {
  draft: Draft;
  manualClock: boolean;
  saving: boolean;
  onTogglePause: () => void;
}) {
  const running = !manualClock && draft.clock.runningSince !== null;
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!running) return;
    const sync = () => setNow(Date.now());
    const id = setInterval(sync, 1000);
    const onVis = () => {
      if (document.visibilityState === "visible") sync();
    };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", sync);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", sync);
    };
  }, [running]);

  const valueText = manualClock
    ? `${draft.workout.duration} мин`
    : formatWorkoutClock(Math.floor(elapsedMs(draft, now) / 1000));
  const labelText = manualClock
    ? "Длительность"
    : draft.clock.runningSince === null
      ? "Счётчик · пауза"
      : "Счётчик";

  const content = (
    <>
      <b>
        <span
          aria-hidden="true"
          className={`live-rec-dot ${running ? "recording" : "paused"}`}
        />
        {valueText}
        {!draft.editing && !manualClock ? (
          <span className="clock-action-icon" aria-hidden="true">
            {running ? <Pause size={12} /> : <Play size={12} />}
          </span>
        ) : null}
      </b>
      <span className="hud-label">{labelText}</span>
    </>
  );

  if (draft.editing || manualClock) {
    return <span className="live-clock-badge">{content}</span>;
  }

  return (
    <button
      type="button"
      className="live-clock-badge is-interactive"
      disabled={saving}
      aria-label={
        running
          ? "Пауза таймера тренировки"
          : "Возобновить таймер тренировки"
      }
      title={running ? "Нажми, чтобы поставить на паузу" : "Нажми, чтобы продолжить таймер"}
      onClick={onTogglePause}
    >
      {content}
    </button>
  );
});
