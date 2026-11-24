import test from "node:test";
import assert from "node:assert/strict";
import { ImportMapping } from "../src/domain/ImportMapping";

// The six names of the product owner's real Strong export.
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

test("generic aliases never auto-map equipment, while qualified Strong names still do", () => {
  for (const source of ["Deadlift", "Romanian deadlift", "Bent over row", "Overhead press", "Military press", "Back squat"])
    assert.equal(ImportMapping.suggestForImport(source), null, `${source} must remain literal or manual`);
  for (const [source, id] of CASES) {
    assert.equal(ImportMapping.suggestForImport(source)?.id, id);
    assert.ok(ImportMapping.appliesByDefaultName(source));
  }
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
