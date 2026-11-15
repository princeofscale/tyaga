import { test, expect, type Page } from "@playwright/test";
import { nav, round01Fixture, startWith, mark } from "./fixtures/round01";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { liveMock, mockLive, roomWithPartner, ROOM_CODE } from "./fixtures/live";
import { makeWorkout } from "../../src/lib/model";
import { TrainingProgram } from "../../src/domain/TrainingProgram";
import type { Workout } from "../../src/lib/types";

/**
 * Раунд 6: R06-REQ01…REQ06 на телефоне (390×844 и 360×800), приложение на подставных ответах.
 * Сегодня в фикстуре — вторник 10 нояб. 2026.
 */
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, locale: "ru-RU", timezoneId: "Europe/Saratov" });

const BENCH = "Жим штанги лёжа";
const SIZES = [{ width: 390, height: 844 }, { width: 360, height: 800 }];
const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const openTool = async (page: Page, name: RegExp | string) => {
  await page.getByRole("button", { name: /^Инструменты/ }).last().click();
  await page.getByRole("button", { name: typeof name === "string" ? new RegExp(name) : name }).click();
};

/** Тренировка со жимом: 3 подхода по 95 × 11. */
function benchSession(id: string, date: string, name: string): Workout {
  const w = makeWorkout(["bench"], [], "Europe/Saratov");
  return {
    ...w, id, name, date, duration: 45, createdAt: `${date}T10:00:00.000Z`, revision: 1,
    exercises: w.exercises.map((e) => ({ ...e, sets: [1, 2, 3].map((k) => ({ id: `${id}:${k}`, weight: 95, reps: 11, rir: 2, warmup: false, done: true })) })),
  } as Workout;
}
/** 240 тренировок за ~13 месяцев, раз в 1,6 дня. */
function year(): Workout[] {
  return Array.from({ length: 240 }, (_, n) => {
    const date = new Date(Date.UTC(2026, 10, 9) - Math.round(n * 1.6) * 86_400_000).toISOString().slice(0, 10);
    return benchSession(`y-${n}`, date, n % 2 ? "Верх" : "Ноги");
  });
}

for (const size of SIZES) {
  test(`R06-REQ01: в комнате название тренировки читается целиком, значки подписаны, вопрос не сдвигает «Завершить» ${size.width}×${size.height}`, async ({ page }) => {
    await page.setViewportSize(size);
    await round01Fixture(page);
    await mockLive(page, liveMock(roomWithPartner()));
    await page.reload();
    await expect(page.getByRole("heading", { name: "Сегодня", exact: true })).toBeVisible();
    await startWith(page, BENCH);
    const badge = page.locator(".room-badge");
    await expect(badge).toContainText(`Комната ${ROOM_CODE}`);
    const name = page.getByRole("textbox", { name: "Название тренировки" });
    for (const title of ["Новая тренировка", "Ноги А [Разгрузка]"]) {
      await name.fill(title);
      await expect(name).toHaveValue(title);
      const box = await name.evaluate((el) => ({ clipped: el.scrollHeight > el.clientHeight + 1, wide: el.scrollWidth > el.clientWidth + 1, lines: Math.round(el.clientHeight / parseFloat(getComputedStyle(el).lineHeight)) }));
      expect(box.clipped, `«${title}» обрезано по высоте`).toBe(false);
      expect(box.wide, `«${title}» обрезано по ширине`).toBe(false);
      expect(box.lines, `«${title}» — не больше двух строк`).toBeLessThanOrEqual(2);
    }
    // «Поделиться» и «Выйти из комнаты»: 44×44, подпись видна и в доступном имени.
    for (const [label, caption] of [["Поделиться", "Поделиться"], ["Выйти из комнаты", "Выйти"]]) {
      const button = badge.getByRole("button", { name: label, exact: true });
      const b = (await button.boundingBox())!;
      expect(b.width).toBeGreaterThanOrEqual(43.99);
      expect(b.height).toBeGreaterThanOrEqual(43.99);
      await expect(button).toContainText(caption);
    }
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    // Вопрос о выходе: «Завершить» и таймер остаются на месте.
    const finish = page.getByRole("button", { name: "Завершить тренировку", exact: true });
    const before = (await finish.boundingBox())!.y;
    await badge.getByRole("button", { name: "Выйти из комнаты", exact: true }).click();
    await expect(badge.getByRole("alertdialog")).toContainText("Выйти из комнаты");
    const after = (await finish.boundingBox())!.y;
    expect(Math.abs(after - before), "вопрос сдвинул «Завершить»").toBeLessThanOrEqual(24);
    expect(await overflow(page)).toBeLessThanOrEqual(0);
  });
}

