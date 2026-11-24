import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import initSqlJs from "sql.js";
import worker, { handleApi, type Env } from "../server/index";
import cloud from "../server/cloud";
import { BodyTooLargeError, readTextLimited } from "../server/http";
import { LocalD1 } from "../src/device/LocalD1";
import { parseRelease } from "../src/device/release";
import { DeviceAccountData } from "../src/lib/deviceAccountData";
import { WorkoutReference } from "../src/domain/WorkoutReference";
import { RestorePlan } from "../src/domain/RestorePlan";
import { BiomechanicsEngine } from "../src/domain/BiomechanicsEngine";
import { SmartCoach } from "../src/domain/SmartCoach";
import { BodyweightTracker } from "../src/domain/BodyweightTracker";
import { WorkoutUndo } from "../src/domain/WorkoutUndo";
import { TrainingAnalytics } from "../src/domain/TrainingAnalytics";
import { DeloadEngine } from "../src/domain/DeloadEngine";
import { TeamChallengeProgress } from "../src/domain/TeamChallenge";
import { LivePresenter } from "../src/domain/LiveSession";
import { TrainingProgram } from "../src/domain/TrainingProgram";
import { StrengthExercises } from "../src/domain/StrengthExercises";
import { DEFAULT_SETTINGS, makeWorkout, type Workout } from "../src/lib/model";
import { newDraft } from "../src/lib/draft";

async function freshD1() {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.exec("PRAGMA foreign_keys = ON");
  for (const file of (await readdir("drizzle")).filter((f) => f.endsWith(".sql")).sort()) {
    db.exec(await readFile("drizzle/" + file, "utf8"));
  }
  return { db, d1: new LocalD1(db) as unknown as D1Database };
}

test("CSP allows blob: for media/img and /tyaga.apk returns 404 instead of SPA HTML fallback", async () => {
  const fakeEnv = {
    ASSETS: {
      fetch: async () => new Response("<!doctype html><html></html>", { headers: { "Content-Type": "text/html" } }),
    },
  } as unknown as Env;
  const page = await worker.fetch(new Request("https://tyaga.example/"), fakeEnv);
  const csp = page.headers.get("Content-Security-Policy") ?? "";
  assert.match(csp, /media-src 'self' blob:/);
  assert.match(csp, /img-src 'self' data: blob:/);

  const apk = await worker.fetch(new Request("https://tyaga.example/tyaga.apk"), fakeEnv);
  assert.equal(apk.status, 404);
});

test("readTextLimited rejects oversized Content-Length and streamed payloads with 413", async () => {
  const headerReq = new Request("https://tyaga.example/api/workouts", {
    method: "POST",
    headers: { "Content-Length": "99999999" },
    body: "{}",
  });
  await assert.rejects(() => readTextLimited(headerReq, 1024), BodyTooLargeError);

  const bigBody = "a".repeat(2048);
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(bigBody));
      controller.close();
    },
  });
  const streamReq = new Request("https://tyaga.example/api/workouts", {
    method: "POST",
    body: stream,
    duplex: "half",
  } as RequestInit);
  await assert.rejects(() => readTextLimited(streamReq, 1024), BodyTooLargeError);
});

