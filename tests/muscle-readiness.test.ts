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

test("MuscleReadiness V2 separates no-data groups from loaded groups while keeping numeric fallback", () => {
  const empty = MuscleReadiness.fromWorkoutsV2([], "2026-11-26", "UTC", new Date("2026-11-26T12:00:00Z"));
  for (const g of empty) {
    assert.equal(g.readinessPct, 100);
    assert.equal(g.hasRecentLoad, false);
  }

  const bench = doneWorkout("2026-11-25", "bench", 4);
  const loaded = MuscleReadiness.fromWorkoutsV2([bench], "2026-11-26", "UTC", new Date("2026-11-26T12:00:00Z"));
  const byId = Object.fromEntries(loaded.map((x) => [x.id, x]));
  assert.equal(byId.chest.hasRecentLoad, true);
  assert.equal(byId.calves.hasRecentLoad, false);
  assert.equal(byId.calves.readinessPct, 100);
});

test("MuscleReadiness V2 ignores updatedAt edits and keeps exact createdAt age across local midnight", () => {
  const base = doneWorkout("2026-11-26", "bench", 5);
  base.timeZone = "UTC";
  base.createdAt = "2026-11-26T06:00:00Z";
  const unedited = { ...base, updatedAt: "2026-11-26T06:00:00Z" };
  const noteEdited = { ...base, notes: "Added note later", updatedAt: "2026-11-26T23:55:00Z" };
  const ref = new Date("2026-11-27T00:00:00Z");

  const a = MuscleReadiness.fromWorkoutsV2([unedited], "2026-11-27", "UTC", ref).find((x) => x.id === "chest")!;
  const b = MuscleReadiness.fromWorkoutsV2([noteEdited], "2026-11-27", "UTC", ref).find((x) => x.id === "chest")!;
  assert.equal(b.readinessPct, a.readinessPct);
  assert.equal(b.fatigueLoad, a.fatigueLoad);

  const lateSaratov = doneWorkout("2026-11-26", "bench", 5);
  lateSaratov.timeZone = "Europe/Saratov";
  lateSaratov.createdAt = "2026-11-26T19:30:00Z";
  const saratovNow = new Date("2026-11-26T20:15:00Z");
  const saratovChest = MuscleReadiness.fromWorkoutsV2([lateSaratov], "2026-11-27", "Europe/Saratov", saratovNow)
    .find((x) => x.id === "chest")!;
  assert.ok(saratovChest.readinessPct < 75, `45m elapsed should stay <75%, got ${saratovChest.readinessPct}`);
});

test("MuscleReadiness V2 supports midnight-crossing wearable endedAt, excludes future timestamps, and honors 240h across DST", () => {
  const wearableSession = doneWorkout("2026-11-26", "bench", 5);
  wearableSession.createdAt = "2026-11-27T08:00:00Z";
  wearableSession.wearable = {
    provider: "apple-health",
    sourceName: "Apple Watch",
    activityType: "HKWorkoutActivityTypeTraditionalStrengthTraining",
    startedAt: "2026-11-26T23:30:00Z",
    endedAt: "2026-11-27T00:30:00Z",
    importedAt: "2026-11-27T08:00:00Z",
    heartRateSamples: 10,
  };
  const wearableChest = MuscleReadiness.fromWorkoutsV2(
    [wearableSession],
    "2026-11-27",
    "UTC",
    new Date("2026-11-27T01:30:00Z"),
  ).find((x) => x.id === "chest")!;
  assert.ok(wearableChest.readinessPct < 75, `1h after wearable end should be <75%, got ${wearableChest.readinessPct}`);

  const futureSameDay = doneWorkout("2026-11-26", "bench", 5);
  futureSameDay.createdAt = "2026-11-26T18:00:00Z";
  const beforeFuture = MuscleReadiness.fromWorkoutsV2(
    [futureSameDay],
    "2026-11-26",
    "UTC",
    new Date("2026-11-26T10:00:00Z"),
  ).find((x) => x.id === "chest")!;
  assert.equal(beforeFuture.hasRecentLoad, false);
  assert.equal(beforeFuture.directSets10d, 0);

  const dstSession = doneWorkout("2026-02-26", "bench", 5);
  dstSession.timeZone = "America/New_York";
  dstSession.createdAt = "2026-02-27T04:59:59Z"; // 2026-02-26 23:59:59 EST
  const dstNow = new Date("2026-03-09T04:00:00Z"); // 2026-03-09 00:00:00 EDT (239.00028h elapsed)
  const dstChest = MuscleReadiness.fromWorkoutsV2(
    [dstSession],
    "2026-03-09",
    "America/New_York",
    dstNow,
  ).find((x) => x.id === "chest")!;
  assert.equal(dstChest.hasRecentLoad, true);
  assert.equal(dstChest.directSets10d, 5);
});
