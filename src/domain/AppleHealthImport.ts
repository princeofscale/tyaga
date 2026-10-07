import { SaxesParser } from "saxes";
import type { WearableSummary } from "../lib/types";
import { localDate } from "../lib/calendar";
export const STRENGTH_TYPES = ["HKWorkoutActivityTypeTraditionalStrengthTraining", "HKWorkoutActivityTypeFunctionalStrengthTraining"] as const;
export function healthDate(value: string) {
  const match = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) ([+-]\d{2})(\d{2})$/.exec(value);
  const iso = match ? `${match[1]}T${match[2]}${match[3]}:${match[4]}` : value;
  // Export timestamps must include an offset; never assume this device's zone.
  if (!/(?:Z|[+-]\d{2}:?\d{2})$/.test(iso)) return NaN;
  return Date.parse(iso);
}
const numeric = (value: string | undefined) => value !== undefined && value.trim() !== "" && Number.isFinite(Number(value)) ? Number(value) : undefined;
function calories(value: string | undefined, unit: string | undefined) {
  const n = numeric(value); if (n === undefined || n < 0) return undefined;
  return unit === "kcal" ? n : unit === "kJ" ? n / 4.184 : undefined;
}
function pulse(value: string | undefined, unit: string | undefined) {
  const n = numeric(value); if (n === undefined) return undefined;
  const bpm = unit === "count/min" || unit === "bpm" ? n : unit === "Hz" ? n * 60 : NaN;
  return bpm > 0 && bpm <= 400 ? bpm : undefined;
}
type Candidate = WearableSummary & { key: string; durationMinutes: number };
type HeartSample = { start:number; end:number; value:number; source:string };
/** Streaming XML: retain only strength workouts and HR for the selected day. */
export class AppleHealthImport {
  private parser = new SaxesParser({ xmlns:false });
  private candidates: Candidate[] = [];
  private hearts: HeartSample[] = [];
  private current: Candidate | null = null;
  private failure: Error | null = null;
  private rootSeen = false;
  private bytes = 0;
  constructor(private date: string, private timeZone: string) {
    const center = Date.parse(`${date}T00:00:00Z`);
    this.parser.on("error", e => { this.failure = e; });
    this.parser.on("opentag", tag => {
      const a = tag.attributes as Record<string,string>;
      if (tag.name === "HealthData") this.rootSeen = true;
      if (tag.name === "Record" && a.type === "HKQuantityTypeIdentifierHeartRate") {
        const start = healthDate(a.startDate ?? ""), end = healthDate(a.endDate ?? ""), value = pulse(a.value,a.unit);
        if (value !== undefined && Number.isFinite(start) && Number.isFinite(end) && end >= start && start >= center - 18 * 3600000 && start <= center + 42 * 3600000) {
          if (this.hearts.length >= 20000) throw new Error("В выбранном дне слишком много показаний пульса. Используй меньший XML-экспорт.");
          this.hearts.push({ start, end, value, source:a.sourceName ?? "" });
        }
      }
      if (tag.name === "Workout") {
        this.current = null;
        const start = healthDate(a.startDate ?? ""), end = healthDate(a.endDate ?? "");
        if (!STRENGTH_TYPES.includes(a.workoutActivityType as typeof STRENGTH_TYPES[number]) || !Number.isFinite(start) || !Number.isFinite(end) || end <= start || end - start > 86400000 || localDate(new Date(start),timeZone) !== date) return;
        if (this.candidates.length >= 50) throw new Error("Слишком много силовых тренировок за день");
        const energy = calories(a.totalEnergyBurned,a.totalEnergyBurnedUnit);
        const duration = numeric(a.duration), durationMinutes = duration !== undefined ? a.durationUnit === "min" ? duration : a.durationUnit === "s" ? duration/60 : (end-start)/60000 : (end-start)/60000;
        this.current = { key:`${start}:${end}:${a.sourceName ?? ""}`, provider:"apple-health", sourceName:(a.sourceName ?? "Apple Health").slice(0,120), activityType:a.workoutActivityType as WearableSummary["activityType"], startedAt:new Date(start).toISOString(), endedAt:new Date(end).toISOString(), importedAt:new Date().toISOString(), heartRateSamples:0, durationMinutes,
          ...(energy !== undefined ? { caloriesKcal:energy, energyKind:"reported" as const } : {}) };
      }
      if (tag.name === "WorkoutStatistics" && this.current) {
        if (a.type === "HKQuantityTypeIdentifierActiveEnergyBurned") {
          const energy = calories(a.sum,a.unit);
          if (energy !== undefined) { this.current.caloriesKcal = energy; this.current.energyKind = "active"; }
        }
        if (a.type === "HKQuantityTypeIdentifierHeartRate") {
          this.current.heartRateAverage = pulse(a.average,a.unit);
          this.current.heartRateMin = pulse(a.minimum,a.unit);
          this.current.heartRateMax = pulse(a.maximum,a.unit);
        }
      }
    });
    this.parser.on("closetag", tag => {
      if (tag.name === "Workout" && this.current) { this.candidates.push(this.current); this.current = null; }
    });
  }
  write(chunk: string) {
    this.bytes += chunk.length;
    if (this.bytes > 1024 * 1024 * 1024) throw new Error("XML больше 1 ГБ. Нужен экспорт с меньшим объёмом данных.");
    this.parser.write(chunk); if (this.failure) throw new Error("XML повреждён или не поддерживается. Выбери export.xml из Apple Health.");
  }
  finish(): Candidate[] {
    this.parser.close();
    if (this.failure || !this.rootSeen) throw new Error("Нужен XML-экспорт приложения Apple Health");
    return this.candidates.map(candidate => {
      const start = Date.parse(candidate.startedAt), end = Date.parse(candidate.endedAt);
      const unique = new Map<string,HeartSample>();
      for (const sample of this.hearts) if (sample.source === candidate.sourceName && sample.start >= start && sample.end <= end)
        unique.set(`${sample.start}:${sample.end}:${sample.value}`,sample);
      const samples = [...unique.values()];
      return { ...candidate, heartRateSamples:samples.length,
        // Prefer workout statistics supplied by Apple; sampled averages are
        // simple sample means, never disguised as time-weighted physiology.
        ...(samples.length ? {
          heartRateAverage:candidate.heartRateAverage ?? samples.reduce((n,s)=>n+s.value,0)/samples.length,
          heartRateMin:candidate.heartRateMin ?? Math.min(...samples.map(s=>s.value)),
          heartRateMax:candidate.heartRateMax ?? Math.max(...samples.map(s=>s.value)),
        } : {}) };
    }).sort((a,b)=>a.startedAt.localeCompare(b.startedAt));
  }
}
export type { Candidate as HealthWorkoutCandidate };
