import { mockWeights } from "./fixtures/bodyweight";
import { mockLive } from "./fixtures/live";
import { test, expect, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { DEFAULT_SETTINGS, type Routine } from "../../src/lib/model";
import type { FriendsData } from "../../src/domain/FriendsService";

// All requests are intercepted. These UI checks never use real users or production D1.
async function fixture(
  page: Page,
  options: { empty?: boolean; signedIn?: boolean } = {},
) {
  let signedIn = options.signedIn ?? true;
  let routines: Routine[] = [];
  let failReads = false;
  const errors: string[] = [],
    unexpected: string[] = [];
  const now = Date.now(),
    today = new Date().toISOString().slice(0, 10);
  const profile = {
    id: "me",
    email: "test@example.test",
    displayName: "Саша",
    timeZone: "UTC",
    bodyMassKg: 80,
    revision: 1,
    createdAt: new Date(now).toISOString(),
  };
  const data: FriendsData = {
    me: {
      id: "me",
      displayName: "Саша",
      inviteCode: "A1B2C3D4E5F6",
      gym: "",
      focus: "",
      activeUntil: 0,
      weekWorkouts: 2,
    },
    friends: options.empty
      ? []
      : [
          {
            id: "dima",
            displayName: "Дмитрий",
            gym: "Атлетика на Лесной",
            focus: "Спина и бицепс",
            activeUntil: now + 3600000,
            weekWorkouts: 3,
          },
          {
            id: "lena",
            displayName: "Елена",
            gym: "Другой зал",
            focus: "Ноги",
            activeUntil: 0,
            weekWorkouts: 1,
          },
        ],
    requests: options.empty
      ? []
      : [{ id: "artem", displayName: "Артём", direction: "incoming" }],
    feed: options.empty
      ? []
      : [
          {
            id: "workout-dima",
            athleteId: "dima",
            displayName: "Дмитрий",
            name: "Спина и бицепс",
            date: today,
            duration: 54,
            setsCount: 18,
            volumeKg: 4800,
            kudosCount: 2,
            hasGivenKudos: false,
          },
          {
            id: "workout-lena",
            athleteId: "lena",
            displayName: "Елена",
            name: "Ноги и корпус",
            date: today,
            duration: 45,
            setsCount: 14,
            volumeKg: 3200,
            kudosCount: 1,
            hasGivenKudos: false,
          },
        ],
    weekStart: today,
    today,
    serverTime: now,
  };
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/api/**", async (route) => {
    const request = route.request(),
      path = new URL(request.url()).pathname,
      method = request.method();
    const json = (value: unknown, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(value),
      });
    if (path === "/api/auth/session")
      return json({ registered: true, profile: signedIn ? profile : null });
    if (path === "/api/auth/login") {
      signedIn = true;
      return json({ profile });
    }
    if (path === "/api/data")
      return json({
        workouts: [],
        settings: { ...DEFAULT_SETTINGS, timeZone: "UTC" },
      });
    if (path === "/api/product")
      return json({ routines, customExercises: [], favorites: [] });
    if (path === "/api/routines" && method === "PUT") {
      const routine = { ...request.postDataJSON(), revision: 1 } as Routine;
      routines = [...routines.filter((r) => r.id !== routine.id), routine];
      return json({ routine });
    }
    if (path === "/api/challenges" && method === "GET")
      return json({ accountId: profile.id, challenges: [] });
    if (path === "/api/friends" && method === "GET")
      return failReads
        ? json({ error: "Нет связи. Попробуй ещё раз." }, 503)
        : json({ ...data, serverTime: Date.now() });
    if (path === "/api/friends/status") {
      const body = request.postDataJSON();
      data.me = {
        ...data.me,
        gym: body.gym,
        focus: body.focus,
        activeUntil: body.inGym ? Date.now() + 7200000 : 0,
      };
      return json({ ok: true });
    }
    if (path === "/api/friends/requests") {
      const code = request.postDataJSON().code;
      if (code === data.me.inviteCode)
        return json({ error: "Это твой код. Отправь его другу." }, 400);
      if (code !== "112233445566") return json({ error: "Код не найден" }, 404);
      if (!data.requests.some((r) => r.id === "new-friend"))
        data.requests.push({
          id: "new-friend",
          displayName: "Иван",
          direction: "outgoing",
        });
      return json({ ok: true });
    }
    if (path.startsWith("/api/friends/connections/")) {
      const id = path.split("/").pop()!;
      data.requests = data.requests.filter((r) => r.id !== id);
      if (method === "PUT")
        data.friends.push({
          id,
          displayName: "Артём",
          gym: "Спортзал у дома",
          focus: "Жим и дельты",
          activeUntil: Date.now() + 3600000,
          weekWorkouts: 2,
        });
      if (method === "DELETE") {
        data.friends = data.friends.filter((f) => f.id !== id);
        data.feed = data.feed.filter((w) => w.athleteId !== id);
      }
      return json({ ok: true });
    }
    if (path.startsWith("/api/friends/kudos/")) {
      const workout = data.feed.find((w) => w.id === path.split("/").pop())!;
      const given = request.postDataJSON().given as boolean;
      if (given !== workout.hasGivenKudos) workout.kudosCount += given ? 1 : -1;
      workout.hasGivenKudos = given;
      return json({ ok: true });
    }
    unexpected.push(`${method} ${path}`);
    return json({ error: "Unmocked request; never forwarded" }, 503);
  });
  await mockWeights(page, profile.id);
  await mockLive(page);
  return {
    data,
    failReads: (value: boolean) => {
      failReads = value;
    },
    clean: () => {
      expect(errors).toEqual([]);
      expect(unexpected).toEqual([]);
    },
  };
}
const nav = (page: Page) =>
  page.getByRole("navigation", { name: "Основная навигация" });
async function noOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - innerWidth,
    ),
  ).toBeLessThanOrEqual(1);
}
async function screenshot(page: Page, name: string) {
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await mkdir("artifacts/friends", { recursive: true });
  await page.screenshot({
    path: `artifacts/friends/${name}.png`,
    fullPage: true,
  });
}

test("mobile navigation exposes programs and friends at every width; a ready program starts a workout", async ({
  page,
}) => {
  const f = await fixture(page, { empty: true });
  for (const width of [320, 360, 390, 768]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: "Сегодня", exact: true }),
    ).toBeVisible();
    for (const name of [
      "Сегодня",
      "Программы",
      "Друзья",
      "История",
      "Прогресс",
      "Упражнения",
    ])
      await expect(
        nav(page).getByRole("button", { name, exact: true }),
      ).toBeInViewport();
    await nav(page)
      .getByRole("button", { name: "Программы", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Программы", exact: true, level: 1 }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Программа v2 · 5 дней/ }),
    ).toBeVisible();
    await noOverflow(page);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: /Программа v2 · 5 дней/ }).click();
  await expect(page.locator(".routine-card")).toHaveCount(5);
  await screenshot(page, "programs-390");
  await page
    .locator(".routine-card")
    .first()
    .getByRole("button", { name: "Начать", exact: true })
    .click();
  await expect(page.locator(".workout-athletic")).toBeVisible();
  await expect(page.locator(".exercise-card").first()).toBeVisible();
  f.clean();
});

test("friends: accept requests, mark a gym, send persistent kudos and revoke access", async ({
  page,
}) => {
  const f = await fixture(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await nav(page).getByRole("button", { name: "Друзья", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Напарники", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".friend-card")).toHaveCount(2);
  await noOverflow(page);
  await page.getByRole("button", { name: "Принять", exact: true }).click();
  await expect(page.locator(".friend-card")).toHaveCount(3);
  await page.getByRole("button", { name: "Я в зале", exact: true }).click();
  const status = page.getByRole("dialog", {
    name: "Моя тренировка",
    exact: true,
  });
  await status
    .getByLabel("Зал", { exact: true })
    .fill("Мой зал на другом конце города");
  await status
    .getByLabel("Что тренируешь?", { exact: true })
    .fill("Ноги и икры");
  await status
    .getByRole("button", { name: "Начать — я в зале", exact: true })
    .click();
  await expect(status).not.toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Ты в зале", exact: true }),
  ).toBeVisible();
  const kudos = page.getByRole("button", {
    name: "Респект: Дмитрий, Спина и бицепс",
    exact: true,
  });
  await kudos.click();
  await expect(kudos).toHaveAttribute("aria-pressed", "true");
  await expect(kudos).toContainText("3");
  await page.reload();
  await nav(page).getByRole("button", { name: "Друзья", exact: true }).click();
  await expect(kudos).toHaveAttribute("aria-pressed", "true");
  await kudos.click();
  await expect(kudos).toHaveAttribute("aria-pressed", "false");
  await page.getByRole("button", { name: "Изменить", exact: true }).click();
  await status
    .getByRole("button", { name: "Закончил тренировку", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Я в зале", exact: true }),
  ).toBeVisible();
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: width > 960 ? 1080 : 844 });
    await noOverflow(page);
    if (width === 390 || width === 1440)
      await screenshot(page, `team-${width}`);
  }
  await page
    .getByRole("button", { name: "Удалить напарника: Дмитрий", exact: true })
    .click();
  const remove = page.getByRole("dialog", {
    name: "Удалить напарника?",
    exact: true,
  });
  await remove
    .getByRole("button", { name: "Удалить напарника", exact: true })
    .click();
  await expect(page.locator(".friend-card")).toHaveCount(2);
  await expect(kudos).toHaveCount(0);
  f.clean();
});

test("invitations survive sign-in, show recoverable errors, and never fabricate friends", async ({
  page,
}) => {
  const f = await fixture(page, { empty: true, signedIn: false });
  await page.setViewportSize({ width: 360, height: 844 });
  await page.goto("/?friend=112233445566");
  await page.getByLabel("Почта", { exact: true }).fill("test@example.test");
  await page.getByLabel("Пароль", { exact: true }).fill("test passphrase");
  await page.getByRole("button", { name: "Войти в Тягу", exact: true }).click();
  const dialog = page.getByRole("dialog", {
    name: "Добавить друга",
    exact: true,
  });
  const input = dialog.getByLabel("Код или ссылка друга", { exact: true });
  await expect(input).toHaveValue("112233445566");
  await input.fill(f.data.me.inviteCode);
  await dialog
    .getByRole("button", { name: "Отправить заявку", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toContainText("Это твой код");
  await expect(input).toHaveValue(f.data.me.inviteCode);
  await input.fill("https://tyaga.example/?friend=112233445566");
  await dialog
    .getByRole("button", { name: "Отправить заявку", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await expect(page).toHaveURL("http://localhost:5173/");
  await expect(
    page.getByText("Ждём подтверждения", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".friend-card")).toHaveCount(0);
  await screenshot(page, "empty-360");
  f.failReads(true);
  await page
    .getByRole("button", { name: "Обновить напарников", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("Нет связи");
  await expect(
    page.getByText("Ждём подтверждения", { exact: true }),
  ).toBeVisible();
  f.failReads(false);
  await page
    .getByRole("button", { name: "Обновить напарников", exact: true })
    .click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  f.clean();
});

test("friends Motion enters, reacts and settles without infinite background animation", async ({
  page,
}) => {
  const f = await fixture(page);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/");
  await nav(page).getByRole("button", { name: "Друзья", exact: true }).click();
  await expect(page.locator(".friends-hero")).toHaveCSS("opacity", "1");
  const button = page.getByRole("button", {
    name: "Респект: Дмитрий, Спина и бицепс",
    exact: true,
  });
  await button.click();
  await expect(button).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".page-content")).toHaveCSS("opacity", "1");
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
  f.clean();
});
