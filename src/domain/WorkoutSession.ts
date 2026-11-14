import { AnalyticsFacts } from "./AnalyticsFacts";
import type { Workout, WorkoutExercise } from "../lib/types";
export class WorkoutSession {
  constructor(private workout: Workout) {}
  get completedWorkingSets() {
    return new AnalyticsFacts([this.workout]).sets().length;
  }
  add(exercise: WorkoutExercise): Workout {
    if (
      this.workout.exercises.length >= 30 ||
      this.workout.exercises.some((e) => e.exerciseId === exercise.exerciseId)
    )
      return this.workout;
    return {
      ...this.workout,
      exercises: [...this.workout.exercises, exercise],
    };
  }
  completedWithDuration(minutes: number): Workout {
    if (!this.completedWorkingSets)
      throw new Error("Отметь хотя бы один выполненный рабочий подход.");
    if (!Number.isFinite(minutes))
      throw new Error("Проверь длительность тренировки.");
    return { ...this.workout, duration: Math.max(0, Math.min(1440, minutes)) };
  }
  separateCopy(): Workout {
    return {
      ...this.workout,
      id: crypto.randomUUID(),
      revision: 0,
      createdAt: new Date().toISOString(),
      name: `${this.workout.name} (копия)`.slice(0, 120),
    };
  }
}
