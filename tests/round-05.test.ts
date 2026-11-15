import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WorkoutImport } from "../src/domain/WorkoutImport";
import { ImportNameMatcher } from "../src/domain/ImportNameMatcher";
import { DateText } from "../src/domain/DateText";
import { HistoryFilter } from "../src/domain/HistoryFilter";
import { ProgressOverview } from "../src/domain/ProgressOverview";
import { exerciseById } from "../src/lib/model";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { readdir, readFile } from "node:fs/promises";
import { ApiError } from "../src/services/ApiClient";
import { ImportService } from "../src/services/ImportService";
import type { Exercise, Workout } from "../src/lib/types";

/** Годовой Strong-экспорт из генератора: 240 тренировок, 52 названия. */
function yearFile() {
  const dir = mkdtempSync(join(tmpdir(), "tyaga-r05-"));
  const csv = join(dir, "year.csv");
  execFileSync("node", ["tests/fixtures/gen-year-csv.mjs", csv, join(dir, "year.json")], { stdio: "ignore" });
  return new WorkoutImport({ dateOrder: "dmy", weightUnit: "kg", distanceUnit: "km", timeZone: "Europe/Saratov" }).parse(
    readFileSync(csv, "utf8"),
    "strong",
  );
}
const wgerLike = (id: string, name: string) =>
  ({ ...exerciseById("pushup"), id, name, nameEn: name, source: { provider: "wger" } }) as unknown as Exercise;

test("R05-REQ01: годовой файл Strong — названия узнаются как упражнения каталога, а не десятки «Моих»", () => {
  const data = yearFile();
  assert.equal(data.workouts.length, 240);
  assert.equal(data.exerciseNames.length, 52);
  // Точные ответы базы упражнений (их отдаёт сервер /api/exercises/resolve).
  const wger = {
    Plank: [wgerLike("wger:plank", "Планка")],
    Dip: [wgerLike("wger:dip", "Отжимания на брусьях")],
    "Kettlebell Swing": [wgerLike("wger:swing", "Мах гирей")],
    "Farmers Walk (Dumbbell)": [wgerLike("wger:farmers", "Прогулка фермера")],
    "Good Morning (Barbell)": [wgerLike("wger:gm", "Наклоны со штангой")],
  };
  const verdicts = ImportNameMatcher.classifyAll(data.exerciseNames, wger);
  const summary = ImportNameMatcher.summary(verdicts);
  assert.equal(summary.total, 52);
  assert.ok(summary.matched >= 40, `сопоставлено ${summary.matched} из 52`);
  // «Мои» после импорта без единого ручного выбора: нерешённые + совсем свои.
  assert.ok(summary.toDecide + summary.own <= 12, `останется «Моими»: ${summary.toDecide + summary.own}`);
  const id = (name: string) => verdicts[name].exercise?.id;
  assert.equal(id("Pull Up"), "pullup");
  assert.equal(id("Lat Pulldown (Cable)"), "lat-pulldown");
  assert.equal(id("Hanging Leg Raise"), "hanging-leg-raise");
  assert.equal(id("Leg Press (Machine)"), "legpress");
  assert.equal(id("Face Pull (Cable)"), "facepull-er");
  assert.equal(id("Calf Raise (Machine)"), "calf-standing-machine");
  assert.equal(id("Back Extension"), "back-extension");
  // Контуры: оборудование решает, а не «похоже».
  assert.equal(id("Bench Press (Barbell)"), "bench");
  assert.equal(id("Incline Bench Press (Dumbbell)"), "incline-db");
  assert.notEqual(id("Overhead Press (Barbell)"), id("Arnold Press (Dumbbell)"));
});

