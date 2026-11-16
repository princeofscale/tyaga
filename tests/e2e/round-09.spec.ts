import { test, expect, type Page } from "@playwright/test";
import { nav, round01Fixture, startWith, doneWorkout } from "./fixtures/round01";
import { liveMock, mockLive, roomWithPartner, type LiveMock } from "./fixtures/live";
import { smallTargets, smallInDialog, clipped } from "./fixtures/touch";
import type { Workout } from "../../src/lib/types";

/**
 * Раунд 9: R09-REQ01…REQ05 на телефоне (390×844, 360×800, 320×640), приложение на подставных ответах.
 * Сегодня в фикстуре — вторник 10 нояб. 2026.
 */
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, locale: "ru-RU", timezoneId: "Europe/Saratov" });

const BENCH = "Жим штанги лёжа";
const SIZES = [{ width: 390, height: 844 }, { width: 360, height: 800 }];
const SIZES3 = [...SIZES, { width: 320, height: 640 }];
const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

/** Подход: вес, повторы, ✓. */
async function lift(page: Page, n: number, kg: string, reps: string) {
  await page.getByLabel(`${BENCH}, подход ${n}, вес`, { exact: true }).fill(kg);
  await page.getByLabel(`${BENCH}, подход ${n}, повторы`, { exact: true }).fill(reps);
  await page.getByRole("button", { name: `Отметить выполненным: ${BENCH}, подход ${n}`, exact: true }).click();
}

/** Как воркер: «мой» участник в комнате получает то, что приложение выложило. `fail.left` — сколько отправок оборвать. */
async function liveWithMyState(page: Page, fail: { left: number; down?: boolean } = { left: 0 }): Promise<LiveMock> {
  const live = await mockLive(page, liveMock(roomWithPartner()));
  await page.route("**/api/friends/live/state", (route) => {
    if (fail.left > 0) {
      fail.left--;
      return route.abort("failed");
    }
    const state = route.request().postDataJSON();
    live.pushed.push(state);
    live.room!.members.find((m) => m.isMe)!.state = state;
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ room: live.room }) });
  });
  // «Без сети»: подставные ответы браузер выдаёт и при setOffline, поэтому обрыв связи с комнатой — здесь.
  await page.route("**/api/friends/live**", (route) => (fail.down ? route.abort("internetdisconnected") : route.fallback()));
  return live;
}

