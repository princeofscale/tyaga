// ============================================================================
// TYAGA v5 — AdaptiveNutritionEngine (Production TypeScript, O(N), Zero-Deps)
// Targets: Client PWA (offline) & Cloudflare Workers + D1
// ============================================================================

import type { EnergyStatus } from "./DeloadEngine";
import { isCalendarDate, localDate } from "../lib/calendar";

export type { EnergyStatus };

export type BiologicalSex = "male" | "female";
export type TrainingLevel = "novice" | "intermediate" | "advanced";
export type NeatLevel = "sedentary" | "light" | "moderate" | "active" | "very_active";
export type FfmFormula = "janmahasatian" | "boer";
export type GoalMode = "lean_bulk" | "recomp" | "maintenance" | "mini_cut" | "cut";
export type DupDayType = "legs" | "push" | "pull" | "rest" | "deload";
export type EngineMode = "pro" | "lite";
export type TdeeStatus =
  | "cold_start_no_weights"
  | "cold_start"
  | "calibrating"
  | "converged"
  | "holding_low_adherence"
  | "lite_trend_only"
  | "lite_insufficient_weighins";

export interface NutritionProfile {
  readonly sex: BiologicalSex;
  readonly ageYears: number;
  readonly heightCm: number;
  readonly weightKg: number;
  readonly bodyFatPct?: number | null;
  readonly ffmFormula?: FfmFormula;
  readonly neatLevel?: NeatLevel;
  readonly weeklyTrainingSessions?: number; // Default 5.25 for 3/1 DUP
  readonly trainingLevel?: TrainingLevel;
  readonly longLevers?: boolean;
}

export interface BodyweightEntry {
  readonly date: string; // ISO YYYY-MM-DD
  readonly weightKg: number;
}

export interface DailyNutritionLog {
  readonly date: string; // ISO YYYY-MM-DD
  readonly caloriesKcal: number;
  readonly proteinG?: number;
  readonly fatG?: number;
  readonly carbsG?: number;
  readonly dayType?: DupDayType;
  readonly partialLog?: boolean;
}

export interface FfmEstimate {
  readonly ffmKg: number;
  readonly method: "body_fat_pct" | FfmFormula;
  readonly estimatedBfPct: number;
}

export interface PriorTdeeEstimate {
  readonly bmrKcal: number;
  readonly bmrMethod: "katch_mcardle" | "mifflin_st_jeor";
  readonly ffmKg: number;
  readonly ffmMethod: "body_fat_pct" | FfmFormula;
  readonly estimatedBfPct: number;
  readonly pal: number;
  readonly priorTdeeKcal: number;
  readonly avgDailyEeeKcal: number;
}

export interface TrendWeightPoint {
  readonly date: string;
  readonly rawKg: number;
  readonly scaleTrendKg: number;
  readonly metabolicTrendKg: number;
  readonly creatineOffsetKg: number;
  readonly residualKg: number;
  readonly clippedResidualKg: number;
  readonly isOutlier: boolean;
  readonly inCreatineWindow: boolean;
}

export interface TdeeHistoryPoint {
  readonly date: string;
  readonly tdee: number;
  readonly tdeeObs?: number;
  readonly K?: number;
  readonly status: TdeeStatus;
}

export interface TdeeEstimateReport {
  readonly mode: EngineMode;
  readonly status: TdeeStatus;
  readonly priorTdeeKcal: number;
  readonly adaptiveTdeeKcal: number;
  readonly adaptiveTdeeExact?: number;
  readonly uncertaintySdKcal?: number;
  readonly confidence: number;
  readonly trendWeightKg: number;
  readonly metabolicTrendWeightKg: number;
  readonly rateKgPerWeek: number;
  readonly ratePctPerWeek: number;
  readonly avgIntake14dKcal: number | null;
  readonly netEnergyBalanceKcal: number | null;
  readonly adherence14d: number;
  readonly prior: PriorTdeeEstimate;
  readonly trendSeries: readonly TrendWeightPoint[];
  readonly tdeeHistory?: readonly TdeeHistoryPoint[];
}

export interface WeeklyCheckInOptions {
  readonly previousTargetKcal?: number | null;
  readonly weeksInPhase?: number;
  readonly e1rmDropPct?: number;
  readonly ewmaFatigueHigh?: boolean;
}

export interface WeeklyCheckInResult {
  readonly mode: EngineMode;
  readonly goalMode: GoalMode;
  readonly nextTargetKcal: number | null;
  readonly kcalDeltaHint?: number;
  readonly deltaFromPreviousKcal?: number;
  readonly goalDeltaKcal?: number;
  readonly rateCorrectionKcal?: number;
  readonly targetRatePctPerWeek: number;
  readonly actualRatePctPerWeek: number;
  readonly tdeeDriftPct?: number;
  readonly safetyFloorKcal: number;
  readonly safetyFloorHit: boolean;
  readonly achievedEaKcalPerKgFfm?: number;
  readonly neatPlateauDetected: boolean;
  readonly dietBreakRecommended: boolean;
  readonly dietBreakReason:
    | "mini_cut_max_duration_6w"
    | "metabolic_adaptation_gt_12pct"
    | "prolonged_cut_fatigue_or_strength_drop"
    | null;
  readonly dietBreakTargetKcal?: number | null;
  readonly adjustmentReason: string;
}

export interface DailyMacroTarget {
  readonly dayType: DupDayType;
  readonly targetKcal: number;
  readonly proteinG: number;
  readonly fatG: number;
  readonly carbsG: number;
  readonly cyclingScale: number;
  readonly fatPctWeekly: number;
  readonly fatPerKgRef: number;
}

export interface EnergyStatusBridgeResult {
  readonly energyStatus: EnergyStatus;
  readonly capacityMultiplier: number;
  readonly hysteresisHeld: boolean;
  readonly basis: string;
}

export interface NutritionPhaseConfig {
  readonly ratePctByLevel: Readonly<Record<TrainingLevel, number>>;
  readonly kcalPerKg: number;
  readonly deltaBounds: readonly [number, number];
  readonly maxWeeks: number | null;
  readonly proteinPerKgFfm: number;
  readonly fatMinPerKgRef: number;
  readonly fatMinPct: number;
  readonly fatTargetPct: number;
  readonly fatMaxPerKgRef: number;
}

// --- CONSTANTS (LOCKED PHYSIOLOGICAL PARAMETERS) ---

export const ENERGY_CAPACITY_MULTIPLIER: Readonly<Record<EnergyStatus, number>> = {
  deficit: 0.80,
  maintenance: 0.90,
  optimal_surplus: 1.10,
  high_surplus: 1.15,
  unknown: 1.00,
};

export const NEAT_BASE_PAL: Readonly<Record<NeatLevel, number>> = {
  sedentary: 1.20,
  light: 1.32,
  moderate: 1.45,
  active: 1.58,
  very_active: 1.72,
};

