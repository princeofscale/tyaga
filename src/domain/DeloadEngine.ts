import { AnalyticsFacts } from "./AnalyticsFacts";
import { OneRepMaxFormulas } from "./OneRepMaxFormulas";
import { workingSets as workingSetsText } from "../lib/quantity";
/**
 * DeloadEngine
 *
 * v1: Recorded-workload summary and optional deload templates (kept for backward compatibility).
 * v2: Dual-EWMA fatigue model (axial/CNS τ=4d + local/muscular τ=10d) with multi-signal
 * reactive deload triggers (S1..S5), long-lever biomechanics & energy-status modifiers.
 */

import type { Exercise, Workout, SetEntry } from "../lib/types";
import { exerciseForEntry } from "../lib/catalog";
import { addCalendarDays, browserTimeZone, localDate } from "../lib/calendar";

export type DeloadMode = "volume" | "intensity" | "recovery";

export type DeloadModeV2 =
  | "none"
  | "local_micro_deload"
  | "volume_deload"
  | "intensity_taper"
  | "pivot_recovery";

export type EnergyStatus =
  | "deficit"
  | "maintenance"
  | "optimal_surplus"
  | "high_surplus"
  | "unknown";

export type DeloadSignalId =
  | "S1_e1rm_drop"
  | "S2_rir_drift"
  | "S3_ewma_overload"
  | "S4_rep_drop"
  | "S5_pain";

export interface DeloadEvaluateV2Options {
  now?: Date;
  today?: string;
  timeZone?: string;
  isLongLimbed?: boolean;
  energyStatus?: EnergyStatus;
  currentBodyweightKg?: number;
  painFlagsCount?: number;
  corePainRepeated?: boolean;
}

export interface DeloadEvaluationV2 {
  status: "optimal" | "productive_overreach" | "deload_recommended";
  recommendedMode: DeloadModeV2;
  axialUtilization: number;
  localUtilization: number;
  ewmaAxial: number;
  ewmaLocal: number;
  capAxial: number;
  capLocal: number;
  triggeredSignals: DeloadSignalId[];
  affectedExerciseIds: string[];
  e1rmDropExercises: Array<{ exerciseId: string; dropPct: number }>;
  rirDrift: number | null;
  protocolParams: {
    durationDays: number;
    weightMultiplier: number;
    volumeMultiplier: number;
    targetRIRFloor: number;
  } | null;
  summary: string;
}

const HIGH_AXIAL_IDS = new Set([
  "squat",
  "deadlift-bar",
  "trap-bar-deadlift",
  "rdl",
  "db-rdl",
  "deadlift-stiff",
  "good-morning",
  "row-bent-bar",
  "row-yates",
]);

const MODERATE_AXIAL_IDS = new Set([
  "bench",
  "incline-bar",
  "incline-db",
  "flat-db-press",
  "ohp-bar",
  "ohp-db",
  "push-press",
  "dip-weighted",
  "lunge-bar",
  "bulgarian-split-squat",
  "goblet",
  "row-db",
]);

const LOW_AXIAL_IDS = new Set([
  "hack-squat",
  "legpress",
  "pullup",
  "chinup",
  "pullup-assisted",
  "lat-pulldown",
  "row-cable",
  "row-chest-supported",
  "chest-press-machine",
]);

const HIGH_AXIAL_FAMILIES = new Set(["squat", "hip-hinge", "spinal-extension"]);

const ENERGY_CAPACITY_MULTIPLIER: Record<EnergyStatus, number> = {
  deficit: 0.8,
  maintenance: 0.9,
  optimal_surplus: 1.1,
  high_surplus: 1.15,
  unknown: 1.0,
};

const ALPHA_AXIAL = 2 / (4 + 1); // 0.40 (τ = 4 days)
const ALPHA_LOCAL = 2 / (10 + 1); // ~0.1818 (τ = 10 days)
const BASE_CAP_AXIAL = 28.0;
const BASE_CAP_LOCAL = 26.0;

const round2 = (n: number) => Math.round(n * 100) / 100;

