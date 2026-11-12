import { AnalyticsFacts, type FactsOptions } from "./AnalyticsFacts";
import { ExecutionIdentity } from "./ExecutionIdentity";
import { exerciseForEntry } from "../lib/catalog";
import type { SetEntry, Workout, WorkoutExercise } from "../lib/types";

export class TrainingVolume {
  static summarize(
    workouts: Workout[],
    kind: "working" | "warmup" | "all" = "working",
    options: FactsOptions = {},
  ) {
    const { sets, diagnostics } = new AnalyticsFacts(workouts, {
      ...options,
      setKind: kind,
    }).read();
    let total = 0,
      omittedSets = 0;
    for (const { entry, set, exercise } of sets) {
      const spec = exercise?.recording;
      if (
        !spec ||
        spec.type === "duration" ||
        !["total_external", "per_implement"].includes(spec.loadMode)
      ) {
        omittedSets++;
        continue;
      }
      total += this.setLoadVolume(entry, set);
    }
    return {
      total,
      omittedSets,
      invalidSets: diagnostics.invalidSets,
      duplicateSets: diagnostics.duplicateSets,
      invalidDates: diagnostics.invalidDates,
    };
  }
  static setLoadVolume(entry: WorkoutExercise, set: SetEntry) {
    const spec = exerciseForEntry(entry)?.recording;
    if (!spec || !AnalyticsFacts.validSet(set, entry)) return 0;
    const sides =
      spec.repsMode === "per_side" &&
      (set.performedSides ?? entry.performedSides ?? "both") === "both"
        ? 2
        : 1;
    const value = set.weight * set.reps * spec.implementCount * sides;
    return Number.isFinite(value) && value >= 0 ? value : 0;
  }
  static e1rm(set: SetEntry, entry: WorkoutExercise) {
    const spec = exerciseForEntry(entry)?.recording;
    if (
      !spec?.e1rmEligible ||
      spec.type === "duration" ||
      !AnalyticsFacts.validSet(set, entry) ||
      !set.done ||
      set.warmup ||
      set.weight <= 0 ||
      set.reps > 12
    )
      return null;
    return set.reps === 1 ? set.weight : set.weight * (1 + set.reps / 30);
  }
  /** Machine markings are compared only within the same movement/station/context. */
  static machines(workouts: Workout[], options: FactsOptions = {}) {
    const rows = new Map<
      string,
      {
        key: string;
        exerciseId: string;
        machineId?: string;
        label: string;
        volume: number;
        sets: number;
      }
    >();
    for (const { entry, set, exercise } of new AnalyticsFacts(
      workouts,
      options,
    ).sets()) {
      if (
        exercise?.recording.loadMode !== "machine_stack" ||
        exercise.recording.type === "duration"
      )
        continue;
      const key = ExecutionIdentity.key(entry, set);
      const row = rows.get(key) ?? {
        key,
        exerciseId: entry.exerciseId,
        machineId: entry.machineInstanceId,
        label:
          entry.machineSnapshot?.nickname ??
          entry.equipmentNote ??
          "Тренажёр не указан",
        volume: 0,
        sets: 0,
      };
      row.volume += this.setLoadVolume(entry, set);
      row.sets++;
      rows.set(key, row);
    }
    return [...rows.values()];
  }
}
