import { test, expect, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { nav, round01Fixture, startWith, mark, NOW } from "./fixtures/round01";
import { makeWorkout } from "../../src/lib/model";
import { TrainingProgram } from "../../src/domain/TrainingProgram";
import type { Workout } from "../../src/lib/types";

/**
 * Раунд 7: R07-REQ01…REQ05 на телефоне (390×844 и 360×800), приложение на подставных ответах.
 * Сегодня в фикстуре — вторник 10 нояб. 2026.
 */
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, locale: "ru-RU", timezoneId: "Europe/Saratov" });

const SIZES = [{ width: 390, height: 844 }, { width: 360, height: 800 }];
const SHOTS = process.env.R07_SHOTS ?? "";
const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

/** Тренировка со жимом: 3 подхода по 95 × 11. */
function benchSession(id: string, date: string, name = "Верх", kg = 95): Workout {
  const w = makeWorkout(["bench"], [], "Europe/Saratov");
  return {
    ...w, id, name, date, duration: 45, createdAt: `${date}T10:00:00.000Z`, revision: 1,
    exercises: w.exercises.map((e) => ({ ...e, sets: [1, 2, 3].map((k) => ({ id: `${id}:${k}`, weight: kg, reps: 11, rir: 2, warmup: false, done: true })) })),
  } as Workout;
}
/** Журнал: тренировки каждые два дня за последние два с половиной месяца (12 окт. среди них). */
function journal(): Workout[] {
  return Array.from({ length: 36 }, (_, n) => {
    const date = new Date(Date.UTC(2026, 10, 9) - n * 2 * 86_400_000).toISOString().slice(0, 10);
    return benchSession(`j-${n}`, date, n % 2 ? "Верх" : "Ноги");
  });
}

/** «Друзья»: друг, входящая заявка, приглашение на встречу и на челлендж — все кнопки, что бывают на вкладке. */
async function mockFriends(page: Page) {
  const today = "2026-11-10";
  const data = {
    me: { id: "round01-user", displayName: "Саша", inviteCode: "A1B2C3D4E5F6", gym: "", focus: "", activeUntil: 0, weekWorkouts: 1, weeklyTarget: 3 },
    friends: [
      { id: "dima", displayName: "Дмитрий", gym: "Атлетика на Лесной", focus: "Спина", activeUntil: NOW.getTime() + 3_600_000, weekWorkouts: 3, weeklyTarget: 3 },
      { id: "lena", displayName: "Елена", gym: "Другой зал", focus: "Ноги", activeUntil: 0, weekWorkouts: 1, weeklyTarget: 3 },
    ],
    requests: [{ id: "artem", displayName: "Артём", direction: "incoming" }],
    feed: [
      { id: "w-dima", athleteId: "dima", displayName: "Дмитрий", name: "Спина и бицепс", date: today, duration: 54, setsCount: 18, volumeKg: 4800, kudosCount: 2, hasGivenKudos: false },
      { id: "w-lena", athleteId: "lena", displayName: "Елена", name: "Ноги и корпус", date: today, duration: 45, setsCount: 14, volumeKg: 3200, kudosCount: 1, hasGivenKudos: false },
      { id: "w-one", athleteId: "dima", displayName: "Дмитрий", name: "Плечи", date: today, duration: 40, setsCount: 21, volumeKg: 3000, kudosCount: 0, hasGivenKudos: false },
      { id: "w-two", athleteId: "lena", displayName: "Елена", name: "Кардио", date: today, duration: 20, setsCount: 2, volumeKg: 0, kudosCount: 0, hasGivenKudos: false },
      { id: "w-25", athleteId: "dima", displayName: "Дмитрий", name: "Большой день", date: today, duration: 90, setsCount: 25, volumeKg: 9000, kudosCount: 0, hasGivenKudos: false },
      { id: "w-1", athleteId: "lena", displayName: "Елена", name: "Короткая", date: today, duration: 10, setsCount: 1, volumeKg: 100, kudosCount: 0, hasGivenKudos: false },
    ],
    meetups: [{
      id: "meet-1", hostId: "dima", hostName: "Дмитрий", name: "Ноги вместе", startsAt: NOW.getTime() + 86_400_000, gym: "Атлетика на Лесной", cancelled: false, myResponse: "invited",
      participants: [
        { id: "dima", displayName: "Дмитрий", response: "accepted", gym: "Атлетика на Лесной" },
        { id: "round01-user", displayName: "Саша", response: "invited", gym: "" },
      ],
    }],
    weekStart: "2026-11-09", today, serverTime: NOW.getTime(),
  };
  const challenge = {
    id: "ch-1", hostId: "dima", name: "Ноябрь в ритме", startDate: "2026-11-09", endDate: "2026-12-06", today, cancelled: false, myResponse: "invited",
    participants: [
      { id: "dima", displayName: "Дмитрий", response: "accepted", target: 3, weeks: [] },
      { id: "round01-user", displayName: "Саша", response: "invited", target: 3, weeks: [] },
    ],
  };
  await page.route("**/api/friends", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(data) }));
  await page.route("**/api/challenges", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ accountId: "round01-user", challenges: [challenge] }) }));
}

