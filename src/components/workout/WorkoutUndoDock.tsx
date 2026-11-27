import type { RefObject } from "react";
import { AnimatePresence, m } from "motion/react";
import { RotateCcw, Trash2, X } from "lucide-react";
import { WorkoutUndo } from "../../domain/WorkoutUndo";
import type { Draft } from "../../lib/draft";
import { WorkoutRestBar } from "./WorkoutRestBar";

type Props = {
  dockRef: RefObject<HTMLDivElement | null>;
  draft: Draft;
  removalKey: string;
  restSeconds: number;
  restLabel?: string | null;
  soundEnabled: boolean;
  reducedMotion: boolean | null;
  toastPaused: boolean;
  setToastPaused: (paused: boolean) => void;
  onUpdate: (draft: Draft) => void;
  onUndoError: (msg: string) => void;
  onShiftRest: (seconds: number) => void;
  onAnnounce: (text: string) => void;
};

/** Одна нижняя стопка: «Отменить удаление» и таймер отдыха идут друг под другом в одном липком блоке. */
export function WorkoutUndoDock({
  dockRef,
  draft,
  removalKey,
  restSeconds,
  restLabel,
  soundEnabled,
  reducedMotion,
  toastPaused,
  setToastPaused,
  onUpdate,
  onUndoError,
  onShiftRest,
  onAnnounce,
}: Props) {
  const lastRemoval = draft.removals?.at(-1);

  return (
    <div className="workout-dock" ref={dockRef}>
      <div className="workout-toast-region" role="region" aria-label="Уведомления тренировки">
        <AnimatePresence initial={false}>
          {lastRemoval ? (
            <m.div
              className={`workout-undo${toastPaused ? " is-paused" : ""}`}
              key={removalKey}
              initial={reducedMotion ? false : { opacity: 0, y: 12, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={reducedMotion ? undefined : { opacity: 0, y: 10, scale: 0.97 }}
              transition={{ type: "spring", stiffness: 460, damping: 34 }}
              role="status"
              onMouseEnter={() => setToastPaused(true)}
              onMouseLeave={() => setToastPaused(false)}
              onFocusCapture={() => setToastPaused(true)}
              onBlurCapture={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
                  setToastPaused(false);
                }
              }}
            >
              <span className="workout-undo-icon" aria-hidden="true">
                <Trash2 size={16} />
              </span>
              <div className="workout-undo-copy">
                <strong className="workout-undo-title">
                  {lastRemoval.kind === "set" ? "Подход удалён" : "Упражнение убрано"}
                </strong>
                <span className="workout-undo-sub">
                  {draft.removals!.length > 1
                    ? `В очереди ещё ${draft.removals!.length - 1} · можно вернуть`
                    : "Исчезнет через 3 с · можно вернуть"}
                </span>
              </div>
              <div className="workout-undo-actions">
                <button
                  type="button"
                  className="workout-undo-btn"
                  aria-label="Отменить удаление"
                  onClick={() => {
                    try {
                      setToastPaused(false);
                      onUpdate(WorkoutUndo.restore(draft));
                      onUndoError("");
                    } catch (e) {
                      onUndoError((e as Error).message);
                    }
                  }}
                >
                  <RotateCcw size={15} aria-hidden="true" />
                  <span>Вернуть</span>
                </button>
                <button
                  type="button"
                  className="workout-undo-close"
                  aria-label="Скрыть уведомление"
                  onClick={() => {
                    setToastPaused(false);
                    onUpdate({ ...draft, removals: [] });
                  }}
                >
                  <X size={15} aria-hidden="true" />
                </button>
              </div>
              <span className="workout-undo-timer" aria-hidden="true" />
            </m.div>
          ) : null}
        </AnimatePresence>
      </div>
      <WorkoutRestBar
        draft={draft}
        restSeconds={restSeconds}
        restLabel={restLabel}
        soundEnabled={soundEnabled}
        reducedMotion={reducedMotion}
        onShift={onShiftRest}
        onTogglePause={(rem) =>
          onUpdate(
            draft.pausedRest !== null
              ? {
                  ...draft,
                  restUntil: Date.now() + draft.pausedRest * 1000,
                  pausedRest: null,
                }
              : { ...draft, pausedRest: rem, restUntil: null },
          )
        }
        onSkip={() => onUpdate({ ...draft, restUntil: null, pausedRest: null })}
        onAnnounce={onAnnounce}
      />
    </div>
  );
}