export interface DeloadConfig {
  mode: DeloadMode;
  name: string;
  volumeMultiplier: number; // multiplier for sets count
  intensityMultiplier: number; // multiplier for working weights
  targetRir: number;
  description: string;
  bestFor: string;
}

export const DELOAD_PRESETS: Record<DeloadMode, DeloadConfig> = {
  volume: {
    mode: "volume",
    name: "Объёмная разгрузка",
    volumeMultiplier: 0.5, // 50% рабочих подходов
    intensityMultiplier: 0.85, // 85% веса
    targetRir: 3, // запас 3 повторения
    description: "Примерно вдвое меньше рабочих подходов и 85% привычного веса. Итоговый тоннаж зависит от округления и повторов.",
    bestFor: "Базовый силовой тренинг и гипертрофия после 4-6 недель тяжёлой работы",
  },
  intensity: {
    mode: "intensity",
    name: "Интенсивностная разгрузка",
    volumeMultiplier: 0.4, // 1-2 подхода
    intensityMultiplier: 0.95, // 95% веса
    targetRir: 2,
    description: "Сохранение привычного рабочего веса при резком сокращении подходов (до 1-2).",
    bestFor: "Пауэрлифтеры и опытные атлеты, которым важно сохранить ощущение веса на штанге",
  },
  recovery: {
    mode: "recovery",
    name: "Активное восстановление",
    volumeMultiplier: 0.5,
    intensityMultiplier: 0.65, // 65% веса
    targetRir: 4,
    description: "Лёгкие веса и меньше подходов для спокойной работы над техникой.",
    bestFor: "Высокая накопленная усталость, недосып, стресс или возвращение после перерыва",
  },
};

export interface FatigueAssessment {
  fatigueScore: number; // 0-100 heuristic of recorded workload, not measured fatigue
  status: "fresh" | "optimal" | "fatigued" | "overreaching";
  statusLabel: string;
  /** `null`, когда по записанной работе разгрузка не напрашивается: формат тогда выбирает сам человек. */
  recommendedMode: DeloadMode | null;
  reason: string;
  recentWorkoutsCount: number;
  recentSetsCount: number;
  recentFailureSetsCount: number;
  /** Наблюдаемые паттерны из дневника (последние 14 дн. против предыдущих 15–42 дн.): число упражнений со спадом e1RM ≥3%. */
  performanceDips?: number;
  /** Сдвиг среднего RIR за 14 дн. против предыдущего окна (отрицательный = те же тренировки даются тяжелее). */
  rirDrift?: number | null;
  /** Честная формулировка без «диагноза ЦНС». */
  observedPatternNote?: string;
}

