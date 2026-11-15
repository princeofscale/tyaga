import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DecimalInput } from "../src/domain/DecimalInput";
import { DeloadPlan } from "../src/domain/DeloadPlan";
import { DeloadEngine, DELOAD_PRESETS } from "../src/domain/DeloadEngine";
import { OneRepMaxFormulas } from "../src/domain/OneRepMaxFormulas";
import { TimeZoneChoices } from "../src/domain/TimeZoneChoices";
import { TrainingProgram } from "../src/domain/TrainingProgram";
import { WarmupLadderCalculator } from "../src/domain/WarmupLadderCalculator";
import { MUSCLES } from "../src/data/muscles";
import { ExerciseSearchRank } from "../src/domain/ExerciseSearchRank";
import { normalizeSearch } from "../src/lib/search";
import { estimatedOneRepMax, exerciseById, exerciseCatalog, makeWorkout } from "../src/lib/model";
import type { Routine, Workout } from "../src/lib/types";
import OneRepMaxCalculator from "../src/components/OneRepMaxCalculator";
import PlateCalculator from "../src/components/PlateCalculator";
import { WarmupModal } from "../src/components/WarmupModal";

const memory = () => {
  const map = new Map<string, string>();
  return { map, storage: { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v), removeItem: (k: string) => void map.delete(k) } };
};

test("R04-REQ01: набранное число читается как есть (запятая или точка), пустое допустимо, границы — подсказка, не подмена", () => {
  assert.equal(DecimalInput.parse("77.5"), 77.5);
  assert.equal(DecimalInput.parse("77,5"), 77.5);
  assert.equal(DecimalInput.parse("77,"), 77);
  assert.equal(DecimalInput.parse(""), null);
  assert.equal(DecimalInput.parse(","), null);
  assert.equal(DecimalInput.parse("1e3"), null);
  // Посимвольный набор «77.5» не превращается в 205: «7» → минимум, «77» → 77, «77.» → 77, «77.5» → 77,5.
  const bounds = { min: 20, max: 400, unit: "кг" };
  let typed = "";
  const seen: Array<number | null> = [];
  for (const ch of "77.5") {
    typed = DecimalInput.sanitize(typed + ch);
    seen.push(DecimalInput.read(typed, bounds).value);
  }
  assert.deepEqual(seen, [20, 77, 77, 77.5]);
  assert.equal(typed, "77.5", "в поле остаётся ровно набранный текст");
  assert.equal(DecimalInput.read("7", bounds).hint, "Минимум 20 кг: считаю для него");
  assert.equal(DecimalInput.read("700", bounds).value, 400);
  assert.equal(DecimalInput.read("", bounds).value, null, "пустое поле не превращается в 20");
  assert.equal(DecimalInput.read("100", bounds).value, 100);
  assert.equal(DecimalInput.sanitize("1 0a0,5,5"), "100,55", "лишние символы и второй разделитель отброшены, два знака после запятой");
});

test("R04-REQ01/06: лесенка для 77,5 и для 100 строится от введённого значения, числа — с запятой", () => {
  const ladder = WarmupLadderCalculator.generateLadder(77.5, 6, 20);
  assert.equal(ladder.at(-1)?.weightKg, 77.5);
  assert.equal(WarmupLadderCalculator.generateLadder(100, 6, 20).at(-1)?.weightKg, 100);
  assert.doesNotMatch(WarmupLadderCalculator.formatPlates(77.5, 20), /\d\.\d/);
  assert.match(WarmupLadderCalculator.formatPlates(77.5, 20), /2,5|1,25/);
  assert.equal(DecimalInput.format(28.75), "28,75");
  assert.equal(DecimalInput.format(67.5), "67,5");
  assert.equal(DecimalInput.format(100), "100");
  assert.equal(DecimalInput.format(80.6, 1), "80,6");
});

