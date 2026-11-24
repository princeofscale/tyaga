import { expect, test, type Page } from "@playwright/test";
import { doneWorkout, nav, round01Fixture } from "./fixtures/round01";
import { clipped, smallTargets } from "./fixtures/touch";

const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test.use({ locale: "ru-RU", timezoneId: "Europe/Saratov", serviceWorkers: "block" });

const history = [
  doneWorkout("Ноги", "2026-11-09", [["squat", 120, 5, 3], ["rdl", 100, 8, 3]]),
  doneWorkout("Жим", "2026-11-06", [["bench", 100, 5, 3]]),
  doneWorkout("Ноги", "2026-10-28", [["squat", 115, 5, 3]]),
  doneWorkout("Жим", "2026-10-24", [["bench", 97.5, 5, 3]]),
  doneWorkout("Ноги", "2025-12-20", [["squat", 100, 5, 3]]),
];

test("История: сводка, рекорды, итоги месяца, поиск без «ё» и окно с прошлым разом", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await round01Fixture(page, { workouts: history });
  await nav(page, "История").click();

  const stats = page.getByRole("region", { name: "Сводка истории" });
  await expect(stats).toContainText("Всего");
  await expect(stats).toContainText("5");
  await expect(stats).toContainText("В ноябре");
  await expect(stats).toContainText("октябрь — 2");
  await expect(stats).toContainText("Рекорды");

  // Рекорд — только рост расчётного 1ПМ; первое появление упражнения — не рекорд.
  const rows = page.locator(".session-item");
  await expect(rows.filter({ hasText: "9" }).first().locator(".record-badge")).toHaveText("Рекорд");
  await expect(page.locator("#history-month-2025-12 .record-badge")).toHaveCount(0);
  await expect(page.locator("#history-month-2026-11 .history-month-meta")).toContainText("подх.");
  await expect(page.locator("#history-month-2026-11 .session-weekday").first()).toHaveText("пн");

  // «лежа» находит «Жим штанги лёжа»; Escape очищает поиск.
  const search = page.getByLabel("Поиск по истории");
  await search.fill("лежа");
  await expect(page.locator(".history-found")).toContainText("Найдено 2 из 5");
  await search.press("Escape");
  await expect(search).toHaveValue("");
  await search.fill("присед");
  await page.getByRole("button", { name: "Очистить поиск" }).click();
  await expect(page.locator(".history-found")).toContainText("5 тренировок");

  // Окно: день недели, сравнение с прошлой «Ноги», лучший подход и рекорд упражнения.
  await page.locator("#history-month-2026-11 .session-item").first().click();
  const dialog = page.getByRole("dialog", { name: "Ноги" });
  await expect(dialog.locator(".workout-detail-meta")).toContainText("пн, 9 ноября");
  await expect(dialog.getByRole("region", { name: "Сравнение с прошлой тренировкой" })).toContainText("С прошлой «Ноги» · 28 окт.");
  const squat = dialog.locator(".detail-exercise").first();
  await expect(squat).toContainText("1ПМ ≈ 140 кг");
  await expect(squat.locator(".record-badge")).toHaveText("Рекорд");
  await expect(squat.locator(".detail-set.is-best")).toHaveCount(1);
  await expect(dialog.locator(".detail-sets").first()).toContainText("120 кг × 5");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);

  // Окно записи прошлого года — с годом в дате, без сравнения.
  await page.locator("#history-month-2025-12 .session-item").click();
  const old = page.getByRole("dialog", { name: "Ноги" });
  await expect(old.locator(".workout-detail-meta")).toContainText("сб, 20 декабря 2025");
  await expect(old.locator(".detail-compare")).toHaveCount(0);
  await page.keyboard.press("Escape");
});

for (const width of [390, 320]) {
  test(`История на ${width}px: без переполнения, обрезки и мелких целей`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await round01Fixture(page, { workouts: history });
    await nav(page, "История").click();
    await expect(page.getByRole("region", { name: "Сводка истории" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Экспорт JSON", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Импорт истории", exact: true })).toBeVisible();
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    expect(await smallTargets(page)).toEqual([]);
    expect(await clipped(page)).toEqual({ overlaps: [], wide: [] });
    await page.locator(".session-item").first().click();
    const dialog = page.getByRole("dialog", { name: "Ноги" });
    await expect(dialog.getByRole("button", { name: "Редактировать", exact: true })).toBeVisible();
    expect(await overflow(page)).toBeLessThanOrEqual(0);
  });
}
