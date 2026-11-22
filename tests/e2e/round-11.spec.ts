import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { nav, round01Fixture, startWith } from "./fixtures/round01";
import { smallTargets, clipped } from "./fixtures/touch";
import type { Draft } from "../../src/lib/draft";
import type { PendingItem } from "../../src/domain/PendingWorkouts";

/**
 * Раунд 11 на телефоне (390×844, 360×800, 320×640), приложение на подставных ответах.
 * Сегодня в фикстуре — вторник 10 нояб. 2026.
 */
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, locale: "ru-RU", timezoneId: "Europe/Saratov" });

const BENCH = "Жим штанги лёжа";
const SIZES = [{ width: 390, height: 844 }, { width: 360, height: 800 }, { width: 320, height: 640 }];
const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

// ───────────── REQ02: две вкладки одного аккаунта ─────────────
const DRAFT_KEY = "tyaga-draft-account:round01-user";
const PENDING_KEY = "tyaga-pending-workouts:round01-user";
const readStorage = (page: Page, key: string) => page.evaluate((k) => localStorage.getItem(k), key);
const draftKeys = (page: Page) => page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("tyaga-draft-account:")));
const storedDraft = async (page: Page): Promise<Draft | null> => JSON.parse((await readStorage(page, DRAFT_KEY)) ?? "null");
async function openSecondTab(context: BrowserContext, size = { width: 390, height: 844 }) {
  const tab = await context.newPage();
  await tab.setViewportSize(size);
  await round01Fixture(tab);
  return tab;
}
async function set(page: Page, n: number, kg: string, reps: string, done = true) {
  await page.getByLabel(`${BENCH}, подход ${n}, вес`, { exact: true }).fill(kg);
  await page.getByLabel(`${BENCH}, подход ${n}, повторы`, { exact: true }).fill(reps);
  if (done) await page.getByRole("button", { name: `Отметить выполненным: ${BENCH}, подход ${n}`, exact: true }).click();
}
const follower = (page: Page) => page.getByText("Эта тренировка открыта в другом окне — здесь только просмотр.", { exact: true });
const takeover = (page: Page) => page.getByRole("button", { name: "Продолжить здесь", exact: true });
const resume = (page: Page) => page.getByRole("button", { name: /Продолжить тренировку/ }).first().click();
const editor = (page: Page) => page.locator(".workout-edit-frame");
const ownerRow = (page: Page) => page.getByText("Это окно основное — изменения сохраняются", { exact: true });
async function handoff(page: Page) {
  await takeover(page).click();
  await expect(ownerRow(page)).toBeVisible();
  await expect(editor(page)).not.toHaveAttribute("inert");
}

test("R11-REQ02 / 1: вкладка, открытая до начала тренировки в другой, за 3 с показывает «Продолжить тренировку»; «Начать» второй тренировки не создаёт", async ({ page, context }) => {
  test.setTimeout(120_000);
  await round01Fixture(page);
  const tab2 = await openSecondTab(context);
  await expect(page.getByRole("button", { name: "Начать тренировку", exact: true }).first()).toBeVisible();
  await startWith(tab2, BENCH);
  await set(tab2, 1, "80", "5");
  await page.bringToFront();
  await expect(page.getByRole("button", { name: /Продолжить тренировку/ }).first()).toBeVisible({ timeout: 3000 });
  await expect(page.getByRole("button", { name: "Начать тренировку", exact: true })).toHaveCount(0);
  expect(await draftKeys(page)).toHaveLength(1);
  // Открывается та же тренировка в режиме просмотра; владелец не меняется.
  const owner = (await storedDraft(page))!.owner;
  await resume(page);
  await expect(follower(page)).toBeVisible({ timeout: 3000 });
  await expect(editor(page)).toHaveAttribute("inert");
  expect((await storedDraft(page))!.owner).toBe(owner);
  await expect(page.getByLabel(`${BENCH}, подход 1, вес`, { exact: true })).toHaveValue("80");
  const d = await storedDraft(page);
  expect(d!.workout.exercises[0].sets[0]).toMatchObject({ weight: 80, reps: 5, done: true });
  expect(await draftKeys(page)).toHaveLength(1);
});

test("R11-REQ02 / 2: подход, отмеченный в одной вкладке, за 3 с виден в другой; в неосновной — строка «открыта в другом окне», «Продолжить здесь» делает окно основным", async ({ page, context }) => {
  test.setTimeout(120_000);
  await round01Fixture(page);
  await startWith(page, BENCH);
  await set(page, 1, "80", "5");
  const tab2 = await openSecondTab(context);
  await resume(tab2);
  await expect(follower(tab2)).toBeVisible({ timeout: 3000 });
  await handoff(tab2);
  await expect(tab2.getByLabel(`${BENCH}, подход 1, вес`, { exact: true })).toHaveValue("80");
  await expect(follower(tab2)).toHaveCount(0);
  await page.bringToFront();
  await expect(follower(page)).toBeVisible({ timeout: 3000 });
  // P2 отмечает подход 2 — P1 (неосновная) видит его за 3 с
  await set(tab2, 2, "82.5", "5");
  await expect(page.getByLabel(`${BENCH}, подход 2, вес`, { exact: true })).toHaveValue("82.5", { timeout: 3000 });
  // «Продолжить здесь»: P1 основная, P2 ведомая; подходы не потеряны
  await handoff(page);
  await expect(follower(page)).toHaveCount(0);
  await tab2.bringToFront();
  await expect(follower(tab2)).toBeVisible({ timeout: 3000 });
  await page.bringToFront();
  await set(page, 3, "85", "5");
  await tab2.bringToFront();
  await expect(tab2.getByLabel(`${BENCH}, подход 3, вес`, { exact: true })).toHaveValue("85", { timeout: 3000 });
  // Только явная передача позволяет P2 исправить подход 3; P1 увидит правку.
  await handoff(tab2);
  await set(tab2, 3, "87.5", "4", false);
  await expect
    .poll(async () => (await storedDraft(tab2))!.workout.exercises[0].sets.slice(0, 3).map((s) => [s.weight, s.done]))
    .toEqual([[80, true], [82.5, true], [87.5, true]]);
  await page.bringToFront();
  await expect(page.getByLabel(`${BENCH}, подход 3, вес`, { exact: true })).toHaveValue("87.5", { timeout: 3000 });
  await expect(follower(page)).toBeVisible();
  expect(await draftKeys(page)).toHaveLength(1);
});

test("R11-REQ02 / 3: «Да, отменить тренировку» в одной вкладке убирает черновик в другой, отметка старой вкладки его не возвращает", async ({ page, context }) => {
  test.setTimeout(120_000);
  await round01Fixture(page);
  await startWith(page, BENCH);
  await set(page, 1, "80", "5");
  const tab2 = await openSecondTab(context);
  await tab2.getByRole("button", { name: /Продолжить тренировку/ }).first().click();
  await expect(tab2.getByLabel(`${BENCH}, подход 1, вес`, { exact: true })).toBeVisible();
  await handoff(tab2);
  await tab2.getByRole("button", { name: "Отмена", exact: true }).click();
  await tab2.getByRole("button", { name: "Да, отменить тренировку", exact: true }).click();
  await expect(tab2.getByRole("heading", { name: "Сегодня", exact: true })).toBeVisible();
  await page.bringToFront();
  // за 3 с: тренировки в P1 нет, строка об этом, «Продолжить» нет
  await expect(page.getByText("Тренировка закончена или отменена в другом окне")).toBeVisible({ timeout: 3000 });
  await expect(page.getByRole("button", { name: /Продолжить тренировку/ })).toHaveCount(0);
  await expect(page.getByLabel(`${BENCH}, подход 1, вес`, { exact: true })).toHaveCount(0);
  // любые действия в P1 не возвращают ключ — 10 с
  await nav(page, "История").click();
  await nav(page, "Сегодня").click();
  await page.waitForTimeout(10_000);
  expect(await draftKeys(page)).toEqual([]);
  expect(await draftKeys(tab2)).toEqual([]);
  await page.reload();
  await expect(page.getByRole("button", { name: "Начать тренировку", exact: true }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: /Продолжить тренировку/ })).toHaveCount(0);
});

test("R11-REQ02 / 4: «Завершить» в одной вкладке — в истории одна тренировка, у второй черновика нет", async ({ page, context }) => {
  test.setTimeout(120_000);
  const f = await round01Fixture(page);
  await startWith(page, BENCH);
  await set(page, 1, "80", "5");
  const tab2 = await openSecondTab(context);
  await tab2.getByRole("button", { name: /Продолжить тренировку/ }).first().click();
  await expect(tab2.getByLabel(`${BENCH}, подход 1, вес`, { exact: true })).toBeVisible();
  await page.bringToFront();
  await set(page, 2, "80", "5");
  await page.getByRole("button", { name: "Завершить тренировку", exact: true }).click();
  await expect(page.getByRole("button", { name: "Завершить тренировку", exact: true })).toHaveCount(0);
  await tab2.bringToFront();
  await expect(tab2.getByText("Тренировка закончена или отменена в другом окне")).toBeVisible({ timeout: 3000 });
  await expect(tab2.getByRole("button", { name: /Продолжить тренировку/ })).toHaveCount(0);
  await tab2.waitForTimeout(3000);
  expect(await draftKeys(tab2)).toEqual([]);
  expect(f.workouts.length, "тренировка записана один раз").toBe(1);
});

