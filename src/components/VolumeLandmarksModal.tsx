import { useMemo } from "react";
import { Zap, Info, Activity, AlertTriangle, CheckCircle2 } from "lucide-react";
import { VolumeLandmarksCalculator } from "../domain/VolumeLandmarks";
import { BiomechanicsEngine } from "../domain/BiomechanicsEngine";
import { dateLabel, fmt } from "../lib/model";
import type { Workout } from "../lib/types";
import { quantityWord } from "../lib/quantity";

export function VolumeLandmarksModal({ workouts, today, mapping, timeZone }: {
  workouts: Workout[];
  today: string;
  mapping: "recorded" | "current";
  timeZone?: string;
}) {
  const report = useMemo(
    () => VolumeLandmarksCalculator.assessWeek(workouts, today, { mapping, timeZone }),
    [workouts, today, mapping, timeZone],
  );
  const bio = useMemo(
    () => BiomechanicsEngine.analyzeWeek(workouts, today, { mapping, timeZone }),
    [workouts, today, mapping, timeZone],
  );
  const bioByMuscle = useMemo(
    () => new Map(bio.zones.map((z) => [z.muscle, z])),
    [bio],
  );
  const growthCount = report.assessments.filter(
    (a) => a.phase === "min_growth" || a.phase === "optimal_growth",
  ).length;
  const maintenanceCount = report.assessments.filter((a) => a.phase === "maintenance").length;
  const highCount = report.assessments.filter(
    (a) => a.phase === "high_volume" || a.phase === "overreaching",
  ).length;

  return (
    <div className="volume-landmarks-modal-content">
      <div className="rp-hero-card">
        <div className="rp-hero-top">
          <Zap size={22} className="text-accent" />
          <div>
            <h3>Недельный объём по мышцам</h3>
            <p>{dateLabel(report.startDate)} — {dateLabel(report.endDate)} · последние 7 дней</p>
            <p>
              Ориентиры MV (поддержка), MEV (старт роста), MAV (оптимальный набор массы) и MRV (порог восстановления) рассчитаны для каждой группы мышц отдельно.
            </p>
          </div>
        </div>
        <div className="rp-summary-stats">
          <div className="rp-stat-chip optimal"><b>{growthCount}</b><span>Набор массы</span></div>
          <div className="rp-stat-chip under"><b>{maintenanceCount}</b><span>Поддержка</span></div>
          <div className="rp-stat-chip growth"><b>{highCount}</b><span>Высокий / перегруз</span></div>
        </div>
        {bio.workingSets > 0 && (
          <div className="rp-bio-strip" aria-label="Биомеханика недели">
            <span>
              <Activity size={13} aria-hidden="true" /> Зоны RIR: <b>{bio.rirBands.high}</b> (0–2) · <b>{bio.rirBands.moderate}</b> (3–4) · <b>{bio.rirBands.light}</b> (5+)
            </span>
            <span>
              Диапазоны: <b>{bio.repZones.strength}</b> сила (1–5) · <b>{bio.repZones.hypertrophy}</b> гип. (6–15) · <b>{bio.repZones.endurance}</b> 16+
            </span>
            <span>
              {bio.avgRir !== null ? <>Средний RIR: <b>{fmt(bio.avgRir)}</b> · </> : null}
              Осевая / стабилизация: <b>{fmt(bio.structuralLoadSets)}</b> подх.
            </span>
          </div>
        )}
        {bio.signals.length > 0 && (
          <ul className="rp-bio-signals" aria-label="Сигналы биомеханики">
            {bio.signals.map((sig) => (
              <li key={sig.id} className={`rp-bio-signal ${sig.severity}`}>
                {sig.severity === "warn" ? (
                  <AlertTriangle size={14} aria-hidden="true" />
                ) : sig.severity === "ok" ? (
                  <CheckCircle2 size={14} aria-hidden="true" />
                ) : (
                  <Info size={14} aria-hidden="true" />
                )}
                <div>
                  <b>{sig.title}</b>
                  <span>{sig.detail}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
        <p>Прямые подходы считаются как 1, косвенные (синергисты) как 0,5. Разминка и стабилизация исключены.</p>
        {report.unknownRirSets > 0 && (
          <p>
            Без RIR: {report.unknownRirSets} из {report.workingSets}{" "}
            {quantityWord(report.workingSets, "рабочего подхода", "рабочих подходов", "рабочих подходов")}.
          </p>
        )}
      </div>
      <div className="rp-muscle-list">
        {report.assessments.map((item) => {
          const bioZone = bioByMuscle.get(item.muscle);
          const b = item.bracket;
          return (
            <div key={item.muscle} className="rp-muscle-item">
              <div className="rp-item-header">
                <div className="rp-item-title-group">
                  <h4 className="rp-muscle-title">{item.muscleName}</h4>
                  <span
                    className="rp-status-tag"
                    style={{
                      color: item.phaseColor,
                      borderColor: `${item.phaseColor}44`,
                      backgroundColor: `${item.phaseColor}18`,
                    }}
                  >
                    {item.phaseLabel}
                  </span>
                </div>
                <div className="rp-sets-counter">
                  <b>{fmt(item.actualSets)}</b>
                  <span className="unit">экв. подх./нед</span>
                </div>
              </div>
              <p className="tiny">
                {fmt(item.directSets)} прям. + 0,5 × {fmt(item.indirectSets)} косв. · RIR ≤ 3: {fmt(item.knownHardSets)}
                {bioZone && bioZone.effectiveSets > 0 ? ` · стимул: ${fmt(bioZone.effectiveSets)}` : ""}
              </p>
              <div className="rp-bar-track">
                <div
                  className="rp-bar-fill"
                  style={{ width: `${Math.min(100, item.progressPercent)}%`, backgroundColor: item.phaseColor }}
                />
              </div>
              <div className="rp-milestones-row">
                <span>MV {b.mv} · MEV {b.mev} · MAV {b.mavLow}–{b.mavHigh} · MRV {b.mrv}</span>
              </div>
              <p className="rp-recommendation-text">{item.effectSummary} {item.recommendation}</p>
            </div>
          );
        })}
      </div>
      <div className="rp-footer-note">
        <Info size={14} className="text-accent" />
        <span>
          Ориентиры: RP Hypertrophy (Dr. M. Israetel), мета-анализы{" "}
          <a href="https://doi.org/10.1007/s40279-025-02344-w" target="_blank" rel="noreferrer">Pelland et al.</a>{" "}
          и Schoenfeld et al. Индивидуальный оптимум зависит от сна, стажа и прогресса рабочих весов.
        </span>
      </div>
    </div>
  );
}
