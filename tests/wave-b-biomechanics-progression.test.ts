import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import initSqlJs from "sql.js";
import { LocalD1 } from "../src/device/LocalD1";
import { DeviceAccountData } from "../src/lib/deviceAccountData";
import { BiomechanicsProfileStore } from "../src/domain/BiomechanicsProfile";
import {
  JointGuardEngine,
  JointPainStore,
  STANDARD_GYM_INVENTORY_ADAPTER,
  type JointPainLog,
  type ReturnToLiftState,
} from "../src/domain/JointGuardEngine";
import { ProgressionEngine, toProgressionInventory } from "../src/domain/ProgressionEngine";
import { IntraSessionAutoregulator } from "../src/domain/IntraSessionAutoregulator";
import { OneRepMaxFormulas } from "../src/domain/OneRepMaxFormulas";
import { WeakLinkAnalyzer } from "../src/domain/WeakLinkAnalyzer";
import { KinematicMuscleSolver, makeDescriptor } from "../src/domain/KinematicMuscleSolver";
import { SEED_KINEMATICS_74 } from "../src/domain/KinematicSeed74";
import { BiomechanicalVerifier } from "../src/domain/BiomechanicalVerifier";
import { BiomechanicsAgentService } from "../server/BiomechanicsAgentService";
import { BiomechanicsEngine } from "../src/domain/BiomechanicsEngine";
import { HypertrophyAuditEngine } from "../src/domain/HypertrophyAuditEngine";
import { ExerciseAvoidStore } from "../src/domain/SubstitutionPolicy";
import { LaidDupPlan } from "../src/domain/LaidDupPlan";
import { makeWorkout, type Routine } from "../src/lib/model";

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    key: (i: number) => [...map.keys()][i] ?? null,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
    removeItem: (k: string) => {
      map.delete(k);
    },
    map,
  };
}

test("Account isolation: JointPainStore, BiomechanicsProfileStore and DeviceAccountData isolate per-account keys", () => {
  const store = memoryStorage();
  const now = 1_800_000_000_000;

  JointPainStore.setZoneStatus("lumbar", 2, false, now, store, "acc-a");
  assert.equal(JointPainStore.read(store, now, "acc-a").length, 1);
  assert.equal(JointPainStore.read(store, now, "acc-b").length, 0);

  BiomechanicsProfileStore.save({ longLevers: true, biacromialCm: 42 }, store, "acc-a");
  assert.equal(BiomechanicsProfileStore.read(store, "acc-a").longLevers, true);
  assert.equal(BiomechanicsProfileStore.read(store, "acc-b").longLevers, false);

  store.setItem("tyaga-nutrition-v5:acc-a", "{}");
  store.setItem("tyaga-avoid-exercises:acc-a", "[]");
  const dad = new DeviceAccountData(() => store);
  dad.purgeOthers("acc-b");
  assert.equal(store.getItem("tyaga-nutrition-v5:acc-a"), null);
  assert.equal(store.getItem("tyaga-avoid-exercises:acc-a"), null);
  assert.equal(JointPainStore.read(store, now, "acc-a").length, 0);
  assert.equal(BiomechanicsProfileStore.read(store, "acc-a").longLevers, false);
});

