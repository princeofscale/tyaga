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
  ({ ...exerciseById("pushup"), id, name, nameEn: name, catalogRevision: 3, source: { provider: "wger" } }) as unknown as Exercise;

test("R05-REQ01: годовой файл Strong — названия узнаются как упражнения каталога, а не десятки «Моих»", () => {
  const data = yearFile();
  assert.equal(data.workouts.length, 240);
  assert.equal(data.exerciseNames.length, 52);
  // Точные ответы базы упражнений (их отдаёт сервер /api/exercises/resolve).
  const wger = {
    Plank: [{ ...wgerLike("wger:plank", "Планка"), recording: { ...exerciseById("pushup")!.recording, type: "duration" as const, loadMode: "bodyweight" as const } } as Exercise],
    Dip: [wgerLike("wger:dip", "Отжимания на брусьях")],
    "Kettlebell Swing": [wgerLike("wger:swing", "Мах гирей")],
    "Farmers Walk (Dumbbell)": [wgerLike("wger:farmers", "Прогулка фермера")],
    "Good Morning (Barbell)": [wgerLike("wger:gm", "Наклоны со штангой")],
  };
  // Как в приложении: ответы базы регистрируются в каталоге до расчёта выбора.
  exerciseCatalog.register(Object.values(wger).flat());
  const verdicts = ImportNameMatcher.classifyAll(data.exerciseNames, wger, new Set(ImportNameMatcher.weights(data).keys()));
  const types = ImportNameMatcher.types(data);
  const defaults = ImportNameMatcher.summary(verdicts);
  assert.equal(defaults.total, 52);
  assert.ok(defaults.matched >= 35, `сопоставлено ${defaults.matched} из 52`);
  // Близкие, но другие движения не применяются молча: Sumo Deadlift, Shrug (Dumbbell), Skullcrusher, Chin Up — вопрос.
  for (const name of ["Sumo Deadlift (Barbell)", "Shrug (Dumbbell)", "Skullcrusher (Barbell)", "Chin Up", "Arnold Press (Dumbbell)", "Pec Deck (Machine)"]) {
    assert.equal(verdicts[name].kind, "ask", name);
    assert.equal(verdicts[name].related, true, name);
    assert.equal(verdicts[name].exercise, null, name);
  }
  // Одним касанием («Принять близкие движения») «Мои» остаются ≤12: считаем, как предпросмотр.
  const related = data.exerciseNames.filter((n) => verdicts[n].related);
  assert.equal(related.length, 6);
  const accepted = Object.fromEntries(related.map((n) => [n, verdicts[n].candidates[0].id]));
  const choose = (name: string) => {
    const raw = name in accepted ? accepted[name] : ["matched", "variant"].includes(verdicts[name].kind) ? verdicts[name].exercise!.id : "";
    return raw && ImportNameMatcher.usable(exerciseById(raw), types.get(name)) ? raw : "";
  };
  const summary = ImportNameMatcher.summary(
    verdicts,
    Object.fromEntries(data.exerciseNames.filter((n) => n in accepted || ["matched", "variant"].includes(verdicts[n].kind)).map((n) => [n, choose(n)])),
  );
  assert.ok(summary.toDecide + summary.own <= 12, `останется «Моими»: ${summary.toDecide + summary.own}`);
  // Chin Up с весом в файле принимается как «Подтягивания с дополнительным весом» — в один ряд с Pull Up.
  assert.equal(verdicts["Chin Up"].candidates[0].id, "pullup-weighted");
  // «Планка» в базе — на время, а в файле повторы: честно «отдельная запись», а не «сопоставлено».
  assert.equal(types.get("Plank"), "reps");
  assert.equal(choose("Plank"), "");
  assert.ok(!ImportNameMatcher.usable(exerciseById("pushup"), "duration"));
  const id = (name: string) => verdicts[name].exercise?.id;
  assert.equal(id("Pull Up"), "pullup-weighted"); // в файле у Pull Up есть вес — вся история одним рядом «с доп. весом»
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
  const verdicts = ImportNameMatcher.classifyAll(["Hack Squat (Machine)", "Zercher Carry", "Close Grip Bench Press (Barbell)", "Deadlift", "Overhead Press"]);
  assert.equal(verdicts["Hack Squat (Machine)"].kind, "ask");
  assert.ok(verdicts["Hack Squat (Machine)"].candidates.length > 0);
  assert.equal(verdicts["Hack Squat (Machine)"].exercise, null);
  // Без оборудования «Deadlift» и «Overhead Press» — только предложение, штанга не угадывается.
  assert.equal(verdicts.Deadlift.kind, "ask");
  assert.equal(verdicts["Overhead Press"].kind, "ask");
  // В каталоге и базе ничего похожего — отдельная запись.
  assert.equal(verdicts["Zercher Carry"].kind, "own");
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
    const types = ImportNameMatcher.types(data);
    // Пользователь принимает близкие движения одним касанием и решает ещё часть спорных вручную.
    const choices: Record<string, string> = {
      "Walking Lunge (Dumbbell)": "lunge-reverse", "Cable Crunch": "crunch", "Chest Fly (Dumbbell)": "fly", "Close Grip Bench Press (Barbell)": "bench",
      ...Object.fromEntries(data.exerciseNames.filter((n) => verdicts[n].related).map((n) => [n, verdicts[n].candidates[0].id])),
    };
    const choiceFor = (name: string) => {
      const raw = name in choices ? choices[name] : ["matched", "variant"].includes(verdicts[name].kind) ? verdicts[name].exercise!.id : "";
      return raw && ImportNameMatcher.usable(exerciseById(raw), types.get(name)) ? raw : "";
    };
    const summary = ImportNameMatcher.summary(
      verdicts,
      Object.fromEntries(data.exerciseNames.filter((n) => n in choices || ["matched", "variant"].includes(verdicts[n].kind)).map((n) => [n, choiceFor(n)])),
    );
    const prepared = ImportNameMatcher.prepare(data, { choiceFor, find: (id) => exerciseById(id), verdicts });
    const service = new ImportService(client as never, () => memoryStore());
    const started = Date.now();
    const result = await service.import(prepared, () => undefined, { replace: true });
    const seconds = (Date.now() - started) / 1000;
    assert.equal(result.imported, 240);
    assert.ok(seconds < 30, `импорт годового файла: ${seconds} с`);
    const product = (await (await raw("/api/product")).json()) as { customExercises: Exercise[] };
    const mine = product.customExercises.map((e) => e.name);
    assert.ok(mine.length <= 12, `«Мои» после импорта: ${mine.length} (${mine.join(", ")})`);
    // Предпросмотр = итог: счётчик «нужно решить + отдельные записи» совпадает с числом «Моих».
    assert.equal(mine.length, summary.toDecide + summary.own);
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

// ---------- Доработка по QA ----------
test("QA-R05-01: «Активных недель» и «Пустых недель» считают одни календарные недели (годовой файл)", () => {
  const data = yearFile();
  const verdicts = ImportNameMatcher.classifyAll(data.exerciseNames);
  const prepared = ImportNameMatcher.prepare(data, {
    choiceFor: (n) => (["matched", "variant"].includes(verdicts[n].kind) ? verdicts[n].exercise!.id : ""),
    find: (id) => exerciseById(id),
    verdicts,
  });
  const journalYear = prepared.workouts.map((source, i) => ({
    id: `y-${i}`, name: source.name, date: source.date, duration: source.duration, notes: "", timeZone: "Europe/Saratov",
    exercises: source.exercises.filter((e) => e.exerciseId).map((e) => ({
      exerciseId: e.exerciseId!, catalogRevision: e.catalogRevision ?? 2, displayNameSnapshot: e.displayName,
      sets: e.sets.map((x, n) => ({ ...x, id: `y-${i}-${e.exerciseId}-${n}` })),
    })),
  })) as unknown as Workout[];
  const now = new Date("2026-11-10T08:00:00Z");
  const tz = "Europe/Saratov";
  for (const days of [366, ProgressOverview.days("all", journalYear, tz, now)]) {
    const overview = ProgressOverview.calculate(journalYear, days, tz, now);
    const weeks = ProgressOverview.weekly(overview.current, overview.start, overview.end, tz, now);
    const empty = weeks.filter((w) => !w.workouts).length;
    assert.equal(overview.totalWeeks, weeks.length, "«из N» = число столбцов графика");
    assert.equal(overview.activeWeeks, weeks.length - empty, "активные = столбцы с тренировками");
    assert.ok(overview.activeWeeks >= 48);
  }
  const year = ProgressOverview.calculate(journalYear, 366, tz, now);
  assert.equal(year.totalWeeks, 53);
  assert.ok(year.activeWeeks >= 51 && year.activeWeeks <= 52, `активных недель ${year.activeWeeks} из 53`);
});

test("QA-R05-06: поиск по дню — «20 янв», «20 янв 2026», «20.01.2026», «2026-01-20», «20.01»", () => {
  const find = (text: string) => HistoryFilter.filter(journal, { ...HistoryFilter.EMPTY, text }, entryName);
  const day = journal.find((w) => w.date.startsWith("2026-01"))!.date;
  const [y, m, d] = day.split("-");
  const monthWord = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"][+m - 1];
  const expected = journal.filter((w) => w.date === day).length;
  assert.ok(expected >= 1);
  for (const text of [`${+d} ${monthWord}`, `${+d} ${monthWord} ${y}`, `${d}.${m}.${y}`, day, `${+d}.${m}`])
    assert.deepEqual(find(text).map((w) => w.date), journal.filter((w) => w.date === day).map((w) => w.date), text);
  assert.equal(find(`${+d} ${monthWord}`).length, journal.filter((w) => +w.date.slice(8) === +d && w.date.slice(5, 7) === m).length);
});

test("QA-R05-09: копия с чужим полем format не принимается, обычные копии Тяги — да", () => {
  const importer = new WorkoutImport({ dateOrder: "dmy", weightUnit: "kg", distanceUnit: "km", timeZone: "UTC" });
  const copy = (format?: unknown) => JSON.stringify({ ...(format === undefined ? {} : { format }), version: 5, workouts: [], favorites: ["bench"] });
  assert.doesNotThrow(() => importer.parse(copy("tyaga-backup"), "tyaga"));
  assert.doesNotThrow(() => importer.parse(copy(), "tyaga"));
  assert.throws(() => importer.parse(copy("strong"), "tyaga"), /не поддерживаемый экспорт Тяги/);
  assert.throws(() => importer.parse(copy(42), "tyaga"), /не поддерживаемый экспорт Тяги/);
});

test("QA-R05-03: упражнение каталога без мышц размечается своей копией, «не учтено» исчезает, история подхватывает мышцы", async () => {
  const gap = { ...exerciseById("pushup")!, id: "wger:919", name: "Тяга Т-грифа — вариант", nameEn: "T-bar row", primary: [], secondary: [], muscles: [], catalogRevision: 3, source: { provider: "wger" } } as unknown as Exercise;
  exerciseCatalog.register([gap]);
  const entry = (id: string, date: string): Workout => ({
    id, name: "Тяга", date, duration: 40, notes: "", timeZone: "Europe/Saratov",
    exercises: [{ exerciseId: "wger:919", catalogRevision: 3, displayNameSnapshot: gap.name, sets: [1, 2, 3, 4].map((n) => ({ id: `${id}${n}`, weight: 40, reps: 8, rir: 2, warmup: false, done: true })) }],
  }) as unknown as Workout;
  const week = [entry("t1", "2026-10-20")];
  const options = { timeZone: "Europe/Saratov", now: new Date("2026-11-10T08:00:00Z") };
  exerciseCatalog.adoptFamilies([]);
  assert.equal(MuscleCoverage.catalogGaps(week, options).map((e) => e.id).join(), "wger:919");
  assert.equal(MuscleCoverage.report(week, options).sets, 4);
  const back = () => new TrainingAnalytics(week, options).zoneLoad().find((m) => m.id === "back")!.direct;
  assert.equal(back(), 0);
  // Копия: то же название и правило записи, происхождение указывает на каталожное упражнение; мышцы — из «Тяга горизонтального блока».
  const payload = PersonalExerciseMarking.copyPayload(gap, { basedOn: "row" }, "copy-fam-1");
  assert.equal(payload.origin, "catalog:wger:919");
  const copy = await new PersonalExerciseFactory().create(payload);
  assert.equal(copy.name, gap.name);
  assert.ok(copy.primary.includes("back"));
  exerciseCatalog.adoptFamilies([copy]);
  assert.equal(MuscleCoverage.catalogGaps(week, options).length, 0, "после разметки «Не учтено» нет");
  assert.equal(MuscleCoverage.report(week, options).sets, 0);
  assert.ok(back() > 0);
  // Группа без движения тоже работает; «на время» можно разметить только группой.
  const byZone = await new PersonalExerciseFactory().create(PersonalExerciseMarking.copyPayload(gap, { zones: ["back"] }, "copy-fam-2"));
  exerciseCatalog.adoptFamilies([byZone]);
  assert.ok(back() > 0);
  exerciseCatalog.adoptFamilies([]);
  assert.equal(back(), 0, "без копии каталог остаётся как был — ничего не подменяется");
});

test("QA-R05-04: массовая разметка не переписывает размеченное молча — делит на «размечено» и «без разметки»", async () => {
  const factory = new PersonalExerciseFactory();
  const fresh = await factory.create(customBody("fam-fresh", "Cable Crunch"));
  const chest = await factory.create(customBody("fam-dip", "Dip", { declaredZones: ["chest"] }));
  const based = await factory.create(customBody("fam-based", "Strange Row", { basedOnExerciseId: "row" }));
  const { marked, unmarked } = PersonalExerciseMarking.split([fresh, chest, based]);
  assert.deepEqual(marked.map((e) => e.name), ["Dip", "Strange Row"]);
  assert.deepEqual(unmarked.map((e) => e.name), ["Cable Crunch"]);
  // Замена возможна, но только явно: payload чужую группу не добавляет сам.
  assert.deepEqual(PersonalExerciseMarking.payload(chest, { zones: ["core"] }).declaredZones, ["core"]);
});