/** Видимые кнопки, ссылки, поля, списки и summary в main короче 44 px по любой стороне. */
function smallTargets(page: Page) {
  return page.evaluate(() => {
    const out: { tag: string; text: string; w: number; h: number; cls: string; parent: string }[] = [];
    document.querySelectorAll("main button, main a, main input:not([type=hidden]), main select, main summary").forEach((el) => {
      const style = getComputedStyle(el);
      if (style.visibility === "hidden" || style.display === "none") return;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return;
      /* считается собственный бокс элемента, без невидимых псевдоэлементов: так же меряет и приёмка */
      const { width: w, height: h } = r;
      if (w + 0.5 >= 44 && h + 0.5 >= 44) return;
      const inText = el.tagName === "A" && !!el.closest("p, li") && style.display === "inline";
      if (inText) return;
      out.push({ tag: el.tagName.toLowerCase(), text: ((el as HTMLElement).innerText || el.getAttribute("aria-label") || (el as HTMLInputElement).type || "").trim().slice(0, 40), w: Math.round(w), h: Math.round(h), cls: String(el.className || "").slice(0, 50), parent: String(el.parentElement?.className || "").slice(0, 50) });
    });
    return out;
  });
}

const BENCH = "Жим штанги лёжа";
const TABS = ["Сегодня", "Программы", "Друзья", "История", "Прогресс", "Упражнения"];

for (const size of SIZES) {
  test(`R07-REQ03: цели касания на шести вкладках не меньше 44 px ${size.width}×${size.height}`, async ({ page }) => {
    await page.setViewportSize(size);
    await round01Fixture(page, { workouts: journal() });
    await mockFriends(page);
    await page.reload();
    await expect(page.getByRole("heading", { name: "Сегодня", exact: true })).toBeVisible();
    const report: Record<string, number> = {};
    const details: Record<string, unknown> = {};
    for (const tab of TABS) {
      await nav(page, tab).click();
      await expect(nav(page, tab)).toHaveAttribute("aria-current", "page");
      await page.waitForTimeout(500);
      const small = await smallTargets(page);
      report[tab] = small.length;
      details[tab] = small;
      expect(await overflow(page), `${tab}: горизонтальная прокрутка`).toBeLessThanOrEqual(1);
      if (SHOTS) {
        mkdirSync(SHOTS, { recursive: true });
        await page.screenshot({ path: `${SHOTS}/${tab}-${size.width}.png`, fullPage: false });
      }
    }
    if (SHOTS) writeFileSync(`${SHOTS}/small-${size.width}.json`, JSON.stringify(details, null, 1));
    console.log(`R07 мелких целей ${size.width}: ${JSON.stringify(report)}`);
    for (const tab of TABS) expect(report[tab], `${tab}: мелкие цели ${JSON.stringify(details[tab])}`).toBe(0);
  });
}

