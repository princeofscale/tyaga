import { AnalyticsFacts } from "./AnalyticsFacts";
import { OneRepMaxFormulas } from "./OneRepMaxFormulas";
import { StrengthTotal, type BigLiftId, type StrengthTotalSummary } from "./StrengthTotal";
import { addCalendarDays, browserTimeZone, localDate } from "../lib/calendar";
import { exerciseForEntry } from "../lib/catalog";
import { progressKey } from "../lib/model";
import type { Workout, WorkoutExercise } from "../lib/types";

export type BiologicalSex = "male" | "female";

export type StrengthTierId =
  | "novice"
  | "basic"
  | "intermediate"
  | "advanced"
  | "kms"
  | "elite";

export interface StrengthTierInfo {
  id: StrengthTierId;
  label: string;
  minDots: number;
  nextDots: number | null;
  nextLabel: string | null;
  progress: number;
  dotsToNext: number | null;
}

export interface DotsSummary {
  dots: number | null;
  adjustedDots: number | null;
  wilks: number | null;
  sex: BiologicalSex;
  bodyMassKg: number | null;
  longLeversBonusPct: number;
  tier: StrengthTierInfo | null;
}

export interface DatedE1rmPoint {
  date: string;
  e1rm: number;
}

export type ForecastConfidence = "high" | "medium" | "low" | "insufficient";
export type ForecastStatus = "on_track" | "achieved" | "plateau" | "insufficient_data";

export interface LiftForecast {
  id: string;
  label: string;
  short: string;
  progressKey: string | null;
  currentE1rm: number | null;
  targetKg: number;
  remainingKg: number | null;
  weeklyRateKg: number | null;
  r2: number | null;
  sampleCount: number;
  spanDays: number;
  confidence: ForecastConfidence;
  status: ForecastStatus;
  etaWeeks: number | null;
  etaDate: string | null;
  projected9WeeksKg: number | null;
  history: DatedE1rmPoint[];
  projection: DatedE1rmPoint[];
}

export interface StrengthForecastReport {
  today: string;
  total: StrengthTotalSummary;
  dots: DotsSummary;
  lifts: Record<BigLiftId, LiftForecast>;
}

const BIG_LIFT_IDS: readonly BigLiftId[] = ["bench", "squat", "deadlift", "ohp"];

const LIFT_DEFAULTS: Record<BigLiftId, { label: string; short: string; defaultTarget: number; step: number; match: (id: string, name: string) => boolean }> = {
  bench: {
    label: "Жим лёжа",
    short: "Жим",
    defaultTarget: 100,
    step: 10,
    match: (id, name) => id === "bench" || /жим штанги лёжа/i.test(name),
  },
  squat: {
    label: "Присед",
    short: "Присед",
    defaultTarget: 140,
    step: 10,
    match: (id, name) => id === "squat" || /приседания со штангой/i.test(name),
  },
  deadlift: {
    label: "Становая",
    short: "Тяга",
    defaultTarget: 180,
    step: 10,
    match: (id, name) => id === "deadlift-bar" || id === "deadlift" || /^становая тяга со штангой/i.test(name),
  },
  ohp: {
    label: "Армейский жим",
    short: "Жим стоя",
    defaultTarget: 70,
    step: 5,
    match: (id, name) => id === "ohp-bar" || id === "ohp" || /жим штанги стоя/i.test(name),
  },
};

const DOTS_COEFFS: Record<BiologicalSex, readonly [number, number, number, number, number]> = {
  male: [-0.000001093, 0.0007391293, -0.1918759221, 24.0900756, -307.75076],
  female: [-0.0000010706, 0.0005158568, -0.1126655495, 13.6175032, -57.96288],
};

const WILKS_COEFFS: Record<BiologicalSex, readonly [number, number, number, number, number, number]> = {
  male: [-216.0475144, 16.2606339, -0.002388645, -0.00113732, 7.01863e-6, -1.291e-8],
  female: [594.31747775582, -27.23842536447, 0.82112226871, -0.00930733913, 4.731582e-5, -9.054e-8],
};

