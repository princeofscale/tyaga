import { useState } from "react";
import { m } from "motion/react";
import { fmt, dateLabel } from "../lib/model";
import { TrendingUp, Award, Calendar, Layers } from "lucide-react";

export interface StrengthPoint {
  date: string;
  max: number;
  e1rm: number;
  reps: number;
  sets: { weight: number; reps: number; done: boolean; warmup: boolean }[];
}

export default function InteractiveStrengthChart({
  points,
  unit = "кг",
  isDuration = false,
  exerciseName = "",
}: {
  points: StrengthPoint[];
  unit?: string;
  isDuration?: boolean;
  exerciseName?: string;
}) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  if (!points.length) {
    return <div className="chart-empty">Нет данных для графика</div>;
  }

  const values = points.map((p) => p.max);
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const padding = (rawMax - rawMin) * 0.15 || 5;
  const minY = Math.max(0, Math.floor(rawMin - padding));
  const maxY = Math.ceil(rawMax + padding);
  const deltaY = maxY - minY || 1;

  const width = 600;
  const height = 220;
  const padLeft = 45;
  const padRight = 20;
  const padTop = 20;
  const padBottom = 35;
  const chartWidth = width - padLeft - padRight;
  const chartHeight = height - padTop - padBottom;

  const coords = points.map((p, i) => {
    const x =
      points.length === 1
        ? padLeft + chartWidth / 2
        : padLeft + (i / (points.length - 1)) * chartWidth;
    const y = padTop + chartHeight - ((p.max - minY) / deltaY) * chartHeight;
    return { x, y, point: p, index: i };
  });

  const polylinePoints = coords.map((c) => `${c.x},${c.y}`).join(" ");
  const areaPoints = `${coords[0].x},${padTop + chartHeight} ${polylinePoints} ${coords.at(-1)!.x},${padTop + chartHeight}`;

  // Linear regression trendline
  let trendStart = padTop + chartHeight / 2;
  let trendEnd = padTop + chartHeight / 2;
  if (points.length >= 2) {
    const n = points.length;
    let sumX = 0;
    let sumY = 0;
    let sumXY = 0;
    let sumXX = 0;
    for (let i = 0; i < n; i++) {
      sumX += i;
      sumY += points[i].max;
      sumXY += i * points[i].max;
      sumXX += i * i;
    }
    const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX || 1);
    const intercept = (sumY - slope * sumX) / n;
    const y0 = intercept;
    const y1 = intercept + slope * (n - 1);
    trendStart = padTop + chartHeight - ((y0 - minY) / deltaY) * chartHeight;
    trendEnd = padTop + chartHeight - ((y1 - minY) / deltaY) * chartHeight;
  }

  const selectedPoint = hoverIndex !== null ? coords[hoverIndex] : coords.at(-1);

  return (
    <div className="interactive-strength-chart">
      {selectedPoint && (
        <div className="chart-tooltip-badge">
          <div className="tooltip-item date">
            <Calendar size={13} />
            <span>{dateLabel(selectedPoint.point.date, true)}</span>
          </div>
          <div className="tooltip-item weight">
            <b>
              {fmt(selectedPoint.point.max)} {unit}
            </b>
            <small>
              {isDuration
                ? `${selectedPoint.point.reps} с`
                : `× ${selectedPoint.point.reps} повт.`}
            </small>
          </div>
          {selectedPoint.point.e1rm > 0 && !isDuration && (
            <div className="tooltip-item e1rm">
              <Award size={13} />
              <span>1ПМ: ~{fmt(selectedPoint.point.e1rm)} кг</span>
            </div>
          )}
          <div className="tooltip-item sets">
            <Layers size={13} />
            <span>{selectedPoint.point.sets.length} подх.</span>
          </div>
        </div>
      )}

      <svg
        className="strength-svg-chart"
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
          <linearGradient id="chartGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#cafa64" stopOpacity="0.32" />
            <stop offset="100%" stopColor="#cafa64" stopOpacity="0.0" />
          </linearGradient>
          <linearGradient id="lineGlow" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#9dbd68" />
            <stop offset="100%" stopColor="#cafa64" />
          </linearGradient>
        </defs>

        {/* Y-axis grid lines */}
        {[0, 0.5, 1].map((ratio) => {
          const yVal = minY + ratio * deltaY;
          const yPos = padTop + chartHeight - ratio * chartHeight;
          return (
            <g key={ratio} className="chart-grid-row">
              <line
                x1={padLeft}
                y1={yPos}
                x2={width - padRight}
                y2={yPos}
                stroke="rgba(255, 255, 255, 0.08)"
                strokeDasharray="4 4"
              />
              <text
                x={padLeft - 8}
                y={yPos + 4}
                textAnchor="end"
                className="chart-axis-text"
              >
                {fmt(Math.round(yVal))}
              </text>
            </g>
          );
        })}

        {/* Trendline */}
        {points.length >= 3 && (
          <line
            x1={coords[0].x}
            y1={trendStart}
            x2={coords.at(-1)!.x}
            y2={trendEnd}
            stroke="rgba(202, 250, 100, 0.35)"
            strokeWidth="1.5"
            strokeDasharray="6 4"
          />
        )}

        {/* Shaded Area */}
        <m.polygon
          points={areaPoints}
          fill="url(#chartGradient)"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.9, delay: 0.5 }}
        />

        {/* Main Progression Line */}
        <m.polyline
          points={polylinePoints}
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 1.1, ease: [0.22, 1, 0.36, 1] }}
          fill="none"
          stroke="url(#lineGlow)"
          strokeWidth="3.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* Data points */}
        {coords.map((c) => {
          const isSelected = selectedPoint?.index === c.index;
          return (
            <g
              key={c.point.date + c.index}
              className="chart-node"
              onMouseEnter={() => setHoverIndex(c.index)}
              onTouchStart={() => setHoverIndex(c.index)}
              onClick={() => setHoverIndex(c.index)}
              style={{ cursor: "pointer" }}
            >
              <m.circle
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.3, delay: 0.25 + (c.index / Math.max(1, coords.length)) * 0.85 }}
                cx={c.x}
                cy={c.y}
                r={isSelected ? 7 : 4.5}
                fill={isSelected ? "#cafa64" : "#121617"}
                stroke="#cafa64"
                strokeWidth={isSelected ? 3 : 2}
                className="chart-dot"
              />
              {/* Invisible touch target */}
              <circle cx={c.x} cy={c.y} r={18} fill="transparent" />
            </g>
          );
        })}

        {/* X-axis date labels */}
        {points.length > 0 && (
          <>
            <text
              x={coords[0].x}
              y={height - 8}
              textAnchor="start"
              className="chart-axis-text"
            >
              {dateLabel(points[0].date)}
            </text>
            {points.length > 1 && (
              <text
                x={coords.at(-1)!.x}
                y={height - 8}
                textAnchor="end"
                className="chart-axis-text"
              >
                {dateLabel(points.at(-1)!.date)}
              </text>
            )}
          </>
        )}
      </svg>
    </div>
  );
}