export const PHASE_CONFIG: Readonly<Record<GoalMode, NutritionPhaseConfig>> = {
  lean_bulk: {
    ratePctByLevel: { novice: 0.40, intermediate: 0.25, advanced: 0.15 },
    kcalPerKg: 5800,
    deltaBounds: [100, 450],
    maxWeeks: 24,
    proteinPerKgFfm: 2.1,
    fatMinPerKgRef: 0.65,
    fatMinPct: 0.20,
    fatTargetPct: 0.25,
    fatMaxPerKgRef: 1.00,
  },
  recomp: {
    ratePctByLevel: { novice: -0.10, intermediate: 0.00, advanced: 0.00 },
    kcalPerKg: 7700,
    deltaBounds: [-200, 100],
    maxWeeks: 16,
    proteinPerKgFfm: 2.4,
    fatMinPerKgRef: 0.65,
    fatMinPct: 0.20,
    fatTargetPct: 0.24,
    fatMaxPerKgRef: 0.95,
  },
  maintenance: {
    ratePctByLevel: { novice: 0.00, intermediate: 0.00, advanced: 0.00 },
    kcalPerKg: 7700,
    deltaBounds: [-100, 100],
    maxWeeks: null,
    proteinPerKgFfm: 2.1,
    fatMinPerKgRef: 0.65,
    fatMinPct: 0.20,
    fatTargetPct: 0.25,
    fatMaxPerKgRef: 1.00,
  },
  mini_cut: {
    ratePctByLevel: { novice: -1.10, intermediate: -1.00, advanced: -0.85 },
    kcalPerKg: 7700,
    deltaBounds: [-1000, -450],
    maxWeeks: 6,
    proteinPerKgFfm: 2.8,
    fatMinPerKgRef: 0.65,
    fatMinPct: 0.20,
    fatTargetPct: 0.22,
    fatMaxPerKgRef: 0.85,
  },
  cut: {
    ratePctByLevel: { novice: -0.75, intermediate: -0.65, advanced: -0.50 },
    kcalPerKg: 8200,
    deltaBounds: [-750, -250],
    maxWeeks: 16,
    proteinPerKgFfm: 2.6,
    fatMinPerKgRef: 0.65,
    fatMinPct: 0.20,
    fatTargetPct: 0.22,
    fatMaxPerKgRef: 0.90,
  },
};

export const DUP_DAY_OFFSETS: Readonly<Record<DupDayType, number>> = {
  legs: 0.12,
  push: 0.00,
  pull: 0.06,
  rest: -0.18,
  deload: 0.00,
};

export const SESSION_EEE_KCAL_PER_KG: Readonly<Record<DupDayType, number>> = {
  legs: 4.8,
  pull: 4.0,
  push: 3.6,
  deload: 2.2,
  rest: 0.0,
};

// --- DETERMINISTIC DATE & ROUNDING HELPERS (UTC-SAFE, NO DST DRIFT) ---

const MS_PER_DAY = 86_400_000;

function parseIsoDayNumber(isoDate: string): number {
  const [y, m, d] = isoDate.split("-").map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / MS_PER_DAY);
}

function dayNumberToIso(dayNum: number): string {
  return new Date(dayNum * MS_PER_DAY).toISOString().slice(0, 10);
}

function roundTo(val: number, step: number): number {
  return Math.round(val / step) * step;
}

function ceilTo(val: number, step: number): number {
  return Math.ceil(val / step) * step;
}

function roundDecimals(val: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round((val + Number.EPSILON) * f) / f;
}

function clamp(val: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, val));
}

// ============================================================================
// MODULE 1: AdaptiveTdeeEstimator
// ============================================================================

export class AdaptiveTdeeEstimator {
  public estimateFfmKg(
    weightKg: number,
    heightCm: number,
    sex: BiologicalSex,
    bodyFatPct?: number | null,
    formula: FfmFormula = "janmahasatian",
  ): FfmEstimate {
    if (bodyFatPct !== undefined && bodyFatPct !== null && Number.isFinite(bodyFatPct)) {
      const bf = clamp(bodyFatPct, 4.0, 55.0);
      return {
        ffmKg: roundDecimals(weightKg * (1 - bf / 100), 2),
        method: "body_fat_pct",
        estimatedBfPct: roundDecimals(bf, 1),
      };
    }

    const heightM = heightCm / 100;
    const bmi = weightKg / (heightM * heightM);
    let rawFfm: number;

    if (formula === "boer") {
      rawFfm =
        sex === "male"
          ? 0.407 * weightKg + 0.267 * heightCm - 19.2
          : 0.252 * weightKg + 0.473 * heightCm - 48.3;
    } else {
      rawFfm =
        sex === "male"
          ? (9270 * weightKg) / (6680 + 216 * bmi)
          : (9270 * weightKg) / (8780 + 244 * bmi);
    }

    const ffm = clamp(rawFfm, weightKg * 0.45, weightKg * 0.94);
    return {
      ffmKg: roundDecimals(ffm, 2),
      method: formula,
      estimatedBfPct: roundDecimals((1 - ffm / weightKg) * 100, 1),
    };
  }

  public estimatePriorTdee(profile: NutritionProfile): PriorTdeeEstimate {
    const ffmInfo = this.estimateFfmKg(
      profile.weightKg,
      profile.heightCm,
      profile.sex,
      profile.bodyFatPct,
      profile.ffmFormula ?? "janmahasatian",
    );

    const hasBf =
      profile.bodyFatPct !== undefined &&
      profile.bodyFatPct !== null &&
      Number.isFinite(profile.bodyFatPct);
    const bmr = hasBf
      ? 370 + 21.6 * ffmInfo.ffmKg
      : 10 * profile.weightKg +
        6.25 * profile.heightCm -
        5 * profile.ageYears +
        (profile.sex === "male" ? 5 : -161);

    const neatPal = NEAT_BASE_PAL[profile.neatLevel ?? "moderate"];
    const sessionsWk = profile.weeklyTrainingSessions ?? 5.25;
    const trainingBonus = Math.min(0.22, sessionsWk * 0.032);
    const pal = Math.min(1.95, neatPal + trainingBonus);
    const priorTdeeKcal = roundTo(bmr * pal, 10);

    const avgSessionEee =
      ((SESSION_EEE_KCAL_PER_KG.legs +
        SESSION_EEE_KCAL_PER_KG.push +
        SESSION_EEE_KCAL_PER_KG.pull) /
        3) *
      profile.weightKg;
    const avgDailyEeeKcal = roundDecimals((avgSessionEee * sessionsWk) / 7, 1);

    return {
      bmrKcal: roundDecimals(bmr, 1),
      bmrMethod: hasBf ? "katch_mcardle" : "mifflin_st_jeor",
      ffmKg: ffmInfo.ffmKg,
      ffmMethod: ffmInfo.method,
      estimatedBfPct: ffmInfo.estimatedBfPct,
      pal: roundDecimals(pal, 3),
      priorTdeeKcal,
      avgDailyEeeKcal,
    };
  }

