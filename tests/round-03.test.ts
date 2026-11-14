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
    for (const word of ["тяга", "жим"]) {
      const generic = await (await request("/api/exercises?q=" + encodeURIComponent(word))).json();
      assert.ok(generic.exercises.length > 0);
    }
    const press = await (await request("/api/exercises?q=" + encodeURIComponent("жим лёжа"))).json();
    assert.ok(press.exercises.slice(0, 2).some((e: any) => e.name === "Жим штанги лёжа"), "«жим лёжа» по-прежнему ставит «Жим штанги лёжа» в первые две строки");
  } finally {
    await mf.dispose();
  }
});