// ───────────── REQ01: правка сохранённой тренировки не меняет строку в комнате ─────────────
for (const size of SIZES) {
  test(`R09-REQ01: правка сохранённой тренировки в комнате — «Закончил» остаётся, 0 т не уходит, итог пересчитывается, шапки комнаты нет ${size.width}×${size.height}`, async ({ page }) => {
    test.setTimeout(150_000);
    await page.setViewportSize(size);
    await round01Fixture(page);
    const live = await liveWithMyState(page);
    await page.reload();
    await startWith(page, BENCH);
    await lift(page, 1, "80", "5");
    await lift(page, 2, "82.5", "11");
    await lift(page, 3, "82.5", "7");
    await page.getByRole("button", { name: "Завершить тренировку", exact: true }).click();
    await expect(page.getByRole("button", { name: "Завершить тренировку", exact: true })).toHaveCount(0);
    await expect.poll(() => live.pushed.at(-1)?.phase).toBe("done");
    expect(live.pushed.at(-1)!.tonnageKg).toBe(1885);
    await nav(page, "Друзья").click();
    await expect(page.locator("main")).toContainText("Закончил · 1,9 т");
    // правка: история → карточка → «Редактировать»
    await nav(page, "История").click();
    await page.locator(".session-item").first().click();
    await page.getByRole("button", { name: "Редактировать", exact: true }).click();
    // в экране правки комнаты нет: ни шапки, ни «Поделиться», ни «Выйти», ни строк напарников
    const edit = page.locator("main");
    await expect(page.getByRole("button", { name: "Сохранить изменения", exact: true })).toBeVisible();
    await expect(page.locator(".room-badge")).toHaveCount(0);
    await expect(page.locator(".live-strip, .live-member")).toHaveCount(0);
    const text = await edit.innerText();
    expect(text).not.toMatch(/Комната|Поделиться|Выйти|участник|Дмитрий|K7M2Q/);
    const before = live.pushed.length;
    await page.getByLabel(`${BENCH}, подход 1, вес`, { exact: true }).fill("90");
    await expect(page.locator(".hud-tonnage")).toContainText("1 935");
    // дольше задержки отправки и дольше проверки heartbeat: в комнату за время правки не уходит ничего
    await page.waitForTimeout(17_000);
    expect(live.pushed.slice(before), "во время правки в комнату ничего не уходило").toEqual([]);
    expect(live.pushed.some((s) => s.phase === "idle" && s.tonnageKg === 0)).toBe(false);
    expect(live.room!.members.find((m) => m.isMe)!.state).toMatchObject({ phase: "done", tonnageKg: 1885 });
    // «Сохранить»: итог пересчитан по правке
    await page.getByRole("button", { name: "Сохранить изменения", exact: true }).click();
    await expect.poll(() => live.pushed.length).toBe(before + 1);
    expect(live.pushed.at(-1)).toMatchObject({ phase: "done", tonnageKg: 1935 });
    await nav(page, "Друзья").click();
    await expect(page.locator("main")).toContainText("Закончил · 1,9 т");
    // новая тренировка в этой же комнате: «Готовится», потом подходы
    await nav(page, "Сегодня").click();
    await startWith(page, BENCH);
    await expect.poll(() => live.pushed.at(-1)?.phase).toBe("idle");
    expect(live.pushed.at(-1)!.tonnageKg).toBe(0);
    await lift(page, 1, "60", "8");
    await expect.poll(() => live.pushed.at(-1)?.phase).toMatch(/lifting|resting/);
    expect(await overflow(page)).toBeLessThanOrEqual(1);
  });
}

test("R09-REQ01: в строке участника тоннаж с запятой — «1,2 т», точки нет", async ({ page }) => {
  test.setTimeout(90_000);
  await round01Fixture(page);
  await liveWithMyState(page);
  await page.reload();
  await nav(page, "Друзья").click();
  const room = page.locator("main");
  await expect(room).toContainText("1,2 т");
  expect(await room.innerText()).not.toMatch(/\d\.\d\s*т/);
  // и в тренировке (полоска напарников над подходами)
  await nav(page, "Сегодня").click();
  await startWith(page, BENCH);
  expect(await page.locator("main").innerText()).not.toMatch(/\d\.\d\s*т/);
});

test("R09-REQ01: правка прошлой тренировки без комнаты — как раньше: «Изменения сохранены»", async ({ page }) => {
  test.setTimeout(90_000);
  await round01Fixture(page, { workouts: [doneWorkout("Грудь", "2026-11-03", [["bench", 60, 8, 3]])] });
  await nav(page, "История").click();
  await page.locator(".session-item").first().click();
  await page.getByRole("button", { name: "Редактировать", exact: true }).click();
  await expect(page.locator(".room-badge")).toHaveCount(0);
  await page.getByLabel(`${BENCH}, подход 1, вес`, { exact: true }).fill("62.5");
  await page.getByRole("button", { name: "Сохранить изменения", exact: true }).click();
  await expect(page.getByText("Изменения сохранены")).toBeVisible();
});

// ───────────── REQ02: чипы снаряда в «Заменить» ─────────────
const CHIP_WORDS = ["Гантели", "Штанга", "Блок / Кроссовер", "Тренажёр", "Свой вес"];
async function openSwap(page: Page) {
  await page.getByText("Ещё для упражнения", { exact: true }).first().click();
  await page.locator('button[title="Заменить упражнение на аналогичное"]').first().click();
  const dialog = page.getByRole("dialog", { name: "Заменить упражнение", exact: true });
  await expect(dialog).toBeVisible();
  return dialog;
}
/** Число из заголовка списка «(N)» и число показанных строк. */
async function shown(dialog: ReturnType<Page["getByRole"]>) {
  const headline = (await dialog.locator(".swap-section-headline").innerText()).replace(/\s+/g, " ");
  const n = Number(/\((\d+)\)/.exec(headline)![1]);
  return { n, rows: await dialog.locator(".swap-card-btn").count(), labels: await dialog.locator(".swap-card-btn .swap-equip-badge").allInnerTexts(), names: await dialog.locator(".swap-card-btn .swap-card-title").allInnerTexts() };
}

