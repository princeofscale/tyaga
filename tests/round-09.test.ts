import test from "node:test";
import assert from "node:assert/strict";
import { makeWorkout, entryName } from "../src/lib/model";
import { LiveBroadcastPolicy, LivePresenter, LivePushPolicy, LiveStateBuilder } from "../src/domain/LiveSession";
import type { Workout } from "../src/lib/types";

const done = (id: string, date: string, kg: number[]): Workout => {
  const w = makeWorkout(["bench"]);
  w.id = id;
  w.date = date;
  w.exercises[0].sets = kg.map((weight, i) => ({ id: `${id}-${i}`, weight, reps: 5, rir: 2, warmup: false, done: true }));
  return w;
};
const draftOf = (workout: Workout, editing: boolean) => ({ workout, editing, restUntil: null, pausedRest: null });
const NOW = Date.UTC(2026, 10, 16, 8);

test("R09-REQ01: правка сохранённой тренировки ничего не шлёт в комнату — ни «Готовится», ни 0 т", () => {
  const saved = done("a", "2026-11-16", [80, 82.5, 82.5]);
  assert.equal(LiveBroadcastPolicy.stateFor(draftOf(saved, true), NOW, entryName), null);
  // даже если в правке сняли все отметки: это всё равно правка, а не начало тренировки
  const cleared = structuredClone(saved);
  cleared.exercises[0].sets.forEach((s) => (s.done = false));
  assert.equal(LiveBroadcastPolicy.stateFor(draftOf(cleared, true), NOW, entryName), null);
  assert.equal(LiveBroadcastPolicy.stateFor(null, NOW, entryName), null);
});

test("R09-REQ01: новая тренировка в комнате по-прежнему начинается с «Готовится», дальше идёт «lifting»", () => {
  const fresh = done("n", "2026-11-16", [80, 82.5, 82.5]);
  fresh.exercises[0].sets.forEach((s) => (s.done = false));
  const start = LiveBroadcastPolicy.stateFor(draftOf(fresh, false), NOW, entryName)!;
  assert.equal(start.phase, "idle");
  assert.equal(start.tonnageKg, 0);
  assert.equal(LivePresenter.headline({ state: start, updatedAt: new Date(NOW).toISOString() }, NOW), "Готовится · Жим штанги лёжа");
  fresh.exercises[0].sets[0].done = true;
  assert.equal(LiveBroadcastPolicy.stateFor(draftOf(fresh, false), NOW, entryName)!.phase, "lifting");
  // отдых на паузе виден напарнику как обычный подход
  const paused = LiveBroadcastPolicy.stateFor({ ...draftOf(fresh, false), restUntil: NOW + 60_000, pausedRest: 30_000 }, NOW, entryName)!;
  assert.equal(paused.restEndsAt, null);
});

test("R09-REQ01: после «Сохранить» правки итог пересчитывается: было 1 885 кг, стало 1 935 кг, «Закончил · 1,9 т»", () => {
  const before = done("a", "2026-11-16", [80, 82.5, 82.5]);
  before.exercises[0].sets[0].reps = 5;
  before.exercises[0].sets[1].reps = 11;
  before.exercises[0].sets[2].reps = 7;
  const mine = { state: LiveStateBuilder.fromWorkout(before, { now: NOW, nameOf: entryName, finished: true }) };
  assert.equal(mine.state.tonnageKg, 1885);
  assert.equal(LivePresenter.headline({ state: mine.state, updatedAt: new Date(NOW).toISOString() }, NOW), "Закончил · 1,9 т");
  const edited = structuredClone(before);
  edited.exercises[0].sets[0].weight = 90;
  const next = LiveBroadcastPolicy.afterEdit(mine, edited, [edited, done("old", "2026-11-09", [60])], NOW, entryName)!;
  assert.equal(next.phase, "done");
  assert.equal(next.tonnageKg, 1935);
  assert.equal(LivePresenter.headline({ state: next, updatedAt: new Date(NOW).toISOString() }, NOW), "Закончил · 1,9 т");
});

