import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { createHash } from "node:crypto";
import type { Exercise, Workout } from "../src/lib/types";

type ImportResponse = { imported: number; skipped: number; replaced: number; kept: number; runId: string; addedIds: string[]; workouts: Workout[]; exercises: Exercise[]; exerciseIdMap: Record<string, string> };
type SyncDoc = { kind: string; id: string; versionAt: string; deleted: boolean; row: Record<string, string | number> };
const ownRun = () => crypto.randomUUID();
const asJson = async <T>(response: Response) => (await response.json()) as T;

/** Re-importing the same file: replace what is still as imported, keep what was edited. */
async function sandbox() {
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      workers: [
        {
          modules: true,
          scriptPath: "dist/server/index.js",
          compatibilityDate: "2025-09-27",
          d1Databases: ["DB"],
        },
      ],
      cf: false,
    }),
  );
  const db = await mf.getD1Database("DB");
  for (const file of (await readdir("drizzle")).filter((p) => p.endsWith(".sql")).sort())
    for (const statement of (await readFile("drizzle/" + file, "utf8"))
      .split("--> statement-breakpoint")
      .filter((s) => s.trim()))
      await db.prepare(statement.trim()).run();
  const base = "http://localhost";
  const cookies = new Map<string, string>();
  const request = async (path: string, method = "GET", body?: unknown, owner = "owner") => {
    let cookie = cookies.get(owner);
    if (!cookie) {
      const r = await mf.dispatchFetch(base + "/api/auth/register", {
        method: "POST",
        headers: { "oai-authenticated-user-id": owner, Origin: base, "Content-Type": "application/json" },
        body: JSON.stringify({ email: `${owner}@example.test`, password: "test account passphrase", displayName: owner, timeZone: "UTC" }),
      });
      assert.equal(r.status, 201);
      cookie = r.headers.get("Set-Cookie")!.split(";")[0];
      cookies.set(owner, cookie);
    }
    return mf.dispatchFetch(base + path, {
      method,
      headers: { "oai-authenticated-user-id": owner, Cookie: cookie, Origin: base, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  };
  return { mf, db, request };
}
const sets = (weight: number) =>
  [8, 8, 7].map((reps) => ({ weight, reps, rir: 2, warmup: false, done: true }));
const session = (exercise: Record<string, unknown>) => ({
  sourceKey: "strong|2026-09-25 18:30:00|Тяга",
  name: "Тяга",
  date: "2026-09-25",
  duration: 65,
  notes: "",
  timeZone: "UTC",
  exercises: [{ sourceName: "Deadlift (Barbell)", displayName: "Deadlift (Barbell)", type: "reps", sets: sets(100), ...exercise }],
});

test("sync revision-one remote edit keeps notes and sets during both undo and replace", async () => {
  const { mf, request } = await sandbox();
  try {
    const imported = await asJson<ImportResponse>(await request("/api/import", "POST", {
      format: "strong", workouts: [session({})], runId: ownRun(),
    }));
    const w = imported.workouts[0];
    const original = await asJson<{ docs: SyncDoc[] }>(await request("/api/sync/changes?since=0"));
    const doc = original.docs.find((d: SyncDoc) => d.kind === "workout" && d.id === w.id);
    assert.ok(doc, "import emits a workout sync doc");
    const row = { ...doc.row };
    const edited = JSON.parse(String(row.payload));
    edited.notes = "remote note must survive";
    edited.exercises[0].sets[0].weight = 177.5;
    row.payload = JSON.stringify(edited);
    row.revision = 1; // exactly the QA repro: revision is not proof
    row.updated_at = "2030-01-01T00:00:00.000Z";
    const applied = await asJson<{ applied: number }>(await request("/api/sync/apply", "POST", { docs: [{
      ...doc, versionAt: String(row.updated_at), row,
    }] }));
    assert.equal(applied.applied, 1);
    const undone = await asJson<{ removed: number; restored: number; kept: number }>(await request("/api/import/undo", "POST", { runId: imported.runId }));
    assert.equal(undone.removed, 0);
    assert.equal(undone.kept, 1);
    const replacing = await asJson<ImportResponse>(await request("/api/import", "POST", {
      format: "strong", workouts: [session({ exerciseId: "deadlift-bar", catalogRevision: 3 })], replace: true, runId: ownRun(),
    }));
    assert.equal(replacing.imported, 0);
    assert.equal(replacing.kept, 1);
    const current = await asJson<{ workouts: Workout[] }>(await request("/api/data"));
    assert.equal(current.workouts.length, 1);
    assert.equal(current.workouts[0].notes, "remote note must survive");
    assert.equal(current.workouts[0].exercises[0].sets[0].weight, 177.5);
  } finally { await mf.dispose(); }
});


test("stale run cannot undo a replacement; kudos survive UPDATE and undo restores prior import", async () => {
  const { mf, db, request } = await sandbox();
  try {
    const first = await asJson<ImportResponse>(await request("/api/import", "POST", {
      format: "strong", workouts: [session({})], runId: ownRun(),
    }));
    const workoutId = first.addedIds[0];
    const account = await db.prepare("SELECT id FROM accounts WHERE platform_id=?").bind("owner").first<{ id: string }>();
    assert.ok(account);
    await db.prepare("INSERT INTO workout_kudos(workout_id,account_id) VALUES (?,?)").bind(workoutId, account.id).run();
    const mapped = session({ exerciseId: "deadlift-bar", catalogRevision: 3 });
    const second = await asJson<ImportResponse>(await request("/api/import", "POST", {
      format: "strong", workouts: [mapped], replace: true, runId: ownRun(),
    }));
    assert.equal(second.replaced, 1);
    assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM workout_kudos WHERE workout_id=?").bind(workoutId).first<{ n: number }>())?.n, 1);
    const stale = await asJson<{ removed: number; kept: number }>(await request("/api/import/undo", "POST", { runId: first.runId }));
    assert.equal(stale.removed, 0);
    assert.equal(stale.kept, 1);
    assert.equal((await asJson<{ workouts: Workout[] }>(await request("/api/data"))).workouts[0].exercises[0].exerciseId, "deadlift-bar");
    const current = await asJson<{ restored: number }>(await request("/api/import/undo", "POST", { runId: second.runId }));
    assert.equal(current.restored, 1);
    assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM workout_kudos WHERE workout_id=?").bind(workoutId).first<{ n: number }>())?.n, 1);
    assert.equal((await asJson<{ workouts: Workout[] }>(await request("/api/data"))).workouts[0].exercises[0].exerciseId.startsWith("custom:"), true);
  } finally { await mf.dispose(); }
});


test("whole Strong 21-session import commits atomically and 503 leaves no partial workouts or receipts", async () => {
  const { mf, db, request } = await sandbox();
  try {
    const workouts = Array.from({ length: 21 }, (_, index) => ({
      ...session({}), sourceKey: `strong|session-${index}`,
      date: `2026-09-${String(index + 1).padStart(2, "0")}`,
    }));
    const shortHash = (value: string) => createHash("sha256").update(value).digest("hex").slice(0, 24);
    const failedId = `import:${shortHash("owner")}:${shortHash("strong|session-8")}`;
    const valid = await request("/api/import", "POST", { format: "strong", workouts, runId: ownRun() });
    assert.equal(valid.status, 200);
    const result = await asJson<ImportResponse>(valid);
    assert.equal(result.imported, 21);
    const data = await asJson<{ workouts: Workout[] }>(await request("/api/data"));
    assert.equal(data.workouts.length, 21);
    const undo = await asJson<{ removed: number; restored: number; kept: number }>(await request("/api/import/undo", "POST", { runId: result.runId }));
    assert.deepEqual(undo, { removed: 21, restored: 0, kept: 0, runId: result.runId });
    assert.equal((await asJson<{ workouts: Workout[] }>(await request("/api/data"))).workouts.length, 0);
    await db.prepare(`CREATE TRIGGER qa_import_failure BEFORE INSERT ON workouts WHEN NEW.id='${failedId}' BEGIN SELECT RAISE(ABORT,'simulated mid-import failure'); END`).run();
    const retryRun = ownRun();
    const failed = await request("/api/import", "POST", { format: "strong", workouts, runId: retryRun });
    assert.equal(failed.status, 503);
    assert.equal((await asJson<{ workouts: Workout[] }>(await request("/api/data"))).workouts.length, 0);
    assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM workout_import_receipts WHERE active=1").first<{ n: number }>())?.n, 0);
    assert.equal((await db.prepare("SELECT state FROM workout_import_runs WHERE owner_id=? AND run_id=?").bind("owner", retryRun).first<{ state: string }>())?.state, "staging", "failed finalization stays invisible");
    assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM workout_import_staging WHERE owner_id=? AND run_id=?").bind("owner", retryRun).first<{ n: number }>())?.n, 21, "all sessions remain staged for an exact retry");
    await db.prepare("DROP TRIGGER qa_import_failure").run();
    const resumed = await request("/api/import", "POST", { format: "strong", workouts, runId: retryRun });
    assert.equal(resumed.status, 200);
    assert.equal((await asJson<{ workouts: Workout[] }>(await request("/api/data"))).workouts.length, 21);
  } finally { await mf.dispose(); }
});

test("failed staged run is invisible in history but has owner-scoped recovery and can be cancelled", async () => {
  const { mf, db, request } = await sandbox();
  try {
    const runId = ownRun();
    await db.prepare("CREATE TRIGGER qa_stage_abort BEFORE INSERT ON workouts BEGIN SELECT RAISE(ABORT,'retry later'); END").run();
    const failed = await request("/api/import", "POST", { format: "strong", workouts: [session({})], runId });
    assert.equal(failed.status, 503);
    assert.equal((await asJson<{ workouts: Workout[] }>(await request("/api/data"))).workouts.length, 0);
    const own = await asJson<{ pending: Array<{ runId: string; total: number }> }>(await request("/api/import/runs"));
    assert.equal(own.pending[0].runId, runId);
    assert.equal(own.pending[0].total, 1);
    const foreign = await asJson<{ pending: unknown[] }>(await request("/api/import/runs", "GET", undefined, "owner-b"));
    assert.equal(foreign.pending.length, 0);
    assert.equal((await asJson<{ removed: number }>(await request("/api/import/undo", "POST", { runId }))).removed, 0);
    assert.equal((await db.prepare("SELECT state FROM workout_import_runs WHERE run_id=?").bind(runId).first<{ state: string }>())?.state, "undone");
    assert.equal((await request("/api/import", "POST", { format: "strong", workouts: [session({})], runId })).status, 400);
  } finally { await mf.dispose(); }
});


test("failed replace leaves the previous mapped file and receipt set visible without a mixed mapping", async () => {
  const { mf, db, request } = await sandbox();
  try {
    const sessions = Array.from({ length: 21 }, (_, index) => ({
      ...session({ exerciseId: "deadlift-bar", catalogRevision: 3 }),
      sourceKey: `strong|replace-${index}`, date: `2026-09-${String(index + 1).padStart(2, "0")}`,
    }));
    const firstRun = ownRun();
    const imported = await asJson<ImportResponse>(await request("/api/import", "POST", { format: "strong", workouts: sessions, runId: firstRun }));
    assert.equal(imported.imported, 21);
    const before = await asJson<{ workouts: Workout[] }>(await request("/api/data"));
    assert.equal(before.workouts.length, 21);
    const shortHash = (value: string) => createHash("sha256").update(value).digest("hex").slice(0, 24);
    const targetId = `import:${shortHash("owner")}:${shortHash("strong|replace-8")}`;
    await db.prepare(`CREATE TRIGGER qa_replace_failure BEFORE INSERT ON workouts WHEN NEW.id='${targetId}' BEGIN SELECT RAISE(ABORT,'simulated failed replacement'); END`).run();
    const literal = sessions.map((w) => ({ ...w, exercises: w.exercises.map(({ exerciseId: _id, catalogRevision: _rev, ...e }) => e) }));
    const replaceRun = ownRun();
    const failed = await request("/api/import", "POST", { format: "strong", workouts: literal, replace: true, runId: replaceRun });
    assert.equal(failed.status, 503);
    assert.match(String((await asJson<{ error: string }>(failed)).error), /хранилищ/);
    const after = await asJson<{ workouts: Workout[] }>(await request("/api/data"));
    assert.equal(after.workouts.length, 21);
    assert.ok(after.workouts.every((w) => w.exercises.every((e) => e.exerciseId === "deadlift-bar")), "old mapping remains complete, not a hybrid");
    assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM workout_import_receipts WHERE run_id=? AND active=1").bind(replaceRun).first<{ n: number }>())?.n, 0);
    assert.equal((await db.prepare("SELECT state FROM workout_import_runs WHERE run_id=?").bind(replaceRun).first<{ state: string }>())?.state, "staging");
  } finally { await mf.dispose(); }
});


test("failed custom-exercise dependency blocks visible workouts and can retry safely", async () => {
  const { mf, db, request } = await sandbox();
  try {
    await db.prepare("CREATE TRIGGER qa_custom_fail BEFORE INSERT ON custom_exercises BEGIN SELECT RAISE(ABORT,'custom definition unavailable'); END").run();
    const runId = ownRun();
    const source = { ...session({}), exercises: [{ sourceName: "Private unsupported row", displayName: "Private unsupported row", type: "reps", sets: sets(55) }] };
    const failed = await request("/api/import", "POST", { format: "strong", workouts: [source], runId });
    assert.equal(failed.status, 503);
    assert.equal((await asJson<{ workouts: Workout[] }>(await request("/api/data"))).workouts.length, 0);
    assert.equal((await db.prepare("SELECT state FROM workout_import_runs WHERE run_id=?").bind(runId).first<{ state: string }>())?.state, "staging");
    await db.prepare("DROP TRIGGER qa_custom_fail").run();
    const resumed = await request("/api/import", "POST", { format: "strong", workouts: [source], runId });
    assert.equal(resumed.status, 200);
    const workout = (await asJson<{ workouts: Workout[] }>(await request("/api/data"))).workouts[0];
    const definition = await db.prepare("SELECT payload FROM custom_exercises WHERE id=?").bind(workout.exercises[0].exerciseId).first<{ payload: string }>();
    assert.ok(definition, "visible workout has its custom definition");
  } finally { await mf.dispose(); }
});


test("undo is owner-scoped and cannot replay the same run token after cancellation", async () => {
  const { mf, request } = await sandbox();
  try {
    const result = await asJson<ImportResponse>(await request("/api/import", "POST", { format: "strong", workouts: [session({})], runId: ownRun() }));
    assert.equal((await request("/api/import/undo", "POST", { runId: result.runId }, "owner-b")).status, 400);
    assert.equal((await asJson<{ workouts: Workout[] }>(await request("/api/data"))).workouts.length, 1);
    assert.equal((await asJson<{ removed: number }>(await request("/api/import/undo", "POST", { runId: result.runId }))).removed, 1);
    assert.equal((await request("/api/import", "POST", { format: "strong", workouts: [session({})], runId: result.runId })).status, 400);
    assert.equal((await asJson<{ workouts: Workout[] }>(await request("/api/data"))).workouts.length, 0);
  } finally { await mf.dispose(); }
});


test("re-import with replace swaps an untouched import for the mapped one, once", async () => {
  const { mf, request } = await sandbox();
  try {
    const literal = (await (await request("/api/import", "POST", { format: "strong", workouts: [session({})] })).json()) as any;
    assert.equal(literal.imported, 1);
    const id = literal.workouts[0].id as string;
    assert.notEqual(literal.workouts[0].exercises[0].exerciseId, "deadlift-bar");

    const mapped = session({ exerciseId: "deadlift-bar", displayName: "Становая тяга со штангой", catalogRevision: 3 });
    // Without the flag nothing changes (the old behaviour).
    const plain = (await (await request("/api/import", "POST", { format: "strong", workouts: [mapped] })).json()) as any;
    assert.equal(plain.imported, 0);
    assert.equal(plain.skipped, 1);

    const dry = (await (await request("/api/import", "POST", { format: "strong", workouts: [mapped], replace: true, dryRun: true })).json()) as any;
    assert.equal(dry.replaceable, 1);
    assert.equal(((await (await request("/api/data")).json()) as any).workouts[0].exercises[0].exerciseId.startsWith("custom:"), true, "dry run writes nothing");

    const swapped = (await (await request("/api/import", "POST", { format: "strong", workouts: [mapped], replace: true })).json()) as any;
    assert.equal(swapped.imported, 1);
    assert.equal(swapped.replaced, 1);
    assert.deepEqual(swapped.addedIds, [id]);
    const all = ((await (await request("/api/data")).json()) as any).workouts;
    assert.equal(all.length, 1, "no duplicate");
    assert.equal(all[0].id, id);
    assert.equal(all[0].exercises[0].exerciseId, "deadlift-bar");
    assert.equal(all[0].exercises[0].catalogRevision, 3);

    // Running it again is idempotent in content and never duplicates.
    const again = (await (await request("/api/import", "POST", { format: "strong", workouts: [mapped], replace: true })).json()) as any;
    assert.equal(again.replaced, 1);
    assert.equal(((await (await request("/api/data")).json()) as any).workouts.length, 1);
  } finally {
    await mf.dispose();
  }
});

test("replace never overwrites a workout the user has edited since the import", async () => {
  const { mf, request } = await sandbox();
  try {
    const first = (await (await request("/api/import", "POST", { format: "strong", workouts: [session({})] })).json()) as any;
    const w = first.workouts[0];
    const edited = await request("/api/workouts", "PUT", { ...w, notes: "моя правка" });
    assert.equal(edited.status, 200);
    const mapped = session({ exerciseId: "deadlift-bar", displayName: "Становая тяга со штангой", catalogRevision: 3 });
    const result = (await (await request("/api/import", "POST", { format: "strong", workouts: [mapped], replace: true })).json()) as any;
    assert.equal(result.imported, 0);
    assert.equal(result.replaced, 0);
    assert.equal(result.kept, 1);
    const all = ((await (await request("/api/data")).json()) as any).workouts;
    assert.equal(all.length, 1);
    assert.equal(all[0].notes, "моя правка");
  } finally {
    await mf.dispose();
  }
});

test("an import is undone server-side and the same file can be reimported", async () => {
  const { mf, request } = await sandbox();
  try {
    const mapped = session({ exerciseId: "deadlift-bar", displayName: "Становая тяга со штангой", catalogRevision: 3 });
    const done = await asJson(await request("/api/import", "POST", { format: "strong", workouts: [mapped], runId: ownRun() }));
    assert.equal(done.imported, 1);
    const undone = await asJson(await request("/api/import/undo", "POST", { runId: done.runId }));
    assert.equal(undone.removed, 1);
    assert.equal((await asJson(await request("/api/data"))).workouts.length, 0);
    const back = await asJson(await request("/api/import", "POST", { format: "strong", workouts: [mapped], runId: ownRun() }));
    assert.equal(back.imported, 1);
    assert.equal((await asJson(await request("/api/data"))).workouts.length, 1);
  } finally { await mf.dispose(); }
});

test("a new import reports the ids it added, so it can be undone", async () => {
  const { mf, request } = await sandbox();
  try {
    const mapped = session({ exerciseId: "deadlift-bar", displayName: "Становая тяга со штангой", catalogRevision: 3 });
    const done = await asJson(await request("/api/import", "POST", { format: "strong", workouts: [mapped], runId: ownRun() }));
    assert.equal(done.imported, 1);
    assert.equal(done.replaced, 0);
    assert.equal(done.addedIds.length, 1);
    assert.equal(done.workouts[0].id, done.addedIds[0]);
    const undo = await asJson(await request("/api/import/undo", "POST", { runId: done.runId }));
    assert.equal(undo.removed, 1);
    assert.equal((await asJson(await request("/api/data"))).workouts.length, 0);
    const back = await asJson(await request("/api/import", "POST", { format: "strong", workouts: [mapped], runId: ownRun() }));
    assert.equal(back.imported, 1);
  } finally { await mf.dispose(); }
});
