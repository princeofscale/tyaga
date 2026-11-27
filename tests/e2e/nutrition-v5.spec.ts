import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { round01Fixture } from "./fixtures/round01";

test("Tyaga v5 AdaptiveNutritionPanel works in Lite & Pro modes on desktop (1280px) and mobile (390px)", async ({ page }) => {
  mkdirSync("artifacts/nutrition-v5-check", { recursive: true });

  await page.setViewportSize({ width: 1280, height: 900 });
  await round01Fixture(page, { workouts: [] });

  await page
    .getByRole("navigation", { name: "Основная навигация" })
    .getByRole("button", { name: "Прогресс", exact: true })
    .click();
  await page.getByRole("tab", { name: "Вес тела", exact: true }).click();

  const panel = page.locator(".nut-shell");
  await expect(panel).toBeVisible();
  await expect(panel.locator(".nut-mode-badge")).toContainText("LITE");
  await expect(panel).toContainText("Пол RED-S");

  // Record a weigh-in so trend & Pro calibration have a baseline
  await page.getByLabel("Вес, кг").fill("82.0");
  await page.getByRole("button", { name: /Сохранить замер|Обновить замер/ }).click();

  // Select lean_bulk phase via choice card & test DUP v2 carb-cycling tabs
  await panel.getByText("Сухой набор").click();
  await panel.getByRole("tab", { name: /Отдых/ }).click();
  await expect(panel.locator(".nut-macro-tag")).toContainText("Отдых");
  await panel.getByRole("tab", { name: /Ноги/ }).click();
  await expect(panel.locator(".nut-macro-tag")).toContainText("Ноги");

  // Log calories to activate Pro mode
  await panel.locator('input[name="caloriesKcal"]').fill("3250");
  await panel.locator('input[name="proteinG"]').fill("155");
  await panel.getByRole("button", { name: "Сохранить день" }).click();

  await expect(panel.locator(".nut-mode-badge")).toContainText("PRO");
  await expect(panel).toContainText("1 дн. в базе");

  // Desktop 1280px overflow check & screenshot
  const desktopOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(desktopOverflow).toBeLessThanOrEqual(1);
  await panel.scrollIntoViewIfNeeded();
  await panel.screenshot({ path: "artifacts/nutrition-v5-check/v5-desktop-1280.png" });

  // Mobile 390px overflow check & screenshot
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(250);
  const mobileOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(mobileOverflow).toBeLessThanOrEqual(1);
  await panel.scrollIntoViewIfNeeded();
  await panel.screenshot({ path: "artifacts/nutrition-v5-check/v5-mobile-390.png" });
});
