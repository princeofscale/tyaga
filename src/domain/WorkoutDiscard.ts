import type { Draft } from "../lib/draft";

/** Решает, нужен ли вопрос при отмене тренировки: спрашиваем только когда есть что потерять. */
export class WorkoutDiscard {
  /** В тренировке есть хотя бы один выполненный подход (в том числе разминочный). */
  static hasRecordedSets(draft: Draft): boolean {
    return draft.workout.exercises.some((exercise) => exercise.sets.some((set) => set.done));
  }

  /**
   * Правка сохранённой тренировки всегда спрашивает: изменения в черновике
   * нельзя отличить от нетронутой копии, а исходная запись должна остаться целой.
   * Новая тренировка без выполненных подходов отменяется сразу.
   */
  static needsConfirmation(draft: Draft): boolean {
    return !!draft.editing || this.hasRecordedSets(draft);
  }
}
