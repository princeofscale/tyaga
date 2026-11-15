import test from "node:test";
import assert from "node:assert/strict";
import { DeloadEngine } from "../src/domain/DeloadEngine";
import { HistoryFilter } from "../src/domain/HistoryFilter";
import { MachineRegistry } from "../src/domain/MachineRegistry";
import { makeWorkout } from "../src/lib/model";
import { ExecutionIdentity } from "../src/domain/ExecutionIdentity";
import { TrainingProgram } from "../src/domain/TrainingProgram";
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

test("QA-R06-12: ключ «прошлого» с подходом совпадает с ключом разбитой записи, а без подхода — нет", () => {
  const w = makeWorkout(["bench"], [], "UTC");
  const entry = { ...w.exercises[0], sets: w.exercises[0].sets.map((s) => ({ ...s, execution: { rom: "full" as const } })) };
  const set = entry.sets[0];
  assert.notEqual(ExecutionIdentity.key(entry), ExecutionIdentity.key(entry, set));
  assert.equal(ExecutionIdentity.split(entry)[0] && ExecutionIdentity.key(ExecutionIdentity.split(entry)[0]), ExecutionIdentity.key(entry, set));
});

test("QA-R06-13: разгрузочные записи не бывают базой веса программы", () => {
  const base = makeWorkout(["bench"], [], "UTC", true);
  base.exercises.forEach((e) => (e.sets = e.sets.slice(0, 3).map((s) => ({ ...s, weight: 60, reps: 8 }))));
  const routine = { ...TrainingProgram.empty(), id: "r", name: "Ноги А", days: [1], revision: 1, exercises: base.exercises };
  const done = (id: string, name: string, date: string, kg: number): Workout => {
    const x = makeWorkout(["bench"], [], "UTC");
    return { ...x, id, name, date, exercises: x.exercises.map((e) => ({ ...e, sets: e.sets.map((s) => ({ ...s, weight: kg, reps: 11, done: true, warmup: false })) })) } as Workout;
  };
  const history = [done("a", "Ноги А", "2026-11-01", 95), done("b", "Ноги А [Разгрузка]", "2026-11-08", 80)];
  const started = new TrainingProgram(routine).start(history, "UTC");
  assert.equal(started.exercises[0].sets[0].weight, 95);
});
