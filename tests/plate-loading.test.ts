import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PlateLoadingCalculator, type PlateLoadingResult } from "../src/domain/PlateLoadingCalculator";
import PlateCalculator, { calculatePlatesGreedy, OLYMPIC_PLATES } from "../src/components/PlateCalculator";
import { WarmupModal } from "../src/components/WarmupModal";

function assertFiniteResult(result: PlateLoadingResult): void {
  assert.ok(result.plates.length <= PlateLoadingCalculator.MAX_PLATES_PER_SIDE);
  assert.ok(result.plates.every((plate) => Number.isFinite(plate) && plate > 0));
  for (const value of [result.weightPerSide, result.actualLoaded, result.remainder]) {
    assert.ok(Number.isFinite(value) && value >= 0);
  }
  assert.ok(result.actualLoaded <= PlateLoadingCalculator.MAX_TOTAL_WEIGHT_KG + 1e-8);
}

test("PlateLoadingCalculator keeps standard greedy layout and exact bar accounting", () => {
  const cases = [
    { total: 100, bar: 20, plates: [25, 15], side: 40, actual: 100, remainder: 0 },
    { total: 100, bar: 15, plates: [25, 15, 2.5], side: 42.5, actual: 100, remainder: 0 },
    { total: 100, bar: 10, plates: [25, 20], side: 45, actual: 100, remainder: 0 },
    { total: 100, bar: 8, plates: [25, 20], side: 46, actual: 98, remainder: 1 },
    { total: 20, bar: 20, plates: [], side: 0, actual: 20, remainder: 0 },
    { total: 10, bar: 20, plates: [], side: 0, actual: 20, remainder: 0 },
  ];
  for (const example of cases) {
    assert.deepEqual(PlateLoadingCalculator.calculate(example.total, example.bar), {
      plates: example.plates,
      weightPerSide: example.side,
      actualLoaded: example.actual,
      remainder: example.remainder,
    });
  }
});

test("PlateLoadingCalculator preserves quarter targets and increments without forcing 2.5 kg", () => {
  assert.deepEqual(PlateLoadingCalculator.calculate(80.25, 20), {
    plates: [25, 5], weightPerSide: 30.125, actualLoaded: 80, remainder: 0.125,
  });
  assert.equal(PlateLoadingCalculator.clampWeight(80.25), 80.25);
  assert.equal(PlateLoadingCalculator.adjustWeight(80.25, 2.5, 20), 82.75);
  assert.equal(PlateLoadingCalculator.adjustWeight(80.25, -2.5, 20), 77.75);
  assert.equal(PlateLoadingCalculator.adjustWeight(20, -10, 20), 20);
  assert.equal(PlateLoadingCalculator.adjustWeight(10, -10, 8), 8);
  assert.equal(PlateLoadingCalculator.adjustWeight(1000, 10, 20), 1000);
});

test("PlateLoadingCalculator accepts fractional custom inventory and never mutates it", () => {
  const inventory = [0.5, 25, 0.25, 5, 25];
  const original = [...inventory];
  assert.deepEqual(PlateLoadingCalculator.calculate(81.5, 20, inventory), {
    plates: [25, 5, 0.5, 0.25], weightPerSide: 30.75, actualLoaded: 81.5, remainder: 0,
  });
  assert.deepEqual(inventory, original);
  const halves = PlateLoadingCalculator.calculate(100, 20, [0.5]);
  assert.equal(halves.plates.length, 80);
  assert.equal(halves.actualLoaded, 100);
  assert.equal(halves.remainder, 0);
  const quarters = PlateLoadingCalculator.calculate(1000, 0, [0.25]);
  assert.equal(quarters.plates.length, 2000);
  assert.equal(quarters.actualLoaded, 1000);
  assert.equal(quarters.remainder, 0);
  const decimals = PlateLoadingCalculator.calculate(20.6, 20, [0.1]);
  assert.deepEqual(decimals.plates, [0.1, 0.1, 0.1]);
  assert.ok(Math.abs(decimals.actualLoaded - 20.6) < 1e-8);
  assertFiniteResult(quarters);
});

test("PlateLoadingCalculator promptly clamps huge/non-finite/negative loads, bars and adjustments", () => {
  const started = performance.now();
  const inputs = [1e20, Number.MAX_VALUE, Infinity, -Infinity, NaN, -100, 20];
  for (const total of inputs) {
    for (const bar of inputs) {
      const result = PlateLoadingCalculator.calculate(total, bar);
      assertFiniteResult(result);
      assert.ok(result.weightPerSide <= 500);
      const adjusted = PlateLoadingCalculator.adjustWeight(total, bar, bar);
      assert.ok(Number.isFinite(adjusted) && adjusted >= 0 && adjusted <= 1000);
    }
  }
  assert.equal(PlateLoadingCalculator.calculate(1e20, 20).actualLoaded, 1000);
  assert.equal(PlateLoadingCalculator.calculate(Infinity, 20).actualLoaded, 20);
  assert.equal(PlateLoadingCalculator.calculate(NaN, 20).actualLoaded, 20);
  assert.equal(PlateLoadingCalculator.clampWeight("1e20"), 1000);
  assert.equal(PlateLoadingCalculator.clampWeight("Infinity", 0, 1000, 60), 60);
  assert.equal(PlateLoadingCalculator.clampWeight("NaN", 20), 20);
  assert.equal(PlateLoadingCalculator.clampWeight("-100"), 0);
  assert.equal(PlateLoadingCalculator.clampWeight(""), 0);
  assert.equal(PlateLoadingCalculator.clampBarWeight(NaN), 20);
  assert.equal(PlateLoadingCalculator.clampBarWeight("8"), 8);
  assert.equal(PlateLoadingCalculator.clampBarWeight(1e20), 100);
  assert.ok(performance.now() - started < 1000, "hostile numeric inputs must return promptly");
});

