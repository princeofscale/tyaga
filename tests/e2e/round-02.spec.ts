import { test, expect, type Page } from "@playwright/test";
import { doneWorkout, mark, nav, round01Fixture, startWith } from "./fixtures/round01";
import { makeWorkout } from "../../src/lib/model";
import type { Routine } from "../../src/lib/types";

/**
 * Раунд 2: R02-REQ01…REQ10 на телефоне, приложение на подставных ответах (ни один запрос не идёт на воркер).
 * «Сегодня» в фикстуре — вторник 10 ноября 2026 (день программы 1; 0 = понедельник).
 */
test.use({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
  locale: "ru-RU",
  timezoneId: "Europe/Saratov",
});

const BENCH = "Жим штанги лёжа";
const SQUAT = "Приседания со штангой";
const rir = (page: Page, n: number, name = BENCH) => page.getByLabel(`${name}, подход ${n}, RIR`, { exact: true });
const check = (page: Page, n: number, name = BENCH) =>
  page.getByRole("button", { name: `Отметить выполненным: ${name}, подход ${n}`, exact: true });

function routine(name: string, days: number[], ids: string[], weight = 0): Routine {
  const w = makeWorkout(ids);
  w.exercises.forEach((e) => e.sets.forEach((s) => (s.weight = weight)));
  return {
    id: `r-${name}`,
    name,
    notes: "",
    days,
    exercises: w.exercises,
    restSeconds: 90,
    progression: "repeat",
    repMin: 8,
    repMax: 12,
    incrementKg: 2.5,
    revision: 1,
  };
}

// Файл в формате Strong с теми же шестью упражнениями, что в тестовом файле владельца продукта.
const STRONG = (() => {
  const rows = ["Date,Workout Name,Duration,Exercise Name,Set Order,Weight,Reps,Distance,Seconds,Notes,Workout Notes,RPE"];
  const plan: [string, string, string, number, number[]][] = [
    ["2026-09-21 18:30:00", "Грудь/Плечи", "Bench Press (Barbell)", 60, [8, 8, 7]],
    ["2026-09-21 18:30:00", "Грудь/Плечи", "Overhead Press (Barbell)", 40, [8, 8, 7]],
    ["2026-09-23 18:30:00", "Ноги", "Squat (Barbell)", 80, [8, 8, 7]],
    ["2026-09-23 18:30:00", "Ноги", "Romanian Deadlift (Barbell)", 70, [8, 8, 7]],
    ["2026-09-25 18:30:00", "Тяга", "Deadlift (Barbell)", 100, [8, 8, 7]],
    ["2026-09-25 18:30:00", "Тяга", "Bent Over Row (Barbell)", 60, [8, 8, 7]],
    ["2026-09-28 18:30:00", "Грудь/Плечи", "Bench Press (Barbell)", 77.5, [8, 8, 7]],
  ];
  for (const [date, name, exercise, weight, reps] of plan)
    reps.forEach((r, i) => rows.push(`${date},${name},1h 5m,${exercise},${i + 1},${weight},${r},0,0,,,8`));
  return rows.join("\n");
})();

async function importStrong(page: Page) {
  await nav(page, "История").click();
  await page.getByRole("button", { name: "Импорт истории", exact: true }).click();
  await page
    .getByLabel("Файл истории тренировок")
    .setInputFiles({ name: "strong.csv", mimeType: "text/csv", buffer: Buffer.from(STRONG) });
  await page.getByRole("button", { name: "Показать предпросмотр", exact: true }).click();
}

test("R02-REQ05: упражнение без выполненных подходов не мешает «Завершить» и не сохраняется", async ({ page }) => {
  const f = await round01Fixture(page);
  await startWith(page, BENCH, SQUAT);
  await mark(page, 1);
  await page.getByRole("button", { name: "Завершить тренировку", exact: true }).click();
  await expect(page.locator(".toast")).toContainText("Тренировка сохранена");
  await expect.poll(() => f.savedBodies.length).toBe(1);
  expect(f.savedBodies[0].exercises.map((e) => e.exerciseId)).toEqual(["bench"]);
  expect(f.errors).toEqual([]);
});

test("R02-REQ09: новый подход наследует RIR предыдущего", async ({ page }) => {
  await round01Fixture(page);
  await startWith(page, BENCH);
  await rir(page, 3).fill("1");
  await page.getByRole("button", { name: /^Подход$|Добавить подход/ }).first().click();
  await expect(rir(page, 4)).toHaveValue("1");
});

