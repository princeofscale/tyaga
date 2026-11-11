import test from "node:test";
import assert from "node:assert/strict";
import { WorkoutUndo } from "../src/domain/WorkoutUndo";
import { ProgressOverview } from "../src/domain/ProgressOverview";
import { FriendsService } from "../src/domain/FriendsService";
import { ProgressSeries } from "../src/domain/ProgressSeries";
import { TrainingMeetups } from "../src/domain/TrainingMeetups";
import { newDraft, parseDraft } from "../src/lib/draft";
import { makeWorkout } from "../src/lib/model";

test("undo restores exactly the removed set while retaining newer edits, and survives draft reload", () => {
  let d = newDraft(makeWorkout(["bench", "squat"], [], "UTC"));
  const removed = d.workout.exercises[0].sets.at(-1)!;
  removed.weight = 90;
  d = WorkoutUndo.set(d, 0);
  d.workout.name = "edited afterwards";
  d.workout.exercises[0].sets[0].weight = 75;
  const parsed = parseDraft(JSON.stringify(d))!;
  const restored = WorkoutUndo.restore(parsed);
  assert.equal(restored.workout.exercises[0].sets.at(-1)?.weight, 90);
  assert.equal(restored.workout.exercises[0].sets[0].weight, 75);
  assert.equal(restored.workout.name, "edited afterwards");
  const deleted = WorkoutUndo.exercise(restored, 0);
  assert.equal(
    WorkoutUndo.restore(deleted).workout.exercises[0].sets.at(-1)?.id,
    removed.id,
  );
});

test("overview compares equal windows and leaves strength unknown without a baseline", () => {
  const now = new Date("2026-11-11T12:00:00Z"),
    w = makeWorkout(["bench"], [], "UTC");
  w.date = "2026-11-10";
  w.exercises[0].sets[0].done = true;
  const one = ProgressOverview.calculate([w], 28, "UTC", now);
  assert.equal(one.workouts, 1);
  assert.equal(one.strengthChange, null);
  assert.equal(one.workloadChange, null);
  const prior = structuredClone(w);
  prior.id = "prior";
  prior.date = "2026-10-01";
  prior.exercises[0].sets[0].weight = 20;
  w.exercises[0].sets[0].weight = 40;
  const compared = ProgressOverview.calculate([w, prior], 28, "UTC", now);
  assert.equal(compared.comparedLifts, 1);
  assert.equal(compared.strengthChange, 100);
  assert.equal(compared.workloadChange, 0);
});

test("personal weekly targets cap each teammate's contribution", () => {
  const person = (id: string, target: number, done: number) => ({
    id,
    displayName: id,
    gym: "",
    focus: "",
    activeUntil: 0,
    weekWorkouts: done,
    weeklyTarget: target,
  });
  assert.deepEqual(
    FriendsService.teamProgress([person("a", 2, 8), person("b", 4, 1)]),
    { done: 3, target: 6, percent: 50 },
  );
});

test("measurement polyline passes through every weighing dot; EMA has its own path", () => {
  const g = ProgressSeries.geometry(
    [
      { id: "a", date: "2026-11-01", value: 60, trend: 60 },
      { id: "b", date: "2026-11-10", value: 62, trend: 60.5 },
    ],
    600,
  );
  assert.ok(g.path().endsWith(`${g.coords[1].x},${g.coords[1].y}`));
  assert.notEqual(g.path(), g.path(true));
  assert.equal(TrainingMeetups.summary([]).finished, 0);
});
