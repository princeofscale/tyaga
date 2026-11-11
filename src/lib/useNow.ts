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