for (const size of SIZES) {
  test(`R07-REQ03: календарь активности — ячейки не меньше 44, без перекрытия, тап по 12 окт. выбирает 12 окт. ${size.width}×${size.height}`, async ({ page }) => {
    await page.setViewportSize(size);
    await round01Fixture(page, { workouts: journal() });
    await page.reload();
    await nav(page, "Прогресс").click();
    await page.getByRole("button", { name: "12 нед.", exact: true }).click();
    const cells = page.locator(".heatmap-grid .heat-cell");
    await expect(cells.first()).toBeAttached();
    await cells.first().scrollIntoViewIfNeeded();
    const boxes = await cells.evaluateAll((els) => els.map((el) => { const r = el.getBoundingClientRect(); return { l: r.left, t: r.top, w: r.width, h: r.height }; }));
    expect(boxes.length).toBeGreaterThan(40);
    for (const b of boxes) { expect(b.w).toBeGreaterThanOrEqual(44); expect(b.h).toBeGreaterThanOrEqual(44); }
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j];
      const x = Math.min(a.l + a.w, b.l + b.w) - Math.max(a.l, b.l), y = Math.min(a.t + a.h, b.t + b.h) - Math.max(a.t, b.t);
      expect(x > 0.5 && y > 0.5, `ячейки ${i} и ${j} перекрываются`).toBe(false);
    }
    expect(await overflow(page), "страница не прокручивается вбок").toBeLessThanOrEqual(1);
    const wrap = await page.locator(".heatmap-wrapper").first().evaluate((el) => ({ client: el.clientWidth, scroll: el.scrollWidth }));
    expect(wrap.scroll, "семь столбцов помещаются в карточку").toBeLessThanOrEqual(wrap.client + 1);
    const oct12 = page.getByRole("button", { name: /^12 окт\. 2026: 3 рабочих подхода$/ });
    await expect(oct12).toHaveCount(1);
    await oct12.tap();
    await expect(oct12).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(".heatmap-detail-card")).toContainText("12 окт");
    await expect(page.locator(".heatmap-detail-card")).toContainText("3 рабочих подхода");
    await expect(page.locator(".heatmap-grid .heat-cell[aria-pressed=true]")).toHaveCount(1);
    /* соседние дни (11 и 13 окт.) выбираются отдельно, а не 12-м */
    await page.getByRole("button", { name: /^13 окт\. 2026/ }).tap();
    await expect(page.locator(".heatmap-detail-card")).toContainText("13 окт");
    if (SHOTS) await page.locator(".heatmap-panel").screenshot({ path: `${SHOTS}/Календарь-${size.width}.png` });
  });

  test(`R07-REQ03: «Не участвую», «Не смогу» и «Удалить» — высота не меньше 44, между кнопками не меньше 8 px ${size.width}×${size.height}`, async ({ page }) => {
    await page.setViewportSize(size);
    await round01Fixture(page);
    await mockFriends(page);
    await page.reload();
    await nav(page, "Друзья").click();
    const names = ["Не участвую", "Не смогу", "Удалить", "Моя карточка прогресса"];
    for (const name of names) {
      const btn = page.getByRole("button", { name: new RegExp(name) }).first();
      await btn.scrollIntoViewIfNeeded();
      const h = await btn.evaluate((el) => el.getBoundingClientRect().height);
      expect(h, `${name}: высота`).toBeGreaterThanOrEqual(44);
    }
    /* расстояние до ближайшей соседней кнопки/ссылки по вертикали и по горизонтали */
    const gaps = await page.evaluate(() => {
      const all = [...document.querySelectorAll("main button, main a")].filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
      const result: { text: string; gap: number }[] = [];
      for (const el of all) {
        const text = (el as HTMLElement).innerText.trim();
        if (!/^(Не участвую|Не смогу|Удалить)$/.test(text)) continue;
        const a = el.getBoundingClientRect();
        let min = Infinity;
        for (const other of all) {
          if (other === el || other.contains(el) || el.contains(other)) continue;
          const b = other.getBoundingClientRect();
          const dx = Math.max(0, Math.max(a.left, b.left) - Math.min(a.right, b.right));
          const dy = Math.max(0, Math.max(a.top, b.top) - Math.min(a.bottom, b.bottom));
          min = Math.min(min, Math.hypot(dx, dy));
        }
        result.push({ text, gap: Math.round(min * 10) / 10 });
      }
      return result;
    });
    expect(gaps.length).toBeGreaterThanOrEqual(3);
    for (const g of gaps) expect(g.gap, `${g.text}: отступ до соседней кнопки`).toBeGreaterThanOrEqual(8);
    expect(await overflow(page)).toBeLessThanOrEqual(1);
  });
}

