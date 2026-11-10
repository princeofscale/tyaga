import test from "node:test";
import assert from "node:assert/strict";
import { ProgressSeries } from "../src/domain/ProgressSeries";
import { PersonalRecordsCalculator } from "../src/domain/PersonalRecords";
import { EXERCISES, makeWorkout, progressKey } from "../src/lib/model";

test("chart uses calendar distance, includes trend in y bounds and centers a single point", () => {
  const points = [
    { id: "a", date: "2026-11-01", value: 61, trend: 60.8 },
    { id: "b", date: "2026-11-02", value: 62, trend: 61 },
    { id: "c", date: "2026-11-10", value: 61.5, trend: 61.2 },
  ];
  const g = ProgressSeries.geometry(points, 600);
  assert.ok(
    g.coords[1].x - g.coords[0].x < (g.coords[2].x - g.coords[1].x) / 7,
  );
  assert.ok(g.max < 63);
  assert.ok(g.min < 60.8);
  assert.ok(!g.path().includes("NaN"));
  const one = ProgressSeries.geometry(points.slice(0, 1), 320);
  assert.equal(one.coords[0].x, (one.left + one.right) / 2);
});

test("strength omits unfinished workouts and reports reps of the best completed set", () => {
  const w = makeWorkout(["bench"], [], "UTC");
  const key = progressKey(w.exercises[0]);
  assert.equal(ProgressSeries.strength([w], key).length, 0);
  w.exercises[0].sets = [
    { id: "a", done: true, warmup: false, weight: 80, reps: 5, rir: 2 },
    { id: "b", done: true, warmup: false, weight: 60, reps: 12, rir: 1 },
  ];
  const p = ProgressSeries.strength([w], key)[0];
  assert.equal(p.reps, 5);
  assert.equal(p.max, 80);
});

test("statistics count paired dumbbells and exclude warmups from volume", () => {
  const exercise = EXERCISES.find(
    (e) =>
      e.recording.loadMode === "per_implement" &&
      e.recording.implementCount === 2,
  )!;
  assert.ok(exercise);
  const w = makeWorkout([exercise.id], [], "UTC");
  w.exercises[0].sets = [
    { id: "work", weight: 20, reps: 8, rir: 2, done: true, warmup: false },
    { id: "warm", weight: 10, reps: 10, rir: 4, done: true, warmup: true },
  ];
  const calc = new PersonalRecordsCalculator([w]);
  assert.equal(calc.calculateRecords()[0].totalVolume, 320);
  assert.equal(calc.calculateRecords()[0].bestSetVolume.volume, 320);
  assert.equal(
    calc.calculateHeatmap(16, "UTC").find((d) => d.date === w.date)
      ?.totalVolume,
    320,
  );
});

test("assisted movement chooses less assistance and bodyweight movement reports repetitions", () => {
  for (const mode of ["assisted_bodyweight", "bodyweight"] as const) {
    const ex = EXERCISES.find(
      (e) => e.recording.loadMode === mode && e.recording.type !== "duration",
    )!;
    assert.ok(ex);
    const w = makeWorkout([ex.id], [], "UTC");
    w.exercises[0].sets = [
      {
        id: "a",
        weight: 0,
        assistanceKg: 40,
        reps: 8,
        done: true,
        warmup: false,
        rir: 2,
      },
      {
        id: "b",
        weight: 0,
        assistanceKg: 20,
        reps: 10,
        done: true,
        warmup: false,
        rir: 2,
      },
    ];
    const best = ProgressSeries.strength([w], progressKey(w.exercises[0]))[0];
    assert.equal(best.max, mode === "assisted_bodyweight" ? 20 : 10);
    assert.equal(
      new PersonalRecordsCalculator([w]).calculateRecords()[0].bestWeight
        .weight,
      best.max,
    );
  }
});

test("no previous volume is not reported as a 100 percent gain", () => {
  const w = makeWorkout(["bench"], [], "UTC");
  w.exercises[0].sets[0].done = true;
  assert.equal(
    new PersonalRecordsCalculator([w]).calculateVolumeTrends("UTC").growthPct,
    0,
  );
});
