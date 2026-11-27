import { test, expect } from "@playwright/test";
import { round01Fixture } from "./fixtures/round01";
import { PeriodizationRules } from "../../src/domain/PeriodizationRules";
import type { Routine } from "../../src/lib/types";

test("David Laid DUP v3 creates 5-day cycle with 8 side-delt sets, supersets, and live RTS backoff in WorkoutView", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await round01Fixture(page, { workouts: [] });

  const store: Routine[] = [];
  await page.route("**/api/product", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ routines: store, favorites: [], customExercises: [] }),
    }),
  );
  await page.route("**/api/routines", (route) => {
    if (route.request().method() !== "PUT") return route.fallback();
    const body = route.request().postDataJSON() as Routine;
    if (body.periodization) {
      const check = PeriodizationRules.check(body.periodization);
      if (!check.ok) {
        return route.fulfill({
          status: 400,
          contentType: "application/json",
          body: JSON.stringify({ error: check.message }),
        });
      }
    }
    const at = store.findIndex((r) => r.id === body.id);
    const saved = { ...body, revision: (at === -1 ? 0 : store[at].revision) + 1, updatedAt: new Date().toISOString() };
    if (at === -1) store.unshift(saved);
    else store[at] = saved;
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ routine: saved }) });
  });

  await page
    .getByRole("navigation", { name: "Основная навигация" })
    .getByRole("button", { name: "Программы", exact: true })
    .click();

  await page
    .getByRole("button", { name: /Hypertrophy Max · DUP v3/ })
    .click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("DUP v3 · Hypertrophy & Strength Max");
  await expect(dialog).toContainText("8 сетов сред. дельты");

  await dialog.getByRole("textbox", { name: /присед/i }).fill("140");
  await dialog.getByRole("textbox", { name: /жим лёжа/i }).fill("100");
  await dialog.getByRole("textbox", { name: /трэп-гриф/i }).fill("160");
  await dialog.getByRole("textbox", { name: /наклонный жим/i }).fill("80");

  // Preview inside modal shows exactly 5 v3 days
  await expect(dialog.locator(".laid-preview-grid li")).toHaveCount(5);
  await expect(dialog.locator(".laid-preview-grid")).toContainText("Верх B");
  await expect(dialog.locator(".laid-preview-grid")).toContainText("Низ B");

  await dialog.getByRole("button", { name: "Создать программу" }).click();

  const card = page.locator(".laid-card");
  await expect(card).toBeVisible();
  await expect(card).toContainText("Дэвид Лейд · DUP v3 (Hypertrophy Max)");
  await expect(card).toContainText("DUP v3 · 5+1");
  await expect(card.locator(".laid-day-tile")).toHaveCount(5);

  // Expand Верх B and verify supersets + 4 sets on lateral raises
  await card.getByRole("button", { name: /Состав и веса: Верх B/ }).click();
  await expect(card.locator(".laid-day-exercises")).toContainText("SS A1");
  await expect(card.locator(".laid-day-exercises")).toContainText("SS B1");
  await expect(card.locator(".laid-day-exercises")).toContainText("4 × 12–18");

  // Start Ноги A and verify live v3 workout view
  await card.locator(".laid-day-tile").first().getByRole("button", { name: "Начать" }).click();
  await expect(page.locator(".workout-screen")).toBeVisible();
  await expect(page.locator(".workout-screen")).toContainText(/RIR 2,5|откат −14/);

  // Zero overflow check at desktop & mobile
  const desktopOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(desktopOverflow).toBeLessThanOrEqual(1);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(200);
  const mobileOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(mobileOverflow).toBeLessThanOrEqual(1);
});
