import test from "node:test";
import assert from "node:assert/strict";
import { LaidDupPlan } from "../src/domain/LaidDupPlan";
import { PeriodizationRules } from "../src/domain/PeriodizationRules";
import { DeloadEngine } from "../src/domain/DeloadEngine";
import { SmartCoach } from "../src/domain/SmartCoach";
import { TrainingProgram } from "../src/domain/TrainingProgram";
import { WarmupPlanner } from "../src/domain/WarmupPlanner";
import { WarmupLadderCalculator } from "../src/domain/WarmupLadderCalculator";
import { makeExerciseEntry, makeSets } from "../src/lib/model";
import type { LaidMaxes, Workout } from "../src/lib/types";

const MAXES: LaidMaxes = { squat: 100, bench: 80, deadlift: 100, ohp: 100 };
const START = "2026-11-09";

function doneWorkout(
  date: string,
  name: string,
  routineId: string | undefined,
  items: [exerciseId: string, weight: number, reps: number, rir: number | null, sets?: number][],
): Workout {
  return {
    id: crypto.randomUUID(),
    name,
    date,
    duration: 50,
    notes: "",
    ...(routineId ? { routineId } : {}),
    exercises: items.map(([id, weight, reps, rir, count = 3]) => ({
      ...makeExerciseEntry(id),
      sets: makeSets(count, weight, reps).map((s) => ({ ...s, rir, done: true })),
    })),
  };
}

test("LaidDupPlan.liftModeOf distinguishes calibration, pain, rir_range, and percent_1rm (no bogus 100 kg)", () => {
  const cycle = LaidDupPlan.routines({
    maxes: MAXES,
    extras: true,
    light: false,
    startMonday: START,
    calibrationLifts: ["squat", "deadlift", "ohp"],
  });
  const p = cycle[0].periodization!;
  assert.equal(LaidDupPlan.liftModeOf(p, "squat"), "calibration");
  assert.equal(LaidDupPlan.liftModeOf(p, "deadlift"), "calibration");
  assert.equal(LaidDupPlan.liftModeOf(p, "ohp"), "calibration");
  assert.equal(LaidDupPlan.liftModeOf(p, "bench"), "percent_1rm");

  // Day plan respects calibrationLifts (0 kg, no fake 85/65 kg from dummy 100 kg)
  const legs1 = cycle.find((r) => r.periodization!.day === "legs1")!;
  const plan = LaidDupPlan.planFor(legs1, START)!;
  assert.equal(plan.prescriptionMode, "calibration");
  assert.equal(plan.heavy.weightKg, 0);
  assert.equal(plan.work.weightKg, 0);
  assert.match(LaidDupPlan.compactLine(plan), /Калибровка/);
  assert.doesNotMatch(LaidDupPlan.compactLine(plan), /85 кг|65 кг/);
});

test("LaidDupPlan.weekGuide explains every week (1-9) and week 10 deload window with RIR and tiered rest", () => {
  for (let w = 0; w < 9; w++) {
    const guide = LaidDupPlan.weekGuide(LaidDupPlan.position(w));
    assert.equal(guide.weekNumber, w + 1);
    assert.equal(guide.isDeloadWindow, false);
    assert.ok(guide.focusTitle.length > 5);
    assert.ok(guide.summary.length > 20);
    assert.match(guide.baseRir, /RIR/);
    assert.match(guide.auxRir, /RIR 1–2/);
    assert.match(guide.restSummary, /3–5 мин/);
    assert.match(guide.restSummary, /1–1,5 мин/);
  }
  const w10 = LaidDupPlan.weekGuide(LaidDupPlan.position(9));
  assert.equal(w10.isDeloadWindow, true);
  assert.match(w10.badge, /Разгрузка/);
  assert.match(w10.baseRir, /RIR 3–4/);
});

