import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { ExerciseSearchRank } from "../src/domain/ExerciseSearchRank";
import { ImportUndoMessage } from "../src/domain/ImportUndoMessage";
import { PreviousSets } from "../src/domain/PreviousSets";
import { SetCompleteness } from "../src/domain/SetCompleteness";
import { TrainingProgram } from "../src/domain/TrainingProgram";
import { WorkoutSession } from "../src/domain/WorkoutSession";
import { OfflineSnapshot } from "../src/lib/offlineSnapshot";
import { DeviceAccountData } from "../src/lib/deviceAccountData";
import { PendingWorkouts } from "../src/domain/PendingWorkouts";
import { ApiError } from "../src/services/ApiClient";
import { estimatedOneRepMax, exerciseById, makeExerciseEntry, makeSets, makeWorkout} from "../src/lib/model";
import type { Routine, Workout } from "../src/lib/types";

const bench = () => exerciseById("bench")!;

test("R03-REQ01: подход без веса или без повторов нельзя отметить молча", () => {
  assert.equal(SetCompleteness.missing(bench(), { weight: 0, reps: 8 }), "weight");
  assert.equal(SetCompleteness.missing(bench(), { weight: 60, reps: 0 }), "reps");
  assert.equal(SetCompleteness.missing(bench(), { weight: 60, reps: 8 }), null);
  assert.match(SetCompleteness.message("weight"), /Вес не введён/);
  const pullup = exerciseById("pullup")!;
  assert.equal(SetCompleteness.missing(pullup, { weight: 0, reps: 8 }), null, "вес тела допускает 0 доп. веса");
  assert.equal(SetCompleteness.missing(pullup, { weight: 0, reps: 0 }), "reps");
});

test("R03-REQ01: пустые строки не уходят в журнал, а тоннаж и Epley прежние", () => {
  const w = makeWorkout(["bench"], [], "UTC", true);
  w.exercises[0].sets = [
    { ...makeSets(1, 100, 8, null)[0], done: true },
    makeSets(1, 0, 0, null)[0],
  ];
  const { workout } = new WorkoutSession(w).withoutUnperformed();
  assert.equal(workout.exercises[0].sets.length, 1, "пустая невыполненная строка отброшена");
  assert.equal(workout.exercises[0].sets.filter((s) => s.done && !s.warmup).length, 1);
  assert.equal(new WorkoutSession(workout).completedWorkingSets, 1);
  assert.equal(Math.round(estimatedOneRepMax(w.exercises[0].sets[0], w.exercises[0]) * 10) / 10, 126.7);
});

test("R03-REQ02: живое упражнение без истории пустое, с историей — подход N из прошлого", () => {
  const blank = makeExerciseEntry("bench", [], undefined, undefined, true);
  assert.deepEqual(blank.sets.map((s) => [s.weight, s.reps, s.rir]), [[0, 0, null], [0, 0, null], [0, 0, null]]);
  const plan = makeExerciseEntry("bench");
  assert.deepEqual([plan.sets[0].reps, plan.sets[0].rir], [10, 2], "заготовка программы сохраняет числа по умолчанию");

  const previous = makeWorkout(["bench"], [], "UTC", true);
  previous.createdAt = "2026-10-01T10:00:00Z";
  previous.date = "2026-10-01";
  previous.exercises[0].sets = [8, 8, 7].map((reps) => ({ ...makeSets(1, 80, reps, null)[0], done: true }));
  const next = makeExerciseEntry("bench", [previous], "2026-10-08", "UTC", true);
  assert.deepEqual(next.sets.map((s) => s.reps), [8, 8, 7]);
  assert.deepEqual(next.sets.map((s) => s.rir), [null, null, null], "RIR не выдумывается");
  const repeated = previous.exercises[0].sets.map((s, i) => ({ ...makeSets(1, 0, 0, null)[0], ...PreviousSets.patch(PreviousSets.pick(previous.exercises[0].sets, i)!) }));
  assert.deepEqual(next.sets.map((s) => [s.weight, s.reps, s.rir]), repeated.map((s) => [s.weight, s.reps, s.rir]),
    "предзаполнение совпадает с «Повторить прошлые»");
  assert.equal(PreviousSets.pick([1, 2], 5), 2, "если подходов стало больше — берётся последний");
});

