import { m } from "motion/react";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import AnimatedNumber from "./AnimatedNumber";

type Metric = { label: string; value: number; previous: number; unit?: string; decimals?: number };

const EASE = [0.22, 1, 0.36, 1] as const;
const R = 44;
const LENGTH = 2 * Math.PI * R;

function Delta({ value, previous, decimals = 0 }: { value: number; previous: number; decimals?: number }) {
  const diff = Math.round((value - previous) * 10 ** decimals) / 10 ** decimals;
  const Icon = diff > 0 ? ArrowUpRight : diff < 0 ? ArrowDownRight : Minus;
  return (
    <small className={`delta ${diff > 0 ? "up" : diff < 0 ? "down" : ""}`}>
      <Icon size={13} aria-hidden="true" />
      {diff === 0 ? "как на прошлой" : `${diff > 0 ? "+" : "−"}${Math.abs(diff).toLocaleString("ru-RU")} к прошлой`}
    </small>
  );
}

/** Сводка недели: кольцо покрытия целей и три показателя со сравнением с прошлой неделей. */
export default function ProgressSummary({ coverage, metrics }: { coverage: number; metrics: Metric[] }) {
  const clamped = Math.max(0, Math.min(100, coverage));
  return (
    <section className="progress-summary" aria-label="Сводка недели">
      <div className="coverage-ring">
        <svg viewBox="0 0 100 100" aria-hidden="true">
          <circle cx="50" cy="50" r={R} className="ring-bg" />
          <m.circle
            cx="50"
            cy="50"
            r={R}
            className="ring-fg"
            strokeDasharray={LENGTH}
            initial={{ strokeDashoffset: LENGTH }}
            animate={{ strokeDashoffset: LENGTH * (1 - clamped / 100) }}
            transition={{ duration: 1.1, ease: EASE }}
          />
        </svg>
        <div>
          <b>
            <AnimatedNumber value={clamped} />
            <small>%</small>
          </b>
          <span>целей недели</span>
        </div>
      </div>
      <div className="summary-metrics">
        {metrics.map((metric, i) => (
          <m.div
            key={metric.label}
            className="summary-metric"
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.12 + i * 0.08, ease: EASE }}
          >
            <span>{metric.label}</span>
            <b>
              <AnimatedNumber value={metric.value} decimals={metric.decimals ?? 0} />
              {metric.unit ? <small>{metric.unit}</small> : null}
            </b>
            <Delta value={metric.value} previous={metric.previous} decimals={metric.decimals ?? 0} />
          </m.div>
        ))}
      </div>
    </section>
  );
}
