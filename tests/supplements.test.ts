import test from "node:test";
import assert from "node:assert/strict";
import { SupplementsStore, SUPPLEMENT_CATALOG } from "../src/domain/Supplements";

test("SupplementsStore adds catalog & custom items, prevents duplicates, and tracks daily completion + streak", () => {
  let state = SupplementsStore.empty();
  state = SupplementsStore.addFromCatalog(state, "creatine");
  state = SupplementsStore.addFromCatalog(state, "creatine"); // duplicate ignored
  state = SupplementsStore.addFromCatalog(state, "whey-protein");
  state = SupplementsStore.addFromCatalog(state, "gainer");
  assert.equal(state.stack.length, 3);

  state = SupplementsStore.addCustom(state, {
    name: "Витамин C",
    dose: "1000 мг",
    timing: "morning",
    category: "vitamins",
  });
  assert.equal(state.stack.length, 4);

  // Mark all taken yesterday and 2 days ago
  state = SupplementsStore.markAllTaken(state, "2026-11-20", true);
  state = SupplementsStore.markAllTaken(state, "2026-11-21", true);

  // Today: only 2 taken so far -> streak counts from yesterday (2 days)
  state = SupplementsStore.toggleTaken(state, "2026-11-22", state.stack[0].id);
  state = SupplementsStore.toggleTaken(state, "2026-11-22", state.stack[1].id);
  const mid = SupplementsStore.summary(state, "2026-11-22");
  assert.equal(mid.taken, 2);
  assert.equal(mid.total, 4);
  assert.equal(mid.percent, 50);
  assert.equal(mid.streak, 2);
  assert.equal(mid.weekDays.length, 7);

  // Mark all taken today -> streak increments to 3
  state = SupplementsStore.markAllTaken(state, "2026-11-22", true);
  const full = SupplementsStore.summary(state, "2026-11-22");
  assert.equal(full.percent, 100);
  assert.equal(full.streak, 3);

  // Removing an item also removes it from logs
  const removedId = state.stack[0].id;
  state = SupplementsStore.remove(state, removedId);
  assert.equal(state.stack.length, 3);
  assert.ok(!state.logs["2026-11-22"].includes(removedId));
});

test("SupplementsStore validates numeric doses, rejects garbage text, supports reordering and weekly schedules", () => {
  assert.equal(SupplementsStore.validateDoseAmount("куцавп"), null);
  assert.equal(SupplementsStore.validateDoseAmount(""), null);
  assert.equal(SupplementsStore.validateDoseAmount("0"), null);
  assert.equal(SupplementsStore.validateDoseAmount("-5"), null);
  assert.equal(SupplementsStore.validateDoseAmount("5"), 5);
  assert.equal(SupplementsStore.validateDoseAmount("3,2"), 3.2);

  let state = SupplementsStore.empty();
  state = SupplementsStore.addFromCatalog(state, "creatine");
  state = SupplementsStore.addFromCatalog(state, "whey-protein");
  state = SupplementsStore.addFromCatalog(state, "omega3");

  const [cId, wId, oId] = state.stack.map((s) => s.id);
  // Reorder preserves exact custom order
  state = SupplementsStore.reorder(state, [oId, cId, wId]);
  assert.deepEqual(SupplementsStore.orderedStack(state.stack).map((s) => s.id), [oId, cId, wId]);

  // Structured dose update
  state = SupplementsStore.update(state, cId, { doseAmount: 7.5, doseUnit: "г" });
  const creatine = state.stack.find((s) => s.id === cId)!;
  assert.equal(creatine.dose, "7,5 г");
  assert.equal(creatine.doseAmount, 7.5);

  // Weekday schedule: Monday only (0). 2026-11-23 is Monday, 2026-11-24 is Tuesday.
  state = SupplementsStore.update(state, cId, { days: [0] });
  assert.equal(SupplementsStore.isScheduledOn(state.stack.find((s) => s.id === cId)!, "2026-11-23"), true);
  assert.equal(SupplementsStore.isScheduledOn(state.stack.find((s) => s.id === cId)!, "2026-11-24"), false);
  assert.equal(SupplementsStore.summary(state, "2026-11-24").total, 2);
});

test("SUPPLEMENT_CATALOG includes creatine, whey protein, gainer, and vitamins with valid defaults", () => {
  const ids = new Set(SUPPLEMENT_CATALOG.map((c) => c.id));
  for (const required of ["creatine", "whey-protein", "gainer", "omega3", "vitamin-d3", "magnesium"]) {
    assert.ok(ids.has(required), `Catalog must include ${required}`);
  }
});
