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
  private async manifest(format: ImportPreview["format"], workouts: ImportedWorkout[], replace: boolean) {
    const sort = (value: unknown): unknown => Array.isArray(value) ? value.map(sort) :
      value && typeof value === "object" ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, sort(v)])) : value;
    const canonical = JSON.stringify(sort({ format, workouts, replace }));
    const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical)))].map((b) => b.toString(16).padStart(2, "0")).join("");
    return hash;
  }
  private runId(hash: string) {
    const key = `tyaga-import-run:${hash}`;
    try {
      const existing = localStorage.getItem(key);
      if (existing) return { key, runId: existing };
      const runId = crypto.randomUUID();
      localStorage.setItem(key, runId);
      return { key, runId };
    } catch {
      return { key, runId: crypto.randomUUID() };
    }
  }
  async runs() {
    return apiClient.request<{
      runs: Array<{ runId: string; manifestHash: string; at: string; total: number; activeCount: number }>;
      pending: Array<{ runId: string; manifestHash: string; at: string; total: number }>;
    }>("/api/import/runs");
  }
  async undo(runId: string) {
    return apiClient.request<{ removed: number; restored: number; kept: number; runId: string }>("/api/import/undo", "POST", { runId });
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
    options: { replace?: boolean } = {},
  ) {
    const names = new Set(preview.workouts.flatMap((w) => w.exercises.map((e) => e.exerciseId ?? e.sourceName)));
    if (preview.workouts.length > 30 || names.size > 30) throw new Error("Весь файл должен помещаться в одну безопасную операцию (не более 30 тренировок и 30 вариантов). Раздели экспорт до импорта.");
    const manifestHash = await this.manifest(preview.format, preview.workouts, options.replace === true);
    const { key, runId } = await this.runId(manifestHash);
    const body = { format: preview.format, workouts: preview.workouts, runId, manifestHash,
      ...(options.replace ? { replace: true } : {}) };
    if (JSON.stringify(body).length > 450000) throw new Error("Файл слишком велик для безопасной атомарной записи. Раздели экспорт до импорта.");
    onProgress({ phase: "Проверяем данные", done: 0, total: 1, imported: 0, skipped: 0 });
    await apiClient.request("/api/import", "POST", { ...body, dryRun: true });
    onProgress({ phase: "Переносим историю", done: 0, total: 1, imported: 0, skipped: 0 });
    const result = await apiClient.request<{
      imported: number; skipped: number; replaced: number; kept: number; addedIds: string[];
      exerciseIdMap: Record<string, string>; exercises: Exercise[]; runId: string;
    }>("/api/import", "POST", body);
    exerciseCatalog.register(result.exercises);
    try { localStorage.removeItem(key); } catch { /* a receipt still exists server-side */ }
    onProgress({ phase: "Переносим историю", done: 1, total: 1, imported: result.imported, skipped: result.skipped });
    return { ...result, idMap: result.exerciseIdMap };
  }
  async restoreExtras(
    preview: ImportPreview,
    idMap: Record<string, string>,
    onPhase: (phase: string) => void,
  ) {
    if (!preview.extras) return;
    for (const [kind, items, size] of [
      ["machines", preview.extras.machines ?? [], 5],
      ["custom", preview.extras.customExercises, 5],
      ["routines", preview.extras.routines, 1],
      ["favorites", preview.extras.favorites, 10],
    ] as const) {
      for (let i = 0; i < items.length; i += size) {
        onPhase(
          kind === "machines" ? "Восстанавливаем тренажёры" : kind === "custom"
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
