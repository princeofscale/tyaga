import { useEffect, useRef, useState } from "react";
import { m, useReducedMotion } from "motion/react";
import { ProgressSeries, type ChartPoint } from "../domain/ProgressSeries";
import { fmt, dateLabel } from "../lib/model";

/** Fixed-height responsive plot with an in-flow readout and keyboard/touch point selection. */
export default function ProgressChart({
  points,
  unit,
  label,
  goal,
}: {
  points: ChartPoint[];
  unit: string;
  label: string;
  goal?: number | null;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600),
    [selected, setSelected] = useState<string | null>(null);
  const reduced = useReducedMotion();
  useEffect(() => {
    if (!box.current) return;
    const observer = new ResizeObserver(([e]) =>
      setWidth(Math.max(240, e.contentRect.width)),
    );
    observer.observe(box.current);
    return () => observer.disconnect();
  }, []);
  const g = ProgressSeries.geometry(points, width);
  const active = g.coords.find((p) => p.id === selected) ?? g.coords.at(-1);
  const hasTrend = points.every((p) => p.trend !== undefined);
  return (
    <div className="progress-chart" ref={box}>
      {!active ? (
        <div className="progress-chart-empty">За этот период замеров нет</div>
      ) : (
        <>
          <div className="progress-chart-readout" aria-live="polite">
            <div>
              <span>{dateLabel(active.date, true)}</span>
              <strong>
                {fmt(active.value)} <small>{unit}</small>
              </strong>
            </div>
            <div>
              <span>{hasTrend ? "Сглаженный вес" : "Результат подхода"}</span>
              <b>
                {hasTrend ? `${fmt(active.trend!)} ${unit}` : active.detail}
              </b>
            </div>
          </div>
          <svg
            viewBox={`0 0 ${width} 230`}
            role="img"
            aria-label={label}
            style={{ width: "100%", height: 230 }}
          >
            {g.ticks.map((v, i) => (
              <g key={i}>
                <line
                  x1={g.left}
                  x2={g.right}
                  y1={g.y(v)}
                  y2={g.y(v)}
                  className="progress-chart-grid"
                />
                <text
                  x={g.left - 9}
                  y={g.y(v) + 4}
                  textAnchor="end"
                  className="progress-chart-axis"
                >
                  {fmt(Math.round(v * 10) / 10)}
                </text>
              </g>
            ))}
            {goal != null && goal >= g.min && goal <= g.max && (
              <line
                x1={g.left}
                x2={g.right}
                y1={g.y(goal)}
                y2={g.y(goal)}
                className="progress-chart-goal"
              />
            )}
            {points.length > 1 && (
              <m.path
                key={points.map((p) => p.id).join()}
                d={g.path()}
                fill="none"
                stroke="var(--accent)"
                strokeWidth="2.5"
                initial={reduced ? false : { pathLength: 0 }}
                animate={{ pathLength: 1 }}
                transition={{ duration: 0.5 }}
              />
            )}
            {hasTrend && points.length > 1 && (
              <path
                d={g.path(true)}
                fill="none"
                stroke="var(--muted)"
                strokeWidth="1.5"
                strokeDasharray="5 5"
                opacity="0.8"
              />
            )}
            {g.coords.map((p) => (
              <g key={p.id} onClick={() => setSelected(p.id)}>
                <circle
                  cx={p.x}
                  cy={p.y}
                  r={active.id === p.id ? 5 : 3.5}
                  fill={active.id === p.id ? "var(--text)" : "var(--accent)"}
                />
                <circle
                  cx={p.x}
                  cy={p.y}
                  r={18}
                  fill="transparent"
                  style={{ cursor: "pointer" }}
                />
              </g>
            ))}
            <text
              x={g.coords[0].x}
              y={222}
              textAnchor={
                points[0].date === points.at(-1)!.date ? "middle" : "start"
              }
              className="progress-chart-axis"
            >
              {dateLabel(points[0].date)}
            </text>
            {points[0].date !== points.at(-1)!.date && (
              <text
                x={g.coords.at(-1)!.x}
                y={222}
                textAnchor="end"
                className="progress-chart-axis"
              >
                {dateLabel(points.at(-1)!.date)}
              </text>
            )}
          </svg>
          <div className="progress-chart-foot">
            <span>
              {hasTrend
                ? "● Взвешивания — сплошная · EMA — пунктир"
                : "Лучший рабочий подход за тренировку"}
            </span>
            <label>
              Выбрать запись
              <select
                aria-label="Выбрать запись"
                value={active.id}
                onChange={(e) => setSelected(e.target.value)}
              >
                {points.map((p) => (
                  <option key={p.id} value={p.id}>
                    {dateLabel(p.date)} · {fmt(p.value)} {unit}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {active.note && <p className="progress-chart-note">{active.note}</p>}
          {goal != null && (goal < g.min || goal > g.max) && (
            <p className="tiny">
              Цель {fmt(goal)} {unit} — вне диапазона замеров. Масштаб
              показывает изменение веса.
            </p>
          )}
        </>
      )}
    </div>
  );
}