  public computeTrendWeight(
    weighIns: readonly BodyweightEntry[],
    creatineStartDate?: string | null,
    alpha1d = 0.15,
    huberKPct = 0.008,
    huberMinKg = 0.60,
    maxGapDays = 7,
  ): TrendWeightPoint[] {
    if (weighIns.length === 0) return [];

    // Deduplicate by date (latest entry wins) and sort ascending
    const byDate = new Map<string, number>();
    for (const entry of weighIns) {
      if (Number.isFinite(entry.weightKg) && entry.weightKg > 20 && entry.weightKg < 350) {
        byDate.set(entry.date, entry.weightKg);
      }
    }
    const sortedDates = Array.from(byDate.keys()).sort();
    if (sortedDates.length === 0) return [];

    const crDayNum = creatineStartDate ? parseIsoDayNumber(creatineStartDate) : null;
    const out: TrendWeightPoint[] = [];

    let prevDay = parseIsoDayNumber(sortedDates[0]);
    let scaleTrend = byDate.get(sortedDates[0])!;
    let metabolicTrend = scaleTrend;
    let creatineOffset = 0;
    let preCreatineWeight = scaleTrend;

    for (let idx = 0; idx < sortedDates.length; idx++) {
      const ds = sortedDates[idx];
      const curDay = parseIsoDayNumber(ds);
      const rawW = byDate.get(ds)!;
      const dt = idx > 0 ? Math.max(1, curDay - prevDay) : 1;

      let crWeight = 0;
      if (crDayNum !== null) {
        const dCr = curDay - crDayNum;
        if (dCr >= 1 && dCr <= 14) {
          crWeight = 1.0;
        } else if (dCr >= 15 && dCr <= 21) {
          crWeight = (22 - dCr) / 8;
        }
      }

      const effDt = Math.min(dt, maxGapDays);
      const alpha = 1 - (1 - alpha1d) ** effDt;

      let residual = 0;
      let clipped = 0;
      let isOutlier = false;

      if (idx > 0) {
        residual = rawW - scaleTrend;
        const deltaHuber = Math.max(huberMinKg, huberKPct * scaleTrend);

        if (crWeight >= 0.5 && residual > 0) {
          clipped = Math.min(residual, deltaHuber * 1.5);
          isOutlier = Math.abs(residual) > deltaHuber * 1.5;
        } else if (Math.abs(residual) > deltaHuber) {
          clipped =
            Math.sign(residual) * (deltaHuber + 0.15 * (Math.abs(residual) - deltaHuber));
          isOutlier = true;
        } else {
          clipped = residual;
          isOutlier = false;
        }

        const prevScale = scaleTrend;
        scaleTrend = scaleTrend + alpha * clipped;
        const stepChange = scaleTrend - prevScale;

        if (crDayNum !== null && curDay <= crDayNum) {
          preCreatineWeight = scaleTrend;
        } else if (crWeight > 0 && stepChange > 0) {
          const maxCrWater = 0.022 * preCreatineWeight;
          const netAboveBaseline = Math.max(0, scaleTrend - preCreatineWeight);
          const cap = Math.min(maxCrWater, netAboveBaseline);
          const absorbed = Math.min(stepChange * crWeight, Math.max(0, cap - creatineOffset));
          creatineOffset += absorbed;
        }
        metabolicTrend = scaleTrend - creatineOffset;
      } else if (crDayNum !== null && curDay <= crDayNum) {
        preCreatineWeight = scaleTrend;
      }

      out.push({
        date: ds,
        rawKg: roundDecimals(rawW, 3),
        scaleTrendKg: roundDecimals(scaleTrend, 3),
        metabolicTrendKg: roundDecimals(metabolicTrend, 3),
        creatineOffsetKg: roundDecimals(creatineOffset, 3),
        residualKg: roundDecimals(residual, 3),
        clippedResidualKg: roundDecimals(clipped, 3),
        isOutlier,
        inCreatineWindow: crWeight > 0,
      });

      prevDay = curDay;
    }

    return out;
  }

