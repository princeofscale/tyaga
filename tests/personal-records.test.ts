import test from "node:test";
import assert from "node:assert/strict";
import { PersonalRecordsCalculator } from "../src/domain/PersonalRecords";
import { makeWorkout, type Workout } from "../src/lib/model";

test("PersonalRecordsCalculator computes best weight, 1RM and set volume", () => {
  const w1 = makeWorkout(["bench"], [], "UTC");
  w1.id = "w1";
  w1.date = "2026-10-01";
  w1.name = "Грудь 1";
  w1.exercises[0].sets = [
    { id: "s1", weight: 60, reps: 10, done: true, warmup: true, rir: null },
    { id: "s2", weight: 80, reps: 8, done: true, warmup: false, rir: 2 },
    { id: "s3", weight: 90, reps: 5, done: true, warmup: false, rir: 1 },
  ];

  const w2 = makeWorkout(["bench"], [], "UTC");
  w2.id = "w2";
  w2.date = "2026-10-08";
  w2.name = "Грудь 2";
  w2.exercises[0].sets = [
    { id: "s4", weight: 95, reps: 4, done: true, warmup: false, rir: 0 },
    { id: "s5", weight: 70, reps: 12, done: true, warmup: false, rir: 1 },
  ];

  const calc = new PersonalRecordsCalculator([w1, w2]);
  const records = calc.calculateRecords();

  assert.equal(records.length, 1);
  const benchPr = records[0];

  assert.equal(benchPr.bestWeight.weight, 95);
  assert.equal(benchPr.bestWeight.reps, 4);
  assert.equal(benchPr.bestWeight.date, "2026-10-08");

  // 95 * (1 + 4/30) = 95 * 1.1333 = 107.7
  assert.ok(benchPr.bestE1rm !== null);
  assert.equal(benchPr.bestE1rm.weight, 95);
  assert.equal(benchPr.bestE1rm.reps, 4);
  assert.ok(benchPr.bestE1rm.e1rm >= 107 && benchPr.bestE1rm.e1rm <= 108);

  // Set volume: 70 * 12 = 840 vs 95 * 4 = 380 vs 80 * 8 = 640 vs 90 * 5 = 450
  assert.equal(benchPr.bestSetVolume.volume, 840);
  assert.equal(benchPr.bestSetVolume.weight, 70);
  assert.equal(benchPr.bestSetVolume.reps, 12);
});

test("PersonalRecordsCalculator computes streaks and heatmap", () => {
  const w1 = makeWorkout(["bench"], [], "UTC");
  w1.id = "w1";
  w1.date = "2026-10-05"; // Monday
  w1.exercises[0].sets[0].done = true;

  const w2 = makeWorkout(["bench"], [], "UTC");
  w2.id = "w2";
  w2.date = "2026-10-12"; // Next Monday
  w2.exercises[0].sets[0].done = true;

  const calc = new PersonalRecordsCalculator([w1, w2]);
  const streak = calc.calculateStreak("UTC");
  assert.ok(streak.totalWeeks >= 2);
  assert.ok(streak.bestWeekStreak >= 2);

  const heatmap = calc.calculateHeatmap(12, "UTC");
  assert.equal(heatmap.length, 12 * 7);
  assert.ok(heatmap.some((d) => d.workingSets > 0));
});

test("PersonalRecordsCalculator computes Push/Pull and Upper/Lower ratios", () => {
  const w1 = makeWorkout(["bench", "lat-pulldown", "squat"], [], "UTC");
  w1.id = "w1";
  w1.date = "2026-10-01";
  // 3 bench sets (push, upper)
  w1.exercises[0].sets.forEach((s) => (s.done = true));
  // 3 lat-pulldown sets (pull, upper)
  w1.exercises[1].sets.forEach((s) => (s.done = true));
  // 3 squat sets (lower)
  w1.exercises[2].sets.forEach((s) => (s.done = true));

  const calc = new PersonalRecordsCalculator([w1]);
  const ratios = calc.calculateRatios();

  assert.equal(ratios.pushSets, 3);
  assert.equal(ratios.pullSets, 3);
  assert.equal(ratios.pushPullRatio, 1);
  assert.equal(ratios.pushPullStatus, "balanced");
  assert.equal(ratios.upperSets, 6);
  assert.equal(ratios.lowerSets, 3);
});

test("PersonalRecordsCalculator returns null ratio and 'no-data' status when there are 0 sets", () => {
  const calc = new PersonalRecordsCalculator([]);
  const ratios = calc.calculateRatios();

  assert.equal(ratios.pushSets, 0);
  assert.equal(ratios.pullSets, 0);
  assert.equal(ratios.pushPullRatio, null);
  assert.equal(ratios.pushPullStatus, "no-data");
  assert.equal(ratios.upperSets, 0);
  assert.equal(ratios.lowerSets, 0);
  assert.equal(ratios.upperLowerRatio, null);
  assert.equal(ratios.upperLowerStatus, "no-data");
});