test("Server hardening: OPTIONS 204, URIError 400, PUT /api/bodyweight 404, idempotent logout, account deletion, sync validation & version canonicalization, live join rate limit", async () => {
  const { db, d1 } = await freshD1();
  try {
    const env = { DB: d1 } as unknown as Env;
    const ORIGIN = "https://tyaga.example";

    // OPTIONS in handleApi & cloud.fetch
    const optLocal = await handleApi(new Request(ORIGIN + "/api/data", { method: "OPTIONS" }), env);
    assert.equal(optLocal.status, 204);
    const optCloud = await cloud.fetch(new Request(ORIGIN + "/api/data", { method: "OPTIONS", headers: { Origin: "https://localhost" } }), env);
    assert.equal(optCloud.status, 204);
    assert.equal(optCloud.headers.get("Vary"), "Origin");

    // Oversized body on cloud auth returns 413 before buffering
    const tooBig = await cloud.fetch(
      new Request(ORIGIN + "/api/auth/login", {
        method: "POST",
        headers: { Origin: ORIGIN, "Content-Type": "application/json" },
        body: JSON.stringify({ email: "a@b.test", password: "x".repeat(20000) }),
      }),
      env,
    );
    assert.equal(tooBig.status, 413);

    // Register via cloud.fetch
    const reg = await cloud.fetch(
      new Request(ORIGIN + "/api/auth/register", {
        method: "POST",
        headers: { Origin: "https://localhost", "Content-Type": "application/json" },
        body: JSON.stringify({ email: "del@example.test", password: "a strong passphrase", displayName: "Тест", timeZone: "UTC" }),
      }),
      env,
    );
    assert.equal(reg.status, 201);
    const token = reg.headers.get("X-Tyaga-Session")!;

    const authed = (path: string, method = "GET", body?: unknown) =>
      cloud.fetch(
        new Request(ORIGIN + path, {
          method,
          headers: {
            Origin: "https://localhost",
            Authorization: `Bearer ${token}`,
            ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
          },
          body: body !== undefined ? JSON.stringify(body) : undefined,
        }),
        env,
      );

    // Malformed percent-encoding returns 400, not 503
    const badUri = await authed("/api/workouts/%", "DELETE", { revision: 1 });
    assert.equal(badUri.status, 400);

    // PUT /api/bodyweight without key returns 404
    const badBw = await authed("/api/bodyweight", "PUT", { value: 80 });
    assert.equal(badBw.status, 404);

    // SyncService rejects corrupt workout payloads
    const badSync = await authed("/api/sync/apply", "POST", {
      docs: [{
        kind: "workout",
        id: "bad-w",
        versionAt: "2026-11-24T10:00:00.000Z",
        deleted: false,
        row: { id: "bad-w", date: "сегодня_потом", payload: JSON.stringify({ exercises: [] }), updated_at: "2026-11-24T10:00:00.000Z", revision: 1 },
      }],
    });
    assert.equal(badSync.status, 400);

    // SyncService canonicalizes versionAt so .500Z beats Z in the same second
    const validW = makeWorkout(["bench"], [], "UTC");
    validW.exercises[0].sets[0].done = true;
    validW.exercises[0].sets[0].weight = 80;
    const sync1 = await authed("/api/sync/apply", "POST", {
      docs: [{
        kind: "workout",
        id: validW.id,
        versionAt: "2026-11-24T10:00:00Z",
        deleted: false,
        row: { id: validW.id, date: validW.date, payload: JSON.stringify(validW), updated_at: "2026-11-24T10:00:00Z", revision: 1 },
      }],
    });
    assert.equal(sync1.status, 200);
    assert.deepEqual(await sync1.json(), { applied: 1, skipped: 0 });

    validW.exercises[0].sets[0].weight = 85;
    const sync2 = await authed("/api/sync/apply", "POST", {
      docs: [{
        kind: "workout",
        id: validW.id,
        versionAt: "2026-11-24T10:00:00.500Z",
        deleted: false,
        row: { id: validW.id, date: validW.date, payload: JSON.stringify(validW), updated_at: "2026-11-24T10:00:00.500Z", revision: 2 },
      }],
    });
    assert.equal(sync2.status, 200);
    assert.deepEqual(await sync2.json(), { applied: 1, skipped: 0 });

    // LiveRoom join brute-force rate limit (20 failures -> 21st returns 429)
    for (let i = 0; i < 20; i++) {
      const r = await authed("/api/friends/live/join", "POST", { code: "H7KQ2" });
      assert.equal(r.status, 400);
    }
    const limited = await authed("/api/friends/live/join", "POST", { code: "H7KQ2" });
    assert.equal(limited.status, 429);

    // Account deletion rejects wrong password, succeeds with right password, and wipes data
    const wrongDel = await authed("/api/auth/account", "DELETE", { currentPassword: "wrong passphrase here" });
    assert.equal(wrongDel.status, 401);
    const okDel = await authed("/api/auth/account", "DELETE", { currentPassword: "a strong passphrase" });
    assert.equal(okDel.status, 200);
    assert.deepEqual(await okDel.json(), { deleted: true });
    assert.equal((await authed("/api/data")).status, 401);

    // Idempotent logout returns 200 even after account/session is gone
    const repeatLogout = await authed("/api/auth/logout", "POST", {});
    assert.equal(repeatLogout.status, 200);
    assert.deepEqual(await repeatLogout.json(), { loggedOut: true });
  } finally {
    db.close();
  }
});

