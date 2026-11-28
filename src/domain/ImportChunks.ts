import type { ImportedWorkout } from "./WorkoutImport";

/**
 * Делит длинный экспорт на части, каждая из которых безопасно проходит один запрос
 * сервера (≤30 тренировок, ≤30 вариантов упражнений, ≤30 личных названий, ограниченный
 * размер). Части одной операции записываются в общий run и публикуются сервером
 * разом, поэтому деление не меняет результат — только размер запросов.
 */
export class ImportChunks {
  static readonly maxWorkouts = 30;
  static readonly maxVariants = 30;
  static readonly maxBytes = 300_000;
  static readonly maxParts = 60;

  private static variants(workout: ImportedWorkout) {
    const variants = new Set<string>(), personal = new Set<string>();
    for (const e of workout.exercises) {
      variants.add(`${e.exerciseId ?? e.sourceName}|${e.type}`);
      if (!e.exerciseId || e.exerciseId.startsWith("custom:")) personal.add(e.sourceName);
    }
    return { variants, personal };
  }

  static split(workouts: ImportedWorkout[]): ImportedWorkout[][] {
    const utf8 = new TextEncoder();
    const parts: ImportedWorkout[][] = [];
    let current: ImportedWorkout[] = [];
    let variants = new Set<string>(), personal = new Set<string>(), bytes = 0;
    for (const workout of workouts) {
      const own = ImportChunks.variants(workout);
      const size = utf8.encode(JSON.stringify(workout)).byteLength;
      const mergedVariants = new Set([...variants, ...own.variants]);
      const mergedPersonal = new Set([...personal, ...own.personal]);
      const overflow = current.length >= ImportChunks.maxWorkouts ||
        mergedVariants.size > ImportChunks.maxVariants ||
        mergedPersonal.size > ImportChunks.maxVariants ||
        bytes + size > ImportChunks.maxBytes;
      if (current.length && overflow) {
        parts.push(current);
        current = []; variants = new Set(); personal = new Set(); bytes = 0;
      }
      current.push(workout);
      for (const v of own.variants) variants.add(v);
      for (const p of own.personal) personal.add(p);
      bytes += size;
    }
    if (current.length) parts.push(current);
    return parts;
  }
}
