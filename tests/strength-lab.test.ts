import test from "node:test";
import assert from "node:assert/strict";
import { StrengthForecast } from "../src/domain/StrengthForecast";
import { WeakLinkAnalyzer } from "../src/domain/WeakLinkAnalyzer";
import { makeWorkout } from "../src/lib/model";
import type { Workout } from "../src/lib/types";

function makeSession(
  id: string,
  date: string,
  items: Array<{ exerciseId: string; weight: number; reps: number; rir?: number | null }>,
): Workout {
  const w = makeWorkout(
    items.map((x) => x.exerciseId),
    [],
    "UTC",
  );
  w.id = id;
  w.date = date;
  w.exercises.forEach((ex, idx) => {
    const src = items[idx];
    ex.sets = [
      {
        id: `${id}-${idx}-0`,
        weight: src.weight,
        reps: src.reps,
        rir: src.rir ?? 1,
        warmup: false,
        done: true,
      },
    ];
  });
  return w;
}

test("StrengthForecast computes official DOTS, Wilks, tiers, and long-lever adjustment", () => {
  // Reference check: 500 kg total @ 83 kg male ≈ 334.7 DOTS
  const dotsMale = StrengthForecast.computeDots(500, 83, "male");
  assert.ok(dotsMale !== null && dotsMale > 330 && dotsMale < 340, `Expected ~335 DOTS, got ${dotsMale}`);

  const dotsFemale = StrengthForecast.computeDots(350, 63, "female");
  assert.ok(dotsFemale !== null && dotsFemale > 365 && dotsFemale < 385, `Expected ~375 DOTS, got ${dotsFemale}`);

  const wilksMale = StrengthForecast.computeWilks(500, 83, "male");
  assert.ok(wilksMale !== null && wilksMale > 325 && wilksMale < 345, `Expected ~334 Wilks, got ${wilksMale}`);

  const tier = StrengthForecast.classifyTier(335);
  assert.equal(tier?.id, "intermediate");
  assert.equal(tier?.nextLabel, "Продвинутый");
  assert.equal(tier?.dotsToNext, 5);

  const elite = StrengthForecast.classifyTier(490);
  assert.equal(elite?.id, "elite");
  assert.equal(elite?.nextDots, null);

  assert.equal(StrengthForecast.computeDots(0, 80), null);
  assert.equal(StrengthForecast.computeDots(400, null), null);
});

test("StrengthForecast projects realistic ETA, 9-week e1RM, plateau, and achieved milestones", () => {
  const today = "2026-11-27";
  const now = new Date(`${today}T12:00:00Z`);

  // Steady bench growth (~1.5 kg/week over 6 weeks) + flat squat (plateau)
  const workouts: Workout[] = [
    makeSession("w1", "2026-10-16", [
      { exerciseId: "bench", weight: 70, reps: 5, rir: 1 },
      { exerciseId: "squat", weight: 110, reps: 5, rir: 1 },
      { exerciseId: "deadlift-bar", weight: 140, reps: 5, rir: 1 },
    ]),
    makeSession("w2", "2026-10-30", [
      { exerciseId: "bench", weight: 72.5, reps: 5, rir: 1 },
      { exerciseId: "squat", weight: 110, reps: 5, rir: 1 },
    ]),
    makeSession("w3", "2026-11-13", [
      { exerciseId: "bench", weight: 75, reps: 5, rir: 1 },
      { exerciseId: "squat", weight: 110, reps: 5, rir: 1 },
    ]),
    makeSession("w4", "2026-11-27", [
      { exerciseId: "bench", weight: 77.5, reps: 5, rir: 1 },
      { exerciseId: "squat", weight: 110, reps: 5, rir: 1 },
    ]),
  ];

  const report = new StrengthForecast(workouts, {
    today,
    now,
    timeZone: "UTC",
    bodyMassKg: 82,
    longLevers: true,
  }).build({ bench: 105, squat: 150 });

  assert.ok(report.dots.dots !== null && report.dots.dots > 200);
  assert.ok(
    report.dots.adjustedDots !== null && report.dots.adjustedDots > report.dots.dots!,
    "longLevers should apply +4% adjusted DOTS",
  );

  // Bench should be on_track with positive weekly rate and projected ETA
  const bench = report.lifts.bench;
  assert.equal(bench.status, "on_track");
  assert.ok(bench.weeklyRateKg !== null && bench.weeklyRateKg > 1.0);
  assert.ok(bench.etaWeeks !== null && bench.etaWeeks >= 1 && bench.etaWeeks <= 20);
  assert.ok(bench.etaDate !== null && bench.etaDate > today);
  assert.ok(bench.projected9WeeksKg !== null && bench.projected9WeeksKg > (bench.currentE1rm ?? 0));
  assert.equal(bench.projection.length, 3);

  // Squat has zero slope -> plateau
  assert.equal(report.lifts.squat.status, "plateau");
  assert.equal(report.lifts.squat.etaWeeks, null);

  // Deadlift has only 1 point -> insufficient_data
  assert.equal(report.lifts.deadlift.status, "insufficient_data");

  // Already-achieved target
  const achieved = new StrengthForecast(workouts, { today, now, timeZone: "UTC" }).build({ bench: 80 });
  assert.equal(achieved.lifts.bench.status, "achieved");
  assert.equal(achieved.lifts.bench.remainingKg, 0);
});

