import test from "node:test";
import assert from "node:assert/strict";
import { EXERCISES } from "../src/lib/model";
import {
  ALL_BIOMECH_PROFILES_V3,
  EXERCISE_PROFILES_V3,
} from "../src/domain/BiomechanicsCatalogV3";
import {
  JointGuardEngine,
  STANDARD_GYM_INVENTORY_ADAPTER,
  type JointPainLog,
  type ReturnToLiftState,
} from "../src/domain/JointGuardEngine";
import {
  HypertrophyAuditEngine,
  type WeeklyExerciseVolume,
} from "../src/domain/HypertrophyAuditEngine";

const NOW = 1_795_700_000_000; // 2026-11-27
const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

const guard = new JointGuardEngine();
const audit = new HypertrophyAuditEngine(guard);

test("Catalog V3 covers all 74 exercises in EXERCISES with zero missing IDs", () => {
  assert.equal(ALL_BIOMECH_PROFILES_V3.length, 74);
  for (const ex of EXERCISES) {
    assert.ok(EXERCISE_PROFILES_V3[ex.id], `Missing V3 biomechanical profile for exercise ID: ${ex.id}`);
  }
});

test("TC1: longLevers sensitivity shifts bench (shoulder sev=1) and rdl (lumbar sev=1) from modify to swap_recommended", () => {
  const shoulderLog: JointPainLog[] = [{ zone: "shoulder_anterior", severity: 1, timestamp: NOW - DAY_MS }];
  const lumbarLog: JointPainLog[] = [{ zone: "lumbar", severity: 1, timestamp: NOW - DAY_MS }];

  const benchStd = guard.evaluateExerciseSafety("bench", shoulderLog, false, NOW);
  const benchLL = guard.evaluateExerciseSafety("bench", shoulderLog, true, NOW);
  assert.equal(benchStd.action, "modify_load_tempo");
  assert.equal(benchStd.loadMultiplier, 0.85);
  assert.equal(benchLL.action, "swap_recommended");
  assert.equal(benchLL.loadMultiplier, 0.85);

  const rdlStd = guard.evaluateExerciseSafety("rdl", lumbarLog, false, NOW);
  const rdlLL = guard.evaluateExerciseSafety("rdl", lumbarLog, true, NOW);
  assert.equal(rdlStd.action, "modify_load_tempo");
  assert.equal(rdlLL.action, "swap_recommended");
});

test("TC2: Axial lumbar escalation blocks squat (140 kg, lumbar sev=1, LL=true) and computes GymInventory swap weights", () => {
  const logs: JointPainLog[] = [{ zone: "lumbar", severity: 1, timestamp: NOW - DAY_MS }];
  const safety = guard.evaluateExerciseSafety("squat", logs, true, NOW);
  assert.equal(safety.action, "block_swap_required");
  assert.equal(safety.loadMultiplier, 0);
  assert.equal(safety.optionalWarmupProtocol, "mcgill_big_3");

  const swaps = guard.recommendSwap("squat", 140, logs, true, NOW, STANDARD_GYM_INVENTORY_ADAPTER, 3);
  assert.equal(swaps.length, 3);
  const byId = new Map(swaps.map((s) => [s.targetExerciseId, s]));
  assert.ok(byId.has("bulgarian-split-squat"));
  assert.ok(byId.has("hack-squat"));
  assert.ok(byId.has("legpress"));

  assert.equal(byId.get("bulgarian-split-squat")!.estimatedWorkingWeightKg, 28);
  assert.equal(byId.get("bulgarian-split-squat")!.score, 0.712);
  assert.equal(byId.get("hack-squat")!.estimatedWorkingWeightKg, 132.5);
  assert.equal(byId.get("legpress")!.estimatedWorkingWeightKg, 220);
});

