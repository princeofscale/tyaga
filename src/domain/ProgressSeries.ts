import {
  estimatedOneRepMax,
  progressKey,
  recordedLoad,
  exerciseForEntry,
  type Workout,
  type WorkoutExercise,
  type SetEntry,
} from "../lib/model";

export interface ChartPoint {
  id: string;
  date: string;
  value: number;
  trend?: number;
  note?: string;
  detail?: string;
}
export interface StrengthPoint {
  id: string;
  date: string;
  max: number;
  e1rm: number;
  reps: number;
  sets: SetEntry[];
}

/** Calendar-based chart geometry and comparable strength metrics, shared by both screens. */
export class ProgressSeries {
  /** Returns the best observed value, reversing comparison for assistance loads. */
  static best(points: StrengthPoint[], lowerIsBetter = false): number | null {
    if (!points.length) return null;
    const values = points.map((point) => point.max);
    return lowerIsBetter ? Math.min(...values) : Math.max(...values);
  }
  static metric(entry: WorkoutExercise) {
    const spec = exerciseForEntry(entry)?.recording;
    return {
      unit:
        spec?.type === "duration"
          ? "с"
          : spec?.loadMode === "bodyweight"
            ? "повт."
            : "кг",
      lowerIsBetter: spec?.loadMode === "assisted_bodyweight",
    };
  }
  static value(entry: WorkoutExercise, set: SetEntry) {
    const spec = exerciseForEntry(entry)?.recording;
    return spec?.type === "duration"
      ? (set.durationSeconds ?? 0)
      : spec?.loadMode === "bodyweight"
        ? set.reps
        : recordedLoad(entry, set);
  }
  /** Omits uncompleted sessions; reps refer to the best set, never the sum of the workout. */
  static strength(workouts: Workout[], key: string): StrengthPoint[] {
    return [...workouts]
      .sort(
        (a, b) =>
          a.date.localeCompare(b.date) ||
          (a.createdAt ?? "").localeCompare(b.createdAt ?? "") ||
          a.id.localeCompare(b.id),
      )
      .flatMap((w) => {
        const entries = w.exercises.filter((e) => progressKey(e) === key);
        const candidates = entries.flatMap((entry) =>
          entry.sets
            .filter((s) => s.done && !s.warmup)
            .map((set) => ({ entry, set, value: this.value(entry, set) })),
        );
        if (!candidates.length) return [];
        const lower = this.metric(candidates[0].entry).lowerIsBetter;
        candidates.sort(
          (a, b) =>
            (lower ? a.value - b.value : b.value - a.value) ||
            b.set.reps - a.set.reps,
        );
        const best = candidates[0];
        return [
          {
            id: w.id,
            date: w.date,
            max: best.value,
            reps:
              exerciseForEntry(best.entry)?.recording.type === "duration"
                ? (best.set.durationSeconds ?? 0)
                : best.set.reps,
            e1rm: Math.max(
              0,
              ...candidates.map((c) => estimatedOneRepMax(c.set, c.entry) ?? 0),
            ),
            sets: candidates.map((c) => c.set),
          },
        ];
      });
  }
  /** Scales x by elapsed calendar days and y by observed values only, keeping remote goals out. */
  static geometry(points: ChartPoint[], width: number, height = 230) {
    const left = 46,
      right = Math.max(left + 1, width - 18),
      top = 18,
      bottom = height - 34;
    const values = points
      .flatMap((p) => (p.trend === undefined ? [p.value] : [p.value, p.trend]))
      .filter(Number.isFinite);
    const low = values.length ? Math.min(...values) : 0,
      high = values.length ? Math.max(...values) : 1;
    const padding = Math.max(0.5, (high - low) * 0.2);
    const min = Math.max(0, low - padding),
      max = high + padding;
    const dates = points.map((p) => Date.parse(p.date));
    const first = Math.min(...dates),
      last = Math.max(...dates);
    const y = (v: number) =>
      bottom - ((v - min) / (max - min || 1)) * (bottom - top);
    const coords = points.map((p, i) => ({
      ...p,
      x:
        first === last
          ? (left + right) / 2
          : left + ((dates[i] - first) / (last - first)) * (right - left),
      y: y(p.value),
      trendY: p.trend === undefined ? undefined : y(p.trend),
    }));
    const path = (trend = false) =>
      coords
        .map((p, i) => `${i ? "L" : "M"}${p.x},${trend ? p.trendY : p.y}`)
        .join(" ");
    return {
      left,
      right,
      top,
      bottom,
      min,
      max,
      y,
      coords,
      path,
      ticks: [min, (min + max) / 2, max],
    };
  }
}
