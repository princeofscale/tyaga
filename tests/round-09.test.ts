import test from "node:test";
import assert from "node:assert/strict";
import { makeWorkout, entryName } from "../src/lib/model";
import { LiveBroadcastPolicy, LivePresenter, LivePushPolicy, LiveStateBuilder } from "../src/domain/LiveSession";
import { newDraft, persistDraft, storedDraftId } from "../src/lib/draft";
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
  const next = LiveBroadcastPolicy.afterEdit(mine, edited, "a", NOW, entryName)!;
  assert.equal(next.phase, "done");
  assert.equal(next.tonnageKg, 1935);
  assert.equal(LivePresenter.headline({ state: next, updatedAt: new Date(NOW).toISOString() }, NOW), "Закончил · 1,9 т");
});

test("R09-REQ01 / QA-R09-01: комнату трогает только правка той самой тренировки, завершённой в комнате; две тренировки за один день различаются по id", () => {
  const morning = done("morning", "2026-11-16", [50]);
  const evening = done("evening", "2026-11-16", [100, 100, 100]);
  const other = done("other", "2026-11-09", [60]);
  const finished = { state: LiveStateBuilder.fromWorkout(evening, { now: NOW, nameOf: entryName, finished: true }) };
  // правка более ранней записи того же дня: комната остаётся с «Закончил» вечерней
  assert.equal(LiveBroadcastPolicy.afterEdit(finished, morning, "evening", NOW, entryName), null);
  // правка записи другого дня
  assert.equal(LiveBroadcastPolicy.afterEdit(finished, other, "evening", NOW, entryName), null);
  // правка завершённой в комнате: ровно один итог с новыми числами
  const edited = structuredClone(evening);
  edited.exercises[0].sets[0].weight = 110;
  const next = LiveBroadcastPolicy.afterEdit(finished, edited, "evening", NOW, entryName)!;
  assert.equal(next.phase, "done");
  assert.equal(next.tonnageKg, 110 * 5 + 100 * 5 * 2);
  // нет сведений о том, что завершено в комнате (другое устройство, чистое хранилище)
  assert.equal(LiveBroadcastPolicy.afterEdit(finished, evening, null, NOW, entryName), null);
});

test("R09-REQ01: итог комнаты не трогаем, если строки «Закончил» нет", () => {
  const latest = done("a", "2026-11-16", [80]);
  const finished = { state: LiveStateBuilder.fromWorkout(latest, { now: NOW, nameOf: entryName, finished: true }) };
  assert.equal(LiveBroadcastPolicy.afterEdit({ state: null }, latest, "a", NOW, entryName), null);
  assert.equal(LiveBroadcastPolicy.afterEdit(undefined, latest, "a", NOW, entryName), null);
  const lifting = { state: { ...finished.state!, phase: "lifting" as const } };
  assert.equal(LiveBroadcastPolicy.afterEdit(lifting, latest, "a", NOW, entryName), null);
});

test("R09-QA-02: вкладка, чей черновик закончен или убран в другой вкладке, ничего не шлёт в комнату", () => {
  const w = done("live", "2026-11-16", [80]);
  w.exercises[0].sets.push({ id: "x", weight: 80, reps: 5, rir: 2, warmup: false, done: false });
  const draft = draftOf(w, false);
  assert.equal(LiveBroadcastPolicy.stateFor(draft, NOW, entryName, null)!.phase, "lifting");
  assert.equal(LiveBroadcastPolicy.stateFor(draft, NOW, entryName, "live"), null);
  // другая тренировка (новый черновик с другим id) снова транслируется
  assert.equal(LiveBroadcastPolicy.stateFor({ ...draft, workout: { ...w, id: "next" } }, NOW, entryName, "live")!.phase, "lifting");
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
  // каталог пополнился (раунд 10): совпадений «жим» теперь больше потолка списка — 12
  assert.equal(found("all").length, 12);
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
  // счёт идёт от начала отсчёта, а не от последней неудачи
  const four = LiveLink.failed(LiveLink.failed(two, t0 + 8_000), t0 + 12_000);
  assert.deepEqual(four, { since: t0, count: 4 });
  assert.equal(LiveLink.lost(four, t0 + 12_500), true);
  // связь вернулась (issue сбросили в null) — строки нет
  assert.equal(LiveLink.lost(null, t0 + 20_000), false);
});

test("R09-QA-04: отсчёт идёт от последнего удавшегося запроса (но не глубже 6 с) — простой без нажатий укладывается в 15 с", () => {
  const t = 1_000_000;
  // последний ответ 3 с назад: «ушла связь» считается от него
  assert.deepEqual(LiveLink.failed(null, t, t - 3_000), { since: t - 3_000, count: 1 });
  // давняя тишина (минуту назад) не засчитывается целиком
  assert.deepEqual(LiveLink.failed(null, t, t - 60_000), { since: t - 6_000, count: 1 });
  // опрос раз в 5 с: сеть пропала сразу после ответа, неудачи на 5-й и 9-й секунде, строка на 10-й
  const lastOk = t;
  let issue = LiveLink.failed(null, lastOk + 5_000, lastOk);
  issue = LiveLink.failed(issue, lastOk + 9_000, lastOk);
  assert.equal(LiveLink.lost(issue, lastOk + 9_500), false);
  assert.equal(LiveLink.lost(issue, lastOk + 10_000), true);
  // одиночный сбой при старой тишине всё равно ничего не показывает
  assert.equal(LiveLink.lost(LiveLink.failed(null, t, t - 60_000), t + 30_000), false);
});