test("R02-REQ10: в день отдыха на «Сегодня» — «Следующая: <день> · <программа>»", async ({ page }) => {
  await round01Fixture(page, { routines: [routine("Низ тела", [3], ["squat", "rdl"])] });
  await expect(page.locator(".plan-next")).toContainText("Следующая: Чт · Низ тела");
  await page.locator(".plan-next").click();
  await expect(page.getByRole("heading", { name: "Программы" })).toBeVisible();
});

test("R02-REQ07: редактор — крупные кнопки, «Убрать» с «Отменить», поля в одну строку, ≤2500 px", async ({ page }) => {
  const six = ["bench", "squat", "rdl", "ohp", "lateral", "curl"];
  await round01Fixture(page, { routines: [routine("Верх тела", [3], six, 50)] });
  await nav(page, "Программы").click();
  await page.getByRole("button", { name: "Редактировать программу Верх тела" }).click();
  const dialog = page.getByRole("dialog");
  const cards = dialog.locator(".routine-editor-exercise");
  await expect(cards).toHaveCount(6);
  // Кнопки порядка и корзина — не меньше 44×44 и с зазором.
  const first = cards.nth(1);
  const boxes = await first.locator(".routine-order-controls > button").evaluateAll((bs) =>
    bs.map((b) => {
      const r = b.getBoundingClientRect();
      return { w: r.width, h: r.height, x: r.x, right: r.right };
    }),
  );
  expect(boxes).toHaveLength(3);
  for (const b of boxes) {
    expect(b.w).toBeGreaterThanOrEqual(44);
    expect(b.h).toBeGreaterThanOrEqual(44);
  }
  expect(boxes[1].x - boxes[0].right).toBeGreaterThanOrEqual(6);
  expect(boxes[2].x - boxes[1].right).toBeGreaterThanOrEqual(6);
  // «Подходы / Повторы / Вес» в одну строку.
  const tops = await first.locator(".routine-fields input").evaluateAll((is) => is.map((i) => Math.round(i.getBoundingClientRect().top)));
  expect(tops).toHaveLength(3);
  expect(new Set(tops).size).toBe(1);
  // «от/до» и тренажёр под «Ещё».
  await expect(first.getByLabel("Повторы от")).toBeHidden();
  await first.getByText("Ещё", { exact: true }).click();
  await expect(first.getByLabel("Повторы от")).toBeVisible();
  // Высота всего редактора из шести упражнений.
  const height = await dialog.evaluate((d) => {
    const scroller = [d, ...d.querySelectorAll<HTMLElement>("*")].reduce((a, b) => (b.scrollHeight > a.scrollHeight ? b : a));
    return scroller.scrollHeight;
  });
  await first.getByText("Ещё", { exact: true }).click();
  expect(height).toBeLessThanOrEqual(2500);
  // Убрать — и вернуть.
  await cards.nth(2).getByRole("button", { name: /Убрать из программы/ }).click();
  await expect(cards).toHaveCount(5);
  const undo = dialog.getByRole("status").filter({ hasText: "Упражнение убрано" });
  await expect(undo).toBeVisible();
  await undo.getByRole("button", { name: "Отменить", exact: true }).click();
  await expect(cards).toHaveCount(6);
  await expect(cards.nth(2).locator("h3")).toHaveText("Румынская тяга со штангой");
});

test("R02-REQ07: цифры подписаны — «по плану» и «вес из истории» на карточке и в «Сегодня»", async ({ page }) => {
  const history = [doneWorkout("Грудь", "2026-11-09", [["bench", 77.5, 8, 3]])];
  await round01Fixture(page, {
    workouts: history,
    routines: [routine("Верх тела", [1], ["bench", "squat"], 50)],
  });
  await expect(page.locator(".plan-exercises .plan-source").first()).toHaveText("вес из истории");
  await expect(page.locator(".plan-exercises .plan-source").nth(1)).toHaveText("по плану");
  await nav(page, "Программы").click();
  await expect(page.locator(".routine-card").first()).toContainText("веса: 1 из истории, 1 по плану");
});

test("R02-REQ06: «Сила» — только то, что делал, последнее тренированное первым", async ({ page }) => {
  const history = [
    doneWorkout("Ноги", "2026-11-09", [["squat", 100, 5, 3]]),
    doneWorkout("Грудь", "2026-11-03", [["bench", 80, 8, 3]]),
  ];
  await round01Fixture(page, { workouts: history });
  await nav(page, "Прогресс").click();
  await page.getByRole("tab", { name: "Сила", exact: true }).click();
  const trigger = page.getByRole("button", { name: "Упражнение", exact: true });
  await expect(trigger).toBeVisible();
  await trigger.click();
  const options = page.getByRole("listbox").getByRole("option");
  await expect(options).toHaveCount(2);
  await expect(options.first()).toContainText(SQUAT);
  await expect(options.nth(1)).toContainText(BENCH);
});

