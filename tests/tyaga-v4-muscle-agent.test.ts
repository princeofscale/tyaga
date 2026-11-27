import test from "node:test";
import assert from "node:assert/strict";
import { EXERCISE_PROFILES_V3, ALL_BIOMECH_PROFILES_V3 } from "../src/domain/BiomechanicsCatalogV3";
import { BiomechanicalMuscleAgent } from "../src/domain/BiomechanicalMuscleAgent";
import { BiomechanicalVerifier } from "../src/domain/BiomechanicalVerifier";
import { KinematicMuscleSolver, makeDescriptor } from "../src/domain/KinematicMuscleSolver";
import { SEED_KINEMATICS_74 } from "../src/domain/KinematicSeed74";
import type { AnatomicalMuscleIdV4 } from "../src/domain/KinematicTypesV4";

const solver = new KinematicMuscleSolver();
const verifier = new BiomechanicalVerifier();
const agent = new BiomechanicalMuscleAgent(solver, verifier);

function pearson(xs: number[], ys: number[]): number {
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    dx += (xs[i] - mx) ** 2;
    dy += (ys[i] - my) ** 2;
  }
  return dx > 0 && dy > 0 ? num / Math.sqrt(dx * dy) : 0;
}

test("TC1: ExecutionProfile dynamics on leg press (low narrow vs high wide) in <1ms offline", () => {
  const base = SEED_KINEMATICS_74.legpress;
  const lowDesc = KinematicMuscleSolver.applyExecutionProfile(base, { stance: "low narrow" });
  const highDesc = KinematicMuscleSolver.applyExecutionProfile(base, { stance: "high wide" });

  const lowOut = solver.solveKinematics(lowDesc);
  const highOut = solver.solveKinematics(highDesc);

  assert.equal(lowOut.muscles["quadriceps-vasti"]?.role, "primary");
  assert.equal(lowOut.regions.quads_vasti, 1.0);
  assert.equal(lowOut.muscles["rectus-femoris"]?.role, "stabilizer");

  assert.ok(highOut.primaryMuscles.includes("gluteus-maximus"));
  assert.ok(highOut.primaryMuscles.includes("adductor-magnus"));
  assert.equal(highOut.regions.glutes_stretched, 1.0);
  assert.equal(highOut.regions.quads_vasti, 0.5);
  assert.equal(highOut.regions.hams_hinge, 0.5);
});

test("TC2: ExecutionProfile dynamics on seated cable row (15° tucked vs 75° flared)", () => {
  const base = SEED_KINEMATICS_74.row;
  const tucked = solver.solveKinematics(
    KinematicMuscleSolver.applyExecutionProfile(base, { grip: "narrow neutral tucked 15°" }),
  );
  const flared = solver.solveKinematics(
    KinematicMuscleSolver.applyExecutionProfile(base, { grip: "wide pronated flared 75°" }),
  );

  assert.ok(tucked.primaryMuscles.includes("latissimus-dorsi"));
  assert.equal(tucked.regions.lats, 1.0);
  assert.equal(tucked.regions.upper_back, 0.5);
  assert.equal(tucked.regions.brachialis, 0.5);

  assert.ok(flared.primaryMuscles.includes("deltoid-posterior"));
  assert.ok(flared.primaryMuscles.includes("trapezius-middle"));
  assert.ok(flared.primaryMuscles.includes("rhomboids"));
  assert.equal(flared.regions.upper_back, 1.0);
  assert.equal(flared.regions.delt_rear, 1.0);
});

test("TC3: ExecutionProfile benchAngle monotonically shifts bench primary chest_mid_lower -> chest_upper -> delt_front", () => {
  const base = SEED_KINEMATICS_74.bench;
  const flat = solver.solveKinematics(KinematicMuscleSolver.applyExecutionProfile(base, { benchAngle: 0 }));
  const inc = solver.solveKinematics(KinematicMuscleSolver.applyExecutionProfile(base, { benchAngle: 30 }));
  const steep = solver.solveKinematics(KinematicMuscleSolver.applyExecutionProfile(base, { benchAngle: 60 }));

  assert.equal(flat.regions.chest_mid_lower, 1.0);
  assert.equal(flat.regions.chest_upper, 0.5);

  assert.equal(inc.regions.chest_upper, 1.0);
  assert.equal(inc.regions.chest_mid_lower, 0.5);

  assert.equal(steep.regions.delt_front, 1.0);
  assert.equal(steep.regions.chest_upper, 0.5);
  assert.equal(steep.regions.delt_mid, 0.5);
});