test("R09-REQ01: итог комнаты не трогаем, если строки «Закончил» нет или правится не самая свежая тренировка", () => {
  const latest = done("a", "2026-11-16", [80]);
  const older = done("b", "2026-11-09", [60]);
  const finished = { state: LiveStateBuilder.fromWorkout(latest, { now: NOW, nameOf: entryName, finished: true }) };
  // правка старой тренировки: итог комнаты относится к более свежей
  assert.equal(LiveBroadcastPolicy.afterEdit(finished, older, [latest, older], NOW, entryName), null);
  // у человека нет «Закончил» (ещё не начинал или тренируется): правка комнату не меняет
  assert.equal(LiveBroadcastPolicy.afterEdit({ state: null }, latest, [latest], NOW, entryName), null);
  assert.equal(LiveBroadcastPolicy.afterEdit(undefined, latest, [latest], NOW, entryName), null);
  const lifting = { state: { ...finished.state!, phase: "lifting" as const } };
  assert.equal(LiveBroadcastPolicy.afterEdit(lifting, latest, [latest], NOW, entryName), null);
});

test("R09-REQ01: повтор неизменившегося итога — раз в heartbeat, значит правка не плодит лишних отправок", () => {
  const w = done("a", "2026-11-16", [80, 82.5]);
  const s = LiveStateBuilder.fromWorkout(w, { now: NOW, nameOf: entryName, finished: true });
  assert.equal(LivePushPolicy.due(LivePushPolicy.mark(s, NOW), s, NOW + 1000), false);
});

// ───────────── REQ02: чипы снаряда в «Заменить» ─────────────
import { EXERCISES } from "../src/lib/catalog";
import { ExerciseAlternativesFinder } from "../src/domain/ExerciseAlternatives";
import { ExerciseLabels } from "../src/domain/ExerciseLabels";
import { matchesSearch } from "../src/lib/search";
import type { Exercise } from "../src/lib/types";

const CHIPS = ["dumbbell", "barbell", "cable", "machine", "bodyweight"] as const;
const WORD = { dumbbell: "Гантели", barbell: "Штанга", cable: "Блок / Кроссовер", machine: "Тренажёр", bodyweight: "Свой вес" } as const;
const bench = EXERCISES.find((e) => e.id === "bench") as Exercise;

test("R09-REQ02: чип снаряда оставляет ровно строки с этой меткой; «Гантели» и «Штанга» для жима лёжа не пусты", () => {
  const all = ExerciseAlternativesFinder.findAlternatives(bench, EXERCISES, 10).map((a) => a.exercise);
  assert.equal(all.length, 10);
  const by = (chip: (typeof CHIPS)[number]) => all.filter((e) => ExerciseLabels.matches(e, chip));
  assert.ok(by("dumbbell").length >= 2, "«Гантели»");
  assert.ok(by("dumbbell").every((e) => ExerciseLabels.equipment(e) === "Гантели"));
  assert.ok(by("dumbbell").some((e) => e.name === "Жим гантелей на наклонной 30°"));
  assert.ok(by("barbell").some((e) => e.name === "Жим штанги на наклонной скамье 30°"));
  assert.ok(by("bodyweight").some((e) => e.name === "Отжимания от пола"));
  for (const chip of CHIPS) {
    // в чипе только строки, у которых в подписи стоит слово чипа (у «Штанга / тренажёр» — любое из двух)
    for (const e of by(chip)) assert.ok(ExerciseLabels.equipment(e).includes(WORD[chip]) || ExerciseLabels.equipment(e) === "Штанга / тренажёр", `${e.name}: ${chip}`);
  }
  // каждая строка «Все снаряды» есть хотя бы под одним чипом: сумма по чипам не меньше числа строк
  assert.ok(all.every((e) => CHIPS.some((c) => ExerciseLabels.matches(e, c))));
  assert.ok(CHIPS.reduce((n, c) => n + by(c).length, 0) >= all.length);
  assert.equal(all.filter((e) => ExerciseLabels.matches(e, "all")).length, 10);
});

