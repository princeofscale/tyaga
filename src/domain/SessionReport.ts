import { TrainingAnalytics } from "./TrainingAnalytics";
import { DEFAULT_SETTINGS, volumeSummary } from "../lib/model";
import type { Workout, Settings } from "../lib/types";
import { exerciseForEntry } from "../lib/catalog";

/** A journal report, not an estimate of physiological stimulus or recovery. */
export class SessionReport {
  constructor(private workout: Workout, private settings: Settings = DEFAULT_SETTINGS) {}
  get sets() {
    const done = this.workout.exercises.flatMap(e => e.sets).filter(s => s.done);
    return { working: done.filter(s => !s.warmup).length, warmup: done.filter(s => s.warmup).length, total: done.length };
  }
  get volume() {
    return { working: volumeSummary([this.workout]), warmup: volumeSummary([this.workout], "warmup"), all: volumeSummary([this.workout], "all") };
  }
  get muscles() {
    const work = new TrainingAnalytics([this.workout]).zoneLoad(this.settings);
    const warm = new TrainingAnalytics([this.workout], { setKind: "warmup" }).zoneLoad(this.settings);
    return work.map((row, i) => ({ ...row, warmup: warm[i].direct, warmupAssisting: warm[i].indirect }))
      .filter(r => r.direct || r.indirect || r.warmup || r.warmupAssisting);
  }
  get unmappedSets() {
    // Saved custom and source-only movements remain visible as journal work.
    return this.workout.exercises.filter(e => {
      const exercise = exerciseForEntry(e);
      return !exercise || (!exercise.primary.length && !exercise.muscles.length);
    })
      .reduce((n,e) => n + e.sets.filter(s => s.done).length, 0);
  }
}