export class DeloadEngine {
  /**
   * Summarizes recorded workload over 30 calendar dates. It cannot measure
   * fatigue, CNS state, recovery or diagnose overreaching from set counts.
   * - Workout frequency
   * - Total working sets
   * - Frequency of failure sets (RIR = 0)
   * - Training density
   */
  public static assessFatigue(
    workouts: Workout[],
    now = new Date(),
    timeZone = browserTimeZone(),
  ): FatigueAssessment {
    const today = localDate(now, timeZone);
    const startDate = addCalendarDays(today, -29);

    // Filter workouts from last 30 days
    const recent = new AnalyticsFacts(workouts, { from: startDate, through: today, now, timeZone }).workouts();

    let totalWorkingSets = 0;
    let failureSets = 0;

    for (const w of recent) {
      for (const e of w.exercises) {
        for (const s of e.sets) {
          if (s.done && !s.warmup) {
            totalWorkingSets++;
            if (s.rir === 0) {
              failureSets++;
            }
          }
        }
      }
    }

    // Multi-session observed performance trend (14d vs prior 15–42d) & RIR drift
    const recent14Start = addCalendarDays(today, -13);
    const priorEnd = addCalendarDays(today, -14);
    const priorStart = addCalendarDays(today, -41);
    const recent14 = new AnalyticsFacts(workouts, { from: recent14Start, through: today, now, timeZone }).workouts();
    const prior28 = new AnalyticsFacts(workouts, { from: priorStart, through: priorEnd, now, timeZone }).workouts();

    const collectWindow = (list: Workout[]) => {
      const bestByEx = new Map<string, number>();
      let rirSum = 0;
      let rirCount = 0;
      for (const w of list) {
        if (DeloadEngine.isDeloadName(w.name)) continue;
        for (const e of w.exercises) {
          const def = exerciseForEntry(e);
          for (const s of e.sets) {
            if (!s.done || s.warmup) continue;
            if (s.rir !== null && Number.isFinite(s.rir)) {
              rirSum += s.rir;
              rirCount++;
            }
            if (def?.recording.e1rmEligible && s.weight > 0 && s.reps >= 1 && s.reps <= 10) {
              const est = OneRepMaxFormulas.epley(s.weight, s.reps);
              const prev = bestByEx.get(e.exerciseId) ?? 0;
              if (est > prev) bestByEx.set(e.exerciseId, est);
            }
          }
        }
      }
      return { bestByEx, avgRir: rirCount >= 4 ? rirSum / rirCount : null };
    };

    const curWin = collectWindow(recent14);
    const prevWin = collectWindow(prior28);
    let performanceDips = 0;
    for (const [exId, curBest] of curWin.bestByEx) {
      const prevBest = prevWin.bestByEx.get(exId);
      if (prevBest && prevBest > 0 && (curBest - prevBest) / prevBest <= -0.03) {
        performanceDips++;
      }
    }
    const rirDrift =
      curWin.avgRir !== null && prevWin.avgRir !== null
        ? Math.round((curWin.avgRir - prevWin.avgRir) * 10) / 10
        : null;

    const observedParts: string[] = [];
    if (performanceDips >= 2) observedParts.push(`спад e1RM ≥3% в ${performanceDips} упр.`);
    if (rirDrift !== null && rirDrift <= -0.6) observedParts.push(`средний RIR стал тяжелее на ${Math.abs(rirDrift)}`);
    const observedPatternNote = observedParts.length
      ? `Паттерн совместим с накопленной усталостью (${observedParts.join("; ")}).`
      : undefined;

    // Heuristics:
    // Workouts count > 14 in 30 days (+20)
    // Working sets > 120 in 30 days (+30)
    // Failure sets > 20 in 30 days (+30)
    // Multi-session performance dip / negative RIR drift (+15)
    let score = totalWorkingSets ? 15 : 0;
    if (recent.length >= 12) score += 20;
    if (recent.length >= 18) score += 15;
    if (totalWorkingSets >= 100) score += 25;
    if (totalWorkingSets >= 160) score += 15;
    if (failureSets >= 15) score += 25;
    if (performanceDips >= 2) score += 15;
    if (rirDrift !== null && rirDrift <= -0.6) score += 10;

    score = Math.min(100, score);
    const trendFields = { performanceDips, rirDrift, ...(observedPatternNote ? { observedPatternNote } : {}) };

    if (score >= 75) {
      return {
        fatigueScore: score,
        status: "overreaching",
        statusLabel: "Очень высокий записанный объём",
        recommendedMode: "volume",
        reason: `За 30 дней записано ${workingSetsText(totalWorkingSets)} (${failureSets} с RIR 0). Если результаты падают и усталость сохраняется, попробуй уменьшить объём. По журналу нельзя определить состояние ЦНС или перетренированность.`,
        recentWorkoutsCount: recent.length,
        recentSetsCount: totalWorkingSets,
        recentFailureSetsCount: failureSets,
        ...trendFields,
      };
    } else if (score >= 50) {
      return {
        fatigueScore: score,
        status: "fatigued",
        statusLabel: "Высокий записанный объём",
        recommendedMode: "volume",
        reason: "Сопоставь объём с самочувствием и прогрессом. При накопленной усталости можно сократить подходы; сам объём не доказывает необходимость разгрузки.",
        recentWorkoutsCount: recent.length,
        recentSetsCount: totalWorkingSets,
        recentFailureSetsCount: failureSets,
        ...trendFields,
      };
    } else if (score >= 30) {
      return {
        fatigueScore: score,
        status: "optimal",
        statusLabel: "Умеренный записанный объём",
        recommendedMode: null,
        reason: "Журнал показывает умеренный объём, но не измеряет восстановление. Решение о разгрузке зависит от самочувствия и динамики результатов. Формат ниже выбери сам.",
        recentWorkoutsCount: recent.length,
        recentSetsCount: totalWorkingSets,
        recentFailureSetsCount: failureSets,
        ...trendFields,
      };
    } else {
      return {
        fatigueScore: score,
        status: "fresh",
        statusLabel: totalWorkingSets ? "Небольшой записанный объём" : "Нет записанной работы за 30 дней",
        recommendedMode: null,
        reason: "По журналу разгрузка не напрашивается: записанного объёма немного. Недостаток записей не означает готовность к нагрузке — учитывай пропущенные тренировки, сон, самочувствие и прогресс. Формат ниже выбери сам.",
        recentWorkoutsCount: recent.length,
        recentSetsCount: totalWorkingSets,
        recentFailureSetsCount: failureSets,
        ...trendFields,
      };
    }
  }

