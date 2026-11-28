import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MuscleReadiness } from "../src/domain/MuscleReadiness";
import { WorkoutPreview } from "../src/domain/WorkoutPreview";
import WorkoutPreviewCard from "../src/components/WorkoutPreviewCard";
import SessionInsights from "../src/components/SessionInsights";
import { DEFAULT_SETTINGS, makeWorkout } from "../src/lib/model";
import type { Workout } from "../src/lib/types";

function makeSession(
  id: string,
  date: string,
  entries: Array<{ exerciseId: string; sets: number; weight: number; reps: number; rir?: number | null }>,
  done = true,
): Workout {
  const w = makeWorkout(
    entries.map((e) => e.exerciseId),
    [],
    "UTC",
  );
  w.id = id;
  w.date = date;
  w.exercises = w.exercises.map((ex, i) => ({
    ...ex,
    sets: Array.from({ length: entries[i].sets }, (_, si) => ({
      id: `${id}-${i}-${si}`,
      weight: entries[i].weight,
      reps: entries[i].reps,
      rir: entries[i].rir ?? 2,
      warmup: false,
      done,
    })),
  }));
  return w;
}

test("WorkoutPreview computes target muscles, before->after weekly volume, EWMA forecast, and tonnage analogy", () => {
  const today = "2026-11-27";
  const history = [
    makeSession("h-1", "2026-11-24", [
      { exerciseId: "lat-pulldown", sets: 6, weight: 65, reps: 10, rir: 2 },
      { exerciseId: "curl-bar", sets: 4, weight: 30, reps: 10, rir: 2 },
    ]),
  ];

  const planned = makeSession(
    "plan-pull2",
    today,
    [
      { exerciseId: "row-chest-supported", sets: 4, weight: 70, reps: 10 },
      { exerciseId: "lat-pulldown", sets: 4, weight: 65, reps: 10 },
      { exerciseId: "rear-delt-fly", sets: 4, weight: 10, reps: 15 },
      { exerciseId: "curl-bar", sets: 4, weight: 30, reps: 10 },
    ],
    false,
  );

  const res = WorkoutPreview.analyze(planned, history, today, "UTC");

  assert.equal(res.workingSets, 16);
  assert.equal(res.exerciseCount, 4);
  assert.ok(res.estMinutes >= 40);
  assert.ok(res.estKcal > 150);
  assert.ok(res.estimatedTonnageKg > 6000);
  assert.ok(res.tonnageComparison !== null);

  const back = res.muscles.find((m) => m.muscle === "back");
  assert.ok(back, "back must be in target muscles");
  assert.equal(back.role, "primary");
  assert.equal(back.beforeSets, 6);
  assert.equal(back.directAdded, 8);
  assert.equal(back.indirectAdded, 4);
  assert.equal(back.addedSets, 10);
  assert.equal(back.afterSets, 16);
  assert.ok(res.bodyMap.back?.level === "primary");

  assert.ok(res.axialAfterPct >= res.axialBeforePct);
  assert.ok(res.localAfterPct > res.localBeforePct);
});

test("WorkoutPreview marks empty history as no readiness data instead of certifying fresh muscles", () => {
  const planned = makeSession("plan-empty", "2026-11-27", [{ exerciseId: "bench", sets: 4, weight: 80, reps: 8 }], false);
  const res = WorkoutPreview.analyze(planned, [], "2026-11-27", "UTC", { now: new Date("2026-11-27T12:00:00Z") });
  assert.equal(res.hasTargetReadinessData, false);
  assert.equal(res.muscles.find((m) => m.muscle === "chest")?.hasReadinessData, false);

  const markup = renderToStaticMarkup(createElement(WorkoutPreviewCard, {
    planned,
    history: [],
    today: "2026-11-27",
    timeZone: "UTC",
  }));
  assert.match(markup, /нет данных/i);
  assert.doesNotMatch(markup, /Целевые свежие · 100%/);
});

test("WorkoutPreview matches live MuscleReadiness clock and evaluates only targeted deltoid subgroups", () => {
  const benchDone = makeSession("h-bench", "2026-11-26", [{ exerciseId: "bench", sets: 5, weight: 80, reps: 8, rir: 2 }]);
  benchDone.timeZone = "Europe/Saratov";
  benchDone.createdAt = "2026-11-26T19:30:00Z";
  const now = new Date("2026-11-26T20:15:00Z");

  const plannedBench = makeSession("plan-bench", "2026-11-27", [{ exerciseId: "bench", sets: 4, weight: 80, reps: 8 }], false);
  const preview = WorkoutPreview.analyze(plannedBench, [benchDone], "2026-11-27", "Europe/Saratov", { now });
  const liveChest = MuscleReadiness.fromWorkoutsV2([benchDone], "2026-11-27", "Europe/Saratov", now)
    .find((g) => g.id === "chest")!;
  assert.equal(preview.muscles.find((m) => m.muscle === "chest")?.readinessPct, liveChest.readinessPct);

  const frontDeltHeavy = makeSession("h-dip-front", "2026-11-27", [{ exerciseId: "dip-weighted", sets: 10, weight: 20, reps: 8, rir: 0 }]);
  frontDeltHeavy.createdAt = "2026-11-27T11:00:00Z";
  const plannedRear = makeSession("plan-rear", "2026-11-27", [{ exerciseId: "rear-delt-fly", sets: 4, weight: 10, reps: 15 }], false);
  const rearPreview = WorkoutPreview.analyze(plannedRear, [frontDeltHeavy], "2026-11-27", "UTC", {
    now: new Date("2026-11-27T12:00:00Z"),
  });
  assert.equal(rearPreview.lowestTargetReadiness, null);

  const erectorHeavy = makeSession("h-rdl", "2026-11-27", [{ exerciseId: "rdl", sets: 6, weight: 100, reps: 8, rir: 0 }]);
  erectorHeavy.createdAt = "2026-11-27T11:00:00Z";
  const plannedLats = makeSession("plan-lats", "2026-11-27", [{ exerciseId: "lat-pulldown", sets: 4, weight: 60, reps: 10 }], false);
  const latsPreview = WorkoutPreview.analyze(plannedLats, [erectorHeavy], "2026-11-27", "UTC", {
    now: new Date("2026-11-27T12:00:00Z"),
  });
  assert.equal(latsPreview.lowestTargetReadiness, null);
});

test("SessionInsights includes the displayed workout when absent from allWorkouts and attributes recovery only to affected groups", () => {
  const bench = makeSession("w-bench", "2026-11-26", [{ exerciseId: "bench", sets: 6, weight: 80, reps: 8, rir: 0 }]);
  const squat = makeSession("w-squat", "2026-11-26", [{ exerciseId: "squat", sets: 1, weight: 100, reps: 5, rir: 2 }]);

  const squatMarkup = renderToStaticMarkup(createElement(SessionInsights, {
    workout: squat,
    settings: { ...DEFAULT_SETTINGS, timeZone: "UTC" },
    allWorkouts: [bench, squat],
  }));
  assert.doesNotMatch(squatMarkup, /грудь/i);

  const justSavedMarkup = renderToStaticMarkup(createElement(SessionInsights, {
    workout: bench,
    settings: { ...DEFAULT_SETTINGS, timeZone: "UTC" },
    allWorkouts: [squat],
  }));
  assert.match(justSavedMarkup, /грудь/i);
});
