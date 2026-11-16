import test from "node:test";
import assert from "node:assert/strict";
import { EXERCISES } from "../src/lib/catalog";
import { ExerciseSwap } from "../src/domain/ExerciseSwap";
import { ExerciseLabels } from "../src/domain/ExerciseLabels";
import type { Exercise, SetEntry, WorkoutExercise } from "../src/lib/types";

const ex = (id: string) => EXERCISES.find((e) => e.id === id) as Exercise;
const set = (weight: number, reps: number, done = false, warmup = false, id = `${weight}-${reps}-${done}-${warmup}`): SetEntry => ({ id, weight, reps, rir: 2, warmup, done });

test("R08-REQ01: другое правило веса — числа и ✓ старого не переносятся, берётся «Прошлое» нового, иначе пусто", () => {
  const squat = [set(95, 11, true, false, "a"), set(95, 11, false, false, "b"), set(95, 11, false, false, "c")];
  const goblet = ex("goblet"); // штанга общий вес → гантель одной рукой
  // нет истории у нового → пусто, без ✓
  const blank = ExerciseSwap.sets(squat, ex("squat").recording.loadMode, ex("squat").recording.type, goblet, []);
  assert.equal(blank.carried, false);
  assert.deepEqual(blank.sets.map((s) => [s.weight, s.reps, s.done]), [[0, 0, false], [0, 0, false], [0, 0, false]]);
  assert.deepEqual(blank.sets.map((s) => s.id), ["a", "b", "c"]);
  // есть «Прошлое»: 10 × 9, 10 × 9, 10 × 8 — подход N берёт подход N
  const past = [set(10, 9, true), set(10, 9, true), set(10, 8, true)];
  const filled = ExerciseSwap.sets(squat, "total_external", undefined, goblet, past);
  assert.deepEqual(filled.sets.map((s) => [s.weight, s.reps, s.done]), [[10, 9, false], [10, 9, false], [10, 8, false]]);
  // в прошлом меньше подходов — берётся последний
  const short = ExerciseSwap.sets(squat, "total_external", undefined, goblet, [set(12, 8, true)]);
  assert.deepEqual(short.sets.map((s) => s.weight), [12, 12, 12]);
});

test("R08-REQ01: жим штанги → отжимания: «Доп. кг» не 80 / 82,5", () => {
  const bench = [set(80, 5, true), set(82.5, 11, false), set(82.5, 7, false)];
  const result = ExerciseSwap.sets(bench, "total_external", undefined, ex("pushup"), []);
  assert.equal(result.carried, false);
  assert.deepEqual(result.sets.map((s) => s.weight), [0, 0, 0]);
  assert.ok(result.sets.every((s) => !s.done));
  // с историей отжиманий — значения оттуда («Доп. кг» 0 / 2,5)
  const past = [set(0, 15, true), set(2.5, 12, true)];
  const withPast = ExerciseSwap.sets(bench, "total_external", undefined, ex("pushup"), past);
  assert.deepEqual(withPast.sets.map((s) => s.weight), [0, 2.5, 2.5]);
});

test("R08-REQ01: то же правило веса (штанга → штанга) — подходы остаются как есть, с ✓ и без", () => {
  const bench = [set(80, 5, true), set(82.5, 11, false)];
  const same = ExerciseSwap.sets(bench, "total_external", undefined, ex("incline-bar"), [set(60, 8, true)]);
  assert.equal(same.carried, true);
  assert.equal(same.sets, bench);
  assert.deepEqual(same.sets.map((s) => s.done), [true, false]);
});

test("R08-REQ01: разминка старого упражнения при другом правиле веса не переносится; без рабочих подходов — три пустых", () => {
  const mixed = [set(40, 8, true, true, "w"), set(95, 11, true, false, "a")];
  const result = ExerciseSwap.sets(mixed, "total_external", undefined, ex("goblet"), []);
  assert.deepEqual(result.sets.map((s) => [s.id, s.warmup, s.weight, s.done]), [["a", false, 0, false]]);
  const onlyWarm = ExerciseSwap.sets([set(40, 8, true, true)], "total_external", undefined, ex("goblet"), []);
  assert.equal(onlyWarm.sets.length, 3);
  assert.ok(onlyWarm.sets.every((s) => !s.warmup && !s.done && s.weight === 0));
});

test("R08-REQ01: привязка к станции и профиль исполнения при другом правиле веса не переносятся", () => {
  const entry = { exerciseId: "squat", sets: [], machineInstanceId: "m1", progressionNote: "x", equipmentNote: "n" } as unknown as WorkoutExercise;
  const cleared = ExerciseSwap.entry(entry, false);
  assert.equal(cleared.machineInstanceId, undefined);
  assert.equal(cleared.progressionNote, undefined);
  assert.equal(cleared.equipmentNote, undefined);
  assert.equal(ExerciseSwap.entry(entry, true), entry);
});

test("R08-REQ02: подписи снаряда и мышц — по-русски, без идентификаторов", () => {
  assert.equal(ExerciseLabels.meta(ex("squat")), "Штанга · Квадрицепс, Ягодицы");
  assert.equal(ExerciseLabels.meta(ex("goblet")), "Гантели · Квадрицепс, Ягодицы");
  assert.equal(ExerciseLabels.meta(ex("pushup")), "Свой вес · Грудь, Трицепс");
  assert.equal(ExerciseLabels.meta(ex("bench")), "Штанга · Грудь, Трицепс");
  assert.equal(ExerciseLabels.muscles(["shoulders", "hamstrings"]), "Плечи, Задняя часть бедра");
  // на всём каталоге ни одной подписи с латинскими словами-идентификаторами
  const raw = /\b(gym|dumbbells|bodyweight|quads|glutes|chest|triceps|shoulders|biceps|back|core|calves|hamstrings)\b/;
  for (const e of EXERCISES as Exercise[]) assert.doesNotMatch(ExerciseLabels.meta(e), raw, e.id);
  // gym без однозначного снаряда — одно и то же слово
  const unsure = { ...ex("squat"), name: "Приседания", id: "x-unknown" } as Exercise;
  assert.equal(ExerciseLabels.equipment(unsure), "Штанга / тренажёр");
});
