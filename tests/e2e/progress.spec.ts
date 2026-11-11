import { mockWeights } from "./fixtures/bodyweight";
import { mockLive } from "./fixtures/live";
import { test, expect, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { makeWorkout, DEFAULT_SETTINGS } from "../../src/lib/model";

async function setup(page: Page, empty = false) {
  await page.clock.setFixedTime(new Date("2026-11-10T12:00:00Z"));
  const errors: string[] = [],
    unexpected: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const profile = {
    id: "progress-preview",
    displayName: "Саша",
    email: "preview@example.test",
    timeZone: "Europe/Saratov",
    bodyMassKg: 80,
    revision: 1,
    createdAt: new Date().toISOString(),
  };
  const workouts = ["2026-11-01", "2026-11-10"].map((date, i) => {
    const w = makeWorkout(["bench"], [], "UTC");
    w.date = date;
    w.id = `workout-${i}`;
    w.exercises[0].sets[0] = {
      ...w.exercises[0].sets[0],
      done: true,
      weight: 60 + i * 2,
      reps: i ? 5 : 8,
    };
    return w;
  });
  await page.addInitScript(
    ({ id, empty }) => {
      const key = `tyaga-bodyweight:${id}`;
      if (localStorage.getItem(key) === null)
        localStorage.setItem(
          key,
          JSON.stringify(
            empty
              ? []
              : [
                  {
                    id: "one",
                    date: "2026-11-08",
                    weightKg: 60.5,
                    createdAt: 1,
                  },
                  {
                    id: "two",
                    date: "2026-11-10",
                    weightKg: 61.5,
                    note: "До ужина, после зала. Длинная заметка для проверки переноса текста без перекрытия графика.",
                    createdAt: 2,
                  },
                ],
          ),
        );
      if (!empty && !localStorage.getItem(`tyaga-bodyweight-goal:${id}`))
        localStorage.setItem(
          `tyaga-bodyweight-goal:${id}`,
          JSON.stringify({ targetWeightKg: 70, startWeightKg: 60.5 }),
        );
    },
    { id: profile.id, empty },
  );
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    const json = (data: unknown) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(data),
      });
    if (path === "/api/auth/session")
      return json({ registered: true, profile });
    if (path === "/api/data")
      return json({
        workouts,
        settings: { ...DEFAULT_SETTINGS, timeZone: profile.timeZone },
      });
    if (path === "/api/product")
      return json({ routines: [], favorites: [], customExercises: [] });
    unexpected.push(path);
    return route.fulfill({ status: 503, body: "{}" });
  });
  await mockWeights(page,profile.id);
  await mockLive(page);
  await page.goto("/");
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Прогресс", exact: true })
    .click();
  return () => {
    expect(errors).toEqual([]);
    expect(unexpected).toEqual([]);
  };
}
async function weightTab(page: Page) {
  await page.getByRole("tab", { name: "Вес тела", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Вес и его динамика" }),
  ).toBeVisible();
}
async function shot(page: Page, name: string) {
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  const path = page.locator(".progress-chart path").first();
  if (await path.count())
    await expect(path).toHaveCSS("stroke-dashoffset", "0px");
  await mkdir("artifacts/progress", { recursive: true });
  await page.screenshot({
    path: `artifacts/progress/${name}.png`,
    fullPage: true,
  });
}
async function noOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - innerWidth,
    ),
  ).toBeLessThanOrEqual(1);
}

test("bodyweight: remote goal keeps a compact chart, long notes and point selection stay readable", async ({
  page,
}) => {
  const clean = await setup(page);
  await weightTab(page);
  await expect(page.getByText("От 3 замеров за 7 дней и больше")).toBeVisible();
  await expect(page.getByText(/Цель 70 кг — вне диапазона/)).toBeVisible();
  await expect(page.locator(".progress-chart svg")).toHaveCSS(
    "height",
    "230px",
  );
  await page
    .getByLabel("Выбрать запись", { exact: true })
    .selectOption("2026-11-08");
  await expect(page.locator(".progress-chart-readout strong")).toContainText(
    "60,5",
  );
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: width < 960 ? 844 : 1080 });
    await noOverflow(page);
    if (width === 390 || width === 1440) await shot(page, `weight-${width}`);
  }
  await page
    .getByRole("button", { name: "Изменить цель", exact: true })
    .click();
  await page.getByLabel("Целевой вес, кг", { exact: true }).fill("70,5");
  await page
    .getByRole("button", { name: "Сохранить цель", exact: true })
    .click();
  await expect(page.getByText("Цель: 70,5 кг", { exact: true })).toBeVisible();
  clean();
});

