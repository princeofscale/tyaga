import test from "node:test";
import assert from "node:assert/strict";
import { OneRepMaxFormulas } from "../src/domain/OneRepMaxFormulas";
import { ProgressionEngine, toProgressionInventory } from "../src/domain/ProgressionEngine";
import { IntraSessionAutoregulator } from "../src/domain/IntraSessionAutoregulator";
import { DeloadEngine } from "../src/domain/DeloadEngine";
import { MuscleReadiness } from "../src/domain/MuscleReadiness";
import { SmartCoach } from "../src/domain/SmartCoach";
import { LaidDupPlan } from "../src/domain/LaidDupPlan";
import { ExerciseAvoidStore } from "../src/domain/SubstitutionPolicy";
import { addCalendarDays } from "../src/lib/calendar";
import { makeExerciseEntry, makeWorkout } from "../src/lib/model";
import type { Routine, Workout } from "../src/lib/types";

function makeDoneSession(
  id: string,
  date: string,
  entries: Array<{
    exerciseId: string;
    sets: Array<{ weight: number; reps: number; rir: number | null }>;
  }>,
  isoTime?: string,
): Workout {
  const w = makeWorkout(
    entries.map((e) => e.exerciseId),
    [],
    "UTC",
  );
  w.id = id;
  w.date = date;
  if (isoTime) {
    w.createdAt = isoTime;
    w.updatedAt = isoTime;
  }
  w.exercises = w.exercises.map((ex, idx) => ({
    ...ex,
    sets: entries[idx].sets.map((s, si) => ({
      id: `${id}-${idx}-${si}`,
      weight: s.weight,
      reps: s.reps,
      rir: s.rir,
      warmup: false,
      done: true,
    })),
  }));
  return w;
}

// 1. e1rm_null_rir_fallback
test("1. e1rm_null_rir_fallback: weight=100, reps=5, rir=null -> RIR_eff=1.5, R_tot=6.5 (Epley), confidence=0.45", () => {
  const res = OneRepMaxFormulas.estimateV2({
    weight: 100,
    reps: 5,
    rir: null,
    loadMode: "total_external",
    currentBodyweightKg: 80,
    isWarmup: false,
    e1rmEligible: true,
  });
  assert.equal(res.isFallbackRIR, true);
  assert.equal(res.isExcludedFromTrend, false);
  assert.equal(res.effectiveReps, 6.5);
  assert.equal(res.e1rm, Math.round(100 * (1 + 0.0333 * 6.5) * 10) / 10);
  assert.equal(res.confidence, 0.45);
});

// 2. e1rm_high_rep_exclusion
test("2. e1rm_high_rep_exclusion: weight=20, reps=16, rir=4 (R_tot=19.75 > 18) -> excluded from trend", () => {
  const res = OneRepMaxFormulas.estimateV2({
    weight: 20,
    reps: 16,
    rir: 4,
    loadMode: "per_implement",
    currentBodyweightKg: 80,
    isWarmup: false,
    e1rmEligible: true,
  });
  assert.equal(res.effectiveReps, 19.75);
  assert.equal(res.isExcludedFromTrend, true);
  assert.equal(res.e1rm, 0);
});

// 3. ddp_equipment_jump_guard
test("3. ddp_equipment_jump_guard: 10kg DB (8-12) with 2kg step (20% > 12.5%) extends rep cap to 14 instead of jumping to 12kg", () => {
  const recs = ProgressionEngine.recommendDdpSets({
    previousSets: [{ weight: 10, reps: 12, rir: 2 }],
    repMin: 8,
    repMax: 12,
    loadMode: "per_implement",
    stepOverrideKg: 2,
  });
  assert.equal(recs.length, 1);
  assert.equal(recs[0].recommendedWeight, 10);
  assert.equal(recs[0].effectiveRepMax, 14);
  assert.equal(recs[0].recommendedReps, 13);
  assert.equal(recs[0].action, "increase_reps");
});