test("LaidDupPlan.exerciseGuidance & restSecondsForSet assign tiered rest times and RIR per exercise type", () => {
  const planLegs1 = LaidDupPlan.day("legs1", 0, { squat: 120, bench: 100, deadlift: 160, ohp: 65 });
  const planPull2 = LaidDupPlan.day("pull2", 0, { squat: 120, bench: 100, deadlift: 160, ohp: 65 });

  // Main lift (Squat 1x5 + 4x12): top set 3:30 (210s), back-off 12 reps 3:00 (180s)
  const squatGuide = LaidDupPlan.exerciseGuidance("legs1", "squat", planLegs1);
  assert.equal(squatGuide.role, "lift");
  assert.match(squatGuide.rirLabel, /Топ RIR 1–2 · раб\. RIR 2–3/);
  assert.equal(LaidDupPlan.restSecondsForSet("legs1", "squat", planLegs1, { isTopSet: true, reps: 5 }), 210);
  assert.equal(LaidDupPlan.restSecondsForSet("legs1", "squat", planLegs1, { isTopSet: false, reps: 12 }), 180);

  // Heavy Deadlift day (Pull 2: 1x1 + 4x2): 4:00 (240s) for both top single and 4x2
  assert.equal(LaidDupPlan.restSecondsForSet("pull2", "deadlift-bar", planPull2, { isTopSet: true, reps: 1 }), 240);
  assert.equal(LaidDupPlan.restSecondsForSet("pull2", "deadlift-bar", planPull2, { isTopSet: false, reps: 2 }), 240);

  // Heavy compound accessory (RDL): 2:00 (120s), RIR 1-2
  const rdlGuide = LaidDupPlan.exerciseGuidance("legs1", "rdl", planLegs1);
  assert.equal(rdlGuide.role, "compound-aux");
  assert.equal(rdlGuide.restSeconds, 120);
  assert.equal(rdlGuide.restLabel, "2–3 мин");
  assert.match(rdlGuide.rirLabel, /RIR 1–2/);

  // Machine / isolation accessory (Seated Leg Curl): 1:30 (90s), RIR 1-2 (last 0-1)
  const curlGuide = LaidDupPlan.exerciseGuidance("legs1", "legcurl-seated", planLegs1);
  assert.equal(curlGuide.role, "isolation-aux");
  assert.equal(curlGuide.restSeconds, 90);
  assert.equal(curlGuide.restLabel, "1–1,5 мин");
  assert.match(curlGuide.rirLabel, /RIR 1–2/);

  // Deload mode overrides both RIR and rest
  const deloadGuide = LaidDupPlan.exerciseGuidance("legs1", "legcurl-seated", planLegs1, undefined, { deload: true });
  assert.match(deloadGuide.rirLabel, /RIR 3–4/);
  assert.equal(deloadGuide.restSeconds, 75);
});

test("DeloadEngine.transformWorkoutForDeload scales machine_stack weights and replaces Laid progressionNote", () => {
  const legs1 = LaidDupPlan.routines({
    maxes: { squat: 120, bench: 100, deadlift: 160, ohp: 65 },
    extras: true,
    light: false,
    startMonday: START,
  }).find((r) => r.periodization!.day === "legs1")!;

  const prev = doneWorkout("2026-11-02", legs1.name, legs1.id, [
    ["legcurl-seated", 60, 12, 1, 3],
  ]);
  const started = new TrainingProgram(legs1).start([prev], "UTC", START);
  const legCurlBefore = started.exercises.find((e) => e.exerciseId === "legcurl-seated")!;
  assert.equal(legCurlBefore.sets[0].weight, 60);

  const deloaded = DeloadEngine.transformWorkoutForDeload(started, "volume");
  const squatAfter = deloaded.exercises.find((e) => e.exerciseId === "squat")!;
  const legCurlAfter = deloaded.exercises.find((e) => e.exerciseId === "legcurl-seated")!;

  // Machine stack weight scaled down (60 * 0.85 = 51 -> 50 kg), RIR = 3
  assert.equal(legCurlAfter.sets[0].weight, 50);
  assert.equal(legCurlAfter.sets[0].rir, 3);
  // Stale Laid top-set progressionNote replaced with deload note
  assert.match(squatAfter.progressionNote ?? "", /Разгрузка/);
  assert.doesNotMatch(squatAfter.progressionNote ?? "", /Тяжёлый подход:/);
});

