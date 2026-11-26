import { AnalyticsFacts } from "./AnalyticsFacts";
import { OneRepMaxFormulas } from "./OneRepMaxFormulas";
import { workingSets as workingSetsText } from "../lib/quantity";
/**
 * DeloadEngine
 *
 * Recorded-workload summary and optional deload templates.
 * Set counts alone do not establish fatigue or an individual need for a deload.
 */

import type { Workout, SetEntry } from "../lib/types";
import { exerciseForEntry } from "../lib/catalog";
import { addCalendarDays, browserTimeZone, localDate } from "../lib/calendar";

export type DeloadMode = "volume" | "intensity" | "recovery";

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
}
