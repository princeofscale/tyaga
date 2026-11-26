import assert from "node:assert/strict";
import test from "node:test";
import { LaidDupPlan } from "../src/domain/LaidDupPlan";
import { PeriodizationRules } from "../src/domain/PeriodizationRules";
import { TrainingProgram } from "../src/domain/TrainingProgram";
import { LAID_V2_STIMULUS } from "../src/domain/laidDupData";

const MAXES = { squat: 100, bench: 80, deadlift: 140, ohp: 60 };
const START = "2026-11-09";

test("DUP v2 creates exact 124 working sets/cycle (21+19+19+21+23+21), 10-week schedule with week 7 deload, and zero duplicates", () => {
  const cycle = LaidDupPlan.routines({
    version: "v2",
    maxes: MAXES,
    extras: true,
    light: true,
    startMonday: START,
  });

  assert.equal(cycle.length, 6);
  // Rhythm 3+1+3 (Mon, Tue, Wed, Fri, Sat, Sun)
  assert.deepEqual(
    cycle.map((r) => r.days),
    [[0], [1], [2], [4], [5], [6]],
  );

  // Every routine passes PeriodizationRules (shared with Cloudflare Worker)
  for (const r of cycle) {
    const check = PeriodizationRules.check(r.periodization);
    assert.equal(check.ok, true, `PeriodizationRules failed for ${r.name}`);
    assert.equal(r.periodization!.version, "v2");
    assert.equal(r.periodization!.weekMode, "rolling");
    assert.deepEqual(r.periodization!.deloadWeeks, [6]);

    // Zero duplicate exercise IDs within any day
    const ids = r.exercises.map((e) => e.exerciseId);
    assert.equal(new Set(ids).size, ids.length, `duplicate exercise in ${r.name}`);
  }

  // Exact set counts per day: 21 + 19 + 19 + 21 + 23 + 21 = 124
  const perDaySets = cycle.map((r) =>
    r.exercises.reduce((sum, e) => sum + e.sets.filter((s) => !s.warmup).length, 0),
  );
  assert.deepEqual(perDaySets, [21, 19, 19, 21, 23, 21]);
  assert.equal(
    perDaySets.reduce((a, b) => a + b, 0),
    124,
  );

  // Pull 1 uses trap-bar deadlift; Pull 2 has NO floor deadlift (uses chest-supported row)
  const pull1 = cycle.find((r) => r.periodization!.day === "pull1")!;
  const pull2 = cycle.find((r) => r.periodization!.day === "pull2")!;
  assert.equal(pull1.exercises[0].exerciseId, "trap-bar-deadlift");
  assert.equal(pull2.exercises[0].exerciseId, "row-chest-supported");
  assert.ok(!pull2.exercises.some((e) => e.exerciseId === "deadlift-bar" || e.exerciseId === "trap-bar-deadlift"));

  // Total cycle weeks = 10 (9 productive + 1 deload on week 7)
  assert.equal(LaidDupPlan.totalWeeks(cycle[0].periodization), 10);

  // Axial load dramatically reduced compared to v1 original
  const v1Vol = LaidDupPlan.weeklyMuscleVolume({ version: "v1", extras: true });
  const v2Vol = LaidDupPlan.weeklyMuscleVolume({ version: "v2", extras: true });
  assert.ok(v2Vol.axialSets <= 18, `expected <= 18 axial sets in v2, got ${v2Vol.axialSets}`);
  assert.ok(v2Vol.axialSets < v1Vol.axialSets * 0.45);
});

