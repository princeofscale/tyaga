import test from "node:test";
import assert from "node:assert/strict";
import { PlanLine } from "../src/domain/PlanLine";
import { workingSets, workingSetsWord } from "../src/lib/quantity";
import type { SetEntry } from "../src/lib/types";

const set = (reps: number, warmup = false) => ({ id: `${Math.random()}`, weight: 60, reps, rir: null, warmup, done: false }) as SetEntry;

test("R07-REQ01: строка плана — диапазон, конкретные повторы, без повторов, без разминки; никогда «× 0»", () => {
  assert.equal(PlanLine.sets({ sets: [set(0), set(0), set(0)], repMin: 8, repMax: 12 }), "3 × 8–12");
  assert.equal(PlanLine.sets({ sets: [set(10), set(10), set(10)] }), "3 × 10");
  assert.equal(PlanLine.sets({ sets: [set(0), set(0), set(0)] }), "3 подх.");
  assert.equal(PlanLine.sets({ sets: [set(10), set(10), set(10)], repMin: 10, repMax: 10 }), "3 × 10");
  // Разминка не считается подходом: 2 разминочных + 3 рабочих.
  assert.equal(PlanLine.sets({ sets: [set(12, true), set(8, true), set(10), set(10), set(10)] }), "3 × 10");
  assert.equal(PlanLine.sets({ sets: [set(12, true), set(8, true), set(0), set(0), set(0)] }), "3 подх.");
  // Разные повторы в подходах — диапазон из них; только repMin — одно число.
  assert.equal(PlanLine.sets({ sets: [set(8), set(10), set(12)] }), "3 × 8–12");
  assert.equal(PlanLine.sets({ sets: [set(0), set(0)], repMin: 6 }), "2 × 6");
  for (const line of [PlanLine.sets({ sets: [set(0)] }), PlanLine.sets({ sets: [set(0), set(0)], repMin: 0, repMax: 0 })])
    assert.doesNotMatch(line, /× 0/);
});

test("R07-REQ02: склонение «рабочих подходов»", () => {
  const expected: Record<number, string> = {
    0: "0 рабочих подходов", 1: "1 рабочий подход", 2: "2 рабочих подхода", 4: "4 рабочих подхода", 5: "5 рабочих подходов",
    11: "11 рабочих подходов", 12: "12 рабочих подходов", 14: "14 рабочих подходов", 21: "21 рабочий подход", 22: "22 рабочих подхода",
    25: "25 рабочих подходов", 101: "101 рабочий подход", 111: "111 рабочих подходов",
  };
  for (const [n, text] of Object.entries(expected)) {
    assert.equal(workingSets(Number(n)), text);
    assert.equal(`${n} ${workingSetsWord(Number(n))}`, text);
  }
});