/** Программа на вторник из одного жима: warm разминочных и work рабочих подходов, повторы reps (0 — не заданы). */
function planRoutine(name: string, opts: { warm?: number; work: number; reps: number; weight: number; min?: number; max?: number }) {
  const w = makeWorkout(["bench"], [], "Europe/Saratov");
  const sets = [
    ...Array.from({ length: opts.warm ?? 0 }, (_, k) => ({ id: `w${k}`, weight: 20, reps: 10, rir: 4, warmup: true, done: false })),
    ...Array.from({ length: opts.work }, (_, k) => ({ id: `s${k}`, weight: opts.weight, reps: opts.reps, rir: 2, warmup: false, done: false })),
  ];
  const exercises = w.exercises.map((e) => ({ ...e, sets, ...(opts.min ? { repMin: opts.min, repMax: opts.max ?? opts.min, progression: "double" as const } : {}) }));
  return { ...TrainingProgram.empty(), id: `r-${name}`, name, days: [1], revision: 1, exercises };
}
const planLine = (page: Page) => page.locator(".plan-exercises li").first().locator("b");

test("R07-REQ01: «Сегодня по программе» — только рабочие подходы, диапазон повторов, без «× 0»; после «Начать» то же", async ({ page }) => {
  test.setTimeout(120_000);
  // 1) повторов нет → «3 подх.», разминка не считается (2 разминочных + 3 рабочих)
  await round01Fixture(page, { routines: [planRoutine("Верх без повторов", { warm: 2, work: 3, reps: 0, weight: 60 })] });
  await expect(planLine(page)).toContainText("3 подх.");
  await expect(planLine(page)).toContainText("60 кг");
  await expect(planLine(page)).toContainText("по плану");
  const text = (await page.locator(".plan-exercises").innerText()).replace(/\s+/g, " ");
  expect(text).not.toMatch(/× 0/);
  expect(text).not.toMatch(/5 (×|подх)/);
  await page.getByRole("button", { name: "Начать тренировку", exact: true }).first().click();
  await expect(page.locator(".set-row .set-kind.normal")).toHaveCount(3);
  await expect(page.locator(".set-row .set-kind.warmup")).toHaveCount(2);
});

test("R07-REQ01: диапазон 8–12 → «3 × 8–12 · 60 кг», конкретные повторы → «3 × 10»", async ({ page }) => {
  test.setTimeout(120_000);
  await round01Fixture(page, { routines: [planRoutine("Верх диапазон", { warm: 2, work: 3, reps: 0, weight: 60, min: 8, max: 12 })] });
  await expect(planLine(page)).toContainText("3 × 8–12 · 60 кг");
  await expect(page.locator(".plan-exercises")).not.toContainText("× 0");
  await page.getByRole("button", { name: "Начать тренировку", exact: true }).first().click();
  await expect(page.locator(".set-row .set-kind.normal")).toHaveCount(3);
  await expect(page.locator(".set-row .set-kind.warmup")).toHaveCount(2);
});

test("R07-REQ01: конкретные повторы → «3 × 10 · 60 кг»", async ({ page }) => {
  await round01Fixture(page, { routines: [planRoutine("Верх", { work: 3, reps: 10, weight: 60 })] });
  await expect(planLine(page)).toContainText("3 × 10 · 60 кг");
  await page.getByRole("button", { name: "Начать тренировку", exact: true }).first().click();
  await expect(page.locator(".set-row .set-kind.normal")).toHaveCount(3);
});

test("R07-REQ02: «рабочих подходов» склоняется в ленте друзей и встречах", async ({ page }) => {
  await round01Fixture(page);
  await mockFriends(page);
  await page.reload();
  await nav(page, "Друзья").click();
  const feed = page.locator(".friends-feed");
  await expect(feed).toBeVisible();
  const body = (await page.locator("main").innerText()).replace(/\s+/g, " ");
  for (const phrase of ["18 рабочих подходов", "14 рабочих подходов", "21 рабочий подход", "2 рабочих подхода", "25 рабочих подходов", "1 рабочий подход"])
    expect(body, phrase).toContain(phrase);
  expect(body).not.toMatch(/\b(18|14|21|2|25|1) рабочих подх\.|подходов подходов/);
});

