import test from "node:test";
import assert from "node:assert/strict";
import { StrengthTotal } from "../src/domain/StrengthTotal";
import { makeWorkout } from "../src/lib/model";
import type { Workout } from "../src/lib/types";

function done(date: string, items: [id: string, weight: number, reps: number][]): Workout {
  const w = makeWorkout(items.map(([id]) => id), [], "UTC", true);
  w.date = date;
  w.exercises = w.exercises.map((e, i) => ({
    ...e,
    sets: [{ id: `s-${date}-${i}`, weight: items[i][1], reps: items[i][2], rir: 1, warmup: false, done: true }],
  }));
  return w;
}

test("StrengthTotal calculates Big-3 e1RM total, BW multiplier, shares, and next milestone", () => {
  const history = [
    done("2026-11-02", [["squat", 120, 1], ["bench", 100, 1]]),
    done("2026-11-05", [["deadlift-bar", 160, 1], ["ohp-bar", 65, 1]]),
  ];
  const summary = StrengthTotal.fromWorkouts(history, "UTC", 80, new Date("2026-11-10T12:00:00Z"));
  assert.equal(summary.totalKg, 380);
  assert.equal(summary.countedLifts, 3);
  assert.equal(summary.relativeBw, 4.75);
  assert.equal(summary.lifts.ohp.e1rmKg, 65);
  assert.equal(summary.milestone.nextKg, 400);
  assert.equal(summary.milestone.remainingKg, 20);
  assert.equal(summary.shares.squat + summary.shares.bench + summary.shares.deadlift, 100);
});

test("StrengthTotal handles empty history honestly without inventing numbers", () => {
  const summary = StrengthTotal.fromWorkouts([], "UTC", 75, new Date("2026-11-10T12:00:00Z"));
  assert.equal(summary.totalKg, 0);
  assert.equal(summary.countedLifts, 0);
  assert.equal(summary.relativeBw, null);
  assert.equal(summary.milestone.nextKg, 100);
  assert.equal(summary.lifts.squat.e1rmKg, null);
});

test("StrengthTotal.weekdayPulse aggregates workouts across Mon–Sun and finds peak day", () => {
  const history = [
    done("2026-11-09", [["bench", 80, 5]]), // Пн
    done("2026-11-11", [["squat", 100, 5]]), // Ср
    done("2026-11-16", [["bench", 82.5, 5]]), // Пн
  ];
  const pulse = StrengthTotal.weekdayPulse(history, "UTC", new Date("2026-11-20T12:00:00Z"));
  assert.deepEqual(pulse.counts, [2, 0, 1, 0, 0, 0, 0]);
  assert.equal(pulse.max, 2);
  assert.equal(pulse.total, 3);
  assert.equal(pulse.peakWeekday, 0);
});