test("R06-REQ02: в разгрузке «Повторить прошлые» ставит 80, а не 95; «Ноги А» и «Ноги А [Разгрузка]» — один тип в отборе", async ({ page }) => {
  test.setTimeout(120_000);
  const base = makeWorkout(["bench"], [], "Europe/Saratov", true);
  base.exercises.forEach((e) => (e.sets = e.sets.slice(0, 3).map((s) => ({ ...s, weight: 95, reps: 11 }))));
  const routine = { ...TrainingProgram.empty(), id: "r-legs", name: "Ноги А", days: [1], revision: 1, exercises: base.exercises };
  await round01Fixture(page, { routines: [routine], workouts: [benchSession("old-1", "2026-11-03", "Ноги А")] });
  await openTool(page, "Разгрузочная неделя");
  await page.getByRole("button", { name: "Применить разгрузку к тренировкам", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Закрыть", exact: true }).click();
  await nav(page, "Сегодня").click();
  await page.getByRole("button", { name: "Начать тренировку", exact: true }).first().click();
  await expect(page.getByRole("textbox", { name: "Название тренировки" })).toHaveValue("Ноги А [Разгрузка]");
  const weight = page.getByLabel(`${BENCH}, подход 1, вес`, { exact: true });
  await expect(weight).toHaveValue("80");
  const repeat = page.getByRole("button", { name: /^Повторить прошлые/ }).first();
  await expect(repeat).toContainText("80 × 11");
  await expect(repeat).toContainText("разгрузка");
  await repeat.click();
  await expect(weight).toHaveValue("80");
  await expect(page.getByLabel(`${BENCH}, подход 1, повторы`, { exact: true })).toHaveValue("11");
  // Подстановка по одному подходу («Прошлый») тоже разгрузочная; «+2.5 кг» в разгрузке не предлагается.
  await expect(page.getByRole("button", { name: "+2.5 кг" })).toHaveCount(0);
  await page.getByRole("button", { name: /^Подставить прошлый результат: 95 × 11/ }).first().click();
  await expect(weight).toHaveValue("80");

  await mark(page, 1, BENCH, "80", "11");
  await page.getByRole("button", { name: "Завершить тренировку", exact: true }).click();
  await nav(page, "История").click();
  const type = page.getByLabel("Тип тренировки");
  await expect(type.locator("option")).toHaveText(["Все типы", "Ноги А · 2"]);
  await type.selectOption("Ноги А");
  await expect(page.locator(".history-found")).toContainText("Найдено 2 из 2");
  await expect(page.locator(".session-item", { hasText: "[Разгрузка]" })).toHaveCount(1);
});

test("R06-REQ03: станция добавляется по одному названию, без обязательной «Модели»", async ({ page }) => {
  const puts: any[] = [];
  await round01Fixture(page);
  await page.route("**/api/machines", async (route) => {
    if (route.request().method() !== "PUT") return route.fallback();
    const body = route.request().postDataJSON();
    puts.push(body);
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ machine: { ...body, revision: (body.revision ?? 0) + 1 } }) });
  });
  await openTool(page, "Мои тренажёры");
  await page.getByLabel("Название станции", { exact: true }).fill("Жим ногами у окна");
  // На экране — название и зал; остальное в «Подробностях», поле «Модель» не мешает.
  await expect(page.getByLabel("Модель тренажёра", { exact: true })).toBeHidden();
  await page.getByRole("button", { name: "Сохранить тренажёр", exact: true }).click();
  await expect(page.locator(".machine-list")).toContainText("Жим ногами у окна");
  expect(puts).toHaveLength(1);
  expect(puts[0].nickname).toBe("Жим ногами у окна");
  expect(puts[0].model.model).toBe("Жим ногами у окна");
  await expect(page.getByRole("alert")).toHaveCount(0);
});

for (const size of SIZES) {
  test(`R06-REQ04: «Перейти к месяцу» ставит заголовок под верх экрана шесть раз подряд, после поиска и сброса ${size.width}×${size.height}`, async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize(size);
    await round01Fixture(page, { workouts: year() });
    await nav(page, "История").click();
    const jump = page.getByLabel("Перейти к месяцу");
    const monthTop = async (label: string) => {
      const key = await jump.locator("option", { hasText: new RegExp(`^${label}$`) }).getAttribute("value");
      await jump.selectOption({ label });
      let top = 9999;
      await expect.poll(async () => (top = await page.evaluate((k) => document.getElementById(`history-month-${k}`)!.querySelector("h2")!.getBoundingClientRect().top, key)), { message: label, timeout: 5000 }).toBeLessThanOrEqual(100);
      expect(top, label).toBeGreaterThanOrEqual(-2);
    };
    for (const label of ["Июль 2026", "Январь 2026", "Ноябрь 2025", "Март 2026", "Декабрь 2025", "Октябрь 2026"]) await monthTop(label);
    // После поиска и сброса отбора — то же.
    await page.getByLabel("Поиск по истории").fill("Верх");
    await expect(page.locator(".history-found")).toContainText("Найдено 120 из 240");
    await monthTop("Май 2026");
    await page.getByRole("button", { name: "Сбросить отбор" }).first().click();
    await monthTop("Февраль 2026");
    await monthTop("Сентябрь 2026");
    expect(await overflow(page)).toBeLessThanOrEqual(0);
  });
}

