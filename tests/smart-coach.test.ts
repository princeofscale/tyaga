import test from "node:test";
import assert from "node:assert/strict";
import { SmartCoach } from "../src/domain/SmartCoach";
import { LaidDupPlan } from "../src/domain/LaidDupPlan";
import { makeWorkout } from "../src/lib/model";
import type { Workout } from "../src/lib/types";

function session(
  id: string,
  date: string,
  exerciseId: string,
  sets: Array<{ weight: number; reps: number; rir: number | null }>,
): Workout {
  const w = makeWorkout([exerciseId], [], "UTC");
  w.id = id;
  w.date = date;
  w.exercises[0].sets = sets.map((s, i) => ({
    id: `${id}-s-${i}`,
    weight: s.weight,
    reps: s.reps,
    rir: s.rir,
    warmup: false,
    done: true,
  }));
  return w;
}

test("SmartCoach detects overload (high ACWR, >20 sets/muscle, failure overload) accurately", () => {
  // Baseline: 1 light session per week in prior 3 weeks (6 sets/wk), then massive 30-set failure spike this week
  const workouts: Workout[] = [
    session("w-old-1", "2026-11-01", "bench", Array.from({ length: 6 }, () => ({ weight: 80, reps: 8, rir: 2 }))),
    session("w-old-2", "2026-11-08", "bench", Array.from({ length: 6 }, () => ({ weight: 80, reps: 8, rir: 2 }))),
    session("w-old-3", "2026-11-15", "bench", Array.from({ length: 6 }, () => ({ weight: 80, reps: 8, rir: 2 }))),
    session("w-now-1", "2026-11-19", "bench", Array.from({ length: 12 }, () => ({ weight: 85, reps: 8, rir: 0 }))),
    session("w-now-2", "2026-11-21", "bench", Array.from({ length: 12 }, () => ({ weight: 85, reps: 8, rir: 0 }))),
  ];

  const report = SmartCoach.analyze(workouts, [], "2026-11-22", "UTC", new Date("2026-11-22T12:00:00Z"));
  assert.equal(report.status, "overloaded");
  assert.ok(report.acwr !== null && report.acwr > 1.45);
  assert.ok(report.overloadedMuscles.some((m) => m.muscle === "chest" && m.sets === 24));
  assert.ok(report.insights.some((i) => i.id === "acwr-overload"));
  assert.ok(report.insights.some((i) => i.id === "muscle-overload"));
  assert.ok(report.insights.some((i) => i.id === "coach-failure"));
  assert.equal(report.nextSession.recommendedRir, "RIR 3–4");
});

test("SmartCoach detects underload when weekly volume drops sharply below chronic baseline", () => {
  const workouts: Workout[] = [
    session("u-1", "2026-10-28", "squat", Array.from({ length: 14 }, () => ({ weight: 100, reps: 6, rir: 2 }))),
    session("u-2", "2026-11-04", "squat", Array.from({ length: 14 }, () => ({ weight: 100, reps: 6, rir: 2 }))),
    session("u-3", "2026-11-11", "squat", Array.from({ length: 14 }, () => ({ weight: 100, reps: 6, rir: 2 }))),
    session("u-4", "2026-11-20", "squat", Array.from({ length: 4 }, () => ({ weight: 90, reps: 6, rir: 5 }))),
  ];

  const report = SmartCoach.analyze(workouts, [], "2026-11-22", "UTC", new Date("2026-11-22T12:00:00Z"));
  assert.equal(report.status, "underloaded");
  assert.ok(report.acwr !== null && report.acwr < 0.7);
  assert.ok(report.insights.some((i) => i.id === "acwr-underload"));
});

test("SmartCoach detects rising strength trend and audits active David Laid DUP cycle", () => {
  const workouts: Workout[] = [
    session("p-1", "2026-10-15", "bench", [{ weight: 80, reps: 8, rir: 2 }]),
    session("p-2", "2026-10-25", "bench", [{ weight: 82.5, reps: 8, rir: 2 }]),
    session("p-3", "2026-11-12", "bench", [{ weight: 90, reps: 8, rir: 2 }]),
    session("p-4", "2026-11-19", "lat-pulldown", Array.from({ length: 6 }, () => ({ weight: 60, reps: 10, rir: 2 }))),
    session("p-5", "2026-11-20", "squat", Array.from({ length: 6 }, () => ({ weight: 100, reps: 6, rir: 2 }))),
  ];
  const laid = LaidDupPlan.routines({
    maxes: { squat: 120, bench: 100, deadlift: 150, ohp: 65 },
    extras: true,
    light: false,
    startMonday: "2026-11-09",
  });

  const report = SmartCoach.analyze(workouts, laid, "2026-11-22", "UTC", new Date("2026-11-22T12:00:00Z"));
  assert.ok(report.liftTrends.some((t) => t.exerciseId === "bench" && t.status === "rising"));
  assert.ok(report.insights.some((i) => i.id === "strength-rising"));
  assert.ok(report.laidAudit !== null);
  assert.ok(report.score >= 60);
});

test("SmartCoach handles empty history cleanly without NaN or fake scores", () => {
  const report = SmartCoach.analyze([], [], "2026-11-22", "UTC", new Date("2026-11-22T12:00:00Z"));
  assert.equal(report.status, "no_data");
  assert.equal(report.score, 0);
  assert.equal(report.acwr, null);
  assert.equal(report.insights.length, 0);
});
