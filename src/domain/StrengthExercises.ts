import { ExecutionIdentity } from "./ExecutionIdentity";
import { progressKey } from "../lib/catalog";
import type { Workout, WorkoutExercise } from "../lib/types";

export type StrengthOption = { key: string; we: WorkoutExercise; lastDate: string; workouts: number };

/**
 * Упражнения для «Прогресс → Сила»: только те, по которым есть выполненные рабочие подходы.
 * Сначала недавно тренированные, затем чаще встречающиеся. Ряд — это упражнение, версия каталога и правило записи
 * (progressKey), поэтому записи с разными правилами остаются разными рядами.
 */
export class StrengthExercises {
  static list(workouts: Workout[]): StrengthOption[] {
    const rows = new Map<string, StrengthOption>();
    for (const workout of workouts)
      for (const entry of workout.exercises)
        for (const part of ExecutionIdentity.split(entry)) {
          if (!part.sets.some((set) => set.done && !set.warmup)) continue;
          const key = progressKey(part);
          const row = rows.get(key);
          if (!row) rows.set(key, { key, we: part, lastDate: workout.date, workouts: 1 });
          else {
            row.workouts++;
            if (workout.date > row.lastDate) {
              row.lastDate = workout.date;
              row.we = part;
            }
          }
        }
    return [...rows.values()].sort(
      (a, b) => b.lastDate.localeCompare(a.lastDate) || b.workouts - a.workouts || a.key.localeCompare(b.key),
    );
  }
}
