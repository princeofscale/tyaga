import { AnalyticsFacts } from "./AnalyticsFacts";
import { TrainingVolume } from "./TrainingVolume";
import { TrainingAnalytics } from "./TrainingAnalytics";
import { DEFAULT_SETTINGS, volumeSummary } from "../lib/model";
import type { Workout, Settings } from "../lib/types";
import { exerciseForEntry } from "../lib/catalog";

/** A journal report, not an estimate of physiological stimulus or recovery. */
export class SessionReport {
  constructor(private workout: Workout, private settings: Settings = DEFAULT_SETTINGS) {}
  get sets() {
    const done = new AnalyticsFacts([this.workout], { setKind: "all", timeZone:this.settings.timeZone }).sets().map((f)=>f.set);
    return { working: done.filter(s => !s.warmup).length, warmup: done.filter(s => s.warmup).length, total: done.length };
  }
  get volume() {
    return { working: volumeSummary([this.workout], "working",{timeZone:this.settings.timeZone}), warmup: volumeSummary([this.workout], "warmup",{timeZone:this.settings.timeZone}), all: volumeSummary([this.workout], "all",{timeZone:this.settings.timeZone}) };
  }
  get machineVolume() { return TrainingVolume.machines([this.workout], { timeZone: this.settings.timeZone }); }
  get density() {
    const facts = new AnalyticsFacts([this.workout], { timeZone: this.settings.timeZone }).sets();
    const supersets = new Set(facts.map((f)=>f.entry.supersetId).filter(Boolean));
    return { workingSets: facts.length, supersetGroups: supersets.size,
      setsPerMinute: this.workout.duration > 0 && Number.isFinite(this.workout.duration) ? facts.length / this.workout.duration : null };
  }
  get muscles() {
    const work = new TrainingAnalytics([this.workout],{timeZone:this.settings.timeZone}).zoneLoad(this.settings);
    const warm = new TrainingAnalytics([this.workout], { setKind: "warmup", timeZone:this.settings.timeZone }).zoneLoad(this.settings);
    return work.map((row, i) => ({ ...row, warmup: warm[i].direct, warmupAssisting: warm[i].indirect }))
      .filter(r => r.direct || r.indirect || r.warmup || r.warmupAssisting);
  }
  get unmappedSets() {
    return new AnalyticsFacts([this.workout], { setKind: "all", timeZone:this.settings.timeZone }).sets()
      .filter(({exercise})=>!exercise||(!exercise.primary.length&&!exercise.muscles.length)).length;
  }
}
