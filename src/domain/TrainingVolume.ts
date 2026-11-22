import { AnalyticsFacts, type FactsOptions } from "./AnalyticsFacts";
import { OneRepMaxFormulas } from "./OneRepMaxFormulas";
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
    return OneRepMaxFormulas.epley(set.weight, set.reps);
  }
  /**
   * Эффективный коэффициент передачи тренажёра из его калибровки (`pulleyRatio * stackRatio`).
   * Например, для полиспаста 2:1 (`pulleyRatio: 0.5`) 50 кг на стеке дают 25 кг реального сопротивления на рукояти.
   */
  static machineEffectiveFactor(entry: WorkoutExercise): number {
    const cal = entry.machineSnapshot?.calibration;
    if (!cal) return 1;
    const stack =
      typeof cal.stackRatio === "number" && Number.isFinite(cal.stackRatio) && cal.stackRatio > 0
        ? cal.stackRatio
        : 1;
    const pulley =
      typeof cal.pulleyRatio === "number" && Number.isFinite(cal.pulleyRatio) && cal.pulleyRatio > 0
        ? cal.pulleyRatio
        : 1;
    return Math.round(stack * pulley * 1000) / 1000;
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
        calibratedVolume?: number;
        calibrationFactor?: number;
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
      const factor = this.machineEffectiveFactor(entry);
      const row = rows.get(key) ?? {
        key,
        exerciseId: entry.exerciseId,
        machineId: entry.machineInstanceId,
        label:
          entry.machineSnapshot?.nickname ??
          entry.equipmentNote ??
          "Тренажёр не указан",
        volume: 0,
        ...(factor !== 1 ? { calibratedVolume: 0, calibrationFactor: factor } : {}),
        sets: 0,
      };
      const setVol = this.setLoadVolume(entry, set);
      row.volume += setVol;
      if (row.calibratedVolume !== undefined) {
        row.calibratedVolume = Math.round((row.calibratedVolume + setVol * factor) * 10) / 10;
      }
      row.sets++;
      rows.set(key, row);
    }
    return [...rows.values()];
  }
}
