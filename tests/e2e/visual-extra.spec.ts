import { test, expect, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { DEFAULT_SETTINGS, demoWorkouts, makeExerciseEntry } from "../../src/lib/model";
import { TrainingProgram } from "../../src/domain/TrainingProgram";
import { mockWeights } from "./fixtures/bodyweight";
import { mockLive } from "./fixtures/live";
import { mockImportRuns } from "./fixtures/importRuns";
import type { AccountProfile } from "../../src/lib/account";

// Визуальный обход поверхностей: окна, инструменты, живая анимация.
// Все ответы API замоканы в браузере — стенд и D1 не нужны.
const NOW = new Date();
const SHOTS = "artifacts/design-quiet";
const PROFILE: AccountProfile = {
  id: "iron-preview",
  email: "iron@example.test",
  displayName: "Атлет",
  timeZone: "Europe/Saratov",
  bodyMassKg: 80,
  revision: 1,
  createdAt: NOW.toISOString(),
};
const ROUTINE = {
  ...TrainingProgram.empty(),
  id: "iron-upper",
  name: "Верх тела · A",
  days: [0, 1, 2, 3, 4, 5, 6],
  exercises: ["bench", "lat-pulldown", "ohp", "triceps-push"].map((id) => makeExerciseEntry(id)),
};

test.use({ timezoneId: "Europe/Saratov", viewport: { width: 1440, height: 1080 } });

async function preview(page: Page) {
  const unexpected: string[] = [];
  page.on("pageerror", (error) => unexpected.push("pageerror: " + error.message));
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const method = request.method();
    const json = (value: unknown, status = 200) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(value) });
    if (path === "/api/auth/session") return json({ registered: true, profile: PROFILE });
    if (path === "/api/data" && method === "GET")
      return json({
        workouts: demoWorkouts(NOW, PROFILE.timeZone),
        settings: { ...DEFAULT_SETTINGS, timeZone: PROFILE.timeZone, revision: 1 },
      });
    if (path === "/api/product" && method === "GET")
      return json({ routines: [ROUTINE], customExercises: [], favorites: ["bench"] });
    if (path === "/api/auth/profile" && method === "PUT")
      return json({ profile: { ...PROFILE, ...request.postDataJSON() } });
    if (path === "/api/settings" && method === "PUT") return json({ settings: DEFAULT_SETTINGS });
    if (path === "/api/machines" || path.startsWith("/api/machines/")) return json({ machines: [] });
    unexpected.push(method + " " + path);
    return json({ error: "no fixture" }, 503);
  });
  await mockWeights(page, PROFILE.id);
  await mockLive(page);
  await mockImportRuns(page);
  return () => expect(unexpected, "Все запросы API замоканы").toEqual([]);
}
async function ready(page: Page) {
  await expect(page.getByRole("heading", { name: "Сегодня", exact: true })).toBeVisible();
  await expect(page.locator("#plan-title")).toHaveText(ROUTINE.name);
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await expect(page.locator(".page-content")).toHaveCSS("opacity", "1");
}
async function shot(page: Page, name: string, fullPage = false) {
  await mkdir(SHOTS, { recursive: true });
  await page.screenshot({ path: SHOTS + "/" + name + ".png", fullPage });
}

