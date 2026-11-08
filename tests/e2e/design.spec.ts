import { test, expect, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { DEFAULT_SETTINGS, demoWorkouts, makeExerciseEntry } from "../../src/lib/model";
import { TrainingProgram } from "../../src/domain/TrainingProgram";
import type { AccountProfile } from "../../src/lib/account";

// Entirely browser-isolated fixtures: never forward a request to local D1.
// Run only this spec against the already running preview, not the mutating E2E suite.
const NOW = new Date();
const SHOTS = "artifacts/design";
const PROFILE: AccountProfile = {
  id: "night-session-preview", email: "preview@example.test", displayName: "Атлет",
  timeZone: "Europe/Saratov", bodyMassKg: 80, revision: 1, createdAt: NOW.toISOString(),
};
const ROUTINE = {
  ...TrainingProgram.empty(), id: "preview-upper", name: "Верх тела · A",
  days: [0, 1, 2, 3, 4, 5, 6],
  exercises: ["bench", "lat-pulldown", "ohp", "triceps-push"].map(id => makeExerciseEntry(id)),
};
test.use({ timezoneId: "Europe/Saratov", reducedMotion: "reduce" });

async function preview(page: Page, authenticated = true, savedTheme?: string) {
  let signedIn = authenticated;
  let profile = { ...PROFILE };
  const errors: string[] = [];
  const unexpected: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  // Leave Date/RAF native: fake clock interferes with Motion's cold-load timeline.
  if (savedTheme) await page.addInitScript(value => localStorage.setItem("tyaga_theme_accent", value), savedTheme);
  await page.route("**/api/**", async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const method = request.method();
    const json = (value: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(value) });
    if (path === "/api/auth/session" && method === "GET") return json({ registered: true, profile: signedIn ? profile : null });
    if (path === "/api/data" && method === "GET") return json({ workouts: demoWorkouts(NOW, PROFILE.timeZone), settings: { ...DEFAULT_SETTINGS, timeZone: PROFILE.timeZone, revision: 1 } });
    if (path === "/api/product" && method === "GET") return json({ routines: [ROUTINE], customExercises: [], favorites: ["bench"] });
    if (path === "/api/auth/profile" && method === "PUT") {
      profile = { ...profile, ...request.postDataJSON(), revision: profile.revision + 1 };
      return json({ profile });
    }
    if (path === "/api/auth/login" && method === "POST") {
      if (request.postDataJSON().email === "invalid@example.test") return json({ error: "Проверь почту и пароль" }, 400);
      signedIn = true;
      return json({ profile });
    }
    if (path === "/api/auth/logout" && method === "POST") { signedIn = false; return json({ ok: true }); }
    unexpected.push(`${method} ${path}`);
    return json({ error: "No fixture for this request; nothing was forwarded to D1" }, 503);
  });
  return () => { expect(errors, "No browser runtime errors").toEqual([]); expect(unexpected, "All API calls explicitly mocked").toEqual([]); };
}
async function ready(page: Page) {
  await expect(page.getByRole("heading", { name: "Сегодня", exact: true })).toBeVisible();
  await expect(page.locator("#plan-title")).toHaveText(ROUTINE.name);
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await expect(page.locator(".page-content")).toHaveCSS("opacity", "1");
}
async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
}
async function shot(page: Page, filename: string, fullPage = true) {
  await mkdir(SHOTS, { recursive: true });
  await page.screenshot({ path: `${SHOTS}/${filename}.png`, fullPage });
}

