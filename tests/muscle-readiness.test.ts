import test from "node:test";
import assert from "node:assert/strict";
import { MuscleReadiness } from "../src/domain/MuscleReadiness";
import { makeWorkout } from "../src/lib/model";

function doneWorkout(date: string, exerciseId: string, setsCount: number) {
  const w = makeWorkout([exerciseId], [], "UTC");
  w.date = date;
  w.exercises[0].sets = Array.from({ length: setsCount }, (_, i) => ({
    id: `${exerciseId}-${i}`,
    weight: 80,
    reps: 8,
    rir: 2,
    done: true,
    warmup: false,
  }));
  return w;
}

test("MuscleReadiness computes freshness and daysAgo from completed working sets", () => {
  const workouts = [
    doneWorkout("2026-11-22", "bench", 4),
    doneWorkout("2026-11-21", "squat", 5),
    doneWorkout("2026-11-18", "pullup", 3),
  ];

  const items = MuscleReadiness.fromWorkouts(workouts, "2026-11-22");
  const byId = Object.fromEntries(items.map((x) => [x.id, x]));

  assert.equal(byId.chest.state, "fatigued");
  assert.equal(byId.chest.daysAgo, 0);
  assert.equal(byId.chest.lastSets, 4);
  assert.equal(byId.chest.statusText, "Сегодня");

  assert.equal(byId.legs.state, "recovering");
  assert.equal(byId.legs.daysAgo, 1);
  assert.equal(byId.legs.lastSets, 5);
  assert.equal(byId.legs.statusText, "Вчера");

  assert.equal(byId.back.state, "ready");
  assert.equal(byId.back.daysAgo, 4);
  assert.equal(byId.back.ratio, 1);

  assert.equal(byId.shoulders.state, "ready");
  assert.equal(byId.shoulders.daysAgo, null);
  assert.equal(byId.shoulders.statusText, "Готовы");
});

test("MuscleReadiness ignores future workouts and unfinished or warmup sets", () => {
  const future = doneWorkout("2026-11-25", "bench", 4);
  const unfinished = makeWorkout(["squat"], [], "UTC");
  unfinished.date = "2026-11-22";
  unfinished.exercises[0].sets[0].done = false;
  const warmupOnly = makeWorkout(["deadlift-bar"], [], "UTC");
  warmupOnly.date = "2026-11-22";
  warmupOnly.exercises[0].sets[0].done = true;
  warmupOnly.exercises[0].sets[0].warmup = true;

  const items = MuscleReadiness.fromWorkouts([future, unfinished, warmupOnly], "2026-11-22");
  for (const item of items) {
    assert.equal(item.daysAgo, null);
    assert.equal(item.state, "ready");
  }
});
