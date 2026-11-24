import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { ImportMapping } from "../src/domain/ImportMapping";
import { CsvTable, WorkoutImport } from "../src/domain/WorkoutImport";
import { StrengthExercises } from "../src/domain/StrengthExercises";
import { TrainingProgram } from "../src/domain/TrainingProgram";
import { volumeSummary, makeWorkout, estimatedOneRepMax, exerciseById } from "../src/lib/model";
import type { Workout } from "../src/lib/types";

const CASES: Array<[string, string]> = [
  ["Bench Press (Barbell)", "bench"],
  ["Squat (Barbell)", "squat"],
  ["Romanian Deadlift (Barbell)", "rdl"],
  ["Deadlift (Barbell)", "deadlift-bar"],
  ["Bent Over Row (Barbell)", "row-bent-bar"],
  ["Overhead Press (Barbell)", "ohp-bar"],
];

const csvArg = process.argv[2] ?? process.env.TYAGA_OWNER_CSV;
if (!csvArg) {
  console.error("Использование: npm run verify:owner-csv -- /path/to/strong-test-history.csv");
  process.exit(1);
}
const csvPath = resolve(csvArg);
if (!existsSync(csvPath)) {
  console.error(`Файл не найден: ${csvPath}`);
  process.exit(1);
}

const raw = readFileSync(csvPath, "utf8");

// 1. Every exercise in the real Strong CSV is recognised.
const rows = new CsvTable().parse(raw);
const column = rows[0].indexOf("Exercise Name");
const names = [...new Set(rows.slice(1).map((r) => r[column]))];
assert.deepEqual(names.sort(), CASES.map(([n]) => n).sort());
assert.ok(ImportMapping.needsWeightQuestion(names));
for (const name of names) assert.ok(ImportMapping.suggest(name), name);

// 2. Parsed CSV maps to curated exercises with tonnage, 1RM and programme progression.
const parsed = new WorkoutImport({ dateOrder: "dmy", weightUnit: "kg", distanceUnit: "km", timeZone: "UTC" }).parse(raw, "strong");
assert.equal(parsed.workouts.length, 21);
assert.equal(parsed.setCount, 175);
const stored = parsed.workouts.map((w) => ({
  ...makeWorkout([], [], "UTC"),
  id: "import:test:" + w.sourceKey,
  name: w.name,
  date: w.date,
  exercises: w.exercises.map((e) => {
    const chosen = ImportMapping.suggest(e.sourceName)!;
    return {
      exerciseId: chosen.id,
      catalogRevision: chosen.catalogRevision,
      displayNameSnapshot: chosen.name,
      sets: e.sets.map((s, i) => ({ ...s, id: `${w.sourceKey}:${i}` })),
    };
  }),
}));
assert.ok(volumeSummary(stored as never, "all").total > 0);
const own = makeWorkout(["bench"], [], "UTC");
own.date = "2026-10-20";
own.exercises[0].sets.forEach((s) => ((s.done = true), (s.weight = 65)));
const strengthRows = StrengthExercises.list([...(stored as never[]), own]);
assert.equal(strengthRows.filter((r) => r.we.exerciseId === "bench").length, 1);
assert.equal(strengthRows.length, 6);
const bench = stored.flatMap((w) => w.exercises).find((e) => e.exerciseId === "bench")!;
const e1rm = estimatedOneRepMax(bench.sets[0] as never, bench as never);
assert.ok(e1rm !== null && e1rm > bench.sets[0].weight);
assert.ok(exerciseById("bench").recording.e1rmEligible);
const plan = {
  id: "p",
  name: "Верх тела",
  notes: "",
  days: [0],
  restSeconds: 90,
  progression: "repeat" as const,
  repMin: 8,
  repMax: 12,
  incrementKg: 2.5,
  revision: 1,
  exercises: makeWorkout(["bench"], [], "UTC").exercises,
};
const latest = stored.filter((w) => w.exercises.some((e) => e.exerciseId === "bench")).sort((a, b) => b.date.localeCompare(a.date))[0];
const lastWeight = latest.exercises.find((e) => e.exerciseId === "bench")!.sets.at(-1)!.weight;
assert.equal(new TrainingProgram(plan).start(stored as never, "UTC", "2026-11-14").exercises[0].sets[0].weight, lastWeight);

// 3. Full Worker import + replace flow on the 21/175 CSV.
const mapped = parsed.workouts.map((w) => ({
  ...w,
  exercises: w.exercises.map((e) => {
    const chosen = ImportMapping.suggestForImport(e.sourceName);
    assert.ok(chosen, `qualified Strong name ${e.sourceName}`);
    return { ...e, exerciseId: chosen.id, displayName: chosen.name, catalogRevision: chosen.catalogRevision };
  }),
}));

const mf = new Miniflare(
  convertV4MiniflareOptions({
    workers: [{ modules: true, scriptPath: "dist/server/index.js", compatibilityDate: "2025-09-27", d1Databases: ["DB"] }],
    cf: false,
  }),
);
try {
  const db = await mf.getD1Database("DB");
  for (const file of (await readdir("drizzle")).filter((p) => p.endsWith(".sql")).sort())
    for (const statement of (await readFile("drizzle/" + file, "utf8")).split("--> statement-breakpoint").filter((s) => s.trim()))
      await db.prepare(statement.trim()).run();
  const base = "http://localhost";
  const reg = await mf.dispatchFetch(base + "/api/auth/register", {
    method: "POST",
    headers: { "oai-authenticated-user-id": "owner", Origin: base, "Content-Type": "application/json" },
    body: JSON.stringify({ email: "owner@example.test", password: "test account passphrase", displayName: "owner", timeZone: "UTC" }),
  });
  assert.equal(reg.status, 201);
  const cookie = reg.headers.get("Set-Cookie")!.split(";")[0];
  const req = (path: string, method = "GET", body?: unknown) =>
    mf.dispatchFetch(base + path, {
      method,
      headers: { "oai-authenticated-user-id": "owner", Cookie: cookie, Origin: base, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  const first = await req("/api/import", "POST", { format: "strong", workouts: mapped, runId: crypto.randomUUID() });
  assert.equal(first.status, 200);
  assert.equal(((await first.json()) as { imported: number }).imported, 21);
  const withVolume = ((await (await req("/api/data")).json()) as { workouts: Workout[] }).workouts;
  assert.equal(withVolume.length, 21);
  assert.ok(volumeSummary(withVolume, "all").total > 0);
  const literal = await req("/api/import", "POST", { format: "strong", workouts: parsed.workouts, replace: true, runId: crypto.randomUUID() });
  assert.equal(literal.status, 200);
  assert.equal(((await literal.json()) as { replaced: number }).replaced, 21);
  const after = ((await (await req("/api/data")).json()) as { workouts: Workout[] }).workouts;
  assert.equal(after.length, 21);
  assert.ok(after.every((w) => w.exercises.every((e) => e.exerciseId.startsWith("custom:"))));
  assert.equal(volumeSummary(after, "all").total, 0);
  console.log("Owner Strong CSV verification passed (21 workouts / 175 sets).");
} finally {
  await mf.dispose();
}
