import { useEffect, useState } from "react";

/**
 * Текущее время для интерфейса. Пока `active`, компонент перерисовывается каждые `step` мс
 * (обратный отсчёт отдыха); иначе — только вместе с остальными обновлениями, но время всегда свежее.
 */
export function useNow(active: boolean, step = 1000) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => tick((n) => n + 1), step);
    return () => window.clearInterval(id);
  }, [active, step]);
  return Date.now();
}

/**
 * Живой объект Date для расчёта недавней нагрузки и смены суток:
 * обновляется по интервалу и сразу при возврате вкладки в фокус.
 */
export function useLiveClock(stepMs = 60_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const sync = () => setNow(new Date());
    const id = window.setInterval(sync, stepMs);
    const onVisibility = () => {
      if (document.visibilityState === "visible") sync();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", sync);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", sync);
    };
  }, [stepMs]);
  return now;
}

/**
 * Счётчик ревизии для клиентских хранилищ (localStorage), обновляющийся при
 * custom window-событиях (например, смена профиля биомеханики или болей).
 */
export function useStorageRevision(events: readonly string[]): number {
  const [rev, setRev] = useState(0);
  const key = events.join("|");
  useEffect(() => {
    const list = key ? key.split("|") : [];
    if (!list.length) return;
    const bump = () => setRev((n) => n + 1);
    for (const ev of list) window.addEventListener(ev, bump);
    return () => {
      for (const ev of list) window.removeEventListener(ev, bump);
    };
  }, [key]);
  return rev;
}
