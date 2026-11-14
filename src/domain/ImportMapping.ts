import { EXERCISES } from "../lib/catalog";
import { normalizeSearch } from "../lib/search";
import type { Exercise } from "../lib/types";

/**
 * Deterministic mapping of an exported exercise name (Strong, Hevy, FitNotes)
 * onto the curated catalog. Exact match only, after normalising case, "ё" and
 * punctuation: "Overhead Press (Dumbbell)" does NOT fall back to the barbell
 * press, and a name that two curated entries both claim is not mapped at all —
 * a wrong guess here would merge two different lifts into one history row.
 */
export class ImportMapping {
  private static index: Map<string, Exercise | null> | null = null;

  private static build() {
    const index = new Map<string, Exercise | null>();
    for (const exercise of EXERCISES) {
      const keys = new Set(
        [exercise.name, exercise.nameEn, ...(exercise.aliases ?? [])].map(
          normalizeSearch,
        ),
      );
      for (const key of keys) {
        if (!key) continue;
        const seen = index.get(key);
        index.set(key, seen === undefined || seen === exercise ? exercise : null);
      }
    }
    return index;
  }

  /** The curated exercise this name stands for, or null when unsure. */
  static suggest(sourceName: string): Exercise | null {
    this.index ??= this.build();
    return this.index.get(normalizeSearch(sourceName)) ?? null;
  }

  /**
   * Only barbell-style records (one total external load) are applied without
   * a manual choice: a dumbbell number is "per hand", a machine number is a
   * stack setting, and neither can be assumed from a bare file.
   */
  static appliesByDefault(exercise: Exercise | null) {
    return (
      !!exercise &&
      (exercise.recording.type ?? "reps") === "reps" &&
      exercise.recording.loadMode === "total_external"
    );
  }

  /** Does the weight in the file need the "is it the total bar weight?" question? */
  static needsWeightQuestion(names: string[]) {
    return names.some((n) => this.appliesByDefault(this.suggest(n)));
  }
}