test("R11-REQ02: перезагрузка основной вкладки не показывает строку «в другом окне»; закрытие окна с тренировкой — вторая продолжает без строки", async ({ page, context }) => {
  test.setTimeout(120_000);
  await round01Fixture(page);
  await startWith(page, BENCH);
  await set(page, 1, "80", "5");
  await page.reload();
  await page.getByRole("button", { name: /Продолжить тренировку/ }).first().click();
  await expect(page.getByLabel(`${BENCH}, подход 1, вес`, { exact: true })).toHaveValue("80");
  await expect(follower(page)).toHaveCount(0);
  // второе окно закрыто (событий нет, ключ остаётся) — новая вкладка открывает тренировку без строки про другое окно
  const tab2 = await openSecondTab(context);
  await page.close();
  await tab2.reload();
  await tab2.getByRole("button", { name: /Продолжить тренировку/ }).first().click();
  await expect(tab2.getByLabel(`${BENCH}, подход 1, вес`, { exact: true })).toHaveValue("80");
  await tab2.waitForTimeout(800);
  await expect(follower(tab2)).toHaveCount(0);
  await set(tab2, 2, "82.5", "5");
  expect((await storedDraft(tab2))!.workout.exercises[0].sets[1]).toMatchObject({ weight: 82.5, done: true });
});

test("R11-REQ02: без связи две вкладки делят черновик так же (сеть для этого не нужна)", async ({ page, context }) => {
  test.setTimeout(120_000);
  await round01Fixture(page);
  await startWith(page, BENCH);
  await set(page, 1, "80", "5");
  const tab2 = await openSecondTab(context);
  await tab2.getByRole("button", { name: /Продолжить тренировку/ }).first().click();
  await context.setOffline(true);
  await handoff(tab2);
  await set(tab2, 2, "82.5", "5");
  await page.bringToFront();
  await expect(page.getByLabel(`${BENCH}, подход 2, вес`, { exact: true })).toHaveValue("82.5", { timeout: 3000 });
  await context.setOffline(false);
});

for (const size of SIZES) {
  test(`R11-REQ02: строка «Эта тренировка открыта в другом окне» и «Продолжить здесь» на ${size.width}×${size.height} — без сдвига и срезов, цель ≥ 44 px`, async ({ page, context }) => {
    test.setTimeout(120_000);
    await page.setViewportSize(size);
    await round01Fixture(page);
    await startWith(page, BENCH);
    await set(page, 1, "80", "5");
    const tab2 = await openSecondTab(context, size);
    await resume(tab2);
    await handoff(tab2);
    await page.bringToFront();
    await expect(follower(page)).toBeVisible({ timeout: 3000 });
    expect(await overflow(page)).toBeLessThanOrEqual(1);
    const btn = takeover(page);
    const box = await btn.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(43.5);
    expect((await clipped(page, ".draft-follower")).wide).toEqual([]);
    expect((await smallTargets(page)).filter((t) => t.cls.includes("draft") || t.text.includes("Продолжить здесь"))).toEqual([]);
  });
}

test("R11-REQ02: URL, Назад, focus и pageshow сверяют вид, не передавая роль", async ({ page, context }) => {
  await round01Fixture(page);
  await startWith(page, BENCH);
  await set(page, 1, "80", "5");
  const owner = (await storedDraft(page))!.owner;
  const tab2 = await context.newPage();
  await tab2.addInitScript((key) => window.addEventListener("storage", (event) => {
    if (event.key === key) event.stopImmediatePropagation();
  }, true), DRAFT_KEY);
  await round01Fixture(tab2);
  await tab2.goto("/?fixture=draft-handoff");
  await resume(tab2);
  await expect(follower(tab2)).toBeVisible();
  await expect(editor(tab2)).toHaveAttribute("inert");
  const url = tab2.url();
  await tab2.goBack();
  await expect(tab2.getByRole("heading", { name: "Сегодня", exact: true })).toBeVisible();
  await expect(tab2).toHaveURL(url);
  await resume(tab2);
  const weight = tab2.getByLabel(`${BENCH}, подход 1, вес`, { exact: true });
  for (const [event, value] of [["focus", "82.5"], ["pageshow", "85"]] as const) {
    await set(page, 1, value, "5", false);
    await tab2.evaluate((type) => window.dispatchEvent(new Event(type)), event);
    await expect(weight).toHaveValue(value);
    await expect(follower(tab2)).toBeVisible();
    expect((await storedDraft(tab2))!.owner).toBe(owner);
  }
});

test("R11-REQ02: устаревшая кнопка передачи сначала открывает новый черновик, даже если id тот же", async ({ page, context }) => {
  await round01Fixture(page);
  await startWith(page, BENCH);
  await set(page, 1, "80", "5");
  const before = (await storedDraft(page))!;
  const followerTab = await context.newPage();
  await followerTab.addInitScript((key) => {
    window.addEventListener("storage", (event) => {
      if (event.key === key) event.stopImmediatePropagation();
    }, true);
    for (const event of ["focus", "pageshow"])
      window.addEventListener(event, (value) => value.stopImmediatePropagation(), true);
    document.addEventListener("visibilitychange", (event) => event.stopImmediatePropagation(), true);
  }, DRAFT_KEY);
  await round01Fixture(followerTab);
  await resume(followerTab);
  await expect(follower(followerTab)).toBeVisible();
  const weight = followerTab.getByLabel(`${BENCH}, подход 1, вес`, { exact: true });
  await expect(weight).toHaveValue("80");
  const next = structuredClone(before);
  next.startedAt++;
  next.claim = (next.claim ?? 0) + 1;
  next.workout.exercises[0].sets[0].weight = 85;
  await page.evaluate(([key, record]) => localStorage.setItem(key, JSON.stringify(record)), [DRAFT_KEY, next] as const);
  await takeover(followerTab).click();
  await expect(weight).toHaveValue("85");
  await expect(editor(followerTab)).toHaveAttribute("inert");
  expect(await storedDraft(followerTab)).toEqual(next);
  await handoff(followerTab);
  expect((await storedDraft(followerTab))!.owner).not.toBe(before.owner);
});

test("R11-REQ02: офлайн после передачи — одна очередь и одна отправка при возвращении сети", async ({ page, context }) => {
  const former = await round01Fixture(page);
  await startWith(page, BENCH);
  await set(page, 1, "80", "5");
  const original = (await storedDraft(page))!.workout.id;
  const tab2 = await context.newPage();
  const f = await round01Fixture(tab2);
  await resume(tab2);
  let offline = true;
  let sent = 0;
  await tab2.route("**/api/workouts", (route) => {
    if (route.request().method() !== "PUT") return route.fallback();
    if (offline) return route.abort("internetdisconnected");
    sent++;
    return route.fallback();
  });
  await context.setOffline(true);
  await handoff(tab2);
  await set(tab2, 2, "82.5", "4");
  await tab2.getByRole("button", { name: "Завершить тренировку", exact: true }).click();
  await expect(tab2.locator(".pending-banner")).toContainText("Ждёт отправки: 1");
  await expect(page.getByText("Тренировка закончена или отменена в другом окне")).toBeVisible();
  expect(await draftKeys(page)).toEqual([]);
  const queued = JSON.parse((await readStorage(tab2, PENDING_KEY))!) as PendingItem[];
  expect(queued).toHaveLength(1);
  expect(queued[0].workout.id).toBe(original);
  expect(queued[0].workout.exercises[0].sets.filter((s) => s.done)).toMatchObject([
    { weight: 80, reps: 5, done: true }, { weight: 82.5, reps: 4, done: true },
  ]);
  expect(f.savedBodies).toHaveLength(0);
  offline = false;
  await context.setOffline(false);
  await expect.poll(() => f.savedBodies.length).toBe(1);
  await expect.poll(() => readStorage(tab2, PENDING_KEY)).toBeNull();
  expect(f.savedBodies[0]).toEqual(queued[0].workout);
  await tab2.reload();
  await expect(tab2.getByRole("heading", { name: "Сегодня", exact: true })).toBeVisible();
  expect(sent).toBe(1);
  expect(former.savedBodies, "бывший владелец не отправляет копию").toHaveLength(0);
  expect(f.workouts).toHaveLength(1);
  expect(await draftKeys(tab2)).toEqual([]);
});

test("R11-REQ02: старый запрос завершения не ставит в очередь данные после передачи туда и обратно", async ({ page, context }) => {
  const f = await round01Fixture(page);
  await startWith(page, BENCH);
  await set(page, 1, "80", "5");
  const original = (await storedDraft(page))!;
  const tab2 = await openSecondTab(context);
  await resume(tab2);
  await expect(follower(tab2)).toBeVisible();
  let fail = () => {};
  const hold = new Promise<void>((resolve) => { fail = resolve; });
  let attempted = 0;
  await page.route("**/api/workouts", async (route) => {
    if (route.request().method() !== "PUT") return route.fallback();
    if (++attempted !== 1) return route.fallback();
    await hold;
    return route.abort("internetdisconnected");
  });
  const finish = page.getByRole("button", { name: "Завершить тренировку", exact: true });
  await finish.click();
  await expect.poll(() => attempted).toBe(1);
  try {
    await handoff(tab2);
    await set(tab2, 1, "82.5", "4", false);
    await handoff(page);
    expect((await storedDraft(page))!.owner).toBe(original.owner);
  } finally {
    fail();
  }
  await expect(finish).toBeEnabled();
  expect(await readStorage(page, PENDING_KEY)).toBeNull();
  const retained = (await storedDraft(page))!;
  expect(retained.workout.id).toBe(original.workout.id);
  expect(retained.workout.exercises[0].sets[0]).toMatchObject({ weight: 82.5, reps: 4, done: true });
  await finish.click();
  await expect.poll(() => f.savedBodies.length).toBe(1);
  expect(f.savedBodies[0].exercises[0].sets[0]).toMatchObject({ weight: 82.5, reps: 4, done: true });
  await expect.poll(() => draftKeys(tab2)).toEqual([]);
  expect(attempted).toBe(2);
});

