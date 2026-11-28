import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import initSqlJs from "sql.js";
import { LocalD1 } from "../src/device/LocalD1";
import { handleApi, type Env } from "../server/index";
import { SyncService } from "../server/SyncService";
import { BackupImportService } from "../server/BackupImportService";
import { PersonalExerciseFactory } from "../server/PersonalExerciseFactory";
import { replicate } from "../src/lib/replicate";
import { ImportChunks } from "../src/domain/ImportChunks";
import { WorkoutImport } from "../src/domain/WorkoutImport";
import { PendingWorkouts } from "../src/domain/PendingWorkouts";
import { DEFAULT_SETTINGS, makeWorkout, type Workout } from "../src/lib/model";

const APP = "https://localhost";

async function freshDb() {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.exec("PRAGMA foreign_keys = ON");
  for (const file of (await readdir("drizzle")).filter((f) => f.endsWith(".sql")).sort()) {
    db.exec(await readFile("drizzle/" + file, "utf8"));
  }
  return { sqlDb: db, d1: new LocalD1(db) as unknown as D1Database };
}

async function registerClient(
  d1: D1Database,
  platformId: string,
  email: string,
  displayName: string,
  timeZone = "UTC",
) {
  let token = "";
  const env = { DB: d1, onSessionToken: (t: string) => (token = t) } as unknown as Env;
  const call = async (path: string, method = "GET", body?: unknown) => {
    const headers = new Headers({ "oai-authenticated-user-id": platformId, Origin: APP });
    if (method !== "GET" && method !== "HEAD") headers.set("Content-Type", "application/json");
    if (token) headers.set("Cookie", `__Host-tyaga_session=${token}`);
    const response = await handleApi(
      new Request(APP + path, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
      env,
    );
    return { status: response.status, data: (await response.json().catch(() => ({}))) as any };
  };
  const reg = await call("/api/auth/register", "POST", {
    email,
    password: "strong-test-password-123",
    displayName,
    timeZone,
  });
  assert.equal(reg.status, 201);
  return { call, profile: reg.data.profile as { id: string; email: string } };
}

test("GET /api/friends succeeds with shared programs and revokes shared program access on unfriend", async () => {
  const { d1 } = await freshDb();
  const a = await registerClient(d1, "user-a", "a@test.local", "Алиса");
  const b = await registerClient(d1, "user-b", "b@test.local", "Боб");

  const aFriends0 = await a.call("/api/friends");
  assert.equal(aFriends0.status, 200);
  const codeA = aFriends0.data.me.inviteCode as string;

  assert.equal((await b.call("/api/friends/requests", "POST", { code: codeA })).status, 200);
  assert.equal((await a.call(`/api/friends/connections/${b.profile.id}`, "PUT")).status, 200);

  const created = await a.call("/api/friends/programs", "POST", {
    title: "Общий PPL",
    kind: "template",
    friendIds: [b.profile.id],
    payload: { templateId: "ppl" },
  });
  assert.equal(created.status, 200);
  const progId = created.data.id as string;

  const aFriends = await a.call("/api/friends");
  assert.equal(aFriends.status, 200);
  assert.equal(aFriends.data.sharedPrograms.length, 1);

  const bFriendsBefore = await b.call("/api/friends");
  assert.equal(bFriendsBefore.status, 200);
  assert.equal(bFriendsBefore.data.sharedPrograms.length, 1);

  // Unfriend B -> B must lose visibility and cannot adopt A's shared program
  assert.equal((await a.call(`/api/friends/connections/${b.profile.id}`, "DELETE")).status, 200);
  const bFriendsAfter = await b.call("/api/friends");
  assert.equal(bFriendsAfter.status, 200);
  assert.equal(bFriendsAfter.data.sharedPrograms.length, 0);

  const adoptRes = await b.call(`/api/friends/programs/${progId}/adopt`, "POST");
  assert.equal(adoptRes.status, 400);
});

test("replicate and ImportChunks size Cyrillic batches in UTF-8 bytes under server limits", async () => {
  const note = "Ж".repeat(4900); // 4900 UTF-16 chars, 9800 UTF-8 bytes
  const docs = Array.from({ length: 75 }, (_, i) => ({ id: `w-${i}`, payload: note }));
  const chunks: unknown[][] = [];
  await replicate(
    async () => ({ docs, cursor: 75, more: false }),
    async (chunk) => {
      chunks.push(chunk);
    },
    0,
  );
  const encoder = new TextEncoder();
  assert.ok(chunks.length >= 2, `Expected >=2 chunks for ~735KB UTF-8 Cyrillic payload, got ${chunks.length}`);
  for (const c of chunks) {
    assert.ok(encoder.encode(JSON.stringify({ docs: c })).byteLength < 500_000);
  }

  const workouts = Array.from({ length: 25 }, (_, i) => ({
    sourceKey: `k-${i}`,
    name: "Тренировка",
    date: "2026-11-01",
    duration: 45,
    notes: "Б".repeat(9000), // 18KB UTF-8 each -> 25 * 18KB = 450KB UTF-8
    timeZone: "UTC",
    exercises: [{ sourceName: "Жим", displayName: "Жим", exerciseId: "bench", type: "reps" as const, sets: [{ weight: 80, reps: 8, rir: 2, done: true, warmup: false }] }],
  }));
  const parts = ImportChunks.split(workouts);
  assert.ok(parts.length >= 2, `Expected ImportChunks to split >300KB UTF-8 Cyrillic batch, got ${parts.length}`);
  for (const part of parts) {
    assert.ok(encoder.encode(JSON.stringify(part)).byteLength <= 350_000);
  }
});

test("SyncService rejects prototype keys and invalid settings/routine/workout payloads with 400", async () => {
  const { d1 } = await freshDb();
  const user = await registerClient(d1, "sync-u", "sync@test.local", "Синк");

  const protoRes = await user.call("/api/sync/apply", "POST", {
    docs: [{ kind: "constructor", id: "x", versionAt: "2026-01-01T00:00:00.000Z", deleted: true }],
  });
  assert.equal(protoRes.status, 400);

  const badSettings = await user.call("/api/sync/apply", "POST", {
    docs: [{ kind: "settings", id: "settings", versionAt: "2099-01-01T00:00:00.000Z", deleted: false, row: { payload: "{}", revision: 2 } }],
  });
  assert.equal(badSettings.status, 400);

  const badRoutine = await user.call("/api/sync/apply", "POST", {
    docs: [{
      kind: "routine",
      id: "bad-r",
      versionAt: "2099-01-01T00:00:00.000Z",
      deleted: false,
      row: { id: "bad-r", payload: JSON.stringify({ id: "bad-r", name: "Broken", exercises: [{ exerciseId: "bench" }] }), revision: 1, updated_at: "2099-01-01T00:00:00.000Z" },
    }],
  });
  assert.equal(badRoutine.status, 400);

  const invalidWorkoutDate = await user.call("/api/sync/apply", "POST", {
    docs: [{
      kind: "workout",
      id: "w-1",
      versionAt: "2099-01-01T00:00:00.000Z",
      deleted: false,
      row: {
        id: "w-1",
        date: "2026-11-01",
        payload: JSON.stringify({
          id: "w-1",
          name: "Жим",
          date: "2026-02-31",
          exercises: [{ exerciseId: "bench", sets: [{ id: "s1", weight: 80, reps: 8, rir: 2, done: true, warmup: false }] }],
        }),
        updated_at: "2099-01-01T00:00:00.000Z",
        revision: 1,
      },
    }],
  });
  assert.equal(invalidWorkoutDate.status, 400);

  // Also ensure SyncService class itself rejects non-custom id
  await assert.rejects(() =>
    new SyncService(d1, "sync-u").apply({
      docs: [{
        kind: "custom_exercise",
        id: "not-custom-id",
        versionAt: "2099-01-01T00:00:00.000Z",
        deleted: false,
        row: { id: "not-custom-id", family_id: "fam", payload: JSON.stringify({ id: "not-custom-id", name: "X" }), active: 1, updated_at: "2099-01-01T00:00:00.000Z" },
      }],
    }),
  );
});

test("Account deletion leaves zero sync_versions tombstones and malformed API bodies return 400", async () => {
  const { d1 } = await freshDb();
  const user = await registerClient(d1, "del-u", "del@test.local", "Удаление");

  // Malformed JSON bodies must return 400, not 503
  assert.equal((await user.call("/api/routines", "PUT", null)).status, 400);
  assert.equal((await user.call("/api/routines", "PUT", { exercises: [null] })).status, 400);
  assert.equal((await user.call("/api/favorites", "PUT", null)).status, 400);
  assert.equal((await user.call("/api/exercises/resolve", "POST", null)).status, 400);

  // Save a workout, then delete account -> sync_versions must have 0 tombstones
  const w = makeWorkout(["bench"], [], "UTC");
  w.exercises[0].sets[0] = { ...w.exercises[0].sets[0], weight: 80, reps: 8, done: true };
  assert.equal((await user.call("/api/workouts", "PUT", w)).status, 200);

  const delRes = await user.call("/api/account", "DELETE", { currentPassword: "strong-test-password-123" });
  assert.equal(delRes.status, 200);

  const tombstones = await d1
    .prepare("SELECT kind, doc_id, deleted FROM sync_versions WHERE owner_id = ?")
    .bind("del-u")
    .all();
  assert.equal(tombstones.results.length, 0);
});

test("FitNotes Weight (kgs) column parses weights and invalid MDY/DMY date yields order hint instead of RangeError", () => {
  const fitnotes = new WorkoutImport({ dateOrder: "dmy", weightUnit: "kg", distanceUnit: "km", timeZone: "UTC" }).parse(
    "Date,Exercise,Category,Weight (kgs),Reps,Distance,Distance Unit,Time\n2026-04-25,Bench Press,Chest,100,8,,,",
    "fitnotes",
  );
  assert.equal(fitnotes.workouts[0].exercises[0].sets[0].weight, 100);

  assert.throws(
    () =>
      new WorkoutImport({ dateOrder: "mdy", weightUnit: "kg", distanceUnit: "km", timeZone: "UTC" }).parse(
        "Date,Exercise,Weight,Reps\n25/04/2026,Bench Press,100,8",
        "fitnotes",
      ),
    /переключи порядок дат/i,
  );
});

test("Backup restore preserves catalog:<id> custom.origin and native workout metadata", async () => {
  const { d1 } = await freshDb();
  const factory = new PersonalExerciseFactory();
  const catalogCopy = await factory.create({
    familyId: "cat-copy-1",
    name: "Тяга блока",
    aliases: [],
    notes: "",
    equipment: "gym",
    declaredZones: ["back"],
    origin: "catalog:wger:999",
    recording: { type: "reps", loadMode: "machine_stack", implementCount: 1, laterality: "bilateral" },
  });
  const imported = await new BackupImportService(d1, "restore-owner").import({
    kind: "custom",
    items: [catalogCopy],
  });
  assert.equal(imported.exercises[0]?.custom?.origin, "catalog:wger:999");

  const w: Workout = makeWorkout(["bench"], [], "UTC");
  w.createdAt = "2026-11-10T09:15:00.000Z";
  w.exercises[0].repMin = 6;
  w.exercises[0].repMax = 8;
  w.exercises[0].progressionNote = "+2.5 kg";
  w.exercises[0].sets[0] = { ...w.exercises[0].sets[0], weight: 80, reps: 8, done: true };
  const parsed = new WorkoutImport({ dateOrder: "dmy", weightUnit: "kg", distanceUnit: "km", timeZone: "UTC" }).parse(
    JSON.stringify({ format: "tyaga-backup", version: 5, workouts: [w] }),
    "tyaga",
  );
  assert.equal(parsed.workouts[0].createdAt, "2026-11-10T09:15:00.000Z");
  assert.equal(parsed.workouts[0].exercises[0].repMin, 6);
  assert.equal(parsed.workouts[0].exercises[0].repMax, 8);
  assert.equal(parsed.workouts[0].exercises[0].progressionNote, "+2.5 kg");
});

test("PendingWorkouts retries HTTP 408/429 and guards remove against newer offline edits", () => {
  const mem = new Map<string, string>();
  const storage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, v); },
    removeItem: (k: string) => { mem.delete(k); },
  };
  assert.equal(PendingWorkouts.isRetryable(Object.assign(new Error("timeout"), { status: 408 })), true);
  assert.equal(PendingWorkouts.isRetryable(Object.assign(new Error("rate"), { status: 429 })), true);
  assert.equal(PendingWorkouts.isRetryable(Object.assign(new Error("bad"), { status: 400 })), false);

  const q = new PendingWorkouts(() => storage, "acc-1");
  const w1 = makeWorkout(["bench"], [], "UTC");
  w1.id = "w-race";
  w1.notes = "old";
  q.add(w1, new Date("2026-11-20T10:00:00.000Z"));
  const oldQueuedAt = q.list()[0].queuedAt;

  // User edits workout offline while old request is in flight
  const w2 = { ...w1, notes: "new-edit" };
  q.add(w2, new Date("2026-11-20T10:01:00.000Z"));

  // Stale request finishes and calls remove(id, oldQueuedAt) -> must NOT drop newer edit!
  q.remove("w-race", oldQueuedAt);
  assert.equal(q.list().length, 1);
  assert.equal(q.list()[0].workout.notes, "new-edit");
});

