import { exerciseForEntry } from "../lib/catalog";
import type { SetEntry, WorkoutExercise } from "../lib/types";
export class WarmupPlanner {
  constructor(private entry: WorkoutExercise) {}
  create(): SetEntry[] {
    const spec = exerciseForEntry(this.entry)?.recording;
    const target = this.entry.sets.find(s => !s.warmup)?.weight ?? 0;
    if (!spec || spec.type === "duration" || !["total_external", "per_implement"].includes(spec.loadMode) || target <= 0 || this.entry.sets.length > 27) return [];
    // Editable logging scaffold, not an individualized warm-up prescription.
    const step = spec.loadMode === "per_implement" ? 1 : 2.5;
    return [0.4,0.6,0.8].map((fraction,i) => ({
      id: crypto.randomUUID(), weight: Math.max(step, Math.round(target * fraction / step) * step),
      reps: [8,5,3][i], rir: null, warmup: true, done: false,
    }));
  }
}