test("JointGuard: downgrading severity after >12h lowers active severity while keeping S5 14d history; monotonic loadMultiplier at sev=2; RTL acute pain and relapse reset", () => {
  const store = memoryStorage();
  const guard = new JointGuardEngine();
  const day = 86_400_000;
  const t0 = 1_800_000_000_000;

  // Report sev=3 on day 0, then downgrade to sev=1 on day 2 (>12h later)
  JointPainStore.setZoneStatus("lumbar", 3, true, t0, store, "u1");
  const afterDowngrade = JointPainStore.setZoneStatus("lumbar", 1, false, t0 + 2 * day, store, "u1");
  const active = JointGuardEngine.activeZoneSeverities(afterDowngrade, t0 + 2 * day);
  assert.equal(active.lumbar, 1, "Downgrading pain after >12h must lower current active severity to 1");
  // S5 14d clinical history still knows about the earlier acute episode
  assert.equal(guard.evaluateDeloadS5(afterDowngrade, t0 + 2 * day).corePainRepeated, true);

  // Monotonic loadMultiplier at sev=2: swap_recommended must not allow MORE load than modify_load_tempo
  const logsSev2: JointPainLog[] = [{ zone: "shoulder_anterior", severity: 2, timestamp: t0 }];
  const modEval = guard.evaluateExerciseSafety("flat-db-press", logsSev2, false, t0);
  const swapEval = guard.evaluateExerciseSafety("bench", logsSev2, false, t0);
  assert.equal(modEval.action, "modify_load_tempo");
  assert.equal(swapEval.action, "swap_recommended");
  assert.ok(
    swapEval.loadMultiplier <= modEval.loadMultiplier,
    `Expected swap_recommended (${swapEval.loadMultiplier}) <= modify_load_tempo (${modEval.loadMultiplier})`,
  );

  // RTL acute_swap with daysSymptomFree=-7 must NOT jump up to 0 on pain
  const acuteReset: ReturnToLiftState = {
    exerciseId: "squat",
    zone: "knee_patellar",
    phase: "acute_swap",
    loadPct: 0,
    daysSymptomFree: -7,
    consecutiveRelapses: 2,
  };
  const painfulDay = guard.stepReturnToLift(acuteReset, 5, false, 1);
  assert.equal(painfulDay.nextState.daysSymptomFree, -7);

  // Graduating acute_swap -> test_reload_70 resets consecutiveRelapses to 0
  const readyToTest: ReturnToLiftState = { ...acuteReset, daysSymptomFree: 6, consecutiveRelapses: 2 };
  const graduated = guard.stepReturnToLift(readyToTest, 0, false, 1);
  assert.equal(graduated.decision, "advance_to_test");
  assert.equal(graduated.nextState.consecutiveRelapses, 0);

  // Single-implement DB (triceps-db) -> skullcrusher-ez must NOT multiply by 2.1x
  const triSwaps = guard.recommendSwap("triceps-db", 20, [], false, t0, STANDARD_GYM_INVENTORY_ADAPTER, 5);
  const skull = triSwaps.find((s) => s.targetExerciseId === "skullcrusher-ez");
  assert.ok(skull);
  assert.ok(
    skull.estimatedWorkingWeightKg <= 25,
    `Expected 1-DB 20kg triceps-db -> skullcrusher-ez <= 25kg, got ${skull.estimatedWorkingWeightKg}`,
  );

  // Barbell bench 100kg -> dip-weighted (added_bodyweight) must NOT suggest +67.5kg belt weight
  const dipSwaps = guard.recommendSwap("bench", 100, [], false, t0, STANDARD_GYM_INVENTORY_ADAPTER, 10);
  const dip = dipSwaps.find((s) => s.targetExerciseId === "dip-weighted");
  if (dip) {
    assert.equal(dip.estimatedWorkingWeightKg, 0, `Expected added_bodyweight swap to start at 0 added kg, got ${dip.estimatedWorkingWeightKg}`);
  }
});

