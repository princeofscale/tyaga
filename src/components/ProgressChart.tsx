import { useEffect, useId, useRef, useState } from "react";
import { m, useReducedMotion } from "motion/react";
import { ProgressSeries, type ChartPoint } from "../domain/ProgressSeries";
import { fmt } from "../lib/model";
import { DateText } from "../domain/DateText";

/** Fixed-height responsive plot with area gradient, crosshair readout and keyboard/touch selection. */
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
  const gradId = useId();
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
  const areaPath =
    g.coords.length > 1
      ? `${g.path()} L ${g.coords.at(-1)!.x} 196 L ${g.coords[0].x} 196 Z`
      : "";

  return (
    <div className="progress-chart" ref={box}>
      {!active ? (
        <div className="progress-chart-empty">За этот период замеров нет</div>
      ) : (
        <>
          <div className="progress-chart-readout" aria-live="polite">
            <div>
              <span>{DateText.day(active.date)}</span>
              <strong>
                {fmt(active.value)} <small>{unit}</small>
              </strong>
            </div>
            <div>
              <span>{hasTrend ? "Сглаженный вес (EMA)" : "Лучший подход"}</span>
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
            <defs>
              <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.22" />
                <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
              </linearGradient>
            </defs>
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
            {areaPath && (
              <m.path
                key={`area-${points.map((p) => p.id).join()}`}
                d={areaPath}
                fill={`url(#${gradId})`}
                className="progress-chart-area"
                initial={reduced ? false : { opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.45 }}
              />
            )}
            {points.length > 1 && (
              <m.path
                key={points.map((p) => p.id).join()}
                d={g.path()}
                fill="none"
                stroke="var(--accent)"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                initial={reduced ? false : { pathLength: 0 }}
                animate={{ pathLength: 1 }}
                transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
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
            <line
              x1={active.x}
              x2={active.x}
              y1={active.y}
              y2={196}
              className="progress-chart-guide"
            />
            {g.coords.map((p) => {
              const isSelected = active.id === p.id;
              return (
                <g key={p.id} onClick={() => setSelected(p.id)}>
                  {isSelected && (
                    <circle
                      cx={p.x}
                      cy={p.y}
                      r={10}
                      className="progress-chart-halo"
                    />
                  )}
                  <circle
                    cx={p.x}
                    cy={p.y}
                    r={isSelected ? 5 : 3.5}
                    fill={isSelected ? "var(--text)" : "var(--accent)"}
                    stroke={isSelected ? "var(--accent)" : "none"}
                    strokeWidth={isSelected ? 2 : 0}
                  />
                  <circle
                    cx={p.x}
                    cy={p.y}
                    r={18}
                    fill="transparent"
                    style={{ cursor: "pointer" }}
                  />
                </g>
              );
            })}
            <text
              x={g.coords[0].x}
              y={222}
              textAnchor={
                points[0].date === points.at(-1)!.date ? "middle" : "start"
              }
              className="progress-chart-axis"
            >
              {DateText.day(points[0].date)}
            </text>
            {points[0].date !== points.at(-1)!.date && (
              <text
                x={g.coords.at(-1)!.x}
                y={222}
                textAnchor="end"
                className="progress-chart-axis"
              >
                {DateText.day(points.at(-1)!.date)}
              </text>
            )}
          </svg>
          <div className="progress-chart-foot">
            <span>
              {hasTrend
                ? "● Замеры · --- EMA"
                : "Лучший подход в тренировке"}
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
                    {DateText.day(p.date)} · {fmt(p.value)} {unit}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {active.note && <p className="progress-chart-note">{active.note}</p>}
          {goal != null && (goal < g.min || goal > g.max) && (
            <p className="tiny">Цель {fmt(goal)} {unit} вне диапазона графика.</p>
          )}
        </>
      )}
    </div>
  );
}