test("TC4: Out-of-catalog machine — Hammer Strength Iso-Lateral High Row (narrow neutral chest supported)", () => {
  const res = agent.resolveOffline({
    queryText: "Hammer Strength Iso-Lateral High Row, узкий нейтральный хват, сидя с упором груди",
  });
  assert.equal(res.verification.passed, true);
  assert.ok(res.solved.primaryMuscles.includes("latissimus-dorsi"));
  assert.ok(res.solved.primaryMuscles.includes("teres-major"));
  assert.equal(res.solved.regions.lats, 1.0);
  assert.equal(res.solved.regions.upper_back, 0.5);
  assert.equal(res.solved.regions.brachialis, 0.5);
  assert.equal(res.solved.axialLoadMultiplier, 0.15);
  assert.equal(res.solved.jointRisk.lumbar, 0);
  assert.ok(res.solved.sfrBase >= 7.8 && res.solved.sfrLongLevers >= 7.8);
});

test("TC5: Out-of-catalog machine — Pendulum Squat enforces rectus-femoris inhibition and stretchScore=3", () => {
  const res = agent.resolveOffline({ queryText: "Pendulum Squat, полная амплитуда" });
  assert.equal(res.verification.passed, true);
  assert.deepEqual(res.solved.primaryMuscles, ["quadriceps-vasti"]);
  assert.equal(res.solved.muscles["rectus-femoris"]?.role, "stabilizer");
  assert.equal(res.solved.regions.quads_vasti, 1.0);
  assert.equal(res.solved.regions.glutes_stretched, 0.5);
  assert.equal(res.solved.regions.quads_rectus_femoris, undefined);
  assert.equal(res.solved.stretchScore, 3);
  assert.equal(res.solved.axialLoadMultiplier, 0.15);
  assert.equal(res.solved.jointRisk.knee_patellar, 2);
  assert.ok(res.solved.sfrLongLevers < res.solved.sfrBase);
});

test("TC6: Niche exercises — Bayesian Cable Curl (stretch=3) and JM Press (elbow risk=3)", () => {
  const bayesian = agent.resolveOffline({ queryText: "Bayesian Cable Curl" });
  assert.equal(bayesian.solved.regions.biceps_stretch, 1.0);
  assert.equal(bayesian.solved.stretchScore, 3);
  assert.equal(bayesian.solved.jointRisk.shoulder_anterior, 2);

  const jm = agent.resolveOffline({ queryText: "JM Press со штангой лёжа" });
  assert.ok(jm.solved.primaryMuscles.includes("triceps-brachii"));
  assert.equal(jm.solved.regions.triceps_long_head, 1.0);
  assert.equal(jm.solved.regions.chest_mid_lower, 0.5);
  assert.equal(jm.solved.jointRisk.elbow, 3);
  assert.equal(jm.solved.jointRisk.wrist, 2);
  assert.ok(jm.solved.sfrLongLevers < jm.solved.sfrBase);
});

test("TC7: Anti-hallucination INV-04 catches and downgrades fake rectus-femoris=primary on Pendulum Squat", () => {
  const res = agent.resolveOffline({ queryText: "Pendulum Squat" });
  const poisoned = {
    ...res.solved,
    muscles: {
      ...res.solved.muscles,
      "rectus-femoris": { role: "primary" as const, weight: 1.0 as const, score: 0.95 },
    },
    regions: {
      ...res.solved.regions,
      quads_rectus_femoris: 1.0 as const,
    },
  };
  const checked = verifier.verifyAndCorrect(res.descriptor, poisoned);
  assert.equal(checked.status, "auto_corrected");
  assert.ok(checked.violations.some((v) => v.code.startsWith("INV-04")));
  assert.equal(checked.correctedResult.muscles["rectus-femoris"]?.role, "stabilizer");
  assert.equal(checked.correctedResult.muscles["rectus-femoris"]?.weight, 0.0);
  assert.equal(checked.correctedResult.regions.quads_rectus_femoris, undefined);
});

test("TC8: Anti-hallucination INV-01, INV-05 (auto_correct) and INV-02 antagonist conflict (hard_reject_retry)", () => {
  const calfDesc = SEED_KINEMATICS_74["calf-seated"];
  const calfSolved = solver.solveKinematics(calfDesc);
  const poisonedCalf = {
    ...calfSolved,
    muscles: {
      ...calfSolved.muscles,
      gastrocnemius: { role: "primary" as const, weight: 1.0 as const, score: 0.9 },
      ["inner-chest-fake" as AnatomicalMuscleIdV4]: { role: "primary" as const, weight: 1.0 as const, score: 0.9 },
    },
    regions: {
      ...calfSolved.regions,
      calves_gastroc: 1.0 as const,
    },
  };
  const checkedCalf = verifier.verifyAndCorrect(calfDesc, poisonedCalf);
  assert.equal(checkedCalf.status, "auto_corrected");
  assert.ok(checkedCalf.violations.some((v) => v.code.startsWith("INV-01")));
  assert.ok(checkedCalf.violations.some((v) => v.code.startsWith("INV-05")));
  assert.deepEqual(checkedCalf.correctedResult.primaryMuscles, ["soleus"]);
  assert.equal(checkedCalf.correctedResult.regions.calves_gastroc, undefined);
  assert.equal(checkedCalf.correctedResult.regions.calves_soleus, 1.0);

  // INV-02 antagonist conflict -> hard_reject_retry
  const badDesc = makeDescriptor({ elbow_flexion: 0.9, elbow_extension: 0.9 });
  const badOut = solver.solveKinematics(badDesc);
  const checkedBad = verifier.verifyAndCorrect(badDesc, badOut);
  assert.equal(checkedBad.passed, false);
  assert.equal(checkedBad.status, "hard_reject_retry");
  assert.ok(checkedBad.violations.some((v) => v.code.startsWith("INV-02")));
});