// 4. ddp_overreached_rir
test("4. ddp_overreached_rir: 80x10 @ RIR 0 in 8-10 @ RIR 1-2 holds weight at 80", () => {
  const recs = ProgressionEngine.recommendDdpSets({
    previousSets: [{ weight: 80, reps: 10, rir: 0 }],
    repMin: 8,
    repMax: 10,
    rirMin: 1,
    rirMax: 2,
    loadMode: "total_external",
  });
  assert.equal(recs[0].action, "hold_improve_rir");
  assert.equal(recs[0].recommendedWeight, 80);
});

// 5. dup_tm_hysteresis
test("5. dup_tm_hysteresis: 1st positive session holds (streak=1), 2nd consecutive positive raises TM +1.25% and resets streak", () => {
  // P_delta = (6 - 4) + 0.7*(2 - 2) = +2.0 -> pending_increase
  const first = ProgressionEngine.evaluateTmUpdate({
    currentTM: 100,
    targetReps: 4,
    targetRIR: 2,
    actualReps: 6,
    actualRIR: 2,
    positiveStreak: 0,
    negativeStreak: 0,
  });
  assert.equal(first.changePct, 0);
  assert.equal(first.status, "pending_increase");
  assert.equal(first.stateUpdated.positiveStreak, 1);

  // 2nd consecutive positive: P_delta = (5 - 4) + 0.7*(3.15 - 2) ≈ +1.8
  const second = ProgressionEngine.evaluateTmUpdate({
    currentTM: first.newTM,
    targetReps: 4,
    targetRIR: 2,
    actualReps: 5,
    actualRIR: 3.15,
    positiveStreak: first.stateUpdated.positiveStreak,
    negativeStreak: first.stateUpdated.negativeStreak,
  });
  assert.equal(second.changePct, 0.0125);
  assert.equal(second.status, "increased");
  assert.equal(second.newTM, 101.5);
  assert.equal(second.stateUpdated.positiveStreak, 0);
  assert.equal(second.stateUpdated.negativeStreak, 0);
});

// 6. detraining_20_days
test("6. detraining_20_days: 20-day gap applies 0.85 weight (rounded to 2.5kg) and 0.65 volume", () => {
  const inv = toProgressionInventory({ barWeightKg: 20, minPlateKg: 1.25 });
  const plan = ProgressionEngine.applyDetrainingToPlan(100, 4, 20, "total_external", inv);
  assert.equal(plan.plan.active, true);
  assert.equal(plan.plan.weightMultiplier, 0.85);
  assert.equal(plan.plan.volumeMultiplier, 0.65);
  assert.equal(plan.weightKg, 85);
  assert.equal(plan.setsCount, 3); // round(4 * 0.65) = 3
});

// 7. intra_session_deadzone
test("7. intra_session_deadzone: 100x5 @ RIR 1 vs target 100x5 @ RIR 2 (E_dev = -1.0) stays silent", () => {
  const adj = IntraSessionAutoregulator.evaluate({
    exerciseId: "squat",
    isCompoundAxial: true,
    loadMode: "total_external",
    plannedWeight: 100,
    targetReps: 5,
    targetRIR: 2,
    actualReps: 5,
    actualRIR: 1,
    remainingSetsCount: 3,
  });
  assert.equal(adj.deviation, -1);
  assert.equal(adj.shouldNotify, false);
  assert.equal(adj.status, "deadzone");
});

// 8. intra_session_severe_drop
test("8. intra_session_severe_drop: 100x3 @ RIR 0 vs target 100x5 @ RIR 2 (E_dev = -4.0) drops -10% to 90kg + Stop-Set", () => {
  const adj = IntraSessionAutoregulator.evaluate({
    exerciseId: "squat",
    isCompoundAxial: true,
    loadMode: "total_external",
    plannedWeight: 100,
    targetReps: 5,
    targetRIR: 2,
    actualReps: 3,
    actualRIR: 0,
    remainingSetsCount: 3,
  });
  assert.equal(adj.deviation, -4);
  assert.equal(adj.shouldNotify, true);
  assert.equal(adj.status, "severe_drop");
  assert.equal(adj.adjustedWeight, 90);
  assert.equal(adj.dropLastSet, true);
});

