import { useState, useMemo } from "react";
import { Dumbbell, ShieldCheck } from "lucide-react";
import {
  WarmupLadderCalculator,
  type WarmupStep,
} from "../domain/WarmupLadderCalculator";
import { DecimalInput } from "../domain/DecimalInput";
import { GymInventoryStore } from "../domain/GymInventory";
import { NumberField } from "./NumberField";

export function WarmupModal({
  defaultWeight = 80,
  defaultReps = 6,
}: {
  defaultWeight?: number;
  defaultReps?: number;
  onClose: () => void;
}) {
  const [barWeight, setBarWeight] = useState<number>(() => GymInventoryStore.read().barWeightKg);
  const [targetWeight, setTargetWeight] = useState(() =>
    WarmupLadderCalculator.clampTargetWeight(defaultWeight, GymInventoryStore.read().barWeightKg),
  );
  const [targetReps, setTargetReps] = useState(() => WarmupLadderCalculator.clampReps(defaultReps));

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
            <NumberField
              label="Рабочий вес, кг"
              value={targetWeight}
              onValue={setTargetWeight}
              bounds={{ min: Math.max(20, barWeight), max: WarmupLadderCalculator.MAX_TARGET_WEIGHT_KG, unit: "кг" }}
              unit="кг"
            />
          </div>
        </div>

        <div className="warmup-config-item">
          <label>Повторений в подходе:</label>
          <div className="warmup-input-wrap">
            <NumberField
              label="Повторений в подходе"
              value={targetReps}
              onValue={(n) => setTargetReps(WarmupLadderCalculator.clampReps(n))}
              bounds={{ min: 1, max: WarmupLadderCalculator.MAX_REPS }}
              decimals={0}
              unit="повт."
            />
          </div>
        </div>

        <div className="warmup-config-item">
          <label>Гриф:</label>
          <select
            value={barWeight}
            onChange={(e) => setBarWeight(WarmupLadderCalculator.clampBarWeight(e.target.value))}
            className="warmup-select"
            aria-label="Гриф"
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
                <b className="step-weight">{DecimalInput.format(step.weightKg)} кг</b>
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
