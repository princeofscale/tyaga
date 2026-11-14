import type { Exercise, SetEntry } from "../lib/types";

/**
 * Что должно быть введено, чтобы отметка ✓ была правдой. Подход без веса там, где вес
 * обязателен, и подход без повторов не записываются молча: приложение просит ввод.
 * Вес тела, «доп. вес» и помощь допускают 0 — это осмысленное значение.
 */
export type MissingField = "weight" | "reps";

export class SetCompleteness {
  /** Правила записи, где без внешнего веса подход не имеет смысла. */
  private static readonly needsWeight = new Set(["total_external", "per_implement", "machine_stack"]);

  static needsExternalWeight(exercise: Pick<Exercise, "recording">) {
    return exercise.recording.type !== "duration" && this.needsWeight.has(exercise.recording.loadMode);
  }

  /** Первое недостающее поле или `null`, если подход можно отмечать. Разминка тоже должна иметь вес. */
  static missing(exercise: Pick<Exercise, "recording">, set: Pick<SetEntry, "weight" | "reps">): MissingField | null {
    if (exercise.recording.type === "duration") return null;
    if (this.needsExternalWeight(exercise) && !(set.weight > 0)) return "weight";
    if (!(set.reps >= 1)) return "reps";
    return null;
  }

  static message(field: MissingField) {
    return field === "weight"
      ? "Вес не введён — подход без веса не считается. Введи вес и отметь ещё раз."
      : "Повторы не введены. Введи повторы и отметь ещё раз.";
  }
}
