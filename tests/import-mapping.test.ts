import test from "node:test";
import assert from "node:assert/strict";
import { ImportMapping } from "../src/domain/ImportMapping";
import { CsvTable } from "../src/domain/WorkoutImport";
import { readFileSync, existsSync } from "node:fs";

// The six names of the product owner's real Strong export
// (artifacts/agent-evolution/product-visits/po-v3-r02/strong-test-history.csv).
const CASES: Array<[string, string]> = [
  ["Bench Press (Barbell)", "bench"],
  ["Squat (Barbell)", "squat"],
  ["Romanian Deadlift (Barbell)", "rdl"],
  ["Deadlift (Barbell)", "deadlift-bar"],
  ["Bent Over Row (Barbell)", "row-bent-bar"],
  ["Overhead Press (Barbell)", "ohp-bar"],
];

for (const [name, id] of CASES)
  test(`ImportMapping: «${name}» → ${id}`, () => {
    const found = ImportMapping.suggest(name);
    assert.equal(found?.id, id);
    assert.equal(found?.recording.loadMode, "total_external");
    assert.ok(ImportMapping.appliesByDefault(found));
  });

test("ImportMapping: the barbell press is not the seated dumbbell press", () => {
  assert.notEqual(ImportMapping.suggest("Overhead Press (Barbell)")?.id, "ohp");
  assert.equal(ImportMapping.suggest("Overhead Press (Dumbbell)"), null);
  assert.equal(ImportMapping.suggest("Deadlift (Trap Bar)"), null);
  assert.equal(ImportMapping.suggest("Squat (Smith Machine)"), null);
});

test("ImportMapping: case, ё and punctuation do not matter; Russian names work", () => {
  assert.equal(ImportMapping.suggest("  deadlift (BARBELL) ")?.id, "deadlift-bar");
  assert.equal(ImportMapping.suggest("Тяга штанги в наклоне")?.id, "row-bent-bar");
  assert.equal(ImportMapping.suggest("Жим лёжа")?.id, "bench");
});

test("ImportMapping: a dumbbell or machine match is not applied by default", () => {
  const db = ImportMapping.suggest("Seated dumbbell overhead press");
  assert.equal(db?.id, "ohp");
  assert.equal(ImportMapping.appliesByDefault(db), false);
  assert.equal(ImportMapping.appliesByDefault(null), false);
});

test("ImportMapping: the mapping is a function of the name only", () => {
  for (const [name] of CASES)
    assert.equal(ImportMapping.suggest(name), ImportMapping.suggest(name));
});

test("ImportMapping: every exercise of the real Strong CSV is recognised", (t) => {
  const path = new URL(
    "../artifacts/agent-evolution/product-visits/po-v3-r02/strong-test-history.csv",
    import.meta.url,
  );
  if (!existsSync(path)) return t.skip("the product owner's CSV is not in this checkout");
  const rows = new CsvTable().parse(readFileSync(path, "utf8"));
  const column = rows[0].indexOf("Exercise Name");
  const names = [...new Set(rows.slice(1).map((r) => r[column]))];
  assert.deepEqual(names.sort(), CASES.map(([n]) => n).sort());
  assert.ok(ImportMapping.needsWeightQuestion(names));
  for (const name of names) assert.ok(ImportMapping.suggest(name), name);
});

test("the real Strong CSV, mapped as «mine», has tonnage, 1RM, one «Сила» row and feeds the programme", async (t) => {
  const path = new URL(
    "../artifacts/agent-evolution/product-visits/po-v3-r02/strong-test-history.csv",
    import.meta.url,
  );
  if (!existsSync(path)) return t.skip("the product owner's CSV is not in this checkout");
  const { WorkoutImport } = await import("../src/domain/WorkoutImport");
  const { volumeSummary, makeWorkout, estimatedOneRepMax, exerciseById } = await import("../src/lib/model");
  const { StrengthExercises } = await import("../src/domain/StrengthExercises");
  const { TrainingProgram } = await import("../src/domain/TrainingProgram");
  const parsed = new WorkoutImport({ dateOrder: "dmy", weightUnit: "kg", distanceUnit: "km", timeZone: "UTC" }).parse(
    readFileSync(path, "utf8"),
    "strong",
  );
  // What the server stores for an exercise mapped by the importer.
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
  assert.ok(volumeSummary(stored as never, "all").total > 0, "есть тоннаж");
  const own = makeWorkout(["bench"], [], "UTC");
  own.date = "2026-10-20";
  own.exercises[0].sets.forEach((s) => ((s.done = true), (s.weight = 65)));
  const rows = StrengthExercises.list([...(stored as never[]), own]);
  assert.equal(rows.filter((r) => r.we.exerciseId === "bench").length, 1, "жим — один ряд, свой и импортированный вместе");
  assert.equal(rows.length, 6, "шесть упражнений — шесть рядов");
  const bench = stored.flatMap((w) => w.exercises).find((e) => e.exerciseId === "bench")!;
  const e1rm = estimatedOneRepMax(bench.sets[0] as never, bench as never);
  assert.ok(e1rm !== null && e1rm > bench.sets[0].weight, "есть расчётный 1ПМ");
  assert.ok(exerciseById("bench").recording.e1rmEligible);
  const plan = {
    id: "p", name: "Верх тела", notes: "", days: [0], restSeconds: 90, progression: "repeat" as const,
    repMin: 8, repMax: 12, incrementKg: 2.5, revision: 1, exercises: makeWorkout(["bench"], [], "UTC").exercises,
  };
  const latest = stored.filter((w) => w.exercises.some((e) => e.exerciseId === "bench")).sort((a, b) => b.date.localeCompare(a.date))[0];
  const lastWeight = latest.exercises.find((e) => e.exerciseId === "bench")!.sets.at(-1)!.weight;
  assert.equal(new TrainingProgram(plan).start(stored as never, "UTC", "2026-11-14").exercises[0].sets[0].weight, lastWeight);
});