for (const size of SIZES) {
  test(`R09-REQ02: чипы снаряда в «Заменить» (жим лёжа) — в чипе ровно строки с этим снарядом, «(N)» = числу строк, сумма не меньше «Все» ${size.width}×${size.height}`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize(size);
    await round01Fixture(page);
    await startWith(page, BENCH);
    const dialog = await openSwap(page);
    const all = await shown(dialog);
    expect(all.n).toBe(10);
    expect(all.rows).toBe(10);
    const per: Record<string, Awaited<ReturnType<typeof shown>>> = {};
    for (const word of CHIP_WORDS) {
      await dialog.getByRole("button", { name: word, exact: true }).click();
      const s = await shown(dialog);
      per[word] = s;
      expect(s.rows, `«${word}»: число в заголовке = числу строк`).toBe(s.n);
      if (s.n === 0) await expect(dialog).toContainText("Нет подходящих альтернатив для выбранного инвентаря");
      for (const label of s.labels) expect(label === word || label === "Штанга / тренажёр", `«${word}»: у строки метка «${label}»`).toBe(true);
    }
    expect(per["Гантели"].n).toBeGreaterThanOrEqual(2);
    expect(per["Гантели"].names).toEqual(expect.arrayContaining(["Жим гантелей на наклонной 30°", "Жим гантелей лёжа на горизонтальной скамье"]));
    expect(per["Штанга"].names).toContain("Жим штанги на наклонной скамье 30°");
    expect(per["Свой вес"].names).toContain("Отжимания от пола");
    const cable = all.names.filter((_, i) => all.labels[i] === "Блок / Кроссовер");
    expect(per["Блок / Кроссовер"].names.sort()).toEqual(cable.sort());
    const sum = CHIP_WORDS.reduce((n, w) => n + per[w].n, 0);
    expect(sum, "сумма по чипам не меньше числа строк «Все снаряды»").toBeGreaterThanOrEqual(all.n);
    // «Все снаряды» возвращает 10
    await dialog.getByRole("button", { name: "Все снаряды", exact: true }).click();
    expect((await shown(dialog)).n).toBe(10);
    // поиск «жим» + чипы
    await dialog.getByRole("searchbox").fill("жим");
    await expect(dialog.locator(".swap-section-headline")).toContainText("Результаты поиска");
    const search = await shown(dialog);
    expect(search.n).toBe(10);
    for (const word of ["Гантели", "Штанга"]) {
      await dialog.getByRole("button", { name: word, exact: true }).click();
      const s = await shown(dialog);
      expect(s.n, `«жим» + «${word}»`).toBeGreaterThan(0);
      expect(s.rows).toBe(s.n);
      for (const label of s.labels) expect(label === word || label === "Штанга / тренажёр").toBe(true);
    }
    await dialog.getByRole("button", { name: "Все снаряды", exact: true }).click();
    expect((await shown(dialog)).n).toBe(10);
    await dialog.getByRole("button", { name: "Очистить", exact: true }).click();
    expect((await shown(dialog)).n).toBe(10);
    // цели касания и текст внутри плашек
    expect(await smallInDialog(page), "окно без поиска").toEqual([]);
    await dialog.getByRole("searchbox").fill("жим");
    expect(await smallInDialog(page), "окно с поиском").toEqual([]);
    expect((await clipped(page, "dialog[open]")).wide).toEqual([]);
  });
}

test("R09-REQ02: выбор строки при включённом чипе заменяет упражнение так же, как без чипа", async ({ page }) => {
  test.setTimeout(90_000);
  await round01Fixture(page);
  await startWith(page, BENCH);
  const dialog = await openSwap(page);
  await dialog.getByRole("button", { name: "Гантели", exact: true }).click();
  await dialog.getByRole("button", { name: /^Жим гантелей лёжа на горизонтальной скамье/ }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText("Заменено: вес и отметки не перенесены — другое упражнение")).toBeVisible();
  await expect(page.getByLabel("Жим гантелей лёжа на горизонтальной скамье, подход 1, вес", { exact: true })).toBeVisible();
});

