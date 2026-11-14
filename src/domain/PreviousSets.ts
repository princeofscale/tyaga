import type { SetEntry } from "../lib/types";

/**
 * Один источник «прошлых» чисел: предзаполнение нового упражнения, кнопка «Повторить прошлые»
 * и колонка «Прошлый» берут подход N из подходов прошлой тренировки (если их меньше — последний).
 * Так три ✓ подряд записывают ровно то, что показано в «Прошлом» (например, 8, 8, 7).
 */
export class PreviousSets {
  static pick<T>(working: T[], index: number): T | undefined {
    return working[index] ?? working[working.length - 1];
  }

  /** Поля подхода, которые приходят из прошлого раза. RIR берётся только если он тогда был записан. */
  static patch(
    previous: SetEntry,
    options: { timed?: boolean; assistance?: boolean } = {},
  ): Partial<SetEntry> {
    return {
      weight: previous.weight,
      reps: previous.reps,
      rir: previous.rir ?? null,
      ...(options.timed ? { durationSeconds: previous.durationSeconds ?? 30, rir: null } : {}),
      ...(options.assistance ? { assistanceKg: previous.assistanceKg ?? 0 } : {}),
    };
  }
}