test("R02-REQ03: без считаемого веса тоннаж — «—» с пояснением, а не «0 т»", async ({ page }) => {
  // Жим ногами в тренажёре: вес стека в тоннаж свободных весов не входит.
  const w = doneWorkout("Ноги на тренажёрах", "2026-11-10", [["legpress", 120, 10, 3]]);
  w.exercises[0].equipmentNote = "Окно";
  await round01Fixture(page, { workouts: [w] });
  await expect(page.locator(".weekly-activity-bar")).not.toContainText(/(^|\s)0\s?т/);
  await expect(page.locator(".weekly-activity-bar .stat-badge").nth(1)).toContainText("—");
  await nav(page, "История").click();
  const row = page.locator(".session-item").first();
  await expect(row.locator(".session-item-value b")).toHaveText("—");
  await expect(row).toContainText("тоннаж не считается");
  await expect(page.locator("body")).not.toContainText(/(^|\s)0 т(\s|$)/);
});

test("R02-REQ01/02/03: импорт Strong «как моя» — вопрос про вес, русские названия, тоннаж, «Сила», отмена", async ({ page }) => {
  const f = await round01Fixture(page);
  await importStrong(page);
  const dialog = page.getByRole("dialog");
  // Один понятный вопрос вместо флажка про «правила веса».
  await expect(dialog.getByText("Вес в файле — это общий вес штанги с грифом?")).toBeVisible();
  await expect(dialog.getByRole("radio").first()).toBeChecked();
  await expect(dialog.getByText("Применить правила веса")).toHaveCount(0);
  // Русские названия видны сразу, без раскрытия.
  const recognized = dialog.getByLabel("Что распознано");
  for (const ru of [BENCH, SQUAT, "Румынская тяга со штангой", "Становая тяга со штангой", "Тяга штанги в наклоне", "Жим штанги стоя"])
    await expect(recognized).toContainText(ru);
  await dialog.getByRole("button", { name: "Импортировать", exact: true }).click();
  // Попали в «Историю»; баннер с отменой; у тренировок есть тоннаж.
  await expect(page.getByRole("heading", { name: "История тренировок" })).toBeVisible();
  const banner = page.locator(".import-undo");
  await expect(banner).toContainText("Импорт: записано 4 из 4");
  const rows = page.locator(".session-item");
  await expect(rows).toHaveCount(4);
  for (const text of await rows.locator(".session-item-value b").allTextContents()) expect(text).not.toBe("—");
  await expect(page.locator("body")).not.toContainText(/(^|\s)0 т(\s|$)/);
  // «Сила»: шесть упражнений — шесть рядов, жим один.
  await nav(page, "Прогресс").click();
  await page.getByRole("tab", { name: "Сила", exact: true }).click();
  await page.getByRole("button", { name: "Упражнение", exact: true }).click();
  const options = page.getByRole("listbox").getByRole("option");
  await expect(options).toHaveCount(6);
  expect(await options.filter({ hasText: BENCH }).count()).toBe(1);
  await page.keyboard.press("Escape");
  // Отмена импорта — два касания (+ подтверждение), всё убрано.
  await nav(page, "История").click();
  await banner.getByRole("button", { name: "Отменить импорт", exact: true }).click();
  await banner.getByRole("button", { name: /^Убрать/ }).click();
  await expect(page.locator(".toast")).toContainText("Убрал 4 тренировки этого импорта");
  await expect(page.locator(".session-item")).toHaveCount(0);
  expect(f.deleted).toHaveLength(4);
  expect(f.errors).toEqual([]);
});

test("QA-R02-04: после «Отменить импорт» тот же файл импортируется снова новой операцией", async ({ page }) => {
  const f = await round01Fixture(page);
  const banner = page.locator(".import-undo");
  await importStrong(page);
  await page.getByRole("dialog").getByRole("button", { name: "Импортировать", exact: true }).click();
  await expect(banner).toContainText("Импорт: записано 4 из 4");
  await banner.getByRole("button", { name: "Отменить импорт", exact: true }).click();
  await banner.getByRole("button", { name: /^Убрать/ }).click();
  await expect(page.locator(".toast")).toContainText("Убрал 4 тренировки этого импорта");
  await expect(page.locator(".session-item")).toHaveCount(0);
  await importStrong(page);
  await page.getByRole("dialog").getByRole("button", { name: "Импортировать", exact: true }).click();
  await expect(page.locator(".toast")).toContainText("Импорт завершён: добавлено 4");
  await expect(page.locator(".session-item")).toHaveCount(4);
  await expect(page.getByText("Этот импорт уже отменён")).toHaveCount(0);
  const runIds = new Set(f.importBodies.filter((b) => !b.dryRun).map((b) => b.runId));
  expect(runIds.size, "вторая операция — с новым runId").toBe(2);
});

