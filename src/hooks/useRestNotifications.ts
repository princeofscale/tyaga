import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import type { Draft } from "../lib/draft";
import { restTimerService } from "../services/RestTimerService";
import { RestTimerAction } from "../domain/RestTimerAction";
export function useRestNotifications(
  accountId: string,
  draft: Draft | null,
  setDraft: Dispatch<SetStateAction<Draft | null>>,
  open: () => void,
  inWorkout: boolean,
) {
  const [ready, setReady] = useState(false),
    [error, setError] = useState("");
  const [focus, setFocus] = useState<{
    exerciseId: string;
    setId: string;
    id: string;
  } | null>(null);
  const openRef = useRef(open);
  openRef.current = open;
  const workoutId = useRef(draft?.workout.id);
  workoutId.current = draft?.workout.id;
  useEffect(() => {
    let alive = true,
      generation = 0;
    const read = async () => {
      const request = ++generation;
      setReady(false);
      try {
        const state = await restTimerService.read();
        if (!alive || request !== generation) return;
        const action = state.action;
        if (action) {
          if (
            action.accountId === accountId &&
            action.workoutId === workoutId.current
          ) {
            setDraft((d) => RestTimerAction.apply(d, accountId, action));
            if (action.type === "open") {
              openRef.current();
              if (action.exerciseId && action.setId)
                setFocus({
                  exerciseId: action.exerciseId,
                  setId: action.setId,
                  id: action.id,
                });
            }
          }
          await restTimerService.acknowledge(action.id);
        }
        if (alive) setError("");
      } catch (e) {
        if (alive)
          setError(
            e instanceof Error
              ? e.message
              : "Не удалось прочитать таймер телефона",
          );
      } finally {
        if (alive && request === generation) setReady(true);
      }
    };
    const visible = () => {
      if (document.visibilityState === "visible") void read();
    };
    void read();
    const listener = restTimerService.listen(() => void read());
    document.addEventListener("visibilitychange", visible);
    window.addEventListener("tyaga:rest-settings", visible);
    return () => {
      alive = false;
      ++generation;
      void listener.then((h) => h.remove()).catch(() => {});
      document.removeEventListener("visibilitychange", visible);
      window.removeEventListener("tyaga:rest-settings", visible);
    };
  }, [accountId, setDraft]);
  useEffect(() => {
    if (!ready) return;
    void restTimerService
      .sync({
        inWorkout,
        accountId,
        workoutId: draft?.workout.id ?? "",
        until: draft?.pausedRest === null ? draft.restUntil : null,
        exerciseId: draft?.restFocus?.exerciseId,
        setId: draft?.restFocus?.setId,
      })
      .catch((e) =>
        setError(
          e instanceof Error
            ? e.message
            : "Не удалось включить уведомление отдыха",
        ),
      );
  }, [
    ready,
    inWorkout,
    accountId,
    draft?.workout.id,
    draft?.restUntil,
    draft?.pausedRest,
    draft?.restFocus?.exerciseId,
    draft?.restFocus?.setId,
  ]);
  return { focus, error };
}
