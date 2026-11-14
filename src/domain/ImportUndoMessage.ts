import { quantity } from "../lib/quantity";

/**
 * Что сказать после «Отменить импорт». Называем результат словами и не показываем «убрано 0»:
 * важно, сколько тренировок вернулось к прежнему виду и что случилось с правками пользователя.
 */
export class ImportUndoMessage {
  static describe(result: { removed: number; restored: number; kept: number }) {
    const workouts = (n: number) => quantity(n, "тренировку", "тренировки", "тренировок");
    const parts: string[] = [];
    if (result.removed > 0) parts.push(`Убрал ${workouts(result.removed)} этого импорта`);
    if (result.restored > 0)
      parts.push(`${parts.length ? "вернул" : "Вернул"} прежнюю версию ${quantity(result.restored, "тренировки", "тренировок", "тренировок")}`);
    if (result.kept > 0) {
      const edits = quantity(result.kept, "твою правку", "твои правки", "твоих правок");
      parts.push(parts.length ? `${edits} не тронул` : `Не тронул ${edits}`);
    }
    return parts.length ? `${parts.join(", ")}.` : "Импорт отменён: убирать было нечего.";
  }
}
