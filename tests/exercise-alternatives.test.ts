import test from "node:test";
import assert from "node:assert/strict";
import { ExerciseAlternativesFinder } from "../src/domain/ExerciseAlternatives";
import { EXERCISES } from "../src/lib/catalog";

test("ExerciseAlternativesFinder finds alternatives for Incline Bench Press", () => {
  const inclineBench = EXERCISES.find(
    (e) => e.name.toLowerCase().includes("наклон") && e.primary.includes("chest")
  );
  assert.ok(inclineBench, "Incline bench must exist in catalog");

  const alternatives = ExerciseAlternativesFinder.findAlternatives(inclineBench, EXERCISES, 5);
  assert.ok(alternatives.length > 0);

  // All alternatives must hit chest as primary
  for (const alt of alternatives) {
    assert.ok(alt.exercise.primary.includes("chest"));
    assert.notEqual(alt.exercise.id, inclineBench.id);
  }

  // Top alternative should be inclined movement or chest press
  const top = alternatives[0];
  assert.ok(top.matchScore > 50);
});

test("ExerciseAlternativesFinder finds alternatives for Deltoid Lateral Raises", () => {
  const latRaise = EXERCISES.find(
    (e) => e.name.toLowerCase().includes("махи") || e.id.toLowerCase().includes("lateral")
  );
  assert.ok(latRaise, "Lateral raise must exist");

  const alternatives = ExerciseAlternativesFinder.findAlternatives(latRaise, EXERCISES, 5);
  assert.ok(alternatives.length > 0);
  assert.ok(alternatives.some((a) => a.exercise.primary.includes("shoulders")));
});
