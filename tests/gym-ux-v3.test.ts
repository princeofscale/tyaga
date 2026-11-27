import test from "node:test";
import assert from "node:assert/strict";
import { SmartRestPlanner } from "../src/domain/SmartRestPlanner";
import { LivePrDetector } from "../src/domain/LivePrDetector";
import { HistoryHeatmap } from "../src/domain/HistoryHeatmap";
import { SupplementsStore } from "../src/domain/Supplements";
import { exerciseById, makeWorkout } from "../src/lib/model";
import type { Workout } from "../src/lib/types";

function makeDone(
  id: string,
  date: string,
  exerciseId: string,
  sets: Array<{ weight: number; reps: number; rir: number | null; warmup?: boolean }>,
): Workout {
  const w = makeWorkout([exerciseId], [], "UTC");
  w.id = id;
  w.date = date;
  w.exercises[0].sets = sets.map((s, i) => ({
    id: `${id}-${i}`,
    weight: s.weight,
    reps: s.reps,
    rir: s.rir,
    warmup: Boolean(s.warmup),
    done: true,
  }));
  return w;
}

test("SmartRestPlanner adapts rest duration to movement class, strength reps, warmups, and deload", () => {
  const planner = new SmartRestPlanner({ fallbackSeconds: 120, inDeload: false });

  const squat = exerciseById("squat")!;
  const bench = exerciseById("bench")!;
  const pulldown = exerciseById("lat-pulldown")!;
  const lateral = exerciseById("lateral-cable-single")!;

  assert.equal(planner.recommend(squat, { reps: 3, warmup: false }).seconds, 210);
  assert.equal(planner.recommend(squat, { reps: 8, warmup: false }).seconds, 180);
  assert.equal(planner.recommend(bench, { reps: 8, warmup: false }).seconds, 120);
  assert.equal(planner.recommend(pulldown, { reps: 10, warmup: false }).seconds, 90);
  assert.equal(planner.recommend(lateral, { reps: 15, warmup: false }).seconds, 75);
  assert.equal(planner.recommend(squat, { reps: 5, warmup: true }).seconds, 60);

  const deloadPlanner = new SmartRestPlanner({ fallbackSeconds: 120, inDeload: true });
  assert.equal(deloadPlanner.recommend(squat, { reps: 5, warmup: false }).seconds, 120);
  assert.equal(deloadPlanner.recommend(lateral, { reps: 12, warmup: false }).seconds, 60);
});

test("LivePrDetector detects genuine new e1RM PRs while ignoring first-ever history, warmups, and deloads", () => {
  const history = [
    makeDone("h1", "2026-11-10", "bench", [{ weight: 80, reps: 8, rir: 2 }]), // e1RM = 101.3
  ];
  const detector = new LivePrDetector(history, "current");

  const current = makeDone("current", "2026-11-27", "bench", [
    { weight: 80, reps: 8, rir: 2 }, // equal -> not PR
    { weight: 85, reps: 8, rir: 1 }, // e1RM = 107.7 -> PR!
    { weight: 90, reps: 5, rir: 2, warmup: true }, // warmup -> ignored
  ]);

  assert.equal(detector.checkSet(current.exercises[0], current.exercises[0].sets[0]), null);
  const hit = detector.checkSet(current.exercises[0], current.exercises[0].sets[1]);
  assert.ok(hit !== null);
  assert.equal(hit.e1rm, 107.7);
  assert.equal(hit.previousBest, 101.3);
  assert.equal(detector.checkSet(current.exercises[0], current.exercises[0].sets[2]), null);

  // Exercise with no prior history should not spam fake PRs
  const brandNew = makeDone("current", "2026-11-27", "squat", [{ weight: 100, reps: 5, rir: 2 }]);
  assert.equal(detector.checkSet(brandNew.exercises[0], brandNew.exercises[0].sets[0]), null);
});

test("HistoryHeatmap builds 16-week grid and week-over-week comparison accurately", () => {
  const today = "2026-11-27";
  const workouts = [
    makeDone("prev-1", "2026-11-16", "bench", Array.from({ length: 8 }, () => ({ weight: 80, reps: 8, rir: 2 }))),
    makeDone("cur-1", "2026-11-24", "bench", Array.from({ length: 12 }, () => ({ weight: 85, reps: 8, rir: 1 }))),
  ];

  const data = new HistoryHeatmap(workouts, today, { timeZone: "UTC", weeksCount: 16 }).build();
  assert.equal(data.weeks.length, 16);
  assert.equal(data.weeks[0].length, 7);
  assert.equal(data.activeDays, 2);
  assert.equal(data.comparison.current.workingSets, 12);
  assert.equal(data.comparison.previous.workingSets, 8);
  assert.equal(data.comparison.setsDelta, 4);
  assert.ok(data.comparison.tonnageDeltaPct !== null && data.comparison.tonnageDeltaPct > 0);
  assert.equal(data.comparison.current.avgRir, 1);
  assert.equal(data.comparison.previous.avgRir, 2);
});

test("SupplementsStore.applyEvidenceStack adds 5 Tier-A supplements without duplicates", () => {
  const empty = SupplementsStore.empty();
  const first = SupplementsStore.applyEvidenceStack(empty);
  assert.equal(first.addedCount, 5);
  assert.equal(first.nextState.stack.length, 5);

  const second = SupplementsStore.applyEvidenceStack(first.nextState);
  assert.equal(second.addedCount, 0);
  assert.equal(second.nextState.stack.length, 5);
});