for (const size of SIZES) {
  test(`R07-REQ04: «Записать тренировку» — дата в шапке, одно нажатие до даты и длительности, «задним числом» ${size.width}×${size.height}`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize(size);
    const f = await round01Fixture(page);
    await nav(page, "История").click();
    await page.getByRole("button", { name: "Записать тренировку", exact: true }).click();
    // дата и доступ к ней — на первом экране, без прокрутки
    const chip = page.locator(".retro-chip");
    await expect(chip).toHaveText("10 нояб. · выбрать дату");
    const box = (await chip.boundingBox())!;
    expect(box.y + box.height).toBeLessThanOrEqual(size.height);
    expect(box.height).toBeGreaterThanOrEqual(44);
    // одно нажатие — поля те же, что в «Деталях тренировки»
    await chip.click();
    const date = page.getByRole("group", { name: "Дата и длительность записи" }).getByLabel("Дата записи", { exact: true });
    await expect(date).toBeVisible();
    await date.fill("2026-11-08");
    await expect(chip).toHaveText("8 нояб. · задним числом");
    // дата позже сегодняшней не принимается: остаётся выбранная
    await date.fill("2026-11-20");
    await expect(date).toHaveValue("2026-11-08");
    await expect(chip).toHaveText("8 нояб. · задним числом");
    // в DOM одна «Дата» с таким именем: панель и «Детали» различаются
    await expect(page.getByLabel("Дата", { exact: true })).toHaveCount(1);
    const minutes = page.getByRole("group", { name: "Дата и длительность записи" }).getByLabel("Длительность записи, минуты");
    await minutes.fill("50");
    await expect(page.locator(".live-clock-badge")).toContainText("50 мин");
    await expect(page.locator(".live-clock-badge")).toContainText("Длительность");
    await page.waitForTimeout(1500);
    await expect(page.locator(".live-clock-badge")).toContainText("50 мин");
    expect(await overflow(page)).toBeLessThanOrEqual(1);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/Задним-числом-${size.width}.png` });
    await page.getByRole("button", { name: "Добавить упражнение", exact: true }).click();
    await page.getByRole("button", { name: "Добавить Жим штанги лёжа", exact: true }).click();
    await page.getByRole("button", { name: "Готово", exact: true }).click();
    await mark(page, 1);
    await page.getByRole("button", { name: "Завершить тренировку", exact: true }).click();
    await expect(page.getByRole("button", { name: "Завершить тренировку", exact: true })).toHaveCount(0);
    expect(f.savedBodies.at(-1)?.date).toBe("2026-11-08");
    expect(f.savedBodies.at(-1)?.duration).toBe(50);
    await nav(page, "История").click();
    await expect(page.locator(".session-item").first().locator("time, .session-date, :scope > *").first()).toBeVisible();
    await expect(page.locator(".session-item").first()).toContainText(/8\s*нояб\./);
  });
}

test("R07-REQ04: обычная сегодняшняя тренировка — шапка без новых подписей", async ({ page }) => {
  await round01Fixture(page);
  await startWith(page, "Жим штанги лёжа");
  await expect(page.locator(".retro-chip")).toHaveCount(0);
  await expect(page.locator(".workout-bar")).not.toContainText("задним числом");
  await expect(page.locator(".live-clock-badge")).toContainText("Счётчик");
});

const openTool = async (page: Page, name: RegExp | string) => {
  await page.getByRole("button", { name: /^Инструменты/ }).last().click();
  await page.getByRole("button", { name: typeof name === "string" ? new RegExp(name) : name }).click();
};

for (const size of SIZES) {
  test(`R07-REQ05: разгрузка на свободной тренировке — строка, «Подставить 85 %» один раз, отмена убирает строку ${size.width}×${size.height}`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize(size);
    const base = makeWorkout(["bench"], [], "Europe/Saratov", true);
    base.exercises.forEach((e) => (e.sets = e.sets.slice(0, 3).map((s) => ({ ...s, weight: 95, reps: 11 }))));
    const routine = { ...TrainingProgram.empty(), id: "r-legs", name: "Ноги А", days: [1], revision: 1, exercises: base.exercises };
    await round01Fixture(page, { routines: [routine], workouts: [benchSession("old-1", "2026-11-03", "Ноги А")] });
    // разгрузки нет — строки нет
    await expect(page.locator(".deload-line")).toHaveCount(0);
    await openTool(page, "Разгрузочная неделя");
    await page.getByRole("button", { name: "Применить разгрузку к тренировкам", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Закрыть", exact: true }).click();
    await nav(page, "Сегодня").click();
    await expect(page.locator(".deload-line")).toHaveText(/^Разгрузка до 16 нояб\.: 85 % веса, \d+ % подходов$/);
    // свободная тренировка рядом с «Пустая тренировка»
    await page.getByRole("button", { name: "Пустая тренировка", exact: true }).click();
    await page.getByRole("button", { name: "Добавить упражнение", exact: true }).click();
    await page.getByRole("button", { name: `Добавить ${BENCH}`, exact: true }).click();
    await page.getByRole("button", { name: "Готово", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "Название тренировки" })).toHaveValue("Новая тренировка");
    const hint = page.locator(".deload-hint");
    await expect(hint).toContainText(/Разгрузка до 16 нояб\.: 85 % веса, \d+ % подходов/);
    // без нажатия веса не менялись
    const weight = page.getByLabel(`${BENCH}, подход 1, вес`, { exact: true });
    await expect(weight).toHaveValue("95");
    expect(await overflow(page)).toBeLessThanOrEqual(1);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/Разгрузка-свободная-${size.width}.png` });
    const apply = hint.getByRole("button", { name: "Подставить 85 %", exact: true });
    await apply.click();
    await expect(weight).toHaveValue("80");
    await expect(page.getByLabel(`${BENCH}, подход 3, вес`, { exact: true })).toHaveValue("80");
    // повторное нажатие не снижает второй раз
    await apply.click();
    await expect(weight).toHaveValue("80");
    await expect(page.getByLabel(`${BENCH}, подход 3, вес`, { exact: true })).toHaveValue("80");
  });
}

