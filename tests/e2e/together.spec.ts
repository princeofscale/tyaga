import { mockWeights } from "./fixtures/bodyweight";
import { liveMock, liveState, member, mockLive, ROOM_CODE, roomWithPartner, UNKNOWN_CODE } from "./fixtures/live";
import { test, expect, type Page } from "@playwright/test";
import { DEFAULT_SETTINGS, makeWorkout } from "../../src/lib/model";
import type { FriendsData } from "../../src/domain/FriendsService";
import type { LiveRoom } from "../../src/lib/liveRoom";

// Все запросы перехвачены: ни настоящие пользователи, ни прод-D1 здесь не затрагиваются.
async function fixture(page: Page, options: { room?: LiveRoom | null; signedIn?: boolean; saved?: boolean } = {}) {
  let signedIn = options.signedIn ?? true;
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
  const friends: FriendsData = {
    me: { id: "me", displayName: "Саша", inviteCode: "A1B2C3D4E5F6", gym: "", focus: "", activeUntil: 0, weekWorkouts: 0 },
    friends: [],
    requests: [],
    feed: [],
    weekStart: today,
    today,
    serverTime: now,
  };
  // Одна сохранённая тренировка: её можно открыть и править.
  const saved = makeWorkout(["bench"], [], "UTC");
  saved.id = "saved-1";
  saved.name = "Старая тренировка";
  saved.date = today;
  saved.exercises[0].sets[0] = { ...saved.exercises[0].sets[0], done: true, weight: 60, reps: 8 };
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/api/**", async (route) => {
    const request = route.request(),
      path = new URL(request.url()).pathname,
      method = request.method();
    const json = (value: unknown, status = 200) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(value) });
    if (path === "/api/auth/session") return json({ registered: true, profile: signedIn ? profile : null });
    if (path === "/api/auth/login") {
      signedIn = true;
      return json({ profile });
    }
    if (path === "/api/data")
      return json({ workouts: options.saved ? [saved] : [], settings: { ...DEFAULT_SETTINGS, timeZone: "UTC" } });
    if (path === "/api/product") return json({ routines: [], customExercises: [], favorites: [] });
    if (path === "/api/challenges" && method === "GET") return json({ accountId: profile.id, challenges: [] });
    if (path === "/api/friends" && method === "GET") return json({ ...friends, serverTime: Date.now() });
    if (path === "/api/workouts" && method === "PUT") return json({ workout: { ...request.postDataJSON(), revision: 1 } });
    unexpected.push(`${method} ${path}`);
    return json({ error: "Unmocked request; never forwarded" }, 503);
  });
  await mockWeights(page, profile.id);
  const live = await mockLive(page, liveMock(options.room ?? null), profile.displayName);
  return {
    live,
    clean: () => {
      expect(errors).toEqual([]);
      expect(unexpected).toEqual([]);
    },
  };
}

const nav = (page: Page) => page.getByRole("navigation", { name: "Основная навигация" });
async function openFriends(page: Page) {
  await nav(page).getByRole("button", { name: "Друзья", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Напарники", exact: true })).toBeVisible();
}
const roomCard = (page: Page) => page.getByRole("region", { name: "Комната совместной тренировки" });
const codeLabel = (code: string) => `Код комнаты ${[...code].join(" ")}`;
async function startBench(page: Page) {
  await page.getByRole("button", { name: "Начать тренировку", exact: true }).click();
  await page.getByRole("button", { name: "Добавить упражнение", exact: true }).click();
  await page.getByRole("button", { name: "Добавить Жим штанги лёжа", exact: true }).click();
  await page.getByRole("button", { name: "Готово", exact: true }).click();
}
async function markFirstSet(page: Page) {
  await page.getByLabel("Жим штанги лёжа, подход 1, вес", { exact: true }).fill("70");
  await page
    .getByRole("button", { name: "Отметить выполненным: Жим штанги лёжа, подход 1", exact: true })
    .click();
}

test("outside a room the app asks about rooms once and never polls", async ({ page }) => {
  const f = await fixture(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Сегодня", exact: true })).toBeVisible();
  await expect.poll(() => f.live.seen).toEqual(["GET /api/friends/live"]);
  await openFriends(page);
  await expect(page.getByRole("button", { name: "Создать комнату", exact: true })).toBeVisible();
  // Опрос идёт раз в 5 с и только внутри комнаты: шесть секунд вне комнаты не добавляют ни одного запроса.
  await page.waitForTimeout(6000);
  expect(f.live.seen).toEqual(["GET /api/friends/live"]);
  f.clean();
});

test("create a room, see a partner arrive on the next poll, leave", async ({ page }) => {
  const f = await fixture(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await openFriends(page);
  await page.getByRole("button", { name: "Создать комнату", exact: true }).click();
  await expect(roomCard(page).getByRole("img", { name: codeLabel("H7KQ2") })).toBeVisible();
  await expect(roomCard(page)).toContainText("Пока ты один");
  // Напарник входит позже: приложение узнаёт об этом очередным опросом.
  f.live.room!.members.push(member({ id: 2, displayName: "Дмитрий", state: liveState() }));
  await expect(roomCard(page).getByText("Жим штанги лёжа · 2/4")).toBeVisible({ timeout: 12_000 });
  await expect(roomCard(page)).not.toContainText("Пока ты один");
  await roomCard(page).getByRole("button", { name: "Покинуть комнату", exact: true }).click();
  await expect(page.getByRole("button", { name: "Создать комнату", exact: true })).toBeVisible();
  expect(f.live.seen).toContain("DELETE /api/friends/live");
  f.clean();
});

test("joining by code normalizes the input and shows the reason when the room is gone", async ({ page }) => {
  const f = await fixture(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await openFriends(page);
  await page.getByRole("button", { name: "Ввести код", exact: true }).click();
  const field = page.getByLabel("Код комнаты", { exact: true });
  await field.fill(UNKNOWN_CODE.toLowerCase());
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Комната не найдена или уже закрыта");
  await expect(field).toHaveValue(UNKNOWN_CODE.toLowerCase());
  await field.fill("k7-m2q");
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(roomCard(page).getByRole("img", { name: codeLabel(ROOM_CODE) })).toBeVisible();
  await expect(roomCard(page)).toContainText("Дмитрий");
  expect(f.live.joined).toEqual([UNKNOWN_CODE, ROOM_CODE]);
  f.clean();
});

test("during a workout the strip shows the partner, my sets reach the room and finishing closes my part", async ({ page }) => {
  const f = await fixture(page, { room: roomWithPartner() });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await startBench(page);
  const strip = page.getByRole("region", { name: "Напарники в комнате" });
  await expect(strip).toContainText("Дмитрий");
  await expect(strip).toContainText("Жим штанги лёжа · 2/4");
  await markFirstSet(page);
  await expect.poll(() => f.live.pushed.at(-1)?.setsDone, { timeout: 5000 }).toBe(1);
  expect(f.live.pushed.at(-1)).toMatchObject({ exercise: "Жим штанги лёжа" });
  expect(f.live.pushed.at(-1)!.tonnageKg).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Завершить тренировку", exact: true }).click();
  await expect.poll(() => f.live.pushed.at(-1)?.phase, { timeout: 5000 }).toBe("done");
  f.clean();
});

test("the strip opens the room and stays out of the way when nobody else is there", async ({ page }) => {
  const f = await fixture(page, { room: roomWithPartner() });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await startBench(page);
  const strip = page.getByRole("region", { name: "Напарники в комнате" });
  await strip.getByRole("button", { name: `Открыть комнату ${ROOM_CODE}`, exact: true }).click();
  await expect(roomCard(page)).toBeVisible();
  await expect(roomCard(page).getByRole("button", { name: "Открыть тренировку", exact: true })).toBeVisible();
  // Дмитрий вышел: на следующем опросе полоса исчезает, а комната остаётся.
  f.live.room = { code: ROOM_CODE, members: f.live.room!.members.filter((x) => x.isMe) };
  await roomCard(page).getByRole("button", { name: "Открыть тренировку", exact: true }).click();
  await expect(strip).toHaveCount(0, { timeout: 12_000 });
  f.clean();
});

test("a phone in landscape scrolls the workout header with the sets instead of pinning it", async ({ page }) => {
  const f = await fixture(page, { room: roomWithPartner() });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await startBench(page);
  const bar = page.locator(".workout-bar");
  await expect(page.getByRole("region", { name: "Напарники в комнате" })).toBeVisible();
  await expect(bar).toHaveCSS("position", "sticky");
  await page.setViewportSize({ width: 800, height: 360 });
  await expect(bar).toHaveCSS("position", "static");
  f.clean();
});

test("a slow poll that answers after I left cannot bring the room back", async ({ page }) => {
  const f = await fixture(page, { room: roomWithPartner() });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await openFriends(page);
  await expect(roomCard(page)).toBeVisible();
  let release!: () => void;
  f.live.hold = new Promise<void>((resolve) => (release = resolve));
  // Очередной опрос (раз в 5 с) зависает на «сервере», а человек в это время выходит из комнаты.
  await expect.poll(() => f.live.seen.filter((x) => x === "GET /api/friends/live").length, { timeout: 12_000 }).toBe(2);
  await roomCard(page).getByRole("button", { name: "Покинуть комнату", exact: true }).click();
  await expect(page.getByRole("button", { name: "Создать комнату", exact: true })).toBeVisible();
  // Запоздавший ответ доходит уже после выхода. Проверка без повторов: следующий опрос всё равно исправил бы экран,
  // поэтому «потом стало правильно» ничего не доказывает.
  const stale = page.waitForResponse((r) => r.url().includes("/api/friends/live") && r.request().method() === "GET");
  release();
  f.live.hold = null;
  await stale;
  await page.waitForTimeout(300);
  expect(await page.getByRole("button", { name: "Создать комнату", exact: true }).count()).toBe(1);
  expect(await roomCard(page).count()).toBe(0);
  f.clean();
});

test("editing a saved workout is not broadcast to the room", async ({ page }) => {
  const f = await fixture(page, { room: roomWithPartner(), saved: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await nav(page).getByRole("button", { name: "История", exact: true }).click();
  await page.locator(".session-item").filter({ hasText: "Старая тренировка" }).click();
  await page.getByRole("button", { name: "Редактировать", exact: true }).click();
  await page.getByLabel("Жим штанги лёжа, подход 1, вес", { exact: true }).fill("65");
  await page.waitForTimeout(1500);
  expect(f.live.pushed).toEqual([]);
  f.clean();
});

test("without a room, workout sets are not sent anywhere", async ({ page }) => {
  const f = await fixture(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await startBench(page);
  await markFirstSet(page);
  await page.waitForTimeout(1500);
  expect(f.live.seen).toEqual(["GET /api/friends/live"]);
  expect(f.live.pushed).toEqual([]);
  f.clean();
});

test("a room link asks before joining and leaves the address clean", async ({ page }) => {
  const f = await fixture(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/?r=${ROOM_CODE}`);
  const invite = page.getByRole("region", { name: `Тебя зовут в комнату ${ROOM_CODE}` });
  await expect(invite).toBeVisible();
  await expect(page).toHaveURL("http://localhost:5173/");
  expect(f.live.joined, "согласие спрашиваем до входа").toEqual([]);
  await invite.getByRole("button", { name: "Войти в комнату", exact: true }).click();
  await expect(roomCard(page)).toBeVisible();
  await expect(page.getByText(`Ты в комнате ${ROOM_CODE}`)).toBeVisible();
  await expect(invite).toHaveCount(0);
  expect(f.live.joined).toEqual([ROOM_CODE]);
  f.clean();
});

test("a link to a closed room explains why once and leaves no stale error behind", async ({ page }) => {
  const f = await fixture(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/?r=${UNKNOWN_CODE}`);
  const invite = page.getByRole("region", { name: `Тебя зовут в комнату ${UNKNOWN_CODE}` });
  await invite.getByRole("button", { name: "Войти в комнату", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveCount(1);
  await expect(invite.getByRole("alert")).toHaveText("Комната не найдена или уже закрыта");
  await invite.getByRole("button", { name: "Не сейчас", exact: true }).click();
  await expect(invite).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Создать комнату", exact: true })).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(f.live.joined).toEqual([UNKNOWN_CODE]);
  f.clean();
});

test("a declined room link never joins", async ({ page }) => {
  const f = await fixture(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/?r=${ROOM_CODE}`);
  const invite = page.getByRole("region", { name: `Тебя зовут в комнату ${ROOM_CODE}` });
  await invite.getByRole("button", { name: "Не сейчас", exact: true }).click();
  await expect(invite).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Создать комнату", exact: true })).toBeVisible();
  expect(f.live.joined).toEqual([]);
  f.clean();
});

test("a room link survives sign-in", async ({ page }) => {
  const f = await fixture(page, { signedIn: false });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/?r=${ROOM_CODE}`);
  await page.getByLabel("Почта", { exact: true }).fill("test@example.test");
  await page.getByLabel("Пароль", { exact: true }).fill("test passphrase");
  await page.getByRole("button", { name: "Войти в Тягу", exact: true }).click();
  await expect(page.getByRole("region", { name: `Тебя зовут в комнату ${ROOM_CODE}` })).toBeVisible();
  expect(f.live.joined).toEqual([]);
  f.clean();
});

test("a malformed room link is ignored", async ({ page }) => {
  const f = await fixture(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?r=ab");
  await expect(page.getByRole("heading", { name: "Сегодня", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: /Тебя зовут в комнату/ })).toHaveCount(0);
  await expect(page).toHaveURL("http://localhost:5173/?r=ab");
  f.clean();
});
