import test from "node:test";
import assert from "node:assert/strict";
import {
  VolumeLandmarksCalculator,
  RP_VOLUME_LANDMARKS,
} from "../src/domain/VolumeLandmarks";

test("VolumeLandmarksCalculator retrieves brackets for all major muscle groups", () => {
  const chest = VolumeLandmarksCalculator.getBracket("chest");
  assert.equal(chest.muscle, "chest");
  assert.equal(chest.mv, 8);
  assert.equal(chest.mev, 10);
  assert.equal(chest.mavMin, 12);
  assert.equal(chest.mavMax, 20);
  assert.equal(chest.mrv, 22);
});

test("VolumeLandmarksCalculator classifies volume stages correctly", () => {
  // Below MV (< 8 sets for chest)
  const low = VolumeLandmarksCalculator.assessMuscleVolume("chest", 4);
  assert.equal(low.status, "below_mv");

  // Maintenance MV (8-9 sets)
  const mv = VolumeLandmarksCalculator.assessMuscleVolume("chest", 9);
  assert.equal(mv.status, "maintenance");

  // Growth MEV (10-11 sets)
  const mev = VolumeLandmarksCalculator.assessMuscleVolume("chest", 10);
  assert.equal(mev.status, "growth_mev");

  // Optimal MAV (12-20 sets)
  const mav = VolumeLandmarksCalculator.assessMuscleVolume("chest", 16);
  assert.equal(mav.status, "optimal_mav");
  assert.ok(mav.statusLabel.includes("MAV"));

  // Near MRV (21-22 sets)
  const nearMrv = VolumeLandmarksCalculator.assessMuscleVolume("chest", 22);
  assert.equal(nearMrv.status, "near_mrv");

  // Overreaching (> 22 sets)
  const over = VolumeLandmarksCalculator.assessMuscleVolume("chest", 26);
  assert.equal(over.status, "overreaching");
});