  /**
   * Generates a deload version of a workout session according to the chosen deload config.
   */
  /** Название программы с пометкой разгрузки: «Ноги А [Разгрузка]». */
  static readonly SUFFIX = " [Разгрузка]";
  static isDeloadName(name: string) {
    return DeloadEngine.baseName(name) !== name.trim();
  }
  /** Тренировки без разгрузочных: база для веса следующей разгрузки (иначе вес снижается второй раз). */
  static regular<T extends { name: string }>(workouts: T[]) {
    return workouts.filter((w) => !DeloadEngine.isDeloadName(w.name));
  }
  /** Тип тренировки без пометки разгрузки: «Ноги А [Разгрузка]» → «Ноги А». */
  static baseName(name: string) {
    const cleaned = name.replace(/\s*\[Разгрузка\]\s*/g, " ").replace(/\s+/g, " ").trim();
    return cleaned || name.trim();
  }
  /** Вес подхода в разгрузке: не выше прошлого, с шагом 2,5; веса без внешней нагрузки не меняются. */
  static isScalable(loadMode: string | undefined) {
    return !!loadMode && ["total_external", "per_implement", "machine_stack", "added_bodyweight"].includes(loadMode);
  }
  static scaleLoad(weight: number, loadMode: string | undefined, mode: DeloadMode) {
    if (!DeloadEngine.isScalable(loadMode)) return weight;
    return Math.min(weight, Math.max(0, Math.round((weight * DELOAD_PRESETS[mode].intensityMultiplier) / 2.5) * 2.5));
  }

  public static transformWorkoutForDeload(workout: Workout, mode: DeloadMode): Workout {
    const config = DELOAD_PRESETS[mode];

    const deloadExercises = workout.exercises.map((e) => {
      const spec = exerciseForEntry(e)?.recording;
      // Separate warmups and working sets
      const warmups = e.sets.filter((s) => s.warmup);
      const working = e.sets.filter((s) => !s.warmup);

      // Reduce working sets count according to volume multiplier (minimum 1 working set)
      const targetCount = Math.max(1, Math.round(working.length * config.volumeMultiplier));
      const slicedWorking = working.slice(0, targetCount);

      // Scale weight and assign deload RIR
      const scaledWorking: SetEntry[] = slicedWorking.map((s, idx) => {
        // Never turn bodyweight/unknown loads into invented external kilograms,
        // or round a light working weight up beyond the original load.
        const scaledWeight = DeloadEngine.scaleLoad(s.weight, spec?.loadMode, mode);
        const bodyMass = e.bodyMassKg;
        const assistance = s.assistanceKg ?? 0;
        const assistedLoad = (bodyMass ?? 0) + s.weight;
        const scaledAssistance = spec?.loadMode === "assisted_bodyweight" &&
          bodyMass !== undefined && Number.isFinite(bodyMass) && bodyMass > 0
          ? Math.max(assistance, Math.min(assistedLoad, assistance + Math.max(0, assistedLoad - assistance) * (1 - config.intensityMultiplier)))
          : s.assistanceKg;

        return {
          ...s,
          id: `deload-set-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 5)}`,
          weight: scaledWeight,
          ...(scaledAssistance !== undefined ? { assistanceKg: scaledAssistance } : {}),
          rir: spec?.type === "duration" ? null : config.targetRir,
          done: false,
        };
      });

      return {
        ...e,
        progressionNote: `Разгрузка (${config.name.toLowerCase()}): ${Math.round(config.intensityMultiplier * 100)} % рабочего веса, сокращённый объём, целевой запас RIR ${config.targetRir} — без отказа.`,
        sets: [...warmups.map((w) => ({ ...w, done: false })), ...scaledWorking],
      };
    });

    return {
      ...workout,
      id: `workout-deload-${Date.now()}`,
      name: DeloadEngine.isDeloadName(workout.name) ? workout.name : `${workout.name}${DeloadEngine.SUFFIX}`,
      exercises: deloadExercises,
    };
  }