test("DUP v2 staggered stimulus matrix never pairs S-squat with S-deadlift or S-bench with S-OHP, and Wave 1/2/3 + Deload match exact percentages", () => {
  // Check staggered S stimuli across inWave 0, 1, 2
  for (let inWave = 0; inWave < 3; inWave++) {
    const sSquat = LAID_V2_STIMULUS.legs1[inWave] === "S" || LAID_V2_STIMULUS.legs2[inWave] === "S";
    const sDeadlift = LAID_V2_STIMULUS.pull1[inWave] === "S";
    assert.equal(sSquat && sDeadlift, false, `Week ${inWave + 1} overlaps S squat and S trap-bar`);

    const sBench = LAID_V2_STIMULUS.push1[inWave] === "S";
    const sOhp = LAID_V2_STIMULUS.push2[inWave] === "S";
    assert.equal(sBench && sOhp, false, `Week ${inWave + 1} overlaps S bench and S OHP`);
  }

  // Week 1 (Wave 1, A): Legs 1 = H (1×6 @ 85% + 3×10 @ 72.5%), Push 1 = S (1×3 @ 95% + 3×5 @ 85%), Pull 1 = S (1×3 @ 92.5% + 2×4 @ 87.5%)
  const l1w1 = LaidDupPlan.day("legs1", 0, MAXES, { version: "v2", deloadWeeks: [6] });
  assert.equal(l1w1.stimulus, "H");
  assert.equal(l1w1.heavy.reps, 6);
  assert.equal(l1w1.heavy.percent, 85);
  assert.equal(l1w1.heavy.weightKg, 85);
  assert.equal(l1w1.work.sets, 3);
  assert.equal(l1w1.work.reps, 10);
  assert.equal(l1w1.work.percent, 72.5);
  assert.equal(l1w1.work.weightKg, 72.5);

  const l2w1 = LaidDupPlan.day("legs2", 0, MAXES, { version: "v2", deloadWeeks: [6] });
  assert.equal(l2w1.stimulus, "M");
  assert.equal(l2w1.work.sets, 2); // Legs 2 has 2 back-off sets (3 total) to save lumbar for RDL

  const p1w1 = LaidDupPlan.day("push1", 0, MAXES, { version: "v2", deloadWeeks: [6] });
  assert.equal(p1w1.stimulus, "S");
  assert.equal(p1w1.heavy.reps, 3);
  assert.equal(p1w1.heavy.percent, 95);
  assert.equal(p1w1.work.sets, 3);
  assert.equal(p1w1.work.reps, 5);
  assert.equal(p1w1.work.percent, 85);

  const pu1w1 = LaidDupPlan.day("pull1", 0, MAXES, { version: "v2", deloadWeeks: [6] });
  assert.equal(pu1w1.liftExerciseId, "trap-bar-deadlift");
  assert.equal(pu1w1.heavy.reps, 3);
  assert.equal(pu1w1.heavy.percent, 92.5);
  assert.equal(pu1w1.work.sets, 2);
  assert.equal(pu1w1.work.reps, 4);
  assert.equal(pu1w1.work.percent, 87.5);

  // Cycle 7 (index 6) = Active Deload: 2×5 @ 75% TM for squat/bench/ohp, 2×3 @ 75% TM for trap-bar
  const deloadSq = LaidDupPlan.day("legs1", 6, MAXES, { version: "v2", deloadWeeks: [6] });
  assert.equal(deloadSq.isDeload, true);
  assert.equal(deloadSq.heavy.reps, 5);
  assert.equal(deloadSq.heavy.percent, 75);
  assert.equal(deloadSq.heavy.weightKg, 75);
  assert.equal(deloadSq.work.sets, 1);
  assert.equal(deloadSq.work.reps, 5);

  const deloadTrap = LaidDupPlan.day("pull1", 6, MAXES, { version: "v2", deloadWeeks: [6] });
  assert.equal(deloadTrap.isDeload, true);
  assert.equal(deloadTrap.heavy.reps, 3);
  assert.equal(deloadTrap.heavy.percent, 75);
  assert.equal(deloadTrap.work.sets, 1);
  assert.equal(deloadTrap.work.reps, 3);

  // Wave 3 (index 7 = Cycle 8, week A): Push 1 S = 1×3 @ 100% TM + 3×4 @ 90% TM
  const p1w8 = LaidDupPlan.day("push1", 7, MAXES, { version: "v2", deloadWeeks: [6] });
  assert.equal(p1w8.position.wave, 3);
  assert.equal(p1w8.heavy.reps, 3);
  assert.equal(p1w8.heavy.percent, 100);
  assert.equal(p1w8.work.reps, 4);
  assert.equal(p1w8.work.percent, 90);
});

test("upgradeCycleToV2 upgrades an existing classic v1 cycle in place and TrainingProgram builds DUP v2 Push 2 wave aux", () => {
  const v1 = LaidDupPlan.routines({
    maxes: MAXES,
    extras: true,
    light: false,
    startMonday: START,
  });
  const upgraded = LaidDupPlan.upgradeCycleToV2(v1);
  assert.equal(upgraded.length, 6);
  assert.equal(upgraded[0].periodization!.cycleId, v1[0].periodization!.cycleId);
  assert.equal(upgraded[0].periodization!.startMonday, START);
  assert.equal(upgraded[0].periodization!.version, "v2");
  assert.deepEqual(upgraded[0].periodization!.deloadWeeks, [6]);

  const push2 = upgraded.find((r) => r.periodization!.day === "push2")!;
  const workout = new TrainingProgram(push2).start([], "UTC", "2026-11-10");
  const inclineDb = workout.exercises.find((e) => e.exerciseId === "incline-db")!;
  assert.equal(inclineDb.repMin, 12);
  assert.equal(inclineDb.repMax, 12);
});
