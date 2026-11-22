import test from "node:test";
import assert from "node:assert/strict";
import { LaidDupPlan } from "../src/domain/LaidDupPlan";
import { makeWorkout } from "../src/lib/model";
import type { LaidMaxes, Workout } from "../src/lib/types";

const TZ = "UTC";
const MAXES: LaidMaxes = { squat: 100, bench: 80, deadlift: 140, ohp: 60 };
/** Понедельник старта: недели 0…8 — 09.11 … 04.01, десятая начинается 11.01.2027. */
const START = "2026-11-09";
const six = (opts: Partial<{ maxes: LaidMaxes; startMonday: string }> = {}) =>
  LaidDupPlan.routines({ maxes: MAXES, extras: true, light: false, startMonday: START, ...opts });
const firstPeriodization = (opts: Partial<{ maxes: LaidMaxes; startMonday: string }> = {}) => six(opts)[0].periodization!;

/** Тренировка с одним подходом базового упражнения; всё остальное — по умолчанию. */
const done = (
  exerciseId: string,
  weight: number,
  reps: number,
  date: string,
  patch: Partial<Workout["exercises"][number]["sets"][number]> = {},
): Workout => {
  const workout = makeWorkout([exerciseId], [], TZ, true);
  workout.date = date;
  workout.exercises[0].sets = [{ id: crypto.randomUUID(), weight, reps, rir: 1, warmup: false, done: true, ...patch }];
  return workout;
};

test("ЛАЙД · авто: без свежей оценки или без роста на 5 % максимумы не трогаются", () => {
  const p = firstPeriodization();
  assert.equal(LaidDupPlan.autoMaxes(p, [], "2026-11-16"), null, "пустой журнал");
  // 84 кг — это ровно +5 % к 80: подсказка срабатывает, 83 — нет
  assert.equal(LaidDupPlan.autoMaxes(p, [done("bench", 83, 1, "2026-11-10")], "2026-11-16"), null);
  assert.ok(LaidDupPlan.autoMaxes(p, [done("bench", 84, 1, "2026-11-10")], "2026-11-16"));
  // подходы за окном 28 дней и подходы до начала действующей настройки не считаются
  assert.equal(LaidDupPlan.autoMaxes(p, [done("bench", 120, 1, "2026-09-01")], "2026-11-16"), null);
  assert.equal(LaidDupPlan.autoMaxes(p, [done("bench", 120, 1, "2026-11-08")], "2026-11-16"), null, "до старта цикла");
  assert.equal(LaidDupPlan.autoMaxes(p, [done("bench", 120, 1, "2026-11-12")], "2026-11-16")?.applied[0].to, 120);
});

test("ЛАЙД · авто: разминочные и невыполненные подходы не поднимают максимум", () => {
  const p = firstPeriodization();
  assert.equal(LaidDupPlan.autoMaxes(p, [done("bench", 120, 1, "2026-11-10", { warmup: true })], "2026-11-16"), null);
  assert.equal(LaidDupPlan.autoMaxes(p, [done("bench", 120, 1, "2026-11-10", { done: false })], "2026-11-16"), null);
});

test("ЛАЙД · авто: растёт только тот лифт, который вырос; числа — с текущей недели", () => {
  const p = firstPeriodization();
  const workouts = [done("bench", 90, 1, "2026-11-10"), done("deadlift-bar", 145, 1, "2026-11-10")];
  const update = LaidDupPlan.autoMaxes(p, workouts, "2026-11-16")!;
  assert.deepEqual(update.applied.map((a) => [a.lift, a.from, a.to]), [["bench", 80, 90]], "становая 145 меньше +5 % к 140");
  assert.deepEqual(update.maxes, { squat: 100, bench: 90, deadlift: 140, ohp: 60 });
  assert.equal(update.fromWeek, 1, "сегодня вторая неделя цикла");
  const updated = LaidDupPlan.withMaxes(p, update.maxes, update.fromWeek);
  assert.deepEqual(updated.earlier, [{ fromWeek: 0, maxes: MAXES }], "прежние максимумы остались для первой недели");
  assert.equal(LaidDupPlan.maxesFor(updated, 0).bench, 80);
  assert.equal(LaidDupPlan.maxesFor(updated, 1).bench, 90);
});

test("ЛАЙД · авто: после пересчёта правило не срабатывает второй раз — цикла обновлений нет", () => {
  const p = firstPeriodization();
  const workouts = [done("bench", 90, 1, "2026-11-10")];
  const update = LaidDupPlan.autoMaxes(p, workouts, "2026-11-16")!;
  const updated = LaidDupPlan.withMaxes(p, update.maxes, update.fromWeek);
  assert.equal(LaidDupPlan.autoMaxes(updated, workouts, "2026-11-16"), null, "тот же подход второй раз не поднимает");
  // и на следующей неделе тоже: окно начинается с понедельника действующей настройки
  assert.equal(LaidDupPlan.autoMaxes(updated, workouts, "2026-11-23"), null);
  // а новый, более высокий подход — поднимает
  assert.equal(LaidDupPlan.autoMaxes(updated, [done("bench", 100, 1, "2026-11-20")], "2026-11-23")?.applied[0].to, 100);
});

test("ЛАЙД · авто: несколько лифтов сразу; максимумы только растут", () => {
  const p = firstPeriodization();
  const workouts = [done("bench", 90, 1, "2026-11-10"), done("squat", 130, 3, "2026-11-11"), done("ohp", 40, 1, "2026-11-12")];
  const update = LaidDupPlan.autoMaxes(p, workouts, "2026-11-16")!;
  assert.deepEqual(update.applied.map((a) => a.lift).sort(), ["bench", "squat"]);
  assert.equal(update.maxes.ohp, 60, "слабый жим стоя максимум не понижает");
  // 130 × 3 по Эпли = 143 → вниз до 2,5 кг = 142,5
  assert.equal(update.maxes.squat, 142.5);
});

test("ЛАЙД · авто: законченный цикл не пересчитывается", () => {
  const p = firstPeriodization();
  const workouts = [done("bench", 120, 1, "2027-01-05")];
  assert.ok(LaidDupPlan.autoMaxes(p, workouts, "2027-01-06"), "девятая неделя ещё считается");
  assert.equal(LaidDupPlan.autoMaxes(p, workouts, "2027-01-12"), null, "десятая неделя — цикл закончен");
});

test("ЛАЙД · авто: уведомление называет лифт, числа и неделю", () => {
  const p = firstPeriodization();
  const update = LaidDupPlan.autoMaxes(p, [done("bench", 90, 1, "2026-11-10")], "2026-11-16")!;
  const text = LaidDupPlan.autoNotice(update);
  assert.match(text, /Максимумы обновлены автоматически: жим лёжа 80 → 90 кг/);
  assert.match(text, /по подходам за 28 дней/);
  assert.match(text, /новые веса — с недели 2/);
});
