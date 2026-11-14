import test from "node:test";
import assert from "node:assert/strict";
import { SetPropagation } from "../src/domain/SetPropagation";
import { WorkoutDiscard } from "../src/domain/WorkoutDiscard";
import { trimLeadingZeros } from "../src/lib/numberField";
import { quantityWord } from "../src/lib/quantity";
import { newDraft } from "../src/lib/draft";
import { exerciseCatalog, makeWorkout, recordingLabel, recordingNote, recordingSentence } from "../src/lib/model";
import type { SetEntry } from "../src/lib/types";

const set = (patch: Partial<SetEntry> = {}): SetEntry => ({
  id: crypto.randomUUID(),
  weight: 0,
  reps: 10,
  rir: 2,
  warmup: false,
  done: false,
  ...patch,
});

test("R01-REQ04: правка первой строки переносится на нетронутые строки ниже", () => {
  const sets = [set(), set(), set()];
  const next = SetPropagation.apply(sets, 0, { weight: 100 });
  assert.deepEqual(next.map((s) => s.weight), [100, 100, 100]);
  const reps = SetPropagation.apply(next, 0, { reps: 8, rir: 1 });
  assert.deepEqual(reps.map((s) => [s.reps, s.rir]), [[8, 1], [8, 1], [8, 1]]);
});

test("R01-REQ04: строка, поправленная вручную, и строки выше не меняются", () => {
  let sets = SetPropagation.apply([set(), set(), set()], 0, { weight: 100 });
  sets = SetPropagation.apply(sets, 1, { weight: 105 });
  assert.deepEqual(sets.map((s) => s.weight), [100, 105, 105]);
  sets = SetPropagation.apply(sets, 0, { weight: 102 });
  assert.deepEqual(sets.map((s) => s.weight), [102, 105, 105], "поправленная вручную строка 2 не перезаписана");
  const above = SetPropagation.apply([set({ weight: 50 }), set(), set()], 2, { weight: 60 });
  assert.deepEqual(above.map((s) => s.weight), [50, 0, 60], "строки выше правимой не затрагиваются");
});

test("R01-REQ04: выполненные, разминочные подходы и другой тип не следуют за правкой", () => {
  const sets = [set(), set({ done: true }), set({ warmup: true, kind: "warmup" }), set({ kind: "dropset" }), set()];
  const next = SetPropagation.apply(sets, 0, { weight: 80 });
  assert.deepEqual(next.map((s) => s.weight), [80, 0, 0, 0, 80]);
});

test("R01-REQ04: правка выполненного подхода никого не трогает, отметка «готово» не протягивается", () => {
  const done = SetPropagation.apply([set({ done: true, weight: 100 }), set({ weight: 100 })], 0, { weight: 90 });
  assert.deepEqual(done.map((s) => s.weight), [90, 100]);
  const mark = SetPropagation.apply([set({ weight: 100 }), set({ weight: 100 })], 0, { done: true });
  assert.deepEqual(mark.map((s) => s.done), [true, false]);
});

test("R01-REQ04: помощь и длительность тоже протягиваются; поле, равное старому значению, следует отдельно", () => {
  const assisted = SetPropagation.apply([set({ assistanceKg: 0 }), set({ assistanceKg: 0 })], 0, { assistanceKg: 20, weight: 0 });
  assert.deepEqual(assisted.map((s) => s.assistanceKg), [20, 20]);
  const mixed = SetPropagation.apply([set({ weight: 60, reps: 10 }), set({ weight: 60, reps: 12 })], 0, { weight: 70, reps: 8 });
  assert.deepEqual(mixed.map((s) => [s.weight, s.reps]), [[70, 8], [70, 12]], "повторы второй строки были другими и остались");
});

test("R01-REQ04: ведущие нули после правки посреди числа убираются, десятичные не трогаются", () => {
  const input = (value: string) => ({ value }) as HTMLInputElement;
  assert.equal(trimLeadingZeros(input("0100")), "100");
  assert.equal(trimLeadingZeros(input("007")), "7");
  assert.equal(trimLeadingZeros(input("0.5")), "0.5");
  assert.equal(trimLeadingZeros(input("0")), "0");
  assert.equal(trimLeadingZeros(input("")), "");
  assert.equal(trimLeadingZeros(input("102.5")), "102.5");
});

test("R01-REQ01: вопрос при отмене нужен только когда есть выполненный подход или правится сохранённая тренировка", () => {
  const empty = newDraft(makeWorkout([], [], "UTC"));
  assert.equal(WorkoutDiscard.needsConfirmation(empty), false);
  const planned = newDraft(makeWorkout(["bench"], [], "UTC"));
  assert.equal(WorkoutDiscard.needsConfirmation(planned), false, "упражнения без отметок терять нечего");
  planned.workout.exercises[0].sets[0].done = true;
  assert.equal(WorkoutDiscard.hasRecordedSets(planned), true);
  assert.equal(WorkoutDiscard.needsConfirmation(planned), true);
  const editing = newDraft(makeWorkout(["bench"], [], "UTC"), true);
  assert.equal(WorkoutDiscard.needsConfirmation(editing), true, "правка сохранённой записи всегда спрашивает");
  const warmup = newDraft(makeWorkout(["bench"], [], "UTC"));
  Object.assign(warmup.workout.exercises[0].sets[0], { warmup: true, done: true });
  assert.equal(WorkoutDiscard.needsConfirmation(warmup), true, "выполненная разминка тоже запись");
});

