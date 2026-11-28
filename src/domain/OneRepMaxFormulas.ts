export type E1RMLoadMode =
  | "total_external"
  | "per_implement"
  | "machine_stack"
  | "bodyweight"
  | "added_bodyweight"
  | "assisted_bodyweight"
  | "legacy_unspecified";

export interface E1RMInput {
  weight: number;
  reps: number;
  rir: number | null;
  loadMode: E1RMLoadMode;
  implementCount?: number;
  currentBodyweightKg: number;
  isWarmup: boolean;
  e1rmEligible: boolean;
}

export interface E1RMResult {
  e1rm: number;
  effectiveWeight: number;
  effectiveReps: number;
  confidence: number;
  isFallbackRIR: boolean;
  isExcludedFromTrend: boolean;
}

/**
 * Формулы расчётного 1ПМ и биомеханическая оценка усилия подхода (повторы + RIR).
 * Основная формула приложения — Эпли: по ней считаются «Прогресс», «Зал личных рекордов»
 * и калькулятор. Для Умного Коуча v2 и авторегуляции используется кусочная RIR-калиброванная модель `estimateV2`.
 */
export class OneRepMaxFormulas {
  static readonly PRIMARY = "Epley" as const;

  /**
   * Модуль 1 (v2): точный RIR-нормализованный расчёт e1RM и доверительного веса (Helms/Zourdos/Refalo).
   * Детерминированная кусочная модель (1 / Brzycki 1..5 / Epley 5..10 / сглаженная 10..18).
   */
  static estimateV2(input: E1RMInput): E1RMResult {
    const empty: E1RMResult = {
      e1rm: 0,
      effectiveWeight: 0,
      effectiveReps: 0,
      confidence: 0,
      isFallbackRIR: false,
      isExcludedFromTrend: true,
    };
    if (
      input.isWarmup ||
      !input.e1rmEligible ||
      !Number.isFinite(input.reps) ||
      input.reps <= 0 ||
      !Number.isFinite(input.weight) ||
      input.weight < 0
    ) {
      return empty;
    }

    const bw =
      Number.isFinite(input.currentBodyweightKg) && input.currentBodyweightKg > 0
        ? input.currentBodyweightKg
        : 75;

    let effectiveWeight: number;
    switch (input.loadMode) {
      case "total_external":
      case "machine_stack":
        effectiveWeight = input.weight;
        break;
      case "per_implement":
        effectiveWeight = input.weight * Math.max(1, input.implementCount ?? 2);
        break;
      case "bodyweight":
        effectiveWeight = bw;
        break;
      case "added_bodyweight":
        effectiveWeight = bw + input.weight;
        break;
      case "assisted_bodyweight":
        effectiveWeight = Math.max(1, bw - input.weight);
        break;
      default:
        return empty;
    }

    if (!Number.isFinite(effectiveWeight) || effectiveWeight <= 0) {
      return empty;
    }

    const isFallbackRIR = input.rir === null || !Number.isFinite(input.rir);
    let rirAdj: number;
    let clampedRawRir: number | null = null;
    if (isFallbackRIR) {
      rirAdj = input.reps <= 3 ? 0.0 : input.reps <= 10 ? 1.5 : 2.0;
    } else {
      clampedRawRir = Math.max(0, Math.min(6, input.rir!));
      rirAdj = clampedRawRir <= 3 ? clampedRawRir : 3 + (clampedRawRir - 3) * 0.75;
    }

    const effectiveReps = Math.round((input.reps + rirAdj) * 100) / 100;
    const isExcludedFromTrend = effectiveReps > 18;

    let rawE1rm = 0;
    if (!isExcludedFromTrend) {
      if (effectiveReps <= 1) {
        rawE1rm = effectiveWeight;
      } else if (effectiveReps <= 5) {
        rawE1rm = effectiveWeight / (1.0278 - 0.0278 * effectiveReps);
      } else if (effectiveReps <= 10) {
        rawE1rm = effectiveWeight * (1 + 0.0333 * effectiveReps);
      } else {
        // 10 < R_tot <= 18
        rawE1rm = effectiveWeight * (1 + 0.0333 * 10) * (1 + 0.025 * (effectiveReps - 10));
      }
    }

    const cBase =
      input.reps <= 6 ? 1.0 : input.reps <= 10 ? 0.85 : input.reps <= 15 ? 0.6 : 0.25;
    const cRir = isFallbackRIR
      ? 0.45
      : clampedRawRir! <= 2
        ? 1.0
        : clampedRawRir! === 3
          ? 0.85
          : 0.6;
    const confidence = isExcludedFromTrend
      ? 0.05
      : Math.max(0.05, Math.min(1.0, Math.round(cBase * cRir * 1000) / 1000));

    return {
      e1rm: isExcludedFromTrend ? 0 : OneRepMaxFormulas.round(rawE1rm),
      effectiveWeight: OneRepMaxFormulas.round(effectiveWeight),
      effectiveReps,
      confidence,
      isFallbackRIR,
      isExcludedFromTrend,
    };
  }