for (const size of SIZES) {
  test(`R06-REQ05: после «Завершить» первая карточка истории ≤1 100 px, «Объём за 28 дней» — одно касание, отзывчивость на 240 ${size.width}×${size.height}`, async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize(size);
    await round01Fixture(page, { workouts: year() });
    await startWith(page, BENCH);
    await mark(page, 1, BENCH, "62.5", "8");
    await page.getByRole("button", { name: "Завершить тренировку", exact: true }).click();
    await expect(page.locator(".session-insights")).toBeVisible();
    const tops = await page.evaluate(() => ({
      card: document.querySelector(".history-panel .session-item")!.getBoundingClientRect().top + scrollY,
      insights: document.querySelector(".session-insights")!.getBoundingClientRect().height,
      fold: document.querySelector(".volume-fold")!.getBoundingClientRect().top + scrollY,
    }));
    expect(tops.card, `первая карточка на ${Math.round(tops.card)} px`).toBeLessThanOrEqual(1100);
    expect(tops.fold, "«Объём за 28 дней» выше списка").toBeLessThan(tops.card);
    // Итог раскрывается касанием; тоннаж виден сразу.
    await expect(page.locator(".session-insights")).toContainText("Тоннаж свободных весов");
    await page.locator(".insights-more > summary").click();
    await expect(page.locator(".insights-more")).toContainText("Как учитывается разминка");
    await page.locator(".insights-more > summary").click();
    // «Объём за 28 дней» — одно касание.
    await page.locator(".volume-fold > summary").click();
    await expect(page.locator(".volume-fold .volume-chart")).toBeVisible();
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    // Отзывчивость на 240 тренировках: поиск и отбор отвечают быстро.
    const search = page.getByLabel("Поиск по истории");
    const started = Date.now();
    await search.fill("Ноги");
    await expect(page.locator(".history-found")).toContainText("Найдено");
    expect(Date.now() - started, "поиск на 240 тренировках").toBeLessThan(3000);
    const jumped = Date.now();
    await search.fill("");
    await page.getByLabel("Перейти к месяцу").selectOption({ label: "Январь 2026" });
    await expect(page.locator("#history-month-2026-01 h2")).toBeInViewport();
    expect(Date.now() - jumped, "переход к месяцу на 240 тренировках").toBeLessThan(3000);
  });
}

test("R06-REQ06: предпросмотр импорта — «Будет создано своих упражнений: N» и «Принять близкие» рядом, итог = «Упражнения → Мои»", async ({ page }) => {
  test.setTimeout(180_000);
  const dir = mkdtempSync(join(tmpdir(), "tyaga-r06-e2e-"));
  const csvPath = join(dir, "strong-year.csv");
  execFileSync("node", ["tests/fixtures/gen-year-csv.mjs", csvPath, join(dir, "year.json")], { stdio: "ignore" });
  const csv = readFileSync(csvPath, "utf8");
  const app = await round01Fixture(page);
  await nav(page, "История").click();
  await page.getByRole("button", { name: "Импорт истории", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Импорт истории", exact: true });
  await dialog.getByLabel("Файл истории тренировок").setInputFiles({ name: "strong-year.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await dialog.getByRole("button", { name: "Показать предпросмотр", exact: true }).click();
  const line = dialog.locator(".import-own-line");
  await expect(line).toContainText("Будет создано своих упражнений:");
  const own = async () => Number(await line.locator("b").getAttribute("data-own-total"));
  const first = await own();
  expect(first).toBeGreaterThan(12);
  // Кнопка — в той же строке сводки, а не после карточек «Нужно решить».
  const accept = line.getByRole("button", { name: /^Принять близкие движения \(\d+\)/ });
  await expect(accept).toBeVisible();
  const reach = await page.evaluate(() => {
    const d = document.querySelector("dialog[open]")!;
    const b = d.querySelector(".import-own-line button")!.getBoundingClientRect();
    const first = d.querySelector(".import-decide, [aria-label='Нужно решить']")?.getBoundingClientRect();
    return { button: b.top, decide: first?.top ?? Infinity };
  });
  expect(reach.button, "кнопка выше карточек «Нужно решить»").toBeLessThan(reach.decide);
  const k = Number(/\((\d+)\)/.exec(await accept.innerText())![1]);
  await accept.click();
  const second = await own();
  expect(second).toBeLessThan(first);
  expect(k).toBeGreaterThan(0);
  await expect(dialog.locator(".import-own-footer")).toContainText(`Будет создано своих упражнений: ${second}`);
  await dialog.getByRole("button", { name: "Импортировать", exact: true }).click();
  await expect(page.locator(".import-undo")).toContainText("Импорт: записано 240 из 240", { timeout: 90_000 });
  expect(app.customs.length).toBe(second);
});
