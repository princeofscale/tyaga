/**
 * Формулы расчётного 1ПМ. Основная в приложении — Эпли: по ней считаются «Прогресс», «Зал личных рекордов»
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
  /** До 0,1 кг — как «Прогресс» (100 × 8 → 126,7; 77,5 × 8 → 98,2). */
  static round(value: number): number {
    return Math.round(value * 10) / 10;
  }
}