// Helper to build a realistic 30-day David Laid DUP v2 workout stream (~220 sets/30d, 3-on / 1-off)
function buildDupV2History(today: string, opts?: { fatigueLast7d?: boolean }): Workout[] {
  const workouts: Workout[] = [];
  for (let offset = 31; offset >= 0; offset--) {
    const dayIndex = 31 - offset;
    const mod = dayIndex % 4;
    if (mod === 3) continue; // 3-on / 1-off
    const date = addCalendarDays(today, -offset);
    const inFatigueWindow = Boolean(opts?.fatigueLast7d) && offset <= 6;
    const weekBoost = Math.floor(dayIndex / 8) * 1.25;
    const loadMult = inFatigueWindow ? 0.94 : 1.0;
    const rir = inFatigueWindow ? 0 : 2;
    const rirAux = inFatigueWindow ? 0 : 2;

    if (mod === 0) {
      // Legs: 4 squat + 16 accessory (20 sets)
      workouts.push(
        makeDoneSession(`legs-${offset}`, date, [
          {
            exerciseId: "squat",
            sets: Array.from({ length: 4 }, () => ({
              weight: Math.round((110 + weekBoost) * loadMult * 2) / 2,
              reps: 5,
              rir,
            })),
          },
          {
            exerciseId: "legpress",
            sets: Array.from({ length: 6 }, () => ({ weight: 160, reps: 10, rir: rirAux })),
          },
          {
            exerciseId: "leg-extension",
            sets: Array.from({ length: 5 }, () => ({ weight: 55, reps: 12, rir: rirAux })),
          },
          {
            exerciseId: "calf-legpress",
            sets: Array.from({ length: 5 }, () => ({ weight: 120, reps: 15, rir: rirAux })),
          },
        ]),
      );
    } else if (mod === 1) {
      // Push: 5 bench + 16 accessory (21 sets)
      workouts.push(
        makeDoneSession(`push-${offset}`, date, [
          {
            exerciseId: "bench",
            sets: Array.from({ length: 5 }, () => ({
              weight: Math.round((85 + weekBoost) * loadMult * 2) / 2,
              reps: 5,
              rir,
            })),
          },
          {
            exerciseId: "incline-db",
            sets: Array.from({ length: 5 }, () => ({ weight: 28, reps: 10, rir: rirAux })),
          },
          {
            exerciseId: "lateral-cable-single",
            sets: Array.from({ length: 6 }, () => ({ weight: 10, reps: 15, rir: rirAux })),
          },
          {
            exerciseId: "extension-v-pushdown",
            sets: Array.from({ length: 5 }, () => ({ weight: 30, reps: 12, rir: rirAux })),
          },
        ]),
      );
    } else {
      // Pull: 2 trap-bar + 4 chest-supported row + 14 isolation (20 sets)
      workouts.push(
        makeDoneSession(`pull-${offset}`, date, [
          {
            exerciseId: "trap-bar-deadlift",
            sets: Array.from({ length: 2 }, () => ({
              weight: Math.round((130 + weekBoost) * loadMult * 2) / 2,
              reps: 5,
              rir,
            })),
          },
          {
            exerciseId: "row-chest-supported",
            sets: Array.from({ length: 4 }, () => ({ weight: 65, reps: 10, rir: rirAux })),
          },
          {
            exerciseId: "lat-pulldown",
            sets: Array.from({ length: 5 }, () => ({ weight: 65, reps: 10, rir: rirAux })),
          },
          {
            exerciseId: "rear-delt-fly",
            sets: Array.from({ length: 5 }, () => ({ weight: 10, reps: 15, rir: rirAux })),
          },
          {
            exerciseId: "curl-bar",
            sets: Array.from({ length: 4 }, () => ({ weight: 25, reps: 12, rir: rirAux })),
          },
        ]),
      );
    }
  }
  return workouts;
}