test("SmartCoach.analyze detects manual, periodic, and post-Laid deload weeks and recommends RIR 3-4", () => {
  // 1. Periodic deload (Program v2 week 5)
  const v2 = TrainingProgram.programV2();
  const mondayRoutine = v2[0];
  const week1Workout = doneWorkout("2026-10-12", mondayRoutine.name, mondayRoutine.id, [
    ["incline-bar", 80, 8, 1, 3],
    ["row", 70, 10, 1, 3],
  ]);
  // 4 weeks later -> index 4 -> deloadWeek 4 of 5!
  const periodicReport = SmartCoach.analyze(
    [week1Workout],
    v2,
    "2026-11-09",
    "UTC",
    new Date("2026-11-09T12:00:00Z"),
  );
  assert.equal(periodicReport.activeDeload?.active, true);
  assert.equal(periodicReport.nextSession.recommendedRir, "RIR 3–4");
  assert.equal(periodicReport.statusLabel, "Разгрузочная неделя");
  assert.ok(!periodicReport.insights.some((i) => i.id === "acwr-underload" || i.id === "muscle-underload"));

  // 2. Post-Laid Week 10 deload window
  const laidCycle = LaidDupPlan.routines({
    maxes: { squat: 120, bench: 100, deadlift: 160, ohp: 65 },
    extras: true,
    light: false,
    startMonday: "2026-09-07",
  });
  const laidFinishedReport = SmartCoach.analyze(
    [week1Workout],
    laidCycle,
    "2026-11-09", // 9 weeks after 2026-09-07 -> raw week 9 (week 10)
    "UTC",
    new Date("2026-11-09T12:00:00Z"),
  );
  assert.equal(laidFinishedReport.activeDeload?.active, true);
  assert.equal(laidFinishedReport.nextSession.recommendedRir, "RIR 3–4");
  assert.match(laidFinishedReport.nextSession.headline, /Разгрузка после 9 недель Лейда/);
});

test("PeriodizationRules validates autoEscalate, weekMode, and deloadWeeks strictly", () => {
  const base = LaidDupPlan.routines({
    maxes: { squat: 120, bench: 100, deadlift: 160, ohp: 65 },
    extras: true,
    light: false,
    startMonday: START,
    autoEscalate: true,
    weekMode: "rolling",
    deloadWeeks: [6],
  })[0].periodization!;

  assert.equal(PeriodizationRules.check(base).ok, true);
  assert.equal(base.autoEscalate, true);
  assert.equal(base.weekMode, "rolling");
  assert.deepEqual(base.deloadWeeks, [6]);

  // Invalid values rejected
  assert.equal(PeriodizationRules.check({ ...base, weekMode: "weekly" }).ok, false);
  assert.equal(PeriodizationRules.check({ ...base, autoEscalate: "yes" }).ok, false);
  assert.equal(PeriodizationRules.check({ ...base, deloadWeeks: [6, 6] }).ok, false);
  assert.equal(PeriodizationRules.check({ ...base, deloadWeeks: [1, 2, 3, 4] }).ok, false);
  assert.equal(PeriodizationRules.check({ ...base, deloadWeeks: [13] }).ok, false);
});

