import test from "node:test";
import assert from "node:assert/strict";
import {
  AdaptiveNutritionEngine,
  AdaptiveTdeeEstimator,
  MacroPeriodizer,
  NutritionPhaseController,
  NutritionStore,
  type BodyweightEntry,
  type DailyNutritionLog,
  type NutritionProfile,
} from "../src/domain/AdaptiveNutritionEngine";
import { BodyweightTracker } from "../src/domain/BodyweightTracker";
import { SmartCoach } from "../src/domain/SmartCoach";
import { makeWorkout } from "../src/lib/model";

function isoDay(baseIso: string, offsetDays: number): string {
  const [y, m, d] = baseIso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) + offsetDays * 86_400_000).toISOString().slice(0, 10);
}

const PROFILE: NutritionProfile = {
  sex: "male",
  ageYears: 26,
  heightCm: 185,
  weightKg: 82.0,
  bodyFatPct: 14,
  neatLevel: "moderate",
  weeklyTrainingSessions: 5,
  trainingLevel: "intermediate",
  longLevers: false,
};

test("Creatine mask does not ratchet phantom weight loss from flat oscillating scale noise", () => {
  const est = new AdaptiveTdeeEstimator();
  const start = "2026-01-01";
  const creatineStart = isoDay(start, 7);
  const weighIns: BodyweightEntry[] = [];
  const logs: DailyNutritionLog[] = [];
  for (let d = 0; d <= 28; d++) {
    // Perfectly flat mean 82.0 kg with ±0.35 kg daily water noise, NO real creatine gain
    const noise = d % 2 === 0 ? -0.35 : 0.35;
    weighIns.push({ date: isoDay(start, d), weightKg: Number((82.0 + noise).toFixed(2)) });
    logs.push({ date: isoDay(start, d), caloriesKcal: 3000, dayType: "push" });
  }
  const rep = est.estimateTdee(PROFILE, weighIns, logs, "maintenance", null, creatineStart);
  const lastPt = rep.trendSeries[rep.trendSeries.length - 1];
  assert.ok(
    lastPt.creatineOffsetKg <= 0.15,
    `Flat oscillating scale should not accumulate phantom creatine offset (got ${lastPt.creatineOffsetKg} kg)`,
  );
  assert.ok(
    Math.abs(rep.metabolicTrendWeightKg - rep.trendWeightKg) <= 0.15,
    `Metabolic trend (${rep.metabolicTrendWeightKg}) diverged from flat scale (${rep.trendWeightKg})`,
  );
});

test("Holding low adherence clears stale 14d intake/balance, grows Kalman P uncertainty, and enforces RED-S safety floor", () => {
  const est = new AdaptiveTdeeEstimator();
  const ctrl = new NutritionPhaseController();
  const start = "2026-01-01";
  const weighIns: BodyweightEntry[] = [];
  const logs: DailyNutritionLog[] = [];
  // Days 0..20: full logging in deficit (2400 kcal)
  for (let d = 0; d <= 42; d++) {
    weighIns.push({ date: isoDay(start, d), weightKg: Number((82.0 - Math.min(d, 20) * 0.05).toFixed(2)) });
    if (d <= 20) {
      logs.push({ date: isoDay(start, d), caloriesKcal: 2400, dayType: "push" });
    }
  }
  const repConverged = est.estimateTdee(PROFILE, weighIns.slice(0, 21), logs, "cut", isoDay(start, 20));
  // 22 days later with ZERO new logs -> currently holding_low_adherence
  const repStale = est.estimateTdee(PROFILE, weighIns, logs, "cut", isoDay(start, 42));
  assert.equal(repStale.status, "holding_low_adherence");
  assert.equal(repStale.avgIntake14dKcal, null, "Must not emit weeks-old avgIntake14dKcal during low adherence");
  assert.equal(repStale.netEnergyBalanceKcal, null, "Must not emit weeks-old netEnergyBalanceKcal during low adherence");
  assert.ok(
    (repStale.uncertaintySdKcal ?? 0) > (repConverged.uncertaintySdKcal ?? 0),
    `Expected Kalman uncertainty SD to grow during low adherence (${repStale.uncertaintySdKcal} vs ${repConverged.uncertaintySdKcal})`,
  );

  // RED-S safety floor must NOT be bypassed during holding_low_adherence when previousTarget < safetyFloorKcal
  const checkIn = ctrl.computeWeeklyCheckIn(repStale, PROFILE, "cut", {
    previousTargetKcal: 1800, // dangerously below EA>=30 floor (~2350 kcal)
    weeksInPhase: 6,
  });
  assert.ok(
    checkIn.nextTargetKcal !== null && checkIn.nextTargetKcal >= checkIn.safetyFloorKcal,
    `Expected nextTargetKcal (${checkIn.nextTargetKcal}) >= safetyFloorKcal (${checkIn.safetyFloorKcal})`,
  );
  assert.equal(checkIn.safetyFloorHit, true);
  assert.ok((checkIn.achievedEaKcalPerKgFfm ?? 0) >= 30.0);
});

