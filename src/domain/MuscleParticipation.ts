import { MUSCLE_INVOLVEMENT_V1, MUSCLE_MODEL_REVISION } from "../data/muscle-involvement-v1";
import type { MuscleInvolvement } from "../lib/types";
import type { AnatomicalMuscle, Exercise, MuscleRole } from "../lib/types";
import { ANATOMICAL_MUSCLES, CHEST_HEADS, DELTOID_HEADS } from "../data/muscles";

/** Shared editorial anatomy for the atlas and counters, never inferred from names. */
export class MuscleParticipation {
  static evidence(exercise: Exercise): MuscleInvolvement[] {
    const base = exercise.muscles.map((m)=>({exerciseVariantId:exercise.id,catalogRevision:exercise.catalogRevision,
      muscleId:m.muscleId,role:m.role,confidence:m.confidence,evidenceLevel:"anatomical" as const,
      evidenceIds:m.sources,modelRevision:MUSCLE_MODEL_REVISION}));
    return [...base, ...MUSCLE_INVOLVEMENT_V1.filter((m)=>m.exerciseVariantId===exercise.id && m.catalogRevision===exercise.catalogRevision)];
  }

  static roles(exercise: Exercise, modelRevision = MUSCLE_MODEL_REVISION): MuscleRole[] {
    const roles = new Map<AnatomicalMuscle, MuscleRole>();
    const priority = { stabilizer: 0, assistant: 1, primary: 2 };
    for (const role of exercise.muscles) {
      const previous = roles.get(role.muscleId);
      if (!previous || priority[role.role] > priority[previous.role])
        roles.set(role.muscleId, role);
    }

    const pec = roles.get("pectoralis-major");
    const regions = MUSCLE_INVOLVEMENT_V1.filter((m)=>m.modelRevision===modelRevision && m.exerciseVariantId===exercise.id && m.catalogRevision===exercise.catalogRevision);
    const hasExplicitHeads = [...roles.keys()].some(
      (id) => id.startsWith("pectoralis-") && id !== "pectoralis-major",
    );
    if (
      pec && regions.length && !exercise.source && !exercise.custom &&
      exercise.provenance.reviewStatus === "editorial" && !hasExplicitHeads
    ) {
      for (const region of regions)
        roles.set(region.muscleId, { ...pec, muscleId: region.muscleId,
          role: pec.role === "primary" ? region.role : pec.role,
          confidence: "moderate", sources: [...region.evidenceIds],
        });
    }
    return [...roles.values()];
  }

  static role(exercise: Exercise, muscles: readonly AnatomicalMuscle[], modelRevision = MUSCLE_MODEL_REVISION) {
    const roles = this.roles(exercise,modelRevision).filter((m) => muscles.includes(m.muscleId));
    return roles.find((m) => m.role === "primary")?.role ??
      roles.find((m) => m.role === "assistant")?.role ??
      roles.find((m) => m.role === "stabilizer")?.role;
  }

  static headRole(slug: string, exercise: Exercise) {
    const head = [...CHEST_HEADS, ...DELTOID_HEADS].find((h) => h.slug === slug);
    return head ? this.role(exercise, [head.id]) : undefined;
  }

  static primaryLabel(exercise: Exercise): string | null {
    const head = [...CHEST_HEADS, ...DELTOID_HEADS].find(
      (h) => this.headRole(h.slug, exercise) === "primary",
    );
    if (head) return head.name;
    const muscle = this.roles(exercise).find((m) => m.role === "primary");
    return ANATOMICAL_MUSCLES.find((m) => m.id === muscle?.muscleId)?.name ?? null;
  }
}
