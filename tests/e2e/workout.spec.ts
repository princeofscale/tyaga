import {
  test as baseTest,
  expect,
  type Page,
  type APIRequestContext,
} from "@playwright/test";
import { zipSync, strToU8 } from "fflate";
const BASE = "http://localhost:5173";
const WORKER = "http://127.0.0.1:8787";
const headers = { Origin: BASE };
let authCookie = "";
const test = baseTest.extend({
  request: async ({ playwright }, use) => {
    const request = await playwright.request.newContext({ baseURL: BASE, extraHTTPHeaders: authCookie ? { Cookie: authCookie } : {} });
    await use(request); await request.dispose();
  },
});
async function signIn(request: APIRequestContext) {
  if (authCookie) return;
  const session = await (await request.get("/api/auth/session")).json();
  const response = await request.post(`/api/auth/${session.registered ? "login" : "register"}`, {
    headers, data: { email: "gym-e2e@example.test", password: "test account passphrase", displayName: "[E2E] Атлет", timeZone: "UTC" },
  });
  expect(response.ok()).toBeTruthy();
  authCookie = response.headers()["set-cookie"].split(";")[0];
}
async function cleanup(_request: APIRequestContext) {
  if (!authCookie) return;
  // Fixtures use a separate Node transport and fully drain every response.
  // Browser actions and scenario assertions continue through the real client
  // and Playwright API context. Never retry a failed operation silently.
  const cleanupHeaders = {
    ...headers, Connection: "close", "Accept-Encoding": "identity",
    "Content-Type": "application/json", Cookie: authCookie,
  };
  const call = async (path: string, method = "GET", data?: unknown) => {
    try {
      const response = await fetch(WORKER + path, {
        method, headers: cleanupHeaders, signal: AbortSignal.timeout(10000),
        ...(data !== undefined ? { body: JSON.stringify(data) } : {}),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json() as any;
    } catch (error) {
      throw new Error(`Fixture cleanup ${method} ${path}: ${error instanceof Error ? error.message : "failed"}`);
    }
  };
  const data = await call("/api/data");
  expect(Array.isArray(data.workouts)).toBeTruthy();
  for (const w of data.workouts)
    if (w.name.startsWith("[E2E]"))
      await call("/api/workouts/" + w.id, "DELETE", { revision: w.revision });
  const product = await call("/api/product");
  for (const r of product.routines ?? [])
    if (r.name.startsWith("[E2E]"))
      await call("/api/routines/" + r.id, "DELETE", { revision: r.revision });
  for (const e of product.customExercises ?? [])
    if (e.name.startsWith("[E2E]"))
      await call("/api/custom-exercises/" + e.id, "DELETE", {});
}

/** Picks an option in the in-app dropdown (components/Select.tsx). Its name
 * is the label plus the current value, so the label matches as a prefix. */
async function choose(page: Page, label: string, option: string) {
  await page.getByLabel(label).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}
async function addExercise(page: Page, name: string) {
  await page
    .getByRole("button", { name: "Добавить упражнение", exact: true })
    .click();
  await page
    .getByRole("button", { name: `Добавить ${name}`, exact: true })
    .click();
  await page.getByRole("button", { name: "Готово", exact: true }).click();
}
async function startBench(page: Page, name: string) {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Начать тренировку", exact: true })
    .click();
  await page.getByLabel("Название тренировки", { exact: true }).fill(name);
  await addExercise(page, "Жим штанги лёжа");
  await page
    .getByLabel("Жим штанги лёжа, подход 1, вес", { exact: true })
    .fill("70");
  await page
    .getByRole("button", {
      name: "Отметить выполненным: Жим штанги лёжа, подход 1",
      exact: true,
    })
    .click();
}
async function history(page: Page) {
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "История", exact: true })
    .click();
}
test.beforeEach(async ({ request, context }, info) => {
  if (info.title.startsWith("account registration")) return;
  await signIn(request);
  const [name,value] = authCookie.split("=");
  await context.addCookies([{ name, value, url: BASE }]);
  await cleanup(request);
});
test.afterEach(async ({ request }) => {
  await cleanup(request);
});

