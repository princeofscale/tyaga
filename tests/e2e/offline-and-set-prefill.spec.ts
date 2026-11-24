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
    // QA-R03-06: тренировка не начата — баннер ничего не говорит про неё.
    await expect(page.locator(".offline-banner")).not.toContainText("Тренировка сохранена");
    await expect(page.locator(".offline-banner")).not.toContainText("Завершить");
    await expect(page.locator(".offline-banner")).not.toContainText("сработает");
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
    // Начатая тренировка есть — баннер говорит про неё и про очередь, без обещаний «само сработает».
    await expect(page.locator(".offline-banner")).toContainText("нажми «Завершить»");
    await expect(page.locator(".offline-banner")).toContainText("очередь");
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

const register = async (page: Page, email = "fresh@example.test") => {
  await page.getByRole("button", { name: "Регистрация", exact: true }).click();
  await page.getByLabel("Как тебя зовут").fill("Саша");
  await page.getByLabel("Почта").fill(email);
  await page.getByLabel("Пароль", { exact: true }).fill("correct horse battery");
  await page.getByRole("button", { name: "Создать аккаунт", exact: true }).click();
  await page.getByLabel("Я сохранил код").check();
  await page.getByRole("button", { name: "Код сохранён", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Сегодня", exact: true })).toBeVisible();
};

test.describe("QA-R03-01: офлайн-запуск сразу после регистрации", () => {
  test.use({ serviceWorkers: "allow" });

  test("свежий аккаунт: регистрация онлайн → без второй загрузки сеть пропала → приложение открывается", async ({ page, context }) => {
    await round01Fixture(page, { signedOut: true });
    await expect
      .poll(() => page.evaluate(async () => (await caches.keys()).filter((k) => k.startsWith("tyaga-shell-")).length), { timeout: 20000 })
      .toBe(1);
    await register(page);
    // Копия профиля и данных записана сразу при входе — до какой-либо следующей загрузки.
    const keys = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("tyaga-offline:")));
    expect(keys).toContain("tyaga-offline:session");
    expect(keys.some((k) => k.startsWith("tyaga-offline:data:"))).toBe(true);
    let offline = false;
    await page.route("**/api/**", (route) => (offline ? route.abort("internetdisconnected") : route.fallback()));
    offline = true;
    await context.setOffline(true);
    await page.reload();
    await expect(page.getByRole("heading", { name: "Сегодня", exact: true })).toBeVisible({ timeout: 15000 });
    await expect(page.getByText("Запрос не завершился")).toHaveCount(0);
    await expect(page.locator(".offline-banner")).toContainText("Нет связи");
  });
});

test("QA-R03-03: выход стирает всё личное с устройства, а другой аккаунт не видит чужого", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await round01Fixture(page, { workouts: benchHistory() });
  await page.evaluate(() => localStorage.setItem("tyaga_theme_accent", "lime"));
  await startWith(page, BENCH);
  await weight(page, 1).fill("60");
  await reps(page, 1).fill("8");
  await check(page, 1).click();
  await page.evaluate(() => {
    localStorage.setItem("tyaga-bodyweight-sync:round01-user", "{}");
    localStorage.setItem("tyaga-last-import:round01-user", "{}");
  });
  const personal = () => page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("tyaga-")));
  await expect.poll(personal).toEqual(expect.arrayContaining(["tyaga-draft-account:round01-user", "tyaga-offline:session", "tyaga-offline:data:round01-user", "tyaga-bodyweight-sync:round01-user", "tyaga-last-import:round01-user"]));
  await page.locator(".profile-button").click();
  await page.getByRole("dialog").getByRole("button", { name: "Выйти из аккаунта", exact: true }).click();
  await page.getByRole("button", { name: "Выйти", exact: true }).click(); // QA-R03-07: с черновиком выход подтверждается
  await expect(page.getByRole("heading", { name: "Снова в зале" })).toBeVisible();
  await expect.poll(personal).toEqual([]);
  expect(await page.evaluate(() => localStorage.getItem("tyaga_theme_accent")), "оформление не личное и остаётся").toBe("lime");
  // Cache Storage — только файлы приложения, ни одного ответа API.
  const cached = await page.evaluate(async () => {
    const out: string[] = [];
    for (const name of await caches.keys()) for (const r of await (await caches.open(name)).keys()) out.push(new URL(r.url).pathname);
    return out;
  });
  expect(cached.filter((p) => p.startsWith("/api"))).toEqual([]);
  // Вход под другим аккаунтом: ни черновика, ни журнала прежнего.
  await page.getByLabel("Почта").fill("other@example.test");
  await page.getByLabel("Пароль", { exact: true }).fill("correct horse battery");
  await page.getByRole("button", { name: "Войти в Тягу", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Сегодня", exact: true })).toBeVisible();
  const after = await personal();
  expect(after.filter((k) => k.includes("round01-user:") || k.endsWith("round01-user"))).toEqual([]);
  expect(await page.evaluate(() => document.body.innerText)).not.toContain("Продолжить тренировку");
});