test("R03-REQ06: сообщения отмены импорта без «убрано 0»", () => {
  assert.equal(ImportUndoMessage.describe({ removed: 3, restored: 0, kept: 0 }), "Убрал 3 тренировки этого импорта.");
  assert.equal(ImportUndoMessage.describe({ removed: 0, restored: 2, kept: 0 }), "Вернул прежнюю версию 2 тренировок.");
  assert.equal(ImportUndoMessage.describe({ removed: 0, restored: 0, kept: 1 }), "Не тронул 1 твою правку.");
  assert.equal(ImportUndoMessage.describe({ removed: 0, restored: 0, kept: 0 }), "Импорт отменён: убирать было нечего.");
  for (const r of [{ removed: 0, restored: 1, kept: 2 }, { removed: 1, restored: 0, kept: 0 }, { removed: 5, restored: 1, kept: 3 }])
    assert.doesNotMatch(ImportUndoMessage.describe(r), /(^|\D)0 /);
});

const routine = (patch: Partial<Routine> = {}): Routine => ({
  id: "r", name: "Тест", notes: "", days: [], exercises: [], restSeconds: 90, progression: "repeat",
  repMin: 8, repMax: 12, incrementKg: 2.5, revision: 1, ...patch,
});

test("R03-REQ07: источник веса в программе — история, план или не задан", () => {
  const planned = makeExerciseEntry("bench");
  planned.sets = makeSets(3, 70, 8);
  const none = makeExerciseEntry("squat");
  none.sets = makeSets(3, 0, 8);
  const past = makeWorkout(["row"], [], "UTC", true);
  past.date = "2026-10-01"; past.createdAt = "2026-10-01T10:00:00Z";
  past.exercises[0].sets = [{ ...makeSets(1, 55, 10, null)[0], done: true }];
  const rowPlan = { ...makeExerciseEntry("row"), sets: makeSets(3, 0, 8) };
  const hints = new TrainingProgram(routine({ exercises: [planned, none, rowPlan] })).weightHints([past], "UTC", "2026-10-08");
  assert.deepEqual(hints, [
    { source: "plan", weightKg: 70 },
    { source: "none", weightKg: null },
    { source: "history", weightKg: 55 },
  ]);
});

test("R03-REQ08: короткий общий запрос ставит базовые и уже сделанные упражнения выше остальных", () => {
  const items = [
    { name: "Присед на шаре", editorial: false, done: false },
    { name: "Приседания со штангой", editorial: true, done: false },
    { name: "Присед в тренажёре Смита", editorial: false, done: true },
    { name: "Присед пистолетом", editorial: false, done: false },
  ];
  const sorted = ExerciseSearchRank.sort(items, "присед", (i) => i.name, (i) => i.editorial, () => false, (i) => i.done).map((i) => i.name);
  assert.deepEqual(sorted.slice(0, 2).sort(), ["Приседания со штангой", "Присед в тренажёре Смита"].sort());
  assert.ok(sorted.indexOf("Присед на шаре") >= 2 && sorted.indexOf("Присед пистолетом") >= 2);
  // Запрос из нескольких слов не перестраивается по «сделанным»: «жим лёжа» не ломается.
  const press = [
    { name: "Жим лёжа", editorial: true },
    { name: "Жим лёжа узким хватом", editorial: false },
    { name: "Жим гантелей лёжа", editorial: false },
  ];
  assert.equal(ExerciseSearchRank.sort(press, "жим лёжа", (i) => i.name, (i) => i.editorial)[0].name, "Жим лёжа");
});

test("R03-REQ04: офлайн-копия хранит профиль и данные и стирается при выходе", () => {
  const map = new Map<string, string>();
  const storage = { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v), removeItem: (k: string) => void map.delete(k) };
  const snapshot = new OfflineSnapshot(() => storage);
  assert.equal(snapshot.session(), null);
  snapshot.saveSession({ id: "u1", email: "a@example.test", displayName: "A" } as never);
  snapshot.saveData("u1", { workouts: [makeWorkout(["bench"], [], "UTC")] as Workout[], settings: { restSeconds: 90 } as never, product: {} as never });
  assert.equal(snapshot.session()?.id, "u1");
  assert.equal(snapshot.data("u1")?.workouts.length, 1);
  assert.equal(snapshot.data("u2"), null, "чужой аккаунт копию не видит");
  map.set("tyaga-offline:data:u1", "{битый json");
  assert.equal(snapshot.data("u1"), null, "повреждённая копия не ломает запуск");
  snapshot.saveData("u1", { workouts: [], settings: {} as never, product: {} as never });
  snapshot.clear();
  assert.equal(snapshot.session(), null);
  assert.equal(snapshot.data("u1"), null);
  const broken = new OfflineSnapshot(() => { throw new Error("storage blocked"); });
  assert.equal(broken.session(), null);
  assert.doesNotThrow(() => broken.saveData("u1", { workouts: [], settings: {} as never, product: {} as never }));
});