test("account registration or login, profile, logout and returning session work on mobile", async ({ page,context,request }) => {
  await page.setViewportSize({width:390,height:844});
  const state=await (await request.get("/api/auth/session")).json();
  await page.goto("/");
  if (!state.registered) await page.getByLabel("Как тебя зовут").fill("[E2E] Атлет");
  await page.getByLabel("Почта",{exact:true}).fill("gym-e2e@example.test");
  await page.getByLabel("Пароль",{exact:true}).fill("test account passphrase");
  await page.screenshot({path:"artifacts/account-mobile-v4.png",fullPage:true});
  await page.getByRole("button",{name:state.registered ? "Войти в Тягу" : "Создать аккаунт",exact:true}).click();
  if (!state.registered) { await expect(page.getByRole("dialog",{name:"Код восстановления"})).toBeVisible(); await page.getByRole("button",{name:"Код сохранён"}).click(); }
  await expect(page.getByRole("heading",{name:"Сегодня",exact:true})).toBeVisible();
  await page.reload(); await expect(page.getByRole("heading",{name:"Сегодня",exact:true})).toBeVisible();
  await page.getByRole("button",{name:"Мой профиль"}).click();
  await page.getByLabel("Имя",{exact:true}).fill("[E2E] Атлет");
  await page.getByLabel("Вес тела, кг",{exact:true}).fill("75.5");
  await page.getByLabel("Часовой пояс",{exact:true}).fill("UTC");
  await page.getByRole("button",{name:"Сохранить профиль",exact:true}).click();
  await expect(page.getByText("Профиль сохранён",{exact:true})).toBeVisible();
  await page.getByRole("button",{name:"Выйти из аккаунта",exact:true}).click();
  await expect(page.getByRole("heading",{name:"Снова в зале"})).toBeVisible();
  await page.getByLabel("Почта",{exact:true}).fill("gym-e2e@example.test"); await page.getByLabel("Пароль",{exact:true}).fill("test account passphrase");
  await page.getByRole("button",{name:"Войти в Тягу",exact:true}).click();
  await expect(page.getByRole("heading",{name:"Сегодня",exact:true})).toBeVisible();
  const cookie=(await context.cookies()).find(c=>c.name==="tyaga_session")!;
  expect(cookie.httpOnly).toBeTruthy(); expect(cookie.sameSite).toBe("Strict"); authCookie=`${cookie.name}=${cookie.value}`;
  expect(await page.evaluate(()=>document.cookie)).not.toContain("tyaga_session");
  expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
});

