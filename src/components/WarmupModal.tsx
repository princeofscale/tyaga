import { useState, useMemo } from "react";
import { Dumbbell, Flame, Check, ShieldCheck } from "lucide-react";
import {
  WarmupLadderCalculator,
  type WarmupStep,
} from "../domain/WarmupLadderCalculator";

export function WarmupModal({
  defaultWeight = 80,
  defaultReps = 6,
  onClose,
}: {
  defaultWeight?: number;
  defaultReps?: number;
  onClose: () => void;
}) {
  const [targetWeight, setTargetWeight] = useState(() => WarmupLadderCalculator.clampTargetWeight(defaultWeight, 20));
  const [targetReps, setTargetReps] = useState(() => WarmupLadderCalculator.clampReps(defaultReps));
  const [barWeight, setBarWeight] = useState(20);

  const steps: WarmupStep[] = useMemo(
    () => WarmupLadderCalculator.generateLadder(targetWeight, targetReps, barWeight),
    [targetWeight, targetReps, barWeight]
  );

  return (
    <div className="warmup-ladder-content">
      <div className="warmup-hero-intro">
        <Dumbbell size={22} className="text-accent" />
        <div>
          <h3>Разминочная лесенка (OpenGym)</h3>
          <p>
            Пошаговая подготовка ЦНС и суставов к рабочему весу без накопления
            усталости и закисления в мышцах.
          </p>
        </div>
      </div>

      {/* Target Setup Controls */}
      <div className="warmup-config-grid">
        <div className="warmup-config-item">
          <label>Рабочий вес (кг):</label>
          <div className="warmup-input-wrap">
            <input
              type="number"
              step="2.5"
              min="20"
              max="400"
              value={targetWeight}
              onChange={(e) => setTargetWeight(WarmupLadderCalculator.clampTargetWeight(e.target.value, 20))}
            />
            <span className="unit-label">кг</span>
          </div>
        </div>

        <div className="warmup-config-item">
          <label>Повторений в подходе:</label>
          <div className="warmup-input-wrap">
            <input
              type="number"
              min="1"
              max="30"
              value={targetReps}
              onChange={(e) => setTargetReps(WarmupLadderCalculator.clampReps(e.target.value))}
            />
            <span className="unit-label">повт.</span>
          </div>
        </div>

        <div className="warmup-config-item">
          <label>Гриф:</label>
          <select
            value={barWeight}
            onChange={(e) => setBarWeight(WarmupLadderCalculator.clampBarWeight(e.target.value))}
            className="warmup-select"
          >
            <option value={20}>Олимпийский (20 кг)</option>
            <option value={15}>Женский (15 кг)</option>
            <option value={10}>EZ-гриф (10 кг)</option>
            <option value={8}>Тренировочный (8 кг)</option>
          </select>
        </div>
      </div>

      {/* Ladder Steps List */}
      <div className="warmup-steps-list">
        {steps.map((step) => (
          <div
            key={step.stepIndex}
            className={`ladder-step-card ${step.isWorkSet ? "work-set" : "warmup-set"}`}
          >
            <div className="step-badge-wrap">
              <span className="step-idx">{step.stepIndex}</span>
              <span className="step-percent">{step.percent}%</span>
            </div>

            <div className="step-main-info">
              <div className="step-weight-row">
                <b className="step-weight">{step.weightKg} кг</b>
                <span className="step-reps">× {step.reps} повт.</span>
                {step.isWorkSet && (
                  <span className="work-tag">🎯 Целевой сет</span>
                )}
              </div>

              <div className="step-plates-desc">
                <span>{step.platesDescription}</span>
              </div>

              <div className="step-purpose">
                <span>{step.purpose}</span>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="warmup-tips-box">
        <ShieldCheck size={16} className="text-accent" />
        <span>
          Отдых между разминочными подходами — 45-60 секунд. Между последней
          разминкой (калибровкой) и рабочим подходом отдохните 2-3 минуты.
        </span>
      </div>
    </div>
  );
}
