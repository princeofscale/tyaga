import test from "node:test";
import assert from "node:assert/strict";
import { EXERCISES, exerciseById, makeWorkout } from "../src/lib/model";
import { MuscleParticipation } from "../src/domain/MuscleParticipation";
import { ExerciseAlternativesFinder, detectExerciseEquipment } from "../src/domain/ExerciseAlternatives";
import { PersonalRecordsCalculator } from "../src/domain/PersonalRecords";
import { TrainingVolume } from "../src/domain/TrainingVolume";
import { OneRepMaxFormulas } from "../src/domain/OneRepMaxFormulas";
import { BiomechanicsEngine } from "../src/domain/BiomechanicsEngine";
import { MuscleReadiness } from "../src/domain/MuscleReadiness";
import { LaidDupPlan } from "../src/domain/LaidDupPlan";
import { TrainingProgram } from "../src/domain/TrainingProgram";
import { MachineRegistry } from "../src/domain/MachineRegistry";
import type { Workout } from "../src/lib/types";

function makeDone(
  id: string,
  date: string,
  sets: Array<{ weight: number; reps: number; rir: number | null; rom?: "full" | "shortened_partial" | "lengthened_partial" }>,
): Workout {
  const w = makeWorkout([id], [], "UTC");
  w.date = date;
  w.exercises[0].sets = sets.map((s, i) => ({
    id: `${id}-${date}-${i}`,
    weight: s.weight,
    reps: s.reps,
    rir: s.rir,
    warmup: false,
    done: true,
    ...(s.rom ? { execution: { rom: s.rom } } : {}),
  }));
  return w;
}

test("every curated chest exercise maps to an explicit chest subhead and dip-weighted uses shoulder flexion", () => {
  const chestExercises = EXERCISES.filter((e) =>
    e.muscles.some((m) => m.muscleId === "pectoralis-major" && m.role === "primary"),
  );
  assert.ok(chestExercises.length >= 10);
  for (const ex of chestExercises) {
    const roles = MuscleParticipation.roles(ex);
    const hasSubhead = roles.some(
      (r) =>
        r.role === "primary" &&
        ["pectoralis-clavicular", "pectoralis-sternal", "pectoralis-abdominal"].includes(r.muscleId),
    );
    assert.ok(hasSubhead, `${ex.id} (${ex.name}) must have a primary chest subhead`);
  }

  const dip = exerciseById("dip-weighted")!;
  assert.ok(dip.jointActions.includes("Сгибание плеча"));
  assert.ok(!dip.jointActions.includes("Разгибание плеча"));
  assert.equal(MuscleParticipation.headRole("chest-lower", dip), "primary");
  assert.equal(MuscleParticipation.headRole("chest-mid", exerciseById("pec-deck-fly")!), "primary");
  assert.equal(MuscleParticipation.headRole("chest-mid", exerciseById("fly-db-flat")!), "primary");
});

test("ExerciseAlternativesFinder uses anatomical subheads (never substring matching) and classifies equipment accurately", () => {
  assert.equal(detectExerciseEquipment(exerciseById("dip-weighted")!), "bodyweight");
  assert.equal(detectExerciseEquipment(exerciseById("pullup-weighted")!), "bodyweight");
  assert.equal(detectExerciseEquipment(exerciseById("pullup-assisted")!), "machine");

  // "Сведение в кроссовере с верхних блоков" targets LOWER chest (pectoralis-abdominal), not upper chest
  const highFly = exerciseById("high-cable-fly")!;
  const flyAlts = ExerciseAlternativesFinder.findAlternatives(highFly, EXERCISES, 4);
  const topIds = flyAlts.slice(0, 3).map((a) => a.exercise.id);
  assert.ok(
    topIds.includes("dip-weighted") || topIds.includes("fly-db-flat") || topIds.includes("pec-deck-fly"),
    `Expected lower-chest/fly alternatives, got ${topIds.join(", ")}`,
  );
  assert.notEqual(flyAlts[0].exercise.id, "incline-db", "High-to-low cable fly must not match incline press as #1");

  // Facepull targets posterior delt → rear-delt-fly must be top recommendation
  const facepull = exerciseById("facepull-er")!;
  const rearAlts = ExerciseAlternativesFinder.findAlternatives(facepull, EXERCISES, 4);
  assert.equal(rearAlts[0].exercise.id, "rear-delt-fly");
});

