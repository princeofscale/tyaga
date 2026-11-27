import { addCalendarDays } from "../lib/calendar";
import { volumeSummary } from "../lib/model";
import type { Workout } from "../lib/types";
import { AnalyticsFacts } from "./AnalyticsFacts";
import { calendarWeekday } from "./TrainingCalendar";

export interface HeatmapCell {
  date: string;
  workouts: number;
  workingSets: number;
  level: 0 | 1 | 2 | 3 | 4;
  isToday: boolean;
  isFuture: boolean;
}

export interface WeekSnapshot {
  workouts: number;
  workingSets: number;
  tonnageKg: number;
  avgRir: number | null;
}

export interface WeekOverWeekComparison {
  current: WeekSnapshot;
  previous: WeekSnapshot;
  setsDelta: number;
  tonnageDeltaPct: number | null;
}

export interface HistoryHeatmapData {
  weeks: HeatmapCell[][];
  activeDays: number;
  totalWorkouts: number;
  totalSets: number;
  comparison: WeekOverWeekComparison;
}

/**
 * ООП-строитель теплокарты активности (16 недель, выровненной по понедельникам)
 * и сравнения текущей 7-дневной недели с предыдущей.
 */
export class HistoryHeatmap {
  private readonly workouts: Workout[];
  private readonly today: string;
  private readonly timeZone?: string;
  private readonly weeksCount: number;

  constructor(
    workouts: Workout[],
    today: string,
    options: { timeZone?: string; weeksCount?: number } = {},
  ) {
    this.workouts = workouts;
    this.today = today;
    this.timeZone = options.timeZone;
    this.weeksCount = Math.max(4, Math.min(52, options.weeksCount ?? 16));
  }

  build(): HistoryHeatmapData {
    const todayWeekday = calendarWeekday(this.today); // 0 = Пн .. 6 = Вс
    const currentMonday = addCalendarDays(this.today, -todayWeekday);
    const startMonday = addCalendarDays(currentMonday, -(this.weeksCount - 1) * 7);
    const refNow = new Date(`${this.today}T12:00:00Z`);

    const facts = new AnalyticsFacts(this.workouts, {
      from: startMonday,
      through: this.today,
      timeZone: this.timeZone,
      now: refNow,
    }).workouts();

    const byDate = new Map<string, { workouts: number; workingSets: number }>();
    let totalWorkouts = 0;
    let totalSets = 0;

    for (const w of facts) {
      const setsCount = w.exercises.reduce(
        (sum, ex) => sum + ex.sets.filter((s) => s.done && !s.warmup).length,
        0,
      );
      if (setsCount <= 0) continue;
      totalWorkouts++;
      totalSets += setsCount;
      const prev = byDate.get(w.date) ?? { workouts: 0, workingSets: 0 };
      byDate.set(w.date, {
        workouts: prev.workouts + 1,
        workingSets: prev.workingSets + setsCount,
      });
    }

    const weeks: HeatmapCell[][] = [];
    for (let wi = 0; wi < this.weeksCount; wi++) {
      const col: HeatmapCell[] = [];
      for (let di = 0; di < 7; di++) {
        const date = addCalendarDays(startMonday, wi * 7 + di);
        const isFuture = date > this.today;
        const hit = isFuture ? undefined : byDate.get(date);
        const workingSets = hit?.workingSets ?? 0;
        const level: HeatmapCell["level"] =
          workingSets === 0
            ? 0
            : workingSets < 10
              ? 1
              : workingSets < 17
                ? 2
                : workingSets < 24
                  ? 3
                  : 4;
        col.push({
          date,
          workouts: hit?.workouts ?? 0,
          workingSets,
          level,
          isToday: date === this.today,
          isFuture,
        });
      }
      weeks.push(col);
    }

    const comparison = this.buildWeekComparison(refNow);

    return {
      weeks,
      activeDays: byDate.size,
      totalWorkouts,
      totalSets,
      comparison,
    };
  }

  private snapshot(from: string, through: string, now: Date): WeekSnapshot {
    const list = new AnalyticsFacts(this.workouts, {
      from,
      through,
      timeZone: this.timeZone,
      now,
    }).workouts();
    let workingSets = 0;
    let rirSum = 0;
    let rirCount = 0;
    for (const w of list) {
      for (const e of w.exercises) {
        for (const s of e.sets) {
          if (!s.done || s.warmup) continue;
          workingSets++;
          if (s.rir !== null && Number.isFinite(s.rir)) {
            rirSum += s.rir;
            rirCount++;
          }
        }
      }
    }
    const tonnageKg = Math.round(volumeSummary(list, "working").total);
    return {
      workouts: list.length,
      workingSets,
      tonnageKg,
      avgRir: rirCount > 0 ? Math.round((rirSum / rirCount) * 10) / 10 : null,
    };
  }

  private buildWeekComparison(now: Date): WeekOverWeekComparison {
    const curStart = addCalendarDays(this.today, -6);
    const prevEnd = addCalendarDays(this.today, -7);
    const prevStart = addCalendarDays(this.today, -13);
    const current = this.snapshot(curStart, this.today, now);
    const previous = this.snapshot(prevStart, prevEnd, now);
    const setsDelta = current.workingSets - previous.workingSets;
    const tonnageDeltaPct =
      previous.tonnageKg >= 500
        ? Math.round(((current.tonnageKg - previous.tonnageKg) / previous.tonnageKg) * 100)
        : null;
    return { current, previous, setsDelta, tonnageDeltaPct };
  }
}
