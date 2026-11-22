import { expect, test, type Page } from "@playwright/test";
import { doneWorkout, nav, round01Fixture } from "./fixtures/round01";
import { clipped, smallTargets } from "./fixtures/touch";

const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test.use({ locale: "ru-RU", timezoneId: "Europe/Saratov", serviceWorkers: "block" });

test("Прогресс без ИИ-слопа: силовой тотал, симулятор цели и пульс недели работают на desktop и mobile (320px)", async ({ page }) => {
  const history = [
    doneWorkout("Ноги", "2026-11-02", [["squat", 120, 1, 1]]),
    doneWorkout("Жим", "2026-11-04", [["bench", 100, 1, 1]]),
    doneWorkout("Тяга", "2026-11-06", [["deadlift-bar", 160, 1, 1]]),
    doneWorkout("Плечи", "2026-11-09", [["ohp-bar", 65, 1, 1]]),
  ];
  await page.setViewportSize({ width: 1280, height: 900 });
  await round01Fixture(page, { workouts: history });
  await nav(page, "Прогресс").click();
  await expect(page.getByRole("heading", { name: "Прогресс", exact: true })).toBeVisible();

  // Нет ИИ-слоп фраз
  const bodyText = await page.locator("main").innerText();
  expect(bodyText).not.toContain("Твой тренировочный ритм");
  expect(bodyText).not.toContain("Сравнение с предыдущим периодом той же длины");
  expect(bodyText).not.toContain("Зал личных рекордов");

  // Силовой тотал: 120 + 100 + 160 = 380 кг, до вехи 400 кг ещё 20 кг
  const totalCard = page.getByRole("region", { name: "Силовой тотал" });
  await expect(totalCard).toContainText("380");
  await expect(totalCard).toContainText("Веха 400 кг");
  await expect(totalCard).toContainText("ещё 20 кг");
  if (process.env.SHOTS) {
    await page.screenshot({ path: `${process.env.SHOTS}/overview-1280.png`, fullPage: true });
  }

  // Симулятор цели: добавляем +10 кг к приседу (4 клика +2,5 кг) → тотал 390 кг (+10 кг)
  await totalCard.getByRole("button", { name: "Прикинуть цель", exact: true }).click();
  const plusSquat = totalCard.getByRole("button", { name: "Присед плюс 2,5 кг", exact: true });
  for (let i = 0; i < 4; i++) await plusSquat.click();
  await expect(totalCard).toContainText("390");
  await expect(totalCard).toContainText("+10 кг");
  if (process.env.SHOTS) {
    await page.screenshot({ path: `${process.env.SHOTS}/simulator-1280.png`, fullPage: true });
  }

  // Возвращаемся в факт и переходим кликом по Жиму в «Силу»
  await totalCard.getByRole("button", { name: "Факт", exact: true }).click();
  await expect(totalCard).toContainText("380");
  await totalCard.getByRole("button", { name: "Динамика: Жим лёжа", exact: true }).click();
  await expect(page.getByRole("tab", { name: "Сила", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("main")).not.toContainText("Прогрессу нужна точка отсчёта");

  // Проверяем вкладку «Мышцы»
  await page.getByRole("tab", { name: "Мышцы", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Баланс недели", exact: true })).toBeVisible();
  if (process.env.SHOTS) {
    await page.screenshot({ path: `${process.env.SHOTS}/muscles-1280.png`, fullPage: true });
  }

  // Проверяем 320px на «Обзор» — без переполнения, обрезки и мелких кнопок
  await page.getByRole("tab", { name: "Обзор", exact: true }).click();
  await page.setViewportSize({ width: 320, height: 640 });
  expect(await overflow(page)).toBeLessThanOrEqual(1);
  expect(await smallTargets(page)).toEqual([]);
  expect((await clipped(page, "main")).wide).toEqual([]);
  if (process.env.SHOTS) {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: `${process.env.SHOTS}/overview-390.png`, fullPage: true });
  }
});