test("R05-REQ01: спорное не сливается молча — предлагаются ближайшие варианты, счётчик «нужно решить»", () => {
  const verdicts = ImportNameMatcher.classifyAll(["Hack Squat (Machine)", "Dip", "Close Grip Bench Press (Barbell)", "Deadlift", "Overhead Press"]);
  assert.equal(verdicts["Hack Squat (Machine)"].kind, "ask");
  assert.ok(verdicts["Hack Squat (Machine)"].candidates.length > 0);
  assert.equal(verdicts["Hack Squat (Machine)"].exercise, null);
  // Без оборудования «Deadlift» и «Overhead Press» — только предложение, штанга не угадывается.
  assert.equal(verdicts.Deadlift.kind, "ask");
  assert.equal(verdicts["Overhead Press"].kind, "ask");
  // В каталоге и базе ничего похожего — отдельная запись.
  assert.equal(verdicts.Dip.kind, "own");
  const base = ImportNameMatcher.summary(verdicts);
  assert.equal(base.toDecide, 4);
  assert.equal(base.own, 1);
  // Выбор пользователя засчитывается как решение; явное «отдельной записью» — тоже.
  const decided = ImportNameMatcher.summary(verdicts, { "Hack Squat (Machine)": "legpress", Deadlift: "" });
  assert.equal(decided.matched, 1);
  assert.equal(decided.toDecide, 2);
  assert.equal(decided.own, 2);
});

test("R05-REQ01: гантели и штанга не путаются: «Overhead Press (Dumbbell)» ≠ штанговый жим", () => {
  const v = ImportNameMatcher.classifyAll(["Overhead Press (Dumbbell)", "Overhead Press (Barbell)", "Squat (Dumbbell)"]);
  assert.equal(v["Overhead Press (Dumbbell)"].exercise?.id, "ohp");
  assert.equal(v["Overhead Press (Barbell)"].exercise?.id, "ohp-bar");
  assert.notEqual(v["Squat (Dumbbell)"].kind, "matched");
  assert.equal(ImportNameMatcher.machineLabel(v["Overhead Press (Dumbbell)"]), "Из файла (Dumbbell)");
});

test("R05-REQ03: единый формат даты — «6 нояб. 2026», без ISO; год у месяцев; время операции", () => {
  assert.equal(DateText.day("2026-11-06"), "6 нояб. 2026");
  assert.equal(DateText.day("2025-11-15"), "15 нояб. 2025");
  assert.equal(DateText.day("2026-05-01"), "1 мая 2026");
  assert.equal(DateText.dayInYear("2026-11-06", "2026"), "6 нояб.");
  assert.equal(DateText.dayInYear("2025-11-15", "2026"), "15 нояб. 2025");
  assert.equal(DateText.month("2026-10"), "Октябрь 2026");
  assert.equal(DateText.moment("2026-11-15T09:20:00Z", "Asia/Yekaterinburg"), "15 нояб. 2026 в 14:20");
  assert.equal(DateText.day("не дата"), "не дата");
});

const workout = (date: string, name: string, exercise = "bench"): Workout =>
  ({
    id: date + name, name, date, duration: 3600, notes: "", timeZone: "Europe/Saratov",
    exercises: [{ exerciseId: exercise, catalogRevision: 2, sets: [{ id: "s", done: true, warmup: false, weight: 60, reps: 8, rir: 2 }] }],
  }) as unknown as Workout;
const entryName = (e: Workout["exercises"][number]) => e.exerciseId;
const journal = (() => {
  const out: Workout[] = [];
  const types = ["Ноги", "Тяга", "Грудь/Плечи", "Корпус/Кардио"];
  const start = Date.parse("2025-11-15T12:00:00Z");
  for (let i = 0; i < 240; i++)
    out.push(workout(new Date(start + i * 1.5 * 86400000).toISOString().slice(0, 10), types[i % 4], i % 7 === 0 ? "pullup" : "bench"));
  return out.sort((a, b) => b.date.localeCompare(a.date));
})();