  /** Эпли без округления: 1 повтор — сам вес. Не округлять здесь: аналитика сравнивает значения. */
  static epley(weight: number, reps: number): number {
    return reps === 1 ? weight : weight * (1 + reps / 30);
  }
  static brzycki(weight: number, reps: number): number {
    return reps === 1 ? weight : reps < 37 ? weight * (36 / (37 - reps)) : OneRepMaxFormulas.epley(weight, reps);
  }
  static lombardi(weight: number, reps: number): number {
    return reps === 1 ? weight : weight * Math.pow(reps, 0.1);
  }
  /**
   * Потенциальный 1ПМ с поправкой на RIR (запас повторений, модель Helms / Zourdos):
   * effectiveReps = reps + rir. При rir === 0 совпадает с обычной формулой Эпли.
   * Ограничено диапазоном rir 0..6 и effectiveReps <= 15, чтобы лёгкие подходы не завышали максимум.
   */
  static rirAdjustedEpley(weight: number, reps: number, rir: number | null): number | null {
    if (!Number.isFinite(weight) || weight <= 0 || !Number.isFinite(reps) || reps < 1) return null;
    if (rir === null || !Number.isFinite(rir) || rir < 0) return reps <= 12 ? OneRepMaxFormulas.epley(weight, reps) : null;
    if (rir > 6) return null;
    const effectiveReps = reps + rir;
    if (effectiveReps > 15) return null;
    return OneRepMaxFormulas.epley(weight, effectiveReps);
  }
  /**
   * Расчётный 1ПМ с уровнем уверенности по диапазону эффективных повторений (reps + RIR):
   * - 1–5 повт.: high (наименьшая погрешность, подходит для автообновления ТМ)
   * - 6–10 повт.: moderate (ошибка растёт)
   * - 11–15 повт.: low (сильное влияние силовой выносливости — не использовать как триггер ТМ)
   * - >15 повт.: null
   */
  static e1rmWithConfidence(
    weight: number,
    reps: number,
    rir: number | null = null,
  ): { value: number; confidence: "high" | "moderate" | "low"; effectiveReps: number } | null {
    if (!Number.isFinite(weight) || weight <= 0 || !Number.isFinite(reps) || reps < 1) return null;
    const hasRir = rir !== null && Number.isFinite(rir) && rir >= 0;
    if (hasRir && rir! > 6) return null;
    const effectiveReps = hasRir ? reps + rir! : reps;
    if (effectiveReps > 15) return null;
    const value = OneRepMaxFormulas.round(OneRepMaxFormulas.epley(weight, effectiveReps));
    const confidence: "high" | "moderate" | "low" =
      effectiveReps <= 5 ? "high" : effectiveReps <= 10 ? "moderate" : "low";
    return { value, confidence, effectiveReps };
  }
  /**
   * Вклад одного рабочего подхода в гипертрофический стимул и локальную/системную усталость
   * в зависимости от повторений и запаса до отказа (RIR).
   * - RIR 0..2: полный стимул (0,95–1,0), но RIR 0 стоит на 35% больше усталости (хуже SFR).
   * - RIR 3: 0,85 стимула при умеренной усталости.
   * - RIR 4: 0,65 (умеренный/разгрузочный режим); RIR 5+: 0,35 (малостимулирующий / «мусорный» объём).
   * - Повторы 5..30: полный гипертрофический диапазон (1,0); 1..4: 0,75 гипертрофии (акцент на силу); >30: 0,65.
   */
  static setEffortProfile(reps: number, rir: number | null): {
    stimulus: number;
    fatigue: number;
    repZone: "strength" | "hypertrophy" | "endurance";
  } {
    const repZone = reps <= 5 ? "strength" : reps <= 15 ? "hypertrophy" : "endurance";
    const repFactor = reps >= 5 && reps <= 30 ? 1 : reps < 5 ? 0.75 : 0.65;
    let rirStimulus = 0.9;
    let rirFatigue = 1.0;
    if (rir !== null && Number.isFinite(rir)) {
      if (rir <= 0) {
        rirStimulus = 1.0;
        rirFatigue = 1.35;
      } else if (rir <= 1) {
        rirStimulus = 1.0;
        rirFatigue = 1.15;
      } else if (rir <= 2) {
        rirStimulus = 0.95;
        rirFatigue = 1.0;
      } else if (rir <= 3) {
        rirStimulus = 0.85;
        rirFatigue = 0.85;
      } else if (rir <= 4) {
        rirStimulus = 0.65;
        rirFatigue = 0.65;
      } else {
        rirStimulus = 0.35;
        rirFatigue = 0.45;
      }
    }
    return {
      stimulus: Math.round(repFactor * rirStimulus * 100) / 100,
      fatigue: Math.round(rirFatigue * (reps <= 4 ? 1.15 : 1) * 100) / 100,
      repZone,
    };
  }
  /** До 0,1 кг — как «Прогресс» (100 × 8 → 126,7; 77,5 × 8 → 98,2). */
  static round(value: number): number {
    return Math.round(value * 10) / 10;
  }
}
