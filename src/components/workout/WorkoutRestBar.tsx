import { memo, useEffect, useRef, useState } from "react";
import { m } from "motion/react";
import { Pause, Play, X } from "lucide-react";
import { audioHaptics } from "../../lib/audioHaptics";
import type { Draft } from "../../lib/draft";
import { formatWorkoutClock } from "./formatWorkoutClock";

/** Изолированный таймер отдыха внизу экрана — тикает только пока идёт отдых. */
export const WorkoutRestBar = memo(function WorkoutRestBar({
  draft,
  restSeconds,
  restLabel,
  soundEnabled,
  reducedMotion,
  onShift,
  onTogglePause,
  onSkip,
  onAnnounce,
}: {
  draft: Draft;
  restSeconds: number;
  restLabel?: string | null;
  soundEnabled: boolean;
  reducedMotion: boolean | null;
  onShift: (seconds: number) => void;
  onTogglePause: (remaining: number) => void;
  onSkip: () => void;
  onAnnounce: (text: string) => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  const announcedTimer = useRef<number | null>(null);
  const lastTickSecond = useRef<number | null>(null);
  const activeCountdown = draft.pausedRest === null && draft.restUntil !== null;

  useEffect(() => {
    if (!activeCountdown) return;
    const sync = () => setNow(Date.now());
    sync();
    const id = setInterval(sync, 500);
    const onVis = () => {
      if (document.visibilityState === "visible") sync();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [activeCountdown, draft.restUntil]);

  const remaining =
    draft.pausedRest ??
    (draft.restUntil
      ? Math.max(0, Math.ceil((draft.restUntil - now) / 1000))
      : 0);

  useEffect(() => {
    if (
      draft.restUntil &&
      draft.pausedRest === null &&
      draft.restUntil <= now &&
      announcedTimer.current !== draft.restUntil
    ) {
      announcedTimer.current = draft.restUntil;
      onAnnounce("Отдых завершён");
      if (soundEnabled) audioHaptics.playTimerAlert();
    } else if (remaining > 0) {
      onAnnounce("");
      if (remaining <= 3 && soundEnabled && lastTickSecond.current !== remaining) {
        lastTickSecond.current = remaining;
        audioHaptics.playCountdownTick();
      }
    }
  }, [draft.restUntil, draft.pausedRest, now, remaining, soundEnabled, onAnnounce]);

  if (!(remaining > 0 || draft.pausedRest !== null)) return null;

  return (
    <m.section
      className="rest-bar"
      aria-label="Таймер отдыха"
      data-paused={draft.pausedRest !== null}
      initial={reducedMotion ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: reducedMotion ? 0 : 0.16, ease: "easeOut" }}
    >
      <div className="rest-progress">
        <span
          style={{
            transform: `scaleX(${Math.min(1, remaining / Math.max(restSeconds, remaining, 1))})`,
          }}
        />
      </div>
      <div className="rest-body">
        <div className="rest-copy">
          <span>
            {draft.pausedRest !== null
              ? "Отдых на паузе"
              : restLabel || "Отдых"}
          </span>
          <span className="rest-digits active" aria-live="off">
            {formatWorkoutClock(remaining)}
          </span>
        </div>
        <button type="button" aria-label="Минус 15 секунд" onClick={() => onShift(-15)}>
          −15
        </button>
        <button
          type="button"
          className="timer-plus"
          aria-label="Плюс 30 секунд"
          onClick={() => onShift(30)}
        >
          +30
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label={
            draft.pausedRest !== null
              ? "Продолжить таймер"
              : "Приостановить таймер"
          }
          onClick={() => onTogglePause(remaining)}
        >
          {draft.pausedRest !== null ? <Play size={20} /> : <Pause size={20} />}
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label="Пропустить отдых"
          onClick={onSkip}
        >
          <X size={20} />
        </button>
      </div>
    </m.section>
  );
});
