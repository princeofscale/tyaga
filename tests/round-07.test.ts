import { DeloadHint } from "../src/domain/DeloadHint";
import { makeWorkout } from "../src/lib/model";
import { BackdatedWorkout } from "../src/domain/BackdatedWorkout";
import test from "node:test";
import assert from "node:assert/strict";
import { PlanLine } from "../src/domain/PlanLine";
import { setsWord, workingSets, workingSetsWord } from "../src/lib/quantity";
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

const draftOf = (date: string, over: Partial<Parameters<typeof BackdatedWorkout.isBackdated>[0]> = {}, startedAt = Date.parse("2026-11-10T12:00:00Z")) =>
  ({ startedAt, manualDuration: false, workout: { date }, ...over }) as Parameters<typeof BackdatedWorkout.isBackdated>[0];

test("R07-REQ04: задним числом — по поясу профиля, сегодня шапку не меняет", () => {
  const now = new Date("2026-11-10T22:30:00Z"); // в Саратове (UTC+4) уже 11 нояб., в UTC ещё 10 нояб.
  const started = Date.parse("2026-11-10T12:00:00Z");
  // выбрана дата раньше сегодняшней в поясе профиля
  assert.equal(BackdatedWorkout.isBackdated(draftOf("2026-11-09", {}, started), "Europe/Saratov", now), true);
  assert.equal(BackdatedWorkout.isBackdated(draftOf("2026-11-09", {}, started), "UTC", now), true);
  assert.equal(BackdatedWorkout.isBackdated(draftOf("2026-11-11", {}, started), "Europe/Saratov", now), false);
  // старт через «Записать тренировку»: подпись есть и при сегодняшней дате
  assert.equal(BackdatedWorkout.label(draftOf("2026-11-11", { retro: true }, started), "Europe/Saratov", now), "11 нояб. · выбрать дату");
  assert.equal(BackdatedWorkout.label(draftOf("2026-11-14", { retro: true }), "UTC", new Date("2026-11-15T09:00:00Z")), "14 нояб. · задним числом");
  assert.equal(BackdatedWorkout.label(draftOf("2025-12-31", { retro: true }), "UTC", now), "31 дек. 2025 · задним числом");
  // обычная сегодняшняя тренировка — шапка не меняется
  assert.equal(BackdatedWorkout.label(draftOf("2026-11-11", {}, started), "Europe/Saratov", now), null);
  assert.equal(BackdatedWorkout.label(draftOf("2026-11-10"), "UTC", new Date("2026-11-10T20:00:00Z")), null);
  // таймер: дата выбрана раньше сегодняшней → длительность задана, а не считается от «сейчас»
  assert.equal(BackdatedWorkout.manualDuration(draftOf("2026-11-09"), "UTC", now), true);
  assert.equal(BackdatedWorkout.manualDuration(draftOf("2026-11-10"), "UTC", new Date("2026-11-10T20:00:00Z")), false);
  assert.equal(BackdatedWorkout.manualDuration(draftOf("2026-11-10", { manualDuration: true }), "UTC", now), true);
  assert.equal(BackdatedWorkout.isBackdated(draftOf("не дата"), "UTC", now), false);
  assert.equal(BackdatedWorkout.isBackdated(draftOf("2026-11-01", { editing: true }), "UTC", now), false);
});

test("QA-R07-01: тренировка, начатая до полуночи по поясу профиля, после полуночи остаётся обычной", () => {
  // 23:50 по Саратову (UTC+4) 15 нояб. = 19:50Z; в 00:10 16 нояб. = 20:10Z
  const startedAt = Date.parse("2026-11-15T19:50:00Z");
  const after = new Date("2026-11-15T20:10:00Z");
  const regular = draftOf("2026-11-15", {}, startedAt);
  assert.equal(BackdatedWorkout.isBackdated(regular, "Europe/Saratov", after), false);
  assert.equal(BackdatedWorkout.label(regular, "Europe/Saratov", after), null);
  assert.equal(BackdatedWorkout.manualDuration(regular, "Europe/Saratov", after), false);
  // то же по поясу браузера не важно: считается пояс профиля, у тренировки — свой
  assert.equal(BackdatedWorkout.manualDuration({ ...regular, workout: { date: "2026-11-15", timeZone: "Europe/Saratov" } }, "UTC", after), false);
  // дату в «Деталях» поменяли на другой день → задним числом
  const moved = draftOf("2026-11-14", {}, startedAt);
  assert.equal(BackdatedWorkout.label(moved, "Europe/Saratov", after), "14 нояб. · задним числом");
  assert.equal(BackdatedWorkout.manualDuration(moved, "Europe/Saratov", after), true);
  // «Записать тренировку» ночью: старт 23:50, 15 нояб. — после полуночи дата остаётся выбранной задним числом
  const retro = draftOf("2026-11-15", { retro: true }, startedAt);
  assert.equal(BackdatedWorkout.label(retro, "Europe/Saratov", after), "15 нояб. · задним числом");
});

