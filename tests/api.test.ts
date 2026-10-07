import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { Miniflare } from "miniflare";
import {
  makeWorkout,
  DEFAULT_SETTINGS,
  type Workout,
  type Settings,
} from "../src/lib/model";

async function sandbox(
  beforeUpgrade?: (
    db: Awaited<ReturnType<Miniflare["getD1Database"]>>,
  ) => Promise<void>,
) {
  const mf = new Miniflare({
    modules: true,
    scriptPath: "dist/server/index.js",
    compatibilityDate: "2025-09-27",
    d1Databases: ["DB"],
    cf: false,
  });
  const db = await mf.getD1Database("DB");
  const migrations = (await readdir("drizzle"))
    .filter((p) => p.endsWith(".sql"))
    .sort();
  for (const [i, file] of migrations.entries()) {
    const sql = await readFile("drizzle/" + file, "utf8");
    for (const statement of sql
      .split("--> statement-breakpoint")
      .filter((s) => s.trim()))
      await db.prepare(statement.trim()).run();
    if (i === 0 && beforeUpgrade) await beforeUpgrade(db);
  }
  const base = "http://localhost";
  const request = (
    path: string,
    method = "GET",
    body?: unknown,
    owner: string | null = "user-a",
    origin = base,
  ) =>
    mf.dispatchFetch(base + path, {
      method,
      headers: {
        ...(owner ? { "oai-authenticated-user-id": owner } : {}),
        Origin: origin,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  return { mf, db, request };
}
function completed() {
  const w = makeWorkout(["bench"], [], "UTC");
  w.exercises[0].sets[0].done = true;
  w.exercises[0].sets[0].weight = 60;
  return w;
}

test("production API preserves atomic revisions, idempotence, identity isolation and validation", async (t) => {
  const { mf, request } = await sandbox();
  try {
    let w = completed();
    await t.test(
      "anonymous reads/writes and cross-origin mutations are rejected",
      async () => {
        assert.equal(
          (await request("/api/data", "GET", undefined, null)).status,
          401,
        );
        assert.equal(
          (await request("/api/workouts", "PUT", w, null)).status,
          401,
        );
        assert.equal(
          (
            await request(
              "/api/workouts",
              "PUT",
              w,
              "user-a",
              "https://other.example",
            )
          ).status,
          403,
        );
      },
    );
    await t.test(
      "create and retry after a committed write return one unchanged revision",
      async () => {
        const sent = structuredClone(w);
        const created = await request("/api/workouts", "PUT", sent);
        assert.equal(created.status, 200);
        w = ((await created.json()) as { workout: Workout }).workout;
        assert.equal(w.revision, 1);
        const retry = await request("/api/workouts", "PUT", sent);
        assert.equal(retry.status, 200);
        assert.equal(
          ((await retry.json()) as { workout: Workout }).workout.revision,
          1,
        );
        const data = (await (await request("/api/data")).json()) as {
          workouts: Workout[];
        };
        assert.equal(data.workouts.length, 1);
        assert.equal(data.workouts[0].exercises[0].catalogRevision, 2);
      },
    );
    await t.test(
      "two competing edits yield exactly one write and one 409 with the winner",
      async () => {
        const a = structuredClone(w);
        const b = structuredClone(w);
        a.notes = "Телефон";
        b.notes = "Ноутбук";
        const responses = await Promise.all([
          request("/api/workouts", "PUT", a),
          request("/api/workouts", "PUT", b),
        ]);
        assert.deepEqual(responses.map((r) => r.status).sort(), [200, 409]);
        const winner = (await responses
          .find((r) => r.status === 200)!
          .json()) as { workout: Workout };
        const loser = (await responses
          .find((r) => r.status === 409)!
          .json()) as { current: Workout };
        assert.equal(winner.workout.revision, 2);
        assert.equal(loser.current.notes, winner.workout.notes);
        const retryBody = winner.workout.notes === a.notes ? a : b;
        assert.equal(
          (await request("/api/workouts", "PUT", retryBody)).status,
          200,
        );
        const staleDelete = await request("/api/workouts/" + w.id, "DELETE", {
          revision: w.revision,
        });
        assert.equal(staleDelete.status, 409);
        w = winner.workout;
      },
    );
    await t.test(
      "another owner cannot read, overwrite or delete a colliding workout UUID",
      async () => {
        const data = (await (
          await request("/api/data", "GET", undefined, "user-b")
        ).json()) as { workouts: Workout[] };
        assert.equal(data.workouts.length, 0);
        assert.equal(
          (await request("/api/workouts", "PUT", w, "user-b")).status,
          403,
        );
        assert.equal(
          (
            await request(
              "/api/workouts/" + w.id,
              "DELETE",
              { revision: w.revision },
              "user-b",
            )
          ).status,
          200,
        );
        const own = (await (await request("/api/data")).json()) as {
          workouts: Workout[];
        };
        assert.equal(own.workouts.length, 1);
      },
    );
    await t.test(
      "working-set validation is enforced by the API, including warmup-only",
      async () => {
        const warm = completed();
        warm.exercises[0].sets[0].warmup = true;
        assert.equal((await request("/api/workouts", "PUT", warm)).status, 400);
        const future = completed();
        future.date = "2099-01-01";
        assert.equal(
          (await request("/api/workouts", "PUT", future)).status,
          400,
        );
        assert.equal(
          (await request("/api/workouts/" + w.id, "DELETE", {})).status,
          400,
        );
      },
    );
    await t.test(
      "settings reject stale writes and an identical retry stays idempotent",
      async () => {
        const initial = {
          ...DEFAULT_SETTINGS,
          timeZone: "Europe/Amsterdam",
          revision: 0,
        };
        const first = await request("/api/settings", "PUT", initial);
        assert.equal(first.status, 200);
        const settings = ((await first.json()) as { settings: Settings })
          .settings;
        assert.equal(settings.revision, 1);
        const retry = await request("/api/settings", "PUT", initial);
        assert.equal(retry.status, 200);
        assert.equal(
          ((await retry.json()) as { settings: Settings }).settings.revision,
          1,
        );
        const changed = { ...settings, restSeconds: 120 };
        assert.equal(
          (await request("/api/settings", "PUT", changed)).status,
          200,
        );
        const stale = { ...settings, restSeconds: 180 };
        assert.equal(
          (await request("/api/settings", "PUT", stale)).status,
          409,
        );
      },
    );
    await t.test(
      "delete retry is safe and a stale edit cannot resurrect a deleted workout",
      async () => {
        assert.equal(
          (
            await request("/api/workouts/" + w.id, "DELETE", {
              revision: w.revision,
            })
          ).status,
          200,
        );
        assert.equal(
          (
            await request("/api/workouts/" + w.id, "DELETE", {
              revision: w.revision,
            })
          ).status,
          200,
        );
        const stale = await request("/api/workouts", "PUT", w);
        assert.equal(stale.status, 409);
        assert.equal(((await stale.json()) as { current: null }).current, null);
        const data = (await (await request("/api/data")).json()) as {
          workouts: Workout[];
        };
        assert.equal(data.workouts.length, 0);
      },
    );
  } finally {
    await mf.dispose();
  }
});

test("forward migration preserves v1 payloads, supplies revision zero and allows a safe legacy edit", async () => {
  const old: Workout = {
    id: "legacy-session",
    name: "История v1",
    date: "2026-10-06",
    duration: 40,
    notes: "Не пересчитывать вес",
    exercises: [
      {
        exerciseId: "incline-db",
        sets: [
          {
            id: "old-set",
            weight: 20,
            reps: 10,
            rir: 2,
            done: true,
            warmup: false,
          },
        ],
      },
    ],
  };
  const payload = JSON.stringify(old);
  const { mf, db, request } = await sandbox(async (db) => {
    await db
      .prepare(
        "INSERT INTO workouts (id, owner_id, date, payload, updated_at) VALUES (?, ?, ?, ?, ?)",
      )
      .bind(old.id, "user-a", old.date, payload, "2026-10-06T12:00:00Z")
      .run();
    await db
      .prepare("INSERT INTO settings (owner_id, payload) VALUES (?, ?)")
      .bind("user-a", JSON.stringify(DEFAULT_SETTINGS))
      .run();
  });
  try {
    const stored = await db
      .prepare("SELECT payload, revision FROM workouts WHERE id = ?")
      .bind(old.id)
      .first<{ payload: string; revision: number }>();
    assert.equal(stored!.payload, payload);
    assert.equal(stored!.revision, 0);
    const data = (await (await request("/api/data")).json()) as {
      workouts: Workout[];
    };
    assert.equal(data.workouts[0].revision, 0);
    const edited = { ...data.workouts[0], notes: "Уточнённая заметка" };
    const saved = await request("/api/workouts", "PUT", edited);
    assert.equal(saved.status, 200);
    const result = ((await saved.json()) as { workout: Workout }).workout;
    assert.equal(result.revision, 1);
    assert.equal(result.exercises[0].catalogRevision, undefined);
    assert.equal(result.exercises[0].sets[0].weight, 20);
  } finally {
    await mf.dispose();
  }
});
