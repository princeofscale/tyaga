/**
 * Формулы расчётного 1ПМ и биомеханическая оценка усилия подхода (повторы + RIR).
 * Основная формула приложения — Эпли: по ней считаются «Прогресс», «Зал личных рекордов»
 * и калькулятор. Остальные показываются как сравнение.
 */
export class OneRepMaxFormulas {
  static readonly PRIMARY = "Epley" as const;

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