  public estimateTdee(
    profile: NutritionProfile,
    weighIns: readonly BodyweightEntry[],
    nutritionLogs: readonly DailyNutritionLog[],
    goalMode: GoalMode = "maintenance",
    asOfDate?: string | null,
    creatineStartDate?: string | null,
  ): TdeeEstimateReport {
    const prior = this.estimatePriorTdee(profile);
    const scopedWeighIns = asOfDate ? weighIns.filter((w) => w.date <= asOfDate) : weighIns;
    const trendSeries = this.computeTrendWeight(scopedWeighIns, creatineStartDate);

    if (trendSeries.length === 0) {
      return {
        mode: "lite",
        status: "cold_start_no_weights",
        priorTdeeKcal: prior.priorTdeeKcal,
        adaptiveTdeeKcal: prior.priorTdeeKcal,
        confidence: 0,
        trendWeightKg: profile.weightKg,
        metabolicTrendWeightKg: profile.weightKg,
        rateKgPerWeek: 0,
        ratePctPerWeek: 0,
        avgIntake14dKcal: null,
        netEnergyBalanceKcal: null,
        adherence14d: 0,
        prior,
        trendSeries: [],
      };
    }

    const startDay = parseIsoDayNumber(trendSeries[0].date);
    const endDay = asOfDate
      ? Math.max(startDay, parseIsoDayNumber(asOfDate))
      : parseIsoDayNumber(trendSeries[trendSeries.length - 1].date);

    const trendByDate = new Map<string, TrendWeightPoint>();
    for (const pt of trendSeries) trendByDate.set(pt.date, pt);

    const totalDays = endDay - startDay + 1;
    const calDays: string[] = new Array(totalDays);
    for (let i = 0; i < totalDays; i++) {
      calDays[i] = dayNumberToIso(startDay + i);
    }

    // O(N) linear interpolation of metabolicTrendKg & scaleTrendKg over calendar days
    const metInterp = new Float64Array(totalDays);
    const scaleInterp = new Float64Array(totalDays);
    const knownIndices: number[] = [];
    for (let i = 0; i < totalDays; i++) {
      if (trendByDate.has(calDays[i])) knownIndices.push(i);
    }

    for (let pos = 0; pos < knownIndices.length; pos++) {
      const ki = knownIndices[pos];
      const pt = trendByDate.get(calDays[ki])!;
      metInterp[ki] = pt.metabolicTrendKg;
      scaleInterp[ki] = pt.scaleTrendKg;

      if (pos > 0) {
        const prevKi = knownIndices[pos - 1];
        const span = ki - prevKi;
        if (span > 1) {
          const m0 = metInterp[prevKi];
          const m1 = metInterp[ki];
          const s0 = scaleInterp[prevKi];
          const s1 = scaleInterp[ki];
          for (let step = 1; step < span; step++) {
            const frac = step / span;
            metInterp[prevKi + step] = m0 + frac * (m1 - m0);
            scaleInterp[prevKi + step] = s0 + frac * (s1 - s0);
          }
        }
      }
    }
    const lastKi = knownIndices[knownIndices.length - 1];
    for (let i = lastKi + 1; i < totalDays; i++) {
      metInterp[i] = metInterp[lastKi];
      scaleInterp[i] = scaleInterp[lastKi];
    }

    // Index nutrition logs (deduplicated by date, excluding dates after asOfDate)
    interface IndexedLog {
      kcal: number;
      isValid: boolean;
      dayClass: "rest" | "training";
    }
    const nutByDate = new Map<string, IndexedLog>();

    for (const log of nutritionLogs) {
      if (!isCalendarDate(log.date)) continue;
      const ld = parseIsoDayNumber(log.date);
      if (ld > endDay) continue;
      const isValid = log.caloriesKcal >= 800 && !log.partialLog;
      nutByDate.set(log.date, {
        kcal: log.caloriesKcal,
        isValid,
        dayClass: log.dayType === "rest" ? "rest" : "training",
      });
    }

    let validLogsLast28 = 0;
    for (const [date, entry] of nutByDate) {
      const ld = parseIsoDayNumber(date);
      if (entry.isValid && endDay - ld >= 0 && endDay - ld < 28) {
        validLogsLast28++;
      }
    }

    const latestIdx = totalDays - 1;
    const lookback = Math.min(14, latestIdx);
    const latestScale = scaleInterp[latestIdx];
    const latestMet = metInterp[latestIdx];
    const prevMet = metInterp[latestIdx - lookback];
    const rateKgPerWeek = lookback >= 7 ? ((latestMet - prevMet) / lookback) * 7 : 0;
    const ratePctPerWeek = latestScale > 0 ? (rateKgPerWeek / latestScale) * 100 : 0;

    const tailStart = Math.max(0, totalDays - 21);
    let weighIns21d = 0;
    for (let i = tailStart; i < totalDays; i++) {
      if (trendByDate.has(calDays[i])) weighIns21d++;
    }
    const spanDays =
      parseIsoDayNumber(trendSeries[trendSeries.length - 1].date) -
      parseIsoDayNumber(trendSeries[0].date);
    const liteConf =
      weighIns21d >= 6 && spanDays >= 12 ? Math.min(0.85, (weighIns21d / 14) * 0.85) : 0.20;

    // LITE MODE DEGRADATION (0 valid calorie logs in last 28 days)
    if (validLogsLast28 === 0) {
      return {
        mode: "lite",
        status: liteConf >= 0.35 ? "lite_trend_only" : "lite_insufficient_weighins",
        priorTdeeKcal: prior.priorTdeeKcal,
        adaptiveTdeeKcal: prior.priorTdeeKcal,
        confidence: roundDecimals(liteConf, 2),
        trendWeightKg: roundDecimals(latestScale, 2),
        metabolicTrendWeightKg: roundDecimals(latestMet, 2),
        rateKgPerWeek: roundDecimals(rateKgPerWeek, 3),
        ratePctPerWeek: roundDecimals(ratePctPerWeek, 3),
        avgIntake14dKcal: null,
        netEnergyBalanceKcal: null,
        adherence14d: 0,
        prior,
        trendSeries,
      };
    }

    // PRO MODE: 1D Recursive Kalman Filter (O(N))
    let tdee = prior.priorTdeeKcal;
    let P = 280 ** 2;
    const Q = 26 ** 2;
    const SIGMA_MEAS = 210;
    const MAX_DAILY_DRIFT = 25;
    const W = 14;
    const phaseDensity = PHASE_CONFIG[goalMode].kcalPerKg;

    let status: TdeeStatus = "cold_start";
    let updatesCount = 0;
    let lastAvgIn: number | null = null;
    let lastAdherence = 0;
    const tdeeHistory: TdeeHistoryPoint[] = [];

    for (let i = W; i < totalDays; i++) {
      let valid14Count = 0;
      let valid7Count = 0;
      let weighins14 = 0;
      let sumAll = 0;
      let sumTrain = 0;
      let cntTrain = 0;
      let sumRest = 0;
      let cntRest = 0;

      for (let j = i - W + 1; j <= i; j++) {
        const ds = calDays[j];
        if (trendByDate.has(ds)) weighins14++;
        const entry = nutByDate.get(ds);
        if (entry && entry.isValid) {
          valid14Count++;
          if (j >= i - 6) valid7Count++;
          sumAll += entry.kcal;
          if (entry.dayClass === "rest") {
            sumRest += entry.kcal;
            cntRest++;
          } else {
            sumTrain += entry.kcal;
            cntTrain++;
          }
        }
      }

      const adherence14 = valid14Count / W;
      lastAdherence = adherence14;

      if (valid14Count < 10 || valid7Count < 4 || weighins14 < 4) {
        status = "holding_low_adherence";
        lastAvgIn = null;
        if (updatesCount > 0) P = Math.min(400 ** 2, P + Q);
        tdeeHistory.push({ date: calDays[i], tdee: roundDecimals(tdee, 1), status });
        continue;
      }

      const meanAll = sumAll / valid14Count;
      const meanTrain = cntTrain > 0 ? sumTrain / cntTrain : meanAll;
      const meanRest = cntRest > 0 ? sumRest / cntRest : meanAll;

      let totalIn = 0;
      for (let j = i - W + 1; j <= i; j++) {
        const entry = nutByDate.get(calDays[j]);
        if (entry && entry.isValid) {
          totalIn += entry.kcal;
        } else if (entry) {
          totalIn += entry.dayClass === "rest" ? meanRest : meanTrain;
        } else {
          totalIn += meanAll;
        }
      }
      const avgIn14 = totalIn / W;
      lastAvgIn = avgIn14;

      const deltaW = metInterp[i] - metInterp[i - W];
      const usePhaseDensity =
        (goalMode === "lean_bulk" && deltaW >= 0) ||
        ((goalMode === "cut" || goalMode === "mini_cut") && deltaW <= 0) ||
        goalMode === "maintenance" ||
        goalMode === "recomp";
      const effDensity = usePhaseDensity ? phaseDensity : 7700;
      const tdeeObs = avgIn14 - (deltaW * effDensity) / W;

      const pPred = P + Q;
      const weighinFactor = Math.min(1, weighins14 / 10);
      const R = (SIGMA_MEAS ** 2) / Math.max(0.35, adherence14 * weighinFactor);
      const K = clamp(pPred / (pPred + R), 0.06, 0.30);

      const clampedStep = clamp(K * (tdeeObs - tdee), -MAX_DAILY_DRIFT, MAX_DAILY_DRIFT);
      tdee = clamp(tdee + clampedStep, 1000, 6500);
      P = (1 - K) * pPred;
      updatesCount++;
      status = updatesCount >= 14 ? "converged" : "calibrating";

      tdeeHistory.push({
        date: calDays[i],
        tdee: roundDecimals(tdee, 1),
        tdeeObs: roundDecimals(tdeeObs, 1),
        K: roundDecimals(K, 3),
        status,
      });
    }

    let conf = 0;
    if (updatesCount > 0) {
      const dataConf = Math.min(1, updatesCount / 14);
      const uncConf = Math.max(0.2, 1 - Math.sqrt(P) / 300);
      const penalty = status === "holding_low_adherence" ? 0.65 : 1.0;
      conf = roundDecimals(Math.min(0.98, 0.55 * dataConf + 0.45 * uncConf) * penalty, 2);
    } else if (liteConf >= 0.35) {
      // 1–9 неполных/разрозненных записей калорий: сохраняем Lite-уверенность по тренду веса для EnergyStatusBridge
      conf = roundDecimals(liteConf, 2);
    }

    return {
      mode: "pro",
      status,
      priorTdeeKcal: prior.priorTdeeKcal,
      adaptiveTdeeKcal: roundTo(tdee, 5),
      adaptiveTdeeExact: roundDecimals(tdee, 1),
      uncertaintySdKcal: roundDecimals(Math.sqrt(P), 1),
      confidence: conf,
      trendWeightKg: roundDecimals(latestScale, 2),
      metabolicTrendWeightKg: roundDecimals(latestMet, 2),
      rateKgPerWeek: roundDecimals(rateKgPerWeek, 3),
      ratePctPerWeek: roundDecimals(ratePctPerWeek, 3),
      avgIntake14dKcal: lastAvgIn !== null ? roundDecimals(lastAvgIn, 1) : null,
      netEnergyBalanceKcal: lastAvgIn !== null ? roundDecimals(lastAvgIn - tdee, 1) : null,
      adherence14d: roundDecimals(lastAdherence, 3),
      prior,
      trendSeries,
      tdeeHistory,
    };
  }
}

