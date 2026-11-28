import { expect, test } from "@playwright/test";
import { doneWorkout, nav, round01Fixture } from "./fixtures/round01";

test("empty journal reports no readiness instead of certifying healthy muscles", async ({ page }) => {
  const fixture = await round01Fixture(page);
  const today = page.getByRole("region", { name: "Готовность мышц", exact: true });
  await expect(today).toContainText(/нет данных/i);
  await today.locator("summary").click();
  await expect(today).not.toContainText("100%");

  await nav(page, "Прогресс").click();
  const fatigue = page.getByRole("region", { name: "Контроль усталости" });
  await expect(fatigue).toContainText("Нет недавних записей");
  await expect(fatigue).not.toContainText("ЦНС");
  const groups = page.getByRole("region", { name: "Готовность 12 мышечных групп" });
  await expect(groups).toContainText(/нет данных/i);
  await expect(groups).not.toContainText("100%");
  expect(fixture.errors).toEqual([]);
});

test("a bench session supplies a chest index but not an index for unlogged calves", async ({ page }) => {
  await round01Fixture(page, { workouts: [doneWorkout("Жим", "2026-11-09", [["bench", 80, 6, 3]])] });
  await nav(page, "Прогресс").click();
  const fatigue = page.getByRole("region", { name: "Контроль усталости" });
  await expect(fatigue).toContainText(/не измерение/i);
  await expect(fatigue).toContainText("Осевая нагрузка");
  const groups = page.getByRole("region", { name: "Готовность 12 мышечных групп" });
  await expect(groups.locator(".coach-readiness-chip").filter({ hasText: "Грудь" })).toContainText(/\d+%/);
  await expect(groups.locator(".coach-readiness-chip").filter({ hasText: "Икры" })).toContainText("Нет данных");
});
