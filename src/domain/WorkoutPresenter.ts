import { MUSCLES } from "../data/muscles";
import { exerciseForEntry } from "../lib/model";
import type { Workout } from "../lib/types";

export const DEFAULT_WORKOUT_NAME = "Новая тренировка";

/** Как тренировка выглядит в списках: название и главные мышцы. */
export class WorkoutPresenter {
  /** Мышцы по убыванию числа рабочих подходов, у которых они основные. */
  static topMuscles(workout: Workout, limit = 3): string[] {
    const sets = new Map<string, number>();
    for (const entry of workout.exercises) {
      const exercise = exerciseForEntry(entry);
      if (!exercise) continue;
      const count = entry.sets.filter((s) => !s.warmup).length || 1;
      for (const muscle of exercise.primary) sets.set(muscle, (sets.get(muscle) ?? 0) + count);
    }
    return [...sets.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([id]) => MUSCLES.find((m) => m.id === id)?.short ?? id);
  }

  /** Своё название остаётся как есть; безликое «Новая тренировка» заменяется на мышцы. */
  static title(workout: Workout): string {
    const name = workout.name.trim();
    if (name && name !== DEFAULT_WORKOUT_NAME) return name;
    const muscles = WorkoutPresenter.topMuscles(workout, 2);
    if (!muscles.length) return "Тренировка";
    return muscles.length === 1 ? muscles[0] : `${muscles[0]} и ${muscles[1].toLowerCase()}`;
  }
}
