import assert from "node:assert/strict";
import test from "node:test";
import { BiomechanicsProfileStore, DEFAULT_BIOMECHANICS_PROFILE } from "../src/domain/BiomechanicsProfile";
import { BodyweightTracker } from "../src/domain/BodyweightTracker";
import { LaidDupPlan } from "../src/domain/LaidDupPlan";
import { exerciseById } from "../src/lib/model";

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
  };
}

test("BiomechanicsProfileStore persists longLevers and calculates 1.4-1.5x bench grip", () => {
  const store = memoryStorage();
  assert.deepEqual(BiomechanicsProfileStore.read(store), DEFAULT_BIOMECHANICS_PROFILE);

  const saved = BiomechanicsProfileStore.save({ longLevers: true, biacromialCm: 40 }, store);
  assert.deepEqual(saved, { longLevers: true, biacromialCm: 40 });
  assert.deepEqual(BiomechanicsProfileStore.optimalBenchGripCm(40), { min: 56, max: 60 });

  const benchCue = BiomechanicsProfileStore.techniqueCue(exerciseById("bench"), saved);
  assert.ok(benchCue && benchCue.includes("56–60 см"));

  const squatCue = BiomechanicsProfileStore.techniqueCue(exerciseById("squat"), saved);
  assert.ok(squatCue && squatCue.includes("25°"));

  // Off by default -> null
  assert.equal(BiomechanicsProfileStore.techniqueCue(exerciseById("bench"), DEFAULT_BIOMECHANICS_PROFILE), null);
});

test("BodyweightTracker.getNeatVerdict detects NEAT plateau, optimal lean bulk, and too-fast gain", () => {
  const store1 = memoryStorage();
  const t1 = new BodyweightTracker("u1", "UTC", store1);
  t1.setGoal(85);
  // 14-day plateau around 75.0 kg -> NEAT plateau
  t1.addEntry(75.0, "2026-11-10");
  t1.addEntry(75.1, "2026-11-12");
  t1.addEntry(75.0, "2026-11-18");
  t1.addEntry(75.1, "2026-11-22");
  const plateau = t1.getNeatVerdict("2026-11-23");
  assert.equal(plateau.status, "neat_plateau");
  assert.match(plateau.kcalDeltaHint ?? "", /\+150/);

  const store2 = memoryStorage();
  const t2 = new BodyweightTracker("u2", "UTC", store2);
  t2.setGoal(85);
  // ~0.3 kg/week on 75 kg = 0.4%/week -> optimal_gain
  t2.addEntry(75.0, "2026-11-10");
  t2.addEntry(75.0, "2026-11-12");
  t2.addEntry(75.3, "2026-11-18");
  t2.addEntry(75.3, "2026-11-22");
  const optimal = t2.getNeatVerdict("2026-11-23");
  assert.equal(optimal.status, "optimal_gain");

  const store3 = memoryStorage();
  const t3 = new BodyweightTracker("u3", "UTC", store3);
  t3.setGoal(85);
  // ~1.0 kg/week -> too_fast
  t3.addEntry(75.0, "2026-11-10");
  t3.addEntry(75.1, "2026-11-12");
  t3.addEntry(76.0, "2026-11-18");
  t3.addEntry(76.1, "2026-11-22");
  const fast = t3.getNeatVerdict("2026-11-23");
  assert.equal(fast.status, "too_fast");
});

test("LaidDupPlan Long Levers preset creates valid conflict-free routines with reduced axial load", () => {
  const baseline = LaidDupPlan.routines({
    maxes: { squat: 100, bench: 80, deadlift: 140, ohp: 60 },
    extras: true,
    light: false,
    startMonday: "2026-11-09",
  });
  const longSubs = LaidDupPlan.toggleLongLevers({}, true);
  assert.equal(LaidDupPlan.isLongLevers(longSubs), true);

  const adapted = LaidDupPlan.routines({
    maxes: { squat: 100, bench: 80, deadlift: 140, ohp: 60 },
    extras: true,
    light: true,
    startMonday: "2026-11-09",
    substitutions: longSubs,
    deloadWeeks: [6],
  });

  // Zero duplicate exercise IDs in any day
  for (const r of adapted) {
    const ids = r.exercises.map((e) => e.exerciseId);
    assert.equal(new Set(ids).size, ids.length, `duplicate exercise in ${r.name}`);
  }

  const baseVol = LaidDupPlan.cycleMuscleVolume(baseline);
  const adaptedVol = LaidDupPlan.cycleMuscleVolume(adapted);
  assert.ok(adaptedVol.axialSets < baseVol.axialSets);
});
