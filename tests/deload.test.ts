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
    durationSeconds: 3600,
    exercises: [
      {
        exerciseId: "bench-press",
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
    durationSeconds: 3600,
    exercises: [
      {
        exerciseId: "bench-press",
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