// ───────────── REQ01: Лейд — «Повторить прошлые» и «+2,5 кг» ─────────────
import { doneWorkout } from "./fixtures/round01";
import { LaidDupPlan } from "../../src/domain/LaidDupPlan";
import type { LaidMaxes, Routine, Workout } from "../../src/lib/types";

const MAXES: LaidMaxes = { squat: 100, bench: 80, deadlift: 140, ohp: 60 };
const sixRoutines = (startMonday = "2026-11-09") => LaidDupPlan.routines({ maxes: MAXES, extras: true, light: false, startMonday }).map((r) => ({ ...r, revision: 1 }));
/** Приложение + программы в памяти: GET /api/product отдаёт их, PUT сохраняет. */
async function appWith(page: Page, routines: Routine[], workouts: Workout[] = []) {
  await round01Fixture(page, { workouts });
  const store = [...routines];
  await page.route("**/api/product", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ routines: store, favorites: [], customExercises: [] }) }),
  );
  await page.reload();
  return store;
}
const card = (page: Page, exercise: string) => page.locator("article.exercise-card").filter({ has: page.getByRole("heading", { name: exercise, exact: true }) });
const weightOf = (page: Page, exercise: string, n: number) => page.getByLabel(`${exercise}, подход ${n}, вес`, { exact: true });
async function startProgram(page: Page, name: string) {
  await nav(page, "Программы").click();
  await page.locator("article.routine-card").filter({ has: page.getByRole("heading", { name, exact: true }) }).getByRole("button", { name: "Начать", exact: true }).click();
}
const HISTORY = () => [
  doneWorkout("Жим раньше", "2026-11-03", [["bench", 90, 3, 2], ["fly-db-flat", 12.5, 11, 2]]),
  doneWorkout("Верх раньше", "2026-11-04", [["bench", 70, 8, 2]]),
];
const PLAN_NOTE = "Вес по плану недели. Поправить — в строке подхода.";
const PLUS = "+2.5 кг";

for (const size of SIZES) {
  test(`R11-REQ01: «Лейд · Жим 1» — у жима лёжа нет «Повторить прошлые» и «+2,5 кг», есть строка про вес по плану; план цел; вспомогательные с кнопками ${size.width}×${size.height}`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize(size);
    await appWith(page, sixRoutines(), HISTORY());
    await startProgram(page, "Лейд · Жим 1");
    const bench = card(page, BENCH);
    await expect(weightOf(page, BENCH, 1)).toHaveValue("75");
    await expect(weightOf(page, BENCH, 2)).toHaveValue("67.5");
    await expect(bench.getByText(PLAN_NOTE)).toBeVisible();
    await expect(bench.getByRole("button", { name: /Повторить прошлые/ })).toHaveCount(0);
    await expect(bench.getByRole("button", { name: PLUS, exact: true })).toHaveCount(0);
    // вспомогательное с весом из истории: кнопки есть и работают
    const fly = card(page, "Разведения гантелей лёжа");
    await expect(fly.getByText(PLAN_NOTE)).toHaveCount(0);
    await expect(fly.getByRole("button", { name: PLUS, exact: true })).toBeVisible();
    await fly.getByRole("button", { name: /Повторить прошлые: 12,5 × 11/ }).click();
    await expect(weightOf(page, "Разведения гантелей лёжа", 1)).toHaveValue("12.5");
    await expect(page.getByLabel("Разведения гантелей лёжа, подход 1, повторы", { exact: true })).toHaveValue("11");
    // жим лёжа после любых нажатий остался по плану
    await expect(weightOf(page, BENCH, 1)).toHaveValue("75");
    await expect(weightOf(page, BENCH, 4)).toHaveValue("67.5");
    // ручная правка тяжёлого подхода сохраняется, план и остальные подходы не меняются
    await weightOf(page, BENCH, 1).fill("77.5");
    await expect(weightOf(page, BENCH, 1)).toHaveValue("77.5");
    await expect(bench.getByText(/Тяжёлый подход: 1 × 1 повторение · 95 % от 1ПМ \(80 кг\) = 75 кг/)).toBeVisible();
    await expect(weightOf(page, BENCH, 2)).toHaveValue("67.5");
    await page.waitForTimeout(500);
    await expect(weightOf(page, BENCH, 1)).toHaveValue("77.5");
    expect(await overflow(page)).toBeLessThanOrEqual(1);
    expect((await clipped(page, "main")).wide).toEqual([]);
  });
}

test("R11-REQ01: базовое упражнение остальных дней Лейда (Ноги 1/2, Тяга 1/2, Жим 2) тоже без «Повторить прошлые» и «+2,5 кг»", async ({ page }) => {
  test.setTimeout(150_000);
  const hist = [
    doneWorkout("Ноги раньше", "2026-11-03", [["squat", 90, 5, 2]]),
    doneWorkout("Тяга раньше", "2026-11-04", [["deadlift-bar", 120, 3, 2]]),
    doneWorkout("Жим 2 раньше", "2026-11-05", [["ohp-bar", 50, 5, 2]]),
  ];
  await appWith(page, sixRoutines(), hist);
  for (const [name, exercise] of [["Лейд · Ноги 1", "Приседания со штангой"], ["Лейд · Ноги 2", "Приседания со штангой"], ["Лейд · Тяга 1", "Становая тяга со штангой"], ["Лейд · Тяга 2", "Становая тяга со штангой"], ["Лейд · Жим 2", "Жим штанги стоя"]] as const) {
    await startProgram(page, name);
    const lift = card(page, exercise);
    await expect(lift.getByText(PLAN_NOTE), name).toBeVisible();
    await expect(lift.getByRole("button", { name: /Повторить прошлые/ }), name).toHaveCount(0);
    await expect(lift.getByRole("button", { name: PLUS, exact: true }), name).toHaveCount(0);
    await page.getByRole("button", { name: "Отмена", exact: true }).click();
    const yes = page.getByRole("button", { name: "Да, отменить тренировку", exact: true });
    if (await yes.isVisible().catch(() => false)) await yes.click();
  }
});

test("R11-REQ01: обычная программа — «Повторить прошлые» и «+2,5 кг» как раньше", async ({ page }) => {
  test.setTimeout(120_000);
  const plain = { ...sixRoutines()[1], id: "plain-upper", name: "Верх / низ", periodization: undefined, days: [1] } as Routine;
  await appWith(page, [plain], HISTORY());
  await startProgram(page, "Верх / низ");
  const bench = card(page, BENCH);
  await expect(bench.getByText(PLAN_NOTE)).toHaveCount(0);
  await expect(bench.getByRole("button", { name: /Повторить прошлые/ })).toBeVisible();
  await bench.getByRole("button", { name: /Повторить прошлые/ }).click();
  await expect(weightOf(page, BENCH, 1)).toHaveValue("70");
  await bench.getByRole("button", { name: PLUS, exact: true }).click();
  await expect(weightOf(page, BENCH, 1)).toHaveValue("72.5");
});

test("R11-REQ01: пустая тренировка — кнопки как раньше", async ({ page }) => {
  test.setTimeout(90_000);
  await round01Fixture(page, { workouts: HISTORY() });
  await startWith(page, BENCH);
  const bench = card(page, BENCH);
  await expect(bench.getByText(PLAN_NOTE)).toHaveCount(0);
  await expect(bench.getByRole("button", { name: /Повторить прошлые/ })).toBeVisible();
  await expect(bench.getByRole("button", { name: PLUS, exact: true })).toBeVisible();
});

// ───────────── REQ06: «Выйти из аккаунта» при просроченной сессии ─────────────
const EXPIRED = "Войди в Тягу. Черновик тренировки остаётся на этом устройстве.";
const openProfile = async (page: Page) => {
  const swallow = page.getByRole("button", { name: "Свернуть тренировку", exact: true });
  if (await swallow.isVisible().catch(() => false)) await swallow.click();
  await page.getByRole("button", { name: "Мой профиль", exact: true }).click();
};
const personalKeys = (page: Page) => page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("tyaga-") && !k.startsWith("tyaga_")));
for (const size of SIZES) {
  test(`R11-REQ06: сессия просрочена (401 на выход) — выход состоялся: экран входа, окно профиля закрыто, данные стёрты, «Черновик остаётся» не показано ${size.width}×${size.height}`, async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize(size);
    await round01Fixture(page);
    await startWith(page, BENCH);
    await set(page, 1, "60", "8");
    await expect.poll(() => personalKeys(page)).toContain("tyaga-draft-account:round01-user");
    await page.route("**/api/auth/logout", (route) => route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ error: EXPIRED }) }));
    await openProfile(page);
    await page.getByRole("dialog").getByRole("button", { name: "Выйти из аккаунта", exact: true }).click();
    await page.getByRole("button", { name: "Выйти", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Снова в зале" })).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByText(EXPIRED)).toHaveCount(0);
    await expect(page.getByText(/Черновик тренировки остаётся/)).toHaveCount(0);
    await expect.poll(() => personalKeys(page)).toEqual([]);
    expect(await overflow(page)).toBeLessThanOrEqual(1);
  });
}