test("dashboard stays readable at phone, tablet and desktop widths", async ({ page }) => {
  const clean = await preview(page);
  for (const width of [360, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: width < 960 ? 844 : 1080 });
    await page.goto("/");
    await ready(page);
    await noOverflow(page);
    await expect(page.getByRole("button", { name: "Начать тренировку", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Мой профиль", exact: true })).toBeVisible();
    const fonts = await page.locator("#plan-title").evaluate(el => getComputedStyle(el).fontFamily);
    expect(fonts).toContain("Oswald");
    await expect(page.locator("html")).toHaveAttribute("data-theme-accent", "lime");
    if (width === 390 || width === 1440) await shot(page, `dashboard-${width}`);
    if (width === 390) await shot(page, "dashboard-390-viewport", false);
  }
  clean();
});

test("profile contract, saved colors and all desktop navigation remain functional", async ({ page }) => {
  const clean = await preview(page, true, "cyan");
  await page.goto("/"); await ready(page);
  await expect(page.locator("html")).toHaveAttribute("data-theme-accent", "cyan");
  await page.getByRole("button", { name: "Мой профиль", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Мой профиль", exact: true });
  await expect(dialog.getByLabel("Имя", { exact: true })).toBeVisible();
  await expect(dialog.getByLabel("Вес тела, кг", { exact: true })).toBeVisible();
  await expect(dialog.getByLabel("Часовой пояс", { exact: true })).toBeVisible();
  await dialog.getByLabel("Имя", { exact: true }).fill("Атлет · тест");
  await dialog.getByRole("button", { name: "Сохранить профиль", exact: true }).click();
  await expect(dialog.getByText("Профиль сохранён", { exact: true })).toBeVisible();
  await dialog.getByTitle("Лайм", { exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme-accent", "lime");
  await expect(dialog.getByRole("button", { name: "Выйти из аккаунта", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  const nav = page.getByRole("navigation", { name: "Основная навигация" });
  for (const [name, title] of [["История", "История тренировок"], ["Прогресс", "Прогресс"], ["Упражнения", "Упражнения"], ["Программы", "Программы"]]) {
    await nav.getByRole("button", { name, exact: true }).click();
    await expect(page.getByRole("heading", { name: title, exact: true, level: 1 })).toBeVisible();
    await expect(page.locator(".page-content")).toHaveCSS("opacity", "1");
    await noOverflow(page);
    if (name === "Прогресс") await shot(page, "progress-1440");
    if (name === "Упражнения") await shot(page, "library-1440");
  }
  await nav.getByRole("button", { name: "Сегодня", exact: true }).click();
  await ready(page);
  clean();
});

test("mobile tool dialogs and workout inputs retain their exact set targets", async ({ page }) => {
  const clean = await preview(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/"); await ready(page);
  for (const [button, title] of [["Калькулятор блинов", "Калькулятор блинов"], ["Калькулятор 1ПМ", "Калькулятор 1ПМ"], ["Разминочная лесенка", "Разминочная лесенка (OpenGym)"]]) {
    await page.getByRole("button", { name: new RegExp(button) }).click();
    await expect(page.getByRole("dialog", { name: title, exact: true })).toBeVisible();
    await noOverflow(page);
    await page.keyboard.press("Escape");
  }
  await page.getByRole("button", { name: "Начать тренировку", exact: true }).click();
  await expect(page.locator(".workout-athletic")).toBeVisible();
  await page.setViewportSize({ width: 360, height: 844 });
  await noOverflow(page);
  await page.setViewportSize({ width: 390, height: 844 });
  const first = page.locator(".exercise-card").first();
  const weights = first.locator("input[aria-label$=', вес']");
  await expect(weights.first()).toBeVisible();
  const secondWeight = await weights.nth(1).inputValue();
  const dock = first.locator(".set-quick-controls-dock");
  const geometry = () => first.evaluate(el => {
    const row = el.querySelector(".set-row")!;
    const tray = el.querySelector(".set-quick-controls-dock")!;
    return [el.getBoundingClientRect().height, row.getBoundingClientRect().height, tray.getBoundingClientRect().height];
  });
  const beforeFocus = await geometry();
  await expect(dock.getByRole("button", { name: "+2.5", exact: true })).toBeDisabled();
  await weights.first().fill("60");
  expect(await geometry()).toEqual(beforeFocus);
  await dock.getByRole("button", { name: "+2.5", exact: true }).click();
  await expect(weights.first()).toHaveValue("62.5");
  await expect(weights.nth(1)).toHaveValue(secondWeight);
  const rirs = first.locator("input[aria-label$=', RIR']");
  const secondRir = await rirs.nth(1).inputValue();
  await dock.locator(".rir-quick-group").getByRole("button", { name: "0", exact: true }).click();
  await expect(rirs.first()).toHaveValue("0");
  await expect(rirs.nth(1)).toHaveValue(secondRir);
  await first.locator(".set-check").first().focus();
  await page.keyboard.press("Tab");
  await expect(dock.locator(".stepper-btn").first()).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(weights.first()).toHaveValue("57.5");
  await expect(weights.nth(1)).toHaveValue(secondWeight);
  await dock.getByRole("button", { name: "+5", exact: true }).click();
  await expect(weights.first()).toHaveValue("62.5");
  await first.locator(".set-check").first().click();
  await expect(first.locator(".set-row").first()).toHaveClass(/done/);
  await noOverflow(page);
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(page.locator(".page-content")).toHaveCSS("opacity", "1");
  await shot(page, "workout-390");
  await shot(page, "workout-390-viewport", false);
  await page.getByRole("button", { name: "Свернуть тренировку", exact: true }).click();
  await expect(page.getByRole("button", { name: "Продолжить тренировку", exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "Продолжить тренировку", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Продолжить тренировку", exact: true }).click();
  await expect(page.locator(".exercise-card").first().locator("input[aria-label$=', вес']").first()).toHaveValue("62.5");
  await page.setViewportSize({ width: 1440, height: 1080 });
  await noOverflow(page);
  await expect(page.locator(".page-content")).toHaveCSS("opacity", "1");
  await shot(page, "workout-1440");
  clean();
});

test("actual authentication screen has safe controls and working error/success transitions", async ({ page }) => {
  const clean = await preview(page, false);
  await page.setViewportSize({ width: 1440, height: 1080 });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Снова в зале", exact: true })).toBeVisible();
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await noOverflow(page);
  await shot(page, "auth-1440");
  await page.setViewportSize({ width: 390, height: 844 });
  await noOverflow(page);
  await shot(page, "auth-390");
  await page.getByLabel("Почта", { exact: true }).fill("invalid@example.test");
  await page.getByLabel("Пароль", { exact: true }).fill("preview passphrase");
  await page.getByRole("button", { name: "Показать пароль", exact: true }).click();
  await expect(page.locator("#auth-password")).toHaveAttribute("type", "text");
  await page.getByRole("button", { name: "Войти в Тягу", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText("Проверь почту и пароль");
  await page.getByLabel("Почта", { exact: true }).fill(PROFILE.email);
  await page.getByRole("button", { name: "Войти в Тягу", exact: true }).click();
  await ready(page);
  clean();
});

test("native motion renders a cold page and completes navigation without background loops", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  const clean = await preview(page);
  await page.goto("/");
  await ready(page);
  const nav = page.getByRole("navigation", { name: "Основная навигация" });
  await nav.getByRole("button", { name: "История", exact: true }).click();
  await expect(page.getByRole("heading", { name: "История тренировок", exact: true })).toBeVisible();
  await expect(page.locator(".page-content")).toHaveCSS("opacity", "1");
  await nav.getByRole("button", { name: "Сегодня", exact: true }).click();
  await ready(page);
  const infiniteAnimations = await page.evaluate(() => document.getAnimations().filter(animation =>
    animation.playState === "running" && animation.effect?.getTiming().iterations === Infinity
  ).length);
  expect(infiniteAnimations).toBe(0);
  clean();
});
