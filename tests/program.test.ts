import test from "node:test";
import assert from "node:assert/strict";
import {
  exerciseById,
  makeExerciseEntry,
  muscleLoad,
  DEFAULT_SETTINGS,
} from "../src/lib/model";
import { TrainingProgram, DELOAD_CYCLE } from "../src/domain/TrainingProgram";
import { validRoutine } from "../server/validation";
import type { Workout } from "../src/lib/types";

const TZ = "Europe/Saratov";
const WEEK0 = "2026-01-05"; // понедельник
const weeksLater = (weeks: number) => {
  const d = new Date(WEEK0 + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + weeks * 7);
  return d.toISOString().slice(0, 10);
};
/** A saved workout of this routine where every planned working set is done. */
function performed(program: TrainingProgram, date: string, weight = 100): Workout {
  const workout = program.start([], TZ, date);
  return {
    ...workout,
    date,
    exercises: workout.exercises.map((e) => ({
      ...e,
      sets: e.sets.map((s) => ({ ...s, done: !s.warmup, weight: s.warmup ? 0 : weight })),
    })),
  };
}

test("программа v2 разложена на пять тренировок с подходами и диапазонами из плана", () => {
  const routines = TrainingProgram.programV2();
  assert.equal(routines.length, 5);
  assert.deepEqual(
    routines.map((r) => r.days),
    [[0], [1], [3], [4], [5]],
  );
  const programs = routines.map((r) => new TrainingProgram(r));
  assert.deepEqual(
    programs.map((p) => p.workingSets),
    [22, 29, 24, 26, 25],
  );
  const monday = routines[0];
  assert.equal(monday.name, "Верх: грудь, спина, трапеция");
  assert.deepEqual(
    monday.exercises.map((e) => [e.exerciseId, e.repMin, e.repMax]),
    [
      ["incline-bar", 6, 8],
      ["row", 6, 10],
      ["flat-db-press", 8, 12],
      ["pullup-weighted", 6, 12],
      ["fly", 12, 15],
      ["pullover-cable", 12, 15],
      ["shrug-bar", 8, 12],
      ["hanging-leg-raise", 8, 15],
    ],
  );
  for (const routine of routines) {
    assert.equal(routine.progression, "double");
    assert.deepEqual(routine.cycle, DELOAD_CYCLE);
    for (const entry of routine.exercises) {
      assert.ok(entry.sets.every((s) => !s.done));
      assert.ok(entry.sets.every((s) => s.rir === null));
      assert.ok(exerciseById(entry.exerciseId), entry.exerciseId);
    }
  }
});
test("у каждого упражнения свой диапазон повторений, и он входит в стартовую тренировку", () => {
  const routine = TrainingProgram.programV2()[1];
  const program = new TrainingProgram(routine);
  const workout = program.start([], TZ, WEEK0);
  const lateral = workout.exercises.find((e) => e.exerciseId === "lateral")!;
  assert.equal(lateral.sets.length, 6);
  assert.deepEqual(
    lateral.sets.map((s) => s.reps),
    Array(6).fill(12),
  );
  assert.equal(workout.exercises.find((e) => e.exerciseId === "ohp")!.repMin, 8);
  assert.equal(workout.exercises.find((e) => e.exerciseId === "ohp")!.repMax, 10);
  assert.equal(program.range(routine.exercises[0]).max, 10);
});
test("каждая пятая неделя — разгрузка: половина подходов, 70% веса, RIR 4", () => {
  const program = new TrainingProgram(TrainingProgram.programV2()[0]);
  const history = [performed(program, WEEK0)];
  assert.equal(program.isDeload(history, WEEK0), false);
  assert.equal(program.isDeload(history, weeksLater(3)), false);
  assert.equal(program.isDeload(history, weeksLater(4)), true);
  const deload = program.start(history, TZ, weeksLater(4));
  const squatFree = deload.exercises.map(
    (e) => e.sets.filter((s) => !s.warmup).length,
  );
  assert.deepEqual(squatFree, [1, 1, 1, 1, 1, 1, 1, 1]);
  assert.equal(
    deload.exercises.flatMap((e) => e.sets).every((s) => s.weight === 70),
    true,
  );
  assert.equal(
    deload.exercises.flatMap((e) => e.sets).every((s) => s.rir === 4),
    true,
  );
  assert.match(deload.notes, /Разгрузочная неделя 5 из 5/);
  assert.equal(
    deload.exercises.every((e) => e.progressionNote === undefined),
    true,
  );
  assert.equal(program.isDeload(history, weeksLater(5)), false);
  const next = program.start(history, TZ, weeksLater(5));
  assert.equal(next.exercises[0].sets.length, 3);
  assert.doesNotMatch(next.notes, /Разгрузочная/);
});
test("после разгрузки первая рабочая неделя берёт вес до разгрузки, а не 70%", () => {
  const program = new TrainingProgram(TrainingProgram.programV2()[0]);
  const working = performed(program, WEEK0, 100);
  const deload = program.start([working], TZ, weeksLater(4));
  const deloadSaved: Workout = {
    ...deload,
    date: weeksLater(4),
    exercises: deload.exercises.map((e) => ({
      ...e,
      sets: e.sets.map((s) => ({ ...s, done: !s.warmup })),
    })),
  };
  const after = program.start([deloadSaved, working], TZ, weeksLater(5));
  assert.equal(
    after.exercises.flatMap((e) => e.sets).every((s) => s.weight === 100),
    true,
  );
});
test("ориентиры недели считаются из самой программы, а не выдуманы", () => {
  const goals = TrainingProgram.programV2Goals();
  const planned = TrainingProgram.programV2().flatMap((r) => r.exercises);
  const count = (zone: string) =>
    planned.reduce(
      (sum, e) =>
        sum +
        (exerciseById(e.exerciseId)!.primary.includes(zone as never)
          ? e.sets.filter((s) => !s.warmup).length
          : 0),
      0,
    );
  for (const [zone, value] of Object.entries(goals))
    assert.equal(value, count(zone), zone);
  // A set can serve more than one zone, so the sum is never below the work done.
  const total = Object.values(goals).reduce((a, b) => a + b, 0);
  assert.ok(total >= planned.reduce((n, e) => n + e.sets.length, 0));
  // Not the 13-row table from programma-v2: the app counts every press as a
  // direct triceps set, so the derived targets are what the plan really asks of
  // the same model the coverage report uses.
  assert.deepEqual(goals, {
    chest: 16,
    back: 29,
    shoulders: 24,
    biceps: 14,
    triceps: 29,
    quads: 13,
    hamstrings: 6,
    glutes: 10,
    calves: 4,
    core: 12,
  });
  const loads = muscleLoad([], { ...DEFAULT_SETTINGS, goals });
  assert.deepEqual(
    loads.map((l) => l.goal),
    Object.values(goals),
  );
});
test("сервер принимает программу v2 с движениями выпуска 3 и сохраняет разгрузку", () => {
  for (const routine of TrainingProgram.programV2()) {
    const saved = validRoutine(
      JSON.parse(JSON.stringify(routine)),
      new Map(),
    );
    assert.deepEqual(saved.cycle, DELOAD_CYCLE);
    assert.equal(saved.exercises.length, routine.exercises.length);
    for (const [index, entry] of saved.exercises.entries()) {
      assert.equal(entry.repMin, routine.exercises[index].repMin);
      assert.equal(entry.repMax, routine.exercises[index].repMax);
      // A curated release needs no copied definition in every saved entry.
      assert.equal(entry.externalDefinition, undefined);
    }
  }
  const broken = JSON.parse(JSON.stringify(TrainingProgram.programV2()[0]));
  broken.cycle.setFactor = 2;
  assert.throws(() => validRoutine(broken, new Map()), /числовые поля/);
});
test("шаблон разгрузки не ломает программу без цикла и без своих диапазонов", () => {
  const routine = { ...TrainingProgram.starter("split")[0] };
  const program = new TrainingProgram(routine);
  const workout = program.start([], TZ, WEEK0);
  assert.equal(program.isDeload([], WEEK0), false);
  assert.equal(workout.exercises.length, routine.exercises.length);
  assert.equal(program.workingSets, 18);
  const custom = makeExerciseEntry("bench");
  assert.equal(custom.repMin, undefined);
});
