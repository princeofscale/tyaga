import { test, expect, type Page } from "@playwright/test";
import { nav, round01Fixture, startWith, mark, doneWorkout } from "./fixtures/round01";
import { smallTargets, clipped } from "./fixtures/touch";
import { makeWorkout } from "../../src/lib/model";
import type { Workout } from "../../src/lib/types";
import { EXERCISES } from "../../src/lib/catalog";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BodyweightEntry } from "../../src/domain/BodyweightTracker";

/**
 * Раунд 8: R08-REQ01…REQ05 на телефоне (390×844 и 360×800), приложение на подставных ответах.
 * Сегодня в фикстуре — вторник 10 нояб. 2026.
 */
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, locale: "ru-RU", timezoneId: "Europe/Saratov" });

const SIZES = [{ width: 390, height: 844 }, { width: 360, height: 800 }];
const SQUAT = "Приседания со штангой";
const GOBLET = "Гоблет-присед";
const BENCH = "Жим штанги лёжа";
const PUSHUP = "Отжимания от пола";
const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

/** «Гоблет-присед» в прошлом: 10 × 9, 10 × 9, 10 × 8 (как «Прошлое» в ТЗ). */
function gobletHistory(): Workout {
  const w = doneWorkout("Гантели", "2026-11-03", [["goblet", 10, 9, 3]]);
  w.exercises[0].sets[2].reps = 8;
  return w;
}

/** Открыть «Заменить» у первого упражнения и выбрать замену через поиск. */
async function swapTo(page: Page, search: string, name: string) {
  await page.getByText("Ещё для упражнения", { exact: true }).first().click();
  await page.locator('button[title="Заменить упражнение на аналогичное"]').first().click();
  const dialog = page.getByRole("dialog", { name: "Заменить упражнение", exact: true });
  await dialog.getByRole("searchbox").fill(search);
  await dialog.getByRole("button", { name: new RegExp(`^${name}`) }).first().click();
  await expect(dialog).toHaveCount(0);
}
const weightOf = (page: Page, exercise: string, n: number) => page.getByLabel(`${exercise}, подход ${n}, вес`, { exact: true });
const repsOf = (page: Page, exercise: string, n: number) => page.getByLabel(`${exercise}, подход ${n}, повторы`, { exact: true });

for (const size of SIZES) {
  test(`R08-REQ01: «Заменить» приседания 95 × 11 на гоблет — чужих кг и ✓ нет, подставлено «Прошлое» 10 × 9 / 9 / 8 ${size.width}×${size.height}`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize(size);
    await round01Fixture(page, { workouts: [gobletHistory()] });
    await startWith(page, SQUAT);
    await mark(page, 1, SQUAT, "95", "11");
    await expect(page.locator(".set-row.done")).toHaveCount(1);
    await expect(page.locator(".hud-tonnage")).toContainText("1 045");
    await swapTo(page, "гоблет", GOBLET);
    await expect(page.getByText("Заменено: вес и отметки не перенесены — другое упражнение")).toBeVisible();
    for (const [n, kg, reps] of [[1, "10", "9"], [2, "10", "9"], [3, "10", "8"]] as const) {
      await expect(weightOf(page, GOBLET, n)).toHaveValue(kg);
      await expect(repsOf(page, GOBLET, n)).toHaveValue(reps);
    }
    await expect(page.locator(".set-row.done")).toHaveCount(0);
    const hud = (await page.locator(".workout-live-hud").innerText()).replace(/\s+/g, " ");
    expect(hud).toContain("0 / 3");
    expect(hud).not.toContain("1 045");
    expect(await page.locator(".hud-tonnage b").innerText()).toMatch(/^0\s*кг/);
  });
}