test("R11-REQ06: 401 на выход без черновика — тоже выход; 5xx и обрыв связи — ошибка в окне, окно и данные остаются", async ({ page }) => {
  test.setTimeout(120_000);
  await round01Fixture(page);
  await page.route("**/api/auth/logout", (route) => route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ error: EXPIRED }) }));
  await openProfile(page);
  await page.getByRole("dialog").getByRole("button", { name: "Выйти из аккаунта", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Снова в зале" })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  const down = await page.context().newPage();
  await round01Fixture(down);
  await down.route("**/api/auth/logout", (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Сервис временно недоступен" }) }));
  await openProfile(down);
  const dialog = down.getByRole("dialog");
  await dialog.getByRole("button", { name: "Выйти из аккаунта", exact: true }).click();
  await expect(dialog.getByText("Сервис временно недоступен")).toBeVisible();
  await expect(down.getByRole("heading", { name: "Снова в зале" })).toHaveCount(0);
  await expect(dialog).toBeVisible();
  expect(await personalKeys(down)).toContain("tyaga-offline:session");

  await down.unroute("**/api/auth/logout");
  await down.route("**/api/auth/logout", (route) => route.abort("failed"));
  await dialog.getByRole("button", { name: "Выйти из аккаунта", exact: true }).click();
  await expect(dialog.getByText(/Запрос не завершился/)).toBeVisible();
  await expect(down.getByRole("heading", { name: "Снова в зале" })).toHaveCount(0);
  expect(await personalKeys(down)).toContain("tyaga-offline:session");
});

// ───────────── REQ03: «Восстановление из копии» и второй цикл Лейда ─────────────
const backupDir = mkdtempSync(join(tmpdir(), "tyaga-r11-e2e-"));
const cycleAt = (startMonday: string) => LaidDupPlan.routines({ maxes: MAXES, extras: true, light: false, startMonday }).map((r) => ({ ...r, revision: 1 }));
const NOTICE = "В копии есть цикл Лейда (старт 19 янв.), а у тебя уже есть свой (старт 16 нояб.). После импорта будут два цикла.";
function backupWith(name: string, routines: Routine[]) {
  const path = join(backupDir, name);
  writeFileSync(path, JSON.stringify({ format: "tyaga-backup", version: 5, workouts: [], routines, customExercises: [], favorites: [] }));
  return path;
}
async function restoreDialog(page: Page, file: string) {
  await nav(page, "Сегодня").click();
  await page.getByRole("button", { name: "Ещё", exact: true }).click();
  await page.getByRole("button", { name: /Резервная копия/ }).click();
  await page.getByRole("button", { name: "Восстановить из файла", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Восстановление из копии", exact: true });
  await dialog.getByLabel("Файл истории тренировок").setInputFiles(file);
  await dialog.getByRole("button", { name: "Показать предпросмотр", exact: true }).click();
  await expect(dialog.getByRole("region", { name: "Что в копии" })).toBeVisible();
  return dialog;
}
async function routineRestores(page: Page) {
  const sent: string[] = [];
  await page.route("**/api/import/metadata", async (route) => {
    const body = route.request().postDataJSON();
    if (body.kind === "routines") sent.push(...body.items.map((r: Routine) => r.id));
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ idMap: {}, exercises: [] }) });
  });
  return sent;
}

for (const size of SIZES) {
  test(`R11-REQ03: у аккаунта уже есть цикл Лейда, в копии другой — строка над «Импортировать»; со снятым чекбоксом строки нет и программы не добавляются ${size.width}×${size.height}`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize(size);
    const copy = cycleAt("2026-01-19");
    await round01Fixture(page, { routines: cycleAt("2026-11-16") });
    const sent = await routineRestores(page);
    const dialog = await restoreDialog(page, backupWith("two-cycles.json", copy));
    const notice = dialog.getByText(NOTICE, { exact: true });
    await expect(notice).toBeVisible();
    const go = dialog.getByRole("button", { name: "Импортировать", exact: true });
    const [n, g] = [await notice.boundingBox(), await go.boundingBox()];
    expect(n!.y + n!.height, "строка стоит над «Импортировать»").toBeLessThanOrEqual(g!.y);
    expect((await clipped(page, "[role=dialog]")).wide).toEqual([]);
    expect(await overflow(page)).toBeLessThanOrEqual(1);
    // со снятым «Перенести программы» циклов не прибавится: строки нет, программы не уходят
    const programs = dialog.getByLabel(/^Перенести программы/);
    await programs.uncheck();
    await expect(notice).toHaveCount(0);
    await go.click();
    await expect(dialog.getByRole("status", { name: "Итог восстановления" })).toBeVisible();
    expect(sent).toEqual([]);
  });
}

test("R11-REQ03: с галочкой — все шесть программ уходят на восстановление; итог «Восстановление завершено»; повторное восстановление циклов не плодит", async ({ page }) => {
  test.setTimeout(120_000);
  const copy = cycleAt("2026-01-19");
  const store: Routine[] = cycleAt("2026-11-16");
  await round01Fixture(page, { routines: store });
  // сервер восстанавливает программу под новым id, но с тем же cycleId и днём; повтор пропускает уже перенесённое
  const sent: string[] = [];
  await page.route("**/api/import/metadata", async (route) => {
    const body = route.request().postDataJSON();
    if (body.kind === "routines")
      for (const r of body.items as Routine[]) {
        sent.push(r.id);
        if (!store.some((e) => e.id === `restore:${r.id}` || e.id === r.id)) store.push({ ...r, id: `restore:${r.id}` });
      }
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ idMap: {}, exercises: [] }) });
  });
  await page.route("**/api/product", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ routines: store, favorites: [], customExercises: [] }) }));
  await page.reload();
  const file = backupWith("again.json", copy);
  const dialog = await restoreDialog(page, file);
  await expect(dialog.getByText(NOTICE, { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Импортировать", exact: true }).click();
  const result = dialog.getByRole("status", { name: "Итог восстановления" });
  await expect(result).toContainText("Восстановление завершено.");
  expect(sent).toHaveLength(6);
  await result.getByRole("button", { name: "Закрыть", exact: true }).click();
  expect(new Set(store.map((r) => r.periodization!.cycleId)).size, "ровно два цикла: свой и подтверждённый").toBe(2);
  // повторное восстановление: цикл уже на месте — строки нет, «Новых 0», новых циклов нет
  await page.reload();
  const again = await restoreDialog(page, file);
  await expect(again.getByText(/После импорта будут/)).toHaveCount(0);
  await expect(again.getByRole("region", { name: "Что в копии" })).toContainText("Программы: 6");
  await expect(again.getByRole("region", { name: "Что в копии" })).toContainText("Новых 0 · Уже есть 6 · Отличаются 0");
  await again.getByRole("button", { name: "Импортировать", exact: true }).click();
  await expect(again.getByRole("status", { name: "Итог восстановления" })).toBeVisible();
  expect(new Set(store.map((r) => r.periodization!.cycleId)).size).toBe(2);
  expect(store).toHaveLength(12);
});

test("R11-REQ03: цикла у аккаунта нет или в копии нет периодизации — строки нет", async ({ page }) => {
  test.setTimeout(120_000);
  const plainProgram = { ...cycleAt("2026-01-19")[0], id: "plain-copy", periodization: undefined } as Routine;
  await round01Fixture(page, { routines: [{ ...plainProgram, id: "plain-mine" }] });
  let dialog = await restoreDialog(page, backupWith("no-mine.json", cycleAt("2026-01-19")));
  await expect(dialog.getByText(/После импорта будут/)).toHaveCount(0);
  await page.route("**/api/product", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ routines: cycleAt("2026-11-16"), favorites: [], customExercises: [] }) }));
  await page.reload();
  dialog = await restoreDialog(page, backupWith("no-laid.json", [plainProgram]));
  await expect(dialog.getByText(/После импорта будут/)).toHaveCount(0);
});

// ───────────── REQ04: Лейд — неделя 10 и подписи ─────────────
const setToday = async (page: Page, iso: string) => {
  await page.clock.setFixedTime(new Date(`${iso}T12:00:00Z`));
  await page.reload();
};
const dlg = (page: Page) => page.getByRole("dialog");
const programs = (page: Page) => nav(page, "Программы").click();

