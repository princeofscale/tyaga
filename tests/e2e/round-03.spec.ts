import { test, expect, type Page } from "@playwright/test";
import { doneWorkout, nav, round01Fixture, startWith } from "./fixtures/round01";
import type { Workout } from "../../src/lib/types";

/**
 * Раунд 3: R03-REQ01…REQ08 на телефоне, приложение на подставных ответах.
 * Сервис-воркер по умолчанию заблокирован (playwright.config.ts); сценарий офлайна включает его сам.
 */
test.use({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
  locale: "ru-RU",
  timezoneId: "Europe/Saratov",
});

const BENCH = "Жим штанги лёжа";
const OHP = "Жим штанги стоя";
const weight = (page: Page, n: number, name = BENCH) => page.getByLabel(`${name}, подход ${n}, вес`, { exact: true });
const reps = (page: Page, n: number, name = BENCH) => page.getByLabel(`${name}, подход ${n}, повторы`, { exact: true });
const rir = (page: Page, n: number, name = BENCH) => page.getByLabel(`${name}, подход ${n}, RIR`, { exact: true });
const check = (page: Page, n: number, name = BENCH) =>
  page.getByRole("button", { name: `Отметить выполненным: ${name}, подход ${n}`, exact: true });
const uncheck = (page: Page, n: number, name = BENCH) =>
  page.getByRole("button", { name: `Снять отметку: ${name}, подход ${n}`, exact: true });
const finish = (page: Page) => page.getByRole("button", { name: "Завершить тренировку", exact: true });

/** Прошлая тренировка жима: 60 кг × 8, 8, 7. RIR в ней не записан. */
function benchHistory(): Workout[] {
  const w = doneWorkout("Грудь", "2026-11-03", [["bench", 60, 8, 3]]);
  w.exercises[0].sets.forEach((s, i) => {
    s.reps = [8, 8, 7][i];
    s.rir = null;
  });
  return [w];
}

test("R03-REQ01: ✓ без веса или повторов не отмечает подход, пока они не введены", async ({ page }) => {
  const f = await round01Fixture(page);
  await startWith(page, BENCH);
  await expect(weight(page, 1)).toHaveValue("");
  await check(page, 1).click();
  await expect(uncheck(page, 1)).toHaveCount(0);
  await expect(page.locator(".set-hint")).toContainText("Вес не введён");
  await weight(page, 1).fill("60");
  await check(page, 1).click();
  await expect(uncheck(page, 1)).toHaveCount(0);
  await expect(page.locator(".set-hint")).toContainText("Повторы не введены");
  await reps(page, 1).fill("8");
  await check(page, 1).click();
  await expect(uncheck(page, 1)).toBeVisible();
  await expect(page.locator(".set-hint")).toHaveCount(0);
  await finish(page).click();
  await expect(page.locator(".toast")).toContainText("Тренировка сохранена");
  await expect.poll(() => f.savedBodies.length).toBe(1);
  const sets = f.savedBodies[0].exercises[0].sets;
  const performed = sets.filter((s) => s.done);
  expect(performed, "записан один выполненный подход").toHaveLength(1);
  expect(performed[0]).toMatchObject({ weight: 60, reps: 8, done: true });
  expect(f.errors).toEqual([]);
});

test("R03-REQ02: подход N берёт подход N из «Прошлого» (8, 8, 7); без истории повторы и RIR пусты", async ({ page }) => {
  const f = await round01Fixture(page, { workouts: benchHistory() });
  await startWith(page, BENCH, OHP);
  for (const [n, expected] of [[1, "8"], [2, "8"], [3, "7"]] as const) {
    await expect(reps(page, n)).toHaveValue(expected);
    await expect(weight(page, n)).toHaveValue("60");
    await expect(rir(page, n)).toHaveValue("");
  }
  // У упражнения без истории ничего не выдумано.
  await expect(reps(page, 1, OHP)).toHaveValue("");
  await expect(rir(page, 1, OHP)).toHaveValue("");
  for (const n of [1, 2, 3]) await check(page, n).click();
  await weight(page, 1, OHP).fill("40");
  await reps(page, 1, OHP).fill("5");
  await check(page, 1, OHP).click();
  await finish(page).click();
  await expect(page.locator(".toast")).toContainText("Тренировка сохранена");
  await expect.poll(() => f.savedBodies.length).toBe(1);
  const [bench, ohp] = f.savedBodies[0].exercises;
  expect(bench.sets.map((s) => s.reps)).toEqual([8, 8, 7]);
  expect(bench.sets.map((s) => s.weight)).toEqual([60, 60, 60]);
  expect(bench.sets.every((s) => s.rir === null)).toBe(true);
  expect(ohp.sets.filter((s) => s.done)).toHaveLength(1);
  expect(ohp.sets[0]).toMatchObject({ weight: 40, reps: 5, rir: null });
});

