import type { Exercise, ExerciseFamily, ExerciseVariant } from "../lib/types";

/** Families organize variants; actual recording rules and anatomy remain variant-specific. */
export class ExerciseTaxonomy {
  constructor(private readonly exercises: readonly Exercise[]) {}
  families(): ExerciseFamily[] {
    const groups = new Map<string, Exercise[]>();
    for (const e of this.exercises)
      groups.set(e.familyId, [...(groups.get(e.familyId) ?? []), e]);
    return [...groups].map(([id, variants]) => ({
      id,
      name: variants[0].name,
      variantIds: variants.map((e) => e.id),
    }));
  }
  variants(familyId: string): ExerciseVariant[] {
    return this.exercises
      .filter((e) => e.familyId === familyId)
      .map((exercise) => ({
        id: exercise.id,
        familyId,
        catalogRevision: exercise.catalogRevision,
        definition: exercise,
      }));
  }
}
