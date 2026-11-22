import { expect, test, type Page } from "@playwright/test";
import { DEFAULT_SETTINGS, makeExerciseEntry, makeSets, type Routine } from "../../src/lib/model";
import { TrainingProgram } from "../../src/domain/TrainingProgram";
import type { FriendsData } from "../../src/domain/FriendsService";
import type { SharedProgram } from "../../src/domain/SharedProgram";
import { mockWeights } from "./fixtures/bodyweight";
import { liveMock, mockLive } from "./fixtures/live";
import { mockImportRuns } from "./fixtures/importRuns";
import { clipped, smallTargets } from "./fixtures/touch";

const overflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test.use({ locale: "ru-RU", timezoneId: "Europe/Saratov", serviceWorkers: "block" });

test("Друзья без ИИ-слопа: заявки, Вместе, поделиться своей и общая программа Дэвида Лейда", async ({ page }) => {
  const now = Date.now();
  const today = "2026-11-10";
  const profile = {
    id: "me",
    email: "me@example.test",
    displayName: "Саша",
    timeZone: "Europe/Saratov",
    bodyMassKg: 80,
    revision: 1,
    createdAt: new Date(now).toISOString(),
  };

  let routines: Routine[] = [
    {
      ...TrainingProgram.empty(),
      id: "my-push-1",
      name: "Мой Жим A",
      days: [0],
      exercises: [
        { ...makeExerciseEntry("bench"), sets: makeSets(4, 90, 6), repMin: 6, repMax: 8 },
      ],
    },
  ];

  const sharedPrograms: SharedProgram[] = [
    {
      id: "sp-from-dima",
      ownerId: "dima",
      ownerName: "Дмитрий",
      title: "Верх / Низ",
      kind: "template",
      payload: { templateId: "upper_lower" },
      createdAt: new Date(now).toISOString(),
      members: [
        { accountId: "dima", displayName: "Дмитрий", role: "owner", adopted: true, weekWorkouts: 3 },
        { accountId: "me", displayName: "Саша", role: "member", adopted: false, weekWorkouts: 2 },
      ],
      isOwner: false,
      adoptedByMe: false,
    },
  ];

  const friendsData: FriendsData = {
    me: {
      id: "me",
      displayName: "Саша",
      inviteCode: "A1B2C3D4E5F6",
      gym: "",
      focus: "",
      activeUntil: 0,
      weekWorkouts: 2,
    },
    friends: [
      {
        id: "dima",
        displayName: "Дмитрий",
        gym: "",
        focus: "",
        activeUntil: 0,
        weekWorkouts: 3,
      },
    ],
    requests: [{ id: "artem", displayName: "Артём", direction: "incoming" }],
    feed: [],
    sharedPrograms,
    weekStart: "2026-11-09",
    today,
    serverTime: now,
  };

  await page.route("**/api/**", async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    const method = req.method();
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

    if (path === "/api/auth/session") return json({ registered: true, profile });
    if (path === "/api/data") return json({ workouts: [], settings: { ...DEFAULT_SETTINGS, timeZone: profile.timeZone } });
    if (path === "/api/product") return json({ routines, customExercises: [], favorites: [] });
    if (path === "/api/routines" && method === "PUT") {
      const saved = { ...req.postDataJSON(), revision: 1 } as Routine;
      routines = [saved, ...routines.filter((r) => r.id !== saved.id)];
      return json({ routine: saved });
    }
    if (path === "/api/friends" && method === "GET") {
      return json({ ...friendsData, sharedPrograms: [...sharedPrograms], serverTime: Date.now() });
    }
    if (path === "/api/friends/requests" && method === "POST") {
      friendsData.requests.push({ id: "ivan", displayName: "Иван", direction: "outgoing" });
      return json({ ok: true });
    }
    if (path.startsWith("/api/friends/connections/") && method === "PUT") {
      const id = path.split("/").pop()!;
      const reqItem = friendsData.requests.find((r) => r.id === id);
      friendsData.requests = friendsData.requests.filter((r) => r.id !== id);
      if (reqItem) {
        friendsData.friends.push({
          id: reqItem.id,
          displayName: reqItem.displayName,
          gym: "",
          focus: "",
          activeUntil: 0,
          weekWorkouts: 1,
        });
      }
      return json({ ok: true });
    }
    if (path === "/api/friends/programs" && method === "POST") {
      const body = req.postDataJSON();
      const created: SharedProgram = {
        id: `sp-${sharedPrograms.length + 1}`,
        ownerId: "me",
        ownerName: "Саша",
        title: body.title,
        kind: body.kind,
        payload: body.payload,
        createdAt: new Date().toISOString(),
        members: [
          { accountId: "me", displayName: "Саша", role: "owner", adopted: body.ownerAdopted !== false, weekWorkouts: 2 },
          ...(body.friendIds ?? []).map((fid: string) => ({
            accountId: fid,
            displayName: friendsData.friends.find((f) => f.id === fid)?.displayName ?? "Друг",
            role: "member" as const,
            adopted: false,
            weekWorkouts: 3,
          })),
        ],
        isOwner: true,
        adoptedByMe: body.ownerAdopted !== false,
      };
      sharedPrograms.unshift(created);
      return json({ id: created.id });
    }
    if (path.endsWith("/adopt") && method === "POST") {
      const id = path.split("/").at(-2)!;
      const item = sharedPrograms.find((p) => p.id === id);
      if (item) {
        item.adoptedByMe = true;
        const me = item.members.find((m) => m.accountId === "me");
        if (me) me.adopted = true;
      }
      return json({ ok: true });
    }
    if (path.startsWith("/api/friends/programs/") && method === "DELETE") {
      const id = path.split("/").pop()!;
      const idx = sharedPrograms.findIndex((p) => p.id === id);
      if (idx >= 0) sharedPrograms.splice(idx, 1);
      return json({ ok: true });
    }
    return json({ ok: true });
  });

  await mockWeights(page, profile.id);
  await mockLive(page, liveMock(null), profile.displayName);
  await mockImportRuns(page);

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  await page.getByRole("navigation", { name: "Основная навигация" }).getByRole("button", { name: "Друзья", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Друзья", exact: true })).toBeVisible();

  // Нет ИИ-слопа
  const initialText = await page.locator("main").innerText();
  expect(initialText).not.toContain("ТВОЯ КОМАНДА");
  expect(initialText).not.toContain("Команда на связи");
  expect(initialText).not.toContain("Первый напарник — твой ход");
  expect(initialText).not.toContain("Неделя в движении");
  expect(initialText).not.toContain("Я в зале");

  // Принимаем входящую заявку и отправляем новую по коду
  await page.getByRole("button", { name: "Принять", exact: true }).click();
  await expect(page.locator(".friend-row-card").filter({ hasText: "Артём" })).toBeVisible();

  await page.getByLabel("Код или ссылка друга", { exact: true }).fill("112233445566");
  await page.getByRole("button", { name: "Отправить заявку", exact: true }).click();
  await expect(page.locator(".friend-request-row").filter({ hasText: "Иван" })).toBeVisible();

  if (process.env.SHOTS) {
    await page.screenshot({ path: `${process.env.SHOTS}/friends-1280.png`, fullPage: true });
  }

  // Переходим на вкладку «Программы» и создаём общую программу «Дэвид Лейд · DUP»
  await page.getByRole("tab", { name: /Программы/ }).click();
  await expect(page.locator(".shared-program-card").filter({ hasText: "Верх / Низ" })).toBeVisible();
  await page.getByRole("button", { name: "Общая программа", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Общая программа" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: /Дэвид Лейд · DUP/ }).click();
  await dialog.getByRole("button", { name: "Создать общую программу", exact: true }).click();

  await expect(page.locator(".shared-program-card").filter({ hasText: "Дэвид Лейд · DUP" })).toBeVisible();
  // 6 дней Лейда добавились в локальные программы пользователя
  await expect.poll(() => routines.filter((r) => r.periodization?.kind === "laid-dup").length).toBe(6);

  if (process.env.SHOTS) {
    await page.screenshot({ path: `${process.env.SHOTS}/friends-programs-1280.png`, fullPage: true });
  }

  // Принимаем расшаренную другом программу «Верх / Низ»
  const dimaProg = page.locator(".shared-program-card").filter({ hasText: "Верх / Низ" });
  await dimaProg.getByRole("button", { name: "Добавить себе и тренироваться", exact: true }).click();
  await expect(dimaProg.getByRole("button", { name: "Тренироваться", exact: true })).toBeVisible();

  // Проверяем вкладку «Вместе»
  await page.getByRole("tab", { name: /Вместе/ }).click();
  await expect(page.getByRole("button", { name: "Создать комнату", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Создать комнату", exact: true }).click();
  await expect(page.getByRole("region", { name: "Комната совместной тренировки" })).toBeVisible();

  // Мобилка 320px без переполнения и мелких кнопок
  await page.getByRole("tab", { name: /Друзья/ }).click();
  await page.setViewportSize({ width: 320, height: 640 });
  expect(await overflow(page)).toBeLessThanOrEqual(1);
  expect(await smallTargets(page)).toEqual([]);
  expect((await clipped(page, "main")).wide).toEqual([]);
  if (process.env.SHOTS) {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: `${process.env.SHOTS}/friends-390.png`, fullPage: true });
  }
});