test("R05-REQ03/REQ04: история делится на месяцы с годом, отбор по периоду и типу даёт точные числа", () => {
  const groups = HistoryFilter.groups(journal);
  assert.ok(groups.length >= 12);
  assert.equal(groups[0].label.split(" ").length, 2, "заголовок «Месяц ГГГГ»");
  assert.match(groups.at(-1)!.label, /Ноябрь 2025/);
  assert.equal(groups.reduce((n, g) => n + g.items.length, 0), journal.length);
  const oct = HistoryFilter.filter(journal, { ...HistoryFilter.EMPTY, month: "2025-12" }, entryName);
  assert.ok(oct.length > 0 && oct.every((w) => w.date.startsWith("2025-12")));
  const legs = HistoryFilter.filter(journal, { ...HistoryFilter.EMPTY, type: "Ноги" }, entryName);
  assert.equal(legs.length, journal.filter((w) => w.name === "Ноги").length);
  assert.equal(legs.length, 60);
  const both = HistoryFilter.filter(journal, { ...HistoryFilter.EMPTY, month: "2026-01", type: "Ноги" }, entryName);
  assert.equal(both.length, journal.filter((w) => w.date.startsWith("2026-01") && w.name === "Ноги").length);
  const range = HistoryFilter.filter(journal, { ...HistoryFilter.EMPTY, from: "2026-01-10", to: "2026-01-20" }, entryName);
  assert.ok(range.length > 0 && range.every((w) => w.date >= "2026-01-10" && w.date <= "2026-01-20"));
  const types = HistoryFilter.types(journal);
  assert.deepEqual(types.map((t) => t.count), [60, 60, 60, 60]);
});

test("R05-REQ04: поиск понимает «окт», «октябрь 2026», «2026-10», «10.2026», тип и упражнение вместе", () => {
  const find = (text: string) => HistoryFilter.filter(journal, { ...HistoryFilter.EMPTY, text }, entryName);
  const inMonth = (month: string) => journal.filter((w) => w.date.slice(5, 7) === month).length;
  assert.equal(find("окт").length, inMonth("10"));
  assert.equal(find("октябрь").length, inMonth("10"));
  assert.equal(find("октября").length, inMonth("10"));
  assert.equal(find("2026-10").length, journal.filter((w) => w.date.startsWith("2026-10")).length);
  assert.equal(find("10.2026").length, journal.filter((w) => w.date.startsWith("2026-10")).length);
  assert.equal(find("октябрь 2026").length, journal.filter((w) => w.date.startsWith("2026-10")).length);
  assert.equal(find("ноги янв").length, journal.filter((w) => w.name === "Ноги" && w.date.slice(5, 7) === "01").length);
  assert.equal(find("ок").length, 0, "две буквы — слишком мало, месяц не угадывается");
  assert.equal(find("pullup").length, journal.filter((w) => w.exercises[0].exerciseId === "pullup").length);
  assert.equal(HistoryFilter.isActive(HistoryFilter.EMPTY), false);
  assert.equal(HistoryFilter.isActive({ ...HistoryFilter.EMPTY, text: "окт" }), true);
});

test("R05-REQ05: периоды «6 месяцев», «Год», «Всё» считаются по календарю, ось подписана месяцами", () => {
  const now = new Date("2026-11-10T08:00:00Z");
  const tz = "Europe/Saratov";
  assert.equal(ProgressOverview.days("4w", journal, tz, now), 28);
  assert.equal(ProgressOverview.days("12w", journal, tz, now), 84);
  // 10 мая → 10 нояб. включительно: 185 дней.
  assert.equal(ProgressOverview.days("6m", journal, tz, now), 185);
  // Год: 10 нояб. 2025 → 10 нояб. 2026 включительно.
  assert.equal(ProgressOverview.days("year", journal, tz, now), 366);
  const all = ProgressOverview.days("all", journal, tz, now);
  assert.ok(all >= 360 && all <= 370, `«Всё» = ${all} дн.`);

  const overview = ProgressOverview.calculate(journal, all, tz, now);
  assert.equal(overview.workouts, journal.length, "240 тренировок за всё время");
  assert.equal(overview.days, all);
  const weeks = ProgressOverview.weekly(overview.current, overview.start, overview.end, tz, now);
  assert.ok(weeks.length >= 52 && weeks.length <= 54);
  assert.equal(weeks.reduce((n, w) => n + w.workouts, 0), 240);
  const axis = ProgressOverview.axis(weeks);
  assert.ok(axis.length >= 12);
  assert.match(axis[0].text, /\d{4}$/, "первая подпись с годом");
  assert.ok(axis.some((l) => /янв\.? 2026$|янв 2026$/.test(l.text)), "у января подпись с годом");
  assert.ok(axis.every((l, i, all) => i === 0 || l.index > all[i - 1].index));
  // Год короче «Всё» не режет тренировки внутри окна и считает меньше, чем всё время.
  const year = ProgressOverview.calculate(journal, 366, tz, now);
  assert.ok(year.workouts <= journal.length);
  assert.equal(year.totalWeeks, 53);
});

