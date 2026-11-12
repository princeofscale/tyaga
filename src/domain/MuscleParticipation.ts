import type { AnatomicalMuscle, Exercise, MuscleRole } from "../lib/types";
import { ANATOMICAL_MUSCLES, CHEST_HEADS, DELTOID_HEADS } from "../data/muscles";

/** Shared editorial anatomy for the atlas and counters, never inferred from names. */
export class MuscleParticipation {
  // These are regional emphases of specific curated variants, not isolated
  // activation or measured shares of force. Published catalog records stay frozen.
  private static chestEmphasis: Record<string, AnatomicalMuscle> = {
    "2:bench": "pectoralis-sternal",
    "2:incline-db": "pectoralis-clavicular",
    "2:fly": "pectoralis-sternal",
    "2:pushup": "pectoralis-sternal",
    "3:incline-bar": "pectoralis-clavicular",
    "3:flat-db-press": "pectoralis-sternal",
    "3:high-cable-fly": "pectoralis-abdominal",
  };

  static roles(exercise: Exercise): MuscleRole[] {
    const roles = new Map<AnatomicalMuscle, MuscleRole>();
    const priority = { stabilizer: 0, assistant: 1, primary: 2 };
    for (const role of exercise.muscles) {
      const previous = roles.get(role.muscleId);
      if (!previous || priority[role.role] > priority[previous.role])
        roles.set(role.muscleId, role);
    }

    const pec = roles.get("pectoralis-major");
    const emphasis = this.chestEmphasis[`${exercise.catalogRevision}:${exercise.id}`];
    const hasExplicitHeads = [...roles.keys()].some(
      (id) => id.startsWith("pectoralis-") && id !== "pectoralis-major",
    );
    if (
      pec && emphasis && !exercise.source && !exercise.custom &&
      exercise.provenance.reviewStatus === "editorial" && !hasExplicitHeads
    ) {
      const heads: AnatomicalMuscle[] = emphasis === "pectoralis-sternal"
        ? ["pectoralis-clavicular", "pectoralis-sternal", "pectoralis-abdominal"]
        : [emphasis, "pectoralis-sternal"];
      for (const muscleId of heads)
        roles.set(muscleId, {
          ...pec,
          muscleId,
          role: muscleId === emphasis || pec.role !== "primary" ? pec.role : "assistant",
          confidence: "moderate",
        });
    }
    return [...roles.values()];
  }

  static role(exercise: Exercise, muscles: readonly AnatomicalMuscle[]) {
    const roles = this.roles(exercise).filter((m) => muscles.includes(m.muscleId));
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
