import test from "node:test";
import assert from "node:assert/strict";
import { WorkoutPreview } from "../src/domain/WorkoutPreview";
import { makeWorkout } from "../src/lib/model";
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