  /** Классификация осевой нагрузки упражнения для модели EWMA v2: 1.5 / 1.0 / 0.5 / 0.15. */
  public static axialLoadMultiplier(exercise: Exercise | undefined): number {
    if (!exercise) return 0.5;
    if (HIGH_AXIAL_IDS.has(exercise.id)) return 1.5;
    if (LOW_AXIAL_IDS.has(exercise.id)) return 0.5;
    if (MODERATE_AXIAL_IDS.has(exercise.id)) return 1.0;
    if (
      HIGH_AXIAL_FAMILIES.has(exercise.familyId) &&
      exercise.recording.loadMode === "total_external"
    ) {
      return 1.5;
    }
    const isMultiJoint =
      exercise.jointActions.length >= 2 ||
      exercise.primary.length >= 2 ||
      (exercise.secondary.length > 0 && exercise.recording.loadMode !== "machine_stack");
    if (!isMultiJoint) return 0.15;
    if (exercise.recording.loadMode === "machine_stack") return 0.5;
    return 1.0;
  }

  /**
   * Модуль 4 (v2): двухкомпонентная EWMA-модель усталости (осевая τ=4д, локальная τ=10д)
   * и многофакторная матрица реактивной разгрузки (S1..S5) без ложных срабатываний на DUP v2.
   */
  public static evaluateV2(
    workouts: Workout[],
    options: DeloadEvaluateV2Options = {},
  ): DeloadEvaluationV2 {
    const now = options.now ?? new Date();
    const timeZone = options.timeZone ?? browserTimeZone();
    const today = options.today ?? localDate(now, timeZone);
    const isLongLimbed = options.isLongLimbed === true;
    const energyStatus: EnergyStatus = options.energyStatus ?? "unknown";
    const currentBodyweightKg = options.currentBodyweightKg ?? 75;
    const painFlagsCount = options.painFlagsCount ?? 0;
    const corePainRepeated = options.corePainRepeated === true;

    const kEnergy = ENERGY_CAPACITY_MULTIPLIER[energyStatus];
    const capAxial = round2(BASE_CAP_AXIAL * kEnergy);
    const capLocal = round2(BASE_CAP_LOCAL * kEnergy);

    // 1. Собираем дневные суммы нагрузок за последние 35 дней (включая дни отдыха с L = 0)
    const ewmaStart = addCalendarDays(today, -34);
    const ewmaWorkouts = new AnalyticsFacts(workouts, {
      from: ewmaStart,
      through: today,
      now,
      timeZone,
    }).workouts();

    const dailyLoad = new Map<string, { axial: number; local: number }>();
    let totalRecentWorkingSets = 0;
    let heavyLowRepSets = 0;
    const last14Start = addCalendarDays(today, -13);

    for (const w of ewmaWorkouts) {
      let dayAxial = 0;
      let dayLocal = 0;
      const inLast14 = w.date >= last14Start && w.date <= today;
      for (const e of w.exercises) {
        const def = exerciseForEntry(e);
        const mExAxial = DeloadEngine.axialLoadMultiplier(def);
        const mBio = isLongLimbed && mExAxial >= 1.5 ? 1.2 : 1.0;
        const localScale = mExAxial > 0.2 ? 1.0 : 0.6;
        for (const s of e.sets) {
          if (!s.done || s.warmup) continue;
          const mRir =
            s.rir === 0
              ? 1.35
              : s.rir !== null && Number.isFinite(s.rir) && s.rir <= 2
                ? 1.0
                : 0.7;
          const mRepsAxial = s.reps <= 5 ? 1.25 : s.reps <= 10 ? 1.0 : 0.75;
          const mRepsLocal = s.reps <= 5 ? 0.85 : s.reps <= 12 ? 1.0 : 1.15;
          dayAxial += mRir * mRepsAxial * mExAxial * mBio;
          dayLocal += mRir * mRepsLocal * localScale;
          if (inLast14) {
            totalRecentWorkingSets++;
            if (s.reps <= 5 && mExAxial >= 1.0) heavyLowRepSets++;
          }
        }
      }
      const prev = dailyLoad.get(w.date) ?? { axial: 0, local: 0 };
      dailyLoad.set(w.date, { axial: prev.axial + dayAxial, local: prev.local + dayLocal });
    }

    let ewmaAxial = 0;
    let ewmaLocal = 0;
    for (let i = 34; i >= 0; i--) {
      const dayIso = addCalendarDays(today, -i);
      const load = dailyLoad.get(dayIso) ?? { axial: 0, local: 0 };
      ewmaAxial = load.axial * ALPHA_AXIAL + ewmaAxial * (1 - ALPHA_AXIAL);
      ewmaLocal = load.local * ALPHA_LOCAL + ewmaLocal * (1 - ALPHA_LOCAL);
    }

    const axialUtilization = capAxial > 0 ? round2(ewmaAxial / capAxial) : 0;
    const localUtilization = capLocal > 0 ? round2(ewmaLocal / capLocal) : 0;

    // 2. Анализ сигналов S1 (RIR-нормализованный спад e1RM >= 2.5%), S2 (RIR-дрейф <= -1.0), S4 (спад повторов)
    const recent7Start = addCalendarDays(today, -6);
    const prior21Start = addCalendarDays(today, -27);
    const prior21End = addCalendarDays(today, -7);
    const prior42Start = addCalendarDays(today, -41);
    const prior42End = addCalendarDays(today, -14);

    const recent7Workouts = new AnalyticsFacts(workouts, {
      from: recent7Start,
      through: today,
      now,
      timeZone,
    }).workouts();
    const prior21Workouts = new AnalyticsFacts(workouts, {
      from: prior21Start,
      through: prior21End,
      now,
      timeZone,
    }).workouts();
    const recent14Workouts = new AnalyticsFacts(workouts, {
      from: last14Start,
      through: today,
      now,
      timeZone,
    }).workouts();
    const prior28Workouts = new AnalyticsFacts(workouts, {
      from: prior42Start,
      through: prior42End,
      now,
      timeZone,
    }).workouts();

    // S1: RIR-нормализованный e1RM (среднее лучших по сессиям за 7д vs пик за предыдущие 21д)
    const collectSessionE1rms = (list: Workout[]) => {
      const byEx = new Map<string, number[]>();
      for (const w of list) {
        if (DeloadEngine.isDeloadName(w.name)) continue;
        const sessionBest = new Map<string, number>();
        for (const e of w.exercises) {
          const def = exerciseForEntry(e);
          if (!def?.recording.e1rmEligible) continue;
          for (const s of e.sets) {
            if (!s.done || s.warmup) continue;
            const est = OneRepMaxFormulas.estimateV2({
              weight: s.weight,
              reps: s.reps,
              rir: s.rir,
              loadMode: def.recording.loadMode,
              currentBodyweightKg: e.bodyMassKg ?? currentBodyweightKg,
              isWarmup: s.warmup,
              e1rmEligible: def.recording.e1rmEligible,
            });
            if (est.isExcludedFromTrend || est.e1rm <= 0) continue;
            // Требуем доверие >= 0.7 при наличии RIR (или >= 0.4 при fallback RIR)
            const minConf = est.isFallbackRIR ? 0.4 : 0.7;
            if (est.confidence < minConf) continue;
            const prev = sessionBest.get(e.exerciseId) ?? 0;
            if (est.e1rm > prev) sessionBest.set(e.exerciseId, est.e1rm);
          }
        }
        for (const [exId, best] of sessionBest) {
          const arr = byEx.get(exId) ?? [];
          arr.push(best);
          byEx.set(exId, arr);
        }
      }
      return byEx;
    };

    const recent7E1rm = collectSessionE1rms(recent7Workouts);
    const prior21E1rm = collectSessionE1rms(prior21Workouts);
    const e1rmDropExercises: Array<{ exerciseId: string; dropPct: number }> = [];
    for (const [exId, recentVals] of recent7E1rm) {
      const priorVals = prior21E1rm.get(exId);
      if (!priorVals?.length || !recentVals.length) continue;
      const recentAvg = recentVals.reduce((a, b) => a + b, 0) / recentVals.length;
      const priorPeak = Math.max(...priorVals);
      const changePct = ((recentAvg - priorPeak) / priorPeak) * 100;
      if (changePct <= -2.5) {
        e1rmDropExercises.push({ exerciseId: exId, dropPct: Math.round(changePct * 10) / 10 });
      }
    }

    // S2: RIR-дрейф на сопоставимом или меньшем весе (последние 14 дн. vs предыдущие 15–42 дн.)
    const collectRirAndReps = (list: Workout[]) => {
      const byEx = new Map<
        string,
        { rirSum: number; rirCount: number; weightSum: number; repSum: number; setCount: number }
      >();
      let globalRirSum = 0;
      let globalRirCount = 0;
      for (const w of list) {
        if (DeloadEngine.isDeloadName(w.name)) continue;
        for (const e of w.exercises) {
          const cur = byEx.get(e.exerciseId) ?? {
            rirSum: 0,
            rirCount: 0,
            weightSum: 0,
            repSum: 0,
            setCount: 0,
          };
          for (const s of e.sets) {
            if (!s.done || s.warmup) continue;
            cur.weightSum += s.weight;
            cur.repSum += s.reps;
            cur.setCount++;
            if (s.rir !== null && Number.isFinite(s.rir)) {
              cur.rirSum += s.rir;
              cur.rirCount++;
              globalRirSum += s.rir;
              globalRirCount++;
            }
          }
          if (cur.setCount > 0) byEx.set(e.exerciseId, cur);
        }
      }
      return {
        byEx,
        globalAvgRir: globalRirCount >= 4 ? globalRirSum / globalRirCount : null,
      };
    };

    const cur14 = collectRirAndReps(recent14Workouts);
    const prev28 = collectRirAndReps(prior28Workouts);
    const rirDriftExercises: string[] = [];
    const repDropExercises: string[] = [];

    for (const [exId, c] of cur14.byEx) {
      const p = prev28.byEx.get(exId);
      if (!p) continue;
      const curAvgW = c.weightSum / c.setCount;
      const prevAvgW = p.weightSum / p.setCount;
      // Сопоставимый или меньший вес (допуск +2.5% на округление)
      const comparableOrLowerWeight = prevAvgW <= 0 || curAvgW <= prevAvgW * 1.025;
      if (c.rirCount >= 2 && p.rirCount >= 2 && comparableOrLowerWeight) {
        const exDrift = c.rirSum / c.rirCount - p.rirSum / p.rirCount;
        if (exDrift <= -1.0) rirDriftExercises.push(exId);
      }
      // S4: спад средних повторов >= 2 на сопоставимом или большем весе
      if (c.setCount >= 2 && p.setCount >= 2 && curAvgW >= prevAvgW * 0.975) {
        const repDelta = c.repSum / c.setCount - p.repSum / p.setCount;
        if (repDelta <= -2.0) repDropExercises.push(exId);
      }
    }

    const globalRirDrift =
      cur14.globalAvgRir !== null && prev28.globalAvgRir !== null
        ? Math.round((cur14.globalAvgRir - prev28.globalAvgRir) * 10) / 10
        : null;

    const s1 = e1rmDropExercises.length > 0;
    const s2 =
      rirDriftExercises.length >= 2 ||
      (globalRirDrift !== null && globalRirDrift <= -1.0 && rirDriftExercises.length >= 1);
    const s3 = axialUtilization >= 1.0 || localUtilization >= 1.0;
    const s4 = repDropExercises.length >= 2;
    const s5 = painFlagsCount >= 2 || corePainRepeated;

    const triggeredSignals: DeloadSignalId[] = [];
    if (s1) triggeredSignals.push("S1_e1rm_drop");
    if (s2) triggeredSignals.push("S2_rir_drift");
    if (s3) triggeredSignals.push("S3_ewma_overload");
    if (s4) triggeredSignals.push("S4_rep_drop");
    if (s5) triggeredSignals.push("S5_pain");

    const affectedSet = new Set<string>([
      ...e1rmDropExercises.map((x) => x.exerciseId),
      ...rirDriftExercises,
    ]);
    const affectedExerciseIds = [...affectedSet];
    const heavyLowRepShare =
      totalRecentWorkingSets > 0 ? heavyLowRepSets / totalRecentWorkingSets : 0;

    // 3. Выбор 1 из 4 режимов разгрузки (многофакторная матрица)
    let recommendedMode: DeloadModeV2 = "none";
    let status: DeloadEvaluationV2["status"] = "optimal";
    let protocolParams: DeloadEvaluationV2["protocolParams"] = null;
    let summary = "Нагрузка в продуктивном коридоре — можно прогрессировать по плану.";

    if ((s5 && (s1 || s2 || s3 || s4)) || (s1 && s2 && s3)) {
      recommendedMode = "pivot_recovery";
      status = "deload_recommended";
      protocolParams = {
        durationDays: 7,
        weightMultiplier: 0.65,
        volumeMultiplier: 0.5,
        targetRIRFloor: 4,
      };
      summary = s5
        ? "Накопленная усталость на фоне болевых сигналов — нужен восстановительный Pivot-блок на 7 дней."
        : "Совпали 3 маркера перегрузки (EWMA + спад e1RM + RIR-дрейф) — показан восстановительный блок.";
    } else if (s3 && axialUtilization >= 1.1 && s1 && heavyLowRepShare >= 0.35) {
      recommendedMode = "intensity_taper";
      status = "deload_recommended";
      protocolParams = {
        durationDays: 6,
        weightMultiplier: 0.85,
        volumeMultiplier: 0.4,
        targetRIRFloor: 3,
      };
      summary = "Высокая осевая усталость на тяжёлой базе — показан тапер (−60 % подходов, 85 % веса).";
    } else if (
      (s3 && (s1 || s2 || s4)) ||
      (s1 && s2 && (affectedExerciseIds.length >= 2 || (globalRirDrift !== null && globalRirDrift <= -1.0)))
    ) {
      recommendedMode = "volume_deload";
      status = "deload_recommended";
      protocolParams = {
        durationDays: 7,
        weightMultiplier: 0.9,
        volumeMultiplier: 0.5,
        targetRIRFloor: 3,
      };
      summary = "Зафиксирован спад производительности и/или RIR-дрейф — нужна объёмная разгрузка (−50 % подходов, 90 % веса, RIR 3+).";
    } else if (
      (s1 || rirDriftExercises.length === 1) &&
      affectedExerciseIds.length === 1 &&
      axialUtilization < 0.9 &&
      localUtilization < 0.9
    ) {
      recommendedMode = "local_micro_deload";
      status = "deload_recommended";
      protocolParams = {
        durationDays: 7,
        weightMultiplier: 0.7,
        volumeMultiplier: 0.7,
        targetRIRFloor: 3,
      };
      summary = "Локальная просадка только в 1 движении при нормальном общем фоне — достаточно локальной микро-разгрузки на 7 дней.";
    } else if (axialUtilization >= 0.85 || localUtilization >= 0.85) {
      status = "productive_overreach";
      summary = "Высокая продуктивная нагрузка без спада силы — держи целевой RIR и следи за восстановлением.";
    }

    return {
      status,
      recommendedMode,
      axialUtilization,
      localUtilization,
      ewmaAxial: round2(ewmaAxial),
      ewmaLocal: round2(ewmaLocal),
      capAxial,
      capLocal,
      triggeredSignals,
      affectedExerciseIds,
      e1rmDropExercises,
      rirDrift: globalRirDrift,
      protocolParams,
      summary,
    };
  }
}