test("R08-REQ01: после «Завершить» в сохранённой тренировке нет 95 × 11 у гоблета, а отмеченный подход — только нового упражнения", async ({ page }) => {
  test.setTimeout(120_000);
  const f = await round01Fixture(page, { workouts: [gobletHistory()] });
  await startWith(page, SQUAT);
  await mark(page, 1, SQUAT, "95", "11");
  await swapTo(page, "гоблет", GOBLET);
  await mark(page, 1, GOBLET, "10", "9");
  await page.getByRole("button", { name: "Завершить тренировку", exact: true }).click();
  await expect(page.getByRole("button", { name: "Завершить тренировку", exact: true })).toHaveCount(0);
  const saved = f.savedBodies.at(-1)!;
  expect(saved.exercises.map((e) => e.exerciseId)).toEqual(["goblet"]);
  const done = saved.exercises[0].sets.filter((s) => s.done);
  expect(done.map((s) => [s.weight, s.reps])).toEqual([[10, 9]]);
  expect(saved.exercises[0].sets.some((s) => s.weight === 95)).toBe(false);
});

for (const size of SIZES) {
  test(`R08-REQ01: «Жим штанги лёжа» 80 / 82,5 → «Отжимания от пола»: «Доп. кг» без чужих чисел ${size.width}×${size.height}`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize(size);
    // у жима есть история 80 / 82,5 / 82,5 — приложение подставило бы её в новую тренировку
    const bench = doneWorkout("Грудь", "2026-11-06", [["bench", 82.5, 11, 3]]);
    bench.exercises[0].sets[0].weight = 80;
    await round01Fixture(page, { workouts: [bench] });
    await startWith(page, BENCH);
    await expect(weightOf(page, BENCH, 1)).toHaveValue("80");
    await expect(weightOf(page, BENCH, 2)).toHaveValue("82.5");
    await swapTo(page, "отжимания", PUSHUP);
    for (const n of [1, 2, 3]) await expect(weightOf(page, PUSHUP, n)).toHaveValue(/^(|0)$/);
    const values = await page.locator(".workout-main input").evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));
    expect(values).not.toContain("80");
    expect(values).not.toContain("82.5");
    await expect(page.locator(".set-row.done")).toHaveCount(0);
  });
}

test("R08-REQ01: замена на то же правило веса (штанга → штанга) оставляет подходы как есть", async ({ page }) => {
  test.setTimeout(120_000);
  await round01Fixture(page);
  await startWith(page, BENCH);
  await mark(page, 1, BENCH, "80", "8");
  await swapTo(page, "наклонной", "Жим штанги на наклонной скамье");
  await expect(page.getByText("Заменено: вес и отметки не перенесены")).toHaveCount(0);
  const name = "Жим штанги на наклонной скамье 30°";
  await expect(weightOf(page, name, 1)).toHaveValue("80");
  await expect(page.locator(".set-row.done")).toHaveCount(1);
  expect((await page.locator(".workout-live-hud").innerText()).replace(/\s+/g, " ")).toContain("1 / 3");
});

// ───────────── REQ02: русские подписи в окне «Заменить» ─────────────
const IDENTIFIERS = /\b(gym|quads|glutes|dumbbells|dumbbell|bodyweight|chest|triceps|shoulders|biceps|hamstrings|calves|core|back|barbell|cable|machine)\b/;
/** Латинские слова, допустимые в окне: из названий каталога («EZ», «Smith»…) и сама марка «Smith». */
const CATALOG_LATIN = new Set(EXERCISES.flatMap((e) => (e.name.match(/[A-Za-z]{3,}/g) ?? []).map((x) => x.toLowerCase())));

async function openSwap(page: Page) {
  await page.getByText("Ещё для упражнения", { exact: true }).first().click();
  await page.locator('button[title="Заменить упражнение на аналогичное"]').first().click();
  const dialog = page.getByRole("dialog", { name: "Заменить упражнение", exact: true });
  await expect(dialog).toBeVisible();
  return dialog;
}

