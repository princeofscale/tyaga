import { expect, test, type Page } from "@playwright/test";
import { doneWorkout, nav, NOW, round01Fixture, startWith } from "./fixtures/round01";
import { clipped, smallTargets } from "./fixtures/touch";

const overflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test.use({ locale: "ru-RU", timezoneId: "Europe/Saratov", serviceWorkers: "block" });

test("Главная, чистые Инструменты и активная тренировка без хвата/углов + живой таймер", async ({ page }) => {
  const history = [
    doneWorkout("Ноги", "2026-11-09", [["squat", 120, 5, 3]]),
    doneWorkout("Жим", "2026-11-10", [["bench", 100, 5, 4]]),
    doneWorkout("Тяга", "2026-11-06", [["deadlift-bar", 150, 5, 3]]),
  ];
  await page.setViewportSize({ width: 1280, height: 900 });
  await round01Fixture(page, { workouts: history });

  // 1. Главная «Сегодня»: готовность мышц, силовой тотал, быстрые калькуляторы
  await expect(page.getByRole("heading", { name: "Готовность мышц", exact: true })).toBeVisible();
  await expect(page.locator(".readiness-tile").filter({ hasText: "Грудь" })).toContainText("Сегодня");
  await expect(page.locator(".readiness-tile").filter({ hasText: "Ноги" })).toContainText("Вчера");
  await expect(page.locator(".readiness-tile").filter({ hasText: "Спина" })).toContainText("4 дн.");
  await expect(page.locator(".today-telemetry-card")).toContainText("Силовой тотал");

  if (process.env.SHOTS) {
    await page.screenshot({ path: `${process.env.SHOTS}/today-1280.png`, fullPage: true });
  }

  // Быстрый калькулятор блинов прямо с главной
  await page.getByRole("group", { name: "Быстрые калькуляторы" }).getByRole("button", { name: "Блины", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Калькулятор блинов" })).toBeVisible();
  await page.keyboard.press("Escape");

  // 2. Инструменты: только полезное, без мусора
  await page.getByRole("button", { name: "Ещё", exact: true }).click();
  const toolsDialog = page.getByRole("dialog", { name: "Инструменты и настройки" });
  await expect(toolsDialog).toBeVisible();
  const toolsText = await toolsDialog.innerText();
  expect(toolsText).toContain("Калькулятор блинов");
  expect(toolsText).toContain("Калькулятор 1ПМ");
  expect(toolsText).toContain("Разминочная лесенка");
  expect(toolsText).toContain("Разгрузочная неделя");
  expect(toolsText).toContain("Мои цели");
  expect(toolsText).toContain("Резервная копия");
  expect(toolsText).not.toContain("Мои тренажёры");
  expect(toolsText).not.toContain("Анализ техники по видео");
  expect(toolsText).not.toContain("Добавить на экран");
  expect(toolsText).not.toContain("Объём по мышцам");
  if (process.env.SHOTS) {
    await page.screenshot({ path: `${process.env.SHOTS}/tools-1280.png` });
  }
  await page.keyboard.press("Escape");

  // 3. Активная тренировка: нет хвата/углов/амплитуды, ИИ-слопа и таймер точно считает > 5 минут
  await startWith(page, "Жим штанги лёжа");
  const workoutText = await page.locator(".workout-screen").innerText();
  expect(workoutText).not.toContain("амплитуда, хват и углы");
  expect(workoutText).not.toContain("Ещё для упражнения");
  expect(workoutText).not.toContain("3D Атлас тела");
  expect(workoutText).not.toContain("Хват");
  expect(workoutText).not.toContain("Угол скамьи");

  // Нажимаем на строку подхода — в быстрой правке нет «Контекст подхода»
  await page.locator(".set-row").first().click();
  await expect(page.locator(".set-quick-controls-dock")).toBeVisible();
  await expect(page.locator(".set-quick-controls-dock")).not.toContainText("Контекст подхода");

  // Проматываем 5 минут 12 секунд — счётчик НЕ залипает на 01:00 и не уходит в паузу!
  await page.clock.setFixedTime(new Date(NOW.getTime() + 312_000));
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  const clockBtn = page.locator(".live-clock-badge");
  await expect(clockBtn).toContainText("05:12");
  await expect(clockBtn).toContainText("Счётчик");
  await expect(clockBtn).not.toContainText("пауза");

  // Клик по счётчику в шапке ставит на паузу и снимает с паузы
  await clockBtn.click();
  await expect(clockBtn).toContainText("Счётчик · пауза");
  await page.clock.setFixedTime(new Date(NOW.getTime() + 322_000));
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(clockBtn).toContainText("05:12");
  await clockBtn.click();
  await expect(clockBtn).not.toContainText("пауза");
  await page.clock.setFixedTime(new Date(NOW.getTime() + 330_000));
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(clockBtn).toContainText("05:20");

  if (process.env.SHOTS) {
    await page.screenshot({ path: `${process.env.SHOTS}/workout-1280.png`, fullPage: true });
  }

  // Свернём тренировку — на главной и на плавающей кнопке видно живое время
  await page.getByRole("button", { name: "Свернуть тренировку", exact: true }).click();
  await expect(page.locator(".hero-live-timer")).toContainText("05:20");
  await nav(page, "История").click();
  await expect(page.locator(".resume-pill")).toContainText("05:20");

  // 4. Мобилка 320px и 390px без переполнения и мелких кнопок
  await nav(page, "Сегодня").click();
  await page.setViewportSize({ width: 320, height: 640 });
  expect(await overflow(page)).toBeLessThanOrEqual(1);
  expect(await smallTargets(page)).toEqual([]);
  expect((await clipped(page, "main")).wide).toEqual([]);
  if (process.env.SHOTS) {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: `${process.env.SHOTS}/today-390.png`, fullPage: true });
    await page.getByRole("button", { name: "Продолжить тренировку", exact: true }).click();
    await page.screenshot({ path: `${process.env.SHOTS}/workout-390.png`, fullPage: true });
  }
});