// ---------- REQ02 ----------
import { PersonalExerciseFactory } from "../server/PersonalExerciseFactory";
import { PersonalExerciseMarking } from "../src/domain/PersonalExerciseMarking";
import { MuscleCoverage } from "../src/domain/MuscleCoverage";
import { TrainingAnalytics } from "../src/domain/TrainingAnalytics";
import { exerciseCatalog } from "../src/lib/catalog";
import { RestorePlan } from "../src/domain/RestorePlan";

const customBody = (familyId: string, name: string, extra: Record<string, unknown> = {}) => ({
  familyId, name, nameEn: "", aliases: [name], notes: "", equipment: "bodyweight", declaredZones: [], origin: "strong",
  recording: { type: "reps", loadMode: "bodyweight", implementCount: 1, laterality: "bilateral" }, ...extra,
});
const crunchWorkout = (id: string, date: string, exercise: Exercise): Workout =>
  ({
    id, name: "Корпус", date, duration: 1800, notes: "", timeZone: "Europe/Saratov",
    exercises: [{
      exerciseId: exercise.id, catalogRevision: 3, externalDefinition: exercise, displayNameSnapshot: exercise.name,
      sets: [1, 2, 3].map((n) => ({ id: `${id}-${n}`, done: true, warmup: false, weight: 0, reps: 15, rir: 2, ...(exercise.recording.type === "duration" ? { reps: 1, durationSeconds: 45 } : {}) })),
    }],
  }) as unknown as Workout;

test("R05-REQ02: «Мои» без мышц видны как «не учтено», а группа или упражнение каталога возвращают подходы в «Пресс»", async () => {
  const factory = new PersonalExerciseFactory();
  const bare = await factory.create(customBody("fam-cable-crunch", "Cable Crunch"));
  const plank = await factory.create(customBody("fam-plank", "Plank", { recording: { type: "duration", loadMode: "bodyweight", implementCount: 1, laterality: "bilateral" } }));
  const week = [crunchWorkout("w1", "2026-10-20", bare), crunchWorkout("w2", "2026-10-22", bare), crunchWorkout("w3", "2026-10-24", plank)];
  exerciseCatalog.adoptFamilies([bare, plank]);
  const options = { timeZone: "Europe/Saratov", now: new Date("2026-11-10T08:00:00Z") };
  const core = (workouts: Workout[]) => new TrainingAnalytics(workouts, options).zoneLoad().find((m) => m.id === "core")!.direct;
  assert.equal(core(week), 0, "без разметки «Пресс» = 0");
  const before = MuscleCoverage.report(week, options);
  assert.equal(before.exercises, 2);
  assert.equal(before.sets, 9);
  assert.equal(MuscleCoverage.unmarkedPersonal([bare, plank]).length, 2);

  // Массовая разметка: одна группа — всем выбранным; «на время» привязать к движению каталога нельзя, группа — можно.
  assert.equal(PersonalExerciseMarking.canBaseOn(plank), false);
  const zonePayload = PersonalExerciseMarking.payload(plank, { zones: ["core"] });
  assert.equal(zonePayload.origin, "strong", "происхождение импорта не теряется");
  assert.equal(zonePayload.basedOnExerciseId, "");
  const plankMarked = await factory.create(zonePayload);
  assert.equal(plankMarked.custom?.familyId, "fam-plank");
  assert.notEqual(plankMarked.id, plank.id, "правка — новая версия того же семейства");
  const basePayload = PersonalExerciseMarking.payload(bare, { basedOn: "crunch" });
  assert.equal(basePayload.basedOnExerciseId, "crunch");
  const bareMarked = await factory.create(basePayload);
  assert.ok(bareMarked.primary.includes("core"));
  assert.equal(bareMarked.custom?.origin, "strong");

  // Старая история (снимок без мышц) подхватывает актуальную версию семьи.
  exerciseCatalog.adoptFamilies([bareMarked, plankMarked]);
  assert.ok(core(week) > 0, `«Пресс» после разметки: ${core(week)}`);
  assert.equal(MuscleCoverage.report(week, options).sets, 0);
  // Группа и каталог не меняют правило записи и название.
  assert.equal(bareMarked.name, "Cable Crunch");
  assert.equal(bareMarked.recording.loadMode, "bodyweight");
  exerciseCatalog.adoptFamilies([]);
});

