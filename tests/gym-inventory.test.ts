import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_GYM_INVENTORY, GymInventoryStore } from "../src/domain/GymInventory";
import { calculatePlatesGreedy } from "../src/domain/plateSpecs";

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
  };
}

test("GymInventoryStore returns defaults when empty or corrupt", () => {
  const store = memoryStorage();
  assert.deepEqual(GymInventoryStore.read(store), DEFAULT_GYM_INVENTORY);

  store.setItem("tyaga-gym-inventory-v1", "{bad-json");
  assert.deepEqual(GymInventoryStore.read(store), DEFAULT_GYM_INVENTORY);

  store.setItem("tyaga-gym-inventory-v1", JSON.stringify({ barWeightKg: 99, minPlateKg: 0.5 }));
  assert.deepEqual(GymInventoryStore.read(store), DEFAULT_GYM_INVENTORY);
});

test("GymInventoryStore persists bar weight and min plate choices", () => {
  const store = memoryStorage();
  const saved = GymInventoryStore.save({ barWeightKg: 15, minPlateKg: 2.5 }, store);
  assert.deepEqual(saved, { barWeightKg: 15, minPlateKg: 2.5 });
  assert.deepEqual(GymInventoryStore.read(store), { barWeightKg: 15, minPlateKg: 2.5 });
  assert.deepEqual(GymInventoryStore.allowedPlateWeights(saved), [25, 20, 15, 10, 5, 2.5]);
});

test("GymInventoryStore respects min plate 2.5 kg in plate loading and formatting", () => {
  const inv = { barWeightKg: 15 as const, minPlateKg: 2.5 as const };
  const allowed = GymInventoryStore.allowedPlateWeights(inv);

  const exact = calculatePlatesGreedy(60, 15, allowed);
  assert.deepEqual(exact.plates.map((p) => p.weight), [20, 2.5]);
  assert.equal(exact.actualLoaded, 60);

  const rounded = calculatePlatesGreedy(62.5, 15, allowed);
  assert.deepEqual(rounded.plates.map((p) => p.weight), [20, 2.5]);
  assert.equal(rounded.actualLoaded, 60);

  assert.equal(GymInventoryStore.formatPlatesForBar(60, inv), "На сторону: 20 + 2,5 кг");
  assert.equal(GymInventoryStore.formatPlatesForBar(15, inv), "Пустой гриф (15 кг)");
});
