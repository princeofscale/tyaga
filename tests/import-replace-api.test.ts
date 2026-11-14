import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";

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
  let cookie: string | null = null;
  const request = async (path: string, method = "GET", body?: unknown) => {
    if (!cookie) {
      const r = await mf.dispatchFetch(base + "/api/auth/register", {
        method: "POST",
        headers: { "oai-authenticated-user-id": "owner", Origin: base, "Content-Type": "application/json" },
        body: JSON.stringify({ email: "owner@example.test", password: "test account passphrase", displayName: "owner", timeZone: "UTC" }),
      });
      assert.equal(r.status, 201);
      cookie = r.headers.get("Set-Cookie")!.split(";")[0];
    }
    return mf.dispatchFetch(base + path, {
      method,
      headers: { "oai-authenticated-user-id": "owner", Cookie: cookie, Origin: base, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  };
  return { mf, request };
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

test("a new import reports the ids it added, so it can be undone", async () => {
  const { mf, request } = await sandbox();
  try {
    const mapped = session({ exerciseId: "deadlift-bar", displayName: "Становая тяга со штангой", catalogRevision: 3 });
    const done = (await (await request("/api/import", "POST", { format: "strong", workouts: [mapped] })).json()) as any;
    assert.equal(done.imported, 1);
    assert.equal(done.replaced, 0);
    assert.equal(done.addedIds.length, 1);
    const w = done.workouts[0];
    assert.equal(w.id, done.addedIds[0]);
    const removed = await request("/api/workouts/" + encodeURIComponent(w.id), "DELETE", { revision: w.revision });
    assert.equal(removed.status, 200);
    assert.equal(((await (await request("/api/data")).json()) as any).workouts.length, 0);
    // The same file can be imported again afterwards.
    const back = (await (await request("/api/import", "POST", { format: "strong", workouts: [mapped] })).json()) as any;
    assert.equal(back.imported, 1);
  } finally {
    await mf.dispose();
  }
});