// ---------- REQ06 ----------
test("R05-REQ06: восстановление говорит «Новых · Уже есть · Отличаются» и «Ничего нового: все 240 тренировок уже в аккаунте»", () => {
  const data = yearFile();
  const existing = data.workouts.map((w, i) => ({
    id: `acc-${i}`, name: w.name, date: w.date, duration: w.duration, notes: "", exercises: w.exercises.map((e) => ({ exerciseId: e.exerciseId ?? e.sourceName, sets: e.sets })),
  })) as unknown as Workout[];
  const incoming = data.workouts.map((w, i) => ({ ...w, nativeId: `acc-${i}`, exercises: w.exercises.map((e) => ({ ...e, exerciseId: e.exerciseId ?? e.sourceName })) }));
  const same = RestorePlan.workouts(incoming, existing);
  assert.deepEqual(same, { total: 240, added: 0, same: 240, differs: 0 });
  assert.equal(RestorePlan.words(same), "Новых 0 · Уже есть 240 · Отличаются 0");
  assert.equal(
    RestorePlan.nothingNew(same, [RestorePlan.favorites(["a"], ["a"]), RestorePlan.routines([], [])]),
    "Ничего нового: все 240 тренировок уже в аккаунте",
  );
  // Новая тренировка и изменённая — считаются отдельно, и «ничего нового» пропадает.
  const mixed = [...incoming.slice(0, 238), { ...incoming[238], date: "2026-11-09" }, { ...incoming[239], nativeId: "acc-new" }];
  const tally = RestorePlan.workouts(mixed, existing);
  assert.deepEqual(tally, { total: 240, added: 1, same: 238, differs: 1 });
  assert.equal(RestorePlan.nothingNew(tally, []), "");
  // Остальное тоже считается теми же словами.
  assert.equal(RestorePlan.words(RestorePlan.favorites(["a", "b", "c"], ["a"])), "Новых 2 · Уже есть 1 · Отличаются 0");
  assert.match(RestorePlan.nothingNew({ total: 5, added: 0, same: 4, differs: 1 }, []), /Ничего нового: все 5 тренировок уже есть в аккаунте \(1 отличаются/);
  assert.equal(RestorePlan.nothingNew({ total: 5, added: 0, same: 5, differs: 0 }, [{ total: 2, added: 1, same: 1, differs: 0 }]), "", "новые программы — это не «ничего нового»");
});

// ---------- REQ07 ----------
test("R05-REQ07: время операции в баннере отмены — «15 нояб. в 13:20», год только у чужого года", () => {
  assert.equal(DateText.moment("2026-11-15T09:20:00Z", "Asia/Yekaterinburg", "2026"), "15 нояб. в 14:20");
  assert.equal(DateText.moment("2025-11-15T09:20:00Z", "Asia/Yekaterinburg", "2026"), "15 нояб. 2025 в 14:20");
  assert.equal(DateText.moment("2026-11-15T09:20:00Z", "Asia/Yekaterinburg"), "15 нояб. 2026 в 14:20");
});

// ---------- REQ01 на настоящем воркере: годовой файл целиком ----------
async function worker() {
  const mf = new Miniflare(convertV4MiniflareOptions({
    workers: [{ modules: true, scriptPath: "dist/server/index.js", compatibilityDate: "2025-09-27", d1Databases: ["DB"] }],
    cf: false,
  }));
  const db = await mf.getD1Database("DB");
  for (const file of (await readdir("drizzle")).filter((p) => p.endsWith(".sql")).sort())
    for (const statement of (await readFile("drizzle/" + file, "utf8")).split("--> statement-breakpoint").filter((x) => x.trim()))
      await db.prepare(statement.trim()).run();
  const base = "http://localhost";
  const headers = (cookie = "") => ({ "oai-authenticated-user-id": "owner", Cookie: cookie, Origin: base, "Content-Type": "application/json" });
  const reg = await mf.dispatchFetch(base + "/api/auth/register", { method: "POST", headers: headers(),
    body: JSON.stringify({ email: "owner@example.test", password: "test account passphrase", displayName: "owner", timeZone: "Europe/Saratov" }) });
  const cookie = reg.headers.get("Set-Cookie")!.split(";")[0];
  const raw = (path: string, method = "GET", body?: unknown) =>
    mf.dispatchFetch(base + path, { method, headers: headers(cookie), body: body === undefined ? undefined : JSON.stringify(body) });
  const client = {
    async request<T>(path: string, method = "GET", body?: unknown): Promise<T> {
      const response = await raw(path, method, body);
      const data = (await response.json()) as T & { error?: string };
      if (!response.ok) throw new ApiError(data.error ?? "Не удалось выполнить запрос", response.status, {});
      return data;
    },
  };
  return { mf, client, raw };
}
const memoryStore = () => {
  const data = new Map<string, string>();
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), removeItem: (k: string) => void data.delete(k), key: (i: number) => [...data.keys()][i] ?? null, get length() { return data.size; } };
};