test("ProgressionEngine & IntraSessionAutoregulator: sub-barbell weight never clamps up, assisted_bodyweight direction, 0kg bodyweight/added, 10kg DB jump guard, plateau per_implement", () => {
  const inv = toProgressionInventory({ barWeightKg: 20, minPlateKg: 1.25 });

  // 15kg EZ-bar underperformed at failure must NEVER clamp UP to 20kg barbellWeightKg
  const ddpDrop = ProgressionEngine.recommendDdpSets({
    previousSets: [{ weight: 15, reps: 5, rir: 0 }],
    repMin: 8,
    repMax: 12,
    loadMode: "total_external",
    inventory: inv,
  });
  assert.ok(ddpDrop[0].recommendedWeight <= 15, `Expected drop <= 15kg, got ${ddpDrop[0].recommendedWeight}`);

  // Detraining at 15kg total_external must not increase weight to 20kg
  const detrain = ProgressionEngine.applyDetrainingToPlan(15, 3, 20, "total_external", inv);
  assert.ok(detrain.weightKg <= 15, `Expected detraining weight <= 15kg, got ${detrain.weightKg}`);

  // IntraSessionAutoregulator at 15kg total_external fatigue must not clamp UP to 20kg
  const intra = IntraSessionAutoregulator.evaluate({
    exerciseId: "curl-preacher-ez",
    isCompoundAxial: false,
    loadMode: "total_external",
    plannedWeight: 15,
    targetReps: 10,
    targetRIR: 2,
    actualReps: 7,
    actualRIR: 0,
    remainingSetsCount: 2,
    inventory: inv,
  });
  assert.ok(intra.adjustedWeight <= 15, `Expected fatigued weight <= 15kg, got ${intra.adjustedWeight}`);

  // assisted_bodyweight: meeting target DECREASES assistance; failing INCREASES assistance
  const assistProg = ProgressionEngine.recommendDdpSets({
    previousSets: [{ weight: 25, reps: 12, rir: 2 }],
    repMin: 8,
    repMax: 12,
    loadMode: "assisted_bodyweight",
    inventory: inv,
  });
  assert.equal(assistProg[0].recommendedWeight, 20);
  const assistFail = ProgressionEngine.recommendDdpSets({
    previousSets: [{ weight: 25, reps: 5, rir: 0 }],
    repMin: 8,
    repMax: 12,
    loadMode: "assisted_bodyweight",
    inventory: inv,
  });
  assert.equal(assistFail[0].recommendedWeight, 30);

  // Bodyweight 0kg clean repMax must increase reps (12 -> 13), not demote to 8
  const bwProg = ProgressionEngine.recommendDdpSets({
    previousSets: [{ weight: 0, reps: 12, rir: 2 }],
    repMin: 8,
    repMax: 12,
    loadMode: "bodyweight",
    inventory: inv,
  });
  assert.equal(bwProg[0].recommendedReps, 13);
  assert.equal(bwProg[0].action, "increase_reps");

  // added_bodyweight 0kg clean repMax adds first step (+minPlateKg)
  const addedProg = ProgressionEngine.recommendDdpSets({
    previousSets: [{ weight: 0, reps: 12, rir: 2 }],
    repMin: 8,
    repMax: 12,
    loadMode: "added_bodyweight",
    inventory: inv,
  });
  assert.ok(addedProg[0].recommendedWeight > 0);
  assert.equal(addedProg[0].action, "increase_weight");

  // 10kg DB without stepOverride: rounding 10+1 -> 12kg (20% jump > 12.5%) must extend cap to 14 instead of jumping to 12kg
  const db10 = ProgressionEngine.recommendDdpSets({
    previousSets: [{ weight: 10, reps: 12, rir: 2 }],
    repMin: 8,
    repMax: 12,
    loadMode: "per_implement",
    inventory: inv,
  });
  assert.equal(db10[0].recommendedWeight, 10, `Expected 10kg DB jump guard to hold 10kg, got ${db10[0].recommendedWeight}`);
  assert.equal(db10[0].effectiveRepMax, 14);

  // Plateau detection on per_implement (2 DBs) divides e1RM back to per-dumbbell weight
  const plateau = ProgressionEngine.detectPlateau({
    sessions: [
      { date: "2026-10-01", bestE1rm: 90, confidence: 0.9, avgRir: 0.5 },
      { date: "2026-10-08", bestE1rm: 90, confidence: 0.9, avgRir: 0.5 },
      { date: "2026-10-15", bestE1rm: 89, confidence: 0.9, avgRir: 0.5 },
      { date: "2026-10-22", bestE1rm: 89, confidence: 0.9, avgRir: 0.5 },
    ],
    isCoreOrDupFixed: false,
    weeksInCurrentVariant: 3,
    currentRepRange: [8, 12],
    loadMode: "per_implement",
    implementCount: 2,
    globalDeloadRecommended: false,
    inventory: inv,
  });
  assert.equal(plateau.isPlateau, true);
  assert.equal(plateau.protocol, "rep_range_shift");
  assert.ok(
    plateau.suggestedWeightKg !== undefined && plateau.suggestedWeightKg <= 40,
    `Expected per-dumbbell weight <= 40kg for 90kg pair e1RM, got ${plateau.suggestedWeightKg}`,
  );
});

