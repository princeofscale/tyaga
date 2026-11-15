import { BackdatedWorkout } from "../src/domain/BackdatedWorkout";
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

test("R07-REQ04: задним числом — по поясу профиля, сегодня шапку не меняет", () => {
  const now = new Date("2026-11-10T22:30:00Z"); // в Саратове (UTC+4) уже 11 нояб., в UTC ещё 10 нояб.
  assert.equal(BackdatedWorkout.isBackdated("2026-11-10", "Europe/Saratov", now), true);
  assert.equal(BackdatedWorkout.isBackdated("2026-11-10", "UTC", now), false);
  assert.equal(BackdatedWorkout.isBackdated("2026-11-11", "Europe/Saratov", now), false);
  assert.equal(BackdatedWorkout.label("2026-11-11", "Europe/Saratov", false, now), null);
  assert.equal(BackdatedWorkout.label("2026-11-10", "Europe/Saratov", false, now), "10 нояб. · задним числом");
  assert.equal(BackdatedWorkout.label("2026-11-10", "UTC", false, now), null);
  // старт через «Записать тренировку»: подпись есть и при сегодняшней дате
  assert.equal(BackdatedWorkout.label("2026-11-11", "Europe/Saratov", true, now), "11 нояб. · выбрать дату");
  assert.equal(BackdatedWorkout.label("2026-11-14", "UTC", true, new Date("2026-11-15T09:00:00Z")), "14 нояб. · задним числом");
  assert.equal(BackdatedWorkout.label("2025-12-31", "UTC", true, now), "31 дек. 2025 · задним числом");
  // таймер: не сегодняшняя дата → длительность задана, а не считается от «сейчас»
  assert.equal(BackdatedWorkout.manualDuration(false, "2026-11-09", "UTC", now), true);
  assert.equal(BackdatedWorkout.manualDuration(false, "2026-11-10", "UTC", now), false);
  assert.equal(BackdatedWorkout.manualDuration(true, "2026-11-10", "UTC", now), true);
  assert.equal(BackdatedWorkout.isBackdated("не дата", "UTC", now), false);
});