const TIERS: ReadonlyArray<{ id: StrengthTierId; label: string; minDots: number }> = [
  { id: "novice", label: "Новичок", minDots: 0 },
  { id: "basic", label: "Базовый", minDots: 200 },
  { id: "intermediate", label: "Уверенный", minDots: 275 },
  { id: "advanced", label: "Продвинутый", minDots: 340 },
  { id: "kms", label: "КМС-уровень", minDots: 410 },
  { id: "elite", label: "Элита", minDots: 475 },
];

const MS_PER_DAY = 86_400_000;
const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;

function daysBetween(startIso: string, endIso: string): number {
  const a = Date.parse(`${startIso}T12:00:00Z`);
  const b = Date.parse(`${endIso}T12:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.round((b - a) / MS_PER_DAY);
}

/**
 * ООП-движок прогнозирования рекордов (e1RM-регрессия до целевых вех)
 * и расчёта индексов относительной силы DOTS / Wilks с учётом длинных рычагов.
 */
export class StrengthForecast {
  private readonly workouts: readonly Workout[];
  private readonly timeZone: string;
  private readonly today: string;
  private readonly bodyMassKg: number | null;
  private readonly sex: BiologicalSex;
  private readonly longLevers: boolean;
  private readonly now: Date;

  constructor(
    workouts: readonly Workout[],
    options: {
      timeZone?: string;
      today?: string;
      bodyMassKg?: number | null;
      sex?: BiologicalSex;
      longLevers?: boolean;
      now?: Date;
    } = {},
  ) {
    this.workouts = workouts;
    this.timeZone = options.timeZone ?? browserTimeZone();
    this.now = options.now ?? new Date();
    this.today = options.today ?? localDate(this.now, this.timeZone);
    this.bodyMassKg =
      typeof options.bodyMassKg === "number" && Number.isFinite(options.bodyMassKg) && options.bodyMassKg > 0
        ? options.bodyMassKg
        : null;
    this.sex = options.sex ?? "male";
    this.longLevers = options.longLevers === true;
  }

  /** Официальный коэффициент и баллы DOTS (IPF / OpenPowerlifting). */
  static computeDots(totalKg: number, bodyMassKg: number | null, sex: BiologicalSex = "male"): number | null {
    if (!Number.isFinite(totalKg) || totalKg <= 0 || !bodyMassKg || !Number.isFinite(bodyMassKg) || bodyMassKg <= 0) {
      return null;
    }
    const bw = Math.max(40, Math.min(210, bodyMassKg));
    const [a, b, c, d, e] = DOTS_COEFFS[sex];
    const denom = a * bw ** 4 + b * bw ** 3 + c * bw ** 2 + d * bw + e;
    if (!Number.isFinite(denom) || denom <= 0) return null;
    return round1(totalKg * (500 / denom));
  }

  /** Классический индекс Wilks для справки рядом с DOTS. */
  static computeWilks(totalKg: number, bodyMassKg: number | null, sex: BiologicalSex = "male"): number | null {
    if (!Number.isFinite(totalKg) || totalKg <= 0 || !bodyMassKg || !Number.isFinite(bodyMassKg) || bodyMassKg <= 0) {
      return null;
    }
    const bw = Math.max(40, Math.min(200, bodyMassKg));
    const [a, b, c, d, e, f] = WILKS_COEFFS[sex];
    const denom = a + b * bw + c * bw ** 2 + d * bw ** 3 + e * bw ** 4 + f * bw ** 5;
    if (!Number.isFinite(denom) || denom <= 0) return null;
    return round1(totalKg * (500 / denom));
  }

  /** Определяет разрядный уровень и прогресс до следующей ступени по баллам DOTS. */
  static classifyTier(dots: number | null): StrengthTierInfo | null {
    if (dots === null || !Number.isFinite(dots) || dots <= 0) return null;
    let idx = 0;
    for (let i = 0; i < TIERS.length; i++) {
      if (dots >= TIERS[i].minDots) idx = i;
    }
    const cur = TIERS[idx];
    const next = TIERS[idx + 1] ?? null;
    if (!next) {
      return {
        id: cur.id,
        label: cur.label,
        minDots: cur.minDots,
        nextDots: null,
        nextLabel: null,
        progress: 1,
        dotsToNext: null,
      };
    }
    const span = Math.max(1, next.minDots - cur.minDots);
    return {
      id: cur.id,
      label: cur.label,
      minDots: cur.minDots,
      nextDots: next.minDots,
      nextLabel: next.label,
      progress: Math.max(0, Math.min(1, (dots - cur.minDots) / span)),
      dotsToNext: round1(Math.max(0, next.minDots - dots)),
    };
  }

  /** Подбирает ближайшую осмысленную круглую цель выше текущего e1RM. */
  static suggestTarget(currentE1rm: number | null, step = 10, fallback = 100): number {
    if (currentE1rm === null || !Number.isFinite(currentE1rm) || currentE1rm <= 0) return fallback;
    const next = Math.ceil((currentE1rm + 2.5) / step) * step;
    return Math.max(step, next);
  }

  /**
   * Взвешенная линейная регрессия (МНК) по точкам e1RM:
   * более свежие сессии получают чуть больший вес, чтобы отражать текущий темп мезоцикла.
   */
  static fitTrend(points: readonly DatedE1rmPoint[]): {
    weeklyRateKg: number;
    intercept: number;
    r2: number;
    spanDays: number;
  } | null {
    if (points.length < 2) return null;
    const sorted = [...points].sort((a, b) => a.date.localeCompare(b.date));
    const origin = sorted[0].date;
    const xs = sorted.map((p) => daysBetween(origin, p.date));
    const ys = sorted.map((p) => p.e1rm);
    const spanDays = xs[xs.length - 1] - xs[0];
    if (spanDays < 7) return null;

    // Линейные веса от 0.65 (самые старые) до 1.35 (самые свежие)
    const n = sorted.length;
    const weights = sorted.map((_, i) => (n === 1 ? 1 : 0.65 + (0.7 * i) / (n - 1)));
    const wSum = weights.reduce((s, w) => s + w, 0);
    const xBar = weights.reduce((s, w, i) => s + w * xs[i], 0) / wSum;
    const yBar = weights.reduce((s, w, i) => s + w * ys[i], 0) / wSum;

    let num = 0;
    let den = 0;
    for (let i = 0; i < n; i++) {
      const dx = xs[i] - xBar;
      num += weights[i] * dx * (ys[i] - yBar);
      den += weights[i] * dx * dx;
    }
    if (den <= 0) return null;

    const slopePerDay = num / den;
    const intercept = yBar - slopePerDay * xBar;

    let ssRes = 0;
    let ssTot = 0;
    for (let i = 0; i < n; i++) {
      const pred = intercept + slopePerDay * xs[i];
      ssRes += weights[i] * (ys[i] - pred) ** 2;
      ssTot += weights[i] * (ys[i] - yBar) ** 2;
    }
    const r2 = ssTot > 1e-6 ? Math.max(0, Math.min(1, 1 - ssRes / ssTot)) : 0;

    return {
      weeklyRateKg: round2(slopePerDay * 7),
      intercept,
      r2: round2(r2),
      spanDays,
    };
  }

  /** Прогноз по произвольному ряду точек e1RM (используется и для базы, и для выбранного упражнения). */
  forecastSeries(params: {
    id: string;
    label: string;
    short: string;
    progressKey: string | null;
    points: readonly DatedE1rmPoint[];
    targetKg?: number;
    defaultTarget?: number;
    targetStep?: number;
  }): LiftForecast {
    const sorted = [...params.points]
      .filter((p) => Number.isFinite(p.e1rm) && p.e1rm > 0)
      .sort((a, b) => a.date.localeCompare(b.date));

    // Ограничиваем окно тренда 180 днями, если там есть хотя бы 3 точки
    const cutoff = addCalendarDays(this.today, -180);
    const recent = sorted.filter((p) => p.date >= cutoff);
    const windowPoints = recent.length >= 3 ? recent : sorted;

    const currentE1rm = sorted.length > 0 ? round1(sorted[sorted.length - 1].e1rm) : null;
    const bestE1rm = sorted.length > 0 ? round1(Math.max(...sorted.map((p) => p.e1rm))) : null;
    const effectiveCurrent = bestE1rm !== null && currentE1rm !== null
      ? round1(Math.max(currentE1rm, bestE1rm * 0.98))
      : currentE1rm;

    const targetKg =
      params.targetKg && Number.isFinite(params.targetKg) && params.targetKg > 0
        ? Math.round(params.targetKg * 2) / 2
        : StrengthForecast.suggestTarget(effectiveCurrent, params.targetStep ?? 10, params.defaultTarget ?? 100);

    if (effectiveCurrent === null || windowPoints.length < 2) {
      return {
        id: params.id,
        label: params.label,
        short: params.short,
        progressKey: params.progressKey,
        currentE1rm: effectiveCurrent,
        targetKg,
        remainingKg: effectiveCurrent !== null ? round1(Math.max(0, targetKg - effectiveCurrent)) : null,
        weeklyRateKg: null,
        r2: null,
        sampleCount: windowPoints.length,
        spanDays: windowPoints.length >= 2 ? daysBetween(windowPoints[0].date, windowPoints[windowPoints.length - 1].date) : 0,
        confidence: "insufficient",
        status: effectiveCurrent !== null && effectiveCurrent >= targetKg ? "achieved" : "insufficient_data",
        etaWeeks: null,
        etaDate: null,
        projected9WeeksKg: null,
        history: windowPoints.slice(-14),
        projection: [],
      };
    }

    const fit = StrengthForecast.fitTrend(windowPoints);
    if (!fit) {
      return {
        id: params.id,
        label: params.label,
        short: params.short,
        progressKey: params.progressKey,
        currentE1rm: effectiveCurrent,
        targetKg,
        remainingKg: round1(Math.max(0, targetKg - effectiveCurrent)),
        weeklyRateKg: null,
        r2: null,
        sampleCount: windowPoints.length,
        spanDays: daysBetween(windowPoints[0].date, windowPoints[windowPoints.length - 1].date),
        confidence: "insufficient",
        status: effectiveCurrent >= targetKg ? "achieved" : "insufficient_data",
        etaWeeks: null,
        etaDate: null,
        projected9WeeksKg: null,
        history: windowPoints.slice(-14),
        projection: [],
      };
    }

    const confidence: ForecastConfidence =
      windowPoints.length >= 6 && fit.spanDays >= 28 && fit.r2 >= 0.45
        ? "high"
        : windowPoints.length >= 3 && fit.spanDays >= 14
          ? "medium"
          : "low";

    const remainingKg = round1(Math.max(0, targetKg - effectiveCurrent));

    // Ограничиваем оптимизм прогноза физиологическим потолком роста (+3.5 кг/нед)
    const projectionRate = Math.min(3.5, fit.weeklyRateKg);
    const projected9WeeksKg =
      projectionRate > 0 ? round1(effectiveCurrent + projectionRate * 9) : effectiveCurrent;

    if (effectiveCurrent >= targetKg) {
      return {
        id: params.id,
        label: params.label,
        short: params.short,
        progressKey: params.progressKey,
        currentE1rm: effectiveCurrent,
        targetKg,
        remainingKg: 0,
        weeklyRateKg: fit.weeklyRateKg,
        r2: fit.r2,
        sampleCount: windowPoints.length,
        spanDays: fit.spanDays,
        confidence,
        status: "achieved",
        etaWeeks: 0,
        etaDate: this.today,
        projected9WeeksKg,
        history: windowPoints.slice(-14),
        projection: [],
      };
    }

    if (projectionRate < 0.08) {
      return {
        id: params.id,
        label: params.label,
        short: params.short,
        progressKey: params.progressKey,
        currentE1rm: effectiveCurrent,
        targetKg,
        remainingKg,
        weeklyRateKg: fit.weeklyRateKg,
        r2: fit.r2,
        sampleCount: windowPoints.length,
        spanDays: fit.spanDays,
        confidence,
        status: "plateau",
        etaWeeks: null,
        etaDate: null,
        projected9WeeksKg,
        history: windowPoints.slice(-14),
        projection: [],
      };
    }

    const rawWeeks = remainingKg / projectionRate;
    const etaWeeks = Math.max(1, Math.min(104, Math.ceil(rawWeeks)));
    const etaDate = addCalendarDays(this.today, etaWeeks * 7);

    // 4 опорные точки для пунктирной линии прогноза на мини-графике
    const horizonWeeks = Math.min(etaWeeks, 16);
    const lastDate = windowPoints[windowPoints.length - 1].date;
    const projection: DatedE1rmPoint[] = [
      { date: lastDate, e1rm: effectiveCurrent },
      { date: addCalendarDays(this.today, Math.round((horizonWeeks * 7) / 2)), e1rm: round1(effectiveCurrent + projectionRate * (horizonWeeks / 2)) },
      { date: addCalendarDays(this.today, horizonWeeks * 7), e1rm: round1(Math.min(targetKg, effectiveCurrent + projectionRate * horizonWeeks)) },
    ];

    return {
      id: params.id,
      label: params.label,
      short: params.short,
      progressKey: params.progressKey,
      currentE1rm: effectiveCurrent,
      targetKg,
      remainingKg,
      weeklyRateKg: fit.weeklyRateKg,
      r2: fit.r2,
      sampleCount: windowPoints.length,
      spanDays: fit.spanDays,
      confidence,
      status: "on_track",
      etaWeeks,
      etaDate,
      projected9WeeksKg,
      history: windowPoints.slice(-14),
      projection,
    };
  }

  /** Полный отчёт: тотал, DOTS/Wilks/разряд и прогнозы по 4 базовым движениям. */
  build(customTargets: Partial<Record<BigLiftId, number>> = {}): StrengthForecastReport {
    const total = StrengthTotal.fromWorkouts(this.workouts, this.timeZone, this.bodyMassKg, this.now);
    const rawDots = StrengthForecast.computeDots(total.totalKg, this.bodyMassKg, this.sex);
    const longLeversBonusPct = this.longLevers ? 4 : 0;
    const adjustedDots = rawDots !== null && this.longLevers ? round1(rawDots * 1.04) : rawDots;
    const wilks = StrengthForecast.computeWilks(total.totalKg, this.bodyMassKg, this.sex);
    const tier = StrengthForecast.classifyTier(adjustedDots ?? rawDots);

    const eligible = new AnalyticsFacts([...this.workouts], {
      now: this.now,
      timeZone: this.timeZone,
    }).workouts();

    const perLiftPoints: Record<BigLiftId, Map<string, number>> = {
      bench: new Map(),
      squat: new Map(),
      deadlift: new Map(),
      ohp: new Map(),
    };
    const perLiftKey: Partial<Record<BigLiftId, string>> = {};

    for (const w of eligible) {
      for (const entry of w.exercises) {
        const def = exerciseForEntry(entry);
        const name = entry.displayNameSnapshot ?? def?.name ?? entry.exerciseId;
        for (const id of BIG_LIFT_IDS) {
          if (!LIFT_DEFAULTS[id].match(entry.exerciseId, name)) continue;
          const bestInEntry = StrengthForecast.bestEntryE1rm(entry);
          if (bestInEntry <= 0) continue;
          const prev = perLiftPoints[id].get(w.date) ?? 0;
          if (bestInEntry > prev) perLiftPoints[id].set(w.date, bestInEntry);
          if (!perLiftKey[id]) perLiftKey[id] = progressKey(entry);
        }
      }
    }

    const lifts = {} as Record<BigLiftId, LiftForecast>;
    for (const id of BIG_LIFT_IDS) {
      const meta = LIFT_DEFAULTS[id];
      const pts: DatedE1rmPoint[] = [...perLiftPoints[id].entries()]
        .map(([date, e1rm]) => ({ date, e1rm: round1(e1rm) }))
        .sort((a, b) => a.date.localeCompare(b.date));
      lifts[id] = this.forecastSeries({
        id,
        label: meta.label,
        short: meta.short,
        progressKey: total.lifts[id].progressKey ?? perLiftKey[id] ?? null,
        points: pts,
        targetKg: customTargets[id],
        defaultTarget: meta.defaultTarget,
        targetStep: meta.step,
      });
    }

    return {
      today: this.today,
      total,
      dots: {
        dots: rawDots,
        adjustedDots,
        wilks,
        sex: this.sex,
        bodyMassKg: this.bodyMassKg,
        longLeversBonusPct,
        tier,
      },
      lifts,
    };
  }

  private static bestEntryE1rm(entry: WorkoutExercise): number {
    const def = exerciseForEntry(entry);
    let best = 0;
    for (const set of entry.sets) {
      if (!set.done || set.warmup) continue;
      if (set.weight <= 0 || set.reps < 1 || set.reps > 15) continue;
      if (def && !def.recording.e1rmEligible) continue;
      const e1rm = OneRepMaxFormulas.round(OneRepMaxFormulas.epley(set.weight, set.reps));
      if (e1rm > best) best = e1rm;
    }
    return best;
  }
}
