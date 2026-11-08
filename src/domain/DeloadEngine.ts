/**
 * DeloadEngine
 *
 * OOP Domain Service for intelligent athletic deload programming.
 * Implements evidence-based recovery strategies (Volume Deload, Intensity Deload, Active Recovery)
 * by evaluating fatigue markers from training history.
 */

import type { Workout, SetEntry } from "../lib/model";

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
    description: "Снижение общего тоннажа и подходов на 50%. Оптимально для восстановления суставов и связок.",
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
    description: "Лёгкие веса, работа на технику, улучшение кровообращения и подвижности без утомления ЦНС.",
    bestFor: "Высокая накопленная усталость, недосып, стресс или возвращение после перерыва",
  },
};

export interface FatigueAssessment {
  fatigueScore: number; // 0-100
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
   * Evaluates training fatigue over the past 30 days based on:
   * - Workout frequency
   * - Total working sets
   * - Frequency of failure sets (RIR = 0)
   * - Training density
   */
  public static assessFatigue(workouts: Workout[]): FatigueAssessment {
    const now = Date.now();
    const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;

    // Filter workouts from last 30 days
    const recent = workouts.filter((w) => {
      const ts = new Date(w.date).getTime();
      return ts >= thirtyDaysAgo;
    });

    let totalWorkingSets = 0;
    let failureSets = 0;

    for (const w of recent) {
      for (const e of w.exercises) {
        for (const s of e.sets) {
          if (!s.warmup) {
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
    let score = 15;
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
        statusLabel: "Высокая усталость ЦНС (Оверричинг)",
        recommendedMode: "volume",
        reason: `За последние 30 дней выполнено ${totalWorkingSets} рабочих подходов (${failureSets} до отказа). ЦНС и суставам необходима разгрузка для суперкомпенсации.`,
        recentWorkoutsCount: recent.length,
        recentSetsCount: totalWorkingSets,
        recentFailureSetsCount: failureSets,
      };
    } else if (score >= 50) {
      return {
        fatigueScore: score,
        status: "fatigued",
        statusLabel: "Накопление рабочей усталости",
        recommendedMode: "volume",
        reason: "Оптимальный момент для плановой разгрузочной недели перед новым тренировочным мезоциклом.",
        recentWorkoutsCount: recent.length,
        recentSetsCount: totalWorkingSets,
        recentFailureSetsCount: failureSets,
      };
    } else if (score >= 30) {
      return {
        fatigueScore: score,
        status: "optimal",
        statusLabel: "Рабочий тонус в норме",
        recommendedMode: "intensity",
        reason: "Текущая нагрузка хорошо переносится. Разгрузку можно провести в поддерживающем формате.",
        recentWorkoutsCount: recent.length,
        recentSetsCount: totalWorkingSets,
        recentFailureSetsCount: failureSets,
      };
    } else {
      return {
        fatigueScore: score,
        status: "fresh",
        statusLabel: "Организм свеж и готов к нагрузкам",
        recommendedMode: "intensity",
        reason: "Объём тренировок умеренный. Полная разгрузка не требуется, можно продолжать прогрессию весов.",
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
      // Separate warmups and working sets
      const warmups = e.sets.filter((s) => s.warmup);
      const working = e.sets.filter((s) => !s.warmup);

      // Reduce working sets count according to volume multiplier (minimum 1 working set)
      const targetCount = Math.max(1, Math.round(working.length * config.volumeMultiplier));
      const slicedWorking = working.slice(0, targetCount);

      // Scale weight and assign deload RIR
      const scaledWorking: SetEntry[] = slicedWorking.map((s, idx) => {
        const scaledWeight = Math.max(1, Math.round((s.weight * config.intensityMultiplier) / 2.5) * 2.5);

        return {
          ...s,
          id: `deload-set-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 5)}`,
          weight: scaledWeight,
          rir: config.targetRir,
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
