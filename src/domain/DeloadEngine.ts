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
  recommendedMode: DeloadMode;
  reason: string;
  recentWorkoutsCount: number;
  recentSetsCount: number;
  recentFailureSetsCount: number;
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
    const recent = workouts.filter((w) => {
      return w.date >= startDate && w.date <= today &&
        w.exercises.some((e) => e.sets.some((s) => s.done && !s.warmup));
    });

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

    // Heuristics:
    // Workouts count > 14 in 30 days (+20)
    // Working sets > 120 in 30 days (+30)
    // Failure sets > 20 in 30 days (+30)
    let score = totalWorkingSets ? 15 : 0;
    if (recent.length >= 12) score += 20;
    if (recent.length >= 18) score += 15;
    if (totalWorkingSets >= 100) score += 25;
    if (totalWorkingSets >= 160) score += 15;
    if (failureSets >= 15) score += 25;

    score = Math.min(100, score);

    if (score >= 75) {
      return {
        fatigueScore: score,
        status: "overreaching",
        statusLabel: "Очень высокий записанный объём",
        recommendedMode: "volume",
        reason: `За 30 дней записано ${totalWorkingSets} рабочих подходов (${failureSets} с RIR 0). Если результаты падают и усталость сохраняется, попробуй уменьшить объём. По журналу нельзя определить состояние ЦНС или перетренированность.`,
        recentWorkoutsCount: recent.length,
        recentSetsCount: totalWorkingSets,
        recentFailureSetsCount: failureSets,
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
      };
    } else if (score >= 30) {
      return {
        fatigueScore: score,
        status: "optimal",
        statusLabel: "Умеренный записанный объём",
        recommendedMode: "intensity",
        reason: "Журнал показывает умеренный объём, но не измеряет восстановление. Решение о разгрузке зависит от самочувствия и динамики результатов.",
        recentWorkoutsCount: recent.length,
        recentSetsCount: totalWorkingSets,
        recentFailureSetsCount: failureSets,
      };
    } else {
      return {
        fatigueScore: score,
        status: "fresh",
        statusLabel: totalWorkingSets ? "Небольшой записанный объём" : "Нет записанной работы за 30 дней",
        recommendedMode: "intensity",
        reason: "Недостаток записей не означает готовность к нагрузке. Учитывай пропущенные тренировки, сон, самочувствие и прогресс.",
        recentWorkoutsCount: recent.length,
        recentSetsCount: totalWorkingSets,
        recentFailureSetsCount: failureSets,
      };
    }
  }

  /**
   * Generates a deload version of a workout session according to the chosen deload config.
   */
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
        const canScale = spec && ["total_external", "per_implement", "machine_stack", "added_bodyweight"].includes(spec.loadMode);
        const scaledWeight = canScale
          ? Math.min(s.weight, Math.max(0, Math.round((s.weight * config.intensityMultiplier) / 2.5) * 2.5))
          : s.weight;
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
        sets: [...warmups.map((w) => ({ ...w, done: false })), ...scaledWorking],
      };
    });

    return {
      ...workout,
      id: `workout-deload-${Date.now()}`,
      name: workout.name.includes("[Разгрузка]") ? workout.name : `${workout.name} [Разгрузка]`,
      exercises: deloadExercises,
    };
  }
}