test("QA-R03-02: тренировка из программы — подход N из «Прошлого» (8/8/7), без истории поля пусты, ✓ без ввода не пишет", async ({ page }) => {
  const { makeWorkout } = await import("../../src/lib/model");
  const w = makeWorkout(["bench", "lat-pulldown"]);
  const routine = {
    id: "r-start", name: "Верх тела", notes: "", days: [1], restSeconds: 90, progression: "repeat" as const,
    repMin: 8, repMax: 12, incrementKg: 2.5, revision: 1, exercises: w.exercises,
  };
  const f = await round01Fixture(page, { workouts: benchHistory(), routines: [routine] });
  await page.getByRole("button", { name: "Начать тренировку", exact: true }).first().click();
  for (const [n, expected] of [[1, "8"], [2, "8"], [3, "7"]] as const) {
    await expect(reps(page, n)).toHaveValue(expected);
    await expect(rir(page, n)).toHaveValue("");
  }
  const PULL = "Тяга верхнего блока";
  await expect(reps(page, 1, PULL)).toHaveValue("");
  await expect(reps(page, 1, PULL)).toHaveAttribute("placeholder", "10");
  await expect(rir(page, 1, PULL)).toHaveValue("");
  await weight(page, 1, PULL).fill("40");
  await check(page, 1, PULL).click();
  await expect(uncheck(page, 1, PULL)).toHaveCount(0);
  await expect(page.locator(".set-hint")).toContainText("Повторы не введены");
  // Три ✓ жима записывают 8/8/7, как «Повторить прошлые».
  for (const n of [1, 2, 3]) await check(page, n).click();
  await page.getByRole("button", { name: /^Повторить прошлые/ }).first().click();
  for (const [n, expected] of [[1, "8"], [2, "8"], [3, "7"]] as const) await expect(reps(page, n)).toHaveValue(expected);
  void f;
});

/** Начать тренировку жима и записать один подход, как человек. */
async function oneSet(page: Page) {
  await startWith(page, BENCH);
  await weight(page, 1).fill("60");
  await reps(page, 1).fill("8");
  await check(page, 1).click();
  await expect(uncheck(page, 1)).toBeVisible();
}
const stored = (page: Page, key: string) => page.evaluate((k) => localStorage.getItem(k), key);
const PENDING_KEY = "tyaga-pending-workouts:round01-user";
const DRAFT_KEY = "tyaga-draft-account:round01-user";
const comeBack = (page: Page) => page.evaluate(() => window.dispatchEvent(new Event("online")));

/** Запись тренировки — единственный отказывающий запрос: журнал, профиль и остальное отвечают как обычно. */
async function workoutsLink(page: Page) {
  const state = { mode: "down" as "down" | "up" | "conflict", puts: 0, attempts: 0 };
  await page.route("**/api/workouts", async (route) => {
    if (route.request().method() !== "PUT") return route.fallback();
    state.attempts++;
    if (state.mode === "down") return route.abort("internetdisconnected");
    if (state.mode === "conflict")
      return route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ error: "Тренировка изменена на другом устройстве", current: null }) });
    state.puts++;
    return route.fallback();
  });
  return state;
}

