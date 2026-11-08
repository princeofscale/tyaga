import { useState, useMemo } from "react";
import { X, Dumbbell, Minus, Plus, Check } from "lucide-react";
import { PlateLoadingCalculator } from "../domain/PlateLoadingCalculator";

export interface PlateSpec {
  weight: number;
  color: string;
  borderColor: string;
  textColor: string;
  width: number;
  height: number;
  name: string;
}

export const OLYMPIC_PLATES: PlateSpec[] = [
  { weight: 25, color: "#dc2626", borderColor: "#b91c1c", textColor: "#ffffff", width: 28, height: 160, name: "25 кг (Красный)" },
  { weight: 20, color: "#2563eb", borderColor: "#1d4ed8", textColor: "#ffffff", width: 26, height: 160, name: "20 кг (Синий)" },
  { weight: 15, color: "#eab308", borderColor: "#ca8a04", textColor: "#18181b", width: 22, height: 144, name: "15 кг (Жёлтый)" },
  { weight: 10, color: "#16a34a", borderColor: "#15803d", textColor: "#ffffff", width: 20, height: 128, name: "10 кг (Зелёный)" },
  { weight: 5, color: "#f3f4f6", borderColor: "#d1d5db", textColor: "#18181b", width: 17, height: 96, name: "5 кг (Белый)" },
  { weight: 2.5, color: "#1f2937", borderColor: "#374151", textColor: "#f3f4f6", width: 15, height: 80, name: "2.5 кг (Чёрный)" },
  { weight: 1.25, color: "#9ca3af", borderColor: "#6b7280", textColor: "#18181b", width: 13, height: 68, name: "1.25 кг (Хром)" },
];

export function calculatePlatesGreedy(totalWeight: number, barWeight: number): {
  plates: PlateSpec[];
  weightPerSide: number;
  actualLoaded: number;
  remainder: number;
} {
  const inventory = OLYMPIC_PLATES.slice(0, PlateLoadingCalculator.MAX_PLATE_TYPES);
  const specsByWeight = new Map<number, PlateSpec>(inventory.map((spec) => [spec.weight, spec]));
  const result = PlateLoadingCalculator.calculate(totalWeight, barWeight, [...specsByWeight.keys()]);
  return { ...result, plates: result.plates.map((weight) => specsByWeight.get(weight)!) };
}