test("R09-REQ02: «текст шире плашки» в окне «Заменить» — 0 на 320", async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 320, height: 640 });
  await round01Fixture(page);
  await startWith(page, BENCH);
  const dialog = await openSwap(page);
  expect((await clipped(page, "dialog[open]")).wide).toEqual([]);
  await dialog.getByRole("searchbox").fill("жим");
  expect((await clipped(page, "dialog[open]")).wide).toEqual([]);
  expect(await overflow(page)).toBeLessThanOrEqual(1);
});

// ───────────── REQ03: «Эта тренировка уже сохранена в другом окне» ─────────────
const CONFLICT = "Эта тренировка уже сохранена в другом окне";
/**
 * Две вкладки одного человека: в «другом окне» подходы 1 и 2 по 70 × 8 уже сохранены, здесь — подходы 1 и 3 по 60 × 8.
 * Первая отправка получает 409 с тем, что сохранено «там»; сохранённая запись попадает в список сервера.
 */
async function twoTabs(page: Page) {
  const f = await round01Fixture(page);
  let first = true;
  await page.route("**/api/workouts", (route) => {
    if (route.request().method() !== "PUT" || !first) return route.fallback();
    first = false;
    const current: Workout = structuredClone(route.request().postDataJSON());
    current.exercises[0].sets.forEach((s, i) => Object.assign(s, { weight: 70, reps: 8, done: i < 2 }));
    f.workouts.unshift({ ...current, revision: 2 });
    return route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ error: "Тренировка изменена на другом устройстве", current: { ...current, revision: 2 } }) });
  });
  await startWith(page, BENCH);
  await lift(page, 1, "60", "8");
  await lift(page, 3, "60", "8");
  await page.getByRole("button", { name: "Завершить тренировку", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: CONFLICT, exact: true });
  await expect(dialog).toBeVisible();
  return { f, dialog };
}

for (const size of SIZES3) {
  test(`R09-REQ03: две вкладки — окно человеческим языком, по два числа для каждой записи, всё внутри окна ${size.width}×${size.height}`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize(size);
    const { dialog } = await twoTabs(page);
    const text = (await dialog.innerText()).replace(/\s+/g, " ");
    expect(text, "слова из прежнего окна").not.toMatch(/версия|версии|версию|черновик|сервер|поверх/i);
    expect(text).toMatch(/Сохранено 2 подх\. · 1\s120 кг/);
    expect(text).toMatch(/Здесь 2 подх\. · 960 кг/);
    for (const label of ["Оставить сохранённую, мою не сохранять", "Сохранить мою отдельной тренировкой", "Скачать мою в файл"]) await expect(dialog.getByRole("button", { name: label })).toBeVisible();
    // «моя» — то же, что на экране первой вкладки
    await expect(page.locator(".workout-live-hud")).toContainText("2");
    await expect(page.locator(".hud-tonnage b")).toContainText("960");
    // всё внутри окна: right ≤ ширина окна − 8, текст переносится
    const box = (await dialog.boundingBox())!;
    const items = await dialog.locator("button, a").evaluateAll((els) => els.map((el) => {
      const r = el.getBoundingClientRect();
      return { text: ((el as HTMLElement).innerText || el.getAttribute("aria-label") || "").trim().slice(0, 40), left: r.left, right: r.right, height: r.height, wide: el.scrollWidth > el.clientWidth + 1 };
    }));
    for (const it of items) {
      expect(it.right, `«${it.text}» выходит за правый край окна`).toBeLessThanOrEqual(box.x + box.width - 8);
      expect(it.left, `«${it.text}» выходит за левый край окна`).toBeGreaterThanOrEqual(box.x + 8);
      expect(it.wide, `«${it.text}»: текст шире плашки`).toBe(false);
    }
    expect(await dialog.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);
    expect(await smallInDialog(page), "цели меньше 44 px").toEqual([]);
    expect(await overflow(page)).toBeLessThanOrEqual(1);
  });
}