test("Training Max (92.5%) and Spine-Friendly preset reduce axial load by 18 sets with zero slot conflicts", () => {
  assert.equal(LaidDupPlan.trainingMaxFrom1Rm(100), 92.5);
  assert.equal(LaidDupPlan.trainingMaxFrom1Rm(140), 130);

  const baseVol = LaidDupPlan.weeklyMuscleVolume({ extras: true });
  const spineSubs = LaidDupPlan.toggleSpineFriendly(undefined, true);
  assert.equal(LaidDupPlan.isSpineFriendly(spineSubs), true);

  for (const [origId, targetId] of Object.entries(LaidDupPlan.SPINE_FRIENDLY_SUBS)) {
    const conflicts = LaidDupPlan.conflictingIdsForSubstitution(origId, true, spineSubs);
    assert.ok(!conflicts.includes(targetId), `Unexpected conflict for ${origId} -> ${targetId}`);
  }

  const spineVol = LaidDupPlan.weeklyMuscleVolume({ extras: true, substitutions: spineSubs });
  assert.equal(baseVol.axialSets - spineVol.axialSets, 18);

  const toggledOff = LaidDupPlan.toggleSpineFriendly(spineSubs, false);
  assert.equal(LaidDupPlan.isSpineFriendly(toggledOff), false);
});

test("Calibration auto-graduation computes RIR-adjusted 92.5% TM after >= 2 sessions and switches to % DUP", () => {
  const cycle = LaidDupPlan.routines({
    maxes: MAXES,
    extras: true,
    light: false,
    startMonday: START,
    calibrationLifts: ["squat", "deadlift"],
  });
  const legs1 = cycle.find((r) => r.periodization!.day === "legs1")!;
  const legs2 = cycle.find((r) => r.periodization!.day === "legs2")!;

  // Only 1 session -> not ready yet
  const s1 = doneWorkout("2026-11-09", legs1.name, legs1.id, [["squat", 80, 5, 2, 4]]);
  assert.equal(LaidDupPlan.calibrationReady(cycle[0].periodization!, [s1], "2026-11-12").length, 0);

  // 2 sessions -> squat graduates, deadlift still calibrating
  const s2 = doneWorkout("2026-11-12", legs2.name, legs2.id, [["squat", 85, 5, 2, 4]]);
  const ready = LaidDupPlan.calibrationReady(cycle[0].periodization!, [s1, s2], "2026-11-13");
  assert.equal(ready.length, 1);
  assert.equal(ready[0].lift, "squat");
  assert.equal(ready[0].sessions, 2);
  // 85 * (1 + (5 + 2) / 30) = 104.83 -> 92.5% = 96.97 -> rounds to 97.5 kg
  assert.equal(ready[0].suggestedTm, 97.5);

  const graduated = LaidDupPlan.graduateCalibration(cycle, ready, 1);
  assert.equal(graduated.length, 6);
  const p = graduated[0].periodization!;
  assert.deepEqual(p.calibrationLifts, ["deadlift"]);
  assert.equal(p.maxes.squat, 97.5);
  assert.equal(LaidDupPlan.liftModeOf(p, "squat"), "percent_1rm");
  assert.equal(LaidDupPlan.liftModeOf(p, "deadlift"), "calibration");
});

