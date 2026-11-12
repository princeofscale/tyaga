import { test, expect, type Page } from "@playwright/test";
import { DEFAULT_SETTINGS, addCalendarDays, localDate, makeWorkout } from "../../src/lib/model";
import { mockWeights } from "./fixtures/bodyweight";
import type { Workout } from "../../src/lib/types";

const today = localDate(new Date(), "UTC");

function fixture(id: string, date = today, count = 4) {
  const w = makeWorkout([id], [], "UTC");
  w.date = date;
  w.exercises[0].sets = Array.from({ length: count }, (_, i) => ({
    id: `s-${i}`, weight: 60, reps: 10, rir: 2, warmup: false, done: true,
  }));
  return w;
}

async function preview(page: Page, workouts: Workout[]) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    const data = path === "/api/auth/session"
      ? { registered: true, profile: { id: "biomechanics", email: "biomechanics@example.test", displayName: "Атлет", timeZone: "UTC", revision: 1, createdAt: new Date().toISOString() } }
      : path === "/api/data"
        ? { workouts, settings: { ...DEFAULT_SETTINGS, timeZone: "UTC", revision: 1 } }
        : path === "/api/product"
          ? { routines: [], customExercises: [], favorites: [] }
          : { error: `Unexpected fixture request: ${path}` };
    return route.fulfill({ status: "error" in data ? 503 : 200, contentType: "application/json", body: JSON.stringify(data) });
  });
  await mockWeights(page, "biomechanics");
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Сегодня", exact: true })).toBeVisible();
  return () => expect(errors).toEqual([]);
}

async function tool(page: Page, name: string) {
  await page.getByRole("button", { name: /^Инструменты/ }).last().click();
  await page.getByRole("button", { name: new RegExp(name) }).click();
}

test("volume tool uses a full rolling week and assistance despite the atlas week/RIR filter", async ({ page }) => {
  const pull = fixture("lat-pulldown");
  pull.exercises[0].sets.forEach((s, i) => s.rir = [0, 3, 4, null][i]);
  const clean = await preview(page, [
    pull, fixture("bench", addCalendarDays(today, -7), 30),
    fixture("bench", addCalendarDays(today, 1), 30),
  ]);
  await page.getByRole("navigation", { name: "Основная навигация" })
    .getByRole("button", { name: "Прогресс", exact: true }).click();
  await page.getByRole("tab", { name: "Мышцы", exact: true }).click();
  await page.getByRole("button", { name: "Предыдущая неделя", exact: true }).click();
  await page.getByLabel("Только RIR ≤ 3").check();
  await tool(page, "Объём по мышцам");
  const dialog = page.getByRole("dialog", { name: "Ориентиры недельного объёма", exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(/последние 7 дней/)).toBeVisible();
  const biceps = dialog.locator(".rp-muscle-item").filter({ hasText: "Сгибатели локтя" });
  await expect(biceps.locator(".rp-sets-counter b")).toHaveText("2");
  await expect(biceps).toContainText("из них при RIR ≤ 3: 1 экв. подх.");
  await expect(dialog).toContainText("Без RIR: 1 из 4 рабочих подходов");
  const chest = dialog.locator(".rp-muscle-item").filter({ hasText: "Грудь" });
  await expect(chest.locator(".rp-sets-counter b")).toHaveText("0");
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await dialog.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
  }
  await page.screenshot({ path: "artifacts/biomechanics-volume.png", fullPage: true });
  clean();
});

test("library, atlas and regional counters agree on rear deltoid fly", async ({ page }) => {
  const clean = await preview(page, [fixture("rear-delt-fly", today, 3)]);
  const nav = page.getByRole("navigation", { name: "Основная навигация" });
  await nav.getByRole("button", { name: "Упражнения", exact: true }).click();
  await page.getByLabel("Поиск упражнений", { exact: true }).fill("Обратные разведения");
  // A label comes from the explicit deltoid role, never the word 'fly'.
  await expect(page.locator(".library-head-tag").filter({ hasText: "Задняя дельта" })).toBeVisible();
  await expect(page.locator(".library-head-tag").filter({ hasText: "Середина груди" })).toHaveCount(0);
  await nav.getByRole("button", { name: "Прогресс", exact: true }).click();
  await page.getByRole("tab", { name: "Мышцы", exact: true }).click();
  await page.getByRole("tab", { name: "Карта мышц", exact: true }).click();
  await page.getByRole("button", { name: "Плечи", exact: true }).click();
  const head = page.locator(".head-card").filter({ hasText: "Задняя дельта" });
  await expect(head).toContainText("3 прямых");
  await expect(page.locator(".anatomy-recommendations")).toContainText("Обратные разведения на заднюю дельту");
  clean();
});

test("deload never treats a planned or future workout as completed work", async ({ page }) => {
  const planned = fixture("bench", today, 20);
  planned.exercises[0].sets.forEach((s) => { s.done = false; s.rir = 0; });
  const clean = await preview(page, [planned, fixture("bench", addCalendarDays(today, 1), 20)]);
  await tool(page, "Разгрузочная неделя");
  const dialog = page.getByRole("dialog", { name: "Настройка разгрузочной недели", exact: true });
  await expect(dialog).toContainText("Нет записанной работы за 30 дней");
  await expect(dialog.locator(".fatigue-score-val")).toHaveText("0");
  await expect(dialog).toContainText("не измерение усталости или восстановления");
  clean();
});
