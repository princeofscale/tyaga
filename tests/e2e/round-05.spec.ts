import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { nav, round01Fixture } from "./fixtures/round01";
import { makeWorkout, exerciseById } from "../../src/lib/model";
import { WorkoutImport } from "../../src/domain/WorkoutImport";
import { ImportNameMatcher } from "../../src/domain/ImportNameMatcher";
import { PersonalExerciseFactory } from "../../server/PersonalExerciseFactory";
import type { Exercise, Workout } from "../../src/lib/types";

/**
 * Раунд 5: R05-REQ01…REQ07 на телефоне, приложение на подставных ответах (ни один запрос не уходит на воркер или D1).
 * Данные — годовой Strong-экспорт QA: 240 тренировок, 52 названия.
 */
test.use({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
  locale: "ru-RU",
  timezoneId: "Europe/Saratov",
});

const dir = mkdtempSync(join(tmpdir(), "tyaga-r05-e2e-"));
const csvPath = join(dir, "strong-year.csv");
execFileSync("node", ["tests/fixtures/gen-year-csv.mjs", csvPath, join(dir, "year.json")], { stdio: "ignore" });
const csv = readFileSync(csvPath, "utf8");
const parsed = new WorkoutImport({ dateOrder: "dmy", weightUnit: "kg", distanceUnit: "km", timeZone: "Europe/Saratov" }).parse(csv, "strong");
const weighted = new Set(ImportNameMatcher.weights(parsed).keys());
const verdicts = ImportNameMatcher.classifyAll(parsed.exerciseNames, {}, weighted);

/** Ответы базы упражнений для названий, которых нет в ядре: так их отдаёт сервер при точном совпадении. */
const wger = (id: string, name: string) =>
  ({ ...exerciseById("pushup"), id: `wger:${id}`, name, nameEn: name, catalogRevision: 3, source: { provider: "wger" } }) as unknown as Exercise;
const resolveMatches = {
  // «Планка» в базе — на время, а в файле повторы: честно отдельная запись, а не «сопоставлено».
  Plank: [{ ...wger("plank", "Планка"), recording: { ...exerciseById("pushup")!.recording, type: "duration", loadMode: "bodyweight" } } as unknown as Exercise],
  Dip: [wger("dip", "Отжимания на брусьях")],
  "Kettlebell Swing": [wger("swing", "Мах гирей")],
  "Farmers Walk (Dumbbell)": [wger("farmers", "Прогулка фермера")],
  "Good Morning (Barbell)": [wger("gm", "Наклоны со штангой")],
};

const OCT = "2026-10";
const rows = csv.trim().split("\n").slice(1).map((line) => line.split(","));
const sessions = [...new Map(rows.map((r) => [`${r[0]}|${r[1]}`, { date: r[0].slice(0, 10), name: r[1] }])).values()];
const count = (pick: (s: { date: string; name: string }) => boolean) => sessions.filter(pick).length;

/** Те же 240 тренировок, уже лежащие в журнале (только то, что узнал каталог): для экранов «История» и «Прогресс». */
function yearJournal(): Workout[] {
  const prepared = ImportNameMatcher.prepare(parsed, {
    choiceFor: (name) => (["matched", "variant"].includes(verdicts[name].kind) ? verdicts[name].exercise!.id : ""),
    find: (id) => exerciseById(id),
    verdicts,
  });
  return prepared.workouts.map((source, i) => {
    const w = makeWorkout([], [], "Europe/Saratov");
    return {
      ...w,
      id: `year-${i}`,
      name: source.name,
      date: source.date,
      duration: source.duration,
      createdAt: `${source.date}T10:00:00.000Z`,
      revision: 1,
      exercises: source.exercises
        .filter((e) => e.exerciseId)
        .map((e) => ({
          exerciseId: e.exerciseId!,
          catalogRevision: e.catalogRevision,
          displayNameSnapshot: e.displayName,
          ...(e.equipmentNote ? { equipmentNote: e.equipmentNote } : {}),
          sets: e.sets.map((s, n) => ({ ...s, id: `year-${i}:${e.exerciseId}:${n}` })),
        })),
    } as Workout;
  });
}

