import { MUSCLES, ANATOMICAL_MUSCLES } from "../data/muscles";
import { exerciseById, exerciseForEntry } from "../lib/catalog";
import type { Workout, Settings, MuscleLoad, Exercise } from "../lib/types";
import { AnalyticsFacts, type FactsOptions } from "./AnalyticsFacts";
import { MuscleParticipation } from "./MuscleParticipation";
export interface AnalysisOptions extends FactsOptions {
  mapping?: "recorded" | "current";
  maxRir?: number;
  setKind?: "working" | "warmup" | "all";
}
export class TrainingAnalytics {
  constructor(
    private workouts: Workout[],
    private options: AnalysisOptions = {},
  ) {}
  *observations(): Generator<{ exercise: Exercise; count: number; muscleModelRevision: number }> {
    for (const fact of new AnalyticsFacts(this.workouts, this.options).sets()) {
      const exercise = this.options.mapping === "current" ? exerciseById(fact.entry.exerciseId) : fact.exercise;
      if (exercise) yield { exercise, count: 1, muscleModelRevision: this.options.mapping === "current" ? 1 : fact.entry.muscleModelRevision ?? 1 };
    }
  }
  zoneLoad(settings?: Settings): MuscleLoad[] {
    const loads = MUSCLES.map((m) => ({
      ...m,
      direct: 0,
      indirect: 0,
      stabilizing: 0,
      total: 0,
      goal: settings?.goals[m.id] ?? m.goal,
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
    for (const { exercise, count, muscleModelRevision } of this.observations()) {
      for (const role of MuscleParticipation.roles(exercise,muscleModelRevision)) {
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
    }
    return rows;
  }
}
