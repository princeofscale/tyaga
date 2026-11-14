import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { ApiError } from "../src/services/ApiClient";
import { ImportService } from "../src/services/ImportService";
import { ImportChunks } from "../src/domain/ImportChunks";
import type { ImportPreview, ImportedWorkout } from "../src/domain/WorkoutImport";
import type { Workout } from "../src/lib/types";

const sets = [8, 8, 7].map((reps) => ({ weight: 100, reps, rir: 2, warmup: false, done: true }));
/** Год записей: 210 тренировок, 45 разных личных упражнений на файл — больше, чем помещается в один запрос. */
const year = (count = 210, mapped = false): ImportedWorkout[] =>
  Array.from({ length: count }, (_, i) => ({
    sourceKey: `strong|year-${i}`, name: `День ${i}`,
    date: new Date(Date.UTC(2025, 0, 1 + i)).toISOString().slice(0, 10),
    duration: 60, notes: "", timeZone: "UTC",
    exercises: [
      { sourceName: "Deadlift (Barbell)", displayName: "Deadlift (Barbell)", type: "reps" as const, sets,
        ...(mapped ? { exerciseId: "deadlift-bar", catalogRevision: 3 as const } : {}) },
      { sourceName: `Станок ${i % 45}`, displayName: `Станок ${i % 45}`, type: "reps" as const, sets },
    ],
  }));
const preview = (workouts: ImportedWorkout[]): ImportPreview =>
  ({ format: "strong", workouts, exerciseNames: [], setCount: workouts.length * 6, warnings: [] });
const noProgress = () => undefined;
const shortHash = (v: string) => createHash("sha256").update(v).digest("hex").slice(0, 24);

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
    key: (i: number) => [...data.keys()][i] ?? null, get length() { return data.size; },
  };
}

async function sandbox() {
  const mf = new Miniflare(convertV4MiniflareOptions({
    workers: [{ modules: true, scriptPath: "dist/server/index.js", compatibilityDate: "2025-09-27", d1Databases: ["DB"] }],
    cf: false,
  }));
  const db = await mf.getD1Database("DB");
  for (const file of (await readdir("drizzle")).filter((p) => p.endsWith(".sql")).sort())
    for (const statement of (await readFile("drizzle/" + file, "utf8")).split("--> statement-breakpoint").filter((s) => s.trim()))
      await db.prepare(statement.trim()).run();
  const base = "http://localhost";
  let cookie = "";
  const raw = async (path: string, method = "GET", body?: unknown) => {
    if (!cookie) {
      const r = await mf.dispatchFetch(base + "/api/auth/register", { method: "POST",
        headers: { "oai-authenticated-user-id": "owner", Origin: base, "Content-Type": "application/json" },
        body: JSON.stringify({ email: "owner@example.test", password: "test account passphrase", displayName: "owner", timeZone: "UTC" }) });
      assert.equal(r.status, 201);
      cookie = r.headers.get("Set-Cookie")!.split(";")[0];
    }
    return mf.dispatchFetch(base + path, { method,
      headers: { "oai-authenticated-user-id": "owner", Cookie: cookie, Origin: base, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body) });
  };
  const requests: Array<{ path: string; body: Record<string, unknown> }> = [];
  const client = {
    async request<T>(path: string, method = "GET", body?: unknown): Promise<T> {
      requests.push({ path, body: (body ?? {}) as Record<string, unknown> });
      const response = await raw(path, method, body);
      const data = await response.json() as T & { error?: string };
      if (!response.ok) throw new ApiError(data.error ?? "Не удалось выполнить запрос", response.status, {});
      return data;
    },
  };
  const journal = async () => (await (await raw("/api/data")).json() as { workouts: Workout[] }).workouts;
  return { mf, db, client, journal, requests };
}

test("ImportChunks делит год записей на части ≤30 тренировок и ≤30 вариантов, ничего не теряя", () => {
  const all = year();
  const parts = ImportChunks.split(all);
  assert.ok(parts.length >= 7);
  assert.deepEqual(parts.flat().map((w) => w.sourceKey), all.map((w) => w.sourceKey));
  for (const part of parts) {
    assert.ok(part.length <= 30);
    const variants = new Set(part.flatMap((w) => w.exercises.map((e) => `${e.exerciseId ?? e.sourceName}|${e.type}`)));
    assert.ok(variants.size <= 30, `вариантов в части: ${variants.size}`);
  }
  assert.deepEqual(ImportChunks.split(all.slice(0, 5)).map((p) => p.length), [5], "короткий файл остаётся одной частью");
});

