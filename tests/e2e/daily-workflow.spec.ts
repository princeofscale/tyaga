import { readFile } from "node:fs/promises";
import {
  TeamChallengeProgress,
  type TeamChallenge,
} from "../../src/domain/TeamChallenge";
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
  const profile = {
    id: data.me.id,
    email: "daily@example.test",
    displayName: "Саша",
    timeZone: "Europe/Saratov",
    bodyMassKg: null as number | null,
    revision: 1,
    createdAt: NOW.toISOString(),
  };
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
      return json({ registered: true, profile });
    if (path === "/api/auth/profile" && method === "PUT") {
      Object.assign(profile, r.postDataJSON(), {
        revision: profile.revision + 1,
      });
      return json({ profile });
    }
    if (path === "/api/challenges" && method === "GET")
      return json({ accountId: profile.id, challenges: [] });
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
    workouts,
    profile,
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

test("profile and new bodyweight sets share the weighing journal; complete export retains old snapshots", async ({
  page,
}) => {
  const f = await fixture(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await openWeight(page);
  await page.getByLabel("Вес, кг", { exact: true }).fill("73.5");
  await page
    .getByRole("button", { name: "Сохранить замер", exact: true })
    .click();
  await nav(page, "Сегодня").click();
  await page.getByRole("button", { name: "Мой профиль", exact: true }).click();
  const profile = page.getByRole("dialog", {
    name: "Мой профиль",
    exact: true,
  });
  await expect(profile.getByLabel("Вес тела, кг", { exact: true })).toHaveValue(
    "73.5",
  );
  await profile.getByLabel("Вес тела, кг", { exact: true }).fill("74.5");
  await profile
    .getByRole("button", { name: "Сохранить профиль", exact: true })
    .click();
  await expect(
    profile.getByText("Профиль сохранён", { exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await nav(page, "Сегодня").click();
  await page
    .getByRole("button", { name: "Начать тренировку", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Добавить упражнение", exact: true })
    .click();
  await page
    .getByRole("button", {
      name: "Добавить Подтягивания прямым хватом",
      exact: true,
    })
    .click();
  await page.getByRole("button", { name: "Готово", exact: true }).click();
  await page
    .getByText("Записать массу тела (по желанию)", { exact: true })
    .click();
  await expect(page.getByLabel("Масса тела, кг", { exact: true })).toHaveValue(
    "74.5",
  );
  await page
    .getByRole("button", {
      name: "Отметить выполненным: Подтягивания прямым хватом, подход 1",
      exact: true,
    })
    .click();
  await page
    .getByRole("button", { name: "Завершить тренировку", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "История тренировок", exact: true }),
  ).toBeVisible();
  await openWeight(page);
  await page.getByLabel("Вес, кг", { exact: true }).fill("75");
  await page
    .getByRole("button", { name: "Обновить замер", exact: true })
    .click();
  expect(f.workouts[0].exercises[0].bodyMassKg).toBe(74.5);
  await nav(page, "Сегодня").click();
  await page
    .getByRole("button", { name: /^Инструменты/ })
    .last()
    .click();
  await page.getByRole("button", { name: /^Резервная копия/ }).click();
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Скачать полную копию", exact: true })
    .click();
  const file = await download;
  const backup = JSON.parse(await readFile((await file.path())!, "utf8"));
  expect(backup.version).toBe(5);
  expect(backup.machines).toBeInstanceOf(Array);
  expect(backup.workouts[0].exercises[0].bodyMassKg).toBe(74.5);
  expect(backup.bodyweight.entries.at(-1).weightKg).toBe(75);
  expect(backup.profile.bodyMassKg).toBe(75);
  expect(backup.routines).toEqual([]);
  expect(backup.theme).toBe("lime");
  expect(JSON.stringify(backup)).not.toMatch(/password|token|email/);
  await shot(page, "backup-390");
  f.clean();
});

test("full restore previews weights and keeps existing conflicting dates unless selected", async ({
  page,
}) => {
  const f = await fixture(page);
  await openWeight(page);
  await page.getByLabel("Вес, кг", { exact: true }).fill("70");
  await page
    .getByRole("button", { name: "Сохранить замер", exact: true })
    .click();
  const backup = {
    version: 4,
    workouts: [],
    routines: [],
    customExercises: [],
    favorites: [],
    settings: DEFAULT_SETTINGS,
    theme: "lime",
    bodyweight: {
      entries: [
        {
          id: "restore-old",
          date: "2026-11-08",
          weightKg: 68,
          createdAt: 1,
          note: "из копии",
        },
        {
          id: "restore-today",
          date: "2026-11-10",
          weightKg: 80,
          createdAt: 2,
          note: "другая версия",
        },
      ],
      goal: { targetWeightKg: 82, startWeightKg: 68 },
    },
  };
  const restore = async (replace = false) => {
    await nav(page, "История").click();
    await page
      .getByRole("button", { name: "Импорт истории", exact: true })
      .click();
    const dialog = page.getByRole("dialog", {
      name: "Импорт истории",
      exact: true,
    });
    await dialog
      .getByLabel("Файл истории тренировок", { exact: true })
      .setInputFiles({
        name: "full-backup.json",
        mimeType: "application/json",
        buffer: Buffer.from(JSON.stringify(backup)),
      });
    await dialog
      .getByRole("button", { name: "Показать предпросмотр", exact: true })
      .click();
    await expect(
      dialog.getByRole("region", { name: "Вес в резервной копии" }),
    ).toContainText("Различаются: 1");
    if (replace)
      await dialog
        .getByLabel("При различиях использовать замеры и цель из файла", {
          exact: true,
        })
        .check();
    await shot(page, replace ? "restore-replace-1440" : "restore-preview-1440");
    await dialog
      .getByRole("button", { name: "Импортировать", exact: true })
      .click();
    await expect(dialog).toHaveCount(0);
  };
  await restore();
  await openWeight(page);
  await expect(page.locator(".weight-history-row").first()).toContainText("70");
  await expect(page.locator(".weight-history-row")).toHaveCount(2);
  await restore(true);
  await openWeight(page);
  await expect(page.locator(".weight-history-row").first()).toContainText("80");
  await expect(page.locator(".weight-history-row")).toHaveCount(2);
  f.clean();
});

test("four-week challenge creation, individual goals, compact friends layout and result card", async ({
  page,
}) => {
  const f = await fixture(page),
    rooms: TeamChallenge[] = [];
  await page.route("**/api/challenges**", (route) => {
    const req = route.request(),
      input = req.method() === "GET" ? null : req.postDataJSON();
    const json = (body: unknown) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    if (req.method() === "GET")
      return json({ accountId: f.data.me.id, challenges: rooms });
    if (req.method() === "POST") {
      rooms.push({
        id: input.id,
        name: input.name,
        hostId: f.data.me.id,
        startDate: input.startDate,
        endDate: "2026-12-06",
        today: "2026-11-10",
        cancelled: false,
        myResponse: "accepted",
        participants: [
          {
            id: f.data.me.id,
            displayName: "Саша",
            response: "accepted",
            target: input.target,
            weeks: TeamChallengeProgress.weeks(
              input.startDate,
              "2026-11-10",
              input.target,
              [{ date: "2026-11-10", n: 2 }],
            ),
          },
          { id: "friend", displayName: "Дима", response: "invited", target: 3 },
        ],
      });
      return json({ id: input.id });
    }
    rooms[0].cancelled = true;
    return json({ ok: true });
  });
  await nav(page, "Друзья").click();
  await page
    .getByRole("button", { name: "Создать челлендж", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Челлендж на четыре недели",
    exact: true,
  });
  await dialog.getByLabel("Название", { exact: true }).fill("Ноябрь в ритме");
  await dialog
    .getByLabel("Начало — понедельник", { exact: true })
    .fill("2026-11-09");
  await dialog
    .getByLabel("Моя цель: тренировок в неделю", { exact: true })
    .fill("2");
  await dialog.getByLabel("Дима", { exact: true }).check();
  await dialog
    .getByRole("button", { name: "Пригласить на четыре недели", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  const room = page.locator(".challenge-card");
  await expect(room).toContainText("Ноябрь в ритме");
  rooms[0].participants[1] = {
    id: "friend",
    displayName: "Дима",
    response: "accepted",
    target: 4,
    weeks: TeamChallengeProgress.weeks("2026-11-09", "2026-11-10", 4, [
      { date: "2026-11-10", n: 1 },
    ]),
  };
  await page
    .getByRole("button", { name: "Обновить челленджи", exact: true })
    .click();
  await expect(room).toContainText("4 в неделю");
  await expect(room.locator(".challenge-score")).toContainText("1 / 8");
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Моя карточка прогресса", exact: true })
    .click();
  expect((await download).suggestedFilename()).toMatch(/\.svg$/);
  await shot(page, "challenges-1440");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    (await page.locator(".friends-hero").boundingBox())!.height,
  ).toBeLessThan(120);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - innerWidth,
    ),
  ).toBeLessThanOrEqual(1);
  await shot(page, "challenges-390");
  f.clean();
});

test("Android notification controls are opt-in and a native action restores the matching workout and next set", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const state: {
      supported: boolean;
      enabled: boolean;
      permission: boolean;
      exact: boolean;
      action: Record<string, unknown> | null;
    } = {
      supported: true,
      enabled: false,
      permission: false,
      exact: false,
      action: null,
    };
    const commands: Record<string, unknown>[] = [],
      settings: string[] = [],
      listeners = new Map<string, () => void>();
    let enabledCalls = 0,
      sequence = 0;
    Object.assign(window, {
      CapacitorCustomPlatform: { name: "android" },
      Capacitor: {
        PluginHeaders: [
          {
            name: "RestTimer",
            methods: [
              ...[
                "getState",
                "enable",
                "disable",
                "sync",
                "acknowledge",
                "openSettings",
                "removeListener",
              ].map((name) => ({ name, rtype: "promise" })),
              { name: "addListener", rtype: "callback" },
            ],
          },
        ],
        nativePromise: async (
          _plugin: string,
          method: string,
          input: Record<string, unknown> = {},
        ) => {
          if (method === "getState") return structuredClone(state);
          if (method === "enable") {
            enabledCalls++;
            state.enabled = true;
            state.permission = true;
            return structuredClone(state);
          }
          if (method === "disable") {
            state.enabled = false;
            return structuredClone(state);
          }
          if (method === "sync") {
            commands.push(structuredClone(input));
            return;
          }
          if (method === "acknowledge") {
            if (state.action?.id === input.id) state.action = null;
            return;
          }
          if (method === "openSettings") {
            settings.push(String(input.kind));
            return;
          }
          if (method === "removeListener") {
            listeners.delete(String(input.callbackId));
            return;
          }
          throw new Error("Unexpected native call " + method);
        },
        nativeCallback: (
          _plugin: string,
          method: string,
          _input: unknown,
          callback: () => void,
        ) => {
          if (method !== "addListener") throw new Error(method);
          const id = String(++sequence);
          listeners.set(id, callback);
          return id;
        },
      },
      __restTest: {
        state,
        commands,
        settings,
        get enabledCalls() {
          return enabledCalls;
        },
        notify: () => listeners.forEach((callback) => callback()),
      },
    });
  });
  const f = await fixture(page);
  expect(
    await page.evaluate(() => Reflect.get(window, "__restTest").enabledCalls),
  ).toBe(0);
  await page
    .getByRole("button", { name: /^Инструменты/ })
    .last()
    .click();
  await page.getByRole("button", { name: /^Уведомления отдыха/ }).click();
  await page
    .getByRole("button", { name: "Включить уведомления", exact: true })
    .click();
  await expect(
    page.getByText("Уведомления включены", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Разрешить точный таймер", exact: true })
    .click();
  expect(
    await page.evaluate(() => Reflect.get(window, "__restTest").settings),
  ).toEqual(["exact"]);
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
    .getByLabel("Жим штанги лёжа, подход 1, вес", { exact: true })
    .fill("80");
  await page
    .getByRole("button", {
      name: "Отметить выполненным: Жим штанги лёжа, подход 1",
      exact: true,
    })
    .click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        Reflect.get(window, "__restTest").commands.some(
          (c: { until: number | null }) => c.until !== null,
        ),
      ),
    )
    .toBe(true);
  await page
    .getByRole("button", { name: "Свернуть тренировку", exact: true })
    .click();
  const until = await page.evaluate(() => {
    const t = Reflect.get(window, "__restTest");
    const command = t.commands
      .filter((c: { until: number | null }) => c.until !== null)
      .at(-1);
    t.state.action = {
      ...command,
      type: "extend",
      id: "extend-30",
      until: command.until + 30000,
    };
    t.notify();
    return command.until + 30000;
  });
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("tyaga-draft-account:daily-user")!)
            .restUntil,
      ),
    )
    .toBe(until);
  await page.evaluate(() => {
    const t = Reflect.get(window, "__restTest");
    const command = t.commands
      .filter((c: { until: number | null }) => c.until !== null)
      .at(-1);
    t.state.action = { ...command, type: "open", id: "open-from-notification" };
    t.notify();
  });
  await expect(
    page.getByLabel("Жим штанги лёжа, подход 2, вес", { exact: true }),
  ).toBeFocused();
  await expect(
    page.getByLabel("Жим штанги лёжа, подход 1, вес", { exact: true }),
  ).toHaveValue("80");
  f.clean();
});