test("TC3: Inter-modal weight conversion total_external -> per_implement on bench (100 kg, shoulder sev=2, LL=true)", () => {
  const logs: JointPainLog[] = [{ zone: "shoulder_anterior", severity: 2, timestamp: NOW - DAY_MS }];
  const safety = guard.evaluateExerciseSafety("bench", logs, true, NOW);
  assert.equal(safety.action, "block_swap_required");

  const swaps = guard.recommendSwap("bench", 100, logs, true, NOW, STANDARD_GYM_INVENTORY_ADAPTER, 3);
  assert.equal(swaps[0].targetExerciseId, "flat-db-press");
  assert.equal(swaps[0].score, 0.642);
  assert.equal(swaps[0].estimatedWorkingWeightKg, 34);
  assert.equal(swaps[0].safetyAction, "modify_load_tempo");

  assert.equal(swaps[1].targetExerciseId, "incline-db");
  assert.equal(swaps[1].score, 0.415);
  assert.equal(swaps[1].estimatedWorkingWeightKg, 28);

  assert.equal(swaps[2].targetExerciseId, "pec-deck-fly");
  assert.equal(swaps[2].score, 0.3197);
  assert.equal(swaps[2].estimatedWorkingWeightKg, 55);
});

test("TC4: Family filter excludes unrelated shrugs for row-bent-bar and ranks cable swaps for skullcrusher-ez", () => {
  const lumbarLogs: JointPainLog[] = [{ zone: "lumbar", severity: 2, timestamp: NOW - DAY_MS }];
  assert.equal(guard.evaluateExerciseSafety("row-bent-bar", lumbarLogs, true, NOW).action, "block_swap_required");

  const rowSwaps = guard.recommendSwap("row-bent-bar", 90, lumbarLogs, true, NOW, STANDARD_GYM_INVENTORY_ADAPTER, 3);
  assert.equal(rowSwaps.some((s) => s.targetExerciseId.startsWith("shrug")), false);
  assert.equal(rowSwaps[0].targetExerciseId, "row-chest-supported");
  assert.equal(rowSwaps[0].score, 0.8797);
  assert.equal(rowSwaps[0].safetyAction, "allow");
  assert.equal(rowSwaps[0].estimatedWorkingWeightKg, 60);

  assert.equal(rowSwaps[1].targetExerciseId, "row-single-cable");
  assert.equal(rowSwaps[1].score, 0.75);
  assert.equal(rowSwaps[1].estimatedWorkingWeightKg, 32.5);

  assert.equal(rowSwaps[2].targetExerciseId, "pullup-assisted");
  assert.equal(rowSwaps[2].score, 0.6456);
  assert.equal(rowSwaps[2].estimatedWorkingWeightKg, 60);

  const elbowLogs: JointPainLog[] = [{ zone: "elbow", severity: 2, timestamp: NOW - DAY_MS }];
  assert.equal(guard.evaluateExerciseSafety("skullcrusher-ez", elbowLogs, true, NOW).action, "block_swap_required");

  const triSwaps = guard.recommendSwap("skullcrusher-ez", 40, elbowLogs, true, NOW, STANDARD_GYM_INVENTORY_ADAPTER, 3);
  assert.equal(triSwaps[0].targetExerciseId, "extension-overhead-cable");
  assert.equal(triSwaps[0].score, 0.666);
  assert.equal(triSwaps[0].estimatedWorkingWeightKg, 22.5);

  assert.equal(triSwaps[1].targetExerciseId, "extension-v-pushdown");
  assert.equal(triSwaps[1].score, 0.1853);
  assert.equal(triSwaps[1].estimatedWorkingWeightKg, 27.5);

  assert.equal(triSwaps[2].targetExerciseId, "triceps-push");
  assert.equal(triSwaps[2].score, 0.1823);
  assert.equal(triSwaps[2].estimatedWorkingWeightKg, 25);
});

test("TC5: DeloadEngine v2 S5_pain contract applies 14-day window and 24-hour episode deduplication", () => {
  const logs: JointPainLog[] = [
    { zone: "elbow", severity: 1, timestamp: NOW - 16 * DAY_MS }, // expired (>14d)
    { zone: "wrist", severity: 1, timestamp: NOW - 3 * DAY_MS },
    { zone: "knee_patellar", severity: 2, timestamp: NOW - 10 * DAY_MS },
    { zone: "knee_patellar", severity: 2, timestamp: NOW - 10 * DAY_MS + HOUR_MS }, // same episode (<24h)
    { zone: "knee_patellar", severity: 2, timestamp: NOW - 4 * DAY_MS }, // distinct episode (>=24h)
  ];

  const signal = guard.evaluateDeloadS5(logs, NOW);
  assert.deepEqual(signal, { painFlagsCount: 2, corePainRepeated: true });
});