// ============================================================================
// MODULE 2: NutritionPhaseController & MacroPeriodizer
// ============================================================================

export class NutritionPhaseController {
  public computeWeeklyCheckIn(
    tdeeReport: TdeeEstimateReport,
    profile: NutritionProfile,
    goalMode: GoalMode,
    options: WeeklyCheckInOptions = {},
  ): WeeklyCheckInResult {
    const cfg = PHASE_CONFIG[goalMode];
    const level = profile.trainingLevel ?? "intermediate";
    const targetRatePct = cfg.ratePctByLevel[level];
    const trendW = tdeeReport.trendWeightKg;
    const { ffmKg, bmrKcal, avgDailyEeeKcal, estimatedBfPct } = tdeeReport.prior;
    const priorTdee = tdeeReport.priorTdeeKcal;
    const adaptiveTdee = tdeeReport.adaptiveTdeeKcal;
    const actualRatePct = tdeeReport.ratePctPerWeek;
    const longLevers = profile.longLevers ?? false;
    const weeksInPhase = options.weeksInPhase ?? 1;
    const previousTarget = options.previousTargetKcal ?? null;
    const e1rmDropPct = options.e1rmDropPct ?? 0;
    const ewmaFatigueHigh = options.ewmaFatigueHigh ?? false;

    let rawGoalDelta = ((targetRatePct / 100) * trendW * cfg.kcalPerKg) / 7;
    if (goalMode === "recomp") {
      const bfCut = profile.sex === "male" ? 16.0 : 25.0;
      rawGoalDelta = estimatedBfPct > bfCut ? -150 : 0;
    }
    const goalDelta = clamp(rawGoalDelta, cfg.deltaBounds[0], cfg.deltaBounds[1]);

    // Hard IOC 2023 RED-S Safety Floor (EA >= 30 kcal/kg FFM/day)
    const eaFloor = 30.0 * ffmKg + avgDailyEeeKcal;
    const bmrFloor = 0.95 * bmrKcal;
    const sexFloor = profile.sex === "male" ? 1500 : 1200;
    const safetyFloorKcal = ceilTo(Math.max(eaFloor, bmrFloor, sexFloor), 10);

    const tdeeDriftPct = (adaptiveTdee - priorTdee) / priorTdee;
    let neatPlateauDetected = false;
    if (goalMode === "lean_bulk") {
      const neatThresh = longLevers ? 0.10 : 0.12;
      if (tdeeDriftPct >= neatThresh && actualRatePct < targetRatePct * 0.40 && weeksInPhase >= 2) {
        neatPlateauDetected = true;
      }
    }

    let dietBreakRecommended = false;
    let dietBreakReason: WeeklyCheckInResult["dietBreakReason"] = null;
    if (goalMode === "mini_cut" && cfg.maxWeeks !== null && weeksInPhase >= cfg.maxWeeks) {
      dietBreakRecommended = true;
      dietBreakReason = "mini_cut_max_duration_6w";
    } else if (goalMode === "cut") {
      if (tdeeDriftPct <= -0.12) {
        dietBreakRecommended = true;
        dietBreakReason = "metabolic_adaptation_gt_12pct";
      } else if (
        weeksInPhase >= 10 &&
        (tdeeDriftPct <= -0.08 || e1rmDropPct >= 0.05 || ewmaFatigueHigh)
      ) {
        dietBreakRecommended = true;
        dietBreakReason = "prolonged_cut_fatigue_or_strength_drop";
      }
    }

    // LITE MODE
    if (tdeeReport.mode === "lite") {
      if (tdeeReport.status !== "lite_trend_only") {
        return {
          mode: "lite",
          goalMode,
          nextTargetKcal: null,
          kcalDeltaHint: 0,
          targetRatePctPerWeek: targetRatePct,
          actualRatePctPerWeek: actualRatePct,
          safetyFloorKcal,
          safetyFloorHit: false,
          neatPlateauDetected: false,
          dietBreakRecommended,
          dietBreakReason,
          adjustmentReason: "lite_insufficient_data",
        };
      }
      const rateErrPct = targetRatePct - actualRatePct;
      const rawHint = ((rateErrPct / 100) * trendW * cfg.kcalPerKg) / 7;
      const kcalHint = Math.abs(rawHint) < 50 ? 0 : roundTo(clamp(rawHint, -300, 300), 10);
      const reason =
        kcalHint === 0
          ? "lite_on_track"
          : kcalHint > 0
            ? "lite_increase_intake"
            : "lite_decrease_intake";

      return {
        mode: "lite",
        goalMode,
        nextTargetKcal: null,
        kcalDeltaHint: kcalHint,
        targetRatePctPerWeek: targetRatePct,
        actualRatePctPerWeek: actualRatePct,
        safetyFloorKcal,
        safetyFloorHit: false,
        neatPlateauDetected: false,
        dietBreakRecommended,
        dietBreakReason,
        adjustmentReason: reason,
      };
    }

    // PRO MODE — Low Adherence Hold (всегда соблюдаем пол безопасности RED-S)
    if (tdeeReport.status === "holding_low_adherence" && previousTarget !== null) {
      const heldTarget = Math.max(previousTarget, safetyFloorKcal);
      const floorEnforced = previousTarget < safetyFloorKcal;
      return {
        mode: "pro",
        goalMode,
        nextTargetKcal: heldTarget,
        deltaFromPreviousKcal: roundDecimals(heldTarget - previousTarget, 1),
        goalDeltaKcal: roundDecimals(goalDelta, 1),
        targetRatePctPerWeek: targetRatePct,
        actualRatePctPerWeek: actualRatePct,
        safetyFloorKcal,
        safetyFloorHit: floorEnforced || heldTarget <= safetyFloorKcal,
        achievedEaKcalPerKgFfm: roundDecimals((heldTarget - avgDailyEeeKcal) / ffmKg, 1),
        neatPlateauDetected: false,
        dietBreakRecommended,
        dietBreakReason,
        adjustmentReason: floorEnforced ? "safety_floor_reds_ea30" : "holding_low_adherence",
      };
    }

    let rateCorrection = 0;
    if (goalMode === "lean_bulk" && actualRatePct > targetRatePct * 1.8) {
      const excessKcal = (((actualRatePct - targetRatePct) / 100) * trendW * cfg.kcalPerKg) / 7;
      rateCorrection = -Math.min(150, 0.5 * excessKcal);
    } else if (neatPlateauDetected) {
      rateCorrection = longLevers ? 200 : 150;
    }

    const proposed = roundTo(adaptiveTdee + goalDelta + rateCorrection, 10);
    let nextTarget = proposed;
    let reason = "updated";

    if (previousTarget !== null) {
      const diff = proposed - previousTarget;
      if (Math.abs(diff) < 40 && proposed >= safetyFloorKcal) {
        nextTarget = previousTarget;
        reason = "within_deadband";
      } else {
        const maxUp = neatPlateauDetected ? 250 : 200;
        const clampedDiff = clamp(diff, -200, maxUp);
        nextTarget = roundTo(previousTarget + clampedDiff, 10);
        if (clampedDiff !== diff) reason = "step_capped";
        else if (neatPlateauDetected) reason = "neat_plateau_boost";
      }
    }

    let safetyFloorHit = false;
    if (nextTarget < safetyFloorKcal) {
      nextTarget = safetyFloorKcal;
      safetyFloorHit = true;
      reason = "safety_floor_reds_ea30";
    }

    return {
      mode: "pro",
      goalMode,
      nextTargetKcal: nextTarget,
      deltaFromPreviousKcal: previousTarget !== null ? roundDecimals(nextTarget - previousTarget, 1) : 0,
      goalDeltaKcal: roundDecimals(goalDelta, 1),
      rateCorrectionKcal: roundDecimals(rateCorrection, 1),
      targetRatePctPerWeek: targetRatePct,
      actualRatePctPerWeek: actualRatePct,
      tdeeDriftPct: roundDecimals(tdeeDriftPct * 100, 1),
      safetyFloorKcal,
      safetyFloorHit,
      achievedEaKcalPerKgFfm: roundDecimals((nextTarget - avgDailyEeeKcal) / ffmKg, 1),
      neatPlateauDetected,
      dietBreakRecommended,
      dietBreakReason,
      dietBreakTargetKcal: dietBreakRecommended ? roundTo(adaptiveTdee, 10) : null,
      adjustmentReason: reason,
    };
  }
}