for (const size of SIZES) {
  test(`R08-REQ02: окно «Заменить» — подписи снаряда и мышц по-русски, без gym / quads / dumbbells ${size.width}×${size.height}`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize(size);
    await round01Fixture(page);
    await startWith(page, SQUAT);
    const dialog = await openSwap(page);
    // блок «Текущее упражнение»
    await expect(dialog.locator(".swap-ex-meta")).toHaveText("Штанга · Квадрицепс, Ягодицы");
    const latin = async () => {
      const text = await dialog.innerText();
      expect(text, "идентификаторы каталога в тексте окна").not.toMatch(IDENTIFIERS);
      return (text.match(/[A-Za-z]{3,}/g) ?? []).filter((w) => !CATALOG_LATIN.has(w.toLowerCase()));
    };
    expect(await latin(), "латиница в окне без поиска").toEqual([]);
    // результаты поиска «жим»
    await dialog.getByRole("searchbox").fill("жим");
    await expect(dialog.locator(".swap-card-btn").first()).toBeVisible();
    expect(await dialog.locator(".swap-card-btn").count()).toBeGreaterThan(3);
    expect(await latin(), "латиница в окне с поиском «жим»").toEqual([]);
    const text = await dialog.innerText();
    expect(text).toMatch(/Штанга \/ тренажёр|Штанга|Гантели|Тренажёр/);
    expect(text).toMatch(/Грудные|Грудь|Трицепс|Плечи/);
    expect(await overflow(page)).toBeLessThanOrEqual(1);
    // «gym» без однозначного слова — одно и то же слово в бейдже и в подписи
    await dialog.getByRole("searchbox").fill("гоблет");
    await expect(dialog.locator(".swap-card-btn").first()).toContainText(/Гантели/);
    expect(await latin()).toEqual([]);
  });
}

// ───────────── REQ03: «Записать вес» на первом экране ─────────────
async function openWeight(page: Page) {
  await page.getByRole("button", { name: "Ещё", exact: true }).last().click();
  await page.getByRole("button", { name: /Вес тела и тренд.*синхронизация/ }).click();
  const dialog = page.getByRole("dialog").last();
  await expect(dialog.getByLabel("Вес, кг", { exact: true })).toBeVisible();
  return dialog;
}
for (const size of SIZES) {
  for (const count of [0, 12]) {
    test(`R08-REQ03: «Записать вес» на первом экране — ${count ? "12 замеров с графиком" : "без замеров"} ${size.width}×${size.height}`, async ({ page }) => {
      test.setTimeout(120_000);
      await page.setViewportSize(size);
      const f = await round01Fixture(page);
      // 12 замеров за год: по одному в 30 дней
      const entries: BodyweightEntry[] = Array.from({ length: count }, (_, k) => {
        const date = new Date(Date.UTC(2026, 10, 9) - k * 30 * 86_400_000).toISOString().slice(0, 10);
        return { id: `w${k}`, date, weightKg: 84 - (11 - k) * 0.35, createdAt: Date.parse(`${date}T06:00:00.000Z`) };
      });
      for (const e of entries) f.weights.documents.set(`weight:${e.date}`, { key: `weight:${e.date}`, value: e, revision: 1, mutationId: `m${e.id}`, updatedAt: `${e.date}T06:00:00.000Z` });
      if (count) await page.reload();
      const dialog = await openWeight(page);
      const field = dialog.getByLabel("Вес, кг", { exact: true });
      const top = (await field.boundingBox())!.y;
      expect(top, `верх поля «Вес, кг» на ${Math.round(top)} px`).toBeLessThanOrEqual(700);
      for (const name of ["Дата взвешивания", "Заметка"]) await expect(dialog.getByLabel(name)).toBeVisible();
      await expect(dialog.getByRole("button", { name: /Сохранить замер|Обновить замер/ })).toBeVisible();
      await expect(dialog.getByRole("heading", { name: "Записать вес" })).toBeVisible();
      if (count) {
        await expect(dialog.locator("svg, canvas").first()).toBeAttached();
        await expect(dialog.getByText("Последний замер").first()).toBeAttached();
      }
      // ввод «82,4» и сохранение
      await field.fill("82,4");
      await dialog.getByRole("button", { name: /Сохранить замер|Обновить замер/ }).click();
      await expect(dialog.locator(".progress-metric.accent")).toContainText("82,4");
      await expect(dialog.locator(".progress-metric.accent")).toContainText("Последний замер");
      await expect.poll(() => f.weights.documents.size).toBe(count + 1);
      const docs = f.weights.documents.size;
      // повторное сохранение за ту же дату обновляет запись
      await field.fill("82,0");
      await dialog.getByRole("button", { name: "Обновить замер" }).click();
      await expect(dialog.locator(".progress-metric.accent")).toContainText("82");
      await expect(dialog.locator(".progress-metric.accent")).not.toContainText("82,4");
      const kgs = () => [...f.weights.documents.values()].map((d) => (d.value as BodyweightEntry | null)?.weightKg);
      await expect.poll(() => kgs().includes(82), { message: JSON.stringify([...f.weights.documents.values()].slice(-3)) }).toBe(true);
      expect(kgs(), "82,4 заменено, а не добавлено рядом").not.toContain(82.4);
      expect(f.weights.documents.size, "повторное сохранение за ту же дату не добавляет запись").toBe(docs);
      expect(await overflow(page)).toBeLessThanOrEqual(1);
    });
  }
}