test("TC6: Return-to-Lift 5-phase FSM handles progression, amber hysteresis, 1st relapse, and 14-day reset on 2nd relapse", () => {
  const start: ReturnToLiftState = {
    exerciseId: "squat",
    zone: "knee_patellar",
    phase: "acute_swap",
    loadPct: 0.0,
    daysSymptomFree: 5,
    consecutiveRelapses: 0,
  };

  const s1 = guard.stepReturnToLift(start, 0, false, 2);
  assert.equal(s1.decision, "advance_to_test");
  assert.equal(s1.nextState.phase, "test_reload_70");
  assert.equal(s1.nextState.loadPct, 0.7);

  const s2 = guard.stepReturnToLift(s1.nextState, 2, false);
  assert.equal(s2.decision, "progress");
  assert.equal(s2.nextState.phase, "ramp_80");
  assert.equal(s2.nextState.loadPct, 0.8);

  const s3 = guard.stepReturnToLift(s2.nextState, 3, false);
  assert.equal(s3.decision, "hold_repeat_step");
  assert.equal(s3.nextState.phase, "ramp_80");

  const s4 = guard.stepReturnToLift(s3.nextState, 4, true);
  assert.equal(s4.decision, "regress_one_step");
  assert.equal(s4.nextState.phase, "test_reload_70");
  assert.equal(s4.nextState.consecutiveRelapses, 1);

  const s5 = guard.stepReturnToLift(s4.nextState, 4, true);
  assert.equal(s5.decision, "reset_acute_14d");
  assert.equal(s5.nextState.phase, "acute_swap");
  assert.equal(s5.nextState.daysSymptomFree, -7);
});

test("TC7: Red flag isAcuteNightOrRadiating overrides severity=2 to effective severity=3 and triggers medical banner", () => {
  const logs: JointPainLog[] = [
    { zone: "knee_patellar", severity: 2, timestamp: NOW - DAY_MS, isAcuteNightOrRadiating: true },
  ];

  const legpress = guard.evaluateExerciseSafety("legpress", logs, false, NOW);
  assert.equal(legpress.action, "block_swap_required");
  assert.equal(legpress.requiresMedicalReferralBanner, true);

  const rdl = guard.evaluateExerciseSafety("rdl", logs, false, NOW);
  assert.equal(rdl.action, "allow");
  assert.equal(rdl.requiresMedicalReferralBanner, true);

  assert.deepEqual(guard.evaluateDeloadS5(logs, NOW), {
    painFlagsCount: 1,
    corePainRepeated: true,
  });
});

test("TC8: Strict JointGuard -> HypertrophyAudit safety filter never recommends shoulder-risky exercises at sev=3", () => {
  const logs: JointPainLog[] = [{ zone: "shoulder_anterior", severity: 3, timestamp: NOW - DAY_MS }];
  const week: WeeklyExerciseVolume[] = [
    { exerciseId: "squat", sets: 6 },
    { exerciseId: "dip-weighted", sets: 4 },
    { exerciseId: "leg-extension", sets: 4 },
    { exerciseId: "rdl", sets: 4 },
    { exerciseId: "legcurl-seated", sets: 4 },
    { exerciseId: "barbell-hip-thrust", sets: 4 },
    { exerciseId: "calf-legpress", sets: 4 },
    { exerciseId: "row-chest-supported", sets: 5 },
    { exerciseId: "row-single-cable", sets: 6 },
    { exerciseId: "rear-delt-fly", sets: 4 },
    { exerciseId: "curl-preacher-ez", sets: 4 },
    { exerciseId: "hammer-seated", sets: 3 },
  ];

  const report = audit.auditWeek(week, true, logs, NOW, STANDARD_GYM_INVENTORY_ADAPTER);
  assert.equal(report.jointSafetyScore, 30);
  // Every single recommended exercise must be strictly JointGuard-safe (allow or modify_load_tempo)
  for (const rec of report.recommendations) {
    const check = guard.evaluateExerciseSafety(rec.addExerciseId, logs, true, NOW);
    assert.ok(
      check.action === "allow" || check.action === "modify_load_tempo",
      `Unsafe recommendation ${rec.addExerciseId} (${check.action}) leaked through HypertrophyAudit!`,
    );
  }
  assert.equal(report.recommendations[0]?.type, "joint_safety");
  assert.equal(report.recommendations[0]?.removeExerciseId, "squat");
  assert.ok(report.recommendations.some((r) => r.addExerciseId === "extension-v-pushdown"));
});

