import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Compass, Sparkles } from "lucide-react";
import { WeakLinkAnalyzer, type BalanceAxis, type BalanceAxisId } from "../domain/WeakLinkAnalyzer";
import { BiomechanicsProfileStore } from "../domain/BiomechanicsProfile";
import { exerciseById, fmt, type Workout } from "../lib/model";

const RADAR_SIZE = 260;
const CX = RADAR_SIZE / 2;
const CY = RADAR_SIZE / 2;
const MAX_R = 86;

function polar(index: number, total: number, radius: number): [number, number] {
  const angle = -Math.PI / 2 + (index * 2 * Math.PI) / total;
  return [CX + Math.cos(angle) * radius, CY + Math.sin(angle) * radius];
}

function polygonPoints(radii: number[]): string {
  const n = radii.length;
  return radii
    .map((r, i) => {
      const [x, y] = polar(i, n, r);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

function RadarSvg({
  axes,
  selectedId,
  onSelect,
}: {
  axes: BalanceAxis[];
  selectedId: BalanceAxisId;
  onSelect: (id: BalanceAxisId) => void;
}) {
  const n = axes.length;
  const rings = [0.4, 0.7, 1.0];
  const dataRadii = axes.map((a) => (a.status === "missing" ? MAX_R * 0.14 : (a.score / 100) * MAX_R));

  return (
    <svg
      className="wl-radar-svg"
      viewBox={`0 0 ${RADAR_SIZE} ${RADAR_SIZE}`}
      role="img"
      aria-label="Радар биомеханических пропорций силы"
    >
      {/* Оптимальная зона 85–100% */}
      <polygon
        points={polygonPoints(Array(n).fill(MAX_R))}
        className="wl-radar-optimal-outer"
      />
      <polygon
        points={polygonPoints(Array(n).fill(MAX_R * 0.84))}
        className="wl-radar-optimal-inner"
      />

      {/* Концентрическая сетка */}
      {rings.map((frac) => (
        <polygon
          key={frac}
          points={polygonPoints(Array(n).fill(MAX_R * frac))}
          className="wl-radar-ring"
          fill="none"
        />
      ))}

      {/* Оси */}
      {axes.map((axis, i) => {
        const [x, y] = polar(i, n, MAX_R);
        return (
          <line
            key={axis.id}
            x1={CX}
            y1={CY}
            x2={x}
            y2={y}
            className={`wl-radar-spoke${axis.id === selectedId ? " is-active" : ""}`}
          />
        );
      })}

      {/* Полигон атлета */}
      <polygon points={polygonPoints(dataRadii)} className="wl-radar-area" />

      {/* Вершины и подписи */}
      {axes.map((axis, i) => {
        const [vx, vy] = polar(i, n, dataRadii[i]);
        const [lx, ly] = polar(i, n, MAX_R + 22);
        const anchor = Math.abs(lx - CX) < 10 ? "middle" : lx > CX ? "start" : "end";
        const isSelected = axis.id === selectedId;
        return (
          <g
            key={axis.id}
            className={`wl-radar-node is-${axis.status}${isSelected ? " is-selected" : ""}`}
            onClick={() => onSelect(axis.id)}
            style={{ cursor: "pointer" }}
          >
            <circle cx={vx} cy={vy} r={isSelected ? 6 : 4.2} className="wl-radar-dot" />
            <text
              x={lx}
              y={ly + 3}
              textAnchor={anchor}
              className="wl-radar-label"
            >
              {axis.shortLabel}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

type Props = {
  accountId?: string;
  workouts: Workout[];
  timeZone?: string;
  bodyMassKg?: number | null;
  onOpenExerciseDetail?: (exerciseId: string) => void;
};

/**
 * Карточка #6: Детектор слабых звеньев и 6-осевой радар биомеханических пропорций силы.
 */
export default function WeakLinkRadarCard({
  accountId,
  workouts,
  timeZone,
  bodyMassKg,
  onOpenExerciseDetail,
}: Props) {
  const [profile, setProfile] = useState(() => BiomechanicsProfileStore.read(undefined, accountId));
  useEffect(() => {
    const sync = () => setProfile(BiomechanicsProfileStore.read(undefined, accountId));
    sync();
    window.addEventListener("tyaga:biomechanics-profile-change", sync);
    return () => window.removeEventListener("tyaga:biomechanics-profile-change", sync);
  }, [accountId]);

  const report = useMemo(
    () =>
      new WeakLinkAnalyzer(workouts, {
        timeZone,
        bodyMassKg,
        longLevers: profile.longLevers,
      }).build(),
    [workouts, timeZone, bodyMassKg, profile.longLevers],
  );

  const defaultAxis: BalanceAxisId =
    report.primaryWeakLink?.id ??
    report.axes.find((a) => a.status !== "missing")?.id ??
    "row_vs_bench";

  const [pickedAxis, setPickedAxis] = useState<BalanceAxisId | null>(null);
  const activeId = pickedAxis ?? defaultAxis;
  const activeAxis = report.axes.find((a) => a.id === activeId) ?? report.axes[0];

  return (
    <section className="tel-card weak-link-card" aria-label="Детектор слабых звеньев и пропорции силы">
      <div className="wl-head">
        <div className="wl-title-group">
          <span className="tel-eyebrow-pill">
            <Compass size={14} aria-hidden="true" />
            Биомеханика · Пропорции силы
          </span>
          <h2>Детектор слабых звеньев</h2>
        </div>

        <div className="wl-badges">
          {report.longLeversAdjusted ? (
            <span className="wl-meta-chip is-biomech">
              <Sparkles size={12} aria-hidden="true" />
              Длинные рычаги
            </span>
          ) : null}
          {report.symmetryScore !== null ? (
            <span
              className={`wl-score-pill${
                report.symmetryScore >= 85
                  ? " is-good"
                  : report.symmetryScore >= 68
                    ? " is-watch"
                    : " is-alert"
              }`}
            >
              Баланс {report.symmetryScore}/100
            </span>
          ) : null}
        </div>
      </div>

      {/* Главный вердикт */}
      <div
        className={`wl-verdict${
          report.primaryWeakLink
            ? " is-warning"
            : report.measuredAxes > 0
              ? " is-balanced"
              : " is-muted"
        }`}
      >
        {report.primaryWeakLink ? (
          <AlertTriangle size={16} aria-hidden="true" />
        ) : (
          <CheckCircle2 size={16} aria-hidden="true" />
        )}
        <span>{report.headline}</span>
      </div>

      <div className="wl-body">
        <div className="wl-radar-wrap">
          <RadarSvg axes={report.axes} selectedId={activeAxis.id} onSelect={setPickedAxis} />
          <span className="wl-radar-caption">
            Нажми на ось для разбора · измерено {report.measuredAxes} из {report.totalAxes}
          </span>
        </div>

        <div className="wl-side">
          {/* Карточка выбранной оси */}
          <div className={`wl-focus-card is-${activeAxis.status}`}>
            <div className="wl-focus-head">
              <strong>{activeAxis.label}</strong>
              <span className={`wl-status-tag is-${activeAxis.status}`}>
                {activeAxis.status === "balanced"
                  ? "В норме"
                  : activeAxis.status === "lagging"
                    ? "Слабое звено"
                    : activeAxis.status === "dominant"
                      ? "Перекос"
                      : "Нет данных"}
              </span>
            </div>

            {activeAxis.ratio !== null ? (
              <div className="wl-ratio-row">
                <span>
                  Факт: <b>{activeAxis.ratio.toFixed(2)}</b>
                </span>
                <span>
                  Норма: <b>{activeAxis.targetMin.toFixed(2)}–{activeAxis.targetMax.toFixed(2)}</b>
                </span>
                {activeAxis.numeratorE1rm !== null && activeAxis.denominatorE1rm !== null ? (
                  <span className="wl-e1rm-pair">
                    {fmt(activeAxis.numeratorE1rm)} / {fmt(activeAxis.denominatorE1rm)} кг
                  </span>
                ) : null}
              </div>
            ) : null}

            <p className="wl-focus-diag">{activeAxis.diagnosis}</p>
            <p className="wl-focus-fix">{activeAxis.fixHint}</p>

            {activeAxis.recommendedExerciseIds.length > 0 ? (
              <div className="wl-rec-chips">
                {activeAxis.recommendedExerciseIds.map((exId) => {
                  const ex = exerciseById(exId);
                  if (!ex) return null;
                  return onOpenExerciseDetail ? (
                    <button
                      key={exId}
                      type="button"
                      className="wl-rec-chip"
                      onClick={() => onOpenExerciseDetail(exId)}
                    >
                      {ex.name}
                    </button>
                  ) : (
                    <span key={exId} className="wl-rec-chip">
                      {ex.name}
                    </span>
                  );
                })}
              </div>
            ) : null}
          </div>

          {/* Компактный список всех 6 осей */}
          <ul className="wl-axis-list">
            {report.axes.map((axis) => (
              <li key={axis.id}>
                <button
                  type="button"
                  className={`wl-axis-row is-${axis.status}${axis.id === activeAxis.id ? " is-selected" : ""}`}
                  onClick={() => setPickedAxis(axis.id)}
                >
                  <span className="wl-axis-name">{axis.shortLabel}</span>
                  <span className="wl-axis-bar" aria-hidden="true">
                    <span
                      className="wl-axis-fill"
                      style={{ width: `${axis.status === "missing" ? 0 : axis.score}%` }}
                    />
                  </span>
                  <strong className="wl-axis-ratio">
                    {axis.ratio !== null ? axis.ratio.toFixed(2) : "—"}
                  </strong>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