test("weighing CRUD accepts commas, keeps notes and history across reload, confirms deletion", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const clean = await setup(page, true);
  await weightTab(page);
  await expect(page.getByLabel("Вес, кг", { exact: true })).toHaveValue("");
  await page.getByLabel("Вес, кг", { exact: true }).fill("61,5");
  await page.getByLabel("Заметка", { exact: true }).fill("Утром");
  await page
    .getByRole("button", { name: "Сохранить замер", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "Замер сохранён" }),
  ).toBeVisible();
  const date = await page
    .getByLabel("Дата взвешивания", { exact: true })
    .inputValue();
  await page.reload();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Прогресс", exact: true })
    .click();
  await weightTab(page);
  await expect(page.locator(".weight-history-row")).toHaveCount(1);
  await page
    .getByRole("button", { name: `Изменить замер ${date}`, exact: true })
    .click();
  await page.getByLabel("Вес, кг", { exact: true }).fill("61,7");
  await page.getByLabel("Заметка", { exact: true }).fill("");
  await page
    .getByRole("button", { name: "Обновить замер", exact: true })
    .click();
  await expect(page.locator(".weight-history-row")).toHaveCount(1);
  await expect(page.locator(".weight-history-row")).toContainText(
    "Без заметки",
  );
  await page
    .getByRole("button", { name: `Удалить замер ${date}`, exact: true })
    .click();
  await expect(page.locator(".weight-history-row")).toHaveCount(1);
  await page
    .getByRole("button", { name: "Подтвердить удаление", exact: true })
    .click();
  await expect(page.locator(".weight-history-row")).toHaveCount(0);
  clean();
});

test("storage failure preserves the entered value and previously saved measurements", async ({
  page,
}) => {
  const clean = await setup(page);
  await weightTab(page);
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith("tyaga-bodyweight"))
        throw new DOMException("Quota", "QuotaExceededError");
      return original.call(this, key, value);
    };
  });
  await page.getByLabel("Вес, кг", { exact: true }).fill("62,3");
  await page
    .getByRole("button", { name: "Обновить замер", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("Не удалось сохранить");
  await expect(page.getByLabel("Вес, кг", { exact: true })).toHaveValue("62,3");
  await expect(page.locator(".weight-history-row")).toHaveCount(2);
  clean();
});

test("statistics and strength share volume rules, keyboard navigation and settled Motion", async ({
  page,
}) => {
  const clean = await setup(page);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.getByRole("tab", { name: "Обзор", exact: true }).click();
  await expect(page.locator(".progress-analytics")).toHaveCSS("opacity", "1");
  await expect(
    page.locator(".progress-metric").filter({ hasText: "Нагрузка" }),
  ).toContainText("0,8");
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await noOverflow(page);
    await shot(page, `statistics-${width}`);
  }
  await page
    .getByRole("button", { name: /Динамика силы: Жим штанги лёжа/ })
    .click();
  await expect(
    page.getByRole("tab", { name: "Сила", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".progress-chart-readout b")).toContainText(
    "5 повторений",
  );
  await page
    .getByLabel("Выбрать запись", { exact: true })
    .selectOption("workout-0");
  await expect(page.locator(".progress-chart-readout b")).toContainText(
    "8 повторений",
  );
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await noOverflow(page);
    await shot(page, `strength-${width}`);
  }
  expect(
    await page.evaluate(
      () =>
        document
          .getAnimations()
          .filter(
            (a) =>
              a.playState === "running" &&
              a.effect?.getTiming().iterations === Infinity,
          ).length,
    ),
  ).toBe(0);
  clean();
});