test("файл из 210 тренировок записывается целиком, заменяется и отменяется целиком", async () => {
  const { mf, client, journal, requests } = await sandbox();
  try {
    const service = new ImportService(client, () => memoryStorage());
    const first = await service.import(preview(year()), noProgress);
    assert.equal(first.imported, 210);
    assert.equal(first.addedIds.length, 210);
    assert.ok(requests.filter((r) => r.path === "/api/import" && r.body.part !== undefined && !r.body.dryRun).length >= 7, "несколько частей одного run");
    assert.equal(new Set(requests.filter((r) => r.path === "/api/import").map((r) => r.body.runId)).size, 1, "один runId на весь файл");
    assert.equal((await journal()).length, 210);
    const runs = await service.runs();
    assert.equal(runs.runs.length, 1);
    assert.deepEqual([runs.runs[0].total, runs.runs[0].activeCount], [210, 210]);
    assert.equal(runs.pending.length, 0);

    const replaced = await service.import(preview(year(210, true)), noProgress, { replace: true });
    assert.equal(replaced.imported, 210);
    assert.equal(replaced.replaced, 210);
    const afterReplace = await journal();
    assert.equal(afterReplace.length, 210, "без дублей");
    assert.ok(afterReplace.every((w) => w.exercises.some((e) => e.exerciseId === "deadlift-bar")));

    const restored = await service.undo(replaced.runId);
    assert.deepEqual([restored.restored, restored.removed, restored.kept], [210, 0, 0]);
    const afterUndoReplace = await journal();
    assert.equal(afterUndoReplace.length, 210);
    assert.ok(afterUndoReplace.every((w) => w.exercises.every((e) => e.exerciseId !== "deadlift-bar")));

    const removed = await service.undo(first.runId);
    assert.deepEqual([removed.removed, removed.restored, removed.kept], [210, 0, 0]);
    assert.equal((await journal()).length, 0);
    assert.equal((await service.runs()).runs.length, 0);
  } finally { await mf.dispose(); }
});

test("503 при публикации 210 тренировок не оставляет частичной истории; повтор доводит до полного результата", async () => {
  const { mf, db, client, journal } = await sandbox();
  try {
    const storage = memoryStorage();
    const service = new ImportService(client, () => storage);
    const failedId = `import:${shortHash("owner")}:${shortHash("strong|year-150")}`;
    await db.prepare(`CREATE TRIGGER qa_year_failure BEFORE INSERT ON workouts WHEN NEW.id='${failedId}' BEGIN SELECT RAISE(ABORT,'simulated mid-import failure'); END`).run();
    await assert.rejects(service.import(preview(year()), noProgress), (e: unknown) => e instanceof ApiError && e.status === 503);
    assert.equal((await journal()).length, 0, "ни одной тренировки из 210 не появилось");
    assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM workout_import_receipts WHERE active=1").first<{ n: number }>())?.n, 0);
    const visible = await service.runs();
    assert.equal(visible.pending.length, 1, "частичный run виден");
    assert.equal(visible.pending[0].total, 210);
    assert.equal(storage.data.size, 1, "runId сохранён для повтора");
    await db.prepare("DROP TRIGGER qa_year_failure").run();
    const resumed = await service.import(preview(year()), noProgress);
    assert.equal(resumed.imported, 210);
    assert.equal(resumed.runId, visible.pending[0].runId, "повтор — та же операция");
    assert.equal((await journal()).length, 210);
    assert.equal((await service.runs()).pending.length, 0);
    assert.equal(storage.data.size, 0);
  } finally { await mf.dispose(); }
});

test("обрыв посреди подготовки частей: черновик виден, отменяется, тот же файл потом импортируется (QA-R02-04)", async () => {
  const { mf, db, client, journal } = await sandbox();
  try {
    const storage = memoryStorage();
    const service = new ImportService(client, () => storage);
    const failedId = `import:${shortHash("owner")}:${shortHash("strong|year-100")}`;
    await db.prepare(`CREATE TRIGGER qa_stage_failure BEFORE INSERT ON workout_import_staging WHEN NEW.workout_id='${failedId}' BEGIN SELECT RAISE(ABORT,'stage failure'); END`).run();
    await assert.rejects(service.import(preview(year()), noProgress), (e: unknown) => e instanceof ApiError && e.status === 503);
    assert.equal((await journal()).length, 0);
    const draft = (await service.runs()).pending;
    assert.equal(draft.length, 1);
    // «Убрать черновик» — тот же undo; ключ в хранилище должен исчезнуть вместе с ним.
    const undone = await service.undo(draft[0].runId);
    assert.equal(undone.removed, 0);
    assert.equal(storage.data.size, 0, "после «Убрать черновик» старый runId забыт");
    assert.equal((await service.runs()).pending.length, 0);
    await db.prepare("DROP TRIGGER qa_stage_failure").run();
    const again = await service.import(preview(year()), noProgress);
    assert.equal(again.imported, 210);
    assert.notEqual(again.runId, draft[0].runId, "новая операция");
    assert.equal((await journal()).length, 210);
  } finally { await mf.dispose(); }
});

