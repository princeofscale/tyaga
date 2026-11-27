import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { HypertrophyAuditEngine } from "../src/domain/HypertrophyAuditEngine";
import { EXERCISE_PROFILES_V3 } from "../src/domain/BiomechanicsCatalogV3";
import {
  buildDeloadEngineV2Signal,
  computeAccessoryProgression,
  computeNextWeekLoad,
  DAVID_LAID_DUP_V3_LIVE_PLAN,
  DAVID_LAID_DUP_V3_PLAN,
} from "../src/domain/LaidDupV3";
import { exerciseById } from "../src/lib/model";
import { LaidDupPlan } from "../src/domain/LaidDupPlan";
import { PeriodizationRules } from "../src/domain/PeriodizationRules";

describe("David Laid DUP v3 — Hypertrophy & Strength Max (TC1–TC8)", () => {
  it("TC1: On-target wave progression (bench W1 H -> W2 S) holds TM and drives load via wave", () => {
    const res = computeNextWeekLoad({
      workingTmKg: 100,
      week: 1,
      stimulus: "H",
      actualTopWeightKg: 82.5,
      actualReps: 6,
      actualRir: 2.5,
      longLevers: true,
      energyStatus: "optimal_surplus",
    });
    assert.equal(res.todayBackoffKg, 70);
    assert.equal(res.perfDelta, 0);
    assert.equal(res.tmMultiplier, 1);
    assert.equal(res.nextWorkingTmKg, 100);
    assert.equal(res.nextWeek, 2);
    assert.equal(res.nextStimulus, "S");
    assert.equal(res.nextTopWeightKg, 90);
    assert.equal(res.nextConsecutiveStalls, 0);
    assert.equal(res.triggerDeloadFlag, false);
    assert.equal(res.reason, "on_target_wave_drives_load");
  });

  it("TC2: Strength surge caps TM jump at +2.5% (squat W2 S -> W3 H)", () => {
    const res = computeNextWeekLoad({
      workingTmKg: 140,
      week: 2,
      stimulus: "S",
      actualTopWeightKg: 125,
      actualReps: 6,
      actualRir: 3.0,
      longLevers: true,
      energyStatus: "optimal_surplus",
    });
    assert.equal(res.todayBackoffKg, 110);
    assert.equal(res.perfDelta, 3.0);
    assert.equal(res.tmMultiplier, 1.025);
    assert.equal(res.nextWorkingTmKg, 143.5);
    assert.equal(res.nextWeek, 3);
    assert.equal(res.nextStimulus, "H");
    assert.equal(res.nextTopWeightKg, 125);
    assert.equal(res.reason, "capped_surge_plus_2_5pct");
  });

  it("TC3: Deficit energy status damps positive TM increase by 0.5x", () => {
    const res = computeNextWeekLoad({
      workingTmKg: 100,
      week: 2,
      stimulus: "H",
      actualTopWeightKg: 85,
      actualReps: 7,
      actualRir: 3.0,
      longLevers: true,
      energyStatus: "deficit",
    });
    assert.equal(res.todayBackoffKg, 72.5);
    assert.equal(res.perfDelta, 2.0);
    assert.equal(res.tmMultiplier, 1.0075);
    assert.equal(res.nextWorkingTmKg, 100.75);
    assert.equal(res.nextWeek, 3);
    assert.equal(res.nextStimulus, "S");
    assert.equal(res.nextTopWeightKg, 92.5);
  });

  it("TC4: Mild fatigue trim (-1%, no stall) vs hard miss rollback (-5%, stall=1)", () => {
    const mild = computeNextWeekLoad({
      workingTmKg: 140,
      week: 3,
      stimulus: "S",
      actualTopWeightKg: 130,
      actualReps: 3,
      actualRir: 0.5,
      longLevers: true,
    });
    assert.equal(mild.perfDelta, -1.0);
    assert.equal(mild.tmMultiplier, 0.99);
    assert.equal(mild.nextWorkingTmKg, 138.6);
    assert.equal(mild.nextConsecutiveStalls, 0);
    assert.equal(mild.triggerDeloadFlag, false);
    assert.equal(mild.reason, "mild_fatigue_trim_1pct");

    const hard = computeNextWeekLoad({
      workingTmKg: 140,
      week: 4,
      stimulus: "S",
      actualTopWeightKg: 132.5,
      actualReps: 1,
      actualRir: 0.0,
      longLevers: true,
    });
    assert.equal(hard.perfDelta, -3.0);
    assert.equal(hard.tmMultiplier, 0.95);
    assert.equal(hard.nextWorkingTmKg, 133.0);
    assert.equal(hard.nextConsecutiveStalls, 1);
    assert.equal(hard.triggerDeloadFlag, false);
    assert.equal(hard.reason, "hard_miss_rollback_5pct");
  });

  it("TC5: Double stall resets TM by -7.5% and triggers DeloadEngine v2 signal", () => {
    const res = computeNextWeekLoad({
      workingTmKg: 133.0,
      week: 4,
      stimulus: "S",
      actualTopWeightKg: 127.5,
      actualReps: 2,
      actualRir: 0.0,
      consecutiveStalls: 1,
      longLevers: true,
    });
    assert.equal(res.todayBackoffKg, 112.5);
    assert.equal(res.perfDelta, -2.0);
    assert.equal(res.tmMultiplier, 0.925);
    assert.equal(res.nextWorkingTmKg, 123.03);
    assert.equal(res.nextConsecutiveStalls, 2);
    assert.equal(res.triggerDeloadFlag, true);
    assert.equal(res.reason, "double_stall_reset_7_5pct_trigger_deload");

    const sig = buildDeloadEngineV2Signal({ squat: res });
    assert.equal(sig.forceActiveDeload, true);
    assert.deepEqual(sig.stalledExercises, ["squat"]);
    assert.equal(sig.disableIntensifiers, true);
  });

  it("TC6: Week 5 rep-out locks real strength gain; Week 6 active deload preserves TM into new meso", () => {
    const w5 = computeNextWeekLoad({
      workingTmKg: 105,
      week: 5,
      stimulus: "S",
      actualTopWeightKg: 102.5,
      actualReps: 5,
      actualRir: 1.0,
      longLevers: true,
      energyStatus: "optimal_surplus",
    });
    assert.equal(w5.tmMultiplier, 1.015);
    assert.equal(w5.nextWorkingTmKg, 106.57);
    assert.equal(w5.nextWeek, 6);
    assert.equal(w5.nextStimulus, "H");
    assert.equal(w5.nextTopWeightKg, 85);

    const w6 = computeNextWeekLoad({
      workingTmKg: 106.57,
      week: 6,
      stimulus: "H",
      actualTopWeightKg: 85,
      actualReps: 4,
      actualRir: 4.0,
      longLevers: true,
    });
    assert.equal(w6.tmMultiplier, 1);
    assert.equal(w6.nextWorkingTmKg, 106.57);
    assert.equal(w6.nextWeek, 1);
    assert.equal(w6.nextStimulus, "S");
    assert.equal(w6.nextTopWeightKg, 92.5);
    assert.equal(w6.reason, "deload_completed_new_meso");
  });

  it("TC7: Accessory DDP per-set upgrade, RIR Ramp, and strict Week 4-5 LP gate", () => {
    const w2 = computeAccessoryProgression({
      currentWeightKg: 20,
      repRange: [8, 12],
      loggedRepsPerSet: [12, 10, 9],
      week: 2,
      incrementKg: 2,
      isIsolation: true,
      lengthenedPartialsEligible: true,
    });
    assert.deepEqual(w2.nextSetWeights, [22, 20, 20]);
    assert.equal(w2.targetRir, 2.0);
    assert.equal(w2.enableLengthenedPartialsLastSet, false);
    assert.equal(w2.action, "ddp_per_set_upgrade");

    const w5 = computeAccessoryProgression({
      currentWeightKg: 20,
      repRange: [8, 12],
      loggedRepsPerSet: [12, 12, 10],
      week: 5,
      incrementKg: 2,
      isIsolation: true,
      lengthenedPartialsEligible: true,
    });
    assert.deepEqual(w5.nextSetWeights, [22, 22, 20]);
    assert.equal(w5.targetRir, 0.0);
    assert.equal(w5.enableLengthenedPartialsLastSet, true);

    const w6 = computeAccessoryProgression({
      currentWeightKg: 20,
      repRange: [8, 12],
      loggedRepsPerSet: [10, 9, 8],
      week: 6,
      incrementKg: 2,
      isIsolation: true,
      lengthenedPartialsEligible: true,
    });
    assert.deepEqual(w6.nextSetWeights, [18]);
    assert.equal(w6.targetRir, 4.0);
    assert.equal(w6.enableLengthenedPartialsLastSet, false);
    assert.equal(w6.action, "active_deload_50pct_volume");
  });

  it("TC8: HypertrophyAuditEngine confirms 99.1 score, 100% RCS, 0 blind spots on ref plan & 8 direct side-delt sets on live plan", () => {
    const audit = new HypertrophyAuditEngine();

    const refVolumes = DAVID_LAID_DUP_V3_PLAN.days.flatMap((d) =>
      d.exercises.map((e) => ({ exerciseId: e.exerciseId, sets: e.sets })),
    );
    for (const v of refVolumes) {
      assert.ok(exerciseById(v.exerciseId), `missing in catalog: ${v.exerciseId}`);
      assert.ok(EXERCISE_PROFILES_V3[v.exerciseId], `missing in v3 profiles: ${v.exerciseId}`);
    }

    const refReport = audit.auditWeek(refVolumes, true, [], Date.now());
    assert.ok(refReport.totalScore >= 98.5, `expected >= 98.5, got ${refReport.totalScore}`);
    assert.equal(refReport.totalScore, 99.1);
    assert.equal(refReport.regionalCoverageScore, 100);
    assert.equal(refReport.blindSpots.length, 0);
    assert.equal(refReport.averageSfr, 8.19);
    assert.equal(refReport.stretchStimulusShare, 59);
    assert.equal(refReport.totalSets, 83);

    // Live plan with 4 sets lateral in Upper B -> 8 direct side-delt sets/week
    const liveVolumes = DAVID_LAID_DUP_V3_LIVE_PLAN.days.flatMap((d) =>
      d.exercises.map((e) => ({ exerciseId: e.exerciseId, sets: e.sets })),
    );
    const liveReport = audit.auditWeek(liveVolumes, true, [], Date.now());
    assert.equal(liveReport.totalSets, 85);
    assert.equal(liveReport.regionalCoverageScore, 100);
    assert.equal(liveReport.blindSpots.length, 0);
    assert.ok(liveReport.totalScore >= 99.0, `expected live score >= 99.0, got ${liveReport.totalScore}`);
    assert.equal(liveReport.volumeBridge.regionFractionalSets.delt_mid, 8);
  });

  it("LaidDupPlan v3 integration: creates 5-day cycle, validates PeriodizationRules, upgrades v2->v3, and preserves Lower B order", () => {
    const routines = LaidDupPlan.routines({
      version: "v3",
      maxes: { squat: 140, bench: 100, deadlift: 160, ohp: 80 },
      extras: true,
      light: true,
      startMonday: "2026-11-23",
    });
    assert.equal(routines.length, 5);
    for (const r of routines) {
      const check = PeriodizationRules.check(r.periodization);
      assert.equal(check.ok, true, `PeriodizationRules failed for ${r.name}`);
      assert.equal(r.periodization?.version, "v3");
    }
    assert.equal(LaidDupPlan.totalWeeks(routines[0].periodization), 6);

    // Upper B has 4 sets on lateral (boosted side delts -> 8 direct/wk) + supersets
    const upperB = routines.find((r) => r.periodization?.day === "push2")!;
    const lateralEntry = upperB.exercises.find((e) => e.exerciseId === "lateral")!;
    assert.equal(lateralEntry.sets.length, 4);
    assert.ok(lateralEntry.supersetId?.includes("B"));

    // Lower B preserves exact order: hack-squat first, rdl second
    const lowerB = routines.find((r) => r.periodization?.day === "legs2")!;
    assert.equal(lowerB.exercises[0].exerciseId, "hack-squat");
    assert.equal(lowerB.exercises[1].exerciseId, "rdl");

    // Week 6 is active deload
    const w6 = LaidDupPlan.day("push1", 5, { squat: 140, bench: 100, deadlift: 160, ohp: 80 }, { version: "v3" });
    assert.equal(w6.isDeload, true);
    assert.equal(w6.v3Week, 6);
    assert.equal(w6.work.sets, 1);

    // Upgrade v2 -> v3 produces 5 valid v3 routines
    const v2 = LaidDupPlan.routines({
      version: "v2",
      maxes: { squat: 140, bench: 100, deadlift: 160, ohp: 60 },
      extras: true,
      light: true,
      startMonday: "2026-11-23",
    });
    const upgraded = LaidDupPlan.upgradeCycleToV3(v2);
    assert.equal(upgraded.length, 5);
    assert.equal(upgraded[0].periodization?.version, "v3");
    assert.equal(upgraded[0].periodization?.maxes.ohp, 80); // auto-scaled incline TM from 100 kg bench
  });
});