test("Push/Pull and Upper/Lower ratios do not misclassify deadlifts, back extensions, or core as upper-body pull", () => {
  const deadlift = makeDone("deadlift-bar", "2026-11-10", [
    { weight: 140, reps: 5, rir: 1 },
    { weight: 140, reps: 5, rir: 1 },
    { weight: 140, reps: 5, rir: 1 },
  ]);
  const crunch = makeDone("crunch", "2026-11-10", [
    { weight: 0, reps: 15, rir: 2 },
    { weight: 0, reps: 15, rir: 2 },
  ]);
  const backExt = makeDone("back-extension", "2026-11-10", [
    { weight: 0, reps: 12, rir: 2 },
  ]);

  const ratios = new PersonalRecordsCalculator([deadlift, crunch, backExt], new Date("2026-11-11T12:00:00Z")).calculateRatios("UTC");
  assert.equal(ratios.pullSets, 0, "deadlift & back-extension are posterior chain, not upper-body pulling");
  assert.equal(ratios.upperSets, 0, "deadlift, back-extension, and core do not inflate upperSets");
  assert.equal(ratios.lowerSets, 3, "deadlift counts toward lower-body sets");
});

test("Machine calibration pulleyRatio/stackRatio produces calibratedVolume alongside raw stack volume", () => {
  const w = makeDone("row", "2026-11-10", [
    { weight: 60, reps: 10, rir: 2 },
    { weight: 60, reps: 10, rir: 2 },
  ]);
  const m = MachineRegistry.create();
  m.nickname = "Блок 2:1";
  m.calibration = { pulleyRatio: 0.5, stackRatio: 1 };
  w.exercises[0].machineInstanceId = m.id;
  w.exercises[0].machineSnapshot = m;

  const rows = TrainingVolume.machines([w], { now: new Date("2026-11-11T12:00:00Z"), timeZone: "UTC" });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].volume, 1200);
  assert.equal(rows[0].calibrationFactor, 0.5);
  assert.equal(rows[0].calibratedVolume, 600);
});

test("RIR-adjusted 1RM and BiomechanicsEngine accurately model RIR, rep zones, axial load, and signals", () => {
  // 100 kg × 5 @ RIR 3 ≈ 100 kg × 8 @ RIR 0 = 126.7 kg
  assert.equal(OneRepMaxFormulas.round(OneRepMaxFormulas.rirAdjustedEpley(100, 5, 3)!), 126.7);
  assert.equal(OneRepMaxFormulas.round(OneRepMaxFormulas.rirAdjustedEpley(100, 5, 0)!), OneRepMaxFormulas.round(OneRepMaxFormulas.epley(100, 5)));
  assert.equal(OneRepMaxFormulas.rirAdjustedEpley(100, 12, 5), null, "effectiveReps > 15 returns null");

  const rir0 = OneRepMaxFormulas.setEffortProfile(8, 0);
  const rir2 = OneRepMaxFormulas.setEffortProfile(8, 2);
  const rir6 = OneRepMaxFormulas.setEffortProfile(8, 6);
  assert.ok(rir0.fatigue > rir2.fatigue, "RIR 0 costs more fatigue than RIR 2");
  assert.ok(rir6.stimulus < 0.5, "RIR 6 yields low hypertrophy stimulus");

  // High failure ratio + junk volume + chest upper gap detection
  const w1 = makeDone("bench", "2026-11-10", Array.from({ length: 8 }, () => ({ weight: 80, reps: 8, rir: 0 })));
  const report = BiomechanicsEngine.analyzeWeek([w1], "2026-11-11", { now: new Date("2026-11-11T12:00:00Z"), timeZone: "UTC" });
  assert.equal(report.workingSets, 8);
  assert.equal(report.failureSets, 8);
  assert.equal(report.repZones.hypertrophy, 8);
  assert.ok(report.signals.some((s) => s.id === "high-failure-ratio"));
  assert.ok(report.signals.some((s) => s.id === "chest-upper-gap"));

  // MuscleReadiness differentiates brutal failure session from light session
  const heavyChest = makeDone("bench", "2026-11-10", Array.from({ length: 10 }, () => ({ weight: 100, reps: 6, rir: 0 })));
  const readinessHeavy = MuscleReadiness.fromWorkouts([heavyChest], "2026-11-11", "UTC");
  const chestHeavy = readinessHeavy.find((g) => g.id === "chest")!;
  assert.equal(chestHeavy.state, "fatigued", "10 sets to failure yesterday leaves chest fatigued");

  const lightChest = makeDone("bench", "2026-11-10", [{ weight: 60, reps: 8, rir: 4 }]);
  const readinessLight = MuscleReadiness.fromWorkouts([lightChest], "2026-11-11", "UTC");
  const chestLight = readinessLight.find((g) => g.id === "chest")!;
  assert.equal(chestLight.state, "recovering");
  assert.ok(chestLight.ratio > chestHeavy.ratio, "lighter session recovers faster than 10 sets to failure");
});