test("R09-REQ03: «Сохранить мою отдельной тренировкой» — копия с моими подходами, сообщение прежнее, в истории две записи, не больше", async ({ page }) => {
  test.setTimeout(120_000);
  const { f, dialog } = await twoTabs(page);
  await dialog.getByRole("button", { name: "Сохранить мою отдельной тренировкой", exact: true }).click();
  await expect(page.getByText("Отдельный черновик готов. Сохрани его, когда проверишь.")).toBeVisible();
  await expect(page.getByLabel(`${BENCH}, подход 1, вес`, { exact: true })).toHaveValue("60");
  await expect(page.getByLabel(`${BENCH}, подход 3, вес`, { exact: true })).toHaveValue("60");
  await page.getByRole("button", { name: "Завершить тренировку", exact: true }).click();
  await expect(page.getByRole("button", { name: "Завершить тренировку", exact: true })).toHaveCount(0);
  expect(f.workouts.length).toBe(2);
  await page.reload();
  await nav(page, "История").click();
  await expect(page.locator(".session-item")).toHaveCount(2);
});

test("R09-REQ03: «Оставить сохранённую, мою не сохранять» открывает сохранённую запись; «Скачать мою в файл» отдаёт файл", async ({ page }) => {
  test.setTimeout(120_000);
  const { dialog } = await twoTabs(page);
  const download = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Скачать мою в файл", exact: true }).click();
  expect((await download).suggestedFilename()).toBe("tyaga-draft.json");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Оставить сохранённую, мою не сохранять", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByLabel(`${BENCH}, подход 1, вес`, { exact: true })).toHaveValue("70");
  await expect(page.getByLabel(`${BENCH}, подход 3, вес`, { exact: true })).toHaveValue("70");
});

// ───────────── REQ04: таймер отдыха на 320 ─────────────
const REST_SIZES = [{ width: 320, height: 640 }, { width: 360, height: 800 }, { width: 390, height: 844 }];
for (const size of REST_SIZES) {
  test(`R09-REQ04: таймер отдыха — цифры целиком, кнопки не меньше 44 px, текст не шире плашки ${size.width}×${size.height}`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize(size);
    await round01Fixture(page);
    await startWith(page, BENCH);
    await lift(page, 1, "60", "8");
    const bar = page.locator(".rest-bar");
    await expect(bar).toBeVisible();
    const digits = bar.locator(".rest-digits");
    const measure = () => page.evaluate(() => {
      const d = document.querySelector(".rest-bar .rest-digits")!;
      const minus = document.querySelector<HTMLElement>('.rest-bar [aria-label="Минус 15 секунд"]')!;
      return { scroll: d.scrollWidth, client: d.clientWidth, right: d.getBoundingClientRect().right, textRight: (() => { const r = document.createRange(); r.selectNodeContents(d); return r.getBoundingClientRect().right; })(), minusLeft: minus.getBoundingClientRect().left, text: d.textContent };
    });
    const first = await measure();
    expect(first.text).toMatch(/^\d{2}:\d{2}$/);
    expect(first.scroll, `«${first.text}»: содержимое ${first.scroll} px в блоке ${first.client} px`).toBeLessThanOrEqual(first.client);
    expect(first.textRight, "последняя цифра правее левого края «−15»").toBeLessThanOrEqual(first.minusLeft);
    if (size.width === 360) expect(first.client).toBeGreaterThanOrEqual(102);
    if (size.width === 390) expect(first.client).toBeGreaterThanOrEqual(132);
    // три «+15»: цифры по-прежнему целиком
    for (let i = 0; i < 3; i++) await bar.getByRole("button", { name: "Плюс 15 секунд" }).click();
    const grown = await measure();
    expect(grown.text).not.toBe(first.text);
    expect(grown.scroll).toBeLessThanOrEqual(grown.client);
    // эталон ширины «08:88»: самая широкая комбинация цифр с табличным начертанием
    const widest = await digits.evaluate((el) => {
      const before = el.textContent;
      el.textContent = "08:88";
      const r = { scroll: el.scrollWidth, client: el.clientWidth };
      el.textContent = before;
      return r;
    });
    expect(widest.scroll, "«08:88»").toBeLessThanOrEqual(widest.client);
    for (const name of ["Минус 15 секунд", "Плюс 15 секунд", /^(Приостановить|Продолжить) таймер$/, "Пропустить отдых"]) {
      const b = (await bar.getByRole("button", { name }).boundingBox())!;
      expect(b.width, `${name}`).toBeGreaterThanOrEqual(43.99);
      expect(b.height, `${name}`).toBeGreaterThanOrEqual(43.99);
    }
    expect((await clipped(page, ".rest-bar")).wide).toEqual([]);
    expect((await clipped(page, "main")).wide).toEqual([]);
    expect(await overflow(page)).toBeLessThanOrEqual(1);
  });
}

