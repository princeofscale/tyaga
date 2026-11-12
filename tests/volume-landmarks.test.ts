import test from "node:test";
import assert from "node:assert/strict";
import { VolumeLandmarksCalculator as Volume } from "../src/domain/VolumeLandmarks";
import { makeWorkout, muscleLoad } from "../src/lib/model";

function workout(id = "lat-pulldown", date = "2026-11-12") {
  const w = makeWorkout([id]);
  w.date = date;
  w.exercises[0].sets = Array.from({ length: 4 }, (_, i) => ({
    id: `s-${i}`, weight: 60, reps: 10, rir: 2, done: true, warmup: false,
  }));
  return w;
}

test("volume reference describes recorded volume without promising growth or diagnosing overtraining", () => {
  assert.equal(Volume.assessMuscleVolume("chest", 0).status, "no_sets");
  assert.equal(Volume.assessMuscleVolume("chest", 4).status, "below_reference");
  assert.equal(Volume.assessMuscleVolume("chest", 9.5).status, "below_reference");
  assert.equal(Volume.assessMuscleVolume("chest", 10).status, "within_reference");
  assert.equal(Volume.assessMuscleVolume("chest", 20).status, "within_reference");
  assert.equal(Volume.assessMuscleVolume("chest", 20.5).status, "above_reference");
  assert.match(Volume.assessMuscleVolume("chest", 4).recommendation, /Рост возможен/);
  assert.match(Volume.assessMuscleVolume("chest", 40).recommendation, /не определяет перетренированность/);
});

test("fractional volume includes pulling assistance once per zone, but excludes stabilization", () => {
  const loads = muscleLoad([workout()]);
  const rows = Volume.assessWeeklyLoads(loads);
  const biceps = rows.find((m) => m.muscle === "biceps")!;
  assert.equal(biceps.directSets, 0);
  assert.equal(biceps.indirectSets, 4);
  assert.equal(biceps.actualSets, 2); // three elbow flexors are not three sets
  const squat = Volume.assessWeeklyLoads(muscleLoad([workout("squat")]));
  assert.equal(squat.find((m) => m.muscle === "core")!.actualSets, 0);
  assert.equal(squat.find((m) => m.muscle === "hamstrings")!.actualSets, 0);
});

test("seven-day volume includes both date boundaries and excludes older and future work", () => {
  const report = Volume.assessWeek([
    workout("bench", "2026-11-05"),
    workout("bench", "2026-11-06"),
    workout("bench", "2026-11-12"),
    workout("bench", "2026-11-13"),
  ], "2026-11-12");
  assert.equal(report.startDate, "2026-11-06");
  assert.equal(report.workingSets, 8);
  assert.equal(report.assessments.find((m) => m.muscle === "chest")!.actualSets, 8);
});

test("volume separates missing RIR from known close-to-failure work; warmups and undone sets never count", () => {
  const w = workout();
  const base = w.exercises[0].sets[0];
  w.exercises[0].sets = [
    { ...base, rir: 0 }, { ...base, rir: 3 }, { ...base, rir: 4 }, { ...base, rir: null },
    { ...base, warmup: true }, { ...base, done: false },
  ];
  const report = Volume.assessWeek([w], w.date);
  assert.equal(report.workingSets, 4);
  assert.equal(report.unknownRirSets, 1);
  const back = report.assessments.find((m) => m.muscle === "back")!;
  const biceps = report.assessments.find((m) => m.muscle === "biceps")!;
  assert.equal(back.actualSets, 4);
  assert.equal(back.knownHardSets, 2);
  assert.equal(biceps.actualSets, 2);
  assert.equal(biceps.knownHardSets, 1);
});

test("rolling week crosses month/year boundaries and empty history stays empty", () => {
  const report = Volume.assessWeek([], "2027-01-03");
  assert.equal(report.startDate, "2026-12-28");
  assert.equal(report.workingSets, 0);
  assert.ok(report.assessments.every((r) => r.status === "no_sets" && r.progressPercent === 0));
});

test("invalid counts cannot produce NaN or negative progress", () => {
  for (const value of [NaN, Infinity, -1])
    assert.throws(() => Volume.assessMuscleVolume("chest", value), RangeError);
});
