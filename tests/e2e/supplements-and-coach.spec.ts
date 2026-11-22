import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { round01Fixture } from "./fixtures/round01";
import { makeWorkout } from "../../src/lib/model";
import type { Workout } from "../../src/lib/types";

function benchWorkout(id: string, date: string, weight: number, reps: number, rir: number, setsCount: number): Workout {
  const w = makeWorkout(["bench"], [], "UTC");
  return {
    ...w,
    id,
    name: "Жим и верх",
    date,
    duration: 50,
    createdAt: `${date}T10:00:00.000Z`,
    revision: 1,
    exercises: w.exercises.map((e) => ({
      ...e,
      sets: Array.from({ length: setsCount }, (_, i) => ({
        id: `${id}-s-${i}`,
        weight,
        reps,
        rir,
        warmup: false,
        done: true,
      })),
    })),
  };
}

test("Supplements page and Smart AI Coach work smoothly on desktop and mobile without overflow", async ({ page }) => {
  mkdirSync("artifacts/new-features", { recursive: true });
  const workouts = [
    benchWorkout("w-1", "2026-10-18", 80, 8, 2, 4),
    benchWorkout("w-2", "2026-10-25", 82.5, 8, 2, 4),
    benchWorkout("w-3", "2026-11-02", 85, 8, 2, 4),
    benchWorkout("w-4", "2026-11-08", 90, 8, 0, 10),
    benchWorkout("w-5", "2026-11-09", 90, 8, 0, 12),
  ];

  await page.setViewportSize({ width: 1280, height: 840 });
  await round01Fixture(page, { workouts });

  // TodayDashboard shows both AI Coach card and Supplements card
  await expect(page.locator(".today-smart-card")).toHaveCount(2);

  // 1. Open Supplements page via Today card
  await page.locator(".today-smart-card").filter({ hasText: "Добавки" }).click();
  await expect(page.getByRole("heading", { name: "Добавки", exact: true })).toBeVisible();

  // Add Creatine, Whey Protein, and Gainer
  const catalog = page.locator(".sup-catalog-card");
  await catalog.filter({ hasText: "Креатин моногидрат" }).getByRole("button", { name: "Добавить" }).click();
  await catalog.filter({ hasText: "Сывороточный протеин" }).getByRole("button", { name: "Добавить" }).click();
  await catalog.filter({ hasText: "Гейнер" }).getByRole("button", { name: "Добавить" }).click();
  await expect(page.locator(".sup-card")).toHaveCount(3);

  // Mark Creatine taken today -> progress updates to 33%
  await page.getByRole("button", { name: /Отметить принятым: Креатин/ }).click();
  await expect(page.locator(".sup-ring-center")).toContainText("33%");

  // Mark all taken -> 100%
  await page.getByRole("button", { name: "Отметить всё на сегодня" }).click();
  await expect(page.locator(".sup-ring-center")).toContainText("100%");
  await page.screenshot({ path: "artifacts/new-features/supplements-1280.png", fullPage: false });

  // 2. Open Smart AI Coach in Progress
  await page.getByRole("navigation", { name: "Основная навигация" }).getByRole("button", { name: "Прогресс", exact: true }).click();
  await page.getByRole("tab", { name: "ИИ-анализ", exact: true }).click();
  await expect(page.locator(".coach-hero")).toBeVisible();
  await expect(page.locator(".coach-hero")).toContainText(/Риск перегрузки|перегрузки|Есть перекос/i);
  await expect(page.locator(".coach-insight-card").first()).toBeVisible();
  await page.screenshot({ path: "artifacts/new-features/coach-1280.png", fullPage: false });

  // Check mobile 390px overflow on both screens
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(250);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: "artifacts/new-features/coach-390.png", fullPage: false });

  await page.locator(".journal-supplements").click();
  await expect(page.getByRole("heading", { name: "Добавки", exact: true })).toBeVisible();
  await page.waitForTimeout(250);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: "artifacts/new-features/supplements-390.png", fullPage: false });
});
