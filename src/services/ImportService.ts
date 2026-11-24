import type { Exercise } from "../lib/types";
import type { ImportPreview, ImportedWorkout } from "../domain/WorkoutImport";
import { ImportChunks } from "../domain/ImportChunks";
import { apiClient } from "./ApiClient";
import { exerciseCatalog } from "../lib/catalog";

type Progress = (status: { phase: string; done: number; total: number; imported: number; skipped: number }) => void;
type ImportResult = {
  imported: number; skipped: number; replaced: number; kept: number; addedIds: string[];
  exerciseIdMap: Record<string, string>; exercises: Exercise[]; runId: string;
};

export class ImportService {
  constructor(
    private client: Pick<typeof apiClient, "request"> = apiClient,
    private storage: () => Pick<Storage, "getItem" | "setItem" | "removeItem" | "key" | "length"> | null =
      () => (typeof localStorage === "undefined" ? null : localStorage),
  ) {}
  async resolve(names: string[]) {
    const result: Record<string, Exercise[]> = {};
    for (let i = 0; i < names.length; i += 80) {
      const response = await this.client.request<{
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
  private store(): Pick<Storage, "getItem" | "setItem" | "removeItem" | "key" | "length"> | null {
    try { return this.storage(); } catch { return null; }
  }
  /** Один и тот же файл с теми же ответами повторяет тот же run, пока он не отменён и не записан. */
  private runId(hash: string, fresh = false) {
    const key = `tyaga-import-run:${hash}`;
    const store = this.store();
    try {
      const existing = fresh ? null : store?.getItem(key);
      if (existing) return { key, runId: existing };
      const runId = crypto.randomUUID();
      store?.setItem(key, runId);
      return { key, runId };
    } catch {
      return { key, runId: crypto.randomUUID() };
    }
  }
  /** Отменённый на сервере run нельзя повторять: забываем все ключи, которые на него указывают. */
  forgetRun(runId: string) {
    const store = this.store();
    if (!store) return;
    try {
      const stale: string[] = [];
      for (let i = 0; i < store.length; i++) {
        const key = store.key(i);
        if (key?.startsWith("tyaga-import-run:") && store.getItem(key) === runId) stale.push(key);
      }
      for (const key of stale) store.removeItem(key);
    } catch { /* без хранилища сервер сам не даст повторить отменённый run */ }
  }
  async runs() {
    return this.client.request<{
      runs: Array<{ runId: string; manifestHash: string; at: string; total: number; activeCount: number }>;
      pending: Array<{ runId: string; manifestHash: string; at: string; total: number }>;
    }>("/api/import/runs");
  }
  async undo(runId: string) {
    const result = await this.client.request<{ removed: number; restored: number; kept: number; runId: string }>("/api/import/undo", "POST", { runId });
    this.forgetRun(runId);
    return result;
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
    // Копия без тренировок (только вес, программы, избранное) не создаёт import-run.
    if (!preview.workouts.length)
      return { imported: 0, skipped: 0, replaced: 0, kept: 0, addedIds: [] as string[], exercises: [] as Exercise[], runId: "", exerciseIdMap: {} as Record<string, string>, idMap: {} as Record<string, string> };
    const parts = ImportChunks.split(preview.workouts);
    if (parts.length > ImportChunks.maxParts) throw new Error(`Файл слишком велик: больше ${ImportChunks.maxParts * ImportChunks.maxWorkouts} тренировок. Раздели экспорт.`);
    const manifestHash = await this.manifest(preview.format, preview.workouts, options.replace === true);
    // Сервер отвечает «уже отменён», если прежний run этого файла убрали, а ключ остался
    // (например, ответ об отмене потерялся): начинаем новую операцию вместо тупика.
    for (let attempt = 0; ; attempt++) {
      const { key, runId } = this.runId(manifestHash, attempt > 0);
      try {
        const result = parts.length === 1
          ? await this.single(preview, parts[0], runId, manifestHash, options, onProgress)
          : await this.multi(preview, parts, runId, manifestHash, options, onProgress);
        exerciseCatalog.register(result.exercises);
        try { this.store()?.removeItem(key); } catch { /* a receipt still exists server-side */ }
        return { ...result, idMap: result.exerciseIdMap };
      } catch (error) {
        if (attempt === 0 && error instanceof Error && /уже отменён/.test(error.message)) {
          try { this.store()?.removeItem(key); } catch { /* ignore */ }
          continue;
        }
        throw error;
      }
    }
  }
  private async single(
    preview: ImportPreview, workouts: ImportedWorkout[], runId: string, manifestHash: string,
    options: { replace?: boolean }, onProgress: Progress,
  ) {
    const body = { format: preview.format, workouts, runId, manifestHash,
      ...(options.replace ? { replace: true } : {}) };
    if (JSON.stringify(body).length > 450000) throw new Error("Файл слишком велик для безопасной записи. Раздели экспорт до импорта.");
    onProgress({ phase: "Проверяем данные", done: 0, total: 1, imported: 0, skipped: 0 });
    await this.client.request("/api/import", "POST", { ...body, dryRun: true });
    onProgress({ phase: "Переносим историю", done: 0, total: 1, imported: 0, skipped: 0 });
    const result = await this.client.request<ImportResult>("/api/import", "POST", body);
    onProgress({ phase: "Переносим историю", done: 1, total: 1, imported: result.imported, skipped: result.skipped });
    return result;
  }
  /**
   * Длинный файл: все части ложатся в один run, затем один запрос «записать»
   * публикует их разом. Повтор после сбоя той же операцией доводит её до конца.
   */
  private async multi(
    preview: ImportPreview, parts: ImportedWorkout[][], runId: string, manifestHash: string,
    options: { replace?: boolean }, onProgress: Progress,
  ) {
    const replace = options.replace ? { replace: true } : {};
    const total = parts.length * 2 + 1;
    const bodies = await Promise.all(parts.map(async (workouts, part) => ({
      format: preview.format, workouts, runId, manifestHash,
      chunkHash: await this.manifest(preview.format, workouts, options.replace === true),
      part, parts: parts.length, totalWorkouts: preview.workouts.length, ...replace,
    })));
    if (bodies.some((b) => JSON.stringify(b).length > 450000)) throw new Error("Часть файла слишком велика для безопасной записи. Раздели экспорт до импорта.");
    let done = 0;
    for (const body of bodies) {
      onProgress({ phase: "Проверяем данные", done: done++, total, imported: 0, skipped: 0 });
      await this.client.request("/api/import", "POST", { ...body, dryRun: true });
    }
    let staged = 0;
    for (const body of bodies) {
      onProgress({ phase: "Готовим записи", done: done++, total, imported: staged, skipped: 0 });
      const part = await this.client.request<ImportResult & { part?: number }>("/api/import", "POST", body);
      // Run уже записан (потерян был лишь ответ): сервер вернул итог целиком.
      if (Array.isArray(part.addedIds)) return part;
      staged += part.imported;
    }
    onProgress({ phase: "Записываем историю", done, total, imported: staged, skipped: 0 });
    const result = await this.client.request<ImportResult>("/api/import", "POST", {
      format: preview.format, runId, manifestHash, parts: parts.length, finalize: true,
    });
    onProgress({ phase: "Записываем историю", done: total, total, imported: result.imported, skipped: result.skipped });
    return result;
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
        const result = await this.client.request<{
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
