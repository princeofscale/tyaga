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
}: Props) {
  const inv = GymInventoryStore.read();
  const platesText =
    topSetPlateWeightKg && topSetPlateWeightKg > inv.barWeightKg
      ? GymInventoryStore.formatPlatesForBar(topSetPlateWeightKg, inv)
      : null;

  const showDetail =
    !hasProgressionNote &&
    (guidance.role === "wave-aux" || guidance.roleLabel.includes("калибровка") || guidance.roleLabel.includes("щадяще"));

  return (
    <div className={`laid-ex-guidance role-${guidance.role}`}>
      <div className="laid-ex-pills">
        {weightHint ? (
          <span className={`laid-ex-pill is-weight source-${weightHint.source}`}>{weightHint.label}</span>
        ) : null}
        {targetSetsReps ? <span className="laid-ex-pill is-reps">{targetSetsReps}</span> : null}
        <span className="laid-ex-pill is-rir">{guidance.rirLabel}</span>
        <span className="laid-ex-pill is-rest">Отдых {guidance.restLabel}</span>
        {platesText ? (
          <span className="laid-ex-pill is-plates" title={`Раскладка блинов для грифа ${inv.barWeightKg} кг`}>
            <Dumbbell size={12} aria-hidden="true" />
            {platesText}
          </span>
        ) : null}
      </div>
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