export class MacroPeriodizer {
  public allocateDailyMacros(
    targetKcal: number,
    bodyMassKg: number,
    ffmKg: number,
    sex: BiologicalSex,
    goalMode: GoalMode,
    dayType: DupDayType = "push",
    adaptiveTdeeKcal?: number | null,
    enableCycling = true,
  ): DailyMacroTarget {
    const cfg = PHASE_CONFIG[goalMode];
    const refWeight = Math.min(bodyMassKg, ffmKg / (sex === "male" ? 0.85 : 0.78));

    let baseKcal = targetKcal;
    if (
      dayType === "deload" &&
      adaptiveTdeeKcal !== undefined &&
      adaptiveTdeeKcal !== null &&
      (goalMode === "cut" || goalMode === "mini_cut" || goalMode === "lean_bulk")
    ) {
      baseKcal = roundTo(adaptiveTdeeKcal, 10);
    }

    const proteinG = roundTo(cfg.proteinPerKgFfm * ffmKg, 5);
    const fatFloorG = ceilTo(
      Math.max(cfg.fatMinPerKgRef * refWeight, (cfg.fatMinPct * targetKcal) / 9),
      5,
    );
    const fatTargetG = roundTo(
      Math.min(cfg.fatMaxPerKgRef * refWeight, (cfg.fatTargetPct * targetKcal) / 9),
      5,
    );
    const fatG = Math.max(fatFloorG, fatTargetG);

    const fixedKcal = proteinG * 4 + fatG * 9;
    const baseCarbsG = Math.max(50, (baseKcal - fixedKcal) / 4);

    let scaleK = 0;
    let carbsG: number;

    if (
      enableCycling &&
      (dayType === "legs" || dayType === "push" || dayType === "pull" || dayType === "rest")
    ) {
      const minRestCarbs = Math.max(100, 1.5 * ffmKg);
      const rawRestCarbs = (baseKcal * (1 + DUP_DAY_OFFSETS.rest) - fixedKcal) / 4;

      if (rawRestCarbs < minRestCarbs && baseCarbsG > minRestCarbs) {
        scaleK = clamp(
          ((baseCarbsG - minRestCarbs) * 4) / (Math.abs(DUP_DAY_OFFSETS.rest) * baseKcal),
          0,
          1,
        );
      } else if (rawRestCarbs < minRestCarbs) {
        scaleK = 0;
      } else {
        scaleK = 1;
      }

      const cycleKeys: readonly ("legs" | "push" | "pull" | "rest")[] = [
        "legs",
        "push",
        "pull",
        "rest",
      ];
      const rounded4: Record<"legs" | "push" | "pull" | "rest", number> = {
        legs: 0,
        push: 0,
        pull: 0,
        rest: 0,
      };
      let sum4 = 0;
      for (const k of cycleKeys) {
        const dKcal = baseKcal * (1 + DUP_DAY_OFFSETS[k] * scaleK);
        rounded4[k] = Math.max(50, roundTo((dKcal - fixedKcal) / 4, 5));
        sum4 += rounded4[k];
      }

      // Exact 4-day zero-sum residual correction on neutral Push day
      const exact4CarbSum = Math.max(200, roundTo((baseKcal * 4 - fixedKcal * 4) / 4, 5));
      const remG = exact4CarbSum - sum4;
      if (Math.abs(remG) >= 5) {
        rounded4.push = Math.max(50, rounded4.push + remG);
      }
      carbsG = rounded4[dayType];
    } else {
      carbsG = roundTo(baseCarbsG, 5);
    }

    const actualKcal = Math.round(proteinG * 4 + fatG * 9 + carbsG * 4);
    return {
      dayType,
      targetKcal: actualKcal,
      proteinG: Math.round(proteinG),
      fatG: Math.round(fatG),
      carbsG: Math.round(carbsG),
      cyclingScale: roundDecimals(scaleK, 3),
      fatPctWeekly: roundDecimals(((fatG * 9) / targetKcal) * 100, 1),
      fatPerKgRef: roundDecimals(fatG / refWeight, 2),
    };
  }
}

// ============================================================================
// MODULE 3: EnergyStatusBridge -> DeloadEngine v2
// ============================================================================