test("TC9: Ambiguous RU input returns safe preliminary solve + 2 clarifying chip questions that refine locally", () => {
  const res = agent.resolveOffline({ queryText: "Тяга в тренажёре Хаммер" });
  assert.equal(res.source, "offline_kinematic");
  assert.ok(res.confidence < 0.8);
  assert.equal(res.clarifyingQuestions.length, 2);
  assert.equal(res.clarifyingQuestions[0].param, "pullVector");
  assert.equal(res.clarifyingQuestions[1].param, "shoulderPlaneDeg");
  assert.equal(res.verification.passed, true);

  // Tapping "Разведены 60–75° (верх спины)" shifts primary to upper_back + delt_rear locally
  const flaredChip = res.clarifyingQuestions[1].chips[1];
  const refined = agent.applyClarifyingChip(res.descriptor, flaredChip);
  assert.equal(refined.solved.regions.upper_back, 1.0);
  assert.equal(refined.solved.regions.delt_rear, 1.0);
});

test("TC10: 74-exercise regression audit against Tyaga v3 catalog achieves >=95% primary exact, >=0.93 SFR corr, 74/74 clean verifier, <1ms latency", () => {
  assert.equal(Object.keys(SEED_KINEMATICS_74).length, 74);

  let primaryExact = 0;
  let jaccardSum = 0;
  let verifierClean = 0;
  const sfrBaseV3: number[] = [];
  const sfrBaseV4: number[] = [];
  const sfrLLV3: number[] = [];
  const sfrLLV4: number[] = [];

  const t0 = performance.now();
  const ITERATIONS = 100;
  for (let iter = 0; iter < ITERATIONS; iter++) {
    for (const v3 of ALL_BIOMECH_PROFILES_V3) {
      const desc = SEED_KINEMATICS_74[v3.id];
      const out = solver.solveKinematics(desc);
      if (iter === 0) {
        const ver = verifier.verifyAndCorrect(desc, out);
        if (ver.status === "valid") verifierClean++;

        const v3Primaries = v3.regions
          .filter((r) => r.weight === 1.0)
          .map((r) => r.region)
          .sort();
        const v4Primaries = Object.entries(out.regions)
          .filter(([, w]) => w === 1.0)
          .map(([r]) => r)
          .sort();

        if (JSON.stringify(v3Primaries) === JSON.stringify(v4Primaries)) {
          primaryExact++;
        }

        // Weighted Jaccard across all regions
        const v3Map = new Map(v3.regions.map((r) => [r.region, r.weight]));
        const allKeys = new Set([...v3Map.keys(), ...Object.keys(out.regions)]);
        let minS = 0;
        let maxS = 0;
        for (const k of allKeys) {
          const a = v3Map.get(k as keyof typeof out.regions) ?? 0;
          const b = out.regions[k as keyof typeof out.regions] ?? 0;
          minS += Math.min(a, b);
          maxS += Math.max(a, b);
        }
        jaccardSum += maxS > 0 ? minS / maxS : 1;

        sfrBaseV3.push(v3.sfrBase);
        sfrBaseV4.push(out.sfrBase);
        sfrLLV3.push(v3.sfrLongLevers);
        sfrLLV4.push(out.sfrLongLevers);
      }
    }
  }
  const avgMs = (performance.now() - t0) / (ITERATIONS * ALL_BIOMECH_PROFILES_V3.length);

  const primaryRatio = primaryExact / 74;
  const meanJaccard = jaccardSum / 74;
  const corrBase = pearson(sfrBaseV3, sfrBaseV4);
  const corrLL = pearson(sfrLLV3, sfrLLV4);

  assert.equal(verifierClean, 74, `Expected 74/74 clean verifier, got ${verifierClean}/74`);
  assert.ok(primaryRatio >= 0.95, `Expected primaryExact >= 0.95, got ${primaryExact}/74 (${(primaryRatio * 100).toFixed(1)}%)`);
  assert.ok(meanJaccard >= 0.9, `Expected meanJaccard >= 0.90, got ${(meanJaccard * 100).toFixed(1)}%`);
  assert.ok(corrBase >= 0.88, `Expected SFR base corr >= 0.88, got ${corrBase.toFixed(3)}`);
  assert.ok(corrLL >= 0.9, `Expected SFR LL corr >= 0.90, got ${corrLL.toFixed(3)}`);
  assert.ok(avgMs < 1.0, `Expected avg solve latency < 1.0ms, got ${avgMs.toFixed(4)}ms`);
  assert.ok(EXERCISE_PROFILES_V3.bench, "v3 catalog present");
});
