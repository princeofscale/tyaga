import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import {
  makeWorkout,
  DEFAULT_SETTINGS,
  type Workout,
  type Settings,
} from "../src/lib/model";
import { muscleLoad, volume, workingSets } from "../src/lib/model";

async function sandbox(
  beforeUpgrade?: (
    db: Awaited<ReturnType<Miniflare["getD1Database"]>>,
  ) => Promise<void>,
) {
  const mf = new Miniflare(convertV4MiniflareOptions({
    workers: [{ modules: true,
    scriptPath: "dist/server/index.js",
    compatibilityDate: "2025-09-27",
    d1Databases: ["DB"] }],
    cf: false,
  }));
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
  const cookies = new Map<string, Promise<string>>();
  const accountCookie = (owner: string) => {
    if (!cookies.has(owner)) cookies.set(owner, (async () => {
      const response = await mf.dispatchFetch(base + "/api/auth/register", {
        method: "POST", headers: { "oai-authenticated-user-id": owner, Origin: base, "Content-Type": "application/json" },
        body: JSON.stringify({ email: `${owner}@example.test`, password: "test account passphrase", displayName: owner, timeZone: "UTC" }),
      });
      assert.equal(response.status, 201);
      return response.headers.get("Set-Cookie")!.split(";")[0];
    })());
    return cookies.get(owner)!;
  };
  const request = async (
    path: string,
    method = "GET",
    body?: unknown,
    owner: string | null = "user-a",
    origin = base,
  ) =>
    mf.dispatchFetch(base + path, {
      method,
      headers: {
        ...(owner ? { "oai-authenticated-user-id": owner, Cookie: await accountCookie(owner) } : {}),
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

test("personal definitions, favorites and routines persist with owner isolation and immutable history", async () => {
  const { mf, request } = await sandbox();
  try {
    const input = {
      familyId: "personal-example",
      name: "[E2E] Тяга моего блока",
      aliases: ["my row", "Моя тяга"],
      notes: "Сиденье 3",
      equipment: "gym",
      declaredZones: ["back"],
      recording: {
        type: "reps",
        loadMode: "machine_stack",
        implementCount: 1,
        laterality: "bilateral",
      },
    };
    const created = await request("/api/custom-exercises", "PUT", input);
    assert.equal(created.status, 200);
    const exercise = ((await created.json()) as any).exercise;
    assert.equal(exercise.primary.length, 0);
    assert.equal(exercise.aliases[0], "my row");
    assert.equal(
      (
        await request("/api/favorites", "PUT", {
          exerciseId: exercise.id,
          favorite: true,
        })
      ).status,
      200,
    );
    const data = (await (await request("/api/product")).json()) as any;
    assert.equal(data.customExercises.length, 1);
    assert.deepEqual(data.favorites, [exercise.id]);
    const alien = (await (
      await request("/api/product", "GET", undefined, "user-b")
    ).json()) as any;
    assert.equal(alien.customExercises.length, 0);
    assert.equal(alien.favorites.length, 0);
    const w = completed();
    w.exercises[0] = {
      exerciseId: exercise.id,
      catalogRevision: 3,
      recordingSpecRevision: 3,
      muscleMappingRevision: 3,
      displayNameSnapshot: exercise.name,
      sets: w.exercises[0].sets,
      externalDefinition: { ...exercise, primary: ["back"] },
    };
    assert.equal(
      (await request("/api/workouts", "PUT", w, "user-b")).status,
      400,
    );
    let saved = (
      (await (await request("/api/workouts", "PUT", w)).json()) as any
    ).workout;
    assert.deepEqual(saved.exercises[0].externalDefinition.primary, []);
    const routine = {
      id: "my-program",
      name: "[E2E] Программа",
      notes: "",
      days: [0, 2, 4],
      exercises: w.exercises,
      restSeconds: 90,
      progression: "repeat",
      repMin: 8,
      repMax: 12,
      incrementKg: 2.5,
      revision: 0,
    };
    const r1 = (
      (await (await request("/api/routines", "PUT", routine)).json()) as any
    ).routine;
    assert.equal(
      (
        await request("/api/routines", "PUT", {
          ...routine,
          id: "only-warmup",
          exercises: routine.exercises.map((e) => ({
            ...e,
            sets: e.sets.map((s) => ({ ...s, warmup: true })),
          })),
        })
      ).status,
      400,
    );
    assert.equal(r1.revision, 1);
    assert.ok(r1.exercises[0].sets.every((s: any) => !s.done));
    assert.equal(
      ((await (await request("/api/routines", "PUT", routine)).json()) as any)
        .routine.revision,
      1,
    );
    const edit = { ...r1, name: "[E2E] Новый план" };
    assert.equal((await request("/api/routines", "PUT", edit)).status, 200);
    assert.equal(
      (await request("/api/routines", "PUT", { ...r1, name: "Старая копия" }))
        .status,
      409,
    );
    assert.equal(
      (await request("/api/routines/my-program", "DELETE", { revision: 1 }))
        .status,
      409,
    );
    const renamed = (
      (await (
        await request("/api/custom-exercises", "PUT", {
          ...input,
          name: "[E2E] Новое название",
        })
      ).json()) as any
    ).exercise;
    const afterEdit = (await (await request("/api/product")).json()) as any;
    assert.deepEqual(afterEdit.favorites, [renamed.id]);
    assert.equal(afterEdit.favoriteDefinitions[0].name, renamed.name);
    saved.notes = "История остаётся прежней";
    const edited = await request("/api/workouts", "PUT", saved);
    assert.equal(edited.status, 200);
    assert.equal(
      ((await edited.json()) as any).workout.exercises[0].displayNameSnapshot,
      exercise.name,
    );
    await request("/api/custom-exercises/" + exercise.id, "DELETE", {});
    assert.equal(
      ((await (await request("/api/data")).json()) as any).workouts.length,
      1,
    );
  } finally {
    await mf.dispose();
  }
});

test("timed catalogue records preserve seconds, distance and null effort through the production API", async () => {
  const { mf, request } = await sandbox();
  try {
    const matches = (await (
      await request("/api/exercises/resolve", "POST", { names: ["Plank"] })
    ).json()) as any;
    const e = matches.matches.Plank.find(
      (e: any) => e.source && e.recording.type === "duration",
    );
    assert.ok(e);
    const w = completed();
    w.exercises = [
      {
        exerciseId: e.id,
        catalogRevision: 3,
        recordingSpecRevision: 3,
        muscleMappingRevision: 3,
        displayNameSnapshot: e.name,
        sets: [
          {
            id: "time-set",
            weight: 0,
            reps: 1,
            rir: null,
            done: true,
            warmup: false,
            durationSeconds: 60,
            distanceKm: 0.1,
          },
        ],
      },
    ];
    const response = await request("/api/workouts", "PUT", w);
    assert.equal(response.status, 200);
    const result = ((await response.json()) as any).workout;
    assert.equal(result.exercises[0].sets[0].durationSeconds, 60);
    assert.equal(result.exercises[0].sets[0].rir, null);
    assert.equal(result.exercises[0].sets[0].distanceKm, 0.1);
    assert.equal(volume([result]), 0);
    w.id = "invalid-duration";
    w.exercises[0].sets[0].durationSeconds = 0;
    assert.equal((await request("/api/workouts", "PUT", w)).status, 400);
  } finally {
    await mf.dispose();
  }
});

test("history import validates before writes, is atomic, retry-safe and namespaces source identities per owner", async () => {
  const { mf, request } = await sandbox();
  try {
    const workout = {
      sourceKey: "strong|2026-10-06 18:00|Push",
      name: "[E2E] Import",
      date: "2026-10-06",
      duration: 45,
      notes: "",
      timeZone: "UTC",
      exercises: [
        {
          sourceName: "My Cable",
          displayName: "Мой блок",
          type: "reps",
          sets: [
            { weight: 25, reps: 10, rir: null, warmup: false, done: true },
          ],
        },
      ],
    };
    const input = { format: "strong", workouts: [workout] };
    const check = await request("/api/import", "POST", {
      ...input,
      dryRun: true,
    });
    assert.equal(check.status, 200);
    assert.equal(
      ((await (await request("/api/data")).json()) as any).workouts.length,
      0,
    );
    assert.equal(
      ((await (await request("/api/product")).json()) as any).customExercises
        .length,
      0,
    );
    const imported = (await (
      await request("/api/import", "POST", input)
    ).json()) as any;
    assert.equal(imported.imported, 1);
    assert.equal(imported.skipped, 0);
    assert.equal(volume(imported.workouts), 0);
    assert.equal(imported.workouts[0].exercises[0].sets[0].rir, null);
    const repeated = (await (
      await request("/api/import", "POST", input)
    ).json()) as any;
    assert.equal(repeated.imported, 0);
    assert.equal(repeated.skipped, 1);
    const other = (await (
      await request("/api/import", "POST", input, "user-b")
    ).json()) as any;
    assert.equal(other.imported, 1);
    assert.notEqual(other.workouts[0].id, imported.workouts[0].id);
    assert.notEqual(other.exercises[0].id, imported.exercises[0].id);
    const invalid = structuredClone(workout);
    invalid.sourceKey = "invalid-package";
    invalid.exercises[0].sets[0].weight = -1;
    assert.equal(
      (
        await request("/api/import", "POST", {
          format: "strong",
          workouts: [{ ...workout, sourceKey: "would-be-created" }, invalid],
        })
      ).status,
      400,
    );
    assert.equal(
      ((await (await request("/api/data")).json()) as any).workouts.length,
      1,
    );
    const c = imported.exercises[0];
    const backup = await request(
      "/api/import/metadata",
      "POST",
      { kind: "custom", items: [c] },
      "user-b",
    );
    assert.equal(backup.status, 200);
    const meta = (await backup.json()) as any;
    assert.ok(meta.idMap[c.id]);
    assert.notEqual(meta.idMap[c.id], c.id);
    const routine = {
      id: "backup-routine",
      name: "[E2E] Backup plan",
      notes: "",
      days: [1, 3],
      exercises: [imported.workouts[0].exercises[0]],
      restSeconds: 90,
      progression: "repeat",
      repMin: 8,
      repMax: 12,
      incrementKg: 2.5,
      revision: 1,
    };
    const restored = await request(
      "/api/import/metadata",
      "POST",
      { kind: "routines", items: [routine], idMap: meta.idMap },
      "user-b",
    );
    assert.equal(restored.status, 200);
    const r = (await restored.json()) as any;
    assert.equal(r.created, 1);
    const dup = (await (
      await request(
        "/api/import/metadata",
        "POST",
        { kind: "routines", items: [routine], idMap: meta.idMap },
        "user-b",
      )
    ).json()) as any;
    assert.equal(dup.skipped, 1);
  } finally {
    await mf.dispose();
  }
});

test("wger imports resume in bounded batches, search is paged and saved definitions are authoritative", async () => {
  const { mf, db, request } = await sandbox();
  try {
    assert.equal(
      (await request("/api/exercises", "GET", undefined, null)).status,
      401,
    );
    let result: any;
    for (let i = 0; i < 8; i++) {
      result = await (await request("/api/exercises?q=bench")).json();
      if (!result.importing) break;
      assert.ok(result.imported <= result.catalogTotal);
    }
    assert.equal(result.importing, undefined);
    assert.equal(result.catalogTotal, 918);
    assert.equal(
      (await db
        .prepare("SELECT COUNT(*) AS count FROM exercise_catalog")
        .first<{ count: number }>())!.count,
      918,
    );
    assert.ok(result.exercises.length > 0 && result.exercises.length <= 24);
    const e = result.exercises.find((e: any) => e.source.record.loggable && e.provenance.reviewStatus === "source-unreviewed");
    assert.ok(e);
    assert.ok(
      e.source.record.attributions.every((a: any) =>
        a.licenseUrl.startsWith("http"),
      ),
    );
    const literal = (await (
      await request("/api/exercises?q=%25")
    ).json()) as any;
    assert.equal(literal.total, 0);
    const ru = (await (
      await request("/api/exercises?language=ru")
    ).json()) as any;
    assert.equal(ru.total, 918);
    assert.ok(
      ru.exercises.every((e: any) => e.source.record.language === "ru"),
    );
    const w = completed();
    w.exercises = [
      {
        exerciseId: e.id,
        catalogRevision: 3,
        recordingSpecRevision: 3,
        muscleMappingRevision: 3,
        displayNameSnapshot: e.name,
        externalDefinition: { ...e, primary: ["chest"] },
        sets: w.exercises[0].sets,
      },
    ];
    const response = await request("/api/workouts", "PUT", w);
    assert.equal(response.status, 200);
    const saved = ((await response.json()) as { workout: Workout }).workout;
    assert.deepEqual(saved.exercises[0].externalDefinition?.primary, []);
    assert.equal(
      saved.exercises[0].externalDefinition?.source?.record.id,
      e.id,
    );
    assert.equal(workingSets([saved]), 1);
    assert.equal(volume([saved]), 0);
    assert.equal(
      muscleLoad([saved]).reduce((n, l) => n + l.total, 0),
      0,
    );
    const retry = await request("/api/workouts", "PUT", w);
    assert.equal(
      ((await retry.json()) as { workout: Workout }).workout.revision,
      1,
    );
    w.id = "unknown-source";
    w.exercises[0].exerciseId = "wger:missing:123";
    assert.equal((await request("/api/workouts", "PUT", w)).status, 400);
  } finally {
    await mf.dispose();
  }
});

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

test(
  "empty journal reads remain available after removing a favorited timed exercise",
  { timeout: 15000 },
  async () => {
    const { mf, request } = await sandbox();
    try {
      const response = await request("/api/custom-exercises", "PUT", {
        familyId: "read-after-delete",
        name: "Планка для проверки",
        nameEn: "",
        aliases: ["Test plank"],
        notes: "",
        equipment: "bodyweight",
        declaredZones: ["core"],
        recording: {
          type: "duration",
          loadMode: "bodyweight",
          implementCount: 1,
          laterality: "bilateral",
        },
      });
      const e = ((await response.json()) as any).exercise;
      assert.equal(
        (
          await request("/api/favorites", "PUT", {
            exerciseId: e.id,
            favorite: true,
          })
        ).status,
        200,
      );
      const w = completed();
      w.exercises = [
        {
          exerciseId: e.id,
          catalogRevision: 3,
          recordingSpecRevision: 3,
          muscleMappingRevision: 3,
          displayNameSnapshot: e.name,
          sets: [
            {
              id: "timed-read-set",
              weight: 0,
              reps: 1,
              rir: null,
              done: true,
              warmup: false,
              durationSeconds: 60,
            },
          ],
        },
      ];
      const saved = (
        (await (await request("/api/workouts", "PUT", w)).json()) as any
      ).workout;
      assert.equal(
        (
          await request("/api/workouts/" + saved.id, "DELETE", {
            revision: saved.revision,
          })
        ).status,
        200,
      );
      assert.equal(
        (await request("/api/custom-exercises/" + e.id, "DELETE", {})).status,
        200,
      );
      for (let i = 0; i < 5; i++) {
        const data = await request("/api/data");
        assert.equal(data.status, 200);
        const state = (await data.json()) as any;
        assert.deepEqual(state.workouts, []);
        assert.equal(state.settings.goals.chest, DEFAULT_SETTINGS.goals.chest);
      }
    } finally {
      await mf.dispose();
    }
  },
);

test("sync endpoints run on D1: triggers record changes and newer documents apply", async () => {
  const { mf, request } = await sandbox();
  try {
    const w = completed();
    assert.equal((await request("/api/workouts", "PUT", w)).status, 200);
    const page = (await (await request("/api/sync/changes?since=0")).json()) as any;
    assert.deepEqual(page.docs.map((d: any) => [d.kind, d.id, d.deleted]), [["workout", w.id, false]]);
    assert.equal((await (await request("/api/sync/changes?since=0", "GET", undefined, "user-b")).json() as any).docs.length, 0);
    const doc = page.docs[0];
    const newer = { ...doc, versionAt: "2999-01-01T00:00:00.000Z", row: { ...doc.row, date: "2026-10-01" } };
    const applied = (await (await request("/api/sync/apply", "POST", { docs: [newer, { ...doc, versionAt: "2000-01-01T00:00:00.000Z" }] })).json()) as any;
    assert.deepEqual(applied, { applied: 1, skipped: 1 });
    const data = (await (await request("/api/data")).json()) as any;
    assert.equal(data.workouts[0].id, w.id);
    assert.equal((await (await request("/api/sync/changes?since=" + page.cursor)).json() as any).docs[0].versionAt, newer.versionAt);
    assert.equal((await request("/api/sync/apply", "POST", { docs: [{ ...newer, kind: "accounts" }] })).status, 400);
  } finally {
    await mf.dispose();
  }
});