test("WeakLinkAnalyzer detects lagging horizontal pull and adapts corridors for long levers", () => {
  const today = "2026-11-27";
  const now = new Date(`${today}T12:00:00Z`);

  // Strong bench (100 kg e1RM), weak row (60 kg -> ratio 0.60 < 0.80), solid squat (125 kg) & deadlift (160 kg)
  const workouts: Workout[] = [
    makeSession("s1", "2026-11-20", [
      { exerciseId: "bench", weight: 100, reps: 1, rir: 0 },
      { exerciseId: "row", weight: 60, reps: 1, rir: 0 },
      { exerciseId: "ohp-bar", weight: 65, reps: 1, rir: 0 },
      { exerciseId: "pullup", weight: 0, reps: 8, rir: 1 }, // bodyweight 80 kg -> ~102 kg e1RM
      { exerciseId: "squat", weight: 125, reps: 1, rir: 0 },
      { exerciseId: "deadlift-bar", weight: 160, reps: 1, rir: 0 },
    ]),
  ];

  const standard = new WeakLinkAnalyzer(workouts, {
    today,
    now,
    timeZone: "UTC",
    bodyMassKg: 80,
    longLevers: false,
  }).build();

  assert.equal(standard.measuredAxes, 6);
  assert.ok(standard.symmetryScore !== null && standard.symmetryScore > 40 && standard.symmetryScore < 95);
  assert.equal(standard.primaryWeakLink?.id, "row_vs_bench");
  assert.equal(standard.primaryWeakLink?.status, "lagging");
  assert.equal(standard.primaryWeakLink?.ratio, 0.6);

  // Pullup uses bodyMassKg automatically
  assert.ok((standard.patterns.vpull.e1rmKg ?? 0) > 95);

  // Long levers lowers squat/bench min corridor (1.18 vs 1.25) and raises hinge/squat corridor
  const longLeverReport = new WeakLinkAnalyzer(workouts, {
    today,
    now,
    timeZone: "UTC",
    bodyMassKg: 80,
    longLevers: true,
  }).build();

  const stdSq = standard.axes.find((a) => a.id === "squat_vs_bench")!;
  const llSq = longLeverReport.axes.find((a) => a.id === "squat_vs_bench")!;
  assert.ok(llSq.targetMin < stdSq.targetMin);

  const stdHinge = standard.axes.find((a) => a.id === "hinge_vs_squat")!;
  const llHinge = longLeverReport.axes.find((a) => a.id === "hinge_vs_squat")!;
  assert.ok(llHinge.targetIdeal > stdHinge.targetIdeal);
});

test("WeakLinkAnalyzer handles empty history gracefully", () => {
  const report = new WeakLinkAnalyzer([], { today: "2026-11-27", timeZone: "UTC" }).build();
  assert.equal(report.measuredAxes, 0);
  assert.equal(report.symmetryScore, null);
  assert.equal(report.primaryWeakLink, null);
  assert.equal(report.axes.every((a) => a.status === "missing"), true);
});