// ───────────── REQ05: «Нет связи» в шапке комнаты ─────────────
const LOST = "Нет связи — напарник видит последние данные";

test("R09-REQ05: в комнате без сети ≤ 15 с появляется «Нет связи …», подходы считаются; со связью строка исчезает ≤ 15 с", async ({ page }) => {
  test.setTimeout(150_000);
  await round01Fixture(page);
  const net: { left: number; down: boolean } = { left: 0, down: false };
  const live = await liveWithMyState(page, net);
  await page.reload();
  await startWith(page, BENCH);
  await lift(page, 1, "60", "8");
  await expect.poll(() => live.pushed.at(-1)?.setsDone).toBe(1);
  await expect(page.locator(".room-badge-lost")).toHaveCount(0);
  net.down = true;
  const off = Date.now();
  await lift(page, 2, "60", "8");
  await lift(page, 3, "60", "8");
  // работа не блокируется: счётчик и итог растут
  await expect(page.locator(".workout-live-hud")).toContainText("3");
  await expect(page.locator(".hud-tonnage b")).toContainText("1 440");
  const lost = page.locator(".room-badge-lost");
  await expect(lost).toBeVisible({ timeout: 15_000 });
  expect(Date.now() - off, "строка появилась позже 15 с").toBeLessThanOrEqual(15_500);
  await expect(lost).toHaveText(LOST);
  const box = await lost.evaluate((el) => ({ h: el.getBoundingClientRect().height, line: parseFloat(getComputedStyle(el).lineHeight), wide: el.scrollWidth > el.clientWidth + 1 }));
  expect(box.h, "одна строка").toBeLessThan(box.line * 1.6);
  expect(box.wide).toBe(false);
  expect(await page.locator(".room-badge").innerText()).not.toMatch(/сервер|синхрон/i);
  expect(await overflow(page)).toBeLessThanOrEqual(1);
  // связь вернулась: строка исчезает, напарник получает 3/3
  net.down = false;
  const back = Date.now();
  await expect(lost).toHaveCount(0, { timeout: 15_000 });
  expect(Date.now() - back).toBeLessThanOrEqual(15_500);
  await expect.poll(() => live.pushed.at(-1)?.setsDone, { timeout: 15_000 }).toBe(3);
});

test("R09-REQ05: без комнаты строки нет даже без сети", async ({ page, context }) => {
  test.setTimeout(90_000);
  await round01Fixture(page);
  await startWith(page, BENCH);
  await context.setOffline(true);
  await lift(page, 1, "60", "8");
  await page.waitForTimeout(14_000);
  await expect(page.locator(".room-badge-lost, .room-badge")).toHaveCount(0);
  expect(await page.locator("main").innerText()).not.toContain("Нет связи");
});

test("R09-REQ05: один пропущенный запрос «Нет связи» не показывает", async ({ page }) => {
  test.setTimeout(90_000);
  await round01Fixture(page);
  const live = await liveWithMyState(page, { left: 1 });
  await page.reload();
  await startWith(page, BENCH);
  await lift(page, 1, "60", "8");
  // первый запрос оборван, повтор через несколько секунд дошёл
  await expect.poll(() => live.pushed.at(-1)?.setsDone, { timeout: 15_000 }).toBe(1);
  await page.waitForTimeout(12_000);
  await expect(page.locator(".room-badge-lost")).toHaveCount(0);
});
