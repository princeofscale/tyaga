import { Dumbbell, TrendingUp } from "lucide-react";
import { GymInventoryStore } from "../domain/GymInventory";
import { LaidDupPlan, type LaidAuxProgressionHint, type LaidExerciseGuidance } from "../domain/LaidDupPlan";

type Props = {
  guidance: LaidExerciseGuidance;
  hasProgressionNote: boolean;
  targetSetsReps?: string | null;
  weightHint?: { label: string; source: "plan" | "history" | "deload" | "none" } | null;
  auxProgression?: LaidAuxProgressionHint | null;
  topSetPlateWeightKg?: number | null;
  onApplyAuxWeight?: (weightKg: number) => void;
  v3BackoffHint?: { pct: number; weightKg: number; topKg: number } | null;
  onApplyV3Backoff?: (weightKg: number) => void;
};

/** Компактная строка ориентиров упражнения в цикле Лейда: рабочий вес, повторы, целевой RIR, отдых и двойная прогрессия. */
export default function LaidExerciseGuidanceBar({
  guidance,
  hasProgressionNote,
  targetSetsReps,
  weightHint,
  auxProgression,
  topSetPlateWeightKg,
  onApplyAuxWeight,
  v3BackoffHint,
  onApplyV3Backoff,
}: Props) {
  const inv = GymInventoryStore.read();
  const platesText =
    topSetPlateWeightKg && topSetPlateWeightKg > inv.barWeightKg
      ? GymInventoryStore.formatPlatesForBar(topSetPlateWeightKg, inv)
      : null;

  const showDetail =
    !hasProgressionNote &&
    (guidance.role === "wave-aux" ||
      guidance.roleLabel.includes("калибровка") ||
      guidance.roleLabel.includes("щадяще") ||
      Boolean(guidance.lengthenedPartials));

  return (
    <div className={`laid-ex-guidance role-${guidance.role}`}>
      <div className="laid-ex-pills">
        {guidance.supersetTag ? (
          <span className="laid-ex-pill is-reps">{guidance.supersetTag}</span>
        ) : null}
        {weightHint ? (
          <span className={`laid-ex-pill is-weight source-${weightHint.source}`}>{weightHint.label}</span>
        ) : null}
        {targetSetsReps ? <span className="laid-ex-pill is-reps">{targetSetsReps}</span> : null}
        <span className="laid-ex-pill is-rir">{guidance.rirLabel}</span>
        <span className="laid-ex-pill is-rest">Отдых {guidance.restLabel}</span>
        {guidance.lengthenedPartials ? (
          <span className="laid-ex-pill is-weight source-plan" title="После технического отказа на последнем сете выполни 3–5 удлинённых частичных">
            LP · посл. сет
          </span>
        ) : null}
        {platesText ? (
          <span className="laid-ex-pill is-plates" title={`Раскладка блинов для грифа ${inv.barWeightKg} кг`}>
            <Dumbbell size={12} aria-hidden="true" />
            {platesText}
          </span>
        ) : null}
      </div>
      {v3BackoffHint && onApplyV3Backoff ? (
        <div className="laid-aux-hint kind-raise_weight">
          <div className="laid-aux-hint-copy">
            <strong>Динамический откат DUP v3 (−{v3BackoffHint.pct} % от топ-сета)</strong>
            <span>
              От факта {LaidDupPlan.kg(v3BackoffHint.topKg)} кг → откатные {LaidDupPlan.kg(v3BackoffHint.weightKg)} кг.
            </span>
          </div>
          <button
            type="button"
            className="autofill-pill-btn progress"
            onClick={() => onApplyV3Backoff(v3BackoffHint.weightKg)}
          >
            <TrendingUp size={13} aria-hidden="true" />
            <span>Поставить {LaidDupPlan.kg(v3BackoffHint.weightKg)} кг</span>
          </button>
        </div>
      ) : null}
      {showDetail ? <p className="laid-ex-detail">{guidance.detail}</p> : null}
      {auxProgression ? (
        <div className={`laid-aux-hint kind-${auxProgression.kind}`}>
          <div className="laid-aux-hint-copy">
            <strong>{auxProgression.title}</strong>
            <span>{auxProgression.detail}</span>
          </div>
          {auxProgression.kind === "raise_weight" && auxProgression.suggestedWeightKg && onApplyAuxWeight ? (
            <button
              type="button"
              className="autofill-pill-btn progress"
              onClick={() => onApplyAuxWeight(auxProgression.suggestedWeightKg!)}
            >
              <TrendingUp size={13} aria-hidden="true" />
              <span>Поставить {LaidDupPlan.kg(auxProgression.suggestedWeightKg)} кг</span>
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
