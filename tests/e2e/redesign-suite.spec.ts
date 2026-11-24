import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { doneWorkout, round01Fixture, startWith } from "./fixtures/round01";

test("All redesigned screens work cleanly on desktop and mobile with zero overflow", async ({ page }) => {
  mkdirSync("artifacts/redesign-check", { recursive: true });
  const workouts = [
    doneWorkout("Жим и грудь", "2026-11-08", [
      ["bench", 80, 8, 2],
      ["bench", 80, 8, 2],
      ["bench", 80, 8, 2],
      ["bench", 80, 8, 2],
      ["pushup", 0, 15, 2],
      ["pushup", 0, 15, 2],
      ["pushup", 0, 15, 2],
      ["pushup", 0, 15, 2],
    ]),
    doneWorkout("Спина и ноги", "2026-11-10", [
      ["lat-pulldown", 65, 10, 2],
      ["lat-pulldown", 65, 10, 2],
      ["lat-pulldown", 65, 10, 2],
      ["squat", 100, 6, 2],
      ["squat", 100, 6, 2],
      ["squat", 100, 6, 2],
      ["squat", 100, 6, 2],
    ]),
  ];

  await page.setViewportSize({ width: 1280, height: 860 });
  const fixture = await round01Fixture(page, { workouts });

  // 1. TodayDashboard weekly load clearly explains the goal (not cryptic 0/80)
  await expect(page.locator(".week-summary")).toContainText("экв. подх.");

  // 2. Progress -> Overview, Muscles (MV/MEV/MAV/MRV), Body Map, Bodyweight
  await page.getByRole("navigation", { name: "Основная навигация" }).getByRole("button", { name: "Прогресс", exact: true }).click();
  await expect(page.locator(".progress-overview")).toBeVisible();
  await page.screenshot({ path: "artifacts/redesign-check/progress-overview-1280.png" });

  await page.getByRole("tab", { name: "Мышцы", exact: true }).click();
  await expect(page.locator(".mv-row-card").first()).toBeVisible();
  await expect(page.locator(".mv-list")).toContainText("Грудь");
  await expect(page.locator(".mv-list")).toContainText(/Поддержка|Начальный рост|Набор массы|Нет нагрузки/);
  await expect(page.getByText("Закрыть пробелы")).toHaveCount(0);
  await page.locator(".mv-row-card").first().locator("button.mv-row-trigger").click();
  await expect(page.locator(".mv-detail-body").first()).toBeVisible();
  await page.screenshot({ path: "artifacts/redesign-check/progress-muscles-1280.png" });

  await page.getByRole("tab", { name: "Сила", exact: true }).click();
  await expect(page.locator(".strength-telemetry")).toBeVisible();
  await page.screenshot({ path: "artifacts/redesign-check/progress-strength-1280.png" });

  await page.getByRole("tab", { name: "Мышцы", exact: true }).click();
  await page.getByRole("tab", { name: "Карта мышц", exact: true }).click();
  await expect(page.locator(".anat-stage")).toBeVisible();
  await expect(page.locator(".anat-hero")).toBeVisible();
  await expect(page.getByText("Интерактивный атлас мышц.")).toHaveCount(0);
  await page.screenshot({ path: "artifacts/redesign-check/progress-anatomy-1280.png" });

  await page.getByRole("tab", { name: "Вес тела", exact: true }).click();
  await expect(page.locator(".bw-hero")).toBeVisible();
  await page.screenshot({ path: "artifacts/redesign-check/progress-bodyweight-1280.png" });

  // 3. Exercises Library (clean cards, no internal review badges)
  await page.getByRole("navigation", { name: "Основная навигация" }).getByRole("button", { name: "Упражнения", exact: true }).click();
  await expect(page.locator(".exlib-card").first()).toBeVisible();
  await expect(page.locator(".library-index")).toHaveCount(0);
  await page.screenshot({ path: "artifacts/redesign-check/exercises-1280.png" });

  // 4. Supplements: numeric dose validation, drag handle, day & week planner
  await page.getByRole("button", { name: "Добавки", exact: true }).first().click();
  await expect(page.getByRole("heading", { name: "Добавки", exact: true })).toBeVisible();
  const catalog = page.locator(".sup-catalog-card");
  await catalog.filter({ hasText: "Креатин моногидрат" }).getByRole("button", { name: "Добавить" }).click();
  await catalog.filter({ hasText: "Омега-3" }).getByRole("button", { name: "Добавить" }).click();

  // Check drag handle exists & edit Creatine dose (numeric input blocks text)
  await expect(page.locator(".sup-drag-handle")).toHaveCount(2);
  await page.getByRole("button", { name: "Настроить Креатин моногидрат" }).click();
  const doseInput = page.getByLabel("Дозировка для Креатин моногидрат", { exact: true });
  await expect(doseInput).toHaveAttribute("type", "number");
  await doseInput.fill("7.5");
  await expect(page.locator(".sup-card").first()).toContainText("7,5 г");
  await page.screenshot({ path: "artifacts/redesign-check/supplements-stack-1280.png" });

  // Switch to Day plan and Week plan
  await page.getByRole("tab", { name: "План на день" }).click();
  await expect(page.locator(".sup-day-timeline")).toBeVisible();
  await page.getByRole("tab", { name: "План на неделю" }).click();
  await expect(page.locator(".sup-week-planner")).toBeVisible();
  await page.screenshot({ path: "artifacts/redesign-check/supplements-week-1280.png" });

  // 5. Workout: auto duration (no manual number input) + polished Undo toast
  await page.getByRole("navigation", { name: "Основная навигация" }).getByRole("button", { name: "Сегодня", exact: true }).click();
  await startWith(page, "Жим штанги лёжа");
  await page.getByRole("button", { name: "Дата, длительность и заметки" }).click();
  await expect(page.locator(".workout-auto-duration")).toBeVisible();
  await expect(page.locator(".workout-auto-duration")).toContainText("Авто");
  await expect(page.getByLabel("Длительность тренировки, минуты")).toHaveCount(0);

  // Trigger set deletion to verify polished Undo toast + 3s auto-dismiss
  await page.getByRole("button", { name: "Убрать последний подход" }).click();
  await expect(page.locator(".workout-undo")).toBeVisible();
  await expect(page.locator(".workout-undo-title")).toHaveText("Подход удалён");
  await expect(page.locator(".workout-undo-btn")).toBeVisible();
  await page.screenshot({ path: "artifacts/redesign-check/workout-undo-1280.png" });
  await expect(page.locator(".workout-undo")).toBeHidden({ timeout: 4500 });

  // Switch to «В зале» mode and verify exercise can be removed & undone
  await page.getByRole("button", { name: "Режим «В зале»", exact: true }).click();
  await expect(page.locator(".gym-remove-exercise")).toBeVisible();
  await page.screenshot({ path: "artifacts/redesign-check/workout-gym-remove-1280.png" });
  await page.getByRole("button", { name: "Убрать упражнение: Жим штанги лёжа" }).click();
  await expect(page.locator(".workout-undo-title")).toHaveText("Упражнение убрано");
  await page.getByRole("button", { name: "Отменить удаление" }).click();
  await expect(page.locator(".workout-gym-card h2")).toHaveText("Жим штанги лёжа");

  // Mobile 390px overflow checks
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(200);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: "artifacts/redesign-check/workout-undo-390.png" });

  expect(fixture.errors).toEqual([]);
});