test("save/reload/edit/export/settings/repeat preserve the actual workout and timers", async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.getByRole("button",{name:"Посмотреть пример",exact:true}).click();
  await expect(page.getByText("Пример данных", { exact: true })).toBeVisible();
  await page.screenshot({ path: "artifacts/desktop-v2.png", fullPage: true });
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Прогресс", exact: true })
    .click();
  await page.getByRole("button", { name: "20 мин", exact: true }).click();
  await expect(page.locator(".plan-item")).not.toHaveCount(0);
  expect(await page.locator(".plan-item").count()).toBeLessThanOrEqual(2);
  await page.screenshot({ path: "artifacts/planner-v2.png", fullPage: true });
  await startBench(page, "[E2E] Журнал");
  await page.getByText("Детали тренировки", { exact: true }).click();
  await page.getByLabel("Длительность тренировки, минуты").fill("42");
  const rest = await page.locator(".rest-digits").textContent();
  await page.reload();
  await page
    .getByRole("button", { name: "Продолжить тренировку", exact: true })
    .click();
  await expect(
    page.getByLabel("Жим штанги лёжа, подход 1, вес", { exact: true }),
  ).toHaveValue("70");
  await expect(page.getByLabel("Длительность тренировки, минуты")).toHaveValue(
    "42",
  );
  expect(await page.locator(".rest-digits").textContent()).not.toBe("00:00");
  expect(rest).not.toBe("00:00");
  await page.screenshot({ path: "artifacts/workout-v2.png", fullPage: true });
  await page
    .getByRole("button", { name: "Завершить тренировку", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "История тренировок", exact: true }),
  ).toBeVisible();
  await page.reload();
  await history(page);
  await page
    .locator(".session-item")
    .filter({ hasText: "[E2E] Журнал" })
    .click();
  await page
    .getByRole("button", { name: "Редактировать", exact: true })
    .click();
  await page
    .getByLabel("Жим штанги лёжа, подход 1, вес", { exact: true })
    .fill("75");
  await page
    .getByRole("button", { name: "Сохранить изменения", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "История тренировок", exact: true }),
  ).toBeVisible();
  let data = await (await request.get("/api/data")).json();
  expect(data.workouts[0].exercises[0].sets[0].weight).toBe(75);
  expect(data.workouts[0].duration).toBe(42);
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Экспорт JSON", exact: true }).click();
  const download = await downloadPromise;
  const file = await download.path();
  const exported = JSON.parse(
    await (await import("node:fs/promises")).readFile(file!, "utf8"),
  );
  expect(exported.version).toBe(3);
  expect(
    exported.workouts.some((w: { id: string }) => w.id.startsWith("demo-")),
  ).toBe(false);
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Прогресс", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Настройки целей", exact: true })
    .click();
  await page.getByLabel("Недельная цель: Грудь", { exact: true }).fill("11");
  await page.getByLabel("Часовой пояс календаря").fill("Europe/Amsterdam");
  await page
    .getByRole("button", { name: "Сохранить ориентиры", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  data = await (await request.get("/api/data")).json();
  expect(data.settings.goals.chest).toBe(11);
  expect(data.settings.timeZone).toBe("Europe/Amsterdam");
  await history(page);
  await page
    .locator(".session-item")
    .filter({ hasText: "[E2E] Журнал" })
    .click();
  await page.getByRole("button", { name: "Повторить", exact: true }).click();
  await expect(page.locator(".set-row")).toHaveCount(3);
  await expect(
    page.getByRole("button", { name: /^Отметить выполненным:/ }),
  ).toHaveCount(3);
  await expect(
    page.getByLabel("Жим штанги лёжа, подход 1, вес", { exact: true }),
  ).toHaveValue("75");
  expect(errors).toEqual([]);
});

test("two browser devices do not overwrite each other and can keep a separate copy", async ({
  page,
  browser,
  request,
}) => {
  await startBench(page, "[E2E] Конфликт");
  await page
    .getByRole("button", { name: "Завершить тренировку", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "История тренировок", exact: true }),
  ).toBeVisible();
  const secondContext = await browser.newContext({
    viewport: { width: 1440, height: 1080 },
    locale: "ru-RU",
  });
  const [cookieName,cookieValue] = authCookie.split("=");
  await secondContext.addCookies([{name:cookieName,value:cookieValue,url:BASE}]);
  const second = await secondContext.newPage();
  await second.goto(BASE);
  await history(second);
  for (const p of [page, second]) {
    await p
      .locator(".session-item")
      .filter({ hasText: "[E2E] Конфликт" })
      .click();
    await p.getByRole("button", { name: "Редактировать", exact: true }).click();
  }
  await page
    .getByLabel("Жим штанги лёжа, подход 1, вес", { exact: true })
    .fill("75");
  await page
    .getByRole("button", { name: "Сохранить изменения", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "История тренировок", exact: true }),
  ).toBeVisible();
  await second
    .getByLabel("Жим штанги лёжа, подход 1, вес", { exact: true })
    .fill("80");
  await second
    .getByRole("button", { name: "Сохранить изменения", exact: true })
    .click();
  await expect(
    second.getByRole("dialog", { name: "Версии тренировки разошлись" }),
  ).toBeVisible();
  let data = await (await request.get("/api/data")).json();
  expect(data.workouts[0].exercises[0].sets[0].weight).toBe(75);
  await second
    .getByRole("button", { name: "Создать отдельную копию", exact: true })
    .click();
  await expect(
    second.getByLabel("Жим штанги лёжа, подход 1, вес", { exact: true }),
  ).toHaveValue("80");
  await second
    .getByRole("button", { name: "Завершить тренировку", exact: true })
    .click();
  await expect(
    second.getByRole("heading", { name: "История тренировок", exact: true }),
  ).toBeVisible();
  data = await (await request.get("/api/data")).json();
  expect(
    data.workouts.map((w: any) => w.exercises[0].sets[0].weight).sort(),
  ).toEqual([75, 80]);
  await secondContext.close();
});

