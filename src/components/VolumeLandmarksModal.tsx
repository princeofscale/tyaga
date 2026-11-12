import { useMemo } from "react";
import { Zap, Info } from "lucide-react";
import { VolumeLandmarksCalculator, type VolumeStatusKind } from "../domain/VolumeLandmarks";
import { dateLabel, fmt } from "../lib/model";
import type { Workout } from "../lib/types";

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
  const count = (status: VolumeStatusKind) => report.assessments.filter((a) => a.status === status).length;
  return (
    <div className="volume-landmarks-modal-content">
      <div className="rp-hero-card">
        <div className="rp-hero-top">
          <Zap size={22} className="text-accent" />
          <div>
            <h3>Недельный объём по мышцам</h3>
            <p>{dateLabel(report.startDate)} — {dateLabel(report.endDate)} · последние 7 дней</p>
            <p>Общий ориентир для гипертрофии — 10–20 трудных подходов в неделю. Рост возможен и при меньшем объёме; индивидуальный оптимум зависит от прогресса и восстановления.</p>
          </div>
        </div>
        <div className="rp-summary-stats">
          <div className="rp-stat-chip optimal"><b>{count("within_reference")}</b><span>В общем диапазоне</span></div>
          <div className="rp-stat-chip growth"><b>{count("above_reference")}</b><span>Выше диапазона</span></div>
          <div className="rp-stat-chip under"><b>{count("below_reference") + count("no_sets")}</b><span>Ниже ориентира</span></div>
        </div>
        <p>Считаем выполненные рабочие подходы при любом RIR: прямые + 0,5 × помощь. Стабилизация и разминка исключены. Коэффициент 0,5 — приближение для учёта объёма, а не доля силы или роста.</p>
        <p>Без RIR: {report.unknownRirSets} из {report.workingSets} рабочих подходов. При неизвестном запасе или лёгкой работе стимул оценить нельзя. Отказ не обязателен.</p>
      </div>
      <div className="rp-muscle-list">
        {report.assessments.map((item) => (
          <div key={item.muscle} className="rp-muscle-item">
            <div className="rp-item-header">
              <div className="rp-item-title-group">
                <h4 className="rp-muscle-title">{item.muscleName}</h4>
                <span className="rp-status-tag" style={{ color: item.statusColor, borderColor: `${item.statusColor}44`, backgroundColor: `${item.statusColor}18` }}>{item.statusLabel}</span>
              </div>
              <div className="rp-sets-counter"><b>{fmt(item.actualSets)}</b><span className="unit">экв. подх./нед</span></div>
            </div>
            <p className="tiny">{fmt(item.directSets)} прямых + 0,5 × {fmt(item.indirectSets)} с помощью · из них при RIR ≤ 3: {fmt(item.knownHardSets)} экв. подх.</p>
            <div className="rp-bar-track"><div className="rp-bar-fill" style={{ width: `${Math.min(100, item.progressPercent)}%`, backgroundColor: item.statusColor }} /></div>
            <div className="rp-milestones-row"><span>Общий диапазон: {item.bracket.referenceMin}–{item.bracket.referenceMax} подх./нед</span></div>
            <p className="rp-recommendation-text">{item.recommendation}</p>
          </div>
        ))}
      </div>
      <div className="rp-footer-note">
        <Info size={14} className="text-accent" />
        <span>Зоны объединяют разные мышцы: объём всей спины или плеч не означает достаточную работу каждого пучка. Источники: <a href="https://acsm.org/resistance-training-guidelines-update-2026/" target="_blank" rel="noreferrer">ACSM, 2026</a>, <a href="https://doi.org/10.47206/ijsc.v1i1.81" target="_blank" rel="noreferrer">IUSCA, 2021</a>, <a href="https://doi.org/10.1007/s40279-025-02344-w" target="_blank" rel="noreferrer">Pelland et al., 2026</a>.</span>
      </div>
    </div>
  );
}