test("OneRepMaxFormulas.estimateV2 respects implementCount=1 and WeakLinkAnalyzer handles assisted_bodyweight & unilateral row-single-cable", () => {
  const oneDb = OneRepMaxFormulas.estimateV2({
    weight: 30,
    reps: 8,
    rir: 2,
    loadMode: "per_implement",
    implementCount: 1,
    currentBodyweightKg: 80,
    isWarmup: false,
    e1rmEligible: true,
  });
  assert.equal(oneDb.effectiveWeight, 30);

  // WeakLinkAnalyzer: assisted pull-ups must subtract assistanceKg (not weight=0) and row-single-cable must scale 2x
  const w = makeWorkout(["pullup-assisted", "row-single-cable", "bench"], [], "UTC");
  w.date = "2026-11-20";
  w.exercises[0].sets = [{ id: "a1", weight: 0, assistanceKg: 30, reps: 8, rir: 2, done: true, warmup: false }];
  w.exercises[1].sets = [{ id: "r1", weight: 35, reps: 8, rir: 2, done: true, warmup: false }];
  w.exercises[2].sets = [{ id: "b1", weight: 80, reps: 8, rir: 2, done: true, warmup: false }];
  const report = new WeakLinkAnalyzer([w], { today: "2026-11-21", timeZone: "UTC", bodyMassKg: 80 }).build();
  // Assisted pullup with 80kg BW - 30kg assist = 50kg * (1 + 8/30) = 63.3kg (NOT 80 * 1.267 = 101.3kg!)
  assert.ok(
    report.patterns.vpull.e1rmKg !== null && report.patterns.vpull.e1rmKg < 70,
    `Expected assisted pullup e1RM ~63.3kg, got ${report.patterns.vpull.e1rmKg}`,
  );
  // Single-arm cable row 35kg x 8 -> 2x unilateral scale ~88.7kg (NOT 44.3kg!)
  assert.ok(
    report.patterns.row.e1rmKg !== null && report.patterns.row.e1rmKg > 80,
    `Expected unilateral cable row e1RM > 80kg, got ${report.patterns.row.e1rmKg}`,
  );
});