export default function PlateCalculator({
  initialWeight = 80,
  onClose,
  onApplyWeight,
}: {
  initialWeight?: number;
  onClose: () => void;
  onApplyWeight?: (w: number) => void;
}) {
  const [targetWeight, setTargetWeight] = useState(() => PlateLoadingCalculator.clampWeight(
    initialWeight || 60, 0, PlateLoadingCalculator.MAX_TOTAL_WEIGHT_KG, 60,
  ));
  const [barWeight, setBarWeight] = useState(20);

  const { plates, weightPerSide, actualLoaded } = useMemo(
    () => calculatePlatesGreedy(targetWeight, barWeight),
    [targetWeight, barWeight],
  );

  const adjustWeight = (delta: number) => {
    setTargetWeight((prev) => PlateLoadingCalculator.adjustWeight(prev, delta, barWeight));
  };

  // Group plates by weight for clean count summary
  const plateCounts = useMemo(() => {
    const map = new Map<number, { count: number; spec: PlateSpec }>();
    for (const p of plates) {
      const existing = map.get(p.weight);
      if (existing) {
        existing.count += 1;
      } else {
        map.set(p.weight, { count: 1, spec: p });
      }
    }
    return Array.from(map.values());
  }, [plates]);

  return (
    <div className="plate-calculator-modal">
      <div className="plate-calc-header">
        <div className="plate-calc-title">
          <Dumbbell size={20} className="text-accent" />
          <h3>Калькулятор блинов на гриф</h3>
        </div>
        <button
          type="button"
          className="icon-button close-btn"
          onClick={onClose}
          aria-label="Закрыть"
        >
          <X size={18} />
        </button>
      </div>

      <div className="plate-calc-body">
        {/* Target Weight Controls */}
        <div className="plate-target-display">
          <div className="target-num-row">
            <button
              type="button"
              className="plate-quick-step"
              onClick={() => adjustWeight(-10)}
              aria-label="Минус 10 кг"
            >
              -10
            </button>
            <button
              type="button"
              className="plate-quick-step"
              onClick={() => adjustWeight(-2.5)}
              aria-label="Минус 2.5 кг"
            >
              <Minus size={16} />
            </button>

            <div className="target-val-box">
              <span className="target-val">{targetWeight}</span>
              <span className="target-unit">кг</span>
            </div>

            <button
              type="button"
              className="plate-quick-step"
              onClick={() => adjustWeight(2.5)}
              aria-label="Плюс 2.5 кг"
            >
              <Plus size={16} />
            </button>
            <button
              type="button"
              className="plate-quick-step"
              onClick={() => adjustWeight(10)}
              aria-label="Плюс 10 кг"
            >
              +10
            </button>
          </div>

          <div className="quick-presets">
            {[40, 50, 60, 70, 80, 90, 100, 120, 140, 160].map((w) => (
              <button
                type="button"
                key={w}
                className={`preset-btn ${targetWeight === w ? "active" : ""}`}
                onClick={() => setTargetWeight(w)}
              >
                {w}
              </button>
            ))}
          </div>
        </div>

        {/* Barbell Weight Selector */}
        <div className="bar-select-row">
          <span className="tiny muted">Вес грифа:</span>
          <div className="bar-options">
            {[
              { val: 20, label: "Олимпийский 20 кг" },
              { val: 15, label: "Женский 15 кг" },
              { val: 10, label: "EZ / Тренировочный 10 кг" },
            ].map((b) => (
              <button
                type="button"
                key={b.val}
                className={`bar-pill ${barWeight === b.val ? "active" : ""}`}
                onClick={() => setBarWeight(b.val)}
              >
                {b.label}
              </button>
            ))}
          </div>
        </div>

        {/* SVG Olympic Barbell Visualizer */}
        <div className="barbell-graphic-container">
          <div className="barbell-sleeve-label">
            <span>На сторону: <b>{weightPerSide.toFixed(2).replace(/\.00$/, "")} кг</b></span>
            {actualLoaded !== targetWeight && (
              <span className="actual-loaded-warn">
                (Собрано: {actualLoaded} кг)
              </span>
            )}
          </div>

          <div className="olympic-sleeve-stage">
            <svg
              className="olympic-barbell-svg"
              viewBox="0 0 340 180"
              preserveAspectRatio="xMidYMid meet"
            >
              <defs>
                <linearGradient id="barShaftGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                  <stop offset="0%" stopColor="#888" />
                  <stop offset="30%" stopColor="#e5e5e5" />
                  <stop offset="70%" stopColor="#999" />
                  <stop offset="100%" stopColor="#555" />
                </linearGradient>
                <linearGradient id="collarGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                  <stop offset="0%" stopColor="#555" />
                  <stop offset="40%" stopColor="#d4d4d4" />
                  <stop offset="100%" stopColor="#333" />
                </linearGradient>
                <linearGradient id="clipGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                  <stop offset="0%" stopColor="#1e293b" />
                  <stop offset="50%" stopColor="#475569" />
                  <stop offset="100%" stopColor="#0f172a" />
                </linearGradient>
              </defs>

              {/* Bar Shaft */}
              <rect x="0" y="77" width="55" height="26" fill="url(#barShaftGrad)" rx="2" />
              {/* Knurling pattern indicator */}
              <line x1="8" y1="80" x2="8" y2="100" stroke="#444" strokeWidth="1" strokeDasharray="2 2" />
              <line x1="20" y1="80" x2="20" y2="100" stroke="#444" strokeWidth="1" strokeDasharray="2 2" />
              <line x1="32" y1="80" x2="32" y2="100" stroke="#444" strokeWidth="1" strokeDasharray="2 2" />

              {/* Bar Shoulder / Collar */}
              <rect x="52" y="60" width="16" height="60" fill="url(#collarGrad)" rx="3" stroke="#222" strokeWidth="1" />
              <line x1="56" y1="62" x2="56" y2="118" stroke="#ffffff" strokeWidth="0.8" opacity="0.6" />

              {/* Sleeve (extends behind plates) */}
              <rect x="68" y="74" width="230" height="32" fill="url(#collarGrad)" rx="2" />
              <line x1="68" y1="78" x2="298" y2="78" stroke="#ffffff" strokeWidth="0.8" opacity="0.5" />
              <line x1="68" y1="102" x2="298" y2="102" stroke="#222" strokeWidth="0.8" opacity="0.4" />
              {/* Sleeve Cap */}
              <rect x="296" y="73" width="8" height="34" fill="#333" rx="2" />

              {/* Plates Rendered on Sleeve */}
              {(() => {
                let currentX = 72;
                return (
                  <>
                    {plates.map((p, idx) => {
                      const plateX = currentX;
                      const plateY = 90 - p.height / 2;
                      currentX += p.width + 2;

                      return (
                        <g key={`${p.weight}-${idx}`} className="svg-plate-group">
                          {/* Main Plate Body */}
                          <rect
                            x={plateX}
                            y={plateY}
                            width={p.width}
                            height={p.height}
                            rx={4}
                            fill={p.color}
                            stroke={p.borderColor}
                            strokeWidth="1.5"
                          />
                          {/* Inner Bevel Highlight */}
                          <rect
                            x={plateX + 2}
                            y={plateY + 4}
                            width={p.width - 4}
                            height={p.height - 8}
                            rx={2}
                            fill="none"
                            stroke="#ffffff"
                            strokeWidth="0.8"
                            opacity="0.3"
                          />
                          {/* Weight Text Label */}
                          <text
                            x={plateX + p.width / 2}
                            y={plateY + p.height / 2 + 4}
                            fill={p.textColor}
                            fontSize={p.width > 20 ? 11 : 9}
                            fontWeight="800"
                            textAnchor="middle"
                            fontFamily="sans-serif"
                            transform={`rotate(-90 ${plateX + p.width / 2} ${plateY + p.height / 2})`}
                          >
                            {p.weight}
                          </text>
                        </g>
                      );
                    })}

                    {/* Olympic Spring Collar/Clip after plates */}
                    {plates.length > 0 && (
                      <g className="svg-spring-clip" transform={`translate(${currentX + 2}, 68)`}>
                        <rect x="0" y="4" width="12" height="36" rx="3" fill="url(#clipGrad)" stroke="#64748b" strokeWidth="1" />
                        <line x1="6" y1="4" x2="16" y2="-6" stroke="#94a3b8" strokeWidth="3" strokeLinecap="round" />
                        <line x1="9" y1="6" x2="18" y2="-3" stroke="#cbd5e1" strokeWidth="2.5" strokeLinecap="round" />
                      </g>
                    )}
                  </>
                );
              })()}
            </svg>
          </div>
        </div>

        {/* Plates List Breakdown */}
        <div className="plates-summary-list">
          <span className="summary-title">Порядок надевания блинов (на сторону):</span>
          {plateCounts.length === 0 ? (
            <p className="tiny muted">Блины не требуются — пустой гриф {barWeight} кг</p>
          ) : (
            <div className="plates-pills-row">
              {plateCounts.map(({ count, spec }) => (
                <div
                  key={spec.weight}
                  className="plate-chip-summary"
                  style={{
                    backgroundColor: spec.color,
                    color: spec.textColor,
                    border: `1px solid ${spec.borderColor}`,
                  }}
                >
                  <span className="chip-count">{count} ×</span>
                  <span className="chip-weight">{spec.weight} кг</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {onApplyWeight && (
          <button
            type="button"
            className="button primary full-width"
            onClick={() => {
              onApplyWeight(targetWeight);
              onClose();
            }}
          >
            <Check size={16} />
            Применить {targetWeight} кг к подходу
          </button>
        )}
      </div>
    </div>
  );
}