test("QA-R02-04: ключ отменённого run остался в браузере — клиент сам заводит новый, тупика нет", async ({ page }) => {
  const f = await round01Fixture(page);
  await importStrong(page);
  await page.getByRole("dialog").getByRole("button", { name: "Импортировать", exact: true }).click();
  await expect(page.locator(".import-undo")).toContainText("Импорт: записано 4 из 4");
  const first = f.importBodies.find((b) => !b.dryRun)!;
  // Отмена прошла на сервере, а клиент об этом не узнал: ключ того же файла остался в localStorage.
  await page.evaluate(async ({ runId, key }) => {
    await fetch("/api/import/undo", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ runId }) });
    localStorage.setItem(key, runId);
  }, { runId: first.runId as string, key: `tyaga-import-run:${first.manifestHash}` });
  await page.reload();
  await importStrong(page);
  await page.getByRole("dialog").getByRole("button", { name: "Импортировать", exact: true }).click();
  await expect(page.locator(".toast")).toContainText("Импорт завершён: добавлено 4");
  await expect(page.locator(".session-item")).toHaveCount(4);
  const sent = f.importBodies.filter((b) => !b.dryRun).map((b) => b.runId);
  expect(sent[0]).toBe(first.runId);
  expect(sent.at(-1)).not.toBe(first.runId);
});

test("N-1: записанный импорт и незавершённый черновик видны вместе, «Убрать черновик» трогает только черновик", async ({ page }) => {
  const f = await round01Fixture(page, { pendingImports: [{ runId: "draft-1", total: 21 }] });
  await importStrong(page);
  await page.getByRole("dialog").getByRole("button", { name: "Импортировать", exact: true }).click();
  await expect(page.locator(".session-item")).toHaveCount(4);
  const banners = page.locator(".import-undo");
  await expect(banners).toHaveCount(2);
  await expect(banners.filter({ hasText: "Импорт не завершён" })).toContainText("21 тренировок ещё не записаны");
  await expect(banners.filter({ hasText: "Импорт: записано 4 из 4" })).toBeVisible();
  await banners.filter({ hasText: "Импорт не завершён" }).getByRole("button", { name: "Убрать черновик", exact: true }).click();
  await expect(banners).toHaveCount(1);
  await expect(banners.first()).toContainText("Импорт: записано 4 из 4");
  await expect(page.locator(".session-item")).toHaveCount(4);
  expect(f.pending).toHaveLength(0);
  expect(f.deleted, "записанные тренировки не тронуты").toHaveLength(0);
});

test("N-5: в «Прогресс → Обзор» без считаемого тоннажа подпись читается прямо", async ({ page }) => {
  const w = doneWorkout("Ноги на тренажёрах", "2026-11-10", [["legpress", 120, 10, 3]]);
  w.exercises[0].equipmentNote = "Окно";
  await round01Fixture(page, { workouts: [w] });
  await nav(page, "Прогресс").click();
  const card = page.locator(".progress-overview, main").getByText("Тоннаж: —").first();
  await expect(card).toContainText("3 подх. без правила веса");
  await expect(page.locator("body")).not.toContainText("— Тоннаж не считается");
  await expect(page.locator("body")).not.toContainText(/(^|\s)0 т(\s|$)/);
});

test("R02-REQ01: ответ «Нет» оставляет числа буквально — упражнения не подставляются как свои", async ({ page }) => {
  const f = await round01Fixture(page);
  await importStrong(page);
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("radio").nth(1).check();
  await expect(dialog.getByLabel("Что распознано")).toContainText("отдельная запись, вес буквально");
  await expect(dialog.getByLabel("Что распознано")).not.toContainText(BENCH);
  // Одно упражнение можно сопоставить вручную — с поиском в списке.
  await dialog.getByText("Изменить сопоставления").click();
  await dialog.locator(".import-mapping-row").first().getByRole("button").first().click();
  await page.getByPlaceholder(/Найти|Поиск/).first().fill("bench");
  await expect(page.getByRole("option").filter({ hasText: BENCH })).toHaveCount(1);
  void f;
});