test("R09-REQ05 / QA-R09-07: текст строки короткий (одна строка на 320), без «сервер» и «синхронизация»", () => {
  assert.equal(LiveLink.MESSAGE, "Нет связи — напарник видит старое");
  assert.ok(LiveLink.MESSAGE.length <= 36);
  assert.doesNotMatch(`${LiveLink.MESSAGE} ${LiveLink.DETAIL}`, /сервер|синхрон|\n/i);
});

// ───────────── Доработка 1 ─────────────
test("R09-QA-03: «Блок / Кроссовер» непуст — все блоки и кроссоверы каталога; «Тренажёр» сохранил настоящие тренажёры; подпись у строки и чип совпадают", () => {
  const cable = EXERCISES.filter((e) => ExerciseLabels.equipment(e) === "Блок / Кроссовер");
  assert.ok(cable.length >= 10, `блочных: ${cable.length}`);
  for (const id of ["fly", "lat-pulldown", "row", "facepull-er", "triceps-push", "high-cable-fly", "pullover-cable", "lateral-cable-single"])
    assert.ok(cable.some((e) => e.id === id), id);
  for (const e of cable) assert.ok(/блок|канат|кроссовер/i.test(e.name) || /cable|pulldown/i.test(e.id), e.name);
  const machine = EXERCISES.filter((e) => ExerciseLabels.equipment(e) === "Тренажёр").map((e) => e.id);
  for (const id of ["legpress", "legcurl-seated", "legcurl-prone", "leg-extension", "shoulder-press-machine", "calf-seated", "calf-standing-machine"]) assert.ok(machine.includes(id), id);
  // каждая строка каталога живёт ровно под чипом(ами) своей подписи
  for (const e of EXERCISES) for (const chip of ["dumbbell", "barbell", "cable", "machine", "bodyweight"] as const)
    assert.equal(ExerciseLabels.matches(e, chip), ExerciseLabels.chips(e).includes(chip));
  assert.equal(EXERCISES.filter((e) => ExerciseLabels.matches(e, "cable")).length, cable.length);
  // все пять подписей в каталоге встречаются (чипы не мёртвые)
  for (const word of ["Штанга", "Гантели", "Блок / Кроссовер", "Тренажёр", "Свой вес"]) assert.ok(EXERCISES.some((e) => ExerciseLabels.equipment(e) === word), word);
});

test("R09-QA-05: в окне расхождения у записи с отмеченной разминкой тоннаж помечен «без разминки»", () => {
  const w = session("w", [[60, 8, true], [60, 8, true]]);
  assert.match(WorkoutDigest.line(w), /^2 подх\. · 960 кг$/);
  w.exercises[0].sets.unshift({ id: "warm", weight: 40, reps: 10, rir: null, warmup: true, done: true });
  assert.match(WorkoutDigest.line(w), /^2 подх\. · 960 кг без разминки$/);
  // неотмеченная разминка в тоннаж не входит и пометки не требует
  w.exercises[0].sets[0].done = false;
  assert.match(WorkoutDigest.line(w), /^2 подх\. · 960 кг$/);
});

test("R09-QA-06: подпись копии верна для обоих вариантов — «две записи» только когда сохранённая запись есть", () => {
  assert.match(WorkoutConflict.SAVE_COPY.effect, /две записи/);
  assert.doesNotMatch(WorkoutConflict.SAVE_COPY_DELETED.effect, /две записи/);
  assert.match(WorkoutConflict.SAVE_COPY_DELETED.effect, /только она/);
  assert.equal(WorkoutConflict.SAVE_COPY_DELETED.label, WorkoutConflict.SAVE_COPY.label);
  assert.doesNotMatch(WorkoutConflict.SAVE_COPY_DELETED.effect, FORBIDDEN);
});

test("R09-QA-08: вкладка отпускает свою тренировку только если из общего ключа убрали именно её", () => {
  const mine = draftOf(done("y", "2026-11-16", [80]), false);
  assert.equal(LiveBroadcastPolicy.releasedBy(mine, "y"), "y", "закончили или отменили нашу тренировку — замолкаем");
  assert.equal(LiveBroadcastPolicy.releasedBy(mine, "x"), null, "убран черновик другой тренировки — мы не при чём");
  assert.equal(LiveBroadcastPolicy.releasedBy(mine, null), null, "id убранного неизвестен — не глушим живую тренировку");
  assert.equal(LiveBroadcastPolicy.releasedBy(null, "y"), null);
  assert.equal(LiveBroadcastPolicy.releasedBy(draftOf(done("y", "2026-11-16", [80]), true), "y"), null, "правка сохранённой тренировки не транслируется и так");
});

test("R09-QA-08: устаревшая вкладка не стирает общий черновик чужой тренировки, но стирает свой", () => {
  const map = new Map<string, string>();
  const store = { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v), removeItem: (k: string) => void map.delete(k) };
  const y = newDraft(done("y", "2026-11-16", [80]));
  persistDraft(store, y, "k");
  // вкладка 2 вела X и отменяет его: в ключе уже тренировка Y
  assert.equal(persistDraft(store, null, "k", "x"), "saved");
  assert.equal(storedDraftId(map.get("k") ?? null), "y", "черновик Y остался");
  // своя тренировка стирается
  persistDraft(store, null, "k", "y");
  assert.equal(map.has("k"), false);
  // без известного id поведение прежнее: ключ убирается
  persistDraft(store, y, "k");
  persistDraft(store, null, "k");
  assert.equal(map.has("k"), false);
  // нечитаемая запись не мешает убрать ключ
  map.set("k", "{oops");
  persistDraft(store, null, "k", "x");
  assert.equal(map.has("k"), false);
});