test("LocalD1.batch reports meta.changes matching D1 contract", async () => {
  const { db, d1 } = await freshD1();
  try {
    const res = await d1.batch([
      d1.prepare("INSERT INTO settings (owner_id, payload, revision) VALUES (?, ?, 1)").bind("o1", "{}"),
      d1.prepare("UPDATE settings SET revision = 2 WHERE owner_id = ?").bind("o1"),
      d1.prepare("DELETE FROM settings WHERE owner_id = ?").bind("o1"),
    ]);
    assert.equal(res[0].meta.changes, 1);
    assert.equal(res[1].meta.changes, 1);
    assert.equal(res[2].meta.changes, 1);
  } finally {
    db.close();
  }
});

test("DeviceAccountData.wipe clears tyaga-cloud and parseRelease validates sha256", () => {
  const map = new Map<string, string>([
    ["tyaga-cloud", '{"token":"secret"}'],
    ["tyaga-draft-v1", "{}"],
    ["tyaga_theme_accent", "lime"],
  ]);
  const storage = {
    get length() { return map.size; },
    key: (i: number) => [...map.keys()][i] ?? null,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
  new DeviceAccountData(() => storage).wipe();
  assert.equal(map.has("tyaga-cloud"), false);
  assert.equal(map.has("tyaga-draft-v1"), false);
  assert.equal(map.has("tyaga_theme_accent"), true);

  const hash = "a".repeat(64);
  assert.deepEqual(parseRelease({ versionCode: 5, versionName: "1.6.0", sha256: hash }), {
    versionCode: 5,
    versionName: "1.6.0",
    sha256: hash,
  });
  assert.equal(parseRelease({ versionCode: 5, versionName: "1.6.0", sha256: "not-a-hash" })?.sha256, undefined);
});

test("Domain fixes: AnalyticsFacts machine identity, RestorePlan signature, Biomechanics null RIR, SmartCoach MRV, BodyweightTracker alpha, WorkoutUndo index, zero goal, DeloadEngine, TeamChallenge weeks, LivePresenter, TrainingProgram unknown id, StrengthExercises dedup", () => {
  // 1. AnalyticsFacts.workouts() keeps different equipment notes on same exerciseId separate
  const w = makeWorkout(["lat-pulldown"], [], "UTC");
  w.date = "2026-11-10";
  const b1 = { ...structuredClone(w.exercises[0]), equipmentNote: "Блок 1" };
  b1.sets = [
    { id: "s1", weight: 50, reps: 10, rir: 2, warmup: false, done: true },
    { id: "s2", weight: 50, reps: 10, rir: 2, warmup: false, done: true },
  ];
  const b2 = { ...structuredClone(w.exercises[0]), equipmentNote: "Блок 2" };
  b2.sets = [{ id: "s3", weight: 70, reps: 8, rir: 2, warmup: false, done: true }];
  w.exercises = [b1, b2];
  assert.deepEqual(
    WorkoutReference.latest([w], b1, undefined, "2026-11-12", { timeZone: "UTC" })?.sets.map((s) => s.weight),
    [50, 50],
  );
  assert.deepEqual(
    WorkoutReference.latest([w], b2, undefined, "2026-11-12", { timeZone: "UTC" })?.sets.map((s) => s.weight),
    [70],
  );

  // 2. RestorePlan detects duration/notes/RIR diffs
  const existingW = makeWorkout(["bench"], [], "UTC");
  existingW.duration = 45;
  existingW.notes = "Старая заметка";
  const incomingSame = {
    nativeId: existingW.id,
    name: existingW.name,
    date: existingW.date,
    duration: 60,
    notes: "Новая заметка",
    timeZone: "UTC",
    exercises: existingW.exercises.map((e) => ({
      sourceName: "Жим",
      exerciseId: e.exerciseId,
      sets: e.sets.map((s) => ({ weight: s.weight, reps: s.reps, rir: s.rir, warmup: s.warmup })),
    })),
  };
  assert.equal(RestorePlan.workouts([incomingSame as never], [existingW]).differs, 1);

  // 3. BiomechanicsEngine: rir === null is NOT counted as axialHardSets
  const sqNull = makeWorkout(["squat"], [], "UTC");
  sqNull.date = "2026-11-10";
  sqNull.exercises[0].sets = Array.from({ length: 6 }, (_, i) => ({
    id: `sq-${i}`, weight: 100, reps: 5, rir: null, warmup: false, done: true,
  }));
  const bio = BiomechanicsEngine.analyzeWeek([sqNull], "2026-11-11", { now: new Date("2026-11-11T12:00:00Z"), timeZone: "UTC" });
  assert.equal(bio.hardSets, 0);
  assert.equal(bio.axialHardSets, 0);

  // 4. SmartCoach respects back MRV (25): 22 sets of back is NOT overloaded
  const backW = makeWorkout(["lat-pulldown"], [], "UTC");
  backW.date = "2026-11-20";
  backW.exercises[0].sets = Array.from({ length: 22 }, (_, i) => ({
    id: `bk-${i}`, weight: 60, reps: 10, rir: 2, warmup: false, done: true,
  }));
  const coach = SmartCoach.analyze([backW], [], "2026-11-22", "UTC", new Date("2026-11-22T12:00:00Z"));
  assert.equal(coach.overloadedMuscles.some((m) => m.muscle === "back"), false);

  // 5. BodyweightTracker.getTrend clamps alpha > 1 so EMA never produces NaN
  const bwStore = new Map<string, string>();
  const tracker = new BodyweightTracker("acc-t", "UTC", {
    getItem: (k: string) => bwStore.get(k) ?? null,
    setItem: (k: string, v: string) => void bwStore.set(k, v),
  });
  tracker.addEntry(80, "2026-11-01");
  tracker.addEntry(81, "2026-11-04");
  const trend = tracker.getTrend(1.5);
  assert.ok(trend.every((p) => Number.isFinite(p.emaKg)));

  // 6. WorkoutUndo restores deleted set to exact exerciseIndex
  const dupDraft = newDraft(w);
  dupDraft.workout.exercises[1].sets.push({ id: "s4", weight: 75, reps: 8, rir: 2, warmup: false, done: true });
  const afterDel = WorkoutUndo.set(dupDraft, 1, 1);
  assert.equal(afterDel.workout.exercises[1].sets.length, 1);
  const afterRestore = WorkoutUndo.restore(afterDel);
  assert.equal(afterRestore.workout.exercises[0].sets.length, 2);
  assert.equal(afterRestore.workout.exercises[1].sets.length, 2);
  assert.equal(afterRestore.workout.exercises[1].sets[1].id, "s4");

  // 7. Zero goal produces ratio 0 (not Infinity)
  const zeroSettings = { ...DEFAULT_SETTINGS, goals: { ...DEFAULT_SETTINGS.goals, chest: 0 } };
  const loads = new TrainingAnalytics([w]).zoneLoad(zeroSettings);
  assert.equal(loads.find((l) => l.id === "chest")!.ratio, 0);

  // 8. DeloadEngine.isDeloadName and baseName agree on mid-string tag
  assert.equal(DeloadEngine.baseName("Ноги [Разгрузка] B"), "Ноги B");
  assert.equal(DeloadEngine.isDeloadName("Ноги [Разгрузка] B"), true);

  // 9. TeamChallengeProgress.weeks honors 5-week endDate
  assert.equal(TeamChallengeProgress.weeks("2026-11-02", "2026-11-10", 3, [], "2026-12-06").length, 5);

  // 10. LivePresenter avoids "Закончил · 0 т"
  assert.equal(
    LivePresenter.headline(
      { state: { phase: "done", exercise: null, setsDone: 12, setsTotal: 12, tonnageKg: 40, lastSet: null, restEndsAt: null }, updatedAt: "2026-11-24T10:00:00Z" },
      Date.parse("2026-11-24T10:01:00Z"),
    ),
    "Закончил · 12 подх.",
  );

  // 11. TrainingProgram.start gracefully skips unknown exerciseId
  const badRoutine = {
    ...TrainingProgram.empty(),
    name: "Тест",
    exercises: [{ exerciseId: "non-existent-exercise-id", sets: [{ id: "x1", weight: 50, reps: 10, rir: 2, warmup: false, done: false }] }],
  };
  const started = new TrainingProgram(badRoutine).start([], "UTC", "2026-11-24");
  assert.equal(started.exercises.length, 0);

  // 12. StrengthExercises.list deduplicates revisions and excludes future dates
  const rev1: Workout = { ...makeWorkout(["bench"], [], "UTC"), id: "dup-1", date: "2026-11-10", revision: 1 };
  rev1.exercises[0].sets[0].done = true;
  const rev2: Workout = { ...structuredClone(rev1), revision: 2 };
  const futureW: Workout = { ...makeWorkout(["squat"], [], "UTC"), id: "fut-1", date: "2099-01-01" };
  futureW.exercises[0].sets[0].done = true;
  const list = StrengthExercises.list([rev1, rev2, futureW], { now: new Date("2026-11-24T12:00:00Z"), timeZone: "UTC" });
  assert.equal(list.length, 1);
  assert.equal(list[0].workouts, 1);
});