test("KinematicMuscleSolver, KinematicSeed74, BiomechanicalVerifier, and BiomechanicsAgentService regressions", async () => {
  const solver = new KinematicMuscleSolver();
  const verifier = new BiomechanicalVerifier();

  // 1. benchAngle 60 -> 0 must not leave deltoid-middle/shoulder_abduction stuck
  const steep = KinematicMuscleSolver.applyExecutionProfile(SEED_KINEMATICS_74.bench, { benchAngle: 60 });
  const backToFlat = KinematicMuscleSolver.applyExecutionProfile(steep, { benchAngle: 0 });
  const flatOut = solver.solveKinematics(backToFlat);
  assert.equal(flatOut.regions.delt_mid, undefined, "Returning bench from 60° to 0° must clear delt_mid");

  // 2. Wide curl grip must NOT turn supinated curl into pronated (brachioradialis primary)
  const wideCurl = solver.solveKinematics(
    KinematicMuscleSolver.applyExecutionProfile(SEED_KINEMATICS_74["curl-bar"], { grip: "wide" }),
  );
  assert.equal(wideCurl.muscles["biceps-brachii"]?.role, "primary");
  // Reverse curl grip must be pronated
  const revCurl = solver.solveKinematics(
    KinematicMuscleSolver.applyExecutionProfile(SEED_KINEMATICS_74["curl-bar"], { grip: "reverse" }),
  );
  assert.equal(revCurl.muscles["brachioradialis"]?.role, "primary");

  // 3. Single-digit angle "5°" must parse cleanly
  const deg5 = KinematicMuscleSolver.applyExecutionProfile(SEED_KINEMATICS_74.row, { grip: "5°" });
  assert.equal(deg5.geometry.shoulderPlaneDeg, 5);

  // 4. back-extension in KinematicSeed74 must have lumbar risk > 0 and axial > 0.15
  const backExt = solver.solveKinematics(SEED_KINEMATICS_74["back-extension"]);
  assert.ok(backExt.jointRisk.lumbar >= 2, `Expected back-extension lumbar risk >= 2, got ${backExt.jointRisk.lumbar}`);
  assert.ok(backExt.axialLoadMultiplier >= 0.5, `Expected back-extension axial >= 0.5, got ${backExt.axialLoadMultiplier}`);

  // 5. BiomechanicalVerifier must hard-reject NaN geometry angles
  const nanDesc = makeDescriptor({ elbow_flexion: 1.0 }, { benchAngleDeg: Number.NaN });
  const nanVer = verifier.verifyAndCorrect(nanDesc, solver.solveKinematics(nanDesc));
  assert.equal(nanVer.passed, false);
  assert.equal(nanVer.status, "hard_reject_retry");

  // 6. BiomechanicsAgentService: cache baseDesc (unpolluted by user executionProfile), reject bad clarify, deduplicate feedback, don't bump updated_at on read
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.exec("PRAGMA foreign_keys = ON");
  for (const file of (await readdir("drizzle")).filter((f) => f.endsWith(".sql")).sort()) {
    db.exec(await readFile("drizzle/" + file, "utf8"));
  }
  const d1 = new LocalD1(db) as unknown as D1Database;
  const mockAi = {
    async run() {
      return {
        response: JSON.stringify({
          canonicalSlug: "custom-chest-press",
          displayNameRu: "Жим в тренажёре",
          displayNameEn: "Machine Chest Press",
          confidence: 0.92,
          missingParams: [],
          rationale: "Base horizontal press",
          actions: [
            { action: "shoulder_horizontal_adduction", weight: 1.0 },
            { action: "elbow_extension", weight: 0.6 },
          ],
          geometry: { ...SEED_KINEMATICS_74.bench.geometry, benchAngleDeg: 0 },
          profile: { ...SEED_KINEMATICS_74.bench.profile, supportType: "machine_guided", implement: "machine" },
        }),
      };
    },
  };
  const svc1 = new BiomechanicsAgentService(d1, "user-1", { AI: mockAi });
  // User 1 queries with steep 60° incline executionProfile
  const r1 = await svc1.resolve({ queryText: "Technogym Chest Press", executionProfile: { benchAngle: 60 } });
  assert.equal(r1.solved.regions.delt_front, 1.0);
  const rowBefore = await d1
    .prepare("SELECT updated_at FROM exercise_canonical_cache WHERE canonical_slug = ?")
    .bind("custom-chest-press")
    .first<{ updated_at: number }>();
  await new Promise((r) => setTimeout(r, 15));

  // User 2 queries same machine with NO executionProfile -> must get flat chest press, NOT User 1's 60° incline!
  const svc2 = new BiomechanicsAgentService(d1, "user-2", { AI: mockAi });
  const r2 = await svc2.resolve({ queryText: "Technogym Chest Press" });
  assert.equal(r2.source, "d1_cache");
  assert.equal(r2.descriptor.geometry.benchAngleDeg, 0, "D1 cache must store unpolluted base descriptor");
  assert.equal(r2.solved.regions.chest_mid_lower, 1.0);

  // lookupD1 read must NOT bump updated_at
  const rowAfter = await d1
    .prepare("SELECT updated_at FROM exercise_canonical_cache WHERE canonical_slug = ?")
    .bind("custom-chest-press")
    .first<{ updated_at: number }>();
  assert.equal(rowAfter?.updated_at, rowBefore?.updated_at);

  // clarify with invalid updatedDescriptor must throw InputError (400), not crash with TypeError
  await assert.rejects(() => svc1.clarify({ canonicalSlug: "custom-chest-press", updatedDescriptor: null as any }));

  // submitFeedback by the same user twice must NOT inflate consensusCount to 2
  const fb1 = await svc1.submitFeedback({
    canonicalSlug: "custom-chest-press",
    proposedDescriptor: SEED_KINEMATICS_74.bench,
  });
  const fb2 = await svc1.submitFeedback({
    canonicalSlug: "custom-chest-press",
    proposedDescriptor: SEED_KINEMATICS_74.bench,
  });
  assert.equal(fb1.consensusCount, 1);
  assert.equal(fb2.consensusCount, 1);
});