for (const size of SIZES) {
  test(`R11-REQ04 / 1: неделя 10 — у дней без тренировки серая «Цикл закончен», красной «Пропущена» нет; недели 1–8 и сделанные дни как были ${size.width}×${size.height}`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize(size);
    const routines = sixRoutines();
    const done = { ...doneWorkout("Лейд · Жим 1", "2027-01-05", [["bench", 75, 1, 1]]), routineId: routines[1].id };
    await appWith(page, routines, [done]);
    await setToday(page, "2027-01-12");
    await programs(page);
    const lead = page.getByLabel("Программа Дэвида Лейда");
    await expect(lead).toContainText("Неделя 10 · схема недели 9 · цикл закончен — обнови максимумы");
    await expect(lead.locator(".laid-status.missed")).toHaveCount(0);
    await expect(lead.locator(".laid-status.ended")).toHaveCount(5);
    await expect(lead.locator(".laid-status.ended").first()).toHaveText("Цикл закончен");
    await expect(lead.locator(".laid-status.done")).toHaveText(["Сделана 5 янв."]);
    expect(await overflow(page)).toBeLessThanOrEqual(1);
    await lead.getByRole("button", { name: "Расписание на 9 недель", exact: true }).click();
    const d = dlg(page);
    const weeks = d.locator(".laid-week-card");
    await expect(weeks).toHaveCount(9);
    for (let w = 0; w < 8; w++) await expect(weeks.nth(w).locator(".laid-status.missed"), `неделя ${w + 1}`).toHaveCount(6);
    await expect(weeks.nth(8).locator(".laid-status.missed")).toHaveCount(0);
    await expect(weeks.nth(8).locator(".laid-status.ended")).toHaveCount(5);
    await expect(weeks.nth(8).locator(".laid-status.done")).toHaveText(["Сделана 5 янв."]);
    const chips = await d.locator(".laid-status").evaluateAll((els) => els.filter((el) => el.scrollWidth > el.clientWidth + 1 || el.getBoundingClientRect().height > 26).map((el) => (el as HTMLElement).innerText));
    expect(chips).toEqual([]);
    expect((await clipped(page, "dialog[open]")).wide).toEqual([]);
  });
}

test("R11-REQ04 / 1: на неделе 9 пропущенный день — по-прежнему красная «Пропущена»", async ({ page }) => {
  test.setTimeout(90_000);
  await appWith(page, sixRoutines(), []);
  await setToday(page, "2027-01-08");
  await programs(page);
  const lead = page.getByLabel("Программа Дэвида Лейда");
  await expect(lead).toContainText("Неделя 9");
  await expect(lead.locator(".laid-status.missed").first()).toHaveText("Пропущена");
  await expect(lead.locator(".laid-status.ended")).toHaveCount(0);
});

test("R11-REQ04 / 2 + QA-05: копия программы Лейда — у жима подпись «из истории» есть, когда вес истории не совпадает с полем; пропадает, когда совпадает", async ({ page }) => {
  test.setTimeout(120_000);
  await appWith(page, sixRoutines(), HISTORY());
  await programs(page);
  await page.getByRole("button", { name: "Копировать программу Лейд · Жим 1", exact: true }).click();
  const d = dlg(page);
  await expect(d.getByRole("heading", { name: "Программа" }).first()).toBeVisible();
  const row = (name: string) => d.locator("li, article, .routine-exercise").filter({ has: page.getByText(name, { exact: true }) }).last();
  // История жима — 70 × 8, в поле веса плана 75: старт будет с 70, и подпись это говорит (QA-R11-05); 12,5 — у упражнения без веса
  await expect(d.getByText(/Начнёшь с веса из истории: 12,5 кг/)).toHaveCount(1);
  await expect(d.getByText(/Начнёшь с веса из истории: 70 кг/)).toHaveCount(1);
  await expect(row("Разведения гантелей лёжа")).toContainText("Начнёшь с веса из истории: 12,5 кг");
});

for (const size of SIZES) {
  test(`R11-REQ04 / 3–4: «Добавить к оригиналу» — число подходов из плана; «по истории ≈ N кг» называет окно; подписи не обрезаны ${size.width}×${size.height}`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize(size);
    await appWith(page, [], [doneWorkout("Жим", "2026-11-02", [["bench", 100, 8, 3]])]);
    await programs(page);
    await page.getByRole("button", { name: /Дэвид Лейд · DUP/ }).click();
    const d = dlg(page);
    const extras = d.getByRole("switch", { name: /Добавить к оригиналу/ });
    await expect(extras).toContainText("+24 подхода в неделю");
    await extras.click();
    await expect(extras).toContainText("без добавок: 117 подходов в неделю");
    await expect(extras).not.toContainText("+24");
    await extras.click();
    await expect(extras).toContainText("+24 подхода в неделю");
    await expect(d.getByRole("button", { name: "по истории ≈ 126,7 кг (Эпли)" })).toBeVisible();
    await expect(d.getByText("по подходам за 26 недель", { exact: true })).toBeVisible();
    expect((await clipped(page, "dialog[open]")).wide).toEqual([]);
    expect(await d.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
    expect(await overflow(page)).toBeLessThanOrEqual(1);
  });
}

test("R11-REQ04 / 4: «Можно обновить максимум» называет окно в 28 дней, а «по истории» в расписании — окно в 26 недель", async ({ page }) => {
  test.setTimeout(120_000);
  const strong = doneWorkout("Жим", "2026-11-09", [["bench", 90, 1, 1]]);
  await appWith(page, sixRoutines(), [strong]);
  await programs(page);
  const lead = page.getByLabel("Программа Дэвида Лейда");
  await expect(lead.getByText("Можно обновить максимум:")).toBeVisible();
  await expect(lead.getByText("Оценка — по подходам за 28 дней.")).toBeVisible();
  await lead.getByRole("button", { name: "Расписание на 9 недель", exact: true }).click();
  await expect(dlg(page).getByText("«По истории» — лучшая оценка 1ПМ (Эпли) по подходам за 26 недель.")).toBeVisible();
  await expect(dlg(page).getByText("Оценка — по подходам за 28 дней.")).toBeVisible();
});

// ───────────── REQ05: поиск понимает «пек-дек», «бабочку» ─────────────
const REAR = "Обратные разведения на заднюю дельту";
const CHEST = "Сведение рук в тренажёре (пек-дек, «бабочка»)";
const REAR_QUERIES = ["пек-дек", "Пек дек", "ПЕКДЕК", "peck", "Peck Deck", "pec deck", "бабочка", "обратная бабочка", "Reverse Fly", "rear delt"];

for (const size of SIZES) {
  test(`R11-REQ05: «Упражнения» — все названия тренажёра находят заднюю дельту ≤ 1 с; «обратн» и «разведения» работают; счётчики сходятся ${size.width}×${size.height}`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize(size);
    await round01Fixture(page);
    await nav(page, "Упражнения").click();
    const search = page.getByLabel("Поиск упражнений");
    const cards = page.locator(".library-card");
    const tab = (name: string) => page.locator(".catalog-tabs button").filter({ hasText: name });
    const total = Number((await tab("Основные").locator("span").textContent())!.trim());
    await expect(cards).toHaveCount(total);
    for (const query of REAR_QUERIES) {
      await search.fill(query);
      await expect(cards.filter({ hasText: REAR }), query).toHaveCount(1, { timeout: 1000 });
      expect(await cards.count(), query).toBeGreaterThan(0);
    }
    // честная запись для груди находит «бабочку» и «пек-дек» первой; обратная «бабочка» — только заднюю дельту
    await search.fill("бабочка");
    await expect(cards.first()).toContainText(CHEST);
    await search.fill("обратная бабочка");
    await expect(cards).toHaveCount(1);
    await search.fill("обратн");
    await expect(cards.filter({ hasText: REAR })).toHaveCount(1);
    await search.fill("разведения");
    await expect(cards.filter({ hasText: REAR })).toHaveCount(1);
    await expect(cards.filter({ hasText: "Разведения гантелей лёжа" })).toHaveCount(1);
    await search.fill("");
    await expect(cards).toHaveCount(total);
    await expect(tab("Основные").locator("span")).toHaveText(String(total));
    await expect(tab("Мои").locator("span")).toHaveText("0");
    await expect(page.locator(".library-header")).toContainText(`${total} упражнени`);
    // «face» по-прежнему находит тягу каната к лицу
    await search.fill("face");
    await expect(cards.filter({ hasText: "Тягу каната к лицу" }).or(cards.filter({ hasText: "Тяга каната к лицу" }))).toHaveCount(1);
    expect(await overflow(page)).toBeLessThanOrEqual(1);
  });
}

test("R11-REQ05: «Заменить» и «Добавить упражнение» находят заднюю дельту по «пек-дек» и «бабочка»", async ({ page }) => {
  test.setTimeout(120_000);
  await round01Fixture(page);
  await startWith(page, BENCH);
  await page.getByText("Ещё для упражнения", { exact: true }).first().click();
  await page.locator('button[title="Заменить упражнение на аналогичное"]').first().click();
  const swap = page.getByRole("dialog", { name: "Заменить упражнение", exact: true });
  for (const query of ["пек-дек", "пекдек", "peck", "бабочка", "reverse fly", "rear delt"]) {
    await swap.getByRole("searchbox").fill(query);
    await expect(swap.getByRole("button", { name: new RegExp(`^${REAR}`) }).first(), query).toBeVisible({ timeout: 1500 });
  }
  await swap.getByRole("button", { name: "Закрыть окно", exact: true }).click();
  await expect(swap).toHaveCount(0);
  await page.getByRole("button", { name: "Добавить упражнение", exact: true }).click();
  const picker = page.getByRole("searchbox").or(page.getByLabel("Поиск упражнений")).first();
  for (const query of ["пек дек", "обратная бабочка"]) {
    await picker.fill(query);
    await expect(page.getByRole("button", { name: `Добавить ${REAR}`, exact: true }), query).toBeVisible({ timeout: 1500 });
  }
});

