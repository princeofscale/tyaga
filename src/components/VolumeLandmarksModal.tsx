import { useMemo } from "react";
import {
  Activity,
  Zap,
  Info,
  CheckCircle2,
  AlertTriangle,
  MinusCircle,
  TrendingUp,
} from "lucide-react";
import {
  VolumeLandmarksCalculator,
  type MuscleVolumeAssessment,
} from "../domain/VolumeLandmarks";
import type { MuscleLoad } from "../lib/types";

export function VolumeLandmarksModal({
  loads,
  onClose,
}: {
  loads: MuscleLoad[];
  onClose: () => void;
}) {
  const assessments = useMemo(
    () => VolumeLandmarksCalculator.assessWeeklyLoads(loads),
    [loads]
  );

  const optimalCount = assessments.filter((a) => a.status === "optimal_mav").length;
  const growthCount = assessments.filter((a) => a.status === "growth_mev").length;
  const underCount = assessments.filter(
    (a) => a.status === "below_mv" || a.status === "maintenance"
  ).length;

  return (
    <div className="volume-landmarks-modal-content">
      {/* Hero Explainer Card */}
      <div className="rp-hero-card">
        <div className="rp-hero-top">
          <Zap size={22} className="text-accent" />
          <div>
            <h3>Ориентиры объёма (Dr. Mike Israetel · RP)</h3>
            <p>
              Научные границы гипертрофии: от сохранения (MV) до золотой зоны
              максимального роста (MAV) и предела восстановления (MRV).
            </p>
          </div>
        </div>

        <div className="rp-summary-stats">
          <div className="rp-stat-chip optimal">
            <b>{optimalCount}</b>
            <span>В зоне MAV (Макс. рост ⚡)</span>
          </div>
          <div className="rp-stat-chip growth">
            <b>{growthCount}</b>
            <span>В зоне MEV (Старт роста)</span>
          </div>
          <div className="rp-stat-chip under">
            <b>{underCount}</b>
            <span>Ниже MEV (Мало стимула)</span>
          </div>
        </div>
      </div>

      {/* Muscle List */}
      <div className="rp-muscle-list">
        {assessments.map((item) => {
          const b = item.bracket;

          return (
            <div key={item.muscle} className="rp-muscle-item">
              <div className="rp-item-header">
                <div className="rp-item-title-group">
                  <h4 className="rp-muscle-title">{item.muscleName}</h4>
                  <span
                    className="rp-status-tag"
                    style={{
                      color: item.statusColor,
                      borderColor: `${item.statusColor}44`,
                      backgroundColor: `${item.statusColor}18`,
                    }}
                  >
                    {item.statusLabel}
                  </span>
                </div>

                <div className="rp-sets-counter">
                  <b>{item.actualSets}</b>
                  <span className="unit">подх./нед</span>
                </div>
              </div>

              {/* Progress Bar with Landmarks */}
              <div className="rp-bar-track">
                <div
                  className="rp-bar-fill"
                  style={{
                    width: `${Math.min(100, item.progressPercent)}%`,
                    backgroundColor: item.statusColor,
                  }}
                />
              </div>

              {/* Bracket milestones */}
              <div className="rp-milestones-row">
                <span title="Maintenance Volume (сохранение)">MV: {b.mv}</span>
                <span title="Minimum Effective Volume (старт роста)">MEV: {b.mev}</span>
                <span className="text-accent" title="Maximum Adaptive Volume (золотая зона)">
                  MAV: {b.mavMin}–{b.mavMax}
                </span>
                <span className="text-danger" title="Maximum Recoverable Volume (предел)">
                  MRV: {b.mrv}
                </span>
              </div>

              <p className="rp-recommendation-text">{item.recommendation}</p>
            </div>
          );
        })}
      </div>

      <div className="rp-footer-note">
        <Info size={14} className="text-accent" />
        <span>
          Данные ориентиры основаны на доказательных исследованиях Renaissance
          Periodization и применяются к качественным рабочим подходам с RIR 1–3.
        </span>
      </div>
    </div>
  );
}