export class EnergyStatusBridge {
  public deriveEnergyStatus(
    tdeeReport: TdeeEstimateReport,
    previousStatus: EnergyStatus = "unknown",
  ): EnergyStatusBridgeResult {
    if (tdeeReport.confidence < 0.35) {
      return {
        energyStatus: "unknown",
        capacityMultiplier: ENERGY_CAPACITY_MULTIPLIER.unknown,
        hysteresisHeld: false,
        basis: "low_confidence",
      };
    }

    if (tdeeReport.mode === "pro" && tdeeReport.netEnergyBalanceKcal !== null) {
      const net = tdeeReport.netEnergyBalanceKcal;
      const H = 50;
      let status: EnergyStatus;

      if (previousStatus === "deficit") {
        status =
          net < -175 + H
            ? "deficit"
            : net < 125
              ? "maintenance"
              : net < 425
                ? "optimal_surplus"
                : "high_surplus";
      } else if (previousStatus === "optimal_surplus") {
        status =
          net <= -175
            ? "deficit"
            : net < 125 - H
              ? "maintenance"
              : net >= 425
                ? "high_surplus"
                : "optimal_surplus";
      } else if (previousStatus === "high_surplus") {
        status =
          net <= -175
            ? "deficit"
            : net < 125 - H
              ? "maintenance"
              : net < 425 - H
                ? "optimal_surplus"
                : "high_surplus";
      } else {
        status =
          net <= -175
            ? "deficit"
            : net < 125
              ? "maintenance"
              : net < 425
                ? "optimal_surplus"
                : "high_surplus";
      }

      const rawStatus: EnergyStatus =
        net <= -175
          ? "deficit"
          : net < 125
            ? "maintenance"
            : net < 425
              ? "optimal_surplus"
              : "high_surplus";

      return {
        energyStatus: status,
        capacityMultiplier: ENERGY_CAPACITY_MULTIPLIER[status],
        hysteresisHeld: status !== rawStatus,
        basis: `pro_net_14d=${net >= 0 ? "+" : ""}${net.toFixed(1)}`,
      };
    }

    // LITE MODE BRIDGE (from metabolic trend weight rate %BW/week)
    const rate = tdeeReport.ratePctPerWeek;
    const HR = 0.06;
    let status: EnergyStatus;

    if (previousStatus === "deficit") {
      status =
        rate < -0.20 + HR
          ? "deficit"
          : rate < 0.12
            ? "maintenance"
            : rate < 0.50
              ? "optimal_surplus"
              : "high_surplus";
    } else if (previousStatus === "optimal_surplus") {
      status =
        rate <= -0.20
          ? "deficit"
          : rate < 0.12 - HR
            ? "maintenance"
            : rate >= 0.50
              ? "high_surplus"
              : "optimal_surplus";
    } else if (previousStatus === "high_surplus") {
      status =
        rate <= -0.20
          ? "deficit"
          : rate < 0.12 - HR
            ? "maintenance"
            : rate < 0.50 - HR
              ? "optimal_surplus"
              : "high_surplus";
    } else {
      status =
        rate <= -0.20
          ? "deficit"
          : rate < 0.12
            ? "maintenance"
            : rate < 0.50
              ? "optimal_surplus"
              : "high_surplus";
    }

    const rawStatus: EnergyStatus =
      rate <= -0.20
        ? "deficit"
        : rate < 0.12
          ? "maintenance"
          : rate < 0.50
            ? "optimal_surplus"
            : "high_surplus";

    return {
      energyStatus: status,
      capacityMultiplier: ENERGY_CAPACITY_MULTIPLIER[status],
      hysteresisHeld: status !== rawStatus,
      basis: `lite_rate=${rate >= 0 ? "+" : ""}${rate.toFixed(3)}%/wk`,
    };
  }
}

// ============================================================================
// FACADE: AdaptiveNutritionEngine
// ============================================================================

export class AdaptiveNutritionEngine {
  public readonly tdeeEstimator = new AdaptiveTdeeEstimator();
  public readonly phaseController = new NutritionPhaseController();
  public readonly macroPeriodizer = new MacroPeriodizer();
  public readonly energyBridge = new EnergyStatusBridge();

  public runFullCycle(params: {
    profile: NutritionProfile;
    weighIns: readonly BodyweightEntry[];
    nutritionLogs: readonly DailyNutritionLog[];
    goalMode: GoalMode;
    todayDayType: DupDayType;
    asOfDate?: string | null;
    creatineStartDate?: string | null;
    previousStatus?: EnergyStatus;
    checkInOptions?: WeeklyCheckInOptions;
    enableCarbCycling?: boolean;
  }): {
    tdee: TdeeEstimateReport;
    checkIn: WeeklyCheckInResult;
    todayMacros: DailyMacroTarget | null;
    energyBridge: EnergyStatusBridgeResult;
  } {
    const tdee = this.tdeeEstimator.estimateTdee(
      params.profile,
      params.weighIns,
      params.nutritionLogs,
      params.goalMode,
      params.asOfDate,
      params.creatineStartDate,
    );
    const checkIn = this.phaseController.computeWeeklyCheckIn(
      tdee,
      params.profile,
      params.goalMode,
      params.checkInOptions,
    );
    const energyBridge = this.energyBridge.deriveEnergyStatus(
      tdee,
      params.previousStatus ?? "unknown",
    );
    const todayMacros =
      checkIn.nextTargetKcal !== null
        ? this.macroPeriodizer.allocateDailyMacros(
            checkIn.nextTargetKcal,
            tdee.trendWeightKg,
            tdee.prior.ffmKg,
            params.profile.sex,
            params.goalMode,
            params.todayDayType,
            tdee.adaptiveTdeeKcal,
            params.enableCarbCycling ?? true,
          )
        : null;

    return { tdee, checkIn, todayMacros, energyBridge };
  }
}

// ============================================================================
// CLIENT PERSISTENCE: NutritionStore (Account-scoped localStorage, offline PWA)
// ============================================================================

export interface NutritionState {
  profile: NutritionProfile;
  goalMode: GoalMode;
  phaseStartedDate: string; // ISO YYYY-MM-DD
  creatineStartDate: string | null;
  carbCyclingEnabled: boolean;
  currentTargetKcal: number | null;
  lastEnergyStatus: EnergyStatus;
  logs: DailyNutritionLog[];
}

type StorageLike = Pick<Storage, "getItem" | "setItem">;

function defaultStorage(): StorageLike | null {
  return typeof localStorage === "undefined" ? null : localStorage;
}

const VALID_GOAL_MODES = new Set<GoalMode>([
  "lean_bulk",
  "recomp",
  "maintenance",
  "mini_cut",
  "cut",
]);

const VALID_NEAT = new Set<NeatLevel>([
  "sedentary",
  "light",
  "moderate",
  "active",
  "very_active",
]);

const VALID_LEVEL = new Set<TrainingLevel>(["novice", "intermediate", "advanced"]);
const VALID_DAY_TYPES = new Set<DupDayType>(["legs", "push", "pull", "rest", "deload"]);
const VALID_ENERGY_STATUSES = new Set<EnergyStatus>([
  "deficit",
  "maintenance",
  "optimal_surplus",
  "high_surplus",
  "unknown",
]);

export class NutritionStore {
  private readonly storageKey: string;

  constructor(
    accountId: string,
    private readonly adapter?: StorageLike | null,
  ) {
    this.storageKey = `tyaga-nutrition-v5:${accountId}`;
  }

  private get storage(): StorageLike | null {
    return this.adapter !== undefined ? this.adapter : defaultStorage();
  }

  public static createDefaultState(
    todayIso: string,
    fallbackWeightKg = 80,
    longLevers = false,
  ): NutritionState {
    return {
      profile: {
        sex: "male",
        ageYears: 26,
        heightCm: longLevers ? 188 : 180,
        weightKg: Math.round(clamp(fallbackWeightKg, 30, 300) * 10) / 10,
        bodyFatPct: null,
        ffmFormula: "janmahasatian",
        neatLevel: "moderate",
        weeklyTrainingSessions: 5.25,
        trainingLevel: "intermediate",
        longLevers,
      },
      goalMode: "maintenance",
      phaseStartedDate: todayIso,
      creatineStartDate: null,
      carbCyclingEnabled: true,
      currentTargetKcal: null,
      lastEnergyStatus: "unknown",
      logs: [],
    };
  }

