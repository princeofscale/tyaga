import type { Exercise, ProductData, Routine, Workout } from "../lib/types";
import type { ImportPreview, ImportedWorkout } from "../domain/WorkoutImport";
import { apiClient } from "./ApiClient";
import { productService } from "./ProductService";
import { exerciseCatalog } from "../lib/catalog";

export class ImportService {
  async resolve(names: string[]) {
    const result: Record<string, Exercise[]> = {};
    for (let i = 0; i < names.length; i += 80) {
      const response = await apiClient.request<{
        matches: Record<string, Exercise[]>;
      }>("/api/exercises/resolve", "POST", { names: names.slice(i, i + 80) });
      Object.assign(result, response.matches);
      exerciseCatalog.register(Object.values(response.matches).flat());
    }
    return result;
  }
  private packages(workouts: ImportedWorkout[]) {
    const chunks: ImportedWorkout[][] = [];
    let current: ImportedWorkout[] = [];
    for (const workout of workouts) {
      const candidate = [...current, workout];
      const names = new Set(
        candidate.flatMap((w) =>
          w.exercises.map((e) => e.exerciseId ?? e.sourceName),
        ),
      );
      if (
        current.length &&
        (candidate.length > 5 ||
          names.size > 30 ||
          JSON.stringify(candidate).length > 350000)
      ) {
        chunks.push(current);
        current = [];
      }
      current.push(workout);
      if (JSON.stringify(current).length > 400000)
        throw new Error(
          "Одна сессия слишком велика для импорта. Раздели её в исходном журнале.",
        );
    }
    if (current.length) chunks.push(current);
    return chunks;
  }
  async import(
    preview: ImportPreview,
    onProgress: (status: {
      phase: string;
      done: number;
      total: number;
      imported: number;
      skipped: number;
    }) => void,
  ) {
    const chunks = this.packages(preview.workouts);
    let imported = 0,
      skipped = 0;
    const idMap: Record<string, string> = {};
    // All packages are validated first; writes begin only after a successful review.
    for (let i = 0; i < chunks.length; i++) {
      onProgress({
        phase: "Проверяем данные",
        done: i,
        total: chunks.length,
        imported,
        skipped,
      });
      const result = await apiClient.request<{
        exerciseIdMap: Record<string, string>;
      }>("/api/import", "POST", {
        format: preview.format,
        workouts: chunks[i],
        dryRun: true,
      });
      Object.assign(idMap, result.exerciseIdMap);
    }
    for (let i = 0; i < chunks.length; i++) {
      onProgress({
        phase: "Переносим историю",
        done: i,
        total: chunks.length,
        imported,
        skipped,
      });
      const result = await apiClient.request<{
        imported: number;
        skipped: number;
        workouts: Workout[];
        exercises: Exercise[];
        exerciseIdMap: Record<string, string>;
      }>("/api/import", "POST", {
        format: preview.format,
        workouts: chunks[i],
      });
      imported += result.imported;
      skipped += result.skipped;
      Object.assign(idMap, result.exerciseIdMap);
      exerciseCatalog.register(result.exercises);
      onProgress({
        phase: "Переносим историю",
        done: i + 1,
        total: chunks.length,
        imported,
        skipped,
      });
    }
    return { imported, skipped, idMap };
  }
  async restoreExtras(
    preview: ImportPreview,
    idMap: Record<string, string>,
    onPhase: (phase: string) => void,
  ) {
    if (!preview.extras) return;
    for (const [kind, items, size] of [
      ["custom", preview.extras.customExercises, 5],
      ["routines", preview.extras.routines, 1],
      ["favorites", preview.extras.favorites, 10],
    ] as const) {
      for (let i = 0; i < items.length; i += size) {
        onPhase(
          kind === "custom"
            ? "Восстанавливаем личный каталог"
            : kind === "routines"
              ? "Восстанавливаем программы"
              : "Восстанавливаем избранное",
        );
        const result = await apiClient.request<{
          idMap: Record<string, string>;
          exercises: Exercise[];
        }>("/api/import/metadata", "POST", {
          kind,
          items: items.slice(i, i + size),
          idMap,
        });
        Object.assign(idMap, result.idMap);
        exerciseCatalog.register(result.exercises);
      }
    }
  }
}
export const importService = new ImportService();