test("R01-REQ05: «подход» склоняется правильно, чтобы подписи недели не ломались на 11–14 и 21", () => {
  const word = (n: number) => quantityWord(n, "подход", "подхода", "подходов");
  assert.deepEqual([0, 1, 2, 4, 5, 11, 12, 14, 21, 22, 25].map(word), [
    "подходов", "подход", "подхода", "подхода", "подходов", "подходов", "подходов", "подходов", "подход", "подхода", "подходов",
  ]);
});

test("R01-REQ09: число на вкладке «Основные» — весь список без фильтров, а не константа", () => {
  const all = exerciseCatalog.search({});
  assert.equal(all.length, exerciseCatalog.curatedExercises().length);
  assert.notEqual(all.length, 31, "число в интерфейсе раньше было вшитым 31");
});

test("R01-REQ07/10: штанга подписывается обычным «кг», особые правила — по-прежнему словами", () => {
  const bench = makeWorkout(["bench"], [], "UTC").exercises[0];
  assert.equal(recordingLabel(bench), "кг");
  assert.equal(recordingNote(bench), "");
  assert.equal(recordingSentence(bench), "Записывается общий вес на штанге в килограммах: гриф и блины.");
  assert.ok(!recordingSentence(bench).includes("кг общего веса"));
  // Каждое правило записи в каталоге даёт законченную фразу (с точкой в конце), без обрывков вроде «кг общего веса.».
  const byMode = new Map<string, string>();
  for (const e of exerciseCatalog.curatedExercises()) byMode.set(e.recording.loadMode, e.id);
  assert.ok(byMode.size >= 4, "в каталоге есть разные правила записи");
  for (const [mode, id] of byMode) {
    const sentence = recordingSentence(makeWorkout([id], [], "UTC").exercises[0]);
    assert.match(sentence, /^[А-ЯЁ].*[.]$/, `${mode}: законченная фраза`);
  }
});

/** Набор числа по цифрам: снимок последователей берётся один раз — на фокус поля. */
const typeDigits = (sets: SetEntry[], index: number, field: "weight" | "reps" | "rir", steps: (number | null)[]) => {
  const snapshot = SetPropagation.followers(sets, index);
  return steps.reduce((acc, value) => SetPropagation.apply(acc, index, { [field]: value }, snapshot), sets);
};

test("R01 D3: промежуточные цифры при наборе не затирают строку, поправленную вручную", () => {
  const reps = [set({ reps: 10 }), set({ reps: 10 }), set({ reps: 1 })];
  assert.deepEqual(typeDigits(reps, 0, "reps", [1, 12]).map((s) => s.reps), [12, 12, 1], "повторы: «1», затем «12»");
  const weight = [set({ weight: 100 }), set({ weight: 100 }), set({ weight: 10 })];
  assert.deepEqual(typeDigits(weight, 0, "weight", [1, 10, 105]).map((s) => s.weight), [105, 105, 10], "вес: «1», «10», «105»");
});

test("R01 D3: стёртый вручную RIR не перетирается набором RIR в первой строке через «пусто»", () => {
  const sets = [set({ rir: 2 }), set({ rir: 2 }), set({ rir: null })];
  assert.deepEqual(typeDigits(sets, 0, "rir", [null, 3]).map((s) => s.rir), [3, 3, null]);
});

test("R01 D2: кнопки — шаг веса, RIR, «прошлый результат» — идут по тому же правилу, что и набор", () => {
  let sets = [set({ weight: 100 }), set({ weight: 100 }), set({ weight: 90 })];
  sets = SetPropagation.apply(sets, 0, { weight: 102.5 });
  assert.deepEqual(sets.map((s) => s.weight), [102.5, 102.5, 90], "строка с другим весом остаётся");
  sets = SetPropagation.apply(sets, 0, { weight: 105 });
  assert.deepEqual(sets.map((s) => s.weight), [105, 105, 90], "второе нажатие снова ведёт нетронутую строку");
  const rir = SetPropagation.apply([set({ rir: null }), set({ rir: null }), set({ rir: 1 })], 0, { rir: 2 });
  assert.deepEqual(rir.map((s) => s.rir), [2, 2, 1]);
  const past = SetPropagation.apply([set({ weight: 60, reps: 10 }), set({ weight: 60, reps: 12 })], 0, { weight: 62.5, reps: 8 });
  assert.deepEqual(past.map((s) => [s.weight, s.reps]), [[62.5, 8], [62.5, 12]]);
});

test("R01 D2/D3: снимок чужой строки игнорируется, выполненные подходы не следуют", () => {
  const sets = [set({ weight: 100 }), set({ weight: 100, done: true }), set({ weight: 100 })];
  const foreign = SetPropagation.followers(sets, 2);
  const next = SetPropagation.apply(sets, 0, { weight: 110 }, foreign);
  assert.deepEqual(next.map((s) => s.weight), [110, 100, 110]);
});

import { zoneCreditNote } from "../src/lib/zoneCredit";

test("R01 D6: пояснение «число больше» не показывается при нуле и когда оно неверно", () => {
  assert.equal(zoneCreditNote(0, 0), "");
  assert.match(zoneCreditNote(14, 7), /Поэтому число больше, чем подходов в записи/);
  const same = zoneCreditNote(4, 4);
  assert.match(same, /Один подход засчитывается каждой зоне/);
  assert.doesNotMatch(same, /Поэтому число больше/);
});