test("R09-REQ02: поиск «жим» с чипом «Гантели» и «Штанга» даёт строки; «Все снаряды» возвращает полный список", () => {
  const found = (chip: "all" | (typeof CHIPS)[number]) =>
    EXERCISES.filter((e) => e.id !== bench.id && ExerciseLabels.matches(e, chip) && matchesSearch(`${e.name} ${e.nameEn} ${(e.aliases ?? []).join(" ")}`, "жим")).slice(0, 12);
  assert.ok(found("dumbbell").length > 0);
  assert.ok(found("dumbbell").every((e) => /гантел/i.test(e.name) || ExerciseLabels.equipment(e) === "Гантели"));
  assert.ok(found("barbell").length > 0);
  assert.equal(found("all").length, 10);
  // чип, под которым честно ничего нет, даёт пустой список
  const none = EXERCISES.filter((e) => ExerciseLabels.matches(e, "cable") && matchesSearch(e.name, "жим гантелей лёжа"));
  assert.equal(none.length, 0);
});

test("R09-REQ02: «Штанга / тренажёр» живёт под двумя чипами, остальные — под одним", () => {
  const ambiguous = EXERCISES.filter((e) => ExerciseLabels.equipment(e) === "Штанга / тренажёр");
  assert.ok(ambiguous.length > 0);
  for (const e of ambiguous) assert.deepEqual(ExerciseLabels.chips(e), ["barbell", "machine"]);
  for (const e of EXERCISES.filter((x) => ExerciseLabels.equipment(x) !== "Штанга / тренажёр")) assert.equal(ExerciseLabels.chips(e).length, 1);
});

// ───────────── REQ03: «Эта тренировка уже сохранена в другом окне» ─────────────
import { WorkoutConflict, WorkoutDigest } from "../src/domain/WorkoutConflict";
import { volumeSummary, workingSets, fmt } from "../src/lib/model";
import { VolumeLabel } from "../src/domain/VolumeLabel";

const FORBIDDEN = /версия|версии|версию|черновик|сервер|поверх/i;
const session = (id: string, plan: [number, number, boolean][]): Workout => {
  const w = makeWorkout(["bench"]);
  w.id = id;
  w.exercises[0].sets = plan.map(([weight, reps, d], i) => ({ id: `${id}-${i}`, weight, reps, rir: 2, warmup: false, done: d }));
  return w;
};

test("R09-REQ03: подходы и тоннаж считаются тем же правилом, что карточка «Истории» и шапка тренировки", () => {
  const saved = session("s", [[70, 8, true], [70, 8, true], [70, 8, false]]);
  const mine = session("m", [[60, 8, true], [60, 8, false], [60, 8, true]]);
  assert.deepEqual(WorkoutDigest.of(saved), { sets: 2, tonnageKg: 1120 });
  assert.deepEqual(WorkoutDigest.of(mine), { sets: 2, tonnageKg: 960 });
  // совпадает с тем, что показывают карточка и шапка
  assert.equal(WorkoutDigest.of(saved).sets, workingSets([saved]));
  assert.equal(WorkoutDigest.of(saved).tonnageKg, Math.round(volumeSummary([saved], "working").total));
  assert.equal(VolumeLabel.short(volumeSummary([saved], "all").total), "1,1 т");
  assert.match(WorkoutDigest.line(saved), /^2 подх\. · 1\s120 кг$/);
  assert.match(WorkoutDigest.line(mine), /^2 подх\. · 960 кг$/);
  assert.equal(fmt(1120).replace(/\s/g, " "), "1 120");
});