test("R07-REQ05: строка разгрузки и «Подставить 85 %» — от последней обычной, идемпотентно, только свободные веса", () => {
  const record = { mode: "volume" as const, from: "2026-11-15", until: "2026-11-21", programs: ["Ноги А"], sets: { before: 14, after: 9 } };
  assert.equal(DeloadHint.line(record, "2026-11-16"), "Разгрузка до 21 нояб.: 85 % веса, 64 % подходов");
  assert.equal(DeloadHint.line(record, "2026-11-21"), "Разгрузка до 21 нояб.: 85 % веса, 64 % подходов");
  assert.equal(DeloadHint.line(record, "2026-11-22"), null);
  assert.equal(DeloadHint.line(null, "2026-11-16"), null);
  assert.equal(DeloadHint.line({ ...record, sets: undefined }, "2026-11-16"), "Разгрузка до 21 нояб.: 85 % веса, 50 % подходов");
  assert.equal(DeloadHint.percent("volume"), 85);

  const w = makeWorkout(["bench", "pullup"], [], "UTC");
  const sets = (kg: number, done = false) => [0, 1, 2].map((k) => ({ id: `s${k}${kg}${done}`, weight: kg, reps: 8, rir: 2, warmup: false, done })) as SetEntry[];
  w.exercises[0].sets = [{ ...sets(20)[0], id: "warm", warmup: true }, ...sets(90), { ...sets(90, true)[0], id: "d" }];
  w.exercises[1].sets = sets(10);
  const base = (e: { exerciseId: string }) => (e.exerciseId === "bench" ? sets(95, true) : sets(10, true));
  const once = DeloadHint.apply(w, "volume", base as never);
  const bench = once.workout.exercises[0].sets;
  // 95 × 0,85 = 80,75 → шаг 2,5 → 80; разминка и уже отмеченный подход не тронуты
  assert.deepEqual(bench.map((s) => s.weight), [20, 80, 80, 80, 90]);
  assert.equal(once.changed, 3);
  // «вес тела» не меняется и считается пропущенным
  assert.deepEqual(once.workout.exercises[1].sets.map((s) => s.weight), [10, 10, 10]);
  assert.equal(once.exercises, 1);
  assert.equal(once.skipped, 1);
  // повторное нажатие: те же 80, а не 67,5; ничего нового не изменено
  const twice = DeloadHint.apply(once.workout, "volume", base as never);
  assert.deepEqual(twice.workout.exercises[0].sets.map((s) => s.weight), [20, 80, 80, 80, 90]);
  assert.equal(twice.changed, 0);
  // без нажатия исходная тренировка не меняется
  assert.deepEqual(w.exercises[0].sets.map((s) => s.weight), [20, 90, 90, 90, 90]);
  // нет прошлой обычной тренировки — ничего не меняется
  assert.equal(DeloadHint.apply(w, "volume", () => undefined).changed, 0);
});

test("QA-R07-02: подпись под числом на карточке для сторис склоняется (подход / подхода / подходов)", () => {
  const expected: Record<number, string> = { 0: "подходов", 1: "подход", 2: "подхода", 4: "подхода", 5: "подходов", 11: "подходов", 12: "подходов", 14: "подходов", 21: "подход", 22: "подхода", 25: "подходов", 101: "подход", 111: "подходов" };
  for (const [n, word] of Object.entries(expected)) assert.equal(setsWord(Number(n)), word, `${n}`);
});

test("QA-R07-06: «Подставить 85 %» не трогает тренажёры (блок/стек), но считает их пропущенными", () => {
  const w = makeWorkout(["bench", "fly"], [], "UTC");
  const sets = (kg: number, done = false) => [0, 1].map((k) => ({ id: `m${k}${kg}${done}`, weight: kg, reps: 10, rir: 2, warmup: false, done })) as SetEntry[];
  w.exercises[0].sets = sets(90);
  w.exercises[1].sets = sets(100); // сведение рук в кроссовере: machine_stack
  const result = DeloadHint.apply(w, "volume", (e) => (e.exerciseId === "bench" ? sets(95, true) : sets(100, true)));
  assert.deepEqual(result.workout.exercises[0].sets.map((s) => s.weight), [80, 80]);
  assert.deepEqual(result.workout.exercises[1].sets.map((s) => s.weight), [100, 100]);
  assert.equal(result.exercises, 1);
  assert.equal(result.skipped, 1);
  assert.equal(DeloadHint.isFree("machine_stack"), false);
  assert.equal(DeloadHint.isFree("bodyweight"), false);
  assert.equal(DeloadHint.isFree("assisted_bodyweight"), false);
  assert.equal(DeloadHint.isFree("per_implement"), true);
});