test.describe("Доработка 2 / R03-REQ04: очередь отправки завершённой тренировки", () => {
  test("«Завершить» без связи → «Ждёт отправки» → связь вернулась → ровно один PUT, одна тренировка, после перезагрузки без дубля", async ({ page }) => {
    const f = await round01Fixture(page);
    const link = await workoutsLink(page);
    await oneSet(page);
    await finish(page).click();
    // Не черновик и не потеря: тренировка в истории со статусом, баннер и очередь на устройстве.
    await expect(page.getByRole("heading", { name: "История" })).toBeVisible();
    await expect(page.locator(".session-item")).toHaveCount(1);
    await expect(page.locator(".session-item .pending-badge")).toHaveText("Ждёт отправки");
    await expect(page.locator(".pending-banner")).toContainText("Ждёт отправки: 1");
    await expect(page.locator(".toast")).toContainText("ждёт отправки");
    expect(f.savedBodies).toHaveLength(0);
    expect(await stored(page, DRAFT_KEY), "черновика нет").toBeNull();
    expect(JSON.parse((await stored(page, PENDING_KEY))!)).toHaveLength(1);
    await nav(page, "Сегодня").click();
    await expect(page.getByRole("button", { name: "Продолжить тренировку", exact: true })).toHaveCount(0);
    await expect(page.locator(".pending-banner")).toContainText("Ждёт отправки");

    // Перезагрузка без связи: тренировка на месте, один раз.
    await page.reload();
    await expect(page.getByRole("heading", { name: "Сегодня", exact: true })).toBeVisible();
    await nav(page, "История").click();
    await expect(page.locator(".session-item")).toHaveCount(1);
    await expect(page.locator(".session-item .pending-badge")).toHaveCount(1);

    // Связь вернулась: событие `online` отправляет её сама, одним запросом.
    const before = link.attempts;
    link.mode = "up";
    await comeBack(page);
    await expect.poll(() => f.savedBodies.length).toBe(1);
    await expect(page.locator(".pending-banner")).toHaveCount(0);
    await expect(page.locator(".session-item .pending-badge")).toHaveCount(0);
    await expect(page.locator(".session-item")).toHaveCount(1);
    expect(await stored(page, PENDING_KEY), "очередь пуста").toBeNull();
    expect(link.puts).toBe(1);
    expect(link.attempts - before, "ровно одна попытка после возвращения связи").toBe(1);
    expect(f.savedBodies[0].exercises[0].sets[0]).toMatchObject({ done: true, weight: 60, reps: 8 });

    // После перезагрузки дубля нет, повторной отправки нет.
    await page.reload();
    await expect(page.getByRole("heading", { name: "Сегодня", exact: true })).toBeVisible();
    await nav(page, "История").click();
    await expect(page.locator(".session-item")).toHaveCount(1);
    expect(f.savedBodies).toHaveLength(1);
    expect(link.attempts - before).toBe(1);
    expect(f.errors).toEqual([]);
  });

  test("очередь уходит и при следующей загрузке: связь вернулась, пока приложение было закрыто", async ({ page }) => {
    const f = await round01Fixture(page);
    const link = await workoutsLink(page);
    await oneSet(page);
    await finish(page).click();
    await expect(page.locator(".pending-banner")).toContainText("Ждёт отправки: 1");
    link.mode = "up";
    await page.reload();
    await expect(page.getByRole("heading", { name: "Сегодня", exact: true })).toBeVisible();
    await expect.poll(() => f.savedBodies.length).toBe(1);
    await expect(page.locator(".pending-banner")).toHaveCount(0);
    await nav(page, "История").click();
    await expect(page.locator(".session-item")).toHaveCount(1);
    await expect(page.locator(".pending-badge")).toHaveCount(0);
  });

  test("повторная отправка после потерянного ответа не даёт дубля: сервер уже записал, очередь снимается", async ({ page }) => {
    const f = await round01Fixture(page);
    const link = await workoutsLink(page);
    await oneSet(page);
    await finish(page).click();
    await expect(page.locator(".pending-banner")).toContainText("Ждёт отправки: 1");
    // Запрос дошёл и записан, а ответ потерялся: на сервере уже есть эта тренировка.
    const queued = JSON.parse((await stored(page, PENDING_KEY))!)[0].workout;
    f.workouts.unshift({ ...queued, revision: 1 });
    link.mode = "up";
    await comeBack(page);
    await expect.poll(() => link.puts).toBe(1);
    await expect(page.locator(".pending-banner")).toHaveCount(0);
    await nav(page, "История").click();
    await expect(page.locator(".session-item")).toHaveCount(1);
    expect(f.workouts.filter((w) => w.id === queued.id)).toHaveLength(1);
  });

  test("отказ сервера (409) — данные не теряются: понятная ошибка, тренировка остаётся в очереди, «Отправить сейчас» потом уходит", async ({ page }) => {
    const f = await round01Fixture(page);
    const link = await workoutsLink(page);
    await oneSet(page);
    await finish(page).click();
    await expect(page.locator(".pending-banner")).toContainText("Ждёт отправки: 1");
    link.mode = "conflict";
    await comeBack(page);
    const banner = page.locator(".pending-banner");
    await expect(banner).toContainText("Сервер не принял: Тренировка изменена на другом устройстве");
    await expect(banner).toContainText("осталась на устройстве");
    expect(await stored(page, PENDING_KEY)).not.toBeNull();
    await page.reload();
    await nav(page, "История").click();
    await expect(page.locator(".session-item .pending-badge")).toHaveText("Ждёт отправки");
    // Молча отказ не повторяется: пока человек не нажал, лишних запросов нет.
    const attempts = link.attempts;
    await comeBack(page);
    await page.waitForTimeout(400);
    expect(link.attempts).toBe(attempts);
    link.mode = "up";
    await page.getByRole("button", { name: "Отправить сейчас", exact: true }).click();
    await expect.poll(() => f.savedBodies.length).toBe(1);
    await expect(page.locator(".pending-banner")).toHaveCount(0);
    await expect(page.locator(".session-item")).toHaveCount(1);
  });

  test("ожидающую тренировку нельзя править до отправки; её можно удалить — она снимается с очереди", async ({ page }) => {
    const f = await round01Fixture(page);
    await workoutsLink(page);
    await oneSet(page);
    await finish(page).click();
    await expect(page.locator(".session-item")).toHaveCount(1);
    await page.locator(".session-item").click();
    await page.getByRole("button", { name: "Редактировать", exact: true }).click();
    await expect(page.locator(".toast")).toContainText("ещё не отправлена");
    await expect(page.getByRole("button", { name: "Продолжить тренировку", exact: true })).toHaveCount(0);
    // Удаление — снять с очереди: на сервере её ещё нет, DELETE не уходит.
    await page.locator(".session-item").click();
    await page.getByRole("button", { name: "Удалить", exact: true }).click();
    await page.getByRole("dialog", { name: "Удалить тренировку?" }).getByRole("button", { name: "Удалить", exact: true }).click();
    await expect(page.locator(".session-item")).toHaveCount(0);
    await expect(page.locator(".pending-banner")).toHaveCount(0);
    expect(await stored(page, PENDING_KEY)).toBeNull();
    expect(f.deleted).toEqual([]);
  });
});