  public readRaw(fallbackTodayIso?: string): NutritionState | null {
    const store = this.storage;
    if (!store) return null;
    try {
      const raw = store.getItem(this.storageKey);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Partial<NutritionState>;
      if (!parsed || typeof parsed !== "object" || !parsed.profile) return null;
      const p = parsed.profile as Partial<NutritionProfile>;
      const sex: BiologicalSex = p.sex === "female" ? "female" : "male";
      const ageYears =
        typeof p.ageYears === "number" && Number.isFinite(p.ageYears)
          ? Math.round(clamp(p.ageYears, 14, 100))
          : 26;
      const heightCm =
        typeof p.heightCm === "number" && Number.isFinite(p.heightCm)
          ? Math.round(clamp(p.heightCm, 120, 240) * 10) / 10
          : 180;
      const weightKg =
        typeof p.weightKg === "number" && Number.isFinite(p.weightKg)
          ? Math.round(clamp(p.weightKg, 30, 300) * 10) / 10
          : 80;
      const bodyFatPct =
        typeof p.bodyFatPct === "number" && Number.isFinite(p.bodyFatPct)
          ? Math.round(clamp(p.bodyFatPct, 4, 55) * 10) / 10
          : null;
      const ffmFormula: FfmFormula = p.ffmFormula === "boer" ? "boer" : "janmahasatian";
      const neatLevel: NeatLevel =
        p.neatLevel && VALID_NEAT.has(p.neatLevel) ? p.neatLevel : "moderate";
      const weeklyTrainingSessions =
        typeof p.weeklyTrainingSessions === "number" && Number.isFinite(p.weeklyTrainingSessions)
          ? Math.round(clamp(p.weeklyTrainingSessions, 0, 14) * 100) / 100
          : 5.25;
      const trainingLevel: TrainingLevel =
        p.trainingLevel && VALID_LEVEL.has(p.trainingLevel) ? p.trainingLevel : "intermediate";
      const longLevers = Boolean(p.longLevers);

      const goalMode: GoalMode =
        parsed.goalMode && VALID_GOAL_MODES.has(parsed.goalMode) ? parsed.goalMode : "maintenance";
      const phaseStartedDate =
        typeof parsed.phaseStartedDate === "string" && isCalendarDate(parsed.phaseStartedDate)
          ? parsed.phaseStartedDate
          : (fallbackTodayIso ?? localDate(new Date()));
      const creatineStartDate =
        typeof parsed.creatineStartDate === "string" && isCalendarDate(parsed.creatineStartDate)
          ? parsed.creatineStartDate
          : null;
      const currentTargetKcal =
        typeof parsed.currentTargetKcal === "number" &&
        Number.isFinite(parsed.currentTargetKcal) &&
        parsed.currentTargetKcal >= 1000 &&
        parsed.currentTargetKcal <= 7000
          ? Math.round(parsed.currentTargetKcal)
          : null;
      const lastEnergyStatus: EnergyStatus =
        parsed.lastEnergyStatus && VALID_ENERGY_STATUSES.has(parsed.lastEnergyStatus)
          ? parsed.lastEnergyStatus
          : "unknown";
      const logs: DailyNutritionLog[] = Array.isArray(parsed.logs)
        ? parsed.logs
            .filter(
              (l): l is DailyNutritionLog =>
                Boolean(l) &&
                typeof l.date === "string" &&
                isCalendarDate(l.date) &&
                typeof l.caloriesKcal === "number" &&
                Number.isFinite(l.caloriesKcal) &&
                l.caloriesKcal >= 0 &&
                l.caloriesKcal <= 15000,
            )
            .map((l) => ({
              date: l.date,
              caloriesKcal: Math.round(l.caloriesKcal),
              proteinG:
                typeof l.proteinG === "number" && Number.isFinite(l.proteinG) && l.proteinG >= 0
                  ? Math.round(l.proteinG)
                  : undefined,
              fatG:
                typeof l.fatG === "number" && Number.isFinite(l.fatG) && l.fatG >= 0
                  ? Math.round(l.fatG)
                  : undefined,
              carbsG:
                typeof l.carbsG === "number" && Number.isFinite(l.carbsG) && l.carbsG >= 0
                  ? Math.round(l.carbsG)
                  : undefined,
              dayType: l.dayType && VALID_DAY_TYPES.has(l.dayType) ? l.dayType : "push",
              partialLog: Boolean(l.partialLog),
            }))
            .sort((a, b) => a.date.localeCompare(b.date))
        : [];

      return {
        profile: {
          sex,
          ageYears,
          heightCm,
          weightKg,
          bodyFatPct,
          ffmFormula,
          neatLevel,
          weeklyTrainingSessions,
          trainingLevel,
          longLevers,
        },
        goalMode,
        phaseStartedDate,
        creatineStartDate,
        carbCyclingEnabled: parsed.carbCyclingEnabled !== false,
        currentTargetKcal,
        lastEnergyStatus,
        logs,
      };
    } catch {
      return null;
    }
  }

  public read(todayIso: string, fallbackWeightKg = 80, longLevers = false): NutritionState {
    return this.readRaw(todayIso) ?? NutritionStore.createDefaultState(todayIso, fallbackWeightKg, longLevers);
  }

  public save(next: NutritionState): NutritionState {
    const store = this.storage;
    if (!store) return next;
    try {
      store.setItem(this.storageKey, JSON.stringify(next));
    } catch {
      // Ignore storage quota or private mode failures
    }
    return next;
  }

  public upsertLog(state: NutritionState, log: DailyNutritionLog): NutritionState {
    const nextLogs = state.logs.filter((l) => l.date !== log.date);
    nextLogs.push({
      date: log.date,
      caloriesKcal: Math.round(clamp(log.caloriesKcal, 0, 15000)),
      proteinG: log.proteinG !== undefined ? Math.round(Math.max(0, log.proteinG)) : undefined,
      fatG: log.fatG !== undefined ? Math.round(Math.max(0, log.fatG)) : undefined,
      carbsG: log.carbsG !== undefined ? Math.round(Math.max(0, log.carbsG)) : undefined,
      dayType: log.dayType ?? "push",
      partialLog: Boolean(log.partialLog),
    });
    nextLogs.sort((a, b) => a.date.localeCompare(b.date));
    return this.save({ ...state, logs: nextLogs });
  }

  public removeLog(state: NutritionState, date: string): NutritionState {
    const nextLogs = state.logs.filter((l) => l.date !== date);
    return this.save({ ...state, logs: nextLogs });
  }

  public static weeksSince(startDateIso: string, todayIso: string): number {
    const days = Math.max(0, parseIsoDayNumber(todayIso) - parseIsoDayNumber(startDateIso));
    return Math.max(1, Math.floor(days / 7) + 1);
  }
}