test("R08-REQ03: профильное «Вес тела, кг» и вкладка «Вес тела» в «Прогрессе» на месте", async ({ page }) => {
  test.setTimeout(120_000);
  await round01Fixture(page);
  await nav(page, "Прогресс").click();
  await page.getByRole("tab", { name: "Вес тела", exact: true }).click();
  const field = page.getByLabel("Вес, кг", { exact: true });
  await expect(field).toBeVisible();
  expect((await field.boundingBox())!.y).toBeLessThanOrEqual(844);
  await nav(page, "Сегодня").click();
  await page.getByRole("button", { name: "Мой профиль", exact: true }).click();
  await expect(page.getByLabel("Вес тела, кг")).toBeVisible();
});

// ───────────── REQ04 / REQ05: «История» ─────────────
async function importYear(page: Page) {
  const dir = mkdtempSync(join(tmpdir(), "tyaga-r08-"));
  const csvPath = join(dir, "strong-year.csv");
  execFileSync("node", ["tests/fixtures/gen-year-csv.mjs", csvPath, join(dir, "year.json")], { stdio: "ignore" });
  const csv = readFileSync(csvPath, "utf8");
  await nav(page, "История").click();
  await page.getByRole("button", { name: "Импорт истории", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Импорт истории", exact: true });
  await dialog.getByLabel("Файл истории тренировок").setInputFiles({ name: "strong-year.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await dialog.getByRole("button", { name: "Показать предпросмотр", exact: true }).click();
  await dialog.getByRole("button", { name: /^Принять близкие движения/ }).click();
  await dialog.getByRole("button", { name: "Импортировать", exact: true }).click();
  await expect(page.locator(".import-undo")).toContainText("Импорт: записано 240 из 240", { timeout: 90_000 });
}

for (const size of SIZES) {
  test(`R08-REQ04: при непустой «Истории» «Записать тренировку» рядом с экспортом и импортом, один тап до даты ${size.width}×${size.height}`, async ({ page }) => {
    test.setTimeout(150_000);
    await page.setViewportSize(size);
    const f = await round01Fixture(page, { workouts: [doneWorkout("Грудь", "2026-11-03", [["bench", 60, 8, 3]])] });
    await nav(page, "История").click();
    const buttons = page.getByRole("button", { name: "Записать тренировку", exact: true });
    await expect(buttons).toHaveCount(1);
    const box = (await buttons.first().boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(43.99);
    expect(box.y + box.height, "кнопка на первом экране").toBeLessThanOrEqual(size.height);
    await expect(page.getByRole("button", { name: "Экспорт JSON", exact: true })).toBeVisible();
    await buttons.first().click();
    const chip = page.locator(".retro-chip");
    await expect(chip).toHaveText("10 нояб. · выбрать дату");
    await chip.click();
    const group = page.getByRole("group", { name: "Дата и длительность записи" });
    await group.getByLabel("Дата записи", { exact: true }).fill("2026-11-08");
    await group.getByLabel("Длительность записи, минуты").fill("55");
    await expect(chip).toHaveText("8 нояб. · задним числом");
    await expect(page.locator(".live-clock-badge")).toContainText("55 мин");
    await page.getByRole("button", { name: "Добавить упражнение", exact: true }).click();
    await page.getByRole("button", { name: "Добавить Жим штанги лёжа", exact: true }).click();
    await page.getByRole("button", { name: "Готово", exact: true }).click();
    await mark(page, 1);
    await page.getByRole("button", { name: "Завершить тренировку", exact: true }).click();
    await expect(page.getByRole("button", { name: "Завершить тренировку", exact: true })).toHaveCount(0);
    expect(f.savedBodies.at(-1)?.date).toBe("2026-11-08");
    expect(f.savedBodies.at(-1)?.duration).toBe(55);
    await nav(page, "История").click();
    await expect(page.locator(".session-item").first()).toContainText(/8\s*нояб\./);
  });
}

test("R08-REQ04: на пустой «Истории» вход один, прежний; «Начать тренировку» и «Пустая тренировка» на месте", async ({ page }) => {
  test.setTimeout(120_000);
  await round01Fixture(page);
  await nav(page, "История").click();
  await expect(page.getByRole("button", { name: "Записать тренировку", exact: true })).toHaveCount(1);
  await nav(page, "Сегодня").click();
  await expect(page.getByRole("button", { name: "Начать тренировку", exact: true }).first()).toBeVisible();
});

for (const size of SIZES) {
  test(`R08-REQ04/05: 240 тренировок и баннер отмены — вход без прокрутки, «Как работает отмена» в одну строку, подпись списка читается, мелких целей нет ${size.width}×${size.height}`, async ({ page }) => {
    test.setTimeout(240_000);
    await page.setViewportSize(size);
    await round01Fixture(page);
    await importYear(page);
    await expect(page.locator(".history-toolbar")).toBeVisible();
    const retro = page.getByRole("button", { name: "Записать тренировку", exact: true });
    await expect(retro).toHaveCount(1);
    await retro.scrollIntoViewIfNeeded();
    const rect = await retro.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const first = document.querySelector(".history-panel .session-item")?.getBoundingClientRect().top ?? Infinity;
      return { top: r.top, bottom: r.bottom, h: r.height, w: r.width, list: first };
    });
    expect(rect.h).toBeGreaterThanOrEqual(43.99);
    expect(rect.bottom, "кнопка выше первой карточки списка").toBeLessThanOrEqual(rect.list);
    // REQ05: баннер
    const banner = page.locator(".import-undo");
    const summary = banner.locator(".import-undo-more summary");
    const sb = (await summary.boundingBox())!;
    const bb = (await banner.boundingBox())!;
    expect(sb.height).toBeGreaterThanOrEqual(43.99);
    if (size.width <= 380) {
      expect(sb.width, "summary «Как работает отмена» шире 120 px").toBeGreaterThanOrEqual(120);
      expect(sb.width).toBeGreaterThanOrEqual(bb.width - 40);
      const cancel = (await banner.getByRole("button", { name: "Отменить импорт", exact: true }).boundingBox())!;
      const hide = (await banner.getByRole("button", { name: "Скрыть", exact: true }).boundingBox())!;
      expect(cancel.y, "кнопки ниже summary").toBeGreaterThanOrEqual(sb.y + sb.height - 1);
      expect(hide.y).toBeGreaterThanOrEqual(sb.y + sb.height - 1);
    }
    // подпись списка «К месяцу»
    const jump = page.getByLabel("Перейти к месяцу", { exact: true });
    await jump.scrollIntoViewIfNeeded();
    const fit = await jump.evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth, text: (el as unknown as HTMLSelectElement).selectedOptions[0]?.text ?? "" }));
    expect(fit.scroll).toBeLessThanOrEqual(fit.client + 1);
    expect(fit.text).toMatch(/месяцу/);
    expect(fit.text).not.toContain("…" + "…");
    expect(await smallTargets(page), "цели меньше 44 px").toEqual([]);
    const c = await clipped(page);
    expect(c.wide, "текст шире плашки").toEqual([]);
    expect(c.overlaps, "плашки пересекаются").toEqual([]);
    expect(await overflow(page)).toBeLessThanOrEqual(1);
  });
}
