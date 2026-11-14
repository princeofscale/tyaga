import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PendingWorkouts, type PendingItem } from "../domain/PendingWorkouts";
import { api } from "../services/ApiClient";
import type { Workout } from "../lib/types";

const RETRY_MS = 30000;

/**
 * Очередь отправки завершённых тренировок: уходит при возвращении связи (`online`), при возврате в
 * приложение, после успешной загрузки данных и раз в полминуты, пока очередь не пуста.
 */
export function usePendingWorkouts(
  accountId: string,
  onSent: (workout: Workout) => void,
  notify: (text: string) => void,
) {
  const queue = useMemo(() => new PendingWorkouts(undefined, accountId), [accountId]);
  const [items, setItems] = useState<PendingItem[]>(() => queue.list());
  const sync = useCallback(() => setItems(queue.list()), [queue]);
  const busy = useRef(false);
  const callbacks = useRef({ onSent, notify });
  callbacks.current = { onSent, notify };

  /** `manual` — «Отправить сейчас»: повторяет и тренировки, которым сервер раньше отказал. */
  const flush = useCallback(async (manual = false) => {
    if (busy.current) return;
    busy.current = true;
    let sent = 0;
    try {
      for (const item of queue.list()) {
        if (item.error && !manual) continue;
        try {
          const result = await api<{ workout: Workout }>("/api/workouts", "PUT", item.workout);
          queue.remove(item.workout.id);
          callbacks.current.onSent(result.workout);
          sent++;
        } catch (e) {
          if (PendingWorkouts.isRetryable(e) || PendingWorkouts.needsSignIn(e)) break;
          queue.fail(item.workout.id, e instanceof Error ? e.message : "Сервер не принял тренировку");
        }
      }
    } finally {
      busy.current = false;
      sync();
    }
    if (sent) callbacks.current.notify(sent === 1 ? "Тренировка отправлена" : `Отправлено тренировок: ${sent}`);
  }, [queue, sync]);

  const count = items.length;
  useEffect(() => {
    if (!count) return;
    const retry = () => void flush();
    const visible = () => { if (!document.hidden) retry(); };
    window.addEventListener("online", retry);
    document.addEventListener("visibilitychange", visible);
    const timer = window.setInterval(() => { if (!document.hidden) retry(); }, RETRY_MS);
    return () => {
      window.removeEventListener("online", retry);
      document.removeEventListener("visibilitychange", visible);
      window.clearInterval(timer);
    };
  }, [count, flush]);

  const enqueue = useCallback((workout: Workout) => {
    const saved = queue.add(workout);
    sync();
    return saved;
  }, [queue, sync]);

  return { items, ids: useMemo(() => new Set(items.map((i) => i.workout.id)), [items]), enqueue, flush, queue, sync };
}
