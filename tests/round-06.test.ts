import test from "node:test";
import assert from "node:assert/strict";
import { DeloadEngine } from "../src/domain/DeloadEngine";
import { HistoryFilter } from "../src/domain/HistoryFilter";
import { MachineRegistry } from "../src/domain/MachineRegistry";
import { makeWorkout } from "../src/lib/model";
import type { Workout } from "../src/lib/types";

const named = (id: string, name: string): Workout => ({ ...makeWorkout([], [], "UTC"), id, name, date: "2026-11-03" }) as Workout;

test("R06-REQ02: вес разгрузки — 85% с шагом 2,5, не выше прошлого; вес тела и время не меняются", () => {
  assert.equal(DeloadEngine.scaleLoad(95, "total_external", "volume"), 80);
  assert.equal(DeloadEngine.scaleLoad(80, "machine_stack", "intensity"), 75);
  assert.equal(DeloadEngine.scaleLoad(2.5, "per_implement", "recovery"), 2.5);
  assert.equal(DeloadEngine.scaleLoad(0, "total_external", "volume"), 0);
  assert.equal(DeloadEngine.scaleLoad(95, "bodyweight", "volume"), 95);
  assert.equal(DeloadEngine.scaleLoad(95, undefined, "volume"), 95);
});

test("R06-REQ02: «Ноги А» и «Ноги А [Разгрузка]» — один тип, название карточки сохраняет пометку", () => {
  assert.equal(DeloadEngine.baseName("Ноги А [Разгрузка]"), "Ноги А");
  assert.equal(DeloadEngine.baseName("Ноги А"), "Ноги А");
  const journal = [named("a", "Ноги А"), named("b", "Ноги А [Разгрузка]"), named("c", "Тяга")];
  assert.deepEqual(HistoryFilter.types(journal), [{ name: "Ноги А", count: 2 }, { name: "Тяга", count: 1 }]);
  const found = HistoryFilter.filter(journal, { ...HistoryFilter.EMPTY, type: "Ноги А" }, () => "");
  assert.deepEqual(found.map((w) => w.name), ["Ноги А", "Ноги А [Разгрузка]"]);
});

test("R06-REQ03: станция с одним названием проходит проверку, если модель подставлена из названия", () => {
  const draft = MachineRegistry.create();
  const machine = { ...draft, nickname: "Жим ногами у окна", model: { ...draft.model, model: "" } };
  assert.throws(() => MachineRegistry.parse(machine));
  const parsed = MachineRegistry.parse({ ...machine, model: { ...machine.model, model: machine.nickname } });
  assert.equal(parsed.nickname, "Жим ногами у окна");
  assert.equal(parsed.model.model, "Жим ногами у окна");
});

test("QA-R06-02: база для разгрузки — тренировки без пометки; вес из разгрузочной не масштабируется второй раз", () => {
  const journal = [named("a", "Ноги А"), named("b", "Ноги А [Разгрузка]")];
  assert.deepEqual(DeloadEngine.regular(journal).map((w) => w.id), ["a"]);
  // Первая разгрузка: 95 → 80; вторая берёт базу 95 (а не 80) и снова даёт 80, а не 67,5.
  const once = DeloadEngine.scaleLoad(95, "total_external", "volume");
  assert.equal(once, 80);
  assert.equal(DeloadEngine.scaleLoad(95, "total_external", "volume"), once);
  assert.equal(DeloadEngine.scaleLoad(once, "total_external", "volume"), 67.5);
});
