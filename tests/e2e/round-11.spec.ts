import { test, expect, type BrowserContext, type Page } from "@playwright/test";
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