test("LocalD1.batch preserves the original error even if SQLite already rolled back", async () => {
  const { sqlDb, d1 } = await freshDb();
  sqlDb.exec("CREATE TABLE t_check (id INTEGER PRIMARY KEY CHECK (id > 0))");
  await assert.rejects(
    () =>
      d1.batch([
        d1.prepare("INSERT INTO t_check (id) VALUES (?)").bind(1),
        d1.prepare("ROLLBACK"),
        d1.prepare("INSERT INTO t_check (id) VALUES (?)").bind(-1),
      ]),
    /CHECK constraint failed/i,
  );
});

test("PUT /api/bodyweight uses settings.timeZone when account.timeZone differs", async () => {
  const { d1 } = await freshDb();
  // Pacific/Honolulu (UTC-10) and Pacific/Kiritimati (UTC+14) are 24h apart: Kiritimati's local date is always 1 day ahead.
  const user = await registerClient(d1, "bw-tz-u", "bwtz@test.local", "Вес", "Pacific/Honolulu");
  const settingsRes = await user.call("/api/settings", "PUT", {
    ...DEFAULT_SETTINGS,
    timeZone: "Pacific/Kiritimati",
    revision: 0,
  });
  assert.equal(settingsRes.status, 200);
  const kiritimatiToday = new Intl.DateTimeFormat("en-CA", { timeZone: "Pacific/Kiritimati" }).format(new Date());
  const putBw = await user.call(`/api/bodyweight/${encodeURIComponent(`weight:${kiritimatiToday}`)}`, "PUT", {
    accountId: user.profile.id,
    revision: 0,
    mutationId: "mut-tz-1",
    value: { id: "bw-1", date: kiritimatiToday, weightKg: 80.5, createdAt: Date.now(), note: "" },
  });
  assert.equal(putBw.status, 200, `Expected 200 for Kiritimati today ${kiritimatiToday}, got ${putBw.status}: ${JSON.stringify(putBw.data)}`);
});

test("Device sessions slide expires_at on activity so Android offline users are not locked out", async () => {
  const { sqlDb, d1 } = await freshDb();
  const device = await registerClient(d1, "device", "me@tyaga.app", "Атлет", "UTC");
  // Simulate 10 days passing since last activity (still valid, > SESSION_TOUCH_MS ago)
  const tenDaysAgo = Date.now() - 10 * 86_400_000;
  const oldExpiry = Date.now() + 20 * 86_400_000;
  sqlDb.run("UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE account_id = ?", [tenDaysAgo, oldExpiry, device.profile.id]);
  const res = await device.call("/api/auth/session");
  assert.equal(res.status, 200);
  assert.ok(res.data.profile);
  const row = await d1.prepare("SELECT expires_at FROM sessions WHERE account_id = ?").bind(device.profile.id).first<{ expires_at: number }>();
  assert.ok(row && row.expires_at > oldExpiry + 5 * 86_400_000, `Expected device session expires_at to slide forward from ${oldExpiry}, got ${row?.expires_at}`);
});
