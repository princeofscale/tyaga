import { useState, useMemo } from "react";
import {
  BatteryCharging,
  Activity,
  Flame,
  ShieldCheck,
  Zap,
  CheckCircle2,
  ArrowRight,
  Info,
} from "lucide-react";
import {
  DeloadEngine,
  DELOAD_PRESETS,
  type DeloadMode,
  type FatigueAssessment,
} from "../domain/DeloadEngine";
import type { Workout } from "../lib/model";

export function DeloadModal({
  workouts,
  onApplyDeload,
  onClose,
}: {
  workouts: Workout[];
  onApplyDeload: (mode: DeloadMode) => void;
  onClose: () => void;
}) {
  const assessment: FatigueAssessment = useMemo(
    () => DeloadEngine.assessFatigue(workouts),
    [workouts]
  );

  const [selectedMode, setSelectedMode] = useState<DeloadMode>(
    assessment.recommendedMode
  );
  const [testWeight, setTestWeight] = useState(100);
  const [testSets, setTestSets] = useState(4);
  const [applied, setApplied] = useState(false);

  const config = DELOAD_PRESETS[selectedMode];

  // Calculated deload simulation
  const simWeight = Math.round((testWeight * config.intensityMultiplier) / 2.5) * 2.5;
  const simSets = Math.max(1, Math.round(testSets * config.volumeMultiplier));
  const normalTonnage = testWeight * testSets * 8;
  const deloadTonnage = simWeight * simSets * 8;
  const tonnageSavedPercent = Math.round(
    ((normalTonnage - deloadTonnage) / normalTonnage) * 100
  );

  const handleApply = () => {
    onApplyDeload(selectedMode);
    setApplied(true);
    setTimeout(() => {
      onClose();
    }, 1800);
  };

  return (
    <div className="deload-modal-content">
      {/* Fatigue Assessment Card */}
      <div className="fatigue-hero-card">
        <div className="fatigue-hero-top">
          <div className="fatigue-indicator-wrap">
            <div className="fatigue-score-ring">
              <span className="fatigue-score-val">{assessment.fatigueScore}</span>
              <span className="fatigue-score-max">/100</span>
            </div>
          </div>

          <div className="fatigue-info">
            <div className="fatigue-status-row">
              <span
                className={`fatigue-chip ${
                  assessment.fatigueScore >= 70
                    ? "high"
                    : assessment.fatigueScore >= 45
                      ? "medium"
                      : "low"
                }`}
              >
                {assessment.statusLabel}
              </span>
            </div>
            <p className="fatigue-reason-text">{assessment.reason}</p>
          </div>
        </div>

        <div className="fatigue-metrics-strip">
          <div className="fatigue-metric-item">
            <span>Тренировок за 30 дн.</span>
            <b>{assessment.recentWorkoutsCount}</b>
          </div>
          <div className="fatigue-metric-item">
            <span>Рабочих подходов</span>
            <b>{assessment.recentSetsCount}</b>
          </div>
          <div className="fatigue-metric-item">
            <span>Отказных сетов (RIR 0)</span>
            <b className="text-accent">{assessment.recentFailureSetsCount}</b>
          </div>
        </div>
      </div>

      {/* Deload Mode Options */}
      <div className="deload-modes-section">
        <h4 className="section-title">Выбери формат разгрузочной недели</h4>

        <div className="deload-cards-grid">
          {(["volume", "intensity", "recovery"] as const).map((m) => {
            const item = DELOAD_PRESETS[m];
            const isSelected = selectedMode === m;
            const isRecommended = assessment.recommendedMode === m;

            return (
              <div
                key={m}
                className={`deload-card ${isSelected ? "selected" : ""}`}
                onClick={() => setSelectedMode(m)}
              >
                <div className="deload-card-header">
                  <div className="deload-card-title-row">
                    <b>{item.name}</b>
                    {isRecommended && (
                      <span className="rec-badge">Рекомендовано</span>
                    )}
                  </div>
                  <span className="deload-tag-specs">
                    {Math.round(item.intensityMultiplier * 100)}% веса • {Math.round(item.volumeMultiplier * 100)}% подходов • RIR {item.targetRir}
                  </span>
                </div>

                <p className="deload-card-desc">{item.description}</p>
                <div className="deload-card-bestfor">
                  <Info size={13} />
                  <span>{item.bestFor}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Live Simulation Preview */}
      <div className="deload-sim-box">
        <div className="sim-header">
          <Zap size={16} className="text-accent" />
          <b>Калькулятор нагрузки в разгрузку</b>
        </div>

        <div className="sim-inputs-row">
          <label>
            Обычный рабочий вес:
            <div className="sim-input-inline">
              <input
                type="number"
                step="2.5"
                min="20"
                max="400"
                value={testWeight}
                onChange={(e) => setTestWeight(Number(e.target.value) || 20)}
              />
              <span>кг</span>
            </div>
          </label>

          <label>
            Рабочих подходов:
            <div className="sim-input-inline">
              <input
                type="number"
                min="1"
                max="10"
                value={testSets}
                onChange={(e) => setTestSets(Number(e.target.value) || 1)}
              />
              <span>сетов</span>
            </div>
          </label>
        </div>

        <div className="sim-result-arrow-box">
          <div className="sim-before">
            <span className="sim-res-label">До разгрузки:</span>
            <b>
              {testWeight} кг × {testSets} подх.
            </b>
            <small>{normalTonnage.toLocaleString()} кг тоннажа</small>
          </div>

          <ArrowRight size={20} className="sim-arrow" />

          <div className="sim-after">
            <span className="sim-res-label">В разгрузочную неделю:</span>
            <b className="text-accent">
              {simWeight} кг × {simSets} подх.
            </b>
            <small>
              {deloadTonnage.toLocaleString()} кг (экономия {tonnageSavedPercent}%)
            </small>
          </div>
        </div>

        <div className="sim-note">
          <ShieldCheck size={14} className="text-accent" />
          <span>
            Целевой запас в каждом подходе — <b>RIR {config.targetRir}</b> (минимум {config.targetRir} повторения до отказа).
            Суставы и ЦНС восстанавливаются, суперкомпенсация вступает в силу.
          </span>
        </div>
      </div>

      {/* Action Footer */}
      <div className="deload-footer-actions">
        {applied ? (
          <div className="deload-applied-banner">
            <CheckCircle2 size={18} className="text-accent" />
            <span>Стратегия разгрузки «{config.name}» активирована!</span>
          </div>
        ) : (
          <button
            type="button"
            className="button primary full-width apply-deload-btn"
            onClick={handleApply}
          >
            <BatteryCharging size={18} />
            <span>Применить разгрузку к тренировкам</span>
          </button>
        )}
      </div>
    </div>
  );
}