// ───────────── REQ07: «Вес тела» — год в подписи «С … нояб.» ─────────────
type WeightFixture = { weights: { documents: Map<string, unknown> } };
function putWeights(f: WeightFixture, dates: string[]) {
  dates.forEach((date, k) => {
    const value = { id: `w${k}`, date, weightKg: 84 - k * 0.4, createdAt: Date.parse(`${date}T06:00:00.000Z`) };
    f.weights.documents.set(`weight:${date}`, { key: `weight:${date}`, value, revision: 1, mutationId: `m${k}`, updatedAt: `${date}T06:00:00.000Z` });
  });
}
for (const size of SIZES) {
  test(`R11-REQ07: «Изменение за историю» — «С 29 нояб. 2025», если история началась не в этом году ${size.width}×${size.height}`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize(size);
    const f = await round01Fixture(page);
    putWeights(f, ["2025-11-29", "2026-02-10", "2026-11-09"]);
    await page.reload();
    await nav(page, "Прогресс").click();
    await page.getByRole("tab", { name: "Вес тела", exact: true }).click();
    const card = page.locator(".progress-metric").filter({ hasText: "Изменение за историю" });
    await expect(card).toContainText("С 29 нояб. 2025");
    expect(await overflow(page)).toBeLessThanOrEqual(1);
    expect((await clipped(page, "main")).wide).toEqual([]);
  });
}

test("R11-REQ07: история началась в текущем году — «С 2 мар.» без года, как раньше", async ({ page }) => {
  test.setTimeout(90_000);
  const f = await round01Fixture(page);
  putWeights(f, ["2026-03-02", "2026-11-09"]);
  await page.reload();
  await nav(page, "Прогресс").click();
  await page.getByRole("tab", { name: "Вес тела", exact: true }).click();
  const card = page.locator(".progress-metric").filter({ hasText: "Изменение за историю" });
  await expect(card).toContainText("С 2 мар.");
  await expect(card).not.toContainText("2026");
});

// ───────────── Доработка 1: QA-R11-03 (строки в списке программ на неделе 10) ─────────────
for (const size of [SIZES[0], SIZES[2]]) {
  test(`R11-QA-03: неделя 10 — в списке программ нет красной «Пропущена», у пяти программ «Цикл закончен», сделанная — «Сделана» ${size.width}×${size.height}`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize(size);
    const routines = sixRoutines();
    const done = { ...doneWorkout("Лейд · Жим 1", "2027-01-05", [["bench", 75, 1, 1]]), routineId: routines[1].id };
    await appWith(page, routines, [done]);
    await setToday(page, "2027-01-12");
    await programs(page);
    const rows = page.locator("article.routine-card .laid-routine-line");
    await expect(rows).toHaveCount(6);
    await expect(rows.locator(".laid-status.missed")).toHaveCount(0);
    await expect(rows.locator(".laid-status.ended")).toHaveCount(5);
    await expect(rows.locator(".laid-status.ended").first()).toHaveText("Цикл закончен");
    await expect(rows.locator(".laid-status.done")).toHaveText(["Сделана 5 янв."]);
    await expect(page.locator(".laid-status.missed")).toHaveCount(0);
    expect(await overflow(page)).toBeLessThanOrEqual(1);
    expect((await clipped(page, "main")).wide).toEqual([]);
  });
}

// ───────────── Доработка 1: QA-R11-07 (запись веса не гоняется между окнами) ─────────────
test("R11-QA-07: два видимых окна не перебрасывают друг другу запись журнала веса; новый замер из одного окна доходит до другого", async ({ page, context }) => {
  test.setTimeout(120_000);
  const count = async (p: Page) => p.evaluate(() => (window as unknown as { __syncWrites: number }).__syncWrites);
  const hook = () => {
    // Оба окна видимы (рядом на экране): у фоновой вкладки Chromium в Playwright visibilityState — hidden, и обмена бы не было.
    Object.defineProperty(Document.prototype, "visibilityState", { configurable: true, get: () => "visible" });
    (window as unknown as { __syncWrites: number }).__syncWrites = 0;
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key: string, value: string) {
      if (String(key).startsWith("tyaga-bodyweight-sync")) (window as unknown as { __syncWrites: number }).__syncWrites++;
      return set.call(this, key, value);
    };
  };
  await context.addInitScript(hook);
  await round01Fixture(page);
  const tab2 = await openSecondTab(context);
  await page.bringToFront();
  const open = async (p: Page) => {
    await p.getByRole("button", { name: "Ещё", exact: true }).click();
    await p.getByRole("button", { name: /Вес тела и тренд.*синхронизация/ }).click();
    return p.getByRole("dialog").last();
  };
  const first = await open(page);
  await first.getByLabel("Вес, кг", { exact: true }).fill("82,4");
  await first.getByRole("button", { name: /Сохранить замер|Обновить замер/ }).click();
  await expect(first.locator(".progress-metric.accent")).toContainText("82,4");
  const second = await open(tab2);
  await expect(second.locator(".progress-metric.accent")).toContainText("82,4", { timeout: 8000 });
  const before = (await count(page)) + (await count(tab2));
  await page.waitForTimeout(6000);
  const writes = (await count(page)) + (await count(tab2)) - before;
  expect(writes, "записей журнала за 6 с в двух окнах").toBeLessThan(12);
});

test("R11-QA-05: копия Лейда — если вес из истории совпадает с весом в поле, подписи нет", async ({ page }) => {
  test.setTimeout(120_000);
  // жим 75 × 1 в истории: тот же вес, что у плана недели 1 (75)
  await appWith(page, sixRoutines(), [doneWorkout("Жим раньше", "2026-11-03", [["bench", 75, 1, 1]])]);
  await programs(page);
  await page.getByRole("button", { name: "Копировать программу Лейд · Жим 1", exact: true }).click();
  const d = dlg(page);
  await expect(d.getByText(/Начнёшь с веса из истории: 75 кг/)).toHaveCount(0);
});

// ───────────── Доработка 1: QA-R11-01 / 02 / 04 / 06 — ведомое окно ─────────────
const SET_DONE = (n: number) => `Отметить выполненным: ${BENCH}, подход ${n}`;
const sets = async (page: Page) => (await storedDraft(page))!.workout.exercises[0].sets.map((s) => `${s.weight}×${s.reps}${s.done ? "✓" : ""}`);
/** Две вкладки: в первой — жим, подход 1 = 80×5 ✓, подход 2 заполнен; вторая явно взяла управление, первая — ведомая. */
async function followerPair(page: Page, context: BrowserContext, size: { width: number; height: number }) {
  await page.setViewportSize(size);
  await round01Fixture(page);
  await startWith(page, BENCH);
  await set(page, 1, "80", "5");
  await set(page, 2, "80", "5", false);
  const tab2 = await openSecondTab(context, size);
  await resume(tab2);
  await handoff(tab2);
  await page.bringToFront();
  await expect(follower(page)).toBeVisible({ timeout: 5000 });
  return tab2;
}

for (const size of SIZES) {
  for (const how of ["tap", "click"] as const) {
    test(`R11-QA-01: первое ${how === "tap" ? "касание" : "нажатие мышью"} в ведомом окне не даёт редактировать; явная передача не ставит ✓ ${size.width}×${size.height}`, async ({ page, context }) => {
      test.setTimeout(120_000);
      await followerPair(page, context, size);
      const oldOwner = (await storedDraft(page))!.owner;
      const before = await sets(page);
      expect(before).toEqual(["80×5✓", "80×5", "0×0"].map((x, i) => (i === 2 ? before[2] : x)));
      const point = await centre(page, 2);
      const press = () => how === "tap" ? page.touchscreen.tap(point.x, point.y) : page.mouse.click(point.x, point.y);
      await press();
      await expect(follower(page)).toBeVisible();
      await expect(editor(page)).toHaveAttribute("inert");
      await page.waitForTimeout(600);
      expect(await sets(page)).toEqual(before);
      expect((await storedDraft(page))!.owner).toBe(oldOwner);
      await expect(page.getByLabel(`${BENCH}, подход 1, вес`, { exact: true })).toHaveValue("80");
      await expect(page.getByLabel(`${BENCH}, подход 2, вес`, { exact: true })).toHaveValue("80");
      await handoff(page);
      expect(await sets(page), "передача не отметила подход").toEqual(before);
      await page.getByRole("button", { name: SET_DONE(2), exact: true })[how]();
      await expect.poll(() => sets(page)).toEqual([before[0], "80×5✓", before[2]]);
      expect(await overflow(page)).toBeLessThanOrEqual(1);
    });
  }
}

test("R11-QA-01: «Продолжить здесь» передаёт управление без изменения черновика", async ({ page, context }) => {
  test.setTimeout(120_000);
  const before = await followerPair(page, context, SIZES[0]).then(() => sets(page));
  await handoff(page);
  await expect(follower(page)).toHaveCount(0);
  await expect(page.getByText("Это окно стало основным. Нажми ещё раз.")).toHaveCount(0);
  await expect(page.getByText("Это окно основное — изменения сохраняются", { exact: true })).toBeVisible();
  expect(await sets(page)).toEqual(before);
});

test("R11-QA-01: клавиатура недоступна до передачи, после передачи цифры записываются", async ({ page, context }) => {
  test.setTimeout(120_000);
  await followerPair(page, context, SIZES[0]);
  const field = page.getByLabel(`${BENCH}, подход 2, вес`, { exact: true });
  const before = await sets(page);
  await field.evaluate((el: HTMLElement) => el.focus());
  await expect(field).not.toBeFocused();
  await page.keyboard.type("87.5");
  await expect(follower(page)).toBeVisible();
  expect(await sets(page)).toEqual(before);
  await handoff(page);
  await field.focus();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type("87.5");
  await expect(field).toHaveValue("87.5");
  await expect(follower(page)).toHaveCount(0);
  await expect.poll(() => sets(page)).toEqual(["80×5✓", "87.5×5", (await sets(page))[2]]);
});