test("1-9 sparse logs preserve Lite energy bridge fallback; duplicate dates do not inflate validLogsLast28; Lite 0 weigh-ins emits 0 hint; future weigh-ins truncated; MacroPeriodizer carbs >= 50g", () => {
  const engine = new AdaptiveNutritionEngine();
  const start = "2026-01-01";
  const weighIns: BodyweightEntry[] = [];
  for (let d = 0; d <= 21; d++) {
    weighIns.push({ date: isoDay(start, d), weightKg: Number((82.0 + d * 0.041).toFixed(3)) });
  }
  // 2 sparse calorie logs + duplicate entries on same date
  const sparseLogs: DailyNutritionLog[] = [
    { date: isoDay(start, 18), caloriesKcal: 3100, dayType: "push" },
    { date: isoDay(start, 18), caloriesKcal: 3150, dayType: "push" },
    { date: isoDay(start, 19), caloriesKcal: 3100, dayType: "push" },
  ];
  const sparseRes = engine.runFullCycle({
    profile: PROFILE,
    weighIns,
    nutritionLogs: sparseLogs,
    goalMode: "lean_bulk",
    todayDayType: "push",
    asOfDate: isoDay(start, 21),
  });
  assert.equal(
    sparseRes.energyBridge.energyStatus,
    "optimal_surplus",
    "1-9 uncalibrated calorie logs must not degrade good 21d weight trend to unknown",
  );

  // Lite mode with 0 weigh-ins must NOT emit a +170 kcal adjustment hint
  const emptyRes = engine.runFullCycle({
    profile: PROFILE,
    weighIns: [],
    nutritionLogs: [],
    goalMode: "lean_bulk",
    todayDayType: "push",
  });
  assert.equal(emptyRes.checkIn.kcalDeltaHint, 0);
  assert.equal(emptyRes.checkIn.adjustmentReason, "lite_insufficient_data");

  // Future weigh-ins after asOfDate must be ignored
  const withFuture: BodyweightEntry[] = [
    ...weighIns,
    { date: isoDay(start, 35), weightKg: 95.0 },
  ];
  const truncated = engine.tdeeEstimator.estimateTdee(
    PROFILE,
    withFuture,
    [],
    "maintenance",
    isoDay(start, 21),
  );
  assert.ok(
    truncated.trendWeightKg < 84,
    `Future weigh-in after asOfDate leaked into trendWeightKg=${truncated.trendWeightKg}`,
  );

  // MacroPeriodizer with low targetKcal and enableCycling=true must never produce negative carbs
  const periodizer = new MacroPeriodizer();
  const lowCalRest = periodizer.allocateDailyMacros(1500, 100, 82, "male", "mini_cut", "rest", 2500, true);
  assert.ok(lowCalRest.carbsG >= 50, `Expected carbsG >= 50 on tight cut rest day, got ${lowCalRest.carbsG}`);

  // NutritionStore rejects invalid calendar date like 2026-02-31
  const mem = new Map<string, string>();
  const store = new NutritionStore("acc-cal", {
    getItem: (k) => mem.get(k) ?? null,
    setItem: (k, v) => { mem.set(k, v); },
  });
  mem.set(
    "tyaga-nutrition-v5:acc-cal",
    JSON.stringify({
      ...NutritionStore.createDefaultState("2026-05-01"),
      creatineStartDate: "2026-02-31",
      logs: [{ date: "2026-02-31", caloriesKcal: 2500 }],
    }),
  );
  const read = store.readRaw("2026-05-01");
  assert.equal(read?.creatineStartDate, null);
  assert.equal(read?.logs.length, 0);
});