async function sandbox() {
  const mf = new Miniflare(convertV4MiniflareOptions({
    workers: [{ modules: true, scriptPath: "dist/server/index.js", compatibilityDate: "2025-09-27", d1Databases: ["DB"] }],
    cf: false,
  }));
  const db = await mf.getD1Database("DB");
  for (const file of (await readdir("drizzle")).filter((p) => p.endsWith(".sql")).sort())
    for (const statement of (await readFile("drizzle/" + file, "utf8")).split("--> statement-breakpoint").filter((s) => s.trim()))
      await db.prepare(statement.trim()).run();
  const base = "http://localhost";
  const owner = "user-r3";
  const reg = await mf.dispatchFetch(base + "/api/auth/register", {
    method: "POST", headers: { "oai-authenticated-user-id": owner, Origin: base, "Content-Type": "application/json" },
    body: JSON.stringify({ email: "r3@example.test", password: "test account passphrase", displayName: owner, timeZone: "UTC" }),
  });
  const cookie = reg.headers.get("Set-Cookie")!.split(";")[0];
  const request = (path: string, method = "GET", body?: unknown) =>
    mf.dispatchFetch(base + path, {
      method, headers: { "oai-authenticated-user-id": owner, Cookie: cookie, Origin: base, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  return { mf, request };
}

test("R03-REQ08: /api/exercises по слову «присед» отдаёт базовые упражнения раньше экзотики, «жим лёжа» не ломается", async () => {
  const { mf, request } = await sandbox();
  try {
    let result: any;
    for (let i = 0; i < 10; i++) {
      result = await (await request("/api/exercises?q=" + encodeURIComponent("присед"))).json();
      if (!result.importing) break;
    }
    const names: string[] = result.exercises.map((e: any) => e.name);
    assert.ok(names.slice(0, 5).includes("Приседания"), "простое «Приседания» в первых пяти строках: " + names.slice(0, 5).join(" | "));
    assert.notEqual(names[0], "Присед на ящик одной ногой");
    const pull = await (await request("/api/exercises?q=" + encodeURIComponent("тяга"))).json();
    const pullNames: string[] = pull.exercises.slice(0, 5).map((e: any) => e.name);
    assert.ok(pullNames.includes("Становая тяга") && pullNames.includes("Тяга штанги в наклоне"), "QA-R03-05, первые пять: " + pullNames.join(" | "));
    const generic = await (await request("/api/exercises?q=" + encodeURIComponent("жим"))).json();
    assert.ok(generic.exercises.length > 0);
    const press = await (await request("/api/exercises?q=" + encodeURIComponent("жим лёжа"))).json();
    assert.ok(press.exercises.slice(0, 2).some((e: any) => e.name === "Жим штанги лёжа"), "«жим лёжа» по-прежнему ставит «Жим штанги лёжа» в первые две строки");
  } finally {
    await mf.dispose();
  }
});

const routineOf = (exercises: Workout["exercises"]) => routine({ exercises });

test("QA-R03-02: запуск из программы — подход N из «Прошлого», без истории повторы и RIR не вписаны", () => {
  const history = makeWorkout(["bench"], [], "UTC", true);
  history.date = "2026-10-01";
  history.createdAt = "2026-10-01T10:00:00Z";
  history.exercises[0].sets = [8, 8, 7].map((reps) => ({ ...makeSets(1, 77.5, reps, null)[0], done: true }));
  const plan = makeWorkout(["bench", "lat-pulldown"]);
  const routine = routineOf(plan.exercises);
  const started = new TrainingProgram(routine).start([history], "UTC", "2026-11-10");
  const [bench, pulldown] = started.exercises;
  assert.deepEqual(bench.sets.map((s) => s.reps), [8, 8, 7], "8/8/7, как в «Прошлом»");
  assert.deepEqual(bench.sets.map((s) => s.weight), [77.5, 77.5, 77.5]);
  assert.deepEqual(bench.sets.map((s) => s.rir), [null, null, null], "RIR из плана не подставляется");
  assert.deepEqual(pulldown.sets.map((s) => [s.reps, s.rir]), [[0, null], [0, null], [0, null]], "без истории — пусто");
  assert.equal(pulldown.repMin, 10, "план программы остаётся подсказкой, а не введённым значением");
  assert.equal(SetCompleteness.missing(exerciseById("lat-pulldown")!, pulldown.sets[0]), "weight");
});

test("QA-R03-03: выход стирает всё личное с tyaga-, оформление остаётся; вход другого аккаунта стирает чужое", () => {
  const map = new Map<string, string>();
  const storage = {
    get length() { return map.size; }, key: (i: number) => [...map.keys()][i] ?? null,
    getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v), removeItem: (k: string) => void map.delete(k),
  };
  const personal = ["tyaga-draft-account:a1", "tyaga-bodyweight-sync:a1", "tyaga-bodyweight-sync:a1:cloud:offline", "tyaga-bodyweight-bound:a1", "tyaga-bodyweight:a1", "tyaga-bodyweight-goal:a1", "tyaga-last-import:a1", "tyaga-offline:session", "tyaga-offline:data:a1", "tyaga-import-run:abc", "tyaga-draft-v1"];
  const neutral = ["tyaga_theme_accent", "tyaga_sound_muted", "other-site-key"];
  for (const k of [...personal, ...neutral]) map.set(k, "x");
  const data = new DeviceAccountData(() => storage);
  assert.deepEqual(data.purgeOthers("a1"), [], "свои данные при входе не трогаются");
  map.set("tyaga-draft-account:b2", "x");
  data.purgeOthers("a1");
  assert.equal(map.has("tyaga-draft-account:b2"), false, "данные другого аккаунта стёрты");
  assert.equal(map.has("tyaga-draft-account:a1"), true);
  data.wipe();
  assert.deepEqual([...map.keys()].sort(), [...neutral].sort());
  assert.doesNotThrow(() => new DeviceAccountData(() => { throw new Error("blocked"); }).wipe());
});

const memoryStore = () => {
  const map = new Map<string, string>();
  return {
    map,
    storage: {
      get length() { return map.size; }, key: (i: number) => [...map.keys()][i] ?? null,
      getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v), removeItem: (k: string) => void map.delete(k),
    },
  };
};
const finished = (date = "2026-11-10") => {
  const w = makeWorkout(["bench"], [], "UTC", true);
  w.date = date;
  w.exercises[0].sets = [{ ...makeSets(bench(), 1)[0], weight: 60, reps: 8, done: true }];
  return w;
};

test("Доработка 2 / R03-REQ04: очередь отправки привязана к аккаунту, переживает перезагрузку и не плодит дубли", () => {
  const { map, storage } = memoryStore();
  const a = new PendingWorkouts(() => storage, "a1");
  const w = finished();
  assert.equal(a.add(w, new Date("2026-11-10T12:00:00Z")), true);
  assert.equal(a.add(w), true, "повторная постановка той же тренировки заменяет, а не дублирует");
  assert.equal(a.list().length, 1);
  assert.equal(new PendingWorkouts(() => storage, "a1").list()[0].workout.id, w.id, "после перезагрузки лежит там же");
  assert.equal(new PendingWorkouts(() => storage, "b2").list().length, 0, "чужой аккаунт очередь не видит");
  assert.ok(map.has("tyaga-pending-workouts:a1"));
  a.fail(w.id, "Версия устарела");
  assert.equal(a.list()[0].error, "Версия устарела");
  assert.deepEqual(a.list()[0].workout, w, "ошибка сервера данные не меняет");
  a.clearError(w.id);
  assert.equal(a.list()[0].error, undefined);
  a.remove(w.id);
  assert.equal(map.has("tyaga-pending-workouts:a1"), false, "пустая очередь ключ не оставляет");
  const broken = new PendingWorkouts(() => { throw new Error("blocked"); }, "a1");
  assert.equal(broken.add(w), false, "хранилище не приняло — вызывающий оставит тренировку как есть");
  assert.deepEqual(broken.list(), []);
  map.set("tyaga-pending-workouts:a1", "{не json");
  assert.deepEqual(a.list(), [], "битая запись не роняет приложение");
});

test("Доработка 2 / R03-REQ04: повторять можно только обрыв связи и 5xx; отказ сервера остаётся в очереди с ошибкой", () => {
  assert.equal(PendingWorkouts.isRetryable(new TypeError("Failed to fetch")), true);
  assert.equal(PendingWorkouts.isRetryable(new Error("Нет связи")), true);
  assert.equal(PendingWorkouts.isRetryable(new ApiError("Сервер недоступен", 503, {})), true);
  assert.equal(PendingWorkouts.isRetryable(new ApiError("Версия устарела", 409, {})), false);
  assert.equal(PendingWorkouts.isRetryable(new ApiError("Неверные данные", 400, {})), false);
  assert.equal(PendingWorkouts.isRetryable(new ApiError("Войди снова", 401, {})), false);
  assert.equal(PendingWorkouts.needsSignIn(new ApiError("Войди снова", 401, {})), true);
  assert.equal(PendingWorkouts.needsSignIn(new ApiError("x", 409, {})), false);
  const abort = new Error("aborted"); abort.name = "AbortError";
  assert.equal(PendingWorkouts.isRetryable(abort), false);
});

test("Доработка 2 / R03-REQ04: в истории ожидающая тренировка стоит один раз; серверная версия новее — побеждает", () => {
  const fresh = finished("2026-11-10");
  const old = { ...finished("2026-11-01"), revision: 1 };
  const queued = [{ workout: fresh, queuedAt: "2026-11-10T12:00:00Z" }];
  assert.deepEqual(PendingWorkouts.merge([old], queued).map((w) => w.id), [fresh.id, old.id]);
  assert.deepEqual(PendingWorkouts.merge([old], []), [old], "пустая очередь журнал не меняет");
  // Потерянный ответ: сервер уже записал тренировку (ревизия 1), очередь ещё держит её с ревизией 0.
  const written = { ...fresh, revision: 1 };
  const merged = PendingWorkouts.merge([written, old], queued);
  assert.equal(merged.filter((w) => w.id === fresh.id).length, 1, "без дубля");
  assert.equal(merged.find((w) => w.id === fresh.id)?.revision, 1);
  // Правка, не ушедшая на сервер: очередь с той же ревизией показывается вместо серверной.
  const edit = { ...old, name: "Правка", revision: 1 };
  assert.equal(PendingWorkouts.merge([old], [{ workout: edit, queuedAt: "x" }])[0].name, "Правка");
});

test("QA-R03-08: истёкшая сессия стирает кэши журнала веса, импорта и офлайн-копию, но не начатую тренировку и очередь", () => {
  const { map, storage } = memoryStore();
  const caches = ["tyaga-offline:session", "tyaga-offline:data:a1", "tyaga-bodyweight-sync:a1", "tyaga-bodyweight-sync:a1:cloud:offline", "tyaga-bodyweight-bound:a1", "tyaga-bodyweight:a1", "tyaga-bodyweight-goal:a1", "tyaga-last-import:a1", "tyaga-import-run:abc"];
  const work = ["tyaga-draft-account:a1", "tyaga-pending-workouts:a1"];
  const neutral = ["tyaga_theme_accent", "tyaga_sound_muted", "tyaga-cloud", "other-site-key"];
  for (const k of [...caches, ...work, ...neutral]) map.set(k, "x");
  const data = new DeviceAccountData(() => storage);
  data.wipeCaches();
  assert.deepEqual([...map.keys()].sort(), [...work, ...neutral].sort());
  data.purgeOthers("b2");
  assert.deepEqual([...map.keys()].sort(), [...neutral].sort(), "вход другого аккаунта стирает и очередь прежнего");
  map.set("tyaga-pending-workouts:a1", "x"); map.set("tyaga-draft-account:a1", "x");
  new DeviceAccountData(() => storage).wipe();
  assert.equal(map.has("tyaga-pending-workouts:a1"), false, "выход стирает очередь");
  assert.equal(map.has("tyaga-draft-account:a1"), false);
});

test("QA-R09-10: вход другого аккаунта стирает и отметку «закончил в комнате» прежнего, свою оставляет", () => {
  const { map, storage } = memoryStore();
  map.set("tyaga-live-finished:a1", "w-1");
  map.set("tyaga-live-finished:b2", "w-2");
  map.set("tyaga_theme_accent", "x");
  const data = new DeviceAccountData(() => storage);
  data.purgeOthers("b2");
  assert.equal(map.has("tyaga-live-finished:a1"), false, "чужая отметка стёрта");
  assert.equal(map.get("tyaga-live-finished:b2"), "w-2", "своя остаётся");
  assert.equal(map.has("tyaga_theme_accent"), true, "оформление остаётся");
  data.wipe();
  assert.equal(map.has("tyaga-live-finished:b2"), false, "при выходе стирается и своя");
});