test("TC9: Calibration A — David Laid DUP v2 scores 98.7 with 100% regional coverage and zero blind spots", () => {
  const dupV2: WeeklyExerciseVolume[] = [
    { exerciseId: "squat", sets: 4 },
    { exerciseId: "hack-squat", sets: 4 },
    { exerciseId: "leg-extension", sets: 4 },
    { exerciseId: "deadlift-bar", sets: 3 },
    { exerciseId: "rdl", sets: 3 },
    { exerciseId: "legcurl-seated", sets: 4 },
    { exerciseId: "barbell-hip-thrust", sets: 3 },
    { exerciseId: "calf-standing-machine", sets: 4 },
    { exerciseId: "bench", sets: 5 },
    { exerciseId: "incline-db", sets: 4 },
    { exerciseId: "pec-deck-fly", sets: 3 },
    { exerciseId: "shoulder-press-machine", sets: 3 },
    { exerciseId: "lateral-cable-single", sets: 6 },
    { exerciseId: "extension-overhead-cable", sets: 4 },
    { exerciseId: "extension-v-pushdown", sets: 4 },
    { exerciseId: "pullup-weighted", sets: 3 },
    { exerciseId: "lat-pulldown", sets: 4 },
    { exerciseId: "row-chest-supported", sets: 5 },
    { exerciseId: "facepull-er", sets: 4 },
    { exerciseId: "curl-preacher-ez", sets: 4 },
    { exerciseId: "hammer-seated", sets: 3 },
    { exerciseId: "cable-crunch", sets: 4 },
  ];

  const report = audit.auditWeek(dupV2, true, [], NOW, STANDARD_GYM_INVENTORY_ADAPTER);
  assert.equal(report.regionalCoverageScore, 100);
  assert.equal(report.stretchStimulusShare, 54.1);
  assert.equal(report.averageSfr, 8.07);
  assert.equal(report.jointSafetyScore, 100);
  assert.equal(report.totalScore, 98.7);
  assert.equal(report.blindSpots.length, 0);
  assert.equal(report.recommendations.length, 0);
});

test("TC10: Calibration B — Naive basic routine scores 66.9 with 9 blind spots and 3 targeted fixes", () => {
  const naive: WeeklyExerciseVolume[] = [
    { exerciseId: "bench", sets: 6 },
    { exerciseId: "squat", sets: 6 },
    { exerciseId: "deadlift-bar", sets: 4 },
    { exerciseId: "curl-bar", sets: 4 },
    { exerciseId: "skullcrusher-ez", sets: 4 },
    { exerciseId: "calf-seated", sets: 4 },
  ];

  const report = audit.auditWeek(naive, true, [], NOW, STANDARD_GYM_INVENTORY_ADAPTER);
  assert.equal(report.totalScore, 66.9);
  assert.equal(report.stretchStimulusShare, 28.6);
  assert.equal(report.blindSpots.length, 9);
  assert.equal(report.recommendations.length, 3);

  assert.equal(report.recommendations[0].mode, "swap_same_cluster");
  assert.equal(report.recommendations[0].removeExerciseId, "calf-seated");
  assert.equal(report.recommendations[0].addExerciseId, "calf-legpress");
  assert.equal(report.recommendations[1].addExerciseId, "lateral-cable-single");
  assert.equal(report.recommendations[2].addExerciseId, "rear-delt-fly");
});