test("Built-in mid-cycle deload week (deloadWeeks: [6]) deloads Week 7 and shifts Wave 3 to Weeks 8-10", () => {
  const pastStart = "2026-09-07";
  const cycle = LaidDupPlan.routines({
    maxes: { squat: 120, bench: 100, deadlift: 160, ohp: 65 },
    extras: true,
    light: false,
    startMonday: pastStart,
    deloadWeeks: [6],
  });
  const legs1 = cycle.find((r) => r.periodization!.day === "legs1")!;
  assert.equal(LaidDupPlan.totalWeeks(legs1.periodization), 10);

  // Week 7 (raw = 6, 42 days after 2026-09-07 = 2026-10-19): Deload week!
  const prev = doneWorkout("2026-10-12", legs1.name, legs1.id, [["legcurl-seated", 60, 12, 1, 3]]);
  const w7Plan = LaidDupPlan.planFor(legs1, "2026-10-19", { workouts: [prev], cycle })!;
  assert.equal(w7Plan.isDeload, true);
  assert.equal(w7Plan.heavy.percent, 60);
  assert.equal(w7Plan.work.percent, 55);
  assert.equal(w7Plan.work.sets, 2);

  const w7Workout = new TrainingProgram(legs1).start([prev], "UTC", "2026-10-19", undefined, { cycle });
  const squat7 = w7Workout.exercises.find((e) => e.exerciseId === "squat")!;
  const curl7 = w7Workout.exercises.find((e) => e.exerciseId === "legcurl-seated")!;
  assert.equal(squat7.sets.length, 3); // 1 heavy + 2 work
  assert.equal(squat7.sets[0].rir, 4);
  assert.equal(curl7.sets.length, 1); // floor(3 * 0.5) = 1
  assert.equal(curl7.sets[0].weight, 39); // 60 * 0.65 = 39
  assert.equal(curl7.sets[0].rir, 4);

  // SmartCoach recognizes the built-in Laid deload week
  const coachReport = SmartCoach.analyze([prev], cycle, "2026-10-19", "UTC", new Date("2026-10-19T12:00:00Z"));
  assert.equal(coachReport.activeDeload?.active, true);
  assert.equal(coachReport.nextSession.recommendedRir, "RIR 3–4");

  // Week 8 (raw = 7, 49 days after 2026-09-07 = 2026-10-26): Wave 3 Week 1 (no skipped wave!)
  const w8Plan = LaidDupPlan.planFor(legs1, "2026-10-26", { workouts: [prev], cycle })!;
  assert.equal(w8Plan.isDeload, undefined);
  assert.equal(w8Plan.position.wave, 3);
  assert.equal(w8Plan.position.inWave, 0);
  assert.equal(w8Plan.position.week, 6);
  assert.equal(w8Plan.heavy.percent, 88);
});

test("Rolling week mode advances only after 6 completed workouts and never marks days as missed", () => {
  const cycle = LaidDupPlan.routines({
    maxes: { squat: 120, bench: 100, deadlift: 160, ohp: 65 },
    extras: true,
    light: false,
    startMonday: START,
    weekMode: "rolling",
  });
  // Even 3 calendar weeks later, 5 completed workouts -> still rolling week 0
  const fiveWorkouts = cycle.slice(0, 5).map((r, i) =>
    doneWorkout(`2026-11-${String(9 + i).padStart(2, "0")}`, r.name, r.id, [["squat", 100, 5, 2, 3]]),
  );
  assert.equal(LaidDupPlan.effectiveRawWeek(cycle, fiveWorkouts, "2026-12-01"), 0);
  assert.equal(LaidDupPlan.status(cycle[5], fiveWorkouts, 0, "2026-12-01").state, "ahead");

  // Completing the 6th workout advances rolling week to 1
  const sixWorkouts = [
    ...fiveWorkouts,
    doneWorkout("2026-12-01", cycle[5].name, cycle[5].id, [["deadlift-bar", 120, 5, 2, 3]]),
  ];
  assert.equal(LaidDupPlan.effectiveRawWeek(cycle, sixWorkouts, "2026-12-02"), 1);
  const nextPlan = LaidDupPlan.planFor(cycle[0], "2026-12-02", { workouts: sixWorkouts, cycle })!;
  assert.equal(nextPlan.position.week, 1);
});

test("auxProgressionHint guides double progression with RIR awareness and <=12% weight-step guard", () => {
  const entry = {
    exerciseId: "legcurl-seated",
    repMin: 10,
    repMax: 12,
    sets: makeSets(3, 50, 10),
  };
  // All 3 sets at 12 reps, 50 kg, RIR 2 -> 2.5 / 50 = 5% <= 12% -> raise_weight 52.5 kg
  const raise = LaidDupPlan.auxProgressionHint(
    entry,
    makeSets(3, 50, 12).map((s) => ({ ...s, rir: 2, done: true })),
  );
  assert.equal(raise?.kind, "raise_weight");
  assert.equal(raise?.suggestedWeightKg, 52.5);

  // Light dumbbell lateral raise 10 kg -> 2.5 / 10 = 25% > 12% -> add_reps instead of harsh jump
  const addReps = LaidDupPlan.auxProgressionHint(
    { exerciseId: "lateral", repMin: 10, repMax: 12, sets: makeSets(3, 10, 10) },
    makeSets(3, 10, 12).map((s) => ({ ...s, rir: 2, done: true })),
  );
  assert.equal(addReps?.kind, "add_reps");

  // Previous session hit RIR 0 (failure) -> consolidate weight
  const consolidate = LaidDupPlan.auxProgressionHint(
    entry,
    makeSets(3, 50, 12).map((s, i) => ({ ...s, rir: i === 2 ? 0 : 1, done: true })),
  );
  assert.equal(consolidate?.kind, "consolidate");
});