test("storage failure is visible and API save still works", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Storage.prototype.setItem = () => {
      throw new DOMException("Full storage", "QuotaExceededError");
    };
  });
  await startBench(page, "[E2E] Нет хранилища");
  await expect(
    page.getByText("Черновик сейчас только в открытой форме:", {
      exact: false,
    }),
  ).toBeVisible();
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Скачать черновик", exact: true })
    .click();
  expect((await download).suggestedFilename()).toBe("tyaga-draft.json");
  await page
    .getByRole("button", { name: "Завершить тренировку", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "История тренировок", exact: true }),
  ).toBeVisible();
});

test("lost response after commit is safely retried with frozen duration", async ({
  page,
  request,
}) => {
  await startBench(page, "[E2E] Повтор запроса");
  await page.route("**/api/workouts", async (route) => {
    await route.fetch();
    await route.abort("failed");
  });
  await page
    .getByRole("button", { name: "Завершить тренировку", exact: true })
    .click();
  await expect(
    page.getByText("Запрос не завершился.", { exact: false }),
  ).toBeVisible();
  const before = await (await request.get("/api/data")).json();
  expect(before.workouts).toHaveLength(1);
  await page.unroute("**/api/workouts");
  await page.clock.install();
  await page.clock.fastForward(61000);
  await page
    .getByRole("button", { name: "Завершить тренировку", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "История тренировок", exact: true }),
  ).toBeVisible();
  const after = await (await request.get("/api/data")).json();
  expect(after.workouts).toHaveLength(1);
  expect(after.workouts[0].revision).toBe(before.workouts[0].revision);
  expect(after.workouts[0].duration).toBe(before.workouts[0].duration);
});

test("dumbbells, explicit sides and assistance keep distinct input rules", async ({
  page,
  request,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Начать тренировку", exact: true })
    .click();
  await page
    .getByLabel("Название тренировки", { exact: true })
    .fill("[E2E] Правила веса");
  const names = [
    "Жим гантелей на наклонной 30°",
    "Тяга гантели одной рукой с опорой",
    "Подтягивания с помощью тренажёра",
  ];
  for (const name of names) await addExercise(page, name);
  for (const [i, name] of names.entries()) {
    await page
      .getByLabel(`${name}, подход 1, ${i === 2 ? "помощь" : "вес"}`, {
        exact: true,
      })
      .fill(i === 2 ? "40" : "20");
    await page
      .getByRole("button", {
        name: `Отметить выполненным: ${name}, подход 1`,
        exact: true,
      })
      .click();
  }
  await page.getByLabel("Тренажёр / блок", { exact: true }).fill("Ассист A");
  await expect(page.getByLabel("Выполненные стороны")).toHaveAttribute("data-value", "both");
  await expect(page.locator(".session-summary-stats")).toContainText("800");
  await page
    .getByRole("button", { name: "Завершить тренировку", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "История тренировок", exact: true }),
  ).toBeVisible();
  const data = await (await request.get("/api/data")).json();
  const exercises = data.workouts[0].exercises;
  expect(exercises[0].catalogRevision).toBe(2);
  expect(exercises[1].performedSides).toBe("both");
  expect(exercises[2].sets[0].assistanceKg).toBe(40);
  expect(exercises[2].sets[0].weight).toBe(0);
});