test("R11-QA-02: окно с копией sessionStorage (дублированная вкладка) не считает себя тем же владельцем — подходы не затираются, основное окно не больше одного", async ({ page, context }) => {
  test.setTimeout(120_000);
  await page.setViewportSize(SIZES[0]);
  await round01Fixture(page);
  await startWith(page, BENCH);
  await set(page, 1, "80", "5");
  const copy = await page.evaluate(() => JSON.stringify({ ...sessionStorage }));
  const tab2 = await context.newPage();
  await tab2.setViewportSize(SIZES[0]);
  await tab2.addInitScript((dump) => {
    for (const [k, v] of Object.entries(JSON.parse(dump) as Record<string, string>)) sessionStorage.setItem(k, v);
  }, copy);
  await round01Fixture(tab2);
  await resume(tab2);
  await handoff(tab2);
  await page.bringToFront();
  await expect(follower(page)).toBeVisible({ timeout: 5000 });
  // Подход 2 отмечаем в первой вкладке, подход 3 — во второй после явной передачи.
  await handoff(page);
  await set(page, 2, "82.5", "5");
  await tab2.bringToFront();
  await expect(follower(tab2)).toBeVisible({ timeout: 5000 });
  await handoff(tab2);
  await tab2.getByLabel(`${BENCH}, подход 3, вес`, { exact: true }).fill("85");
  await tab2.getByLabel(`${BENCH}, подход 3, повторы`, { exact: true }).fill("5");
  await tab2.getByRole("button", { name: SET_DONE(3), exact: true }).click();
  await expect.poll(() => sets(tab2)).toEqual(["80×5✓", "82.5×5✓", "85×5✓"]);
  await expect.poll(() => sets(page)).toEqual(["80×5✓", "82.5×5✓", "85×5✓"]);
  const banners = (await follower(page).count()) + (await follower(tab2).count());
  expect(banners, "ровно одно окно основное, второе ведомое").toBe(1);
  await page.reload();
  await page.getByRole("button", { name: "Продолжить тренировку", exact: true }).click();
  await expect(page.getByLabel(`${BENCH}, подход 2, вес`, { exact: true })).toHaveValue("82.5");
});

test("R11-QA-02: перезагрузка единственного окна — оно само остаётся основным, строка «открыта в другом окне» не мигает, ввод принимается", async ({ page }) => {
  test.setTimeout(120_000);
  await page.addInitScript(() => {
    (window as unknown as { __banner: boolean }).__banner = false;
    new MutationObserver(() => {
      if (document.body && document.body.innerText.includes("открыта в другом окне")) (window as unknown as { __banner: boolean }).__banner = true;
    }).observe(document, { subtree: true, childList: true, characterData: true });
  });
  await round01Fixture(page);
  await startWith(page, BENCH);
  await set(page, 1, "80", "5");
  await page.reload();
  await page.getByRole("button", { name: "Продолжить тренировку", exact: true }).click();
  await set(page, 2, "82.5", "5");
  await page.waitForTimeout(800);
  expect(await page.evaluate(() => (window as unknown as { __banner: boolean }).__banner), "строка не показывалась").toBe(false);
  await expect.poll(() => sets(page)).toEqual(["80×5✓", "82.5×5✓", (await sets(page))[2]]);
  await expect(follower(page)).toHaveCount(0);
});

test("R11-QA-06: одновременное «Начать» в двух вкладках — 20 гонок подряд, каждый раз ровно одно основное окно и одна тренировка", async ({ page, context }) => {
  test.setTimeout(280_000);
  await page.setViewportSize(SIZES[0]);
  await round01Fixture(page);
  const tab2 = await openSecondTab(context);
  const start = (p: Page) => p.getByRole("button", { name: "Начать тренировку", exact: true }).first();
  const bad: string[] = [];
  for (let round = 1; round <= 20; round++) {
    await expect(start(page)).toBeVisible();
    await expect(start(tab2)).toBeVisible();
    await Promise.all([start(page).click(), start(tab2).click()]);
    await page.waitForTimeout(1200);
    const [a, b] = [await follower(page).count(), await follower(tab2).count()];
    const keys = (await draftKeys(page)).length;
    if (a + b !== 1 || keys !== 1) bad.push(`#${round}: ведомых ${a + b}, ключей ${keys}`);
    // сброс: ключ убран, обе вкладки перезагружены
    for (const p of [page, tab2]) await p.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("tyaga-draft-account:")).forEach((k) => localStorage.removeItem(k)));
    await Promise.all([page.reload(), tab2.reload()]);
  }
  expect(bad, "гонки с исходом, отличным от «одно основное, одно ведомое»").toEqual([]);
});

test("R11-QA-09/08: «устаревшая» вкладка при потерянных событиях storage — отмена в другой убирает черновик, ✓ в устаревшей его не воскрешает", async ({ page, context }) => {
  test.setTimeout(120_000);
  await page.setViewportSize(SIZES[0]);
  await page.addInitScript(() => {
    const drop = (e: Event) => e.stopImmediatePropagation();
    for (const event of ["storage", "focus", "pageshow"]) window.addEventListener(event, drop, true);
    document.addEventListener("visibilitychange", drop, true);
  });
  await round01Fixture(page);
  await startWith(page, BENCH);
  await set(page, 1, "80", "5");
  await set(page, 2, "80", "5", false);
  const tab2 = await openSecondTab(context);
  await resume(tab2);
  await handoff(tab2);
  await tab2.getByRole("button", { name: "Отмена", exact: true }).click();
  const yes = tab2.getByRole("button", { name: /Да, отменить|Отменить тренировку/ });
  if (await yes.first().isVisible().catch(() => false)) await yes.first().click();
  await expect.poll(() => draftKeys(tab2)).toEqual([]);
  // вкладка 1 ничего не знает; нажимает ✓ — черновик не воскресает
  await expect(editor(page)).not.toHaveAttribute("inert"); // не было сверки, пока не нажали
  await page.getByRole("button", { name: SET_DONE(2), exact: true }).evaluate((el: HTMLElement) => el.click());
  await expect(page.getByText("Тренировка закончена или отменена в другом окне")).toBeVisible();
  await page.waitForTimeout(1500);
  expect(await draftKeys(page), "ключ не вернулся").toEqual([]);
  await page.waitForTimeout(10_000);
  expect(await draftKeys(page), "ключ не вернулся через 10 с").toEqual([]);
});