test("R02-REQ02: повторный импорт заменяет прежний, дублей нет", async ({ page }) => {
  const f = await round01Fixture(page);
  await importStrong(page);
  await page.getByRole("dialog").getByRole("button", { name: "Импортировать", exact: true }).click();
  await expect(page.locator(".session-item")).toHaveCount(4);
  await importStrong(page);
  await page.getByRole("dialog").getByRole("button", { name: "Импортировать", exact: true }).click();
  await expect(page.locator(".toast")).toContainText("заменено 4");
  await expect(page.locator(".session-item")).toHaveCount(4);
  expect(f.importBodies.filter((b) => !b.dryRun && b.replace)).toHaveLength(2);
});

/** Перезагрузка с ожиданием: файл каталога должен быть докачан сам, до всякого «Добавить упражнение». */
async function reloadAndWaitForCatalog(page: Page) {
  const loaded = page.waitForResponse((r) => /ExerciseLibrary-.*\.js/.test(r.url()) && r.ok());
  await page.reload();
  await loaded;
  // У файла каталога есть свои зависимости: ждём, пока докачается всё.
  await page.waitForLoadState("networkidle");
}

test("R02-REQ04: без сети каталог открывается — файл докачан заранее, консоль чистая", async ({ page, context }) => {
  const f = await round01Fixture(page);
  const logged: string[] = [];
  page.on("console", (m) => m.type() === "error" && logged.push(m.text()));
  await reloadAndWaitForCatalog(page);
  await context.setOffline(true);
  await page.getByRole("button", { name: "Начать тренировку", exact: true }).first().click();
  await page.getByRole("button", { name: "Добавить упражнение", exact: true }).click();
  await expect(page.getByRole("button", { name: `Добавить ${BENCH}`, exact: true })).toBeVisible();
  await expect(page.getByRole("alert").filter({ hasText: "Каталог не загрузился" })).toHaveCount(0);
  expect(f.errors).toEqual([]);
  expect(logged.filter((t) => /module|dynamically imported|Failed to fetch/i.test(t))).toEqual([]);
});

test("R02-REQ04: каталог не докачан и связи нет — «Каталог не загрузился. Нет связи. Повторить», потом открывается", async ({ page, context }) => {
  const f = await round01Fixture(page);
  let blocked = true;
  await page.route("**/assets/ExerciseLibrary-*.js", (route) => (blocked ? route.abort("internetdisconnected") : route.continue()));
  // Файл не пришёл ни при докачке, ни позже: перезагружаем страницу уже с обрывом.
  await page.reload();
  await expect(page.getByRole("heading", { name: "Сегодня", exact: true })).toBeVisible();
  await context.setOffline(true);
  await page.getByRole("button", { name: "Начать тренировку", exact: true }).first().click();
  await page.getByRole("button", { name: "Добавить упражнение", exact: true }).click();
  const failed = page.getByRole("alert").filter({ hasText: "Каталог не загрузился" });
  await expect(failed).toBeVisible();
  await expect(failed).toContainText("Нет связи");
  // Тренировка и навигация на месте: приложение не упало, чёрного экрана нет.
  await expect(page.locator(".workout-athletic")).toBeVisible();
  // Без связи «Повторить» остаётся на месте, страница не перезагружается.
  await failed.getByRole("button", { name: "Повторить", exact: true }).click();
  await expect(failed).toContainText("подключись к сети");
  await expect(page.locator(".workout-athletic")).toBeVisible();
  // Связь вернулась.
  blocked = false;
  await context.setOffline(false);
  // Браузер помнит неудачный import() до конца жизни страницы: повтор — это перезагрузка, черновик остаётся.
  const reloaded = page.waitForEvent("load");
  await failed.getByRole("button", { name: "Повторить", exact: true }).click();
  await reloaded;
  const add = page.getByRole("button", { name: "Добавить упражнение", exact: true });
  const bench = page.getByRole("button", { name: `Добавить ${BENCH}`, exact: true });
  // Страница перезагрузилась: черновик на месте, возвращаемся к нему.
  const resume = page.getByRole("button", { name: "Продолжить тренировку", exact: true }).first();
  await expect(add.or(bench).or(resume).first()).toBeVisible();
  if (await resume.isVisible()) await resume.click();
  if (!(await bench.isVisible())) await add.click();
  await expect(bench).toBeVisible();
  expect(f.errors).toEqual([]);
});