test("R04-REQ05/06: калькуляторы показывают десятичную запятую и по умолчанию 1ПМ по Эпли", () => {
  const orm = renderToStaticMarkup(createElement(OneRepMaxCalculator, { initialWeight: 77.5, initialReps: 8 }));
  assert.match(orm, /orm-hero-digits">98,2</);
  assert.match(orm, /Epley \(основная\)/);
  assert.doesNotMatch(orm, /orm-hero-digits">\d+\.\d/);
  const plates = renderToStaticMarkup(createElement(PlateCalculator, { initialWeight: 77.5, onClose: () => {} }));
  assert.match(plates, /<b>28,75 кг<\/b>/);
  assert.equal((plates.match(/aria-label="Закрыть"/g) ?? []).length, 0, "в окне блинов нет второго крестика");
  const warm = renderToStaticMarkup(createElement(WarmupModal, { defaultWeight: 77.5, defaultReps: 6, onClose: () => {} }));
  assert.match(warm, /value="77,5"/);
  assert.doesNotMatch(warm, /\d\.\d кг/);
});

test("R04-REQ06: Эпли в калькуляторе = Эпли в «Прогрессе» (100×8 → 126,7; 77,5×8 → 98,2), единая формула", () => {
  assert.equal(OneRepMaxFormulas.round(OneRepMaxFormulas.epley(100, 8)), 126.7);
  assert.equal(OneRepMaxFormulas.round(OneRepMaxFormulas.epley(77.5, 8)), 98.2);
  assert.equal(OneRepMaxFormulas.epley(100, 1), 100);
  const w: Workout = makeWorkout(["bench"], [], "UTC", true);
  const set = { ...w.exercises[0].sets[0], weight: 77.5, reps: 8, done: true, warmup: false };
  const analytic = estimatedOneRepMax(set, { ...w.exercises[0], sets: [set] });
  assert.equal(OneRepMaxFormulas.round(analytic ?? 0), 98.2, "аналитика и калькулятор считают одним и тем же кодом");
});

const routine = (name: string): Routine => ({
  ...TrainingProgram.empty(), name,
  exercises: makeWorkout(["bench", "squat"], [], "UTC", true).exercises.map((e) => ({
    ...e,
    sets: e.sets.map((s) => ({ ...s, weight: 80, reps: 8 })),
  })),
});

test("R04-REQ02: разгрузка применяется к программам с сообщением, хранится на неделю, отменяется; программы не меняются", () => {
  const { map, storage } = memory();
  const plan = new DeloadPlan(() => storage, "a1");
  const none = plan.apply("volume", "2026-11-10", []);
  assert.equal(none.applied, false);
  assert.match(none.message, /Нечего менять: нет сохранённых программ/);
  assert.equal(map.size, 0, "без программ ничего не сохраняется");
  const routines = [routine("Верх тела"), routine("Низ тела")];
  const applied = plan.apply("volume", "2026-11-10", routines);
  assert.ok(applied.applied);
  assert.equal(applied.message, "Разгрузка на неделю: 85% веса, 50% подходов — применена к программам Верх тела, Низ тела.");
  assert.equal(plan.read("2026-11-16")?.mode, "volume", "семь дней с момента нажатия включительно");
  assert.equal(plan.read("2026-11-17"), null, "на следующей неделе разгрузки нет");
  assert.equal(map.size, 0, "просроченная разгрузка стёрта");
  assert.ok(plan.apply("volume", "2026-11-10", routines).applied);
  const base = new TrainingProgram(routines[0]).start([], "UTC", "2026-11-10");
  const reduced = DeloadPlan.workout(base, plan.read("2026-11-10"));
  const baseSets = base.exercises.reduce((n, e) => n + e.sets.filter((s) => !s.warmup).length, 0);
  const reducedSets = reduced.exercises.reduce((n, e) => n + e.sets.filter((s) => !s.warmup).length, 0);
  assert.ok(reducedSets < baseSets, `подходов меньше: ${reducedSets} < ${baseSets}`);
  assert.equal(reduced.exercises[0].sets[0].weight, 67.5, "80 кг × 85% с шагом 2,5");
  assert.match(reduced.name, /\[Разгрузка\]/);
  assert.equal(reduced.id, base.id, "id тренировки — от запуска, не от шаблона разгрузки");
  assert.equal(routines[0].exercises[0].sets[0].weight, 80, "сама программа не изменена");
  plan.cancel();
  assert.equal(plan.read("2026-11-10"), null, "«Отменить» снимает пометку");
  assert.equal(DeloadPlan.workout(base, null), base, "без пометки запуск как раньше");
  assert.equal(DeloadPlan.workout(base, { mode: "volume", from: "a", until: "b", programs: [] }, true), base, "своя разгрузочная неделя цикла второй раз не уменьшается");
  assert.equal(new DeloadPlan(() => { throw new Error("blocked"); }, "a1").apply("volume", "2026-11-10", routines).applied, false);
});

test("R04-REQ02: рекомендация формата не противоречит оценке объёма", () => {
  const idle = DeloadEngine.assessFatigue([], new Date("2026-11-10T12:00:00Z"), "UTC");
  assert.equal(idle.recommendedMode, null, "нет записанной работы — формат не «рекомендован»");
  const few = makeWorkout(["bench"], [], "UTC", true);
  few.date = "2026-11-09";
  few.exercises[0].sets = few.exercises[0].sets.map((s) => ({ ...s, weight: 60, reps: 8, done: true }));
  const small = DeloadEngine.assessFatigue([few], new Date("2026-11-10T12:00:00Z"), "UTC");
  assert.equal(small.statusLabel, "Небольшой записанный объём");
  assert.equal(small.recommendedMode, null, "«Небольшой объём» — не «Рекомендована разгрузка»");
  assert.match(small.reason, /Формат ниже выбери сам/);
  assert.ok(DELOAD_PRESETS.volume && DELOAD_PRESETS.intensity && DELOAD_PRESETS.recovery);
});

test("R04-REQ08: у группы мышц одно название на всех экранах, часовой пояс — «Саратов, UTC+4»", () => {
  for (const m of MUSCLES) assert.equal(m.name, m.short, `у «${m.id}» одно название`);
  const names = Object.fromEntries(MUSCLES.map((m) => [m.id, m.name]));
  assert.equal(names.biceps, "Сгибатели рук");
  assert.equal(names.calves, "Икры");
  assert.equal(names.core, "Пресс");
  assert.equal(names.hamstrings, "Задняя часть бедра");
  const now = new Date("2026-11-10T12:00:00Z");
  assert.equal(TimeZoneChoices.label("Europe/Saratov", now), "Саратов, UTC+4");
  assert.equal(TimeZoneChoices.label("UTC", now), "UTC, всемирное время");
  assert.equal(TimeZoneChoices.label("Asia/Kolkata", now), "Asia/Kolkata, UTC+5:30");
  const list = TimeZoneChoices.list(["Asia/Kolkata", "Europe/Saratov"], now);
  assert.equal(list[0].id, "Asia/Kolkata", "свой пояс вне списка добавлен сверху");
  assert.ok(list.some((c) => c.id === "Europe/Saratov" && c.label === "Саратов, UTC+4"));
  assert.equal(list.filter((c) => c.id === "Europe/Saratov").length, 1);
  assert.ok(exerciseById("bench"));
});

async function sandbox(email = "r4@example.test") {
  const mf = new Miniflare(convertV4MiniflareOptions({
    workers: [{ modules: true, scriptPath: "dist/server/index.js", compatibilityDate: "2025-09-27", d1Databases: ["DB"] }],
    cf: false,
  }));
  const db = await mf.getD1Database("DB");
  for (const file of (await readdir("drizzle")).filter((p) => p.endsWith(".sql")).sort())
    for (const statement of (await readFile("drizzle/" + file, "utf8")).split("--> statement-breakpoint").filter((s) => s.trim()))
      await db.prepare(statement.trim()).run();
  const base = "http://localhost";
  const owner = "user-r4";
  const headers = (cookie = "") => ({ "oai-authenticated-user-id": owner, Origin: base, "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) });
  const reg = await mf.dispatchFetch(base + "/api/auth/register", {
    method: "POST", headers: headers(),
    body: JSON.stringify({ email, password: "test account passphrase", displayName: owner, timeZone: "UTC" }),
  });
  const { recoveryCode } = (await reg.json()) as { recoveryCode: string };
  const cookie = reg.headers.get("Set-Cookie")!.split(";")[0];
  const request = (path: string, method = "GET", body?: unknown, withCookie = true) =>
    mf.dispatchFetch(base + path, { method, headers: headers(withCookie ? cookie : ""), body: body === undefined ? undefined : JSON.stringify(body) });
  return { mf, db, request, recoveryCode, email };
}

test("R04-REQ03: новый код восстановления — только после входа и текущего пароля; старый не подходит; в базе нет открытого кода", async () => {
  const { mf, db, request, recoveryCode, email } = await sandbox();
  try {
    const anonymous = await request("/api/auth/recovery-code", "POST", { currentPassword: "test account passphrase" }, false);
    assert.equal(anonymous.status, 401, "без входа код не выдаётся");
    const wrong = await request("/api/auth/recovery-code", "POST", { currentPassword: "wrong passphrase value" });
    assert.equal(wrong.status, 401, "неверный пароль — отказ");
    assert.match(((await wrong.json()) as { error: string }).error, /Текущий пароль не подошёл/);
    const issued = await request("/api/auth/recovery-code", "POST", { currentPassword: "test account passphrase" });
    assert.equal(issued.status, 200);
    assert.equal(issued.headers.get("Cache-Control"), "no-store");
    const { recoveryCode: fresh } = (await issued.json()) as { recoveryCode: string };
    assert.match(fresh, /^[a-f0-9]{32}$/);
    assert.notEqual(fresh, recoveryCode);
    const row = await db.prepare("SELECT recovery_hash FROM accounts").first<{ recovery_hash: string }>();
    assert.ok(row && !row.recovery_hash.includes(fresh) && row.recovery_hash !== fresh, "код хранится только хэшем");
    const old = await request("/api/auth/recover", "POST", { email, password: "another test passphrase", recoveryCode }, false);
    assert.equal(old.status, 401, "старый код после выпуска нового не подходит");
    const ok = await request("/api/auth/recover", "POST", { email, password: "another test passphrase", recoveryCode: fresh }, false);
    assert.equal(ok.status, 200, "новый код подходит");
  } finally {
    await mf.dispose();
  }
});

test("R04-REQ09: «База» по общему слову ставит основные штанговые движения первыми, не дублируя одноимённые", () => {
  const server = [{ name: "Приседания" }, { name: "Приседания сумо" }, { name: "Приседание «дракон»" }, { name: "Приседания со штангой" }];
  const local = exerciseCatalog.search({ text: "присед" }) as any[];
  const merged = ExerciseSearchRank.withCoreFirst(server as any[], local, "присед", normalizeSearch).map((e: any) => e.name);
  assert.equal(merged[0], "Приседания со штангой", "первая строка — основное движение приложения");
  assert.equal(merged.filter((name: string) => name === "Приседания со штангой").length, 1, "одноимённая запись сервера не повторяется");
  assert.ok(merged.indexOf("Приседания") < 5 && merged.includes("Приседание «дракон»"));
  const press = exerciseCatalog.search({ text: "жим лёжа" }) as any[];
  assert.deepEqual(ExerciseSearchRank.withCoreFirst(server as any[], press, "жим лёжа", normalizeSearch), server, "запрос из нескольких слов не меняется");
  assert.deepEqual(ExerciseSearchRank.withCoreFirst(server as any[], [], "присед"), server);
});

test("R04-REQ09: сервер по-прежнему держит «Приседания», «Становую тягу» и «Жим штанги лёжа» в первых строках", async () => {
  const { mf, request } = await sandbox();
  try {
    let result: any;
    for (let i = 0; i < 10; i++) {
      result = await (await request("/api/exercises?q=" + encodeURIComponent("присед"))).json();
      if (!result.importing) break;
    }
    const names: string[] = result.exercises.map((e: any) => e.name);
    assert.ok(names.slice(0, 5).includes("Приседания"), "первые пять: " + names.slice(0, 8).join(" | "));
    const pull = await (await request("/api/exercises?q=" + encodeURIComponent("тяга"))).json();
    const pullNames: string[] = pull.exercises.slice(0, 5).map((e: any) => e.name);
    assert.ok(pullNames.includes("Становая тяга") && pullNames.includes("Тяга штанги в наклоне"), "тяга: " + pullNames.join(" | "));
    const press = await (await request("/api/exercises?q=" + encodeURIComponent("жим лёжа"))).json();
    assert.ok(press.exercises.slice(0, 2).some((e: any) => e.name === "Жим штанги лёжа"));
  } finally {
    await mf.dispose();
  }
});
