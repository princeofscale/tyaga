import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { nav, round01Fixture, startWith } from "./fixtures/round01";
import { smallTargets, clipped } from "./fixtures/touch";

/**
 * Раунд 11 на телефоне (390×844, 360×800, 320×640), приложение на подставных ответах.
 * Сегодня в фикстуре — вторник 10 нояб. 2026.
 */
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, locale: "ru-RU", timezoneId: "Europe/Saratov" });

const BENCH = "Жим штанги лёжа";
const SIZES = [{ width: 390, height: 844 }, { width: 360, height: 800 }, { width: 320, height: 640 }];
const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

// ───────────── REQ02: две вкладки одного аккаунта ─────────────
const draftKeys = (page: Page) => page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("tyaga-draft-account:")));
const storedDraft = (page: Page) =>
  page.evaluate(() => {
    const key = Object.keys(localStorage).find((k) => k.startsWith("tyaga-draft-account:"));
    return key ? (JSON.parse(localStorage.getItem(key)!) as { workout: { id: string; exercises: { sets: { weight: number; reps: number; done: boolean }[] }[] }; owner?: string }) : null;
  });
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
const follower = (page: Page) => page.getByText("Эта тренировка открыта в другом окне — тут изменения не сохраняются");

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
  // «Продолжить»: открывается идущая тренировка с отмеченным подходом, не пустая
  await page.getByRole("button", { name: /Продолжить тренировку/ }).first().click();
  await expect(page.getByLabel(`${BENCH}, подход 1, вес`, { exact: true })).toHaveValue("80");
  const d = await storedDraft(page);
  expect(d!.workout.exercises[0].sets[0]).toMatchObject({ weight: 80, reps: 5, done: true });
  expect(await draftKeys(page)).toHaveLength(1);
});

test("R11-REQ02 / 2: подход, отмеченный в одной вкладке, за 3 с виден в другой; в неосновной — строка «открыта в другом окне», «Открыть здесь» делает окно основным", async ({ page, context }) => {
  test.setTimeout(120_000);
  await round01Fixture(page);
  await startWith(page, BENCH);
  await set(page, 1, "80", "5");
  const tab2 = await openSecondTab(context);
  // «Продолжить тренировку» во второй вкладке делает её основной
  await tab2.getByRole("button", { name: /Продолжить тренировку/ }).first().click();
  await expect(tab2.getByLabel(`${BENCH}, подход 1, вес`, { exact: true })).toHaveValue("80");
  await expect(follower(tab2)).toHaveCount(0);
  await page.bringToFront();
  await expect(follower(page)).toBeVisible({ timeout: 3000 });
  // P2 отмечает подход 2 — P1 (неосновная) видит его за 3 с
  await set(tab2, 2, "82.5", "5");
  await expect(page.getByLabel(`${BENCH}, подход 2, вес`, { exact: true })).toHaveValue("82.5", { timeout: 3000 });
  // «Открыть здесь»: P1 основная, P2 ведомая; подходы не потеряны
  await page.getByRole("button", { name: "Открыть здесь", exact: true }).click();
  await expect(follower(page)).toHaveCount(0);
  await tab2.bringToFront();
  await expect(follower(tab2)).toBeVisible({ timeout: 3000 });
  await page.bringToFront();
  await set(page, 3, "85", "5");
  await tab2.bringToFront();
  await expect(tab2.getByLabel(`${BENCH}, подход 3, вес`, { exact: true })).toHaveValue("85", { timeout: 3000 });
  // ввод в P2 (неосновной) сам делает её основной: правка подхода 3 сохраняется, P1 её видит
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
  await set(tab2, 2, "82.5", "5");
  await page.bringToFront();
  await expect(page.getByLabel(`${BENCH}, подход 2, вес`, { exact: true })).toHaveValue("82.5", { timeout: 3000 });
  await context.setOffline(false);
});

for (const size of SIZES) {
  test(`R11-REQ02: строка «Эта тренировка открыта в другом окне» и «Открыть здесь» на ${size.width}×${size.height} — без сдвига и срезов, цель ≥ 44 px`, async ({ page, context }) => {
    test.setTimeout(120_000);
    await page.setViewportSize(size);
    await round01Fixture(page);
    await startWith(page, BENCH);
    await set(page, 1, "80", "5");
    const tab2 = await openSecondTab(context, size);
    await tab2.getByRole("button", { name: /Продолжить тренировку/ }).first().click();
    await page.bringToFront();
    await expect(follower(page)).toBeVisible({ timeout: 3000 });
    expect(await overflow(page)).toBeLessThanOrEqual(1);
    const btn = page.getByRole("button", { name: "Открыть здесь", exact: true });
    const box = await btn.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(43.5);
    expect((await clipped(page, ".draft-follower")).wide).toEqual([]);
    expect((await smallTargets(page)).filter((t) => t.cls.includes("draft") || t.text.includes("Открыть здесь"))).toEqual([]);
  });
}

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
  await page.getByRole("button", { name: /^Инструменты/ }).last().click();
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

test("R11-REQ04 / 2: копия программы Лейда — у жима с весом плана нет «Начнёшь с веса из истории», у упражнения без веса она есть", async ({ page }) => {
  test.setTimeout(120_000);
  await appWith(page, sixRoutines(), HISTORY());
  await programs(page);
  await page.getByRole("button", { name: "Копировать программу Лейд · Жим 1", exact: true }).click();
  const d = dlg(page);
  await expect(d.getByRole("heading", { name: "Программа" }).first()).toBeVisible();
  const row = (name: string) => d.locator("li, article, .routine-exercise").filter({ has: page.getByText(name, { exact: true }) }).last();
  await expect(d.getByText(/Начнёшь с веса из истории: 12,5 кг/)).toHaveCount(1);
  await expect(d.getByText(/Начнёшь с веса из истории: (70|90) кг/)).toHaveCount(0);
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
    await expect(extras).toContainText("+18 подходов в неделю");
    await extras.click();
    await expect(extras).toContainText("без добавок: 117 подходов в неделю");
    await expect(extras).not.toContainText("+18");
    await extras.click();
    await expect(extras).toContainText("+18 подходов в неделю");
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
    await p.getByRole("button", { name: /^Инструменты/ }).last().click();
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