// 9. deload_sanity_dup_normal
test("9. deload_sanity_dup_normal: normal 30-day DUP v2 (~220+ sets, RIR 2, rising e1RM) returns optimal and no false deload", () => {
  const today = "2026-11-26";
  const workouts = buildDupV2History(today, { fatigueLast7d: false });
  const evalV2 = DeloadEngine.evaluateV2(workouts, {
    today,
    now: new Date(`${today}T12:00:00Z`),
    timeZone: "UTC",
    isLongLimbed: true,
    energyStatus: "optimal_surplus",
  });
  assert.equal(evalV2.status, "optimal");
  assert.equal(evalV2.recommendedMode, "none");
  assert.ok(evalV2.axialUtilization < 1.0, `Expected axialUtilization < 1.0, got ${evalV2.axialUtilization}`);
  assert.ok(evalV2.localUtilization < 1.0, `Expected localUtilization < 1.0, got ${evalV2.localUtilization}`);
});

// 10. deload_trigger_hidden_fatigue
test("10. deload_trigger_hidden_fatigue: same DUP v2 volume with e1RM drop and negative RIR drift triggers volume_deload", () => {
  const today = "2026-11-26";
  const workouts = buildDupV2History(today, { fatigueLast7d: true });
  const evalV2 = DeloadEngine.evaluateV2(workouts, {
    today,
    now: new Date(`${today}T12:00:00Z`),
    timeZone: "UTC",
    isLongLimbed: true,
    energyStatus: "optimal_surplus",
  });
  assert.equal(evalV2.status, "deload_recommended");
  assert.equal(evalV2.recommendedMode, "volume_deload");
  assert.ok(evalV2.triggeredSignals.includes("S1_e1rm_drop"));
  assert.ok(evalV2.triggeredSignals.includes("S2_rir_drift"));
});

// 11. readiness_multi_day_eccentric
test("11. readiness_multi_day_eccentric: 6 sets RDL (24h ago) -> hamstrings recovering (<75%), 6 sets lateral raise (24h ago) -> side_rear_delts fresh (>85%)", () => {
  const today = "2026-11-26";
  const yesterday = "2026-11-25";
  const now = new Date(`${today}T12:00:00Z`);
  const workouts = [
    makeDoneSession(
      "rdl-lat",
      yesterday,
      [
        {
          exerciseId: "rdl",
          sets: Array.from({ length: 6 }, () => ({ weight: 100, reps: 8, rir: 1 })),
        },
        {
          exerciseId: "lateral-cable-single",
          sets: Array.from({ length: 6 }, () => ({ weight: 10, reps: 15, rir: 1 })),
        },
      ],
      `${yesterday}T12:00:00Z`,
    ),
  ];

  const items = MuscleReadiness.fromWorkoutsV2(workouts, today, "UTC", now);
  const byId = Object.fromEntries(items.map((x) => [x.id, x]));

  assert.ok(byId.hamstrings.readinessPct < 75, `Expected hamstrings < 75%, got ${byId.hamstrings.readinessPct}`);
  assert.equal(byId.hamstrings.status, "recovering");
  assert.ok(byId.side_rear_delts.readinessPct > 85, `Expected side_rear_delts > 85%, got ${byId.side_rear_delts.readinessPct}`);
  assert.equal(byId.side_rear_delts.status, "fresh");
});