test("BodyweightTracker.getNeatVerdict normalizes elapsed days, treats neutral goal neutrally, and SmartCoach reads BodyweightJournal cache", () => {
  const mem = new Map<string, string>();
  const adapter = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, v); },
  };
  const tracker = new BodyweightTracker("u-rate", "UTC", adapter);
  tracker.setGoal(90);
  // Two entries on days -7,-6 (prev7) and two entries on days -5,-4 (recent7): only 2 days apart!
  tracker.addEntry(80.0, "2026-11-10");
  tracker.addEntry(80.0, "2026-11-11");
  tracker.addEntry(80.4, "2026-11-12");
  tracker.addEntry(80.4, "2026-11-13");
  const shortSpan = tracker.getNeatVerdict("2026-11-17");
  assert.equal(shortSpan.status, "insufficient", "Weigh-ins spanning <7 days must not claim a 14d rate");

  // Neutral goal (no targetWeightKg set) at steady weight must NOT force lean-bulk "+150-250 kcal" NEAT plateau advice
  const memNeutral = new Map<string, string>();
  const neutralTracker = new BodyweightTracker("u-neutral", "UTC", {
    getItem: (k) => memNeutral.get(k) ?? null,
    setItem: (k, v) => { memNeutral.set(k, v); },
  });
  neutralTracker.addEntry(80.0, "2026-11-01");
  neutralTracker.addEntry(80.0, "2026-11-03");
  neutralTracker.addEntry(80.0, "2026-11-10");
  neutralTracker.addEntry(80.0, "2026-11-12");
  const neutralVerdict = neutralTracker.getNeatVerdict("2026-11-13");
  assert.equal(neutralVerdict.goalMode, "neutral");
  assert.notEqual(
    neutralVerdict.status,
    "neat_plateau",
    "Neutral/no-goal steady weight must not push bulk surplus advice",
  );

  // SmartCoach reads live BodyweightJournal sync cache (tyaga-bodyweight-sync:<accountId>)
  const origLocalStorage = (globalThis as any).localStorage;
  const fakeLsMap = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (k: string) => fakeLsMap.get(k) ?? null,
    setItem: (k: string, v: string) => { fakeLsMap.set(k, v); },
    removeItem: (k: string) => { fakeLsMap.delete(k); },
    get length() { return fakeLsMap.size; },
    key: (i: number) => [...fakeLsMap.keys()][i] ?? null,
  };
  try {
    const syncEntries = Array.from({ length: 16 }, (_, i) => ({
      id: `bw-${i}`,
      date: isoDay("2026-11-01", i),
      weightKg: Number((85.0 - i * 0.1).toFixed(2)), // losing ~0.7 kg/wk = -0.82%/wk -> deficit!
      createdAt: 1_795_000_000_000 + i * 86_400_000,
    }));
    fakeLsMap.set(
      "tyaga-bodyweight-sync:acc-sync-bw",
      JSON.stringify({
        entries: syncEntries,
        goal: { targetWeightKg: null, startWeightKg: null },
        revisions: {},
        pending: {},
        conflicts: {},
      }),
    );
    const w = makeWorkout(["bench"], [], "UTC");
    w.date = "2026-11-16";
    w.exercises[0].sets[0] = { ...w.exercises[0].sets[0], weight: 80, reps: 8, rir: 2, done: true };
    const report = SmartCoach.analyze([w], [], "2026-11-16", "UTC", new Date("2026-11-16T12:00:00Z"), "acc-sync-bw");
    assert.equal(
      report.v2.energyStatus,
      "deficit",
      `Expected SmartCoach to detect deficit from BodyweightJournal cache, got ${report.v2.energyStatus}`,
    );
  } finally {
    if (origLocalStorage === undefined) delete (globalThis as any).localStorage;
    else (globalThis as any).localStorage = origLocalStorage;
  }
});
