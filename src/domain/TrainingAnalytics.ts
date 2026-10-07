import { MUSCLES, ANATOMICAL_MUSCLES } from "../data/muscles";
import { exerciseById, exerciseForEntry } from "../lib/catalog";
import type { Workout, Settings, MuscleLoad, Exercise } from "../lib/types";
export interface AnalysisOptions {
  mapping?: "recorded" | "current";
  maxRir?: number;
}
export class TrainingAnalytics {
  constructor(
    private workouts: Workout[],
    private options: AnalysisOptions = {},
  ) {}
  private *observations(): Generator<{ exercise: Exercise; count: number }> {
    for (const workout of this.workouts)
      for (const entry of workout.exercises) {
        const exercise =
          this.options.mapping === "current"
            ? exerciseById(entry.exerciseId)
            : exerciseForEntry(entry);
        if (!exercise) continue;
        const count = entry.sets.filter(
          (s) =>
            s.done &&
            !s.warmup &&
            (this.options.maxRir === undefined ||
              (s.rir !== null && s.rir <= this.options.maxRir)),
        ).length;
        if (count) yield { exercise, count };
      }
  }
  zoneLoad(settings: Settings): MuscleLoad[] {
    const loads = MUSCLES.map((m) => ({
      ...m,
      direct: 0,
      indirect: 0,
      stabilizing: 0,
      total: 0,
      goal: settings.goals[m.id] ?? m.goal,
      ratio: 0,
    }));
    const zones = new Map(ANATOMICAL_MUSCLES.map((m) => [m.id, m.zone]));
    for (const { exercise: e, count } of this.observations()) {
      const stabilizers = new Set(
        e.muscles
          .filter((m) => m.role === "stabilizer")
          .map((m) => zones.get(m.muscleId)),
      );
      for (const load of loads) {
        if (e.primary.includes(load.id)) load.direct += count;
        else if (e.secondary.includes(load.id)) load.indirect += count;
        if (stabilizers.has(load.id)) load.stabilizing += count;
      }
    }
    return loads.map((m) => ({
      ...m,
      total: m.direct,
      ratio: m.direct / m.goal,
    }));
  }
  anatomicalLoad() {
    const rows = ANATOMICAL_MUSCLES.map((m) => ({
      ...m,
      direct: 0,
      assisting: 0,
      stabilizing: 0,
    }));
    const byId = new Map(rows.map((r) => [r.id, r]));
    for (const { exercise, count } of this.observations())
      for (const role of exercise.muscles) {
        const row = byId.get(role.muscleId);
        if (!row) continue;
        row[
          role.role === "primary"
            ? "direct"
            : role.role === "assistant"
              ? "assisting"
              : "stabilizing"
        ] += count;
      }
    return rows;
  }
}