test("LaidDupPlan.cycleState and cycleSummary unify cycle progress, deloads, tonnage, and post-cycle deltas", () => {
  const pastStart = "2026-09-07";
  const cycle = LaidDupPlan.routines({
    maxes: { squat: 110, bench: 90, deadlift: 140, ohp: 60 },
    extras: true,
    light: false,
    startMonday: pastStart,
    deloadWeeks: [6],
  });
  const legs1 = cycle.find((r) => r.periodization!.day === "legs1")!;
  const push1 = cycle.find((r) => r.periodization!.day === "push1")!;
  const history = [
    doneWorkout("2026-09-07", legs1.name, legs1.id, [["squat", 100, 5, 2, 4]]),
    doneWorkout("2026-11-10", legs1.name, legs1.id, [["squat", 110, 5, 1, 3]]),
    doneWorkout("2026-11-11", push1.name, push1.id, [["bench", 92.5, 3, 1, 3]]),
  ];

  // Week 7 (raw = 6, 2026-10-19) -> isCurrentDeload === true, totalWeeks === 10
  const midState = LaidDupPlan.cycleState(cycle, history, "2026-10-19");
  assert.equal(midState.totalWeeks, 10);
  assert.equal(midState.rawWeek, 6);
  assert.equal(midState.isCurrentDeload, true);
  assert.equal(midState.weekGuide.isDeloadWindow, true);

  // Post-cycle (Week 11, raw = 10, 2026-11-16) -> finished === true
  const endState = LaidDupPlan.cycleState(cycle, history, "2026-11-16");
  assert.equal(endState.position.finished, true);

  const summary = LaidDupPlan.cycleSummary(cycle, history, "2026-11-16");
  assert.equal(summary.completedSessions, 3);
  assert.equal(summary.plannedSessions, 60); // 10 weeks * 6 days
  assert.ok(summary.totalTonnageKg > 0);
  const squatItem = summary.lifts.find((l) => l.lift === "squat")!;
  assert.equal(squatItem.startMax, 110);
  assert.ok(squatItem.bestE1rm !== null && squatItem.bestE1rm > 120);
  assert.ok(squatItem.deltaKg !== null && squatItem.deltaKg > 10);
  assert.ok(squatItem.suggestedNextTm !== null && squatItem.suggestedNextTm >= 115);
});

test("WarmupPlanner.createForTopSet builds DUP progressive ramp from empty bar and formats barbell plates", () => {
  const squatEntry = {
    ...makeExerciseEntry("squat"),
    sets: makeSets(5, 120, 1), // heavy top single 120 kg
  };
  const ramp = new WarmupPlanner(squatEntry).createForTopSet(20);
  assert.ok(ramp.length >= 4, `Expected >=4 progressive warmup steps, got ${ramp.length}`);
  assert.equal(ramp[0].weight, 20); // starts from empty bar
  assert.ok(ramp.every((s) => s.warmup && !s.done));
  assert.ok(ramp.at(-1)!.weight < 120 && ramp.at(-1)!.weight >= 95);

  // Inline plate breakdown matches 120 kg on 20 kg bar -> 50 kg/side (2x25 kg)
  const plates = WarmupLadderCalculator.formatPlates(120, 20);
  assert.match(plates, /2×25/);
});
