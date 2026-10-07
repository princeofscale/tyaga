import {
  test,
  expect,
  type Page,
  type APIRequestContext,
} from "@playwright/test";
const BASE = "http://localhost:5173";
const headers = { Origin: BASE };
async function cleanup(request: APIRequestContext) {
  const data = await (await request.get("/api/data")).json();
  for (const w of data.workouts)
    if (w.name.startsWith("[E2E]"))
      await request.delete("/api/workouts/" + w.id, {
        headers,
        data: { revision: w.revision },
      });
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
test.beforeEach(async ({ request }) => {
  await cleanup(request);
});
test.afterEach(async ({ request }) => {
  await cleanup(request);
});

test("save/reload/edit/export/settings/repeat preserve the actual workout and timers", async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(page.getByText("Пример данных", { exact: true })).toBeVisible();
  await page.screenshot({ path: "artifacts/desktop-v2.png", fullPage: true });
  await page.getByRole("button", { name: "Собрать тренировку" }).click();
  await page.getByRole("button", { name: "20 мин", exact: true }).click();
  await expect(page.locator(".plan-item")).not.toHaveCount(0);
  expect(await page.locator(".plan-item").count()).toBeLessThanOrEqual(2);
  await page.screenshot({ path: "artifacts/planner-v2.png", fullPage: true });
  await page.getByRole("button", { name: "Закрыть окно", exact: true }).click();
  await startBench(page, "[E2E] Журнал");
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
  expect(exported.version).toBe(2);
  expect(
    exported.workouts.some((w: { id: string }) => w.id.startsWith("demo-")),
  ).toBe(false);
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
  await expect(page.getByLabel("Выполненные стороны")).toHaveValue("both");
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
    const d = JSON.parse(localStorage.getItem("tyaga-draft-v1")!);
    d.restUntil = Date.now() + 1200;
    localStorage.setItem("tyaga-draft-v1", JSON.stringify(d));
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
  await expect(page.getByText("Пример данных", { exact: true })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false);
  await page.screenshot({ path: "artifacts/mobile-v2.png", fullPage: true });
  await page.getByRole("button", { name: "Открыть меню", exact: true }).click();
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