test("R09-REQ03: разминка в подходы и тоннаж не входит; без правила веса — «тоннаж не считается»", () => {
  const w = session("w", [[20, 10, true], [60, 8, true]]);
  w.exercises[0].sets[0].warmup = true;
  assert.deepEqual(WorkoutDigest.of(w), { sets: 1, tonnageKg: 480 });
  const pushups = makeWorkout(["pushup"]);
  pushups.exercises[0].sets.forEach((s) => ((s.done = true), (s.reps = 10)));
  assert.match(WorkoutDigest.line(pushups), /^3 подх\. · тоннаж не считается$/);
});

test("R09-REQ03: слов «версия», «черновик», «сервер», «поверх» в окне нет; три действия названы по результату, у каждого одна строка последствия", () => {
  const saved = session("s", [[70, 8, true], [70, 8, true], [70, 8, false]]);
  const mine = session("m", [[60, 8, true], [60, 8, false], [60, 8, true]]);
  const copies = [
    WorkoutConflict.title(saved),
    WorkoutConflict.title(null),
    ...WorkoutConflict.summary(mine, saved).flatMap((r) => [r.label, r.value]),
    ...WorkoutConflict.summary(mine, null).flatMap((r) => [r.label, r.value]),
    ...[WorkoutConflict.KEEP_SAVED, WorkoutConflict.SAVE_COPY, WorkoutConflict.DOWNLOAD].flatMap((a) => [a.label, a.effect]),
  ];
  for (const text of copies) assert.doesNotMatch(text, FORBIDDEN, text);
  assert.deepEqual(WorkoutConflict.summary(mine, saved).map((r) => r.label), ["Сохранено", "Здесь"]);
  assert.deepEqual(WorkoutConflict.summary(mine, null).map((r) => r.label), ["Здесь"]);
  for (const a of [WorkoutConflict.KEEP_SAVED, WorkoutConflict.SAVE_COPY, WorkoutConflict.DOWNLOAD]) {
    assert.ok(a.effect.length > 10 && !a.effect.includes("\n"));
    assert.ok(a.label.length < 45);
  }
  // сообщение после «отдельной тренировкой» осталось прежним
  assert.equal(WorkoutConflict.COPY_READY, "Отдельный черновик готов. Сохрани его, когда проверишь.");
});

// ───────────── REQ05: «Нет связи» у самого человека ─────────────
import { LiveLink, LIVE_LINK_LOST_MS } from "../src/domain/LiveSession";

test("R09-REQ05: «Нет связи» — только после повторных неудач и ≥ 10 с; один пропущенный запрос ничего не показывает", () => {
  const t0 = 1_000_000;
  assert.equal(LiveLink.lost(null, t0), false);
  // одна неудача, даже давняя, — не потеря связи: дальше всё решит следующая попытка
  const one = LiveLink.failed(null, t0);
  assert.deepEqual(one, { since: t0, count: 1 });
  assert.equal(LiveLink.lost(one, t0 + 60_000), false);
  // две неудачи, но прошло меньше 10 с — ещё рано
  const two = LiveLink.failed(one, t0 + 4_000);
  assert.deepEqual(two, { since: t0, count: 2 });
  assert.equal(LiveLink.lost(two, t0 + 9_999), false);
  // две неудачи и 10 с — строка показывается
  assert.equal(LiveLink.lost(two, t0 + LIVE_LINK_LOST_MS), true);
  // счёт идёт от первой неудачи, а не от последней
  const four = LiveLink.failed(LiveLink.failed(two, t0 + 8_000), t0 + 12_000);
  assert.deepEqual(four, { since: t0, count: 4 });
  assert.equal(LiveLink.lost(four, t0 + 12_500), true);
  // связь вернулась (issue сбросили в null) — строки нет
  assert.equal(LiveLink.lost(null, t0 + 20_000), false);
});

test("R09-REQ05: текст строки без «сервер» и «синхронизация», одной строкой", () => {
  assert.equal(LiveLink.MESSAGE, "Нет связи — напарник видит последние данные");
  assert.doesNotMatch(LiveLink.MESSAGE, /сервер|синхрон|\n/i);
});