test("если ключ отменённого run остался (ответ об отмене потерян), клиент заводит новую операцию", async () => {
  const { mf, client, journal, requests } = await sandbox();
  try {
    const storage = memoryStorage();
    const service = new ImportService(client, () => storage);
    const workouts = year(3);
    const first = await service.import(preview(workouts), noProgress);
    assert.equal(first.imported, 3);
    // Ответ об успешной записи «потерялся»: ключ того же файла остался, а сервер уже отменил run.
    await client.request("/api/import/undo", "POST", { runId: first.runId });
    assert.equal((await journal()).length, 0);
    const key = "tyaga-import-run:" + await (async () => {
      const canonical = (v: unknown): unknown => Array.isArray(v) ? v.map(canonical) : v && typeof v === "object"
        ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, canonical(x)])) : v;
      const bytes = new TextEncoder().encode(JSON.stringify(canonical({ format: "strong", workouts, replace: false })));
      return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");
    })();
    storage.setItem(key, first.runId);
    requests.length = 0;
    const retry = await service.import(preview(workouts), noProgress);
    assert.equal(requests[0].body.runId, first.runId, "сначала клиент пробует сохранённый ключ…");
    assert.ok(requests.some((r) => r.body.runId === retry.runId), "…и после «уже отменён» берёт новый runId");
    assert.equal(retry.imported, 3);
    assert.notEqual(retry.runId, first.runId);
    assert.equal((await journal()).length, 3);
    assert.equal(storage.data.size, 0);
  } finally { await mf.dispose(); }
});

test("сервер не публикует run, у которого не все части загружены, и отмена убирает частичный черновик", async () => {
  const { mf, db, client, journal } = await sandbox();
  try {
    const parts = ImportChunks.split(year(90));
    assert.ok(parts.length >= 3);
    const total = parts.length;
    const runId = crypto.randomUUID(), manifestHash = "f".repeat(64);
    const hash = async (workouts: ImportedWorkout[]) => {
      const canonical = (v: unknown): unknown => Array.isArray(v) ? v.map(canonical) : v && typeof v === "object"
        ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, canonical(x)])) : v;
      const bytes = new TextEncoder().encode(JSON.stringify(canonical({ format: "strong", workouts, replace: false })));
      return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");
    };
    for (const part of parts.keys()) if (part !== 1) // часть 1 «потерялась»
      await client.request("/api/import", "POST", { format: "strong", workouts: parts[part], runId, manifestHash, chunkHash: await hash(parts[part]), part, parts: total, totalWorkouts: 90 });
    await assert.rejects(client.request("/api/import", "POST", { format: "strong", runId, manifestHash, parts: total, finalize: true }), /Не все части/);
    assert.equal((await journal()).length, 0);
    assert.equal((await db.prepare("SELECT state FROM workout_import_runs WHERE run_id=?").bind(runId).first<{ state: string }>())?.state, "staging");
    // Подмена содержимого части под тем же хэшем файла отвергается.
    await assert.rejects(client.request("/api/import", "POST", { format: "strong", workouts: parts[1], runId, manifestHash, chunkHash: "0".repeat(64), part: 1, parts: total }), /Часть файла изменилась/);
    const cancelled = await client.request<{ removed: number }>("/api/import/undo", "POST", { runId });
    assert.equal(cancelled.removed, 0);
    assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM workout_import_staging WHERE run_id=?").bind(runId).first<{ n: number }>())?.n, 0);
    assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM workout_import_dependencies WHERE run_id=?").bind(runId).first<{ n: number }>())?.n, 0);
  } finally { await mf.dispose(); }
});

test("копия без тренировок (только вес и настройки) не обращается к серверу за import-run", async () => {
  const requests: string[] = [];
  const client = { async request<T>(path: string): Promise<T> { requests.push(path); throw new Error("не должно быть запросов"); } };
  const result = await new ImportService(client, () => memoryStorage()).import(preview([]), noProgress);
  assert.deepEqual([result.imported, result.skipped, result.addedIds.length, result.idMap], [0, 0, 0, {}]);
  assert.deepEqual(requests, []);
});

test("удалённая импортированная тренировка не блокирует повторный импорт того же файла и не считается «изменённой»", async () => {
  const { mf, db, client, journal } = await sandbox();
  try {
    const service = new ImportService(client, () => memoryStorage());
    for (const count of [3, 60]) { // одиночный путь и многосоставный
      await db.prepare("DELETE FROM workouts").run();
      await db.prepare("DELETE FROM workout_import_receipts").run();
      const file = year(count);
      const first = await service.import(preview(file), noProgress);
      assert.equal(first.imported, count);
      const ids = first.addedIds.slice(0, 2);
      for (const id of ids) await db.prepare("DELETE FROM workouts WHERE id=?").bind(id).run();
      const run = (await service.runs()).runs[0];
      assert.deepEqual([run.total, run.activeCount], [count, count - 2], "баннер считает только существующие");
      const again = await service.import(preview(file), noProgress);
      assert.equal(again.imported, 2, "вернулись только удалённые");
      assert.equal((await journal()).length, count);
      for (const id of ids) await db.prepare("DELETE FROM workouts WHERE id=?").bind(id).run();
      const undone = await service.undo(again.runId);
      assert.deepEqual([undone.removed, undone.kept], [0, 0], "удалённое — не «оставлено изменённым»");
      const rest = await service.undo(first.runId);
      assert.equal(rest.removed, count - 2, "остальные записи первого импорта убраны; две вернувшиеся принадлежали уже следующему run");
      assert.equal((await journal()).length, 0);
    }
  } finally { await mf.dispose(); }
});
