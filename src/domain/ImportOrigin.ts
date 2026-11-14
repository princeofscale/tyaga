import { exerciseForEntry } from "../lib/catalog";
import type { WorkoutExercise } from "../lib/types";

const FORMATS = ["strong", "hevy", "fitnotes"];

/**
 * An entry that was imported as its own record (the weight rule is unknown,
 * so it is not pooled with the catalog exercise of the same name) is marked
 * "из импорта": two rows called "Bench Press" must never look identical.
 */
export class ImportOrigin {
  static isLiteral(entry: WorkoutExercise) {
    const origin = exerciseForEntry(entry)?.custom?.origin;
    return !!origin && FORMATS.includes(origin);
  }
  static label(entry: WorkoutExercise) {
    return this.isLiteral(entry) ? "из импорта" : "";
  }
}