test("warmup-only is blocked and timer completion is announced after restoration", async ({
  page,
}) => {
  await startBench(page, "[E2E] Разминка");
  await page
    .getByRole("button", {
      name: "Подход 1: рабочий. Переключить тип",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("button", { name: "Завершить тренировку", exact: true }),
  ).toBeDisabled();
  await page.evaluate(() => {
    const key = Object.keys(localStorage).find(k => k.startsWith("tyaga-draft-account:"))!;
    const d = JSON.parse(localStorage.getItem(key)!);
    d.restUntil = Date.now() + 1200;
    localStorage.setItem(key, JSON.stringify(d));
  });
  await page.reload();
  await page
    .getByRole("button", { name: "Продолжить тренировку", exact: true })
    .click();
  await expect(page.locator('.sr-only[role="status"]')).toHaveText(
    "Отдых завершён",
  );
});

test("mobile layout, detailed muscle sources and 200% text stay usable", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "Посмотреть пример", exact: true }).click();
  await expect(page.getByText("Пример данных", { exact: true })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false);
  await page.screenshot({ path: "artifacts/mobile-v2.png", fullPage: true });
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Упражнения", exact: true })
    .click();
  await page.getByLabel("Поиск упражнений").fill("Махи гантелями");
  await page
    .getByRole("button", { name: "Техника и мышцы", exact: true })
    .click();
  await expect(
    page.getByText("Средняя дельтовидная", { exact: true }),
  ).toBeVisible();
  await page.getByText("Источники и границы данных", { exact: true }).click();
  await expect(
    page.getByRole("link", {
      name: "OpenStax Anatomy and Physiology 2e, 11.5",
    }),
  ).toHaveAttribute("href", /openstax/);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false);
  await page.getByRole("button", { name: "Закрыть окно", exact: true }).click();
  await page.setViewportSize({ width: 1440, height: 1080 });
  await page.evaluate(() => (document.documentElement.style.fontSize = "200%"));
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false);
  expect(errors).toEqual([]);
});

test("anatomy atlas supports mouse, keyboard, mobile and enlarged text", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Прогресс", exact: true })
    .click();
  await page.getByRole("tab", { name: "Карта мышц", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Анатомия движения", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".anatomy-canvas svg .atlas-muscle")).toHaveCount(
    35,
  );
  const chest = page.getByRole("button", { name: /^Грудные: / });
  await chest.locator("path").first().click();
  await expect(page.locator(".anatomy-selection h2")).toHaveText("Грудные");
  const back = page.getByRole("button", { name: /^Широчайшие и верх спины: / });
  await back.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".anatomy-selection h2")).toHaveText(
    "Широчайшие и верх спины",
  );
  await page.getByRole("button", { name: "Спереди", exact: true }).click();
  await expect(page.locator(".body-figure")).toHaveCount(1);
  await page.getByRole("button", { name: "Оба вида", exact: true }).click();
  await page.evaluate(() => document.fonts.ready);
  expect(
    await page.evaluate(() =>
      document.fonts.check('16px "Manrope Variable"', "Тяга"),
    ),
  ).toBe(true);
  await page.screenshot({ path: "artifacts/anatomy-v3.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "artifacts/anatomy-mobile-v3.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false);
  await page.setViewportSize({ width: 1440, height: 1080 });
  await page.evaluate(() => (document.documentElement.style.fontSize = "200%"));
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false);
  expect(errors).toEqual([]);
});

