import type { SetEntry } from "../lib/types";

/**
 * «Применить N кг» в калькуляторе блинов: какие подходы упражнения меняются.
 * Калькулятор открывается на весе первого рабочего подхода; менять нужно только подходы
 * с этим же плановым весом. Подходы с другим весом (например, откатные 4 × 65 после тяжёлого 1 × 85)
 * и выполненные подходы остаются как есть.
 */
export class PlateApplication {
  /** Вес, на котором открывается калькулятор: первый невыполненный рабочий подход с весом, иначе первый рабочий, иначе первый с весом, иначе 60. */
  static openWeight(sets: SetEntry[]): number {
    const pick =
      sets.find((s) => !s.warmup && !s.done && s.weight > 0) ?? sets.find((s) => !s.warmup && s.weight > 0) ?? sets.find((s) => s.weight > 0);
    return pick?.weight ?? 60;
  }

  /** Индексы подходов, к которым относится расчёт: не выполнены, тот же тип (разминка/рабочий) и тот же вес, что в калькуляторе. */
  static targets(sets: SetEntry[], openedWeight: number): number[] {
    const reference = sets.find((s) => s.weight === openedWeight && !s.done && !s.warmup) ?? sets.find((s) => s.weight === openedWeight && !s.done);
    if (!reference) return [];
    return sets.flatMap((s, i) => (!s.done && s.weight === openedWeight && s.warmup === reference.warmup ? [i] : []));
  }

  /** Номер подхода на экране: рабочие считаются подряд без разминки, разминочные — своим счётом. */
  private static label(sets: SetEntry[], index: number): number {
    const warmup = sets[index].warmup;
    return sets.slice(0, index + 1).filter((s) => s.warmup === warmup).length;
  }

  /** Окончание кнопки: «к подходу 1», «к 4 подходам»; когда менять нечего — null. */
  static scope(sets: SetEntry[], openedWeight: number): string | null {
    const t = PlateApplication.targets(sets, openedWeight);
    if (t.length === 0) return null;
    if (t.length === 1) return `к ${sets[t[0]].warmup ? "разминочному " : ""}подходу ${PlateApplication.label(sets, t[0])}`;
    return `к ${t.length} ${sets[t[0]].warmup ? "разминочным " : ""}подходам`;
  }

  /** Новый список подходов: вес меняется только у `targets`. */
  static apply(sets: SetEntry[], openedWeight: number, weight: number): SetEntry[] {
    const t = new Set(PlateApplication.targets(sets, openedWeight));
    return sets.map((s, i) => (t.has(i) ? { ...s, weight } : s));
  }
}