// ───────────── Доработка 2: QA-R11-09 / 11 — смена роли не двигает вёрстку; сообщение в строке, а не тост ─────────────
const rowH = (page: Page) => page.locator(".draft-follower").evaluate((el) => Math.round(el.getBoundingClientRect().height * 10) / 10);
const DONE_ANY = (n: number) => new RegExp(`^(Отметить выполненным|Снять отметку): ${BENCH}, подход ${n}$`);
const doneTop = (page: Page, n: number) => page.getByRole("button", { name: DONE_ANY(n), includeHidden: true }).evaluate((el) => Math.round((el.getBoundingClientRect().top + scrollY) * 10) / 10);
const centre = async (page: Page, n: number) => {
  const button = page.getByRole("button", { name: SET_DONE(n), exact: true, includeHidden: true });
  await button.scrollIntoViewIfNeeded(); // на 320×640 ✓ подхода 2 может быть ниже экрана
  const box = (await button.boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};
const pressedRow = (page: Page) => page.getByText("Это окно стало основным. Нажми ещё раз.", { exact: true });

for (const size of SIZES) {
  for (const how of ["tap", "mouse"] as const) {
    for (const pause of [900, 2500]) {
      test(`R11-QA-09: ${how === "tap" ? "касание" : "мышь"}, повтор в ту же точку через ${pause} мс — вес, повторы и ✓ подхода 1 целы; вёрстка при смене роли не сдвигается ${size.width}×${size.height}`, async ({ page, context }) => {
        test.setTimeout(120_000);
        await followerPair(page, context, size);
        const point = await centre(page, 2);
        const [top0, h0, before] = [await doneTop(page, 2), await rowH(page), await sets(page)];
        const press = () => (how === "tap" ? page.touchscreen.tap(point.x, point.y) : page.mouse.click(point.x, point.y));
        await press();
        await expect(follower(page)).toBeVisible();
        await page.waitForTimeout(pause);
        await press();
        await expect(follower(page)).toBeVisible();
        expect(await sets(page)).toEqual(before);
        await handoff(page);
        // Явная смена роли не двигает ни строку, ни ✓ подхода 2.
        expect(await doneTop(page, 2), "✓ подхода 2 до и после смены роли").toBe(top0);
        expect(await rowH(page), "высота строки до и после смены роли").toBe(h0);
        expect(await sets(page)).toEqual(before);
        await page.getByRole("button", { name: SET_DONE(2), exact: true })[how === "tap" ? "tap" : "click"]();
        await expect.poll(() => sets(page)).toEqual([before[0], "80×5✓", before[2]]);
        await expect(ownerRow(page)).toBeVisible();
        expect(await doneTop(page, 2)).toBe(top0);
        await expect(page.getByLabel(`${BENCH}, подход 1, вес`, { exact: true })).toHaveValue("80");
        await expect(page.getByLabel(`${BENCH}, подход 1, повторы`, { exact: true })).toHaveValue("5");
        expect(await overflow(page)).toBeLessThanOrEqual(1);
      });
    }
  }
}

for (const size of [SIZES[0], SIZES[2]]) {
  for (const gap of [70, 200]) {
    test(`R11-QA-09: двойной тап (${gap} мс) по ✓ подхода 2 в ведомом окне — все подходы и роль неизменны ${size.width}×${size.height}`, async ({ page, context }) => {
      test.setTimeout(120_000);
      await followerPair(page, context, size);
      const before = await sets(page);
      const point = await centre(page, 2);
      await page.touchscreen.tap(point.x, point.y);
      await page.waitForTimeout(gap);
      await page.touchscreen.tap(point.x, point.y);
      await page.waitForTimeout(600);
      expect(await sets(page)).toEqual(before);
      await expect(follower(page)).toBeVisible();
    });
  }
  test(`R11-QA-09: двойной клик мышью по ✓ подхода 2 в ведомом окне — все подходы и роль неизменны ${size.width}×${size.height}`, async ({ page, context }) => {
    test.setTimeout(120_000);
    await followerPair(page, context, size);
    const before = await sets(page);
    const point = await centre(page, 2);
    await page.mouse.dblclick(point.x, point.y);
    await page.waitForTimeout(600);
    expect(await sets(page)).toEqual(before);
    await expect(follower(page)).toBeVisible();
  });
}

test("R11-QA-11: сообщение о смене роли — не тост: ни одна кнопка тренировки не перекрыта, строка уходит, когда человек вышел с экрана тренировки", async ({ page, context }) => {
  test.setTimeout(120_000);
  await followerPair(page, context, SIZES[2]);
  await handoff(page);
  await expect(page.locator(".toast, [role=alert]").filter({ hasText: "Это окно основное" })).toHaveCount(0);
  await expect(pressedRow(page)).toHaveCount(0);
  const covered = await page.evaluate(() => {
    const out: string[] = [];
    for (const el of document.querySelectorAll("button[aria-label^='Снять отметку'], button[aria-label^='Отметить выполненным']")) {
      (el as HTMLElement).scrollIntoView({ block: "center" });
      const r = (el as HTMLElement).getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      if (hit && hit !== el && !el.contains(hit)) out.push(`${el.getAttribute("aria-label")} ← ${hit.className}`);
    }
    return out;
  });
  expect(covered, "перекрытые элементы").toEqual([]);
  // ушёл с экрана тренировки — строка свёрнута, вернулся — её нет
  await page.getByRole("button", { name: "Свернуть тренировку", exact: true }).click();
  await page.getByRole("button", { name: /Вернуться к тренировке|Продолжить тренировку/ }).first().click();
  await expect(ownerRow(page)).toHaveCount(0);
  await expect(pressedRow(page)).toHaveCount(0);
});

// ───────────── Доработка 2: QA-R11-10 — свайп не делает окно основным; Enter на ✓ не глушится ─────────────
/** Настоящий свайп пальцем вверх (CDP): Chrome начинает прокрутку и шлёт pointercancel, касанием это не считается. */
async function swipeUp(page: Page, x: number, from: number, to: number) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y: from }] });
  for (let i = 1; i <= 8; i++) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: from + ((to - from) * i) / 8 }] });
    await page.waitForTimeout(16);
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await page.waitForTimeout(400);
}

for (const size of [SIZES[0], SIZES[2]]) {
  test(`R11-QA-10: свайп в ведомом окне прокручивает страницу, но роль и сообщение не меняются ${size.width}×${size.height}`, async ({ page, context }) => {
    test.setTimeout(120_000);
    await followerPair(page, context, size);
    const before = await sets(page);
    const y0 = await page.evaluate(() => scrollY);
    await swipeUp(page, Math.round(size.width / 2), Math.round(size.height * 0.75), Math.round(size.height * 0.3));
    expect(await page.evaluate(() => scrollY), "страница прокрутилась").toBeGreaterThan(y0);
    await expect(follower(page)).toBeVisible();
    await expect(pressedRow(page)).toHaveCount(0);
    await expect(ownerRow(page)).toHaveCount(0);
    expect(await sets(page)).toEqual(before);
  });
}

test("R11-QA-10: Enter на ✓ работает после явной передачи, до неё — не меняет черновик", async ({ page, context }) => {
  test.setTimeout(120_000);
  await followerPair(page, context, SIZES[0]);
  const before = await sets(page);
  await swipeUp(page, 195, 640, 260);
  await expect(follower(page)).toBeVisible();
  const target = page.getByRole("button", { name: SET_DONE(2), exact: true, includeHidden: true });
  await target.evaluate((el: HTMLElement) => el.focus());
  await expect(target).not.toBeFocused();
  await page.keyboard.press("Enter");
  await expect(follower(page)).toBeVisible();
  expect(await sets(page)).toEqual(before);
  await takeover(page).focus();
  await page.keyboard.press("Enter");
  await expect(ownerRow(page)).toBeVisible();
  await target.focus();
  await page.keyboard.press("Enter");
  await expect.poll(() => sets(page)).toEqual([before[0], "80×5✓", before[2]]);
  await expect(ownerRow(page)).toBeVisible();
});

for (const delay of [500, 1500, 2800, 3300]) {
  test(`R11-QA-10: касание через ${delay} мс после свайпа не забирает роль, после явной передачи ✓ работает`, async ({ page, context }) => {
    test.setTimeout(120_000);
    await followerPair(page, context, SIZES[0]);
    const before = await sets(page);
    await swipeUp(page, 195, 640, 260);
    await page.waitForTimeout(delay);
    const point = await centre(page, 2);
    await page.touchscreen.tap(point.x, point.y);
    await expect(follower(page)).toBeVisible();
    expect(await sets(page)).toEqual(before);
    await handoff(page);
    await page.getByRole("button", { name: SET_DONE(2), exact: true }).tap();
    await expect.poll(() => sets(page)).toEqual([before[0], "80×5✓", before[2]]);
  });
}

// ───────────── Доработка 2: QA-R11-12 — упражнение, добавленное в ведомом окне, не пропадает молча ─────────────
const exerciseCount = async (page: Page) => (await storedDraft(page))!.workout.exercises.length;
// Жим уже в тренировке (повтор того же упражнения приложение пропускает), поэтому добавляем приседания
const addBench = (page: Page) => page.getByRole("button", { name: "Добавить Приседания со штангой", exact: true });

test("R11-QA-12: «Добавить упражнение» программным click не передаёт роль; упражнение сохраняется после явной передачи", async ({ page, context }) => {
  test.setTimeout(120_000);
  await followerPair(page, context, SIZES[0]);
  const oldOwner = (await storedDraft(page))!.owner;
  const add = page.getByRole("button", { name: "Добавить упражнение", exact: true, includeHidden: true });
  await add.evaluate((el: HTMLElement) => el.click());
  await expect(follower(page)).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(await exerciseCount(page)).toBe(1);
  expect((await storedDraft(page))!.owner).toBe(oldOwner);
  await handoff(page);
  await add.click();
  await addBench(page).evaluate((el: HTMLElement) => el.click());
  await page.getByRole("button", { name: "Готово", exact: true }).click();
  await expect.poll(() => exerciseCount(page)).toBe(2);
  // Упражнение не пропало ни в ключе, ни на экране.
  await page.reload();
  await page.getByRole("button", { name: "Продолжить тренировку", exact: true }).first().click();
  await expect(page.getByLabel("Приседания со штангой, подход 1, вес", { exact: true })).toBeVisible();
  expect(await exerciseCount(page)).toBe(2);
});

test("R11-QA-12: диалог, открытый до передачи, закрывается без изменения черновика", async ({ page, context }) => {
  test.setTimeout(120_000);
  await page.setViewportSize(SIZES[0]);
  await round01Fixture(page);
  await startWith(page, BENCH);
  await set(page, 1, "80", "5");
  await page.getByRole("button", { name: "Добавить упражнение", exact: true }).click();
  await expect(addBench(page)).toBeVisible();
  const tab2 = await openSecondTab(context, SIZES[0]);
  await resume(tab2);
  await handoff(tab2);
  await page.bringToFront();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(follower(page)).toBeVisible();
  const owner2 = (await storedDraft(page))!.owner;
  expect(await exerciseCount(page)).toBe(1);
  await handoff(page);
  await page.getByRole("button", { name: "Добавить упражнение", exact: true }).click();
  await addBench(page).click();
  await page.getByRole("button", { name: "Готово", exact: true }).click();
  await expect.poll(() => exerciseCount(page)).toBe(2);
  expect((await storedDraft(page))!.owner, "ключ теперь пишет это окно").not.toBe(owner2);
  await expect(follower(page)).toHaveCount(0);
});

test("R11-QA-12: то же через «Продолжить здесь» — упражнение, добавленное после, остаётся", async ({ page, context }) => {
  test.setTimeout(120_000);
  await followerPair(page, context, SIZES[0]);
  await handoff(page);
  await page.getByRole("button", { name: "Добавить упражнение", exact: true }).click();
  await addBench(page).click();
  await page.getByRole("button", { name: "Готово", exact: true }).click();
  await expect.poll(() => exerciseCount(page)).toBe(2);
});
