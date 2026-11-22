import test from "node:test";
import assert from "node:assert/strict";
import { LaidDupPlan } from "../src/domain/LaidDupPlan";
import { TrainingCalendar } from "../src/domain/TrainingCalendar";
import { DAY_NAMES, TrainingProgram } from "../src/domain/TrainingProgram";
import { makeWorkout } from "../src/lib/model";
import type { LaidMaxes, Routine, Workout } from "../src/lib/types";

const MAXES: LaidMaxes = { squat: 100, bench: 80, deadlift: 140, ohp: 60 };
const START_MON = "2026-11-23"; // понедельник старта цикла

const laidCycle = (startMonday = START_MON, weekdays?: Partial<Record<"legs1" | "push1" | "pull1" | "legs2" | "push2" | "pull2", number>>) =>
  LaidDupPlan.routines({ maxes: MAXES, extras: true, light: false, startMonday, weekdays });

function doneWorkout(routine: Routine, date: string, programDate?: string): Workout {
  const w = makeWorkout(["bench"], [], "UTC", true);
  w.routineId = routine.id;
  w.date = date;
  if (programDate) w.programDate = programDate;
  return w;
}

test("TrainingCalendar does not schedule David Laid DUP occurrences before startMonday", () => {
  const routines = laidCycle(START_MON);
  // Вся неделя до старта (Пн 16 нояб. – Вс 22 нояб.) пустая
  for (const date of ["2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20", "2026-11-21", "2026-11-22"]) {
    assert.deepEqual(TrainingCalendar.onDate(routines, date), [], `${date} до старта не должна планироваться`);
    assert.equal(TrainingCalendar.activeOn(routines[0], date), false);
  }
  // В неделю старта (с Пн 23 нояб.) тренировки появляются по своим дням
  assert.equal(TrainingCalendar.onDate(routines, "2026-11-23").length, 1);
  assert.equal(TrainingCalendar.onDate(routines, "2026-11-23")[0].routine.periodization?.day, "legs1");
  assert.equal(TrainingCalendar.onDate(routines, "2026-11-28")[0].routine.periodization?.day, "pull2");
  assert.deepEqual(TrainingCalendar.onDate(routines, "2026-11-29"), []);

  // next() до старта указывает на понедельник старта, а не на день на текущей неделе
  assert.equal(TrainingCalendar.next(routines, "2026-11-18")?.date, "2026-11-23");
  assert.equal(TrainingCalendar.next(routines, "2026-11-22")?.date, "2026-11-23");
  assert.equal(TrainingCalendar.next(routines, "2026-11-23")?.date, "2026-11-24");

  // Нельзя создать разовый перенос для даты до startMonday
  assert.throws(
    () => TrainingCalendar.withOverride(routines[0], "2026-11-16", "2026-11-18", []),
    /нет в плане/,
  );

  // Обычные программы без периодизации на неделе до старта работают как раньше
  const plain: Routine = { ...TrainingProgram.empty(), name: "Обычная", days: [0, 3] };
  assert.equal(TrainingCalendar.onDate([...routines, plain], "2026-11-16").length, 1);
  assert.equal(TrainingCalendar.onDate([...routines, plain], "2026-11-16")[0].routine.id, plain.id);
});

test("custom weekly layout (Пн Жим 1, Вт Тяга 1, Ср Отдых, Чт Жим 2, Пт Тяга 2, Сб Ноги 1, Вс Ноги 2) works across calendar, sorting, and wave plans", () => {
  const customSlots = ["push1", "pull1", null, "push2", "pull2", "legs1", "legs2"] as const;
  const weekdays = LaidDupPlan.weekdaysFromSlots(customSlots);
  assert.deepEqual(weekdays, { push1: 0, pull1: 1, push2: 3, pull2: 4, legs1: 5, legs2: 6 });
  assert.equal(LaidDupPlan.matchingRhythm(customSlots), "custom");
  assert.equal(LaidDupPlan.restWeekday(customSlots), 2);

  const cycle = laidCycle(START_MON, weekdays);
  const ordered = LaidDupPlan.ordered(cycle);
  assert.deepEqual(
    ordered.map((r) => r.periodization!.day),
    ["push1", "pull1", "push2", "pull2", "legs1", "legs2"],
  );
  assert.deepEqual(LaidDupPlan.slotsFromCycle(ordered), [...customSlots]);

  // До старта (включая Вс 22 нояб., хотя Ноги 2 стоят на Вс!) — пусто
  assert.deepEqual(TrainingCalendar.onDate(cycle, "2026-11-22"), []);
  assert.equal(TrainingCalendar.next(cycle, "2026-11-22")?.routine.periodization?.day, "push1");
  assert.equal(TrainingCalendar.next(cycle, "2026-11-22")?.date, "2026-11-23");

  // Неделя 1: Пн Жим 1, Вт Тяга 1, Ср свободно, Чт Жим 2, Пт Тяга 2, Сб Ноги 1, Вс Ноги 2
  const weekDays = ["2026-11-23", "2026-11-24", "2026-11-25", "2026-11-26", "2026-11-27", "2026-11-28", "2026-11-29"];
  assert.deepEqual(
    weekDays.map((d) => TrainingCalendar.onDate(cycle, d)[0]?.routine.periodization?.day ?? null),
    [...customSlots],
  );

  // Веса волн DUP не ломаются при переносе на другие дни недели: Ноги 1 в Сб 28 нояб. — неделя 1 (85×5 / 4×12×65), Ноги 2 в Вс 29 нояб. — неделя 1 (90×3 / 4×8×75)
  const legs1 = cycle.find((r) => r.periodization!.day === "legs1")!;
  const legs2 = cycle.find((r) => r.periodization!.day === "legs2")!;
  const wLegs1 = new TrainingProgram(legs1).start([], "UTC", "2026-11-28", "2026-11-28");
  const wLegs2 = new TrainingProgram(legs2).start([], "UTC", "2026-11-29", "2026-11-29");
  assert.deepEqual(wLegs1.exercises[0].sets.map((s) => `${s.weight}×${s.reps}`), ["85×5", "65×12", "65×12", "65×12", "65×12"]);
  assert.deepEqual(wLegs2.exercises[0].sets.map((s) => `${s.weight}×${s.reps}`), ["90×3", "75×8", "75×8", "75×8", "75×8"]);

  // Статус в среду 25 нояб.: Жим 1 (Пн) и Тяга 1 (Вт) без записи — пропущены; Ноги 1 (Сб) и Ноги 2 (Вс) — впереди
  const push1 = cycle.find((r) => r.periodization!.day === "push1")!;
  assert.equal(LaidDupPlan.status(push1, [], 0, "2026-11-25").state, "missed");
  assert.equal(LaidDupPlan.status(legs1, [], 0, "2026-11-25").state, "ahead");
  assert.equal(LaidDupPlan.status(legs2, [], 0, "2026-11-25").state, "ahead");

  // Ненавязчивая подсказка о двух днях ног подряд
  const notes = LaidDupPlan.backToBackNotice(customSlots, DAY_NAMES);
  assert.equal(notes.length, 1);
  assert.match(notes[0], /Ноги 1 и Ноги 2.*Сб–Вс/);
});

