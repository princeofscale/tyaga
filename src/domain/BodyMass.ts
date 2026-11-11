import type { BodyweightEntry } from "./BodyweightTracker";
import {
  exerciseForEntry,
  type Workout,
  type WorkoutExercise,
} from "../lib/model";

/** A new entry takes the latest weighing on its date; saved workout snapshots stay independent. */
export class BodyMass {
  static at(entries: BodyweightEntry[], date: string, fallback: number | null) {
    return (
      entries
        .filter((e) => e.date <= date)
        .sort((a, b) => a.date.localeCompare(b.date))
        .at(-1)?.weightKg ?? fallback
    );
  }
  static entry(entry: WorkoutExercise, mass: number | null): WorkoutExercise {
    return mass !== null &&
      ["bodyweight", "added_bodyweight", "assisted_bodyweight"].includes(
        exerciseForEntry(entry)?.recording.loadMode ?? "",
      )
      ? { ...entry, bodyMassKg: mass }
      : entry;
  }
  static workout(workout: Workout, mass: number | null): Workout {
    return {
      ...workout,
      exercises: workout.exercises.map((e) => this.entry(e, mass)),
    };
  }
}