test("R05-REQ01: годовой файл на воркере — «Мои» не больше 12, названия из ТЗ не остаются английскими, «Подтягивания» одной записью", async () => {
  const { mf, client, raw } = await worker();
  try {
    const data = yearFile();
    const verdicts = ImportNameMatcher.classifyAll(data.exerciseNames, {}, new Set(ImportNameMatcher.weights(data).keys()));
    // Пользователь решает часть спорных: берёт первое предложенное для явно подходящих.
    const choices: Record<string, string> = {
      "Walking Lunge (Dumbbell)": "lunge-reverse", "Cable Crunch": "crunch", "Chest Fly (Dumbbell)": "fly", "Close Grip Bench Press (Barbell)": "bench",
    };
    const prepared = ImportNameMatcher.prepare(data, {
      choiceFor: (name) => choices[name] ?? (["matched", "variant"].includes(verdicts[name].kind) ? verdicts[name].exercise!.id : ""),
      find: (id) => exerciseById(id),
      verdicts,
    });
    const service = new ImportService(client as never, () => memoryStore());
    const started = Date.now();
    const result = await service.import(prepared, () => undefined, { replace: true });
    const seconds = (Date.now() - started) / 1000;
    assert.equal(result.imported, 240);
    assert.ok(seconds < 30, `импорт годового файла: ${seconds} с`);
    const product = (await (await raw("/api/product")).json()) as { customExercises: Exercise[] };
    const mine = product.customExercises.map((e) => e.name);
    assert.ok(mine.length <= 12, `«Мои» после импорта: ${mine.length} (${mine.join(", ")})`);
    for (const english of ["Pull Up", "Lat Pulldown (Cable)", "Hanging Leg Raise", "Leg Press (Machine)", "Face Pull (Cable)", "Calf Raise (Machine)", "Back Extension"])
      assert.ok(!mine.includes(english), `${english} не должно стать «Моим»`);
    const journal = ((await (await raw("/api/data")).json()) as { workouts: Workout[] }).workouts;
    const pullEntries = journal.flatMap((w) => w.exercises).filter((e) => e.exerciseId.startsWith("pullup"));
    assert.ok(pullEntries.length > 10, "история подтягиваний лежит в каталоге");
    // В файле у «Pull Up» есть доп. вес, поэтому вся история — одна запись «с дополнительным весом».
    assert.equal(new Set(pullEntries.map((e) => e.exerciseId)).size, 1, "подтягивания — одна запись, а не две");
    // Машинам из файла поставлена метка, а не ошибка «Укажи тренажёр».
    const press = journal.flatMap((w) => w.exercises).find((e) => e.exerciseId === "legpress");
    assert.equal(press?.equipmentNote, "Из файла (Machine)");
    // Вес у «только вес тела» не пропал молча: максимум записан в заметку.
    const back = journal.flatMap((w) => w.exercises).find((e) => e.exerciseId === "back-extension");
    assert.match(back?.equipmentNote ?? "", /Доп\. вес в файле до 2.5 кг не учтён/);
  } finally {
    await mf.dispose();
  }
});
