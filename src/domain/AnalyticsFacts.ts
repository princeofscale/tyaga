import { ExecutionProfile } from "./ExecutionProfile";
import { exerciseForEntry } from "../lib/catalog";
import { isCalendarDate, localDate } from "../lib/calendar";
import type {
  Exercise,
  SetEntry,
  Workout,
  WorkoutExercise,
} from "../lib/types";

export interface FactsOptions {
  from?: string;
  through?: string;
  now?: Date;
  timeZone?: string;
  includeFuture?: boolean;
  setKind?: "working" | "warmup" | "all";
  completedOnly?: boolean;
  maxRir?: number;
}
export interface SetFact {
  workout: Workout;
  entry: WorkoutExercise;
  set: SetEntry;
  exercise?: Exercise;
}
export interface FactsDiagnostics {
  invalidSets: number;
  duplicateSets: number;
  duplicateWorkouts: number;
  invalidDates: number;
}

/** One immutable view of eligible journal facts, shared by all aggregations. */
export class AnalyticsFacts {
  constructor(
    private readonly history: Workout[],
    private readonly options: FactsOptions = {},
  ) {}

  static validSet(set: SetEntry, entry?: WorkoutExercise): boolean {
    const finite = (n: number, min: number, max: number) =>
      Number.isFinite(n) && n >= min && n <= max;
    try {
      if (set.execution !== undefined) ExecutionProfile.parse(set.execution);
      if (entry?.execution !== undefined)
        ExecutionProfile.parse(entry.execution);
    } catch {
      return false;
    }
    const spec = entry ? exerciseForEntry(entry)?.recording : undefined;
    return (
      typeof set.id === "string" &&
      set.id.length > 0 &&
      typeof set.done === "boolean" &&
      typeof set.warmup === "boolean" &&
      finite(set.weight, 0, 1000) &&
      finite(set.reps, 1, 200) &&
      Number.isInteger(set.reps) &&
      (set.rir === null || finite(set.rir, 0, 10)) &&
      (set.assistanceKg === undefined || finite(set.assistanceKg, 0, 1000)) &&
      (spec?.type !== "duration" ||
        (finite(set.durationSeconds ?? NaN, 1, 86400) &&
          Number.isInteger(set.durationSeconds))) &&
      (set.distanceKm === undefined || finite(set.distanceKm, 0, 1000)) &&
      (set.performedSides === undefined ||
        ["both", "left", "right"].includes(set.performedSides))
    );
  }

  read(): { sets: SetFact[]; diagnostics: FactsDiagnostics } {
    const diagnostics = {
      invalidSets: 0,
      duplicateSets: 0,
      duplicateWorkouts: 0,
      invalidDates: 0,
    };
    const today = localDate(
      this.options.now ?? new Date(),
      this.options.timeZone ??
        (this.history.length === 1 ? this.history[0].timeZone : undefined),
    );
    const through = this.options.includeFuture
      ? this.options.through
      : this.options.through && this.options.through < today
        ? this.options.through
        : today;
    const unique = new Map<string, Workout>();
    for (const workout of this.history) {
      const previous = unique.get(workout.id);
      if (previous) diagnostics.duplicateWorkouts++;
      if (
        !previous ||
        (workout.revision ?? 0) > (previous.revision ?? 0) ||
        ((workout.revision ?? 0) === (previous.revision ?? 0) &&
          (workout.updatedAt ?? "") > (previous.updatedAt ?? ""))
      )
        unique.set(workout.id, workout);
    }
    const sets: SetFact[] = [];
    for (const workout of unique.values()) {
      if (!isCalendarDate(workout.date)) {
        diagnostics.invalidDates++;
        continue;
      }
      if (
        (this.options.from && workout.date < this.options.from) ||
        (through && workout.date > through)
      )
        continue;
      const seen = new Set<string>();
      for (const entry of workout.exercises) {
        const exercise = exerciseForEntry(entry);
        for (const set of entry.sets) {
          if (!AnalyticsFacts.validSet(set, entry)) {
            diagnostics.invalidSets++;
            continue;
          }
          if (seen.has(set.id)) {
            diagnostics.duplicateSets++;
            continue;
          }
          seen.add(set.id);
          if (this.options.completedOnly !== false && !set.done) continue;
          const kind = this.options.setKind ?? "working";
          if (kind !== "all" && (kind === "warmup" ? !set.warmup : set.warmup))
            continue;
          if (
            this.options.maxRir !== undefined &&
            (set.rir === null || set.rir > this.options.maxRir)
          )
            continue;
          sets.push({ workout, entry, set, exercise });
        }
      }
    }
    return { sets, diagnostics };
  }

  sets() {
    return this.read().sets;
  }

  /** Copies only eligible sets; source records and catalog snapshots stay untouched. */
  workouts(): Workout[] {
    const result = new Map<string, Workout>();
    for (const fact of this.sets()) {
      let workout = result.get(fact.workout.id);
      if (!workout) {
        workout = { ...fact.workout, exercises: [] };
        result.set(workout.id, workout);
      }
      let entry = workout.exercises.find(
        (e) => e === fact.entry || e.exerciseId === fact.entry.exerciseId,
      );
      if (!entry) {
        entry = { ...fact.entry, sets: [] };
        workout.exercises.push(entry);
      }
      entry.sets.push(fact.set);
    }
    return [...result.values()];
  }
}