// 12. smartcoach_silence_on_deload
test("12. smartcoach_silence_on_deload: active deload_recommended suppresses all weight-increase recommendations from ProgressionEngine", () => {
  const today = "2026-11-26";
  // History triggers deload_recommended (S1 + S2) AND has an accessory that cleanly hit repMax
  const workouts = buildDupV2History(today, { fatigueLast7d: true });
  const routine: Routine = {
    id: "r-hyper-1",
    name: "Гипертрофия",
    notes: "",
    days: [1, 3, 5],
    exercises: [makeExerciseEntry("incline-db"), makeExerciseEntry("lateral-cable-single")],
    restSeconds: 90,
    progression: "double",
    repMin: 8,
    repMax: 10,
    incrementKg: 2.5,
    revision: 1,
  };

  const report = SmartCoach.analyze(
    workouts,
    [routine],
    today,
    "UTC",
    new Date(`${today}T12:00:00Z`),
    undefined,
    null,
    { isLongLimbed: true, energyStatus: "optimal_surplus" },
  );

  assert.equal(report.v2.state, "OVERLOAD_WARNING");
  assert.equal(report.v2.silenceActive, true);
  assert.equal(report.v2.weightIncreaseRecommendations.length, 0);
  assert.ok(report.v2.actions.length <= 3);
  assert.ok(report.v2.actions.every((a) => a.kind !== "progression" && a.kind !== "plateau"));
});

// 13. laid_v2_tm_autoreg_hysteresis
test("13. laid_v2_tm_autoreg_hysteresis: 1 easy DUP v2 bench top set holds, 2 consecutive easy top sets suggest TM bump", () => {
  const cycle = LaidDupPlan.routines({
    version: "v2",
    maxes: { squat: 120, bench: 100, deadlift: 150, ohp: 65 },
    extras: true,
    light: false,
    startMonday: "2026-11-02",
  });
  const first = cycle[0].periodization!;
  const w1Plan = LaidDupPlan.day("push1", 0, first.maxes, { version: "v2", light: false });
  const w2Plan = LaidDupPlan.day("push1", 1, first.maxes, { version: "v2", light: false });

  // 1st easy top set (+2 reps above planned at RIR 3) -> still pending (hysteresis)
  const s1 = makeDoneSession("dup-b1", "2026-11-03", [
    {
      exerciseId: "bench",
      sets: [{ weight: w1Plan.heavy.weightKg, reps: w1Plan.heavy.reps + 2, rir: 3 }],
    },
  ]);
  assert.equal(LaidDupPlan.tmAutoregSuggestions(first, [s1], "2026-11-12").length, 0);

  // 2nd consecutive easy top set -> triggers TM bump
  const s2 = makeDoneSession("dup-b2", "2026-11-10", [
    {
      exerciseId: "bench",
      sets: [{ weight: w2Plan.heavy.weightKg, reps: w2Plan.heavy.reps + 2, rir: 3 }],
    },
  ]);
  const suggestions = LaidDupPlan.tmAutoregSuggestions(first, [s1, s2], "2026-11-12");
  assert.equal(suggestions.length, 1);
  assert.equal(suggestions[0].lift, "bench");
  assert.equal(suggestions[0].status, "increased");
  assert.ok(suggestions[0].toMax > first.maxes.bench);
});

const trendNow = new Date("2026-11-26T12:00:00Z");
const trendOptions = { now: trendNow, timeZone: "UTC" };
const trendEntries = (weight: number, reps: number, rir: number, ids = ["bench"]) =>
  ids.map((exerciseId) => ({ exerciseId, sets: Array.from({ length: 3 }, () => ({ weight, reps, rir })) }));

test("repeating the same stronger and lighter sessions does not count as a drop", () => {
  const assessment = DeloadEngine.evaluateV2([
    makeDoneSession("prior-heavy", "2026-11-10", trendEntries(100, 6, 2)),
    makeDoneSession("prior-light", "2026-11-12", trendEntries(90, 6, 2)),
    makeDoneSession("recent-heavy", "2026-11-24", trendEntries(100, 6, 2)),
    makeDoneSession("recent-light", "2026-11-25", trendEntries(90, 6, 2)),
  ], trendOptions);
  assert.deepEqual(assessment.e1rmDropExercises, []);
  assert.equal(assessment.recommendedMode, "none");
});

test("a change of set-level ROM must not be interpreted as a loss of strength", () => {
  const before = makeDoneSession("prior-partial", "2026-11-10", trendEntries(100, 6, 2));
  for (const set of before.exercises[0].sets) set.execution = { rom: "lengthened_partial" };
  const after = makeDoneSession("current-full", "2026-11-25", trendEntries(85, 6, 2));
  for (const set of after.exercises[0].sets) set.execution = { rom: "full" };
  assert.ok(!DeloadEngine.evaluateV2([before, after], trendOptions).triggeredSignals.includes("S1_e1rm_drop"));
});

