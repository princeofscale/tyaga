import test from "node:test";
import assert from "node:assert/strict";
import { ExerciseSearchRank } from "../src/domain/ExerciseSearchRank";
import { StrengthExercises } from "../src/domain/StrengthExercises";
import { WorkoutSession } from "../src/domain/WorkoutSession";
import {
  TrainingProgram,
  nextScheduled,
  weightSourceSummary,
} from "../src/domain/TrainingProgram";
import { exerciseCatalog, makeSets, makeWorkout } from "../src/lib/model";
import type { Routine, Workout } from "../src/lib/types";

const done = (w: Workout, weight = 60) => {
  for (const e of w.exercises)
    e.sets.forEach((s) => {
      s.done = true;
      s.weight = weight;
    });
  return w;
};
const routine = (patch: Partial<Routine>): Routine => ({
  id: crypto.randomUUID(),
  name: "Программа",
  notes: "",
  days: [],
  exercises: [],
  restSeconds: 90,
  progression: "repeat",
  repMin: 8,
  repMax: 12,
  incrementKg: 2.5,
  revision: 1,
  ...patch,
});

test("R02-REQ09: новый подход наследует RIR прошлого, а пустой RIR остаётся пустым", () => {
  assert.equal(makeSets(1, 60, 8, 1)[0].rir, 1);
  assert.equal(makeSets(1, 60, 8, null)[0].rir, null);
  assert.equal(makeSets(2)[1].rir, 2, "значение по умолчанию прежнее");
});

test("R02-REQ10: «Следующая» — ближайший день программы после сегодняшнего", () => {
  // 2026-11-14 — суббота; дни программы нумеруются с 0 = понедельник.
  const push = routine({ name: "Верх тела", days: [0, 3] });
  const legs = routine({ name: "Низ тела", days: [1, 4] });
  const next = nextScheduled([legs, push], "2026-11-14");
  assert.equal(next?.routine.name, "Верх тела");
  assert.equal(next?.date, "2026-11-16");
  assert.equal(next?.dayName, "Пн");
  assert.equal(nextScheduled([routine({ days: [] })], "2026-11-14"), null, "без расписания следующего дня нет");
  assert.equal(nextScheduled([], "2026-11-14"), null);
});

test("R02-REQ05: упражнения без выполненных подходов не сохраняются", () => {
  const w = makeWorkout(["bench", "squat", "rdl"], [], "UTC");
  w.exercises[0].sets[0].done = true;
  const { workout, removed } = new WorkoutSession(w).withoutUnperformed();
  assert.equal(removed, 2);
  assert.deepEqual(workout.exercises.map((e) => e.exerciseId), ["bench"]);
  const untouched = makeWorkout(["bench"], [], "UTC");
  untouched.exercises[0].sets[0].done = true;
  const same = new WorkoutSession(untouched).withoutUnperformed();
  assert.equal(same.removed, 0);
  assert.equal(same.workout, untouched, "без лишнего копирования, если убирать нечего");
});

test("R02-REQ06: «Сила» — только упражнения с выполненными рабочими подходами, свежие первыми", () => {
  const a = done(makeWorkout(["bench"], [], "UTC"));
  a.date = "2026-10-01";
  const b = done(makeWorkout(["squat"], [], "UTC"));
  b.date = "2026-10-08";
  const skipped = makeWorkout(["rdl"], [], "UTC");
  skipped.date = "2026-10-09";
  const warmupOnly = makeWorkout(["ohp"], [], "UTC");
  warmupOnly.exercises[0].sets[0].warmup = true;
  warmupOnly.exercises[0].sets[0].done = true;
  const rows = StrengthExercises.list([a, b, skipped, warmupOnly]);
  assert.deepEqual(rows.map((r) => r.we.exerciseId), ["squat", "bench"]);
  assert.equal(rows[0].lastDate, "2026-10-08");
  assert.deepEqual(StrengthExercises.list([]), []);
});

test("R02-REQ08: поиск идёт по близости, а не по алфавиту", () => {
  const names = ["Жим в положении лёжа на спине", "Жим штанги лёжа", "Жим лёжа", "L-уголок"];
  const sorted = ExerciseSearchRank.sort(names, "жим лёжа", (n) => n);
  assert.equal(sorted[0], "Жим лёжа");
  assert.equal(sorted.at(-1), "L-уголок");
  assert.ok(sorted.indexOf("Жим штанги лёжа") < sorted.indexOf("Жим в положении лёжа на спине"));
  // Пустой запрос не меняет порядок.
  assert.deepEqual(ExerciseSearchRank.sort(names, "", (n) => n), names);
  const found = exerciseCatalog.search({ text: "жим лёжа" }).map((e) => e.id);
  assert.equal(found[0], "bench", "в каталоге первым идёт жим штанги лёжа");
});

test("N-2: «присед» ставит «Приседания со штангой» выше «Обратного V-приседа»", () => {
  const sorted = ExerciseSearchRank.sort(["Обратный V-присед", "Приседания со штангой", "Выпады"], "присед", (n) => n);
  assert.deepEqual(sorted.slice(0, 2), ["Приседания со штангой", "Обратный V-присед"]);
  assert.equal(exerciseCatalog.search({ text: "присед" })[0]?.name, "Приседания со штангой");
});

test("R02-REQ07: подписи источника цифр — из истории или по плану", () => {
  const plan = routine({
    name: "Верх тела",
    exercises: makeWorkout(["bench", "squat"], [], "UTC").exercises,
  });
  const history = [done(makeWorkout(["bench"], [], "UTC"), 77.5)];
  history[0].date = "2026-10-01";
  const sources = new TrainingProgram(plan).weightSources(history, "UTC", "2026-11-14");
  assert.deepEqual(sources, ["history", "plan"]);
  assert.equal(weightSourceSummary(sources), "веса: 1 из истории, 1 по плану");
  assert.equal(weightSourceSummary(["history", "history"]), "веса из истории");
  assert.equal(weightSourceSummary(["plan"]), "веса по плану");
  assert.equal(weightSourceSummary([]), "");
});

test("R02-REQ01: программа подставляет вес из импортированной истории тем же упражнением", () => {
  const imported = makeWorkout(["bench"], [], "UTC");
  imported.id = "import:owner:abc";
  imported.date = "2026-10-05";
  imported.exercises[0].sets = [8, 8, 7].map((reps) => ({
    id: crypto.randomUUID(), weight: 77.5, reps, rir: 2, warmup: false, done: true,
  }));
  const plan = routine({ name: "Верх тела", exercises: makeWorkout(["bench"], [], "UTC").exercises });
  const started = new TrainingProgram(plan).start([imported], "UTC", "2026-11-14");
  assert.equal(started.exercises[0].sets[0].weight, 77.5);
  assert.equal(new TrainingProgram(plan).weightSources([imported], "UTC", "2026-11-14")[0], "history");
});