test("David Laid DUP updates wave-aux reps across weeks, excludes partial ROM from 1RM estimate, and audits axial load", () => {
  const maxes = { squat: 120, bench: 100, deadlift: 160, ohp: 70 };
  const cycle = LaidDupPlan.routines({ maxes, extras: true, light: false, startMonday: "2026-11-09" });
  const push1 = cycle.find((r) => r.periodization!.day === "push1")!;

  // Week 1 Push 1: complete push-press 3 × 4 @ 60 kg
  const w1 = new TrainingProgram(push1).start([], "UTC", "2026-11-10");
  const pp1 = w1.exercises.find((e) => e.exerciseId === "push-press")!;
  pp1.sets.forEach((s) => {
    s.weight = 60;
    s.reps = 4;
    s.done = true;
  });
  w1.date = "2026-11-10";

  // Week 2 Push 1: wave target for push-press is now 8 reps (not 4 from Week 1!)
  const w2 = new TrainingProgram(push1).start([w1], "UTC", "2026-11-17");
  const pp2 = w2.exercises.find((e) => e.exerciseId === "push-press")!;
  assert.equal(pp2.repMin, 8);
  assert.equal(pp2.repMax, 8);
  assert.deepEqual(pp2.sets.map((s) => s.reps), [8, 8, 8]);
  assert.match(pp2.progressionNote!, /Волна недели: 3 × 8/);

  // Partial ROM set must not corrupt full-ROM 1RM estimate
  const partialSquat = makeDone("squat", "2026-11-12", [{ weight: 180, reps: 5, rir: 1, rom: "shortened_partial" }]);
  const fullSquat = makeDone("squat", "2026-11-12", [{ weight: 110, reps: 5, rir: 1, rom: "full" }]);
  assert.equal(LaidDupPlan.estimate([partialSquat], "squat"), null);
  assert.equal(LaidDupPlan.estimate([partialSquat, fullSquat], "squat"), 128.3);

  // Deduplication keeps latest revision of a workout
  const badRev = makeDone("bench", "2026-11-12", [{ weight: 250, reps: 5, rir: 0 }]);
  badRev.id = "same-workout";
  badRev.revision = 1;
  const fixedRev = makeDone("bench", "2026-11-12", [{ weight: 90, reps: 5, rir: 1 }]);
  fixedRev.id = "same-workout";
  fixedRev.revision = 2;
  assert.equal(LaidDupPlan.estimate([badRev, fixedRev], "bench"), 105);

  // Audit flags pull-before-legs in classic 6x1 (Pull 1 Wed → Legs 2 Thu)
  const audit = BiomechanicsEngine.auditLaidCycle(cycle, [], "2026-11-12");
  assert.ok(audit.weeklyAxialSets >= 30);
  assert.ok(audit.pullBeforeLegsPairs.length >= 1);
  assert.ok(audit.topSetFeedback.some((s) => s.id === "laid-pull-before-legs"));
});
