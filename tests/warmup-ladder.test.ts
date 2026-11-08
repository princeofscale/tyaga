import test from "node:test";
import assert from "node:assert/strict";
import { WarmupLadderCalculator } from "../src/domain/WarmupLadderCalculator";

test("WarmupLadderCalculator calculates plates per side", () => {
  // 100 kg total with 20 kg bar = 40 kg per side -> 25 + 15 (standard greedy plate algorithm)
  const plates = WarmupLadderCalculator.calculateSidePlates(100, 20);
  assert.deepEqual(plates, [25, 15]);

  const desc = WarmupLadderCalculator.formatPlates(100, 20);
  assert.equal(desc, "По 25 + 15 кг на сторону");
});

test("WarmupLadderCalculator generates progressive ramp for 100 kg bench", () => {
  const ladder = WarmupLadderCalculator.generateLadder(100, 6, 20);
  assert.ok(ladder.length >= 4);

  // First step is empty bar
  assert.equal(ladder[0].weightKg, 20);
  assert.equal(ladder[0].isWorkSet, false);

  // Last step is 100 kg work set
  const last = ladder[ladder.length - 1];
  assert.equal(last.weightKg, 100);
  assert.equal(last.reps, 6);
  assert.equal(last.isWorkSet, true);

  // Weights are strictly increasing
  for (let i = 1; i < ladder.length; i++) {
    assert.ok(ladder[i].weightKg >= ladder[i - 1].weightKg);
  }
});

test("WarmupLadderCalculator handles low weights (<= bar)", () => {
  const ladder = WarmupLadderCalculator.generateLadder(20, 10, 20);
  assert.equal(ladder.length, 1);
  assert.equal(ladder[0].weightKg, 20);
  assert.equal(ladder[0].isWorkSet, true);
});

test("WarmupLadderCalculator clamps UI numeric strings and invalid values to finite limits", () => {
  assert.equal(WarmupLadderCalculator.clampTargetWeight("1e20", 20), 400);
  assert.equal(WarmupLadderCalculator.clampTargetWeight("Infinity", 20), 20);
  assert.equal(WarmupLadderCalculator.clampTargetWeight("NaN", 20), 20);
  assert.equal(WarmupLadderCalculator.clampTargetWeight("-100", 20), 20);
  assert.equal(WarmupLadderCalculator.clampTargetWeight("", 20), 20);
  assert.equal(WarmupLadderCalculator.clampTargetWeight("80.5", 20), 80.5);
  assert.equal(WarmupLadderCalculator.clampReps("1e20"), 30);
  assert.equal(WarmupLadderCalculator.clampReps("Infinity"), 1);
  assert.equal(WarmupLadderCalculator.clampReps("NaN"), 1);
  assert.equal(WarmupLadderCalculator.clampReps("-1"), 1);
  assert.equal(WarmupLadderCalculator.clampReps(""), 1);
  assert.equal(WarmupLadderCalculator.clampReps("2.6"), 3);
  assert.equal(WarmupLadderCalculator.clampBarWeight("8"), 8);
  assert.equal(WarmupLadderCalculator.clampBarWeight(NaN), 20);
});

test("WarmupLadderCalculator promptly returns finite bounded ladders for hostile inputs", () => {
  const started = performance.now();
  for (const input of [1e20, Number.MAX_VALUE, Infinity, -Infinity, NaN, -100]) {
    for (const ladder of [
      WarmupLadderCalculator.generateLadder(input, input, input),
      WarmupLadderCalculator.generateLadder(input, 6, 20),
      WarmupLadderCalculator.generateLadder(100, input, input),
    ]) {
      assert.ok(ladder.length > 0 && ladder.length <= 6);
      assert.equal(ladder[ladder.length - 1].isWorkSet, true);
      for (const step of ladder) {
        assert.ok(Number.isFinite(step.weightKg) && step.weightKg >= 0 && step.weightKg <= 400);
        assert.ok(Number.isFinite(step.percent) && step.percent >= 0 && step.percent <= 100);
        assert.ok(Number.isInteger(step.reps) && step.reps >= 1 && step.reps <= 30);
        assert.ok(step.sidePlatesKg.length <= 2048);
        assert.ok(step.sidePlatesKg.every((plate) => Number.isFinite(plate) && plate > 0));
        assert.doesNotMatch(step.platesDescription, /NaN|Infinity/);
      }
    }
    const plates = WarmupLadderCalculator.calculateSidePlates(input, input);
    assert.ok(plates.length <= 2048);
    assert.ok(plates.every((plate) => Number.isFinite(plate) && plate > 0));
    assert.doesNotMatch(WarmupLadderCalculator.formatPlates(input, input), /NaN|Infinity/);
  }
  assert.ok(performance.now() - started < 1000, "hostile warmup inputs must return promptly");
});

test("WarmupLadderCalculator preserves half-kilo target rounding and all existing bars", () => {
  const cases = [
    { bar: 20, plates: [25, 15] },
    { bar: 15, plates: [25, 15, 2.5] },
    { bar: 10, plates: [25, 20] },
    { bar: 8, plates: [25, 20] },
  ];
  for (const example of cases) {
    assert.deepEqual(WarmupLadderCalculator.calculateSidePlates(100, example.bar), example.plates);
    const ladder = WarmupLadderCalculator.generateLadder(100.25, 6, example.bar);
    assert.equal(ladder[0].weightKg, example.bar);
    assert.equal(ladder[ladder.length - 1].weightKg, 100.5);
    assert.equal(ladder[ladder.length - 1].reps, 6);
    for (let i = 1; i < ladder.length; i++) assert.ok(ladder[i].weightKg >= ladder[i - 1].weightKg);
  }
});

test("WarmupLadderCalculator clamps targets before percentages, formatting and plate calculations", () => {
  assert.deepEqual(WarmupLadderCalculator.generateLadder(1e20, 6, 20), WarmupLadderCalculator.generateLadder(400, 6, 20));
  assert.deepEqual(WarmupLadderCalculator.calculateSidePlates(1e20, 20), WarmupLadderCalculator.calculateSidePlates(400, 20));
  assert.equal(WarmupLadderCalculator.formatPlates(1e20, 20), WarmupLadderCalculator.formatPlates(400, 20));
  assert.equal(WarmupLadderCalculator.formatPlates(1e20, 1e20), WarmupLadderCalculator.formatPlates(400, 100));
  assert.equal(WarmupLadderCalculator.generateLadder(NaN, 6, 20)[0].weightKg, 20);
  assert.equal(WarmupLadderCalculator.generateLadder(Infinity, 6, 20)[0].weightKg, 20);
  assert.equal(WarmupLadderCalculator.formatPlates(-10, 20), "Пустой гриф");
});