const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const openBackup = async (page: Page) => {
  await nav(page, "Сегодня").click();
  await page.getByRole("button", { name: /^Инструменты/ }).last().click();
  await page.getByRole("button", { name: /Резервная копия/ }).click();
};

test("R05-REQ01/REQ07: годовой Strong — «Сопоставлено N из 52», даты без ISO, «Мои» ≤ 12, баннер называет операцию", async ({ page }) => {
  test.setTimeout(180_000);
  const app = await round01Fixture(page, { resolveMatches });
  await nav(page, "История").click();
  await page.getByRole("button", { name: "Импорт истории", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Импорт истории", exact: true });
  await dialog.getByLabel("Файл истории тренировок").setInputFiles({ name: "strong-year.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await dialog.getByRole("button", { name: "Показать предпросмотр", exact: true }).click();

  const summary = dialog.locator(".import-match-summary");
  await expect(summary).toContainText(/Сопоставлено \d+ из 52 · нужно решить \d+/);
  const [, matched, toDecide] = /Сопоставлено (\d+) из 52 · нужно решить (\d+)/.exec((await summary.innerText()).replace(/\s+/g, " "))!.map(Number);
  expect(matched).toBeGreaterThanOrEqual(30);
  // Спорные — с вариантами, а не молчаливые «Мои»; близкие, но другие движения не применяются без вопроса.
  const decide = dialog.getByRole("region", { name: "Нужно решить" });
  await expect(decide).toContainText("Похоже на");
  await expect(decide).toContainText("Близкое, но другое движение");
  // Даты предпросмотра — как везде: «15 нояб. 2025», без 2025-11-15.
  const sessionsList = dialog.locator(".import-sessions");
  await expect(sessionsList).toContainText("15 нояб. 2025");
  expect(await sessionsList.innerText()).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  expect(await overflow(page)).toBeLessThanOrEqual(0);
  // Одно касание принимает близкие движения; после этого «Моими» остаётся не больше 12.
  await dialog.getByRole("button", { name: /^Принять близкие движения \(\d+\)/ }).click();
  await expect(summary).toContainText(/Сопоставлено \d+ из 52 · нужно решить \d+/);
  const counted = async () => ({
    matched: Number(await summary.getAttribute("data-matched")),
    decide: Number(await summary.getAttribute("data-decide")),
    own: Number(await summary.getAttribute("data-own")),
  });
  const before = await counted();
  expect(before.decide + before.own).toBeLessThanOrEqual(12);
  // «Планка» (время) не засчитана как сопоставленная: в предпросмотре честно «отдельная запись».
  await expect(dialog).toContainText("отдельная запись: в каталоге упражнение на время, а в файле повторы");

  await dialog.getByRole("button", { name: "Импортировать", exact: true }).click();
  await expect(page.locator(".import-undo")).toContainText("Импорт: записано 240 из 240", { timeout: 90_000 });
  // «Мои» после импорта — единицы необычных, не 46 дублей каталога; названия из ТЗ не остались английскими «Моими».
  expect(app.customs.length).toBeLessThanOrEqual(12);
  // Счётчик в предпросмотре = факт: «Мои» после импорта ровно «нужно решить» + «отдельные».
  expect(app.customs.length).toBe(before.decide + before.own);
  const mine = app.customs.map((e) => e.nameEn);
  for (const english of ["Pull Up", "Lat Pulldown (Cable)", "Hanging Leg Raise", "Leg Press (Machine)", "Face Pull (Cable)", "Calf Raise (Machine)", "Back Extension"])
    expect(mine).not.toContain(english);
  // «Подтягивания» — одна запись с годовой историей.
  const pulls = new Set(app.workouts.flatMap((w) => w.exercises).filter((e) => e.exerciseId.startsWith("pullup")).map((e) => e.exerciseId));
  expect(pulls.size).toBe(1);

  // REQ07: баннер относится к конкретной операции — говорит, что удалит и когда это было добавлено.
  const banner = page.locator(".import-undo");
  await expect(banner.locator(".import-undo-scope")).toHaveText("Отмена удалит 240 тренировок, добавленных 10 нояб. в 16:00.");
});

test("R05-REQ03/REQ04: «История» — месяцы с годом, переход к январю одним касанием, отбор по периоду и типу, «Найдено N»", async ({ page }) => {
  test.setTimeout(120_000);
  await round01Fixture(page, { workouts: yearJournal() });
  await nav(page, "История").click();
  const titles = page.locator(".history-month-title");
  await expect(titles.first()).toContainText("Ноябрь 2026");
  await expect(titles.filter({ hasText: "Ноябрь 2025" })).toHaveCount(1);
  await expect(titles.filter({ hasText: "Октябрь 2026" })).toHaveCount(1);
  // Год у записей не текущего года.
  await expect(page.locator("#history-month-2025-11 .session-year").first()).toHaveText("2025");
  await expect(page.locator("#history-month-2026-10 .session-year")).toHaveCount(0);

  // До 20 января — одно касание: «Перейти к месяцу» → «Январь 2026».
  await page.getByLabel("Перейти к месяцу").selectOption("2026-01");
  await expect(page.locator("#history-month-2026-01")).toBeInViewport();
  await expect(page.locator("#history-month-2026-01 .history-month-title")).toContainText("Январь 2026");
  await expect(page.getByRole("button", { name: "Наверх" })).toBeVisible();
  await page.getByRole("button", { name: "Наверх" }).click();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThan(50);

  const found = page.locator(".history-found");
  const total = sessions.length;
  await page.getByLabel("Период", { exact: true }).selectOption(OCT);
  await expect(found).toContainText(`Найдено ${count((s) => s.date.startsWith(OCT))} из ${total}`);
  await expect(page.locator(".history-month-title")).toHaveCount(1);
  const legs = count((s) => s.name === "Ноги");
  await page.getByLabel("Тип тренировки").selectOption("Ноги");
  await expect(found).toContainText(`Найдено ${count((s) => s.date.startsWith(OCT) && s.name === "Ноги")} из ${total}`);
  await page.getByRole("button", { name: "Сбросить отбор" }).first().click();
  await page.getByLabel("Тип тренировки").selectOption("Ноги");
  await expect(found).toContainText(`Найдено ${legs} из ${total}`);
  expect(legs).toBe(60);
  await page.getByRole("button", { name: "Сбросить отбор" }).first().click();

  // Поиск по названию месяца находит октябрьские, а не пустой экран.
  const search = page.getByLabel("Поиск по истории");
  const started = Date.now();
  await search.fill("окт");
  await expect(found).toContainText(`Найдено ${count((s) => s.date.slice(5, 7) === "10")} из ${total}`);
  expect(Date.now() - started).toBeLessThan(3000);
  await search.fill("2026-10");
  await expect(found).toContainText(`Найдено ${count((s) => s.date.startsWith(OCT))} из ${total}`);
  await search.fill("ящерица");
  await expect(page.getByText("Таких тренировок нет.")).toBeVisible();
  await expect(page.getByText(/месяц с годом/)).toBeVisible();

  // Диапазон дат.
  await search.fill("");
  await page.getByLabel("Период", { exact: true }).selectOption("range");
  await page.getByLabel("С даты").fill("2026-01-10");
  await page.getByLabel("По дату").fill("2026-01-20");
  await expect(found).toContainText(`Найдено ${count((s) => s.date >= "2026-01-10" && s.date <= "2026-01-20")} из ${total}`);

  // Ни на 390, ни на 360 страница не уезжает вбок.
  for (const size of [{ width: 390, height: 844 }, { width: 360, height: 800 }]) {
    await page.setViewportSize(size);
    expect(await overflow(page)).toBeLessThanOrEqual(0);
  }
});

test("R05-REQ05: «Обзор» — «6 месяцев», «Год», «Всё»: заголовок, недели и числа пересчитываются", async ({ page }) => {
  test.setTimeout(120_000);
  await round01Fixture(page, { workouts: yearJournal() });
  await nav(page, "Прогресс").click();
  await page.getByRole("tab", { name: "Обзор", exact: true }).click();
  const period = page.getByRole("group", { name: "Период прогресса" });
  for (const label of ["4 нед.", "8 нед.", "12 нед.", "6 месяцев", "Год", "Всё"]) await expect(period.getByRole("button", { name: label, exact: true })).toBeVisible();
  const box = await period.getByRole("button", { name: "Год", exact: true }).boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(43.9);

  await period.getByRole("button", { name: "6 месяцев", exact: true }).click();
  await expect(page.locator(".overview-period")).toContainText("За 6 месяцев: 10 мая 2026 — 10 нояб. 2026");
  const inSix = count((s) => s.date >= "2026-05-10");
  await expect(page.locator(".progress-metric").first()).toContainText(String(inSix));

  await period.getByRole("button", { name: "Год", exact: true }).click();
  await expect(page.locator(".overview-period")).toContainText("За год: 10 нояб. 2025 — 10 нояб. 2026");
  const chart = page.getByRole("figure", { name: "Подходы по неделям" });
  await expect(chart).toBeVisible();
  const weeks = await chart.locator(".weekly-trend-bars i").count();
  expect(weeks).toBeGreaterThanOrEqual(52);
  expect(weeks).toBeLessThanOrEqual(54);
  // Ось подписана месяцами.
  const axis = (await chart.locator(".weekly-trend-axis span").allInnerTexts()).join(" ");
  expect(axis).toMatch(/янв/);
  expect(axis).toMatch(/июл|июн/);
  await expect(chart.locator(".weekly-trend-years")).toContainText("2025");
  await expect(chart.locator(".weekly-trend-years")).toContainText("2026");
  await expect(page.locator(".progress-metric").first()).toContainText(String(count((s) => s.date >= "2025-11-10")));

  await period.getByRole("button", { name: "Всё", exact: true }).click();
  await expect(page.locator(".overview-period")).toContainText("За всё время");
  await expect(page.locator(".progress-metric").first()).toContainText("240");
  expect(await overflow(page)).toBeLessThanOrEqual(0);
  await page.setViewportSize({ width: 360, height: 800 });
  expect(await overflow(page)).toBeLessThanOrEqual(0);
});

test("R05-REQ02: «Мышцы» говорят «не учтено», «Мои» размечаются за раз, «Пресс» за ту же неделю больше нуля", async ({ page }) => {
  test.setTimeout(120_000);
  const factory = new PersonalExerciseFactory();
  const body = (familyId: string, name: string) => ({
    familyId, name, nameEn: name, aliases: [name], notes: "", equipment: "bodyweight", declaredZones: [], origin: "strong",
    recording: { type: "reps", loadMode: "bodyweight", implementCount: 1, laterality: "bilateral" },
  });
  const customs = [await factory.create(body("fam-ab-1", "Cable Crunch")), await factory.create(body("fam-ab-2", "Ab Twist")), await factory.create(body("fam-other", "Strange Row"))];
  const week = (id: string, date: string, c: Exercise): Workout => {
    const w = makeWorkout([], [], "Europe/Saratov");
    return {
      ...w, id, name: "Корпус", date, duration: 40, createdAt: `${date}T10:00:00.000Z`, revision: 1,
      exercises: [{
        exerciseId: c.id, catalogRevision: 3, externalDefinition: c, displayNameSnapshot: c.name,
        sets: [1, 2, 3].map((n) => ({ id: `${id}:${n}`, weight: 0, reps: 15, rir: 2, warmup: false, done: true })),
      }],
    } as Workout;
  };
  const app = await round01Fixture(page, {
    customExercises: customs,
    workouts: [week("w-a", "2026-10-20", customs[0]), week("w-b", "2026-10-22", customs[1]), week("w-c", "2026-10-23", customs[2])],
  });
  await nav(page, "Прогресс").click();
  await page.getByRole("tab", { name: "Мышцы", exact: true }).click();
  // 19–25 окт.: три недели назад от недели 9 нояб.
  for (let i = 0; i < 3; i++) await page.getByRole("button", { name: "Предыдущая неделя", exact: true }).click();
  const note = page.locator(".zones-unmarked").first();
  await expect(note).toContainText("Не учтено: 3 упражнения, 9 подходов");
  const core = page.locator(".muscle-row", { hasText: "Пресс" });
  await expect(core.locator("b")).toContainText("0");
  expect(await core.locator("b").innerText()).toMatch(/^0\s*\/\s*6/);

  // Переход к разметке: «Мои» сразу в режиме разметки.
  await note.getByRole("button", { name: "Разметить", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Упражнения", exact: true })).toBeVisible();
  const panel = page.getByRole("region", { name: "Массовая разметка" });
  await expect(panel).toBeVisible();
  await expect(page.locator(".bulk-head")).toContainText("Без разметки мышц: 3 из 3");
  // Выбираем два на пресс (не все три) и назначаем группу за одно действие.
  await page.getByLabel("Выбрать Cable Crunch", { exact: true }).check();
  await page.getByLabel("Выбрать Ab Twist", { exact: true }).check();
  await expect(panel).toContainText("Выбрано 2");
  await panel.getByRole("button", { name: "Группа мышц", exact: false }).first().click();
  await page.getByRole("option", { name: "Пресс", exact: true }).click();
  await panel.getByRole("button", { name: "Назначить группу", exact: true }).click();
  await expect(panel.locator(".bulk-result")).toContainText("Размечено 2 из 2");
  expect(app.customPuts).toHaveLength(2);
  // Происхождение импорта и название остались.
  expect(app.customs.filter((e) => e.custom?.declaredZones.includes("core" as never)).map((e) => e.custom?.origin)).toEqual(["strong", "strong"]);
  await expect(page.locator(".bulk-head")).toContainText("Без разметки мышц: 1 из 3");

  // Третье — «это то же, что…» упражнение каталога (мышцы берутся оттуда, история остаётся при нём).
  await page.getByLabel("Выбрать Strange Row", { exact: true }).check();
  await panel.getByRole("button", { name: "Это то же, что…", exact: false }).first().click();
  await page.getByRole("listbox").last().getByRole("searchbox").or(page.getByLabel("Поиск в списке")).first().fill("Тяга горизонтального");
  await page.getByRole("option", { name: "Тяга горизонтального блока", exact: true }).click();
  await panel.getByRole("button", { name: "Назначить упражнение каталога", exact: true }).click();
  await expect(panel.locator(".bulk-result")).toContainText("Размечено 1 из 1");
  expect(app.customs.find((e) => e.name === "Strange Row")!.custom?.basedOnExerciseId).toBe("row");

  // Та же неделя: «Пресс» больше нуля, а строки «не учтено» нет.
  await nav(page, "Прогресс").click();
  await page.getByRole("tab", { name: "Мышцы", exact: true }).click();
  // Выбранная неделя (19–25 окт.) сохраняется: возвращаться по неделям заново не нужно.
  await expect(page.locator(".week-selector")).toContainText("19 окт");
  await expect(page.locator(".zones-unmarked")).toHaveCount(0);
  expect(await page.locator(".muscle-row", { hasText: "Пресс" }).locator("b").innerText()).toMatch(/^6\s*\/\s*6/);
  expect(await overflow(page)).toBeLessThanOrEqual(0);
});

test("R05-REQ06/REQ07: «Восстановление из копии» — «Новых 0 · Уже есть 240», «Ничего нового», итог до закрытия, баннер подписан", async ({ page }) => {
  test.setTimeout(180_000);
  const app = await round01Fixture(page, { resolveMatches });
  // Первый импорт годового файла.
  await nav(page, "История").click();
  await page.getByRole("button", { name: "Импорт истории", exact: true }).click();
  const importer = page.getByRole("dialog", { name: "Импорт истории", exact: true });
  await importer.getByLabel("Файл истории тренировок").setInputFiles({ name: "strong-year.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await importer.getByRole("button", { name: "Показать предпросмотр", exact: true }).click();
  await importer.getByRole("button", { name: /^Принять близкие движения/ }).click();
  await importer.getByRole("button", { name: "Импортировать", exact: true }).click();
  const banner = page.locator(".import-undo");
  await expect(banner).toContainText("Импорт: записано 240 из 240", { timeout: 90_000 });
  expect(app.workouts).toHaveLength(240);

  // Полная копия.
  await openBackup(page);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Скачать полную копию", exact: true }).click();
  const backupPath = join(dir, "backup.json");
  await (await download).saveAs(backupPath);
  expect(JSON.parse(readFileSync(backupPath, "utf8")).workouts).toHaveLength(240);

  // Восстановление тем же файлом: окно называется по делу, а не «Импорт истории».
  await page.getByRole("button", { name: "Восстановить из файла", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Восстановление из копии", exact: true });
  await expect(dialog).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Импорт истории", exact: true })).toHaveCount(0);
  await expect(dialog).not.toContainText(/Strong|Hevy/);
  await dialog.getByLabel("Файл истории тренировок").setInputFiles(backupPath);
  await dialog.getByRole("button", { name: "Показать предпросмотр", exact: true }).click();
  const plan = dialog.getByRole("region", { name: "Что в копии" });
  await expect(plan).toContainText("Тренировки: 240");
  await expect(plan).toContainText("Новых 0 · Уже есть 240 · Отличаются 0");
  await expect(plan).toContainText("Ничего нового: все 240 тренировок уже в аккаунте");
  expect(await dialog.innerText()).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  expect(await overflow(page)).toBeLessThanOrEqual(0);

  await dialog.getByRole("button", { name: "Импортировать", exact: true }).click();
  // Итог остаётся на экране, пока его не закроют.
  const result = dialog.getByRole("status", { name: "Итог восстановления" });
  await expect(result).toContainText("Ничего не добавлено");
  await expect(result).toContainText("Тренировки: добавлено 0, уже есть 240, отличаются 0");
  await page.waitForTimeout(1500);
  await expect(result).toBeVisible();
  expect(app.workouts).toHaveLength(240);
  await result.getByRole("button", { name: "Закрыть", exact: true }).click();
  await expect(dialog).toHaveCount(0);

  // REQ07: баннер остаётся у прежнего импорта и прямо говорит, что последнее восстановление ничего не добавило.
  await expect(banner).toContainText("Импорт: записано 240 из 240");
  await expect(banner.locator(".import-undo-noop")).toContainText("Восстановление 10 нояб. в 16:00 ничего не добавило — отмена относится к импорту от 10 нояб. в 16:00");
  await expect(banner.locator(".import-undo-scope")).toContainText("Отмена удалит 240 тренировок, добавленных 10 нояб. в 16:00");

  // Подтверждение с числом перед удалением крупной партии; «Не надо» ничего не трогает.
  await banner.getByRole("button", { name: "Отменить импорт", exact: true }).click();
  await expect(banner.locator(".import-undo-confirm")).toContainText("Удалить 240 тренировок, добавленных 10 нояб. в 16:00?");
  await banner.getByRole("button", { name: "Не надо", exact: true }).click();
  expect(app.workouts).toHaveLength(240);
  await banner.getByRole("button", { name: "Отменить импорт", exact: true }).click();
  await banner.getByRole("button", { name: "Убрать 240", exact: true }).click();
  await expect(page.locator(".toast")).toContainText("Убрал 240 тренировок этого импорта");
  expect(app.workouts).toHaveLength(0);
  await expect(page.locator(".import-undo")).toHaveCount(0);
});

test("QA-R05-01/06/07/08: «Активных недель» = 53 − «Пустых недель», поиск по дню, цели ≥44, даты без ISO", async ({ page }) => {
  test.setTimeout(120_000);
  await round01Fixture(page, { workouts: yearJournal() });
  await nav(page, "Прогресс").click();
  await page.getByRole("tab", { name: "Обзор", exact: true }).click();
  const period = page.getByRole("group", { name: "Период прогресса" });
  await period.getByRole("button", { name: "Год", exact: true }).click();
  const chart = page.getByRole("figure", { name: "Подходы по неделям" });
  const empty = Number(/Пустых недель: (\d+)/.exec(await chart.innerText())![1]);
  const [, active, total] = /Активных недель: (\d+) из (\d+)/.exec(await page.getByText(/Активных недель: \d+ из \d+/).first().innerText())!.map(Number);
  expect(total).toBe(await chart.locator(".weekly-trend-bars i").count());
  expect(active).toBe(total - empty);
  // Цели нажатия ≥44 у кнопок периода, включая «Год» и «Всё».
  for (const label of ["Год", "Всё"]) {
    const box = await period.getByRole("button", { name: label, exact: true }).boundingBox();
    expect(box!.height, label).toBeGreaterThanOrEqual(43.9);
    expect(box!.width, label).toBeGreaterThanOrEqual(43.9);
  }
  // Подписи ячеек и столбцов — «15 нояб. 2025», без ISO.
  const labels = await page.locator("[aria-label], [title]").evaluateAll((els) => els.flatMap((e) => [e.getAttribute("aria-label") ?? "", e.getAttribute("title") ?? ""]));
  expect(labels.filter((l) => /\b\d{4}-\d{2}-\d{2}\b/.test(l))).toEqual([]);

  // Поиск по дню: «20 янв», «20 янв 2026», «20.01.2026», «2026-01-20» находят один и тот же день.
  await nav(page, "История").click();
  const found = page.locator(".history-found");
  const search = page.getByLabel("Поиск по истории");
  const day = count((s) => s.date === "2026-01-20");
  expect(day).toBeGreaterThan(0);
  for (const query of ["20 янв", "20 янв 2026", "20.01.2026", "2026-01-20"]) {
    await search.fill(query);
    await expect(found, query).toContainText(`Найдено ${day} из ${sessions.length}`);
  }
  // Карточка не текущего года: «15 нояб. 2025» с точкой, без ISO.
  await search.fill("15 нояб 2025");
  await expect(page.locator(".session-date").first()).toHaveText(/^15\s*нояб\.\s*2025$/);
  expect(await page.locator("main").innerText()).not.toMatch(/\d{4}-\d{2}-\d{2}/);
});

test("QA-R05-03/04: упражнение каталога без мышц размечается своей копией; замена прежней разметки — только с подтверждением", async ({ page }) => {
  test.setTimeout(120_000);
  const factory = new PersonalExerciseFactory();
  const marked = await factory.create({
    familyId: "fam-dip", name: "Dip Mine", nameEn: "Dip Mine", aliases: ["Dip Mine"], notes: "", equipment: "bodyweight", declaredZones: ["chest"], origin: "strong",
    recording: { type: "reps", loadMode: "bodyweight", implementCount: 1, laterality: "bilateral" },
  } as never);
  const bare = await factory.create({
    familyId: "fam-bare", name: "Bare Row", nameEn: "Bare Row", aliases: ["Bare Row"], notes: "", equipment: "bodyweight", declaredZones: [], origin: "strong",
    recording: { type: "reps", loadMode: "bodyweight", implementCount: 1, laterality: "bilateral" },
  } as never);
  const gap = { ...exerciseById("pushup")!, id: "wger:919", name: "Тяга Т-грифа — вариант", nameEn: "T-bar row", primary: [], secondary: [], muscles: [], catalogRevision: 3, source: { provider: "wger" } } as unknown as Exercise;
  const entry = (id: string, date: string, e: Exercise): Workout => {
    const w = makeWorkout([], [], "Europe/Saratov");
    return {
      ...w, id, name: "Тяга", date, duration: 40, createdAt: `${date}T10:00:00.000Z`, revision: 1,
      exercises: [{
        exerciseId: e.id, catalogRevision: 3, externalDefinition: e, displayNameSnapshot: e.name,
        sets: [1, 2, 3, 4].map((n) => ({ id: `${id}:${n}`, weight: 40, reps: 8, rir: 2, warmup: false, done: true })),
      }],
    } as Workout;
  };
  const app = await round01Fixture(page, {
    customExercises: [marked, bare],
    workouts: [entry("g-1", "2026-10-20", gap), entry("g-2", "2026-10-21", marked), entry("g-3", "2026-10-22", bare)],
  });
  await nav(page, "Прогресс").click();
  await page.getByRole("tab", { name: "Мышцы", exact: true }).click();
  for (let i = 0; i < 3; i++) await page.getByRole("button", { name: "Предыдущая неделя", exact: true }).click();
  const note = page.locator(".zones-unmarked").first();
  await expect(note).toContainText(/Не учтено: 2 упражнения, 8 подходов/);
  await note.getByRole("button", { name: "Разметить", exact: true }).click();
  const panel = page.getByRole("region", { name: "Массовая разметка" });
  await expect(panel).toBeVisible();
  // «Разметить» ведёт и к упражнению каталога без мышц.
  const gaps = page.getByRole("region", { name: "Из каталога без мышц" });
  await expect(gaps).toContainText("Из каталога без мышц · 1");
  await expect(gaps).toContainText("Тяга Т-грифа — вариант");

  // QA-R05-04: «Выбрать без разметки» не берёт размеченное, замена — только с подтверждением.
  await panel.getByRole("button", { name: /^Выбрать без разметки/ }).click();
  await expect(panel).toContainText("Выбрано 2");
  await page.getByLabel("Выбрать Dip Mine", { exact: true }).check();
  await expect(panel).toContainText("Выбрано 3");
  await panel.getByRole("button", { name: "Группа мышц", exact: false }).first().click();
  await page.getByRole("option", { name: "Пресс", exact: true }).click();
  await panel.getByRole("button", { name: "Назначить группу", exact: true }).click();
  const confirm = panel.locator(".bulk-confirm");
  await expect(confirm).toContainText("У 1 уже есть разметка");
  expect(app.customPuts).toHaveLength(0);
  await confirm.getByRole("button", { name: /^Только без разметки \(2\)/ }).click();
  await expect(panel.locator(".bulk-result")).toContainText("Размечено 2 из 2");
  // Размеченное осталось с прежней группой; для упражнения каталога создана копия с происхождением.
  expect(app.customs.find((e) => e.name === "Dip Mine")!.custom?.declaredZones).toEqual(["chest"]);
  const copy = app.customs.find((e) => e.custom?.origin === "catalog:wger:919");
  expect(copy?.name).toBe("Тяга Т-грифа — вариант");

  // После разметки «Не учтено» исчезает.
  await nav(page, "Прогресс").click();
  await page.getByRole("tab", { name: "Мышцы", exact: true }).click();
  await expect(page.locator(".zones-unmarked")).toHaveCount(0);
});

test("R05: на 360×800 «История», «Прогресс», «Упражнения» не уезжают вбок на 240 тренировках", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 360, height: 800 });
  await round01Fixture(page, { workouts: yearJournal() });
  for (const name of ["История", "Прогресс", "Упражнения"]) {
    await nav(page, name).click();
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
    expect(await overflow(page), name).toBeLessThanOrEqual(0);
  }
});