test("живая анимация и окна выглядят цельно", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  const clean = await preview(page);
  await page.goto("/");
  // Кадр на середине входа: содержимое уже на месте и не мигает пустотой.
  await expect(page.locator("#plan-title")).toBeVisible();
  await shot(page, "entrance-1440", false);
  await ready(page);
  await shot(page, "dashboard-1440", true);

  await expect(page.locator(".training-hero img")).toHaveCount(0);
  const indicator = page.locator(".week-meter-fill");
  await expect(indicator).toBeVisible();
  await expect.poll(() => indicator.evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).a)).toBeGreaterThan(0);

  await page.getByRole("button", { name: "Мой профиль", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Мой профиль", exact: true });
  await expect(dialog).toBeVisible();
  await page.waitForTimeout(500);
  await shot(page, "profile-dialog-1440", false);
  await page.keyboard.press("Escape");
  await expect(page.locator("dialog.modal")).toHaveCount(0);

  await page.getByRole("button", { name: "Ещё", exact: true }).last().click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.waitForTimeout(450);
  await shot(page, "tools-dialog-1440", false);
  await page.keyboard.press("Escape");
  await expect(page.locator("dialog.modal")).toHaveCount(0);

  const nav = page.getByRole("navigation", { name: "Основная навигация" });
  const historyTab = nav.getByRole("button", { name: "История", exact: true });
  const positions = await historyTab.evaluate(async (button) => {
    const nav = button.closest("nav")!;
    const start = nav.querySelector(".journal-tab-marker")!.getBoundingClientRect().top;
    const target = button.getBoundingClientRect().top + 10;
    const samples: number[] = [];
    (button as HTMLButtonElement).click();
    for (let i = 0; i < 22; i++) {
      await new Promise(requestAnimationFrame);
      const marker = nav.querySelector(".journal-tab-marker");
      if (marker) samples.push(marker.getBoundingClientRect().top);
    }
    return { start, target, samples };
  });
  expect(positions.samples.some((y) => y > positions.start + 4 && y < positions.target - 4), JSON.stringify(positions)).toBe(true);
  await expect(historyTab).toHaveAttribute("aria-current", "page");
  await expect(historyTab.locator(".journal-tab-marker")).toHaveCount(1);
  await expect(
    page.getByRole("heading", { name: "История тренировок", exact: true }),
  ).toBeVisible();
  await page.waitForTimeout(500);
  await shot(page, "history-1440", true);
  await nav.getByRole("button", { name: "Программы", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Программы", exact: true, level: 1 }),
  ).toBeVisible();
  await page.waitForTimeout(500);
  await shot(page, "programs-1440", true);
  await nav.getByRole("button", { name: "Сегодня", exact: true }).click();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await ready(page);
  await shot(page, "dashboard-390", true);
  await shot(page, "dashboard-390-viewport", false);
  await page.getByRole("navigation", { name: "Основная навигация" })
    .getByRole("button", { name: "История", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "История тренировок", exact: true }),
  ).toBeVisible();
  await page.waitForTimeout(500);
  await shot(page, "history-390", true);
  clean();
});

test("на телефоне окна не вылезают за экран", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const clean = await preview(page);
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto("/");
  await ready(page);
  for (const [button, name] of [
    ["Мой профиль", "profile-dialog-360"],
    ["Ещё", "tools-dialog-360"],
  ] as const) {
    if (typeof button === "string")
      await page.getByRole("button", { name: button, exact: true }).click();
    else await page.getByRole("button", { name: button }).last().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await page.waitForTimeout(350);
    const overflow = await page.evaluate(() => {
      const node = document.querySelector("dialog.modal") as HTMLElement | null;
      if (!node) return 0;
      const rect = node.getBoundingClientRect();
      return Math.max(0, rect.right - window.innerWidth, -rect.left);
    });
    expect(overflow, "окно шире экрана: " + name).toBeLessThanOrEqual(1);
    await shot(page, name, false);
    await page.keyboard.press("Escape");
    await expect(page.locator("dialog.modal")).toHaveCount(0);
  }
  clean();
});

test("на 320 px дашборд и таббар влезают в экран", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const clean = await preview(page);
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto("/");
  await ready(page);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, "горизонтальная прокрутка").toBeLessThanOrEqual(1);
  const clipped = await page
    .locator(".sidebar .nav-item span")
    .evaluateAll((nodes) =>
      nodes
        .filter((node) => node.scrollWidth > node.clientWidth + 1)
        .map((node) => node.textContent),
    );
  expect(clipped, "подписи таббара вылезают").toEqual([]);
  await shot(page, "dashboard-320", true);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  await expect(page.getByRole("button", { name: "Начать тренировку", exact: true })).toBeVisible();
  const lastTab = page.getByRole("navigation", { name: "Основная навигация" }).getByRole("button", { name: "Друзья", exact: true });
  await lastTab.focus();
  await expect(lastTab).toBeInViewport();
  await lastTab.click();
  await expect(lastTab).toHaveAttribute("aria-current", "page");
  await expect(lastTab.locator(".journal-tab-marker")).toHaveCSS("transform", "none");
  clean();
});
