import { AnalyticsFacts, type FactsOptions } from "./AnalyticsFacts";
import { ExecutionIdentity } from "./ExecutionIdentity";
import { localDate } from "../lib/calendar";
import type { Workout, WorkoutExercise } from "../lib/types";

export class WorkoutReference {
  static latest(
    history: Workout[],
    entry: WorkoutExercise,
    excludeId?: string,
    referenceDate = localDate(),
    options: FactsOptions = {},
  ) {
    const eligible = new AnalyticsFacts(
      history.filter((w) => w.id !== excludeId),
      { ...options, through: referenceDate, setKind: "all" },
    ).workouts();
    const key = ExecutionIdentity.key(entry);
    return eligible
      .sort(
        (a, b) =>
          b.date.localeCompare(a.date) ||
          (b.createdAt ?? "").localeCompare(a.createdAt ?? "") ||
          b.id.localeCompare(a.id),
      )
      .flatMap((w) => w.exercises.flatMap((e) => ExecutionIdentity.split(e)))
      .find(
        (e) =>
          ExecutionIdentity.key(e) === key && e.sets.some((s) => !s.warmup),
      );
  }
}