const deloadRoutine = () => {
  const base = makeWorkout(["bench"], [], "Europe/Saratov", true);
  base.exercises.forEach((e) => (e.sets = e.sets.slice(0, 3).map((x) => ({ ...x, weight: 95, reps: 11 }))));
  return { ...TrainingProgram.empty(), id: "r-legs", name: "Ноги А", days: [1], revision: 1, exercises: base.exercises };
};
const applyDeload = async (page: Page) => {
  await openTool(page, "Разгрузочная неделя");
  await page.getByRole("button", { name: "Применить разгрузку к тренировкам", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Закрыть", exact: true }).click();
  await nav(page, "Сегодня").click();
};

test("R07-REQ05: разгрузку отменили — строки нет ни на «Сегодня», ни в свободной тренировке", async ({ page }) => {
  test.setTimeout(120_000);
  await round01Fixture(page, { routines: [deloadRoutine()], workouts: [benchSession("old-1", "2026-11-03", "Ноги А")] });
  await applyDeload(page);
  await expect(page.locator(".deload-line")).toHaveCount(1);
  await openTool(page, "Разгрузочная неделя");
  await page.getByRole("button", { name: "Отменить", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Закрыть", exact: true }).click();
  await nav(page, "Сегодня").click();
  await expect(page.locator(".deload-line")).toHaveCount(0);
  await page.getByRole("button", { name: "Пустая тренировка", exact: true }).click();
  await expect(page.locator(".deload-hint")).toHaveCount(0);
});

test("R07-REQ05: программа в разгрузке ведёт себя как раньше — «[Разгрузка]» и 80 вместо 95, плашки «Подставить» нет", async ({ page }) => {
  test.setTimeout(120_000);
  await round01Fixture(page, { routines: [deloadRoutine()], workouts: [benchSession("old-1", "2026-11-03", "Ноги А")] });
  await applyDeload(page);
  await page.getByRole("button", { name: "Начать тренировку", exact: true }).first().click();
  await expect(page.getByRole("textbox", { name: "Название тренировки" })).toHaveValue("Ноги А [Разгрузка]");
  await expect(page.getByLabel(`${BENCH}, подход 1, вес`, { exact: true })).toHaveValue("80");
  await expect(page.locator(".deload-hint")).toHaveCount(0);
});

for (const size of SIZES) {
  test(`QA-R07-01: тренировка, начатая в 23:50 по поясу профиля, в 00:10 остаётся обычной — без «задним числом», таймер идёт ${size.width}×${size.height}`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize(size);
    await round01Fixture(page);
    await page.clock.setFixedTime(new Date("2026-11-10T19:50:00Z")); // 23:50 в Саратове, вторник 10 нояб.
    await page.reload();
    await startWith(page, BENCH);
    await expect(page.locator(".retro-chip")).toHaveCount(0);
    await expect(page.locator(".live-clock-badge")).toContainText("Счётчик");
    await page.clock.setFixedTime(new Date("2026-11-10T20:10:00Z")); // 00:10, уже среда 11 нояб.
    await page.waitForTimeout(1500);
    await expect(page.locator(".retro-chip")).toHaveCount(0);
    await expect(page.locator(".workout-bar")).not.toContainText("задним числом");
    await expect(page.locator(".live-clock-badge")).toContainText("Счётчик");
    await expect(page.locator(".live-clock-badge")).not.toContainText("Длительность");
  });
}

/** Начать тренировку с жимом, отметить `sets` рабочих подходов и завершить: открывается «История» с блоком итогов. */
async function finishSession(page: Page, sets = 1) {
  await startWith(page, BENCH);
  for (let n = 1; n <= sets; n++) await mark(page, n);
  await page.getByRole("button", { name: "Завершить тренировку", exact: true }).click();
  await expect(page.getByRole("button", { name: "Завершить тренировку", exact: true })).toHaveCount(0);
  await expect(page.locator(".celebration-actions-group")).toBeVisible();
}

for (const size of SIZES) {
  test(`QA-R07-03: «История» сразу после «Завершить» — «Карточка для сторис» и «Текст» не меньше 44 px, между ними 8 px, без прокрутки вбок ${size.width}×${size.height}`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize(size);
    await round01Fixture(page);
    await finishSession(page, 2);
    await expect(nav(page, "История")).toHaveAttribute("aria-current", "page");
    const small = await smallTargets(page);
    expect(small, `мелкие цели после «Завершить»: ${JSON.stringify(small)}`).toEqual([]);
    const story = page.getByRole("button", { name: "Карточка для сторис", exact: true });
    const text = page.getByRole("button", { name: "Текст", exact: true });
    const a = (await story.boundingBox())!, b = (await text.boundingBox())!;
    for (const box of [a, b]) { expect(box.height).toBeGreaterThanOrEqual(43.99); expect(box.width).toBeGreaterThanOrEqual(43.99); }
    const gap = Math.max(b.x - (a.x + a.width), a.x - (b.x + b.width), b.y - (a.y + a.height), a.y - (b.y + b.height));
    expect(gap, "отступ между кнопками").toBeGreaterThanOrEqual(8);
    expect(await overflow(page)).toBeLessThanOrEqual(1);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/История-после-завершения-${size.width}.png` });
  });
}

for (const [sets, word] of [[1, "подход"], [3, "подхода"]] as const) {
  test(`QA-R07-02: на картинке «Карточка для сторис» подпись под числом — «${word}» при ${sets}`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.addInitScript(() => {
      const w = window as unknown as { __cardTexts: string[] };
      w.__cardTexts = [];
      const original = CanvasRenderingContext2D.prototype.fillText;
      CanvasRenderingContext2D.prototype.fillText = function (text: string, ...rest: [number, number, number?]) {
        w.__cardTexts.push(String(text));
        return original.call(this, text, ...rest);
      };
    });
    await round01Fixture(page);
    await page.reload();
    await finishSession(page, sets);
    await page.getByRole("button", { name: "Карточка для сторис", exact: true }).click();
    await expect(page.locator("canvas")).toBeVisible();
    await expect.poll(() => page.evaluate(() => (window as unknown as { __cardTexts: string[] }).__cardTexts.includes("Рабочий объём"))).toBe(true);
    const texts = await page.evaluate(() => (window as unknown as { __cardTexts: string[] }).__cardTexts);
    expect(texts, "число подходов на картинке").toContain(String(sets));
    expect(texts, "подпись под числом").toContain(word);
    expect(texts.filter((t) => /^подход/.test(t)), `лишние подписи: ${JSON.stringify(texts)}`).toEqual([word]);
  });
}
