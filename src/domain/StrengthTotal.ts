import { AnalyticsFacts } from "./AnalyticsFacts";
import { PersonalRecordsCalculator } from "./PersonalRecords";
import { calendarWeekday } from "./TrainingCalendar";
import type { Workout } from "../lib/types";

export type BigLiftId = "squat" | "bench" | "deadlift" | "ohp";

export interface BigLiftStat {
  id: BigLiftId;
  label: string;
  short: string;
  e1rmKg: number | null;
  bestWeightKg: number | null;
  bestReps: number | null;
  date: string | null;
  progressKey: string | null;
}

export interface TotalMilestone {
  prevKg: number;
  nextKg: number;
  remainingKg: number;
  ratio: number;
}

export interface StrengthTotalSummary {
  lifts: Record<BigLiftId, BigLiftStat>;
  totalKg: number;
  countedLifts: number;
  relativeBw: number | null;
  milestone: TotalMilestone;
  shares: Record<"squat" | "bench" | "deadlift", number>;
}

export interface WeekdayPulse {
  counts: [number, number, number, number, number, number, number];
  max: number;
  total: number;
  peakWeekday: number | null;
}

const MILESTONES = [100, 150, 200, 250, 300, 350, 400, 450, 500, 550, 600, 700, 800, 900, 1000];

const LIFT_META: Record<BigLiftId, { label: string; short: string; match: (id: string, name: string) => boolean }> = {
  squat: {
    label: "Присед",
    short: "Присед",
    match: (id, name) => id === "squat" || /приседания со штангой/i.test(name),
  },
  bench: {
    label: "Жим лёжа",
    short: "Жим",
    match: (id, name) => id === "bench" || /жим штанги лёжа/i.test(name),
  },
  deadlift: {
    label: "Становая",
    short: "Тяга",
    match: (id, name) => id === "deadlift-bar" || id === "deadlift" || /^становая тяга со штангой/i.test(name),
  },
  ohp: {
    label: "Армейский жим",
    short: "Жим стоя",
    match: (id, name) => id === "ohp-bar" || id === "ohp" || /жим штанги стоя/i.test(name),
  },
};

/**
 * Расчёт силового тотала (Присед + Жим лёжа + Становая) и распределения тренировок по дням недели.
 * Чистая доменная логика без React и хранилищ.
 */
export class StrengthTotal {
  static milestoneFor(totalKg: number): TotalMilestone {
    const clean = Math.max(0, Number.isFinite(totalKg) ? totalKg : 0);
    const nextKg = MILESTONES.find((m) => m > clean) ?? Math.ceil((clean + 50) / 100) * 100;
    const prevIdx = MILESTONES.indexOf(nextKg) - 1;
    const prevKg = prevIdx >= 0 ? MILESTONES[prevIdx] : Math.max(0, nextKg - 100);
    const span = Math.max(1, nextKg - prevKg);
    return {
      prevKg,
      nextKg,
      remainingKg: Math.max(0, Math.round((nextKg - clean) * 10) / 10),
      ratio: Math.max(0, Math.min(1, (clean - prevKg) / span)),
    };
  }

  static summarize(
    lifts: Record<BigLiftId, BigLiftStat>,
    bodyMassKg?: number | null,
  ): StrengthTotalSummary {
    const s = lifts.squat.e1rmKg ?? 0;
    const b = lifts.bench.e1rmKg ?? 0;
    const d = lifts.deadlift.e1rmKg ?? 0;
    const totalKg = Math.round((s + b + d) * 10) / 10;
    const countedLifts = [lifts.squat.e1rmKg, lifts.bench.e1rmKg, lifts.deadlift.e1rmKg].filter((v) => v !== null && v > 0).length;
    const relativeBw =
      bodyMassKg && bodyMassKg > 0 && totalKg > 0
        ? Math.round((totalKg / bodyMassKg) * 100) / 100
        : null;
    const shares = {
      squat: totalKg > 0 ? Math.round((s / totalKg) * 100) : 0,
      bench: totalKg > 0 ? Math.round((b / totalKg) * 100) : 0,
      deadlift: totalKg > 0 ? Math.max(0, 100 - Math.round((s / totalKg) * 100) - Math.round((b / totalKg) * 100)) : 0,
    };
    return {
      lifts,
      totalKg,
      countedLifts,
      relativeBw,
      milestone: StrengthTotal.milestoneFor(totalKg),
      shares,
    };
  }

  static fromWorkouts(
    workouts: readonly Workout[],
    timeZone?: string,
    bodyMassKg?: number | null,
    now = new Date(),
  ): StrengthTotalSummary {
    const prs = new PersonalRecordsCalculator([...workouts], now).calculateRecords(timeZone);
    const lifts = {} as Record<BigLiftId, BigLiftStat>;
    for (const id of ["squat", "bench", "deadlift", "ohp"] as const) {
      const meta = LIFT_META[id];
      const candidates = prs.filter((pr) => meta.match(pr.exerciseId, pr.name) && pr.bestE1rm);
      const best = candidates.sort((a, b) => (b.bestE1rm?.e1rm ?? 0) - (a.bestE1rm?.e1rm ?? 0))[0];
      lifts[id] = {
        id,
        label: meta.label,
        short: meta.short,
        e1rmKg: best?.bestE1rm?.e1rm ?? null,
        bestWeightKg: best?.bestE1rm?.weight ?? null,
        bestReps: best?.bestE1rm?.reps ?? null,
        date: best?.bestE1rm?.date ?? null,
        progressKey: best?.key ?? null,
      };
    }
    return StrengthTotal.summarize(lifts, bodyMassKg);
  }

  static weekdayPulse(workouts: readonly Workout[], timeZone?: string, now = new Date()): WeekdayPulse {
    const counts: [number, number, number, number, number, number, number] = [0, 0, 0, 0, 0, 0, 0];
    const eligible = new AnalyticsFacts([...workouts], { now, timeZone }).workouts();
    for (const w of eligible) {
      const day = calendarWeekday(w.date);
      if (day >= 0 && day <= 6) counts[day]++;
    }
    const max = Math.max(0, ...counts);
    const total = counts.reduce((a, b) => a + b, 0);
    const peakWeekday = max > 0 ? counts.indexOf(max) : null;
    return { counts, max, total, peakWeekday };
  }
}
