import { exerciseForEntry } from "../lib/catalog";
import { WarmupLadderCalculator } from "./WarmupLadderCalculator";
import type { SetEntry, WorkoutExercise } from "../lib/types";

export class WarmupPlanner {
  constructor(private entry: WorkoutExercise) {}

  create(): SetEntry[] {
    const spec = exerciseForEntry(this.entry)?.recording;
    const target = this.entry.sets.find((s) => !s.warmup)?.weight ?? 0;
    if (!spec || spec.type === "duration" || !["total_external", "per_implement"].includes(spec.loadMode) || target <= 0 || this.entry.sets.length > 27) return [];
    // Editable logging scaffold, not an individualized warm-up prescription.
    const step = spec.loadMode === "per_implement" ? 1 : 2.5;
    return [0.4, 0.6, 0.8].map((fraction, i) => ({
      id: crypto.randomUUID(),
      weight: Math.max(step, Math.round((target * fraction) / step) * step),
      reps: [8, 5, 3][i],
      rir: null,
      warmup: true,
      done: false,
    }));
  }

  /**
   * Прогрессивная разминочная лесенка под тяжёлый топ-сет (например, база Дэвида Лейда 1×1 / 1×3 / 1×5):
   * пустой гриф → 50 % → 70 % → 82 % → 90 % без лишнего утомления перед рабочим весом.
   */
  createForTopSet(barWeightKg = 20): SetEntry[] {
    const spec = exerciseForEntry(this.entry)?.recording;
    const top = this.entry.sets.find((s) => !s.warmup);
    const target = top?.weight ?? 0;
    if (!spec || spec.type === "duration" || spec.loadMode !== "total_external" || target <= barWeightKg || this.entry.sets.length > 24) {
      return this.create();
    }
    const ladder = WarmupLadderCalculator.generateLadder(target, top?.reps || 5, barWeightKg).filter(
      (step) => !step.isWorkSet,
    );
    if (!ladder.length) return this.create();
    return ladder.map((step) => ({
      id: crypto.randomUUID(),
      weight: step.weightKg,
      reps: step.reps,
      rir: null,
      warmup: true,
      done: false,
    }));
  }
}
