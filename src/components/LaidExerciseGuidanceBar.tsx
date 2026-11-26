import { Dumbbell, TrendingUp } from "lucide-react";
import { LaidDupPlan, type LaidAuxProgressionHint, type LaidExerciseGuidance } from "../domain/LaidDupPlan";
import { WarmupLadderCalculator } from "../domain/WarmupLadderCalculator";

type Props = {
  guidance: LaidExerciseGuidance;
  hasProgressionNote: boolean;
  auxProgression?: LaidAuxProgressionHint | null;
  topSetPlateWeightKg?: number | null;
  onApplyAuxWeight?: (weightKg: number) => void;
};

/** Компактная строка ориентиров упражнения в цикле Лейда: роль, целевой RIR, отдых, блины на сторону и двойная прогрессия. */
export default function LaidExerciseGuidanceBar({
  guidance,
  hasProgressionNote,
  auxProgression,
  topSetPlateWeightKg,
  onApplyAuxWeight,
}: Props) {
  const platesText =
    topSetPlateWeightKg && topSetPlateWeightKg > 20
      ? WarmupLadderCalculator.formatPlates(topSetPlateWeightKg, 20)
      : null;

  return (
    <div className={`laid-ex-guidance role-${guidance.role}`}>
      <div className="laid-ex-pills">
        <span className="laid-ex-pill is-role">{guidance.roleLabel}</span>
        <span className="laid-ex-pill is-rir">{guidance.rirLabel}</span>
        <span className="laid-ex-pill is-rest">Отдых {guidance.restLabel}</span>
        {platesText ? (
          <span className="laid-ex-pill is-plates" title="Раскладка блинов для стандартного грифа 20 кг">
            <Dumbbell size={12} aria-hidden="true" />
            {platesText}
          </span>
        ) : null}
      </div>
      {!hasProgressionNote ? <p className="laid-ex-detail">{guidance.detail}</p> : null}
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
