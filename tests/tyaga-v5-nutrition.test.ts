import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AdaptiveNutritionEngine,
  AdaptiveTdeeEstimator,
  EnergyStatusBridge,
  MacroPeriodizer,
  NutritionPhaseController,
  NutritionStore,
  type BodyweightEntry,
  type DailyNutritionLog,
  type NutritionProfile,
  type TdeeEstimateReport,
} from "../src/domain/AdaptiveNutritionEngine";

function isoDay(baseIso: string, offsetDays: number): string {
  const [y, m, d] = baseIso.split("-").map(Number);
  const ms = Date.UTC(y, m - 1, d) + offsetDays * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}

const BASE_PROFILE: NutritionProfile = {
  sex: "male",
  ageYears: 26,
  heightCm: 188,
  weightKg: 82.0,
  neatLevel: "moderate",
  weeklyTrainingSessions: 5.25,
  trainingLevel: "intermediate",
  longLevers: true,
};

const BASE_PROFILE_BF14: NutritionProfile = {
  ...BASE_PROFILE,
  bodyFatPct: 14,
};

describe("Tyaga v5 — AdaptiveNutritionEngine (TC1–TC10)", () => {
  const estimator = new AdaptiveTdeeEstimator();
  const controller = new NutritionPhaseController();
  const periodizer = new MacroPeriodizer();
  const bridge = new EnergyStatusBridge();
  const engine = new AdaptiveNutritionEngine();

  it("TC1: Cold start prior TDEE — Janmahasatian, Boer, and Katch-McArdle (BF=14%)", () => {
    const a = estimator.estimatePriorTdee({ ...BASE_PROFILE, ffmFormula: "janmahasatian" });
    assert.equal(a.bmrMethod, "mifflin_st_jeor");
    assert.equal(a.ffmMethod, "janmahasatian");
    assert.equal(a.bmrKcal, 1870.0);
    assert.equal(a.ffmKg, 65.02);
    assert.equal(a.estimatedBfPct, 20.7);
    assert.equal(a.pal, 1.618);
    assert.equal(a.priorTdeeKcal, 3030);
    assert.equal(a.avgDailyEeeKcal, 254.2);

    const b = estimator.estimatePriorTdee({ ...BASE_PROFILE, ffmFormula: "boer" });
    assert.equal(b.bmrMethod, "mifflin_st_jeor");
    assert.equal(b.ffmMethod, "boer");
    assert.equal(b.ffmKg, 64.37);
    assert.equal(b.estimatedBfPct, 21.5);
    assert.equal(b.priorTdeeKcal, 3030);

    const c = estimator.estimatePriorTdee(BASE_PROFILE_BF14);
    assert.equal(c.bmrMethod, "katch_mcardle");
    assert.equal(c.ffmMethod, "body_fat_pct");
    assert.equal(c.bmrKcal, 1893.2);
    assert.equal(c.ffmKg, 70.52);
    assert.equal(c.priorTdeeKcal, 3060);
  });

  it("TC2: 28-day Kalman convergence with high NEAT (+350 kcal above prior)", () => {
    const start = "2026-01-01";
    const weighIns: BodyweightEntry[] = [];
    const logs: DailyNutritionLog[] = [];
    for (let d = 0; d <= 28; d++) {
      const noise = Math.sin(d * 1.7) * 0.12;
      weighIns.push({ date: isoDay(start, d), weightKg: Number((82.0 + noise).toFixed(2)) });
      logs.push({ date: isoDay(start, d), caloriesKcal: 3410, dayType: d % 4 === 3 ? "rest" : "push" });
    }

    const rep = estimator.estimateTdee(BASE_PROFILE_BF14, weighIns, logs, "maintenance");
    assert.equal(rep.mode, "pro");
    assert.equal(rep.status, "converged");
    assert.ok(rep.confidence >= 0.85, `expected conf >= 0.85, got ${rep.confidence}`);
    assert.ok(
      Math.abs((rep.adaptiveTdeeExact ?? rep.adaptiveTdeeKcal) - 3410) <= 60,
      `expected error <= 60 kcal, got ${rep.adaptiveTdeeExact}`,
    );
    assert.ok(rep.adaptiveTdeeKcal >= 3350 && rep.adaptiveTdeeKcal <= 3375);

    // Check daily drift <= 25 kcal across Kalman history
    const hist = rep.tdeeHistory ?? [];
    assert.ok(hist.length >= 14);
    for (let i = 1; i < hist.length; i++) {
      assert.ok(Math.abs(hist[i].tdee - hist[i - 1].tdee) <= 25.1);
    }
  });

  it("TC3: Creatine start masking (14d full + 7d linear taper) prevents false TDEE crash", () => {
    const start = "2026-01-01";
    const creatineStart = isoDay(start, 7);
    const weighIns: BodyweightEntry[] = [];
    const logs: DailyNutritionLog[] = [];

    for (let d = 0; d <= 28; d++) {
      let w = 82.0;
      if (d >= 8 && d <= 17) {
        w = 82.0 + ((d - 7) / 10) * 1.4;
      } else if (d > 17) {
        w = 83.4;
      }
      weighIns.push({ date: isoDay(start, d), weightKg: Number(w.toFixed(3)) });
      logs.push({ date: isoDay(start, d), caloriesKcal: 3060, dayType: "push" });
    }

    const masked = estimator.estimateTdee(
      BASE_PROFILE_BF14,
      weighIns,
      logs,
      "maintenance",
      null,
      creatineStart,
    );
    const unmasked = estimator.estimateTdee(
      BASE_PROFILE_BF14,
      weighIns,
      logs,
      "maintenance",
      null,
      null,
    );

    assert.ok(Math.abs(masked.trendWeightKg - 83.29) <= 0.05);
    assert.ok(Math.abs(masked.metabolicTrendWeightKg - 82.09) <= 0.05);
    const lastPt = masked.trendSeries[masked.trendSeries.length - 1];
    assert.ok(Math.abs(lastPt.creatineOffsetKg - 1.198) <= 0.05);

    const maskedErr = Math.abs((masked.adaptiveTdeeExact ?? masked.adaptiveTdeeKcal) - 3060);
    const unmaskedErr = Math.abs((unmasked.adaptiveTdeeExact ?? unmasked.adaptiveTdeeKcal) - 3060);
    assert.ok(maskedErr <= 25, `expected masked TDEE error <= 25, got ${maskedErr}`);
    assert.ok(unmaskedErr >= 300, `expected unmasked false crash >= 300, got ${unmaskedErr}`);
  });

  it("TC4: Huber-EWMA suppresses single-day +1.8 kg outlier by >= 50%", () => {
    const start = "2026-01-01";
    const weighIns: BodyweightEntry[] = [];
    for (let d = 0; d <= 12; d++) {
      weighIns.push({ date: isoDay(start, d), weightKg: d === 10 ? 83.8 : 82.0 });
    }
    const series = estimator.computeTrendWeight(weighIns);
    const spike = series[10];
    assert.equal(spike.residualKg, 1.8);
    assert.equal(spike.isOutlier, true);
    assert.ok(Math.abs(spike.clippedResidualKg - 0.828) <= 0.002);
    assert.ok(Math.abs(spike.scaleTrendKg - 82.124) <= 0.002);

    const naiveShift = 0.15 * 1.8; // 0.270
    const huberShift = spike.scaleTrendKg - 82.0; // 0.124
    const suppression = 1 - huberShift / naiveShift;
    assert.ok(suppression >= 0.5, `expected >= 50% suppression, got ${(suppression * 100).toFixed(1)}%`);
  });

  it("TC5: Missing days & partialLog policy — (a) 10/14 valid calibrates, (b) 9/14 holds frozen", () => {
    const start = "2026-01-01";
    const weighIns: BodyweightEntry[] = [];
    for (let d = 0; d <= 14; d++) {
      weighIns.push({ date: isoDay(start, d), weightKg: 82.0 });
    }

    // (a) 10 valid out of days 1..14: 3 missing (days 2, 5, 9) + 1 partial (day 11, 1100 kcal)
    const logsA: DailyNutritionLog[] = [];
    for (let d = 1; d <= 14; d++) {
      if (d === 2 || d === 5 || d === 9) continue;
      if (d === 11) {
        logsA.push({ date: isoDay(start, d), caloriesKcal: 1100, dayType: "push", partialLog: true });
      } else {
        logsA.push({ date: isoDay(start, d), caloriesKcal: 3200, dayType: "push" });
      }
    }
    const repA = estimator.estimateTdee(BASE_PROFILE_BF14, weighIns, logsA, "maintenance");
    assert.equal(repA.adherence14d, 0.714);
    assert.equal(repA.status, "calibrating");
    assert.equal(repA.avgIntake14dKcal, 3200.0);
    assert.equal(repA.adaptiveTdeeKcal, 3085);

    // (b) 9 valid out of days 1..14: 4 missing (days 2, 5, 8, 9) + 1 partial (day 11)
    const logsB = logsA.filter((l) => l.date !== isoDay(start, 8));
    const repB = estimator.estimateTdee(BASE_PROFILE_BF14, weighIns, logsB, "maintenance");
    assert.equal(repB.adherence14d, 0.643);
    assert.equal(repB.status, "holding_low_adherence");
    assert.equal(repB.adaptiveTdeeKcal, 3060);
  });

  it("TC6: Weekly check-in lean_bulk — excess damping, deadband +/-40, and ectomorph NEAT plateau boost", () => {
    const prior = estimator.estimatePriorTdee(BASE_PROFILE_BF14);
    const makeReport = (overrides: Partial<TdeeEstimateReport>): TdeeEstimateReport => ({
      mode: "pro",
      status: "converged",
      priorTdeeKcal: prior.priorTdeeKcal,
      adaptiveTdeeKcal: 3060,
      confidence: 0.9,
      trendWeightKg: 82.0,
      metabolicTrendWeightKg: 82.0,
      rateKgPerWeek: 0,
      ratePctPerWeek: 0,
      avgIntake14dKcal: 3230,
      netEnergyBalanceKcal: 170,
      adherence14d: 1,
      prior,
      trendSeries: [],
      ...overrides,
    });

    // (a) Excess rate +0.75%/wk -> rateCorrection = -150 -> 3080
    const resA = controller.computeWeeklyCheckIn(
      makeReport({ adaptiveTdeeKcal: 3060, ratePctPerWeek: 0.75 }),
      BASE_PROFILE_BF14,
      "lean_bulk",
      { previousTargetKcal: 3230, weeksInPhase: 4 },
    );
    assert.equal(resA.rateCorrectionKcal, -150);
    assert.equal(resA.nextTargetKcal, 3080);
    assert.equal(resA.deltaFromPreviousKcal, -150);
    assert.equal(resA.adjustmentReason, "updated");

    // (b) Optimal +0.25%/wk, TDEE 3080 -> diff +20 < 40 -> within_deadband 3230
    const resB = controller.computeWeeklyCheckIn(
      makeReport({ adaptiveTdeeKcal: 3080, ratePctPerWeek: 0.25 }),
      BASE_PROFILE_BF14,
      "lean_bulk",
      { previousTargetKcal: 3230, weeksInPhase: 4 },
    );
    assert.equal(resB.nextTargetKcal, 3230);
    assert.equal(resB.deltaFromPreviousKcal, 0);
    assert.equal(resB.adjustmentReason, "within_deadband");

    // (c) Ectomorph NEAT plateau: TDEE 3460 (+13.1%), rate 0%/wk, prev 3500 -> +250 cap -> 3750
    const resC = controller.computeWeeklyCheckIn(
      makeReport({ adaptiveTdeeKcal: 3460, ratePctPerWeek: 0.0 }),
      BASE_PROFILE_BF14,
      "lean_bulk",
      { previousTargetKcal: 3500, weeksInPhase: 4 },
    );
    assert.equal(resC.neatPlateauDetected, true);
    assert.equal(resC.rateCorrectionKcal, 200);
    assert.equal(resC.nextTargetKcal, 3750);
    assert.equal(resC.adjustmentReason, "step_capped");
  });

  it("TC7: RED-S safety floor (EA >= 30) and Diet Break triggers", () => {
    const prior = estimator.estimatePriorTdee(BASE_PROFILE_BF14);
    const baseReport: TdeeEstimateReport = {
      mode: "pro",
      status: "converged",
      priorTdeeKcal: prior.priorTdeeKcal, // 3060
      adaptiveTdeeKcal: 2950,
      confidence: 0.9,
      trendWeightKg: 82.0,
      metabolicTrendWeightKg: 82.0,
      rateKgPerWeek: -0.7,
      ratePctPerWeek: -0.85,
      avgIntake14dKcal: 2370,
      netEnergyBalanceKcal: -580,
      adherence14d: 1,
      prior,
      trendSeries: [],
    };

    // (a) mini_cut week 3 at TDEE 2950 -> floor 30*70.52 + 254.2 = 2369.8 -> 2370
    const resA = controller.computeWeeklyCheckIn(baseReport, BASE_PROFILE_BF14, "mini_cut", {
      weeksInPhase: 3,
    });
    assert.equal(resA.safetyFloorKcal, 2370);
    assert.equal(resA.nextTargetKcal, 2370);
    assert.equal(resA.safetyFloorHit, true);
    assert.equal(resA.achievedEaKcalPerKgFfm, 30.0);
    assert.equal(resA.adjustmentReason, "safety_floor_reds_ea30");

    // (b) cut week 11 at TDEE 2630 (-14.1%) & e1RM drop 6% -> floor 2370 + Diet Break to 2630
    const resB = controller.computeWeeklyCheckIn(
      { ...baseReport, adaptiveTdeeKcal: 2630 },
      BASE_PROFILE_BF14,
      "cut",
      { weeksInPhase: 11, e1rmDropPct: 0.06 },
    );
    assert.equal(resB.nextTargetKcal, 2370);
    assert.equal(resB.safetyFloorHit, true);
    assert.equal(resB.dietBreakRecommended, true);
    assert.equal(resB.dietBreakReason, "metabolic_adaptation_gt_12pct");
    assert.equal(resB.dietBreakTargetKcal, 2630);
  });

  it("TC8: Strictly isocaloric 4-day DUP v2 carb cycling + Deload maintenance reset", () => {
    // (a) lean_bulk 3250 kcal (TDEE 3060)
    const lbLegs = periodizer.allocateDailyMacros(3250, 82.0, 70.52, "male", "lean_bulk", "legs", 3060);
    const lbPush = periodizer.allocateDailyMacros(3250, 82.0, 70.52, "male", "lean_bulk", "push", 3060);
    const lbPull = periodizer.allocateDailyMacros(3250, 82.0, 70.52, "male", "lean_bulk", "pull", 3060);
    const lbRest = periodizer.allocateDailyMacros(3250, 82.0, 70.52, "male", "lean_bulk", "rest", 3060);
    const lbDeload = periodizer.allocateDailyMacros(3250, 82.0, 70.52, "male", "lean_bulk", "deload", 3060);

    assert.equal(lbLegs.proteinG, 150);
    assert.equal(lbLegs.fatG, 80);
    assert.equal(lbLegs.fatPctWeekly, 22.2);
    assert.equal(lbLegs.carbsG, 580);
    assert.equal(lbLegs.targetKcal, 3640);
    assert.equal(lbPush.carbsG, 485);
    assert.equal(lbPush.targetKcal, 3260);
    assert.equal(lbPull.carbsG, 530);
    assert.equal(lbPull.targetKcal, 3440);
    assert.equal(lbRest.carbsG, 335);
    assert.equal(lbRest.targetKcal, 2660);
    assert.equal((lbLegs.targetKcal + lbPush.targetKcal + lbPull.targetKcal + lbRest.targetKcal) / 4, 3250.0);
    assert.equal(lbDeload.carbsG, 435);
    assert.equal(lbDeload.targetKcal, 3060);

    // (b) cut 2450 kcal (TDEE 3000)
    const cutLegs = periodizer.allocateDailyMacros(2450, 82.0, 70.52, "male", "cut", "legs", 3000);
    const cutPush = periodizer.allocateDailyMacros(2450, 82.0, 70.52, "male", "cut", "push", 3000);
    const cutPull = periodizer.allocateDailyMacros(2450, 82.0, 70.52, "male", "cut", "pull", 3000);
    const cutRest = periodizer.allocateDailyMacros(2450, 82.0, 70.52, "male", "cut", "rest", 3000);
    const cutDeload = periodizer.allocateDailyMacros(2450, 82.0, 70.52, "male", "cut", "deload", 3000);

    assert.equal(cutLegs.proteinG, 185);
    assert.equal(cutLegs.fatG, 60);
    assert.equal(cutLegs.fatPctWeekly, 22.0);
    assert.equal(cutLegs.carbsG, 365);
    assert.equal(cutLegs.targetKcal, 2740);
    assert.equal(cutPush.carbsG, 295);
    assert.equal(cutPush.targetKcal, 2460);
    assert.equal(cutPull.carbsG, 330);
    assert.equal(cutPull.targetKcal, 2600);
    assert.equal(cutRest.carbsG, 180);
    assert.equal(cutRest.targetKcal, 2000);
    assert.equal((cutLegs.targetKcal + cutPush.targetKcal + cutPull.targetKcal + cutRest.targetKcal) / 4, 2450.0);
    assert.equal(cutDeload.carbsG, 430);
    assert.equal(cutDeload.targetKcal, 3000);
  });

  it("TC9 & TC9b: EnergyStatusBridge — all 5 statuses, hysteresis hold, and 1-day -1000 kcal shock", () => {
    const prior = estimator.estimatePriorTdee(BASE_PROFILE_BF14);
    const makePro = (confidence: number, net: number): TdeeEstimateReport => ({
      mode: "pro",
      status: "converged",
      priorTdeeKcal: prior.priorTdeeKcal,
      adaptiveTdeeKcal: 3060,
      confidence,
      trendWeightKg: 82.0,
      metabolicTrendWeightKg: 82.0,
      rateKgPerWeek: 0,
      ratePctPerWeek: 0,
      avgIntake14dKcal: 3060 + net,
      netEnergyBalanceKcal: net,
      adherence14d: 1,
      prior,
      trendSeries: [],
    });

    const lowConf = bridge.deriveEnergyStatus(makePro(0.25, -350), "deficit");
    assert.equal(lowConf.energyStatus, "unknown");
    assert.equal(lowConf.capacityMultiplier, 1.0);

    const def = bridge.deriveEnergyStatus(makePro(0.9, -350), "unknown");
    assert.equal(def.energyStatus, "deficit");
    assert.equal(def.capacityMultiplier, 0.8);

    const heldDef = bridge.deriveEnergyStatus(makePro(0.9, -140), "deficit");
    assert.equal(heldDef.energyStatus, "deficit");
    assert.equal(heldDef.hysteresisHeld, true);

    const maint = bridge.deriveEnergyStatus(makePro(0.9, -110), "deficit");
    assert.equal(maint.energyStatus, "maintenance");
    assert.equal(maint.capacityMultiplier, 0.9);

    const heldOpt = bridge.deriveEnergyStatus(makePro(0.9, 95), "optimal_surplus");
    assert.equal(heldOpt.energyStatus, "optimal_surplus");
    assert.equal(heldOpt.hysteresisHeld, true);

    const high = bridge.deriveEnergyStatus(makePro(0.9, 500), "optimal_surplus");
    assert.equal(high.energyStatus, "high_surplus");
    assert.equal(high.capacityMultiplier, 1.15);

    // TC9b: 1-day -1000 kcal shock on maintenance stays in maintenance
    const start = "2026-01-01";
    const weighIns: BodyweightEntry[] = [];
    const logs: DailyNutritionLog[] = [];
    for (let d = 0; d <= 28; d++) {
      weighIns.push({ date: isoDay(start, d), weightKg: 82.0 });
      logs.push({
        date: isoDay(start, d),
        caloriesKcal: d === 28 ? 2060 : 3060,
        dayType: "push",
      });
    }
    const shockRep = estimator.estimateTdee(BASE_PROFILE_BF14, weighIns, logs, "maintenance");
    const shockBridge = bridge.deriveEnergyStatus(shockRep, "maintenance");
    assert.equal(shockBridge.energyStatus, "maintenance");
    assert.equal(shockBridge.capacityMultiplier, 0.9);
    assert.ok((shockRep.netEnergyBalanceKcal ?? 0) > -100 && (shockRep.netEnergyBalanceKcal ?? 0) < -40);
  });

  it("TC10, TC10b, TC10c: Lite mode (0 calorie logs), empty weigh-ins (0 NaN), and lean_bulk plateau hint", () => {
    const start = "2026-01-01";
    // (a) 21 days of weigh-ins gaining +0.041 kg/day
    const weighInsGain: BodyweightEntry[] = [];
    for (let d = 0; d <= 21; d++) {
      weighInsGain.push({ date: isoDay(start, d), weightKg: Number((82.0 + d * 0.041).toFixed(3)) });
    }
    const resA = engine.runFullCycle({
      profile: BASE_PROFILE_BF14,
      weighIns: weighInsGain,
      nutritionLogs: [],
      goalMode: "lean_bulk",
      todayDayType: "legs",
    });
    assert.equal(resA.tdee.mode, "lite");
    assert.equal(resA.tdee.status, "lite_trend_only");
    assert.equal(resA.tdee.confidence, 0.85);
    assert.ok(Math.abs(resA.tdee.trendWeightKg - 82.63) <= 0.03);
    assert.ok(Math.abs(resA.tdee.ratePctPerWeek - 0.307) <= 0.02);
    assert.equal(resA.checkIn.nextTargetKcal, null);
    assert.equal(resA.checkIn.kcalDeltaHint, 0);
    assert.equal(resA.checkIn.adjustmentReason, "lite_on_track");
    assert.equal(resA.energyBridge.energyStatus, "optimal_surplus");
    assert.equal(resA.energyBridge.capacityMultiplier, 1.1);
    assert.equal(resA.todayMacros, null);

    // (b) TC10b: 0 weigh-ins, 0 logs -> zero NaNs
    const resB = engine.runFullCycle({
      profile: BASE_PROFILE_BF14,
      weighIns: [],
      nutritionLogs: [],
      goalMode: "lean_bulk",
      todayDayType: "push",
    });
    assert.equal(resB.tdee.status, "cold_start_no_weights");
    assert.equal(resB.tdee.confidence, 0);
    assert.equal(resB.tdee.trendWeightKg, 82.0);
    assert.equal(resB.energyBridge.energyStatus, "unknown");
    assert.ok(Number.isFinite(resB.tdee.adaptiveTdeeKcal));
    assert.ok(Number.isFinite(resB.checkIn.safetyFloorKcal));

    // (c) TC10c: 21-day plateau on lean_bulk -> hint = +170 kcal
    const weighInsFlat: BodyweightEntry[] = [];
    for (let d = 0; d <= 21; d++) {
      weighInsFlat.push({ date: isoDay(start, d), weightKg: 82.0 });
    }
    const resC = engine.runFullCycle({
      profile: BASE_PROFILE_BF14,
      weighIns: weighInsFlat,
      nutritionLogs: [],
      goalMode: "lean_bulk",
      todayDayType: "pull",
    });
    assert.equal(resC.tdee.ratePctPerWeek, 0);
    assert.equal(resC.checkIn.kcalDeltaHint, 170);
    assert.equal(resC.checkIn.adjustmentReason, "lite_increase_intake");
  });

  it("NutritionStore persists logs, profile, and hysteresis status cleanly in memory adapter", () => {
    const map = new Map<string, string>();
    const adapter = {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => {
        map.set(k, v);
      },
    };
    const store = new NutritionStore("acc-test", adapter);
    assert.equal(store.readRaw(), null);

    const init = store.read("2026-05-01", 82.0, true);
    const withLog = store.upsertLog(init, {
      date: "2026-05-01",
      caloriesKcal: 3150,
      proteinG: 165,
      dayType: "legs",
      partialLog: false,
    });
    assert.equal(withLog.logs.length, 1);
    assert.equal(withLog.logs[0].caloriesKcal, 3150);

    const reloaded = store.readRaw();
    assert.ok(reloaded);
    assert.equal(reloaded.profile.longLevers, true);
    assert.equal(reloaded.logs.length, 1);
    assert.equal(NutritionStore.weeksSince("2026-04-01", "2026-05-01"), 5);
  });
});
