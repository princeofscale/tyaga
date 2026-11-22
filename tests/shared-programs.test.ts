import test from "node:test";
import assert from "node:assert/strict";
import { SharedProgramBuilder, SHARED_TEMPLATES } from "../src/domain/SharedProgram";
import { TrainingProgram } from "../src/domain/TrainingProgram";
import { makeExerciseEntry, makeSets } from "../src/lib/model";

test("SharedProgramBuilder materializes David Laid DUP cycle with 6 routines and custom maxes", () => {
  const routines = SharedProgramBuilder.materialize(
    {
      title: "Дэвид Лейд · DUP",
      kind: "laid_dup",
      payload: { templateId: "laid_dup", laidRhythm: "6x1", laidExtras: true },
    },
    "2026-11-22",
    { squat: 130, bench: 100, deadlift: 170, ohp: 65 },
  );
  assert.equal(routines.length, 6);
  assert.ok(routines.every((r) => r.periodization?.kind === "laid-dup"));
  assert.equal(routines[0].periodization?.maxes.squat, 130);
  assert.equal(routines[0].periodization?.maxes.bench, 100);
  assert.equal(routines[0].periodization?.maxes.deadlift, 170);
});

test("SharedProgramBuilder serializes and materializes user routines and templates", () => {
  const original = {
    ...TrainingProgram.empty(),
    name: "Жим и плечи",
    days: [0, 3],
    exercises: [
      { ...makeExerciseEntry("bench"), sets: makeSets(4, 90, 6), repMin: 5, repMax: 8 },
      { ...makeExerciseEntry("ohp"), sets: makeSets(3, 55, 8), repMin: 8, repMax: 10 },
    ],
  };

  const spec = SharedProgramBuilder.fromRoutine(original);
  assert.equal(spec.name, "Жим и плечи");
  assert.deepEqual(spec.days, [0, 3]);
  assert.equal(spec.exercises.length, 2);
  assert.equal(spec.exercises[0].sets, 4);

  const rebuilt = SharedProgramBuilder.materialize(
    { title: "Жим и плечи", kind: "routine", payload: { routines: [spec] } },
    "2026-11-22",
  );
  assert.equal(rebuilt.length, 1);
  assert.equal(rebuilt[0].name, "Жим и плечи");
  assert.equal(rebuilt[0].exercises.length, 2);
  assert.equal(rebuilt[0].exercises[0].sets.length, 4);

  for (const tpl of SHARED_TEMPLATES) {
    const built = SharedProgramBuilder.materialize(
      { title: tpl.title, kind: tpl.kind, payload: { templateId: tpl.id } },
      "2026-11-22",
    );
    assert.ok(built.length >= 2, `template ${tpl.id} should produce routines`);
  }
});