test("PlateLoadingCalculator rejects invalid inventory and caps tiny no-progress plates and type counts", () => {
  const started = performance.now();
  assert.deepEqual(PlateLoadingCalculator.calculate(80, 20, [0, -5, Infinity, NaN, -Infinity]), {
    plates: [], weightPerSide: 30, actualLoaded: 20, remainder: 30,
  });
  assert.deepEqual(PlateLoadingCalculator.calculate(71, 20, [NaN, 0, 0.5, Infinity, -5, 25]).plates, [25, 0.5]);
  const tiny = PlateLoadingCalculator.calculate(1000, 20, [Number.MIN_VALUE]);
  assert.equal(tiny.plates.length, PlateLoadingCalculator.MAX_PLATES_PER_SIDE);
  assertFiniteResult(tiny);
  assert.equal(tiny.remainder, 490);
  assert.deepEqual(PlateLoadingCalculator.calculate(20, 20, [Number.MIN_VALUE]).plates, []);
  const oversizedInventory = [...Array<number>(PlateLoadingCalculator.MAX_PLATE_TYPES).fill(0), 25];
  assert.deepEqual(PlateLoadingCalculator.calculate(80, 20, oversizedInventory).plates, []);
  assert.ok(performance.now() - started < 1000, "pathological inventories must return promptly");
});

test("PlateLoadingCalculator conserves load and remainder across normal quarter weights and bar choices", () => {
  for (const bar of [0, 8, 10, 15, 20]) {
    for (let quarter = 0; quarter <= 1600; quarter++) {
      const target = quarter / 4;
      const result = PlateLoadingCalculator.calculate(target, bar);
      const plateTotal = result.plates.reduce((sum, plate) => sum + plate, 0);
      assert.equal(result.weightPerSide, Math.max(0, (target - bar) / 2));
      assert.equal(result.actualLoaded, bar + plateTotal * 2);
      assert.equal(result.actualLoaded + result.remainder * 2, Math.max(target, bar));
      assert.ok(result.actualLoaded >= bar && result.actualLoaded <= Math.max(target, bar));
      assert.ok(result.remainder >= 0 && result.remainder < 1.25);
      assert.ok(result.plates.length < 32);
    }
  }
});

test("calculatePlatesGreedy keeps plate specs/order and accounting while sharing safety clamps", () => {
  const result = calculatePlatesGreedy(100, 20);
  assert.deepEqual(result.plates.map((plate) => plate.weight), [25, 15]);
  assert.equal(result.plates[0], OLYMPIC_PLATES[0]);
  assert.equal(result.plates[1], OLYMPIC_PLATES[2]);
  assert.equal(result.weightPerSide, 40);
  assert.equal(result.actualLoaded, 100);
  assert.equal(result.remainder, 0);
  assert.equal(calculatePlatesGreedy(80.25, 20).remainder, 0.125);
  for (const value of [1e20, Number.MAX_VALUE, Infinity, -Infinity, NaN, -10]) {
    const safe = calculatePlatesGreedy(value, value);
    assertFiniteResult({ ...safe, plates: safe.plates.map((plate) => plate.weight) });
  }
});

test("PlateCalculator renders bounded initial weights and keeps apply/step labels", () => {
  const cases = [
    { input: 1e20, expected: 1000 },
    { input: Infinity, expected: 60 },
    { input: NaN, expected: 60 },
    { input: -10, expected: 0 },
    { input: 0, expected: 60 },
    { input: 80.25, expected: 80.25 },
  ];
  for (const example of cases) {
    const html = renderToStaticMarkup(createElement(PlateCalculator, {
      initialWeight: example.input, onClose: () => {}, onApplyWeight: () => {},
    }));
    assert.ok(html.includes(`Применить ${example.expected} кг к подходу`));
    assert.doesNotMatch(html, /NaN|Infinity/);
    for (const label of ["Закрыть", "Минус 10 кг", "Минус 2.5 кг", "Плюс 2.5 кг", "Плюс 10 кг"]) {
      assert.ok(html.includes(`aria-label="${label}"`));
    }
  }
});

test("WarmupModal renders finite clamped defaults and keeps original labels and limits", () => {
  const cases = [
    { weight: 1e20, reps: 1e20, expectedWeight: 400, expectedReps: 30 },
    { weight: Infinity, reps: Infinity, expectedWeight: 20, expectedReps: 1 },
    { weight: NaN, reps: NaN, expectedWeight: 20, expectedReps: 1 },
    { weight: -10, reps: -10, expectedWeight: 20, expectedReps: 1 },
    { weight: 80.5, reps: 6, expectedWeight: 80.5, expectedReps: 6 },
  ];
  for (const example of cases) {
    const html = renderToStaticMarkup(createElement(WarmupModal, {
      defaultWeight: example.weight, defaultReps: example.reps, onClose: () => {},
    }));
    assert.match(html, new RegExp(`max="400"[^>]*value="${example.expectedWeight}"`));
    assert.match(html, new RegExp(`max="30"[^>]*value="${example.expectedReps}"`));
    assert.doesNotMatch(html, /NaN|Infinity/);
    for (const label of ["Разминочная лесенка (OpenGym)", "Рабочий вес (кг):", "Повторений в подходе:", "Гриф:"]) {
      assert.ok(html.includes(label));
    }
    for (const bar of [8, 10, 15, 20]) assert.ok(html.includes(`value="${bar}"`));
  }
});
