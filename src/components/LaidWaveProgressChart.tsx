import { useMemo, useState } from "react";
import { TrendingUp } from "lucide-react";
import { LaidDupPlan, type LaidLift, type LaidWaveLiftProgress } from "../domain/LaidDupPlan";

type Props = {
  series: LaidWaveLiftProgress[];
  currentWeekIndex: number;
};

const W = 360;
const H = 162;
const PAD_L = 38;
const PAD_R = 14;
const PAD_T = 22;
const PAD_B = 26;
const PLOT_W = W - PAD_L - PAD_R;
const PLOT_H = H - PAD_T - PAD_B;

/** График прогресса по волнам (1 → 2 → 3) внутри цикла David Laid DUP: плановый пик и фактический e1RM. */
export default function LaidWaveProgressChart({ series, currentWeekIndex }: Props) {
  const defaultLift = useMemo<LaidLift>(() => {
    const withData = series.find((s) => s.bestE1rm !== null);
    return withData?.lift ?? series[0]?.lift ?? "squat";
  }, [series]);
  const [selectedLift, setSelectedLift] = useState<LaidLift>(defaultLift);

  const active = series.find((s) => s.lift === selectedLift) ?? series[0];
  if (!active) return null;

  const weeks = active.weeks;
  const count = Math.max(1, weeks.length);
  const allValues = [
    active.startMaxKg,
    ...weeks.map((w) => w.plannedTopKg),
    ...weeks.map((w) => w.actualE1rm),
  ].filter((v): v is number => v !== null && v > 0);

  const minRaw = allValues.length ? Math.min(...allValues) : 40;
  const maxRaw = allValues.length ? Math.max(...allValues) : 100;
  const pad = Math.max(5, (maxRaw - minRaw) * 0.18);
  const yMin = Math.max(0, Math.floor((minRaw - pad) / 5) * 5);
  const yMax = Math.ceil((maxRaw + pad) / 5) * 5;
  const ySpan = Math.max(5, yMax - yMin);

  const xOf = (idx: number) =>
    count === 1 ? PAD_L + PLOT_W / 2 : PAD_L + (idx / (count - 1)) * PLOT_W;
  const yOf = (val: number) => PAD_T + PLOT_H - ((val - yMin) / ySpan) * PLOT_H;

  const plannedPts = weeks
    .map((w, idx) => (w.plannedTopKg !== null ? { idx, x: xOf(idx), y: yOf(w.plannedTopKg), val: w.plannedTopKg, week: w } : null))
    .filter((p): p is NonNullable<typeof p> => p !== null);

  const actualPts = weeks
    .map((w, idx) => (w.actualE1rm !== null ? { idx, x: xOf(idx), y: yOf(w.actualE1rm), val: w.actualE1rm, week: w } : null))
    .filter((p): p is NonNullable<typeof p> => p !== null);

  const plannedPath = plannedPts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const actualPath = actualPts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");

  const waveBands = ([1, 2, 3] as const)
    .map((wave) => {
      const idxs = weeks
        .map((w, i) => (w.wave === wave && !w.isDeload ? i : -1))
        .filter((i) => i >= 0);
      if (!idxs.length) return null;
      const firstIdx = idxs[0];
      const lastIdx = idxs[idxs.length - 1];
      const halfStep = count > 1 ? PLOT_W / (count - 1) / 2 : PLOT_W / 2;
      const x1 = Math.max(PAD_L, xOf(firstIdx) - halfStep);
      const x2 = Math.min(PAD_L + PLOT_W, xOf(lastIdx) + halfStep);
      return { wave, x1, width: Math.max(0, x2 - x1), cx: (x1 + x2) / 2 };
    })
    .filter((b): b is NonNullable<typeof b> => b !== null);

  const yTicks = [yMin, Math.round((yMin + yMax) / 2), yMax];
  const baseLineY = yOf(active.startMaxKg);

  return (
    <section className="laid-wave-chart" aria-label="График прогресса по волнам">
      <div className="laid-wave-chart-head">
        <div className="laid-wave-chart-title">
          <TrendingUp size={15} aria-hidden="true" />
          <b>Прогресс по волнам</b>
        </div>
        <div className="laid-wave-lift-tabs" role="group" aria-label="Выбор базового упражнения">
          {series.map((item) => {
            const isSelected = item.lift === active.lift;
            return (
              <button
                key={item.lift}
                type="button"
                className={`laid-wave-lift-btn${isSelected ? " active" : ""}`}
                aria-pressed={isSelected}
                onClick={() => setSelectedLift(item.lift)}
              >
                {item.name}
              </button>
            );
          })}
        </div>
      </div>

      <div className="laid-wave-kpis">
        <div className="laid-wave-kpi">
          <span>Старт ТМ</span>
          <b>{LaidDupPlan.kg(active.startMaxKg)} кг</b>
        </div>
        <div className="laid-wave-kpi">
          <span>Пик плана</span>
          <b>{active.plannedPeakKg !== null ? `${LaidDupPlan.kg(active.plannedPeakKg)} кг` : "—"}</b>
        </div>
        <div className="laid-wave-kpi">
          <span>Лучший e1RM</span>
          <b>{active.bestE1rm !== null ? `${LaidDupPlan.kg(active.bestE1rm)} кг` : "нет записей"}</b>
        </div>
        <div className="laid-wave-kpi">
          <span>Динамика</span>
          <b className={active.deltaKg !== null ? (active.deltaKg >= 0 ? "is-pos" : "is-neg") : undefined}>
            {active.deltaKg !== null
              ? `${active.deltaKg >= 0 ? "+" : ""}${LaidDupPlan.kg(active.deltaKg)} кг`
              : "—"}
          </b>
        </div>
      </div>

      <div className="laid-wave-svg-wrap">
        <svg
          className="laid-wave-svg"
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label={`Прогресс ${active.name} по неделям и волнам`}
        >
          {/* Wave bands */}
          {waveBands.map((band) => (
            <g key={band.wave}>
              <rect
                x={band.x1}
                y={PAD_T}
                width={band.width}
                height={PLOT_H}
                className={`laid-wave-band wave-${band.wave}`}
              />
              <text x={band.cx} y={PAD_T - 7} textAnchor="middle" className="laid-wave-band-label">
                В{band.wave}
              </text>
            </g>
          ))}

          {/* Horizontal grid & Y labels */}
          {yTicks.map((tick) => {
            const y = yOf(tick);
            return (
              <g key={tick}>
                <line x1={PAD_L} y1={y} x2={W - PAD_R} y2={y} className="laid-wave-grid" />
                <text x={PAD_L - 6} y={y + 3.5} textAnchor="end" className="laid-wave-axis">
                  {tick}
                </text>
              </g>
            );
          })}

          {/* Baseline Start TM */}
          <line
            x1={PAD_L}
            y1={baseLineY}
            x2={W - PAD_R}
            y2={baseLineY}
            className="laid-wave-baseline"
          />

          {/* Current week vertical marker */}
          {currentWeekIndex >= 0 && currentWeekIndex < count ? (
            <line
              x1={xOf(currentWeekIndex)}
              y1={PAD_T}
              x2={xOf(currentWeekIndex)}
              y2={PAD_T + PLOT_H}
              className="laid-wave-now-line"
            />
          ) : null}

          {/* Planned top set curve */}
          {plannedPts.length > 1 ? (
            <path d={plannedPath} fill="none" className="laid-wave-line-plan" />
          ) : null}
          {plannedPts.map((p) => (
            <circle
              key={`plan-${p.idx}`}
              cx={p.x}
              cy={p.y}
              r={p.week.isDeload ? 2.5 : 3.2}
              className="laid-wave-dot-plan"
            >
              <title>{`Неделя ${p.week.weekNumber}: план ${LaidDupPlan.kg(p.val)} кг`}</title>
            </circle>
          ))}

          {/* Actual e1RM curve */}
          {actualPts.length > 1 ? (
            <path d={actualPath} fill="none" className="laid-wave-line-actual" />
          ) : null}
          {actualPts.map((p) => (
            <g key={`act-${p.idx}`}>
              <circle cx={p.x} cy={p.y} r={4.2} className="laid-wave-dot-actual">
                <title>{`Неделя ${p.week.weekNumber}: факт e1RM ${LaidDupPlan.kg(p.val)} кг`}</title>
              </circle>
              <text
                x={p.x}
                y={Math.max(PAD_T + 10, p.y - 8)}
                textAnchor="middle"
                className="laid-wave-val-label"
              >
                {LaidDupPlan.kg(p.val)}
              </text>
            </g>
          ))}

          {/* Week X labels */}
          {weeks.map((w, idx) => (
            <text
              key={`x-${w.week}`}
              x={xOf(idx)}
              y={H - 8}
              textAnchor="middle"
              className={`laid-wave-axis${idx === currentWeekIndex ? " is-now" : ""}`}
            >
              {w.isDeload ? "Р" : `Н${w.weekNumber}`}
            </text>
          ))}
        </svg>
      </div>

      <div className="laid-wave-legend">
        <span>
          <i className="swatch-plan" aria-hidden="true" />
          План (тяжёлый подход)
        </span>
        <span>
          <i className="swatch-actual" aria-hidden="true" />
          Факт (лучший e1RM)
        </span>
        <span>
          <i className="swatch-tm" aria-hidden="true" />
          Старт ТМ
        </span>
      </div>

      <div className="laid-wave-cards">
        {active.waves.map((w) => (
          <div key={w.wave} className="laid-wave-summary-tile">
            <span className="laid-wave-summary-head">
              <b>Волна {w.wave}</b>
              <small>{w.title}</small>
            </span>
            <div className="laid-wave-summary-vals">
              <span>План до {w.plannedPeakKg !== null ? `${LaidDupPlan.kg(w.plannedPeakKg)} кг` : "—"}</span>
              <b className={w.bestE1rm !== null ? "has-data" : undefined}>
                {w.bestE1rm !== null ? `e1RM ${LaidDupPlan.kg(w.bestE1rm)} кг` : "Нет записей"}
              </b>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