test("wger browse, attribution and recording survive reload and edit", async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Упражнения", exact: true })
    .click();
  await page
    .locator(".catalog-tabs")
    .getByRole("button", { name: /База/ })
    .click();
  await page.getByLabel("Поиск упражнений").fill("bench");
  await expect(page.locator(".library-card").first()).toBeVisible({
    timeout: 30000,
  });
  await expect(page.locator(".catalog-loading")).toHaveCount(0);
  await page.screenshot({ path: "artifacts/wger-v3.png", fullPage: true });
  const card = page
    .locator(".library-card")
    .filter({ has: page.locator(".library-add:not([disabled])") })
    .first();
  const name = (await card.locator("h3").textContent())!;
  await card
    .getByRole("button", { name: "Техника и мышцы", exact: true })
    .click();
  await page.getByText("Источник и лицензии", { exact: true }).click();
  await expect(page.locator(".wger-attribution a").first()).toHaveAttribute(
    "href",
    /wger/,
  );
  await page.screenshot({
    path: "artifacts/wger-detail-v3.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Добавить в тренировку", exact: true })
    .click();
  await page
    .getByLabel("Название тренировки", { exact: true })
    .fill("[E2E] wger");
  await page.getByLabel(`${name}, подход 1, вес`, { exact: true }).fill("25");
  await page
    .getByRole("button", {
      name: `Отметить выполненным: ${name}, подход 1`,
      exact: true,
    })
    .click();
  await page
    .getByRole("button", { name: "Завершить тренировку", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "История тренировок", exact: true }),
  ).toBeVisible();
  const saved = (await (await request.get("/api/data")).json()).workouts.find(
    (w: any) => w.name === "[E2E] wger",
  );
  expect(saved.exercises[0].catalogRevision).toBe(3);
  expect(saved.exercises[0].externalDefinition.source.provider).toBe("wger");
  await page.reload();
  await history(page);
  await page.locator(".session-item").filter({ hasText: "[E2E] wger" }).click();
  await page
    .getByRole("button", { name: "Редактировать", exact: true })
    .click();
  await expect(
    page.getByLabel(`${name}, подход 1, вес`, { exact: true }),
  ).toHaveValue("25");
  await page.getByLabel(`${name}, подход 1, вес`, { exact: true }).fill("30");
  await page
    .getByRole("button", { name: "Сохранить изменения", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "История тренировок", exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("programs save to the account, schedule a week and propose safe double progression", async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Программы", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Создать программу", exact: true })
    .click();
  await page
    .getByLabel("Название программы", { exact: true })
    .fill("[E2E] Программа");
  await page.getByRole("button", { name: "Пн", exact: true }).click();
  await page.getByRole("button", { name: "Ср", exact: true }).click();
  await choose(page, "Правило прогрессии", "Двойная прогрессия");
  await page
    .getByRole("button", {
      name: "Добавить упражнение в программу",
      exact: true,
    })
    .click();
  await page
    .getByRole("button", { name: "Добавить Жим штанги лёжа", exact: true })
    .click();
  await page.getByRole("button", { name: "Готово", exact: true }).click();
  await page.getByLabel("Повторы", { exact: true }).fill("12");
  await page.getByLabel("Начальный вес, кг", { exact: true }).fill("50");
  await page
    .getByRole("button", { name: "Сохранить программу", exact: true })
    .click();
  await expect(
    page.locator(".routine-card").filter({ hasText: "[E2E] Программа" }),
  ).toBeVisible();
  await page.reload();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Программы", exact: true })
    .click();
  await expect(
    page.locator(".day-session").filter({ hasText: "[E2E] Программа" }),
  ).toHaveCount(2);
  await page.screenshot({
    path: "artifacts/programs-v1.3.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "artifacts/programs-mobile-v1.3.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false);
  await page.setViewportSize({ width: 1440, height: 1080 });
  await page
    .locator(".routine-card")
    .filter({ hasText: "[E2E] Программа" })
    .getByRole("button", { name: "Начать", exact: true })
    .click();
  for (let i = 1; i <= 3; i++)
    await page
      .getByRole("button", {
        name: `Отметить выполненным: Жим штанги лёжа, подход ${i}`,
        exact: true,
      })
      .click();
  await page
    .getByRole("button", { name: "Завершить тренировку", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "История тренировок", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Программы", exact: true })
    .click();
  await page
    .locator(".routine-card")
    .filter({ hasText: "[E2E] Программа" })
    .getByRole("button", { name: "Начать", exact: true })
    .click();
  await expect(
    page.getByLabel("Жим штанги лёжа, подход 1, вес", { exact: true }),
  ).toHaveValue("52.5");
  await expect(
    page.getByLabel("Жим штанги лёжа, подход 1, повторы", { exact: true }),
  ).toHaveValue("8");
  await expect(page.locator(".progression-note")).toContainText("+2.5 кг");
  expect(errors).toEqual([]);
});

test("personal timed exercises, aliases and favorites survive reload and history edit", async ({
  page,
  request,
}) => {
  await page.goto("/");
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Упражнения", exact: true })
    .click();
  await page
    .locator(".catalog-tabs")
    .getByRole("button", { name: /Мои/ })
    .click();
  await page
    .getByRole("button", { name: "Создать упражнение", exact: true })
    .click();
  await page
    .getByLabel("Название упражнения", { exact: true })
    .fill("[E2E] Боковая планка");
  await page
    .getByLabel("Алиасы — через точку с запятой")
    .fill("Моя планка; side bridge");
  await choose(page, "Что записываем", "Время в секундах");
  await choose(page, "Что означает введённый вес", "Без внешнего веса");
  await page
    .getByRole("button", { name: "Сохранить упражнение", exact: true })
    .click();
  await page.getByLabel("Поиск упражнений").fill("side bridge");
  const card = page
    .locator(".library-card")
    .filter({ hasText: "[E2E] Боковая планка" });
  await expect(card).toBeVisible();
  await card
    .getByRole("button", {
      name: "В избранное: [E2E] Боковая планка",
      exact: true,
    })
    .click();
  await expect(
    card.getByRole("button", {
      name: "Убрать из избранного: [E2E] Боковая планка",
      exact: true,
    }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.reload();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Упражнения", exact: true })
    .click();
  await page
    .locator(".catalog-tabs")
    .getByRole("button", { name: /Избранное/ })
    .click();
  await page
    .getByRole("button", { name: "Добавить [E2E] Боковая планка", exact: true })
    .click();
  await page
    .getByLabel("Название тренировки", { exact: true })
    .fill("[E2E] Статика");
  await page
    .getByLabel("[E2E] Боковая планка, подход 1, секунды", { exact: true })
    .fill("45");
  await page
    .getByRole("button", {
      name: "Отметить выполненным: [E2E] Боковая планка, подход 1",
      exact: true,
    })
    .click();
  await page
    .getByRole("button", { name: "Завершить тренировку", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "История тренировок", exact: true }),
  ).toBeVisible();
  await page.reload();
  await history(page);
  await page
    .locator(".session-item")
    .filter({ hasText: "[E2E] Статика" })
    .click();
  await expect(page.locator(".detail-sets")).toContainText("45 с");
  await page
    .getByRole("button", { name: "Редактировать", exact: true })
    .click();
  await expect(
    page.getByLabel("[E2E] Боковая планка, подход 1, секунды", { exact: true }),
  ).toHaveValue("45");
  await page
    .getByLabel("[E2E] Боковая планка, подход 1, секунды", { exact: true })
    .fill("60");
  await page
    .getByRole("button", { name: "Сохранить изменения", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "История тренировок", exact: true }),
  ).toBeVisible();
  const product = await (await request.get("/api/product")).json();
  expect(product.favorites.length).toBeGreaterThan(0);
});

test("CSV import offers a Russian preview, saves literal weights and skips duplicate uploads", async ({
  page,
  request,
}) => {
  await page.goto("/");
  await history(page);
  const csv =
    "Date,Workout Name,Duration,Exercise Name,Set Order,Weight,Reps,Seconds,RPE\n2026-10-06 18:00:00,[E2E] CSV,45m,Bench Press,1,60,8,0,8\n2026-10-06 18:00:00,[E2E] CSV,45m,Bench Press,2,60,8,0,\n";
  async function upload() {
    await page
      .getByRole("button", { name: "Импорт истории", exact: true })
      .click();
    await page.getByLabel("Файл истории тренировок").setInputFiles({
      name: "strong.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(csv),
    });
    await page
      .getByRole("button", { name: "Показать предпросмотр", exact: true })
      .click();
    await expect(page.locator(".import-summary")).toContainText("1");
    await page
      .getByText("Сопоставления упражнений · 1", { exact: true })
      .click();
    await expect(page.locator(".import-mapping-row .select-trigger")).toHaveAttribute(
      "data-value",
      "bench",
    );
    await page.screenshot({
      path: "artifacts/import-v1.3.png",
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "Импортировать", exact: true })
      .click();
    await expect(
      page.getByRole("dialog", { name: "Импорт истории", exact: true }),
    ).toHaveCount(0);
  }
  await upload();
  let data = await (await request.get("/api/data")).json();
  let imported = data.workouts.filter((w: any) => w.name === "[E2E] CSV");
  expect(imported).toHaveLength(1);
  expect(imported[0].exercises[0].displayNameSnapshot).toBe("Жим штанги лёжа");
  expect(imported[0].exercises[0].externalDefinition.recording.loadMode).toBe(
    "legacy_unspecified",
  );
  expect(imported[0].exercises[0].sets[0].weight).toBe(60);
  expect(imported[0].exercises[0].sets[1].rir).toBeNull();
  await upload();
  data = await (await request.get("/api/data")).json();
  expect(data.workouts.filter((w: any) => w.name === "[E2E] CSV")).toHaveLength(
    1,
  );
  await expect(page.locator(".toast")).toContainText(
    "добавлено 0, пропущено 1",
  );
});

test("first-session warmups and Apple Health XML/ZIP summaries persist without uploading the health export",async({page,request})=> {
  const errors:string[]=[]; page.on("pageerror",e=>errors.push(e.message));
  await startBench(page,"[E2E] Разминка и часы");
  await page.getByLabel("Жим штанги лёжа, подход 1, вес",{exact:true}).fill("50");
  await page.getByLabel("Жим штанги лёжа, подход 1, повторы",{exact:true}).fill("8");
  await page.getByRole("button",{name:"Добавить 3 разминочных",exact:true}).click();
  for(let i=1;i<=3;i++) {
    await expect(page.getByLabel(`Жим штанги лёжа, подход ${i}, вес`,{exact:true})).toHaveValue(String([20,30,40][i-1]));
    await page.getByRole("button",{name:`Отметить выполненным: Жим штанги лёжа, подход ${i}`,exact:true}).click();
  }
  await page.getByRole("button",{name:"Завершить тренировку",exact:true}).click();
  await expect(page.getByRole("region",{name:"Итоги тренировки"})).toContainText("830 кг");
  await expect(page.getByRole("region",{name:"Итоги тренировки"})).toContainText("Разминка: 430 кг");
  await page.locator(".session-item").filter({hasText:"[E2E] Разминка и часы"}).click();
  await page.getByText("Импорт из Apple Health",{exact:true}).click();
  const original=(await (await request.get("/api/data")).json()).workouts.find((w:any)=>w.name==="[E2E] Разминка и часы");
  const date=original.date;
  const xml=`<?xml version="1.0"?><HealthData><Record type="HKQuantityTypeIdentifierHeartRate" sourceName="E2E Watch" startDate="${date} 18:00:00 +0000" endDate="${date} 18:00:00 +0000" unit="count/min" value="110"/><Record type="HKQuantityTypeIdentifierHeartRate" sourceName="E2E Watch" startDate="${date} 18:10:00 +0000" endDate="${date} 18:10:00 +0000" unit="count/min" value="130"/><Workout workoutActivityType="HKWorkoutActivityTypeTraditionalStrengthTraining" sourceName="E2E Watch" startDate="${date} 18:00:00 +0000" endDate="${date} 19:00:00 +0000" duration="60" durationUnit="min"><WorkoutStatistics type="HKQuantityTypeIdentifierActiveEnergyBurned" unit="kcal" sum="220"/></Workout></HealthData>`;
  const bodies:string[]=[]; page.on("request",r=>{if(r.url().includes("/api/") && r.postData()) bodies.push(r.postData()!);});
  await page.locator('.watch-import input[type="file"]').setInputFiles({name:"export.xml",mimeType:"application/xml",buffer:Buffer.from(xml)});
  await expect(page.locator(".health-candidate")).toContainText("220 ккал");
  await page.locator(".health-candidate").click();
  await expect(page.locator(".watch-metrics")).toContainText("120");
  await page.reload(); await history(page); await page.locator(".session-item").filter({hasText:"[E2E] Разминка и часы"}).click();
  await expect(page.locator(".watch-metrics")).toContainText("220");
  await page.getByText("Заменить данные из Apple Health",{exact:true}).click();
  const archive=zipSync({"apple_health_export/export.xml":strToU8(xml.replace('sum="220"','sum="240"')),"ignored/medical.txt":strToU8("PRIVATE-UNRELATED-DATA")});
  await page.locator('.watch-import input[type="file"]').setInputFiles({name:"export.zip",mimeType:"application/zip",buffer:Buffer.from(archive)});
  await expect(page.locator(".health-candidate")).toContainText("240 ккал"); await page.locator(".health-candidate").click();
  await expect(page.locator(".watch-metrics")).toContainText("240");
  const saved=(await (await request.get("/api/data")).json()).workouts.find((w:any)=>w.id===original.id);
  expect(saved.wearable.heartRateAverage).toBe(120); expect(saved.wearable.caloriesKcal).toBe(240); expect(saved.wearable.heartRateSamples).toBe(2);
  expect(saved.duration).toBe(original.duration); expect(saved.exercises[0].sets.filter((s:any)=>s.done && s.warmup)).toHaveLength(3);
  expect(bodies.every(b=>!b.includes("<Record") && !b.includes("PRIVATE-UNRELATED-DATA"))).toBeTruthy();
  await page.screenshot({path:"artifacts/session-watch-v4.png",fullPage:true}); expect(errors).toEqual([]);
});