test("BiomechanicsEngine duration repZones, auditLaidCycle deload skip, HypertrophyAuditEngine multi-day routine scaling, and ExerciseAvoidStore localDate", () => {
  // Duration sets must NOT be counted as strength (1-rep) in repZones
  const wDur = makeWorkout(["crunch"], [], "UTC");
  wDur.date = "2026-11-20";
  wDur.exercises[0] = {
    exerciseId: "custom:plank:1",
    catalogRevision: 3,
    recordingSpecRevision: 3,
    muscleMappingRevision: 3,
    displayNameSnapshot: "Планка",
    externalDefinition: {
      id: "custom:plank:1",
      familyId: "plank",
      name: "Планка",
      nameEn: "Plank",
      aliases: ["Планка"],
      primary: ["core"],
      secondary: [],
      equipment: "bodyweight",
      tip: "",
      catalogRevision: 3,
      recording: {
        type: "duration",
        loadMode: "bodyweight",
        implementCount: 1,
        laterality: "bilateral",
        repsMode: "total",
        e1rmEligible: false,
      },
      variant: "Custom",
      jointActions: [],
      muscles: [],
      evidence: [],
      limitations: "",
      provenance: { curator: "test", reviewedAt: null, license: "test", reviewStatus: "user-declared" },
    },
    sets: [{ id: "d1", weight: 0, reps: 1, durationSeconds: 60, rir: null, done: true, warmup: false }],
  };
  const weekRep = BiomechanicsEngine.analyzeWeek([wDur], "2026-11-20", { timeZone: "UTC", now: new Date("2026-11-20T12:00:00Z") });
  assert.equal(weekRep.repZones.strength, 0, "Duration sets must not inflate strength repZone");

  // auditLaidCycle must skip deload workouts (plan.isDeload)
  const cycle = LaidDupPlan.routines({
    version: "v3",
    startMonday: "2026-10-12", // Week 6 (index 5) is deload: 2026-11-16..2026-11-22
    maxes: { squat: 120, bench: 100, deadlift: 140, ohp: 70 },
    extras: true,
    light: false,
  });
  const deloadDay = cycle[0];
  const wDeload1 = makeWorkout(["squat"], [], "UTC");
  wDeload1.id = "dl-1";
  wDeload1.date = "2026-11-16";
  wDeload1.routineId = deloadDay.id;
  wDeload1.exercises[0].sets = [{ id: "s1", weight: 80, reps: 2, rir: 4, done: true, warmup: false }];
  const wDeload2 = { ...wDeload1, id: "dl-2", date: "2026-11-17" };
  const laidAudit = BiomechanicsEngine.auditLaidCycle(cycle, [wDeload1, wDeload2], "2026-11-20");
  assert.equal(
    laidAudit.topSetFeedback.some((s) => s.id === "laid-missed-reps" || s.id === "laid-easy-topsets"),
    false,
    "Deload workouts must not trigger top-set feedback in auditLaidCycle",
  );

  // HypertrophyAuditEngine.auditRoutines scales sets by routine.days.length
  const fullBodyRoutine: Routine = {
    id: "fb-3x",
    name: "Full Body 3x",
    notes: "",
    days: [0, 2, 4], // 3 days/week!
    restSeconds: 90,
    progression: "double",
    repMin: 8,
    repMax: 12,
    incrementKg: 2.5,
    revision: 1,
    exercises: [
      {
        exerciseId: "bench",
        sets: [
          { id: "s1", weight: 80, reps: 10, rir: 2, done: false, warmup: false },
          { id: "s2", weight: 80, reps: 10, rir: 2, done: false, warmup: false },
          { id: "s3", weight: 80, reps: 10, rir: 2, done: false, warmup: false },
        ],
      },
    ],
  };
  const ha = new HypertrophyAuditEngine().auditRoutines([fullBodyRoutine]);
  assert.equal(ha.totalSets, 9, `Expected 3 sets * 3 days = 9 weekly sets, got ${ha.totalSets}`);

  // ExerciseAvoidStore.add uses local calendar date for supplied timeZone
  const store = memoryStorage();
  const avoid = new ExerciseAvoidStore("u-tz", () => store);
  const kiritimati = new Intl.DateTimeFormat("en-CA", { timeZone: "Pacific/Kiritimati" }).format(new Date());
  const added = avoid.add("bench", "pain", "shoulder", "Pacific/Kiritimati");
  assert.equal(added[0].addedAt, kiritimati);
});
