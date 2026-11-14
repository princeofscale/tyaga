import test from "node:test";
import assert from "node:assert/strict";
import { DeloadEngine, DELOAD_PRESETS } from "../src/domain/DeloadEngine";
import type { Workout } from "../src/lib/model";

test("DeloadEngine assesses fatigue from workout volume", () => {
  // Empty workouts = fresh status
  const assessmentEmpty = DeloadEngine.assessFatigue([]);
  assert.equal(assessmentEmpty.status, "fresh");
  assert.ok(assessmentEmpty.fatigueScore < 30);

  // High volume workouts
  const fakeWorkouts: Workout[] = Array.from({ length: 16 }).map((_, i) => ({
    id: `w-${i}`,
    date: new Date(Date.now() - i * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    name: "Силовая тренировка",
    duration: 60,
    notes: "",
    exercises: [
      {
        exerciseId: "bench",
        catalogRevision: 2,
        sets: [
          { id: `s-w-${i}`, warmup: true, weight: 50, reps: 10, rir: null, done: true },
          { id: `s-1-${i}`, warmup: false, weight: 100, reps: 5, rir: 0, done: true },
          { id: `s-2-${i}`, warmup: false, weight: 100, reps: 5, rir: 0, done: true },
          { id: `s-3-${i}`, warmup: false, weight: 100, reps: 5, rir: 0, done: true },
          { id: `s-4-${i}`, warmup: false, weight: 100, reps: 5, rir: 0, done: true },
        ],
      },
    ],
  }));

  const assessmentHigh = DeloadEngine.assessFatigue(fakeWorkouts);
  assert.ok(assessmentHigh.fatigueScore >= 50);
  assert.ok(["fatigued", "overreaching"].includes(assessmentHigh.status));
  assert.equal(assessmentHigh.recommendedMode, "volume");
});

test("DeloadEngine transforms workout according to volume deload mode", () => {
  const originalWorkout: Workout = {
    id: "orig-1",
    date: "2026-11-08",
    name: "Грудь и трицепс",
    duration: 60,
    notes: "",
    exercises: [
      {
        exerciseId: "bench",
        catalogRevision: 2,
        sets: [
          { id: "w-1", warmup: true, weight: 40, reps: 10, rir: null, done: true },
          { id: "s-1", warmup: false, weight: 100, reps: 6, rir: 1, done: true },
          { id: "s-2", warmup: false, weight: 100, reps: 6, rir: 1, done: true },
          { id: "s-3", warmup: false, weight: 100, reps: 6, rir: 0, done: true },
          { id: "s-4", warmup: false, weight: 100, reps: 6, rir: 0, done: true },
        ],
      },
    ],
  };

  const deload = DeloadEngine.transformWorkoutForDeload(originalWorkout, "volume");
  assert.ok(deload.name.includes("[Разгрузка]"));

  const exercise = deload.exercises[0];
  const workingSets = exercise.sets.filter((s) => !s.warmup);

  // Original had 4 working sets, volume deload reduces by 50% -> 2 working sets
  assert.equal(workingSets.length, 2);

  // Working sets weight scaled down (100 * 0.85 = 85 kg)
  assert.equal(workingSets[0].weight, 85);
  // Deload RIR set to 3
  assert.equal(workingSets[0].rir, 3);
});

test("fatigue ignores planned, warmup-only, future and out-of-window work", () => {
  const now = new Date("2026-11-12T12:00:00Z");
  const w = (date: string, done = true, warmup = false): Workout => ({
    id: date, name: "Жим", date, duration: 30, notes: "",
    exercises: [{ exerciseId: "bench", catalogRevision: 2, sets: [{
      id: "s", weight: 60, reps: 10, rir: 0, done, warmup,
    }] }],
  });
  const assessment = DeloadEngine.assessFatigue([
    w("2026-10-13"), w("2026-10-14"), w("2026-11-12"), w("2026-11-13"),
    w("2026-11-10", false), w("2026-11-11", true, true),
  ], now, "UTC");
  assert.equal(assessment.recentWorkoutsCount, 2);
  assert.equal(assessment.recentSetsCount, 2);
  assert.equal(assessment.recentFailureSetsCount, 2);
  assert.equal(DeloadEngine.assessFatigue([], now, "UTC").fatigueScore, 0);
});

test("fatigue calendar window respects the account timezone", () => {
  const w: Workout = {
    id: "w", date: "2026-11-13", name: "Жим", duration: 30, notes: "",
    exercises: [{ exerciseId: "bench", sets: [{ id: "s", weight: 60, reps: 10, rir: 2, done: true, warmup: false }] }],
  };
  const now = new Date("2026-11-12T23:30:00Z");
  assert.equal(DeloadEngine.assessFatigue([w], now, "UTC").recentSetsCount, 0);
  assert.equal(DeloadEngine.assessFatigue([w], now, "Europe/Moscow").recentSetsCount, 1);
});

test("deload never adds external weight to bodyweight or unknown historical exercises", async () => {
  const { makeWorkout } = await import("../src/lib/model");
  for (const id of ["pushup", "calf-standing", "crunch"]) {
    const w = makeWorkout([id]);
    const snapshot = JSON.stringify(w);
    const deload = DeloadEngine.transformWorkoutForDeload(w, "volume");
    assert.ok(deload.exercises[0].sets.every((s) => s.weight === 0 && !s.done));
    assert.equal(JSON.stringify(w), snapshot);
  }
  const old = makeWorkout(["bench"]);
  old.exercises[0].catalogRevision = 1;
  old.exercises[0].sets.forEach((s) => s.weight = 73);
  assert.equal(DeloadEngine.transformWorkoutForDeload(old, "volume").exercises[0].sets[0].weight, 73);
});

test("deload eases assisted pullups by increasing assistance, and keeps timed RIR unknown", async () => {
  const { makeWorkout } = await import("../src/lib/model");
  const w = makeWorkout(["pullup-assisted"]);
  w.exercises[0].bodyMassKg = 80;
  w.exercises[0].sets.forEach((s) => s.assistanceKg = 20);
  const reduced = DeloadEngine.transformWorkoutForDeload(w, "volume");
  assert.equal(reduced.exercises[0].sets[0].assistanceKg, 29);
  delete w.exercises[0].bodyMassKg;
  assert.equal(DeloadEngine.transformWorkoutForDeload(w, "volume").exercises[0].sets[0].assistanceKg, 20);
  const timed = makeWorkout(["bench"]);
  const exercise = (await import("../src/lib/model")).exerciseById("bench")!;
  timed.exercises[0] = { ...timed.exercises[0], exerciseId: "custom:hold", catalogRevision: 3,
    externalDefinition: { ...exercise, id: "custom:hold", catalogRevision: 3,
      custom: { familyId: "hold", declaredZones: ["core"] },
      recording: { ...exercise.recording, type: "duration", loadMode: "bodyweight" } } };
  timed.exercises[0].sets.forEach((s) => { s.rir = null; s.durationSeconds = 30; });
  assert.equal(DeloadEngine.transformWorkoutForDeload(timed, "volume").exercises[0].sets[0].rir, null);
});

test("rounding deload weights cannot increase a light working weight", async () => {
  const { makeWorkout } = await import("../src/lib/model");
  const w = makeWorkout(["lateral"]);
  w.exercises[0].sets.forEach((s) => s.weight = 2);
  const reduced = DeloadEngine.transformWorkoutForDeload(w, "intensity");
  assert.ok(reduced.exercises[0].sets[0].weight <= 2);
});