test.describe("QA-R03-07: выход из аккаунта не стирает несохранённое молча", () => {
  test.use({ viewport: { width: 1280, height: 900 }, isMobile: false, hasTouch: false });
  const logout = (page: Page) => page.getByRole("dialog").getByRole("button", { name: "Выйти из аккаунта", exact: true });

  test("без черновика и очереди — выход как раньше, одним нажатием", async ({ page }) => {
    await round01Fixture(page);
    await page.locator(".profile-button").click();
    await logout(page).click();
    await expect(page.getByRole("heading", { name: "Снова в зале" })).toBeVisible();
  });

  test("с начатой тренировкой: вопрос, «Остаться» ничего не трогает, «Выйти» стирает", async ({ page }) => {
    await round01Fixture(page);
    await oneSet(page);
    await page.locator(".profile-button").click();
    await logout(page).click();
    const ask = page.getByRole("alertdialog");
    await expect(ask).toContainText("Выйти? Несохранённая тренировка на этом устройстве пропадёт");
    await ask.getByRole("button", { name: "Остаться", exact: true }).click();
    await expect(ask).toHaveCount(0);
    await expect(page.getByRole("dialog", { name: "Мой профиль" })).toBeVisible();
    expect(await stored(page, DRAFT_KEY), "черновик на месте").not.toBeNull();
    await logout(page).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Выйти", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Снова в зале" })).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("tyaga-"))))
      .toEqual([]);
  });

  test("с очередью отправки: тоже вопрос; после «Выйти» очереди на устройстве нет", async ({ page }) => {
    await round01Fixture(page);
    await workoutsLink(page);
    await oneSet(page);
    await finish(page).click();
    await expect(page.locator(".pending-banner")).toContainText("Ждёт отправки: 1");
    await page.locator(".profile-button").click();
    await logout(page).click();
    await expect(page.getByRole("alertdialog")).toContainText("ждёт отправки: 1");
    await page.getByRole("alertdialog").getByRole("button", { name: "Выйти", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Снова в зале" })).toBeVisible();
    expect(await stored(page, PENDING_KEY)).toBeNull();
    await expect
      .poll(() => page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("tyaga-"))))
      .toEqual([]);
  });
});

test("QA-R03-08: истёкшая сессия стирает кэши журнала веса, импорта и офлайн-копию; начатая тренировка остаётся и возвращается после входа", async ({ page }) => {
  const f = await round01Fixture(page);
  void f;
  await oneSet(page);
  await page.evaluate(() => {
    localStorage.setItem("tyaga-bodyweight-sync:round01-user", "{}");
    localStorage.setItem("tyaga-last-import:round01-user", "{}");
  });
  let expired = true;
  await page.route("**/api/auth/session", (route) =>
    expired
      ? route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ registered: true, profile: null }) })
      : route.fallback(),
  );
  await page.evaluate(() => window.dispatchEvent(new Event("tyaga:auth-expired")));
  await expect(page.getByRole("heading", { name: "Снова в зале" })).toBeVisible();
  const keys = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("tyaga-")));
  expect(keys).not.toContain("tyaga-bodyweight-sync:round01-user");
  expect(keys).not.toContain("tyaga-last-import:round01-user");
  expect(keys).not.toContain("tyaga-offline:session");
  expect(keys.some((k) => k.startsWith("tyaga-offline:data:"))).toBe(false);
  expect(keys, "несохранённая тренировка не стирается тихо").toContain(DRAFT_KEY);
  expired = false;
  await page.getByLabel("Почта").fill("round01@example.test");
  await page.getByLabel("Пароль", { exact: true }).fill("correct horse battery");
  await page.getByRole("button", { name: "Войти в Тягу", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Сегодня", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Продолжить тренировку", exact: true }).first()).toBeVisible();
});
