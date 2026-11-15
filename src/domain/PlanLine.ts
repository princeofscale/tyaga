import type { WorkoutExercise } from "../lib/types";

/**
 * Строка упражнения в плане дня («Сегодня по программе»): «3 × 8–12», «3 × 10» или «3 подх.».
 * Считаются только рабочие подходы; повторов нет — число повторов не показывается, но и нуля не будет.
 */
export class PlanLine {
  static sets(exercise: Pick<WorkoutExercise, "sets" | "repMin" | "repMax">): string {
    const working = exercise.sets.filter((set) => !set.warmup);
    if (!working.length) return "разминка";
    const count = working.length;
    const low = exercise.repMin ?? exercise.repMax;
    const high = exercise.repMax ?? exercise.repMin;
    if (low !== undefined && high !== undefined && low > 0 && high > 0)
      return low === high ? `${count} × ${low}` : `${count} × ${Math.min(low, high)}–${Math.max(low, high)}`;
    const reps = working.map((set) => set.reps).filter((value) => Number.isFinite(value) && value > 0);
    if (!reps.length) return `${count} подх.`;
    const min = Math.min(...reps);
    const max = Math.max(...reps);
    return min === max ? `${count} × ${min}` : `${count} × ${min}–${max}`;
  }
}
