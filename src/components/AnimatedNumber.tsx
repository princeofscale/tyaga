import { useEffect, useRef, useState } from "react";
import { animate, useReducedMotion } from "motion/react";

/** Число, которое «докручивается» от прежнего значения к новому. */
export default function AnimatedNumber({
  value,
  decimals = 0,
  duration = 0.9,
}: {
  value: number;
  decimals?: number;
  duration?: number;
}) {
  const reduce = useReducedMotion();
  const from = useRef(0);
  const [shown, setShown] = useState(reduce ? value : 0);

  useEffect(() => {
    if (reduce) {
      setShown(value);
      from.current = value;
      return;
    }
    const controls = animate(from.current, value, {
      duration,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: (v) => setShown(v),
      onComplete: () => {
        from.current = value;
      },
    });
    return () => {
      from.current = value;
      controls.stop();
    };
  }, [value, duration, reduce]);

  return <>{new Intl.NumberFormat("ru-RU", { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(shown)}</>;
}
