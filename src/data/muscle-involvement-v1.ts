import type { AnatomicalMuscle } from "./muscles";
import type { MuscleInvolvement } from "../lib/types";

export const MUSCLE_MODEL_REVISION = 1;
// A separate immutable interpretation layer; published exercise definitions stay frozen.
const definitions: {
  variant: string;
  revision: 2 | 3;
  emphasis: AnatomicalMuscle;
  evidence: string[];
}[] = [
  {
    variant: "bench",
    revision: 2,
    emphasis: "pectoralis-sternal",
    evidence: ["anatomy-upper", "bench-review"],
  },
  {
    variant: "incline-db",
    revision: 2,
    emphasis: "pectoralis-clavicular",
    evidence: ["anatomy-upper", "incline-emg"],
  },
  {
    variant: "fly",
    revision: 2,
    emphasis: "pectoralis-sternal",
    evidence: ["anatomy-upper"],
  },
  {
    variant: "pushup",
    revision: 2,
    emphasis: "pectoralis-sternal",
    evidence: ["anatomy-upper"],
  },
  {
    variant: "incline-bar",
    revision: 3,
    emphasis: "pectoralis-clavicular",
    evidence: ["anatomy-upper", "incline-emg"],
  },
  {
    variant: "flat-db-press",
    revision: 3,
    emphasis: "pectoralis-sternal",
    evidence: ["anatomy-upper", "bench-review"],
  },
  {
    variant: "high-cable-fly",
    revision: 3,
    emphasis: "pectoralis-abdominal",
    evidence: ["anatomy-upper"],
  },
];
export const MUSCLE_INVOLVEMENT_V1: readonly MuscleInvolvement[] =
  definitions.flatMap((definition) => {
    const muscles: AnatomicalMuscle[] =
      definition.emphasis === "pectoralis-sternal"
        ? [
            "pectoralis-clavicular",
            "pectoralis-sternal",
            "pectoralis-abdominal",
          ]
        : [definition.emphasis, "pectoralis-sternal"];
    return muscles.map((muscleId) => ({
      exerciseVariantId: definition.variant,
      catalogRevision: definition.revision,
      muscleId,
      role:
        muscleId === definition.emphasis
          ? ("primary" as const)
          : ("assistant" as const),
      confidence: "moderate" as const,
      evidenceLevel: "editorial" as const,
      evidenceIds: definition.evidence,
      modelRevision: MUSCLE_MODEL_REVISION,
    }));
  });
