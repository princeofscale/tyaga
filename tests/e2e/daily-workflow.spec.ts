import { test, expect, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { DEFAULT_SETTINGS, makeWorkout } from "../../src/lib/model";
import { mockWeights, weightFixture } from "./fixtures/bodyweight";
import type { FriendsData } from "../../src/domain/FriendsService";
import type { TrainingMeetup } from "../../src/domain/TrainingMeetups";
test.use({ timezoneId: "Europe/Saratov" });

const NOW = new Date("2026-11-10T12:00:00Z");
function social(): FriendsData {
  return {
    me: {
      id: "daily-user",
      displayName: "Саша",
      inviteCode: "A1B2C3D4E5F6",
      gym: "",
      focus: "",
      activeUntil: 0,
      weekWorkouts: 0,
      weeklyTarget: 3,
    },
    friends: [
      {
        id: "friend",
        displayName: "Дима",
        gym: "Другой зал",
        focus: "Спина",
        activeUntil: 0,
        weekWorkouts: 2,
        weeklyTarget: 3,
      },
    ],
    requests: [],
    feed: [],
    meetups: [],
    weekStart: "2026-11-09",
    today: "2026-11-10",
    serverTime: NOW.getTime(),
  };
}
async function fixture(page: Page, weights = weightFixture(), data = social()) {
  await page.clock.setFixedTime(NOW);
  const workouts: ReturnType<typeof makeWorkout>[] = [];
  const errors: string[] = [],
    unexpected: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/api/**", async (route) => {
    const r = route.request(),
      path = new URL(r.url()).pathname,
      method = r.method();
    const json = (body: unknown, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    if (path === "/api/auth/session")
      return json({
        registered: true,
        profile: {
          id: data.me.id,
          email: "daily@example.test",
          displayName: "Саша",
          timeZone: "Europe/Saratov",
          bodyMassKg: null,
          revision: 1,
          createdAt: NOW.toISOString(),
        },
      });
    if (path === "/api/data")
      return json({
        workouts,
        settings: { ...DEFAULT_SETTINGS, timeZone: "Europe/Saratov" },
      });
    if (path === "/api/product")
      return json({ routines: [], favorites: [], customExercises: [] });
    if (path === "/api/workouts" && method === "PUT") {
      const w = r.postDataJSON();
      workouts.push({ ...w, revision: 1 });
      return json({ workout: { ...w, revision: 1 } });
    }
    if (path === "/api/friends" && method === "GET") return json(data);
    if (path === "/api/friends/status") {
      Object.assign(data.me, r.postDataJSON(), {
        activeUntil: NOW.getTime() + 7200000,
      });
      return json({ ok: true });
    }
    if (path === "/api/friends/goal") {
      data.me.weeklyTarget = r.postDataJSON().target;
      return json({ ok: true });
    }
    if (path === "/api/friends/meetups" && method === "POST") {
      const input = r.postDataJSON();
      data.meetups!.push({
        id: input.id,
        hostId: data.me.id,
        hostName: data.me.displayName,
        name: input.name,
        gym: input.gym,
        startsAt: input.startsAt,
        cancelled: false,
        myResponse: "accepted",
        participants: [
          {
            id: data.me.id,
            displayName: "Саша",
            response: "accepted",
            gym: input.gym,
          },
          { id: "friend", displayName: "Дима", response: "invited", gym: "" },
        ],
      });
      return json({ id: input.id });
    }
    if (path.startsWith("/api/friends/meetups/") && method === "PUT") {
      const input = r.postDataJSON(),
        room = data.meetups!.find((m) => m.id === path.split("/").at(-1))!;
      if (input.action === "finish") {
        const w = workouts.find((w) => w.id === input.workoutId)!;
        room.myResponse = "finished";
        Object.assign(room.participants[0], {
          response: "finished",
          summary: {
            name: w.name,
            duration: w.duration,
            setsCount: 1,
            volumeKg: 600,
          },
        });
      }
      if (input.action === "cancel") room.cancelled = true;
      return json({ ok: true });
    }
    unexpected.push(`${method} ${path}`);
    return json({ error: "Unmocked request; nothing forwarded" }, 503);
  });
  await mockWeights(page, data.me.id, weights);
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Сегодня", exact: true }),
  ).toBeVisible();
  return {
    data,
    weights,
    clean: () => {
      expect(errors).toEqual([]);
      expect(unexpected).toEqual([]);
    },
  };
}
const nav = (page: Page, name: string) =>
  page
    .getByRole("navigation", { name: "Основная навигация" })
    .getByRole("button", { name, exact: true });
async function openWeight(page: Page) {
  await nav(page, "Прогресс").click();
  await page.getByRole("tab", { name: "Вес тела", exact: true }).click();
}
async function shot(page: Page, name: string) {
  await mkdir("artifacts/workflow", { recursive: true });
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await expect(page.locator(".page-content")).toHaveCSS("opacity", "1");
  await page.screenshot({
    path: `artifacts/workflow/${name}.png`,
    fullPage: true,
  });
}

test("two devices synchronize weight, retain offline edits, resolve conflicts and export", async ({
  page,
  browser,
}) => {
  const shared = weightFixture(),
    a = await fixture(page, shared);
  await openWeight(page);
  await page.getByLabel("Вес, кг", { exact: true }).fill("61,5");
  await page
    .getByRole("button", { name: "Сохранить замер", exact: true })
    .click();
  await expect(
    page.getByText("Сохранено в аккаунте", { exact: true }),
  ).toBeVisible();
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    timezoneId: "Europe/Saratov",
    locale: "ru-RU",
  });
  const second = await context.newPage();
  const secondState = { documents: shared.documents, offline: false };
  const b = await fixture(second, secondState);
  await openWeight(second);
  await expect(second.locator(".weight-history-row")).toContainText("61,5");
  secondState.offline = true;
  await second
    .getByRole("button", { name: "Изменить замер 2026-11-10", exact: true })
    .click();
  await second.getByLabel("Вес, кг", { exact: true }).fill("62");
  await second
    .getByRole("button", { name: "Обновить замер", exact: true })
    .click();
  await expect(
    second.getByText("1 изменение ждёт отправки", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("Вес, кг", { exact: true }).fill("63");
  await page
    .getByRole("button", { name: "Обновить замер", exact: true })
    .click();
  await expect(
    page.getByText("Сохранено в аккаунте", { exact: true }),
  ).toBeVisible();
  secondState.offline = false;
  await second
    .getByRole("button", { name: "Синхронизировать", exact: true })
    .click();
  await expect(
    second.getByText("Нужно выбрать версию замера", { exact: true }),
  ).toBeVisible();
  await expect(second.locator(".weight-history-row")).toContainText("62");
  await second
    .getByRole("button", { name: "Принять версию из аккаунта", exact: true })
    .click();
  await expect(second.locator(".weight-history-row")).toContainText("63");
  await expect(
    second.getByText("Сохранено в аккаунте", { exact: true }),
  ).toBeVisible();
  const download = second.waitForEvent("download");
  await second
    .getByRole("button", { name: "Экспорт веса", exact: true })
    .click();
  expect((await download).suggestedFilename()).toBe("tyaga-bodyweight.json");
  expect(
    await second.evaluate(
      () => document.documentElement.scrollWidth - innerWidth,
    ),
  ).toBeLessThanOrEqual(1);
  await shot(second, "weight-sync-390");
  a.clean();
  b.clean();
  await context.close();
});

test("undo survives reload and minimization, preserves edited sets and the tools hub replaces clutter", async ({
  page,
}) => {
  const f = await fixture(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole("button", { name: /^Инструменты/ })
    .last()
    .click();
  const hub = page.getByRole("dialog", {
    name: "Инструменты и настройки",
    exact: true,
  });
  await expect(
    hub.getByRole("button", { name: /Калькулятор блинов/ }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await page
    .getByRole("button", { name: "Начать тренировку", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Добавить упражнение", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Добавить Жим штанги лёжа", exact: true })
    .click();
  await page.getByRole("button", { name: "Готово", exact: true }).click();
  await page
    .getByLabel("Жим штанги лёжа, подход 3, вес", { exact: true })
    .fill("90");
  await page
    .getByRole("button", { name: "Убрать последний подход", exact: true })
    .click();
  await page
    .getByLabel("Жим штанги лёжа, подход 1, вес", { exact: true })
    .fill("75");
  await page.reload();
  await page
    .getByRole("button", { name: "Продолжить тренировку", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Отменить удаление", exact: true })
    .click();
  await expect(
    page.getByLabel("Жим штанги лёжа, подход 3, вес", { exact: true }),
  ).toHaveValue("90");
  await expect(
    page.getByLabel("Жим штанги лёжа, подход 1, вес", { exact: true }),
  ).toHaveValue("75");
  await page
    .getByRole("button", { name: "Убрать Жим штанги лёжа", exact: true })
    .click();
  await expect(page.locator(".exercise-card")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Отменить удаление", exact: true })
    .click();
  await expect(page.locator(".exercise-card")).toHaveCount(1);
  const input = page.getByLabel("Жим штанги лёжа, подход 1, вес", {
    exact: true,
  });
  await input.focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByLabel("Жим штанги лёжа, подход 1, повторы", { exact: true }),
  ).toBeFocused();
  await shot(page, "workout-input-390");
  f.clean();
});

test("personal goals, meetup invitation, workout start and shared completion are connected", async ({
  page,
}) => {
  const f = await fixture(page);
  await nav(page, "Друзья").click();
  await page.getByLabel("Моя цель на неделю", { exact: true }).fill("4");
  await page
    .getByRole("button", { name: "Сохранить цель", exact: true })
    .click();
  await expect(
    page.getByLabel("Моя цель на неделю", { exact: true }),
  ).toHaveValue("4");
  await page
    .getByRole("button", { name: "Позвать на тренировку", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Позвать на тренировку",
    exact: true,
  });
  await dialog
    .getByLabel("Название тренировки", { exact: true })
    .fill("Вечерняя тренировка");
  await dialog
    .getByLabel("Дата и время", { exact: true })
    .fill("2026-11-10T15:59");
  await dialog.getByLabel("Твой зал", { exact: true }).fill("Зал у дома");
  await dialog.getByLabel("Дима", { exact: true }).check();
  await dialog
    .getByRole("button", { name: "Отправить приглашение", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await page
    .getByRole("button", { name: "Начать вместе", exact: true })
    .click();
  await expect(
    page.getByLabel("Название тренировки", { exact: true }),
  ).toHaveValue("Вечерняя тренировка");
  await page
    .getByRole("button", { name: "Добавить упражнение", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Добавить Жим штанги лёжа", exact: true })
    .click();
  await page.getByRole("button", { name: "Готово", exact: true }).click();
  await page
    .getByLabel("Жим штанги лёжа, подход 1, вес", { exact: true })
    .fill("60");
  await page
    .getByRole("button", {
      name: "Отметить выполненным: Жим штанги лёжа, подход 1",
      exact: true,
    })
    .click();
  await page
    .getByRole("button", { name: "Завершить тренировку", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "История тренировок", exact: true }),
  ).toBeVisible();
  await nav(page, "Друзья").click();
  await expect(
    page.getByText("Общий итог: 1 участник", { exact: true }),
  ).toBeVisible();
  await shot(page, "meetup-1440");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - innerWidth,
    ),
  ).toBeLessThanOrEqual(1);
  await shot(page, "meetup-390");
  f.clean();
});