test("R03-REQ02: «Повторить прошлые» даёт те же числа, что предзаполнение", async ({ page }) => {
  await round01Fixture(page, { workouts: benchHistory() });
  await startWith(page, BENCH);
  for (const n of [1, 2, 3]) await reps(page, n).fill("1");
  await page.getByRole("button", { name: /^Повторить прошлые/ }).click();
  for (const [n, expected] of [[1, "8"], [2, "8"], [3, "7"]] as const) await expect(reps(page, n)).toHaveValue(expected);
});

async function openNewProgram(page: Page) {
  await nav(page, "Программы").click();
  await page.getByRole("button", { name: "Создать программу", exact: true }).click();
  return page.getByRole("dialog").first();
}

test("R03-REQ03: закрытие редактора — «Сохранить» / «Не сохранять» / «Продолжить правку», без правок вопроса нет", async ({ page }) => {
  const saved: unknown[] = [];
  await round01Fixture(page);
  await page.route("**/api/routines", async (route) => {
    if (route.request().method() !== "PUT") return route.fallback();
    const body = route.request().postDataJSON();
    saved.push(body);
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ routine: { ...body, revision: 1 } }) });
  });
  // Без изменений — закрывается сразу.
  let editor = await openNewProgram(page);
  await editor.getByRole("button", { name: "Закрыть окно", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // Правка → вопрос → «Продолжить правку» возвращает в редактор с тем же текстом.
  editor = await openNewProgram(page);
  await editor.getByLabel("Название программы").fill("Верх тела");
  await editor.getByRole("button", { name: "Закрыть окно", exact: true }).first().click();
  const ask = page.getByRole("dialog").filter({ hasText: "Сохранить программу?" });
  await expect(ask).toBeVisible();
  await expect(ask.getByRole("button", { name: "Сохранить", exact: true })).toBeVisible();
  await expect(ask.getByRole("button", { name: "Не сохранять", exact: true })).toBeVisible();
  await ask.getByRole("button", { name: "Продолжить правку", exact: true }).click();
  await expect(ask).toHaveCount(0);
  await expect(page.getByLabel("Название программы")).toHaveValue("Верх тела");

  // «Не сохранять» — закрыто, ничего не отправлено.
  await page.getByRole("button", { name: "Закрыть окно", exact: true }).first().click();
  await page.getByRole("button", { name: "Не сохранять", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(saved).toHaveLength(0);
  await expect(page.locator(".routine-card")).toHaveCount(0);

  // «Сохранить» — программа появилась в «Сохранённых».
  editor = await openNewProgram(page);
  await editor.getByLabel("Название программы").fill("Низ тела");
  await page.getByRole("button", { name: "Добавить упражнение в программу" }).click();
  await page.getByRole("button", { name: `Добавить Приседания со штангой`, exact: true }).click();
  await page.getByRole("button", { name: "Готово", exact: true }).click();
  await page.getByRole("button", { name: "Закрыть окно", exact: true }).first().click();
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(page.locator(".routine-card").filter({ hasText: "Низ тела" })).toBeVisible();
  expect(saved).toHaveLength(1);
});

async function measureWorkout(page: Page) {
  return page.evaluate(() => {
    const small: string[] = [];
    const root = document.querySelector(".workout-athletic")!;
    const targets = root.querySelectorAll<HTMLElement>(
      "button, summary, input:not([type=hidden]), select, [role=button]",
    );
    for (const el of targets) {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      if (r.width < 43.5 || r.height < 43.5) small.push(`${el.tagName}.${el.className}|${el.getAttribute("aria-label") ?? el.textContent?.trim().slice(0, 20)}|${Math.round(r.width)}×${Math.round(r.height)}`);
    }
    const rows = [...root.querySelectorAll<HTMLElement>(".set-row")].map((r) => Math.round(r.getBoundingClientRect().height));
    return {
      small,
      rows,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
}

for (const size of [{ width: 390, height: 844 }, { width: 360, height: 800 }]) {
  test(`R03-REQ05: экран тренировки ${size.width}×${size.height} — цели ≥44×44, строка подхода ≤56 px, без горизонтального скролла`, async ({ page }) => {
    await page.setViewportSize(size);
    await round01Fixture(page, { workouts: benchHistory() });
    await startWith(page, BENCH);
    await expect(page.getByRole("button", { name: /^Повторить прошлые/ })).toBeVisible();
    await expect(page.getByRole("button", { name: "RIR: что это", exact: true })).toBeVisible();
    const m = await measureWorkout(page);
    expect(m.small, "цели меньше 44×44").toEqual([]);
    expect(m.rows.length).toBeGreaterThanOrEqual(3);
    for (const h of m.rows) expect(h).toBeLessThanOrEqual(56);
    expect(m.overflow).toBeLessThanOrEqual(0);
    // Конкретно названные в требовании.
    for (const target of [
      page.getByRole("button", { name: /^Повторить прошлые/ }),
      page.getByRole("button", { name: /^\+2\.5 кг/ }),
      page.getByRole("button", { name: "RIR: что это", exact: true }),
      page.getByRole("button", { name: /^Подход 1:/ }),
      rir(page, 1),
    ]) {
      const box = (await target.boundingBox())!;
      expect(box.width).toBeGreaterThanOrEqual(43.5);
      expect(box.height).toBeGreaterThanOrEqual(43.5);
    }
  });
}

test("R03-REQ06: отмена импорта называет результат, баннер короткий, объяснение по касанию, итог тренировки не закрыт", async ({ page }) => {
  await round01Fixture(page);
  await nav(page, "История").click();
  await page.getByRole("button", { name: "Импорт истории", exact: true }).click();
  const rows = ["Date,Workout Name,Duration,Exercise Name,Set Order,Weight,Reps,Distance,Seconds,Notes,Workout Notes,RPE"];
  for (const day of ["21", "23"])
    [8, 8, 7].forEach((r, i) => rows.push(`2026-09-${day} 18:30:00,Грудь,1h 5m,Bench Press (Barbell),${i + 1},60,${r},0,0,,,8`));
  await page.getByLabel("Файл истории тренировок").setInputFiles({ name: "strong.csv", mimeType: "text/csv", buffer: Buffer.from(rows.join("\n")) });
  await page.getByRole("button", { name: "Показать предпросмотр", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Импортировать", exact: true }).click();
  const banner = page.locator(".import-undo");
  await expect(banner).toContainText("Импорт: записано 2 из 2");
  // Короткий баннер: одна строка заголовка, пояснение спрятано и открывается по касанию.
  const explanation = banner.locator(".import-undo-more small");
  await expect(explanation).toBeHidden();
  await banner.getByText("Как работает отмена", { exact: true }).click();
  await expect(explanation).toBeVisible();
  await expect(explanation).toContainText("Убираются только записи этого импорта");
  const bannerHeight = (await banner.boundingBox())!.height;
  expect(bannerHeight).toBeLessThan(260);

  // Новая тренировка: итог идёт выше баннера и не перекрыт им.
  await nav(page, "Сегодня").click();
  await startWith(page, BENCH);
  await weight(page, 1).fill("62.5");
  await reps(page, 1).fill("8");
  await check(page, 1).click();
  await finish(page).click();
  await expect(page.locator(".session-insights")).toBeVisible();
  const insights = (await page.locator(".session-insights").boundingBox())!;
  const undoBox = (await page.locator(".import-undo").boundingBox())!;
  expect(undoBox.y).toBeGreaterThanOrEqual(insights.y + insights.height - 1);

  // Отмена: тост называет, что произошло.
  await page.locator(".import-undo").getByRole("button", { name: "Отменить импорт", exact: true }).click();
  await page.locator(".import-undo").getByRole("button", { name: /^Убрать/ }).click();
  const toast = page.locator(".toast");
  await expect(toast).toContainText("Убрал 2 тренировки этого импорта");
  await expect(toast).not.toContainText(/убрано 0|Убрал 0/);
});

test("R03-REQ07: в редакторе программы видно, откуда вес — история, план или не задан", async ({ page }) => {
  const history = benchHistory();
  const routine = {
    id: "r-upper", name: "Верх тела", notes: "", days: [1], restSeconds: 90, progression: "repeat" as const,
    repMin: 8, repMax: 12, incrementKg: 2.5, revision: 1,
    exercises: [] as any[],
  };
  const { makeWorkout } = await import("../../src/lib/model");
  const w = makeWorkout(["bench", "ohp", "pullup", "squat"]);
  w.exercises[0].sets.forEach((s) => (s.weight = 0));
  w.exercises[1].sets.forEach((s) => (s.weight = 35));
  w.exercises[3].sets.forEach((s) => (s.weight = 0));
  routine.exercises = w.exercises;
  await round01Fixture(page, { workouts: history, routines: [routine] });
  await nav(page, "Программы").click();
  await page.getByRole("button", { name: "Редактировать программу Верх тела" }).click();
  const cards = page.getByRole("dialog").locator(".routine-editor-exercise");
  await expect(cards.nth(0).locator(".weight-source")).toContainText("из истории: 60 кг");
  await expect(cards.nth(1).locator(".weight-source")).toContainText("Вес по плану: 35 кг");
  await expect(cards.nth(2).locator(".weight-source")).toHaveCount(0);
  await expect(cards.nth(3).locator(".weight-source")).toContainText("Вес не задан");
});

test("R03-REQ08: «База» — короткое общее слово ведёт к обычным упражнениям, «жим лёжа» не ломается", async ({ page }) => {
  await round01Fixture(page);
  await page.getByRole("button", { name: "Начать тренировку", exact: true }).first().click();
  await page.getByRole("button", { name: "Добавить упражнение", exact: true }).click();
  const search = page.getByRole("dialog").getByRole("searchbox").or(page.getByRole("dialog").getByPlaceholder(/Найти|Поиск/)).first();
  await search.fill("присед");
  const names = page.getByRole("dialog").locator("button[aria-label^='Добавить ']");
  await expect(names.first()).toHaveAttribute("aria-label", "Добавить Приседания со штангой");
  await search.fill("жим лёжа");
  await expect(names.first()).toHaveAttribute("aria-label", "Добавить Жим штанги лёжа");
});

test.describe("R03-REQ04: запуск без сети после первого входа", () => {
  test.use({ serviceWorkers: "allow" });

  test("оболочка и каталог открываются офлайн, подход пишется в черновик и переживает перезагрузку, при возврате сети — данные", async ({ page, context }) => {
    const f = await round01Fixture(page, { workouts: benchHistory() });
    // Первый вход с сетью: сервис-воркер установлен, оболочка и каталог в кэше.
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
    await expect
      .poll(() => page.evaluate(async () => (await caches.keys()).filter((k) => k.startsWith("tyaga-shell-")).length), { timeout: 20000 })
      .toBe(1);
    await expect
      .poll(() => page.evaluate(async () => (await (await caches.open((await caches.keys())[0])).keys()).length), { timeout: 20000 })
      .toBeGreaterThan(5);
    await expect(page.getByRole("heading", { name: "Сегодня", exact: true })).toBeVisible();
    await page.waitForLoadState("networkidle");

    // Связь пропала: сервер недоступен, оболочка — из кэша.
    let offline = false;
    await page.route("**/api/**", (route) => (offline ? route.abort("internetdisconnected") : route.fallback()));
    offline = true;
    await context.setOffline(true);
    await page.reload();
    await expect(page.getByRole("heading", { name: "Сегодня", exact: true })).toBeVisible({ timeout: 15000 });
    await expect(page.locator(".offline-banner")).toContainText("Нет связи");
    await nav(page, "Программы").click();
    await expect(page.getByRole("heading", { name: "Программы" })).toBeVisible();
    await nav(page, "История").click();
    await expect(page.locator(".session-item")).toHaveCount(1);

    // Тренировка и подход — без сети; перезагрузка без сети подход не теряет.
    await nav(page, "Сегодня").click();
    await startWith(page, BENCH);
    await expect(reps(page, 1)).toHaveValue("8");
    await check(page, 1).click();
    await expect(uncheck(page, 1)).toBeVisible();
    await page.reload();
    await expect(page.getByRole("heading", { name: "Сегодня", exact: true })).toBeVisible({ timeout: 15000 });
    await page.getByRole("button", { name: "Продолжить тренировку", exact: true }).first().click();
    await expect(uncheck(page, 1)).toBeVisible();

    // Связь вернулась: свежие данные подтянулись сами, баннер ушёл, «Завершить» уходит на сервер.
    offline = false;
    await context.setOffline(false);
    await expect(page.locator(".offline-banner")).toHaveCount(0, { timeout: 15000 });
    await finish(page).click();
    await expect.poll(() => f.savedBodies.length).toBe(1);
    expect(f.savedBodies[0].exercises[0].sets[0]).toMatchObject({ done: true, reps: 8, weight: 60 });
    expect(f.errors).toEqual([]);
  });
});