test("RIR drift does not compare readings of different machines", () => {
  const ids = ["lat-pulldown", "row"];
  const before = makeDoneSession("prior-machine", "2026-11-10", trendEntries(65, 8, 3, ids));
  const after = makeDoneSession("new-machine", "2026-11-25", trendEntries(50, 8, 1, ids));
  for (const entry of before.exercises) entry.machineInstanceId = "gym-a:" + entry.exerciseId;
  for (const entry of after.exercises) entry.machineInstanceId = "gym-b:" + entry.exerciseId;
  const assessment = DeloadEngine.evaluateV2([before, after], trendOptions);
  assert.ok(!assessment.triggeredSignals.includes("S2_rir_drift"));
  assert.equal(assessment.rirDrift, null);
});

test("fewer reps after switching to heavier sets do not trigger a rep-drop signal", () => {
  const ids = ["bench", "squat"];
  const assessment = DeloadEngine.evaluateV2([
    makeDoneSession("prior", "2026-11-10", trendEntries(100, 10, 2, ids)),
    makeDoneSession("recent", "2026-11-25", trendEntries(110, 7, 2, ids)),
  ], trendOptions);
  assert.ok(!assessment.triggeredSignals.includes("S4_rep_drop"));
});

test("fewer reps with intentionally more reserve do not signal loss of performance", () => {
  const ids = ["bench", "squat"];
  const assessment = DeloadEngine.evaluateV2([
    makeDoneSession("prior", "2026-11-10", trendEntries(100, 8, 1, ids)),
    makeDoneSession("recent", "2026-11-25", trendEntries(100, 5, 4, ids)),
  ], trendOptions);
  assert.ok(!assessment.triggeredSignals.includes("S4_rep_drop"));
});

test("repeated pain alone produces a caution, not a green verdict or a training protocol", () => {
  const workouts = [makeDoneSession("single", "2026-11-25", trendEntries(80, 6, 2))];
  const assessment = DeloadEngine.evaluateV2(workouts, { ...trendOptions, corePainRepeated: true });
  assert.ok(assessment.triggeredSignals.includes("S5_pain"));
  assert.notEqual(assessment.status, "optimal");
  assert.equal(assessment.protocolParams, null);
});

test("a completed calendar cycle stops counting as active deload after the post-cycle week", () => {
  const routines = LaidDupPlan.routines({
    maxes: { squat: 120, bench: 100, deadlift: 150, ohp: 65 },
    extras: true,
    light: false,
    startMonday: "2026-09-07",
  });
  const report = SmartCoach.analyze([], routines, "2026-11-16", "UTC", new Date("2026-11-16T12:00:00Z"));
  assert.equal(report.activeDeload, null);
  assert.notEqual(report.v2.state, "DELOAD_ACTIVE");
});

test("a movement marked with pain does not get a recommendation to increase weight", (t) => {
  t.mock.method(ExerciseAvoidStore.prototype, "read", () => [
    { exerciseId: "bench", reason: "pain", addedAt: "2026-11-25" },
  ]);
  const routines: Routine[] = [{
    id: "double", name: "Double", notes: "", days: [1],
    exercises: [makeExerciseEntry("bench"), makeExerciseEntry("squat")],
    restSeconds: 120, progression: "double", repMin: 8, repMax: 10, incrementKg: 2.5, revision: 1,
  }];
  const workouts = [makeDoneSession("routine", "2026-11-25", trendEntries(80, 10, 2, ["bench", "squat"]))];
  const report = SmartCoach.analyze(workouts, routines, "2026-11-26", "UTC", trendNow, "test-account");
  assert.equal(report.painFlagsSummary.count, 1);
  assert.deepEqual(report.v2.weightIncreaseRecommendations.map((rec) => rec.exerciseId), ["squat"]);
});