test("withWeekdays updates only changed routines, cleans stale future overrides, and preserves completed/past history", () => {
  const base = laidCycle("2026-11-09");
  const legs1 = base.find((r) => r.periodization!.day === "legs1")!;
  // У Ноги 1 есть выполненный перенос в неделе 1 (Пн 9 -> Вт 10) и будущий невыполненный перенос в неделе 3 (Пн 23 -> Ср 25)
  const withOverrides: Routine = {
    ...legs1,
    occurrenceOverrides: [
      { from: "2026-11-09", to: "2026-11-10" },
      { from: "2026-11-23", to: "2026-11-25" },
    ],
  };
  const cycle = base.map((r) => (r.id === legs1.id ? withOverrides : r));
  const completed = doneWorkout(legs1, "2026-11-10", "2026-11-09");

  // Меняем только Ноги 1 (Пн -> Сб) и Тягу 2 (Сб -> Пн); остальные 4 дня на своих местах
  const nextWeekdays = { ...LaidDupPlan.WEEKDAY, legs1: 5, pull2: 0 };
  const changed = LaidDupPlan.withWeekdays(cycle, nextWeekdays, [completed], "2026-11-18");
  assert.deepEqual(changed.map((r) => r.periodization!.day), ["pull2", "legs1"]);

  const updatedLegs1 = changed.find((r) => r.periodization!.day === "legs1")!;
  assert.deepEqual(updatedLegs1.days, [5]);
  // Выполненный перенос 2026-11-09 сохранился, а будущий невыполненный 2026-11-23 удалён (иначе был бы дубль в неделе 3)
  assert.deepEqual(updatedLegs1.occurrenceOverrides, [{ from: "2026-11-09", to: "2026-11-10" }]);
  assert.deepEqual(TrainingCalendar.onDate([updatedLegs1], "2026-11-25"), []);
  assert.equal(TrainingCalendar.onDate([updatedLegs1], "2026-11-28").length, 1);

  // Выполненный перенос в неделе 1 по-прежнему засчитывается как «Сделана»
  assert.deepEqual(LaidDupPlan.status(updatedLegs1, [completed], 0, "2026-11-18"), { state: "done", date: "2026-11-10" });
});

test("moveSlot and status with occurrenceOverrides behave deterministically", () => {
  const start = LaidDupPlan.slotsForRhythm("6x1");
  // Перенос Ноги 1 (0) в конец (6), Ноги 2 (2) в (5), Отдых (4) в (2)
  const s1 = LaidDupPlan.moveSlot(start, 0, 6);
  const s2 = LaidDupPlan.moveSlot(s1, 2, 5);
  const s3 = LaidDupPlan.moveSlot(s2, 4, 2);
  const s4 = LaidDupPlan.swapSlots(s3, 5, 6);
  assert.deepEqual(s4, ["push1", "pull1", null, "push2", "pull2", "legs1", "legs2"]);

  // Разовый перенос Ноги 1 с Пн 9 нояб. на Пт 13 нояб.: в среду 11 нояб. не считается пропущенной
  const legs1 = laidCycle("2026-11-09").find((r) => r.periodization!.day === "legs1")!;
  const moved = TrainingCalendar.withOverride(legs1, "2026-11-09", "2026-11-13", []);
  assert.equal(LaidDupPlan.status(moved, [], 0, "2026-11-11").state, "ahead");
  assert.equal(LaidDupPlan.status(moved, [], 0, "2026-11-14").state, "missed");

  // Запись перенесённой через понедельник тренировки засчитывается в исходную неделю 1
  const doneNextMon = doneWorkout(legs1, "2026-11-16", "2026-11-09");
  assert.deepEqual(LaidDupPlan.status(legs1, [doneNextMon], 0, "2026-11-16"), { state: "done", date: "2026-11-16" });
  assert.equal(LaidDupPlan.status(legs1, [doneNextMon], 1, "2026-11-16").state, "ahead");
});
