import { expect, test, type Page } from "@playwright/test";
import { LaidDupPlan } from "../../src/domain/LaidDupPlan";
import type { LaidMaxes, Routine } from "../../src/lib/types";
import { nav, round01Fixture } from "./fixtures/round01";
import { clipped, smallTargets } from "./fixtures/touch";

const MAXES: LaidMaxes = { squat: 100, bench: 80, deadlift: 140, ohp: 60 };
const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

async function setupLaid(page: Page, startMonday: string, todayIso: string, routines?: Routine[]) {
  await round01Fixture(page);
  const store: Routine[] = [
    ...(routines ?? LaidDupPlan.routines({ maxes: MAXES, extras: true, light: false, startMonday }).map((r) => ({ ...r, revision: 1 }))),
  ];
  const puts: Routine[] = [];
  await page.route("**/api/product", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ routines: store, favorites: [], customExercises: [] }) }),
  );
  await page.route("**/api/routines", (route) => {
    if (route.request().method() !== "PUT") return route.fallback();
    const body = route.request().postDataJSON() as Routine;
    const at = store.findIndex((r) => r.id === body.id);
    const saved = { ...body, revision: (at === -1 ? 0 : store[at].revision) + 1, updatedAt: new Date().toISOString() };
    if (at === -1) store.unshift(saved);
    else store[at] = saved;
    puts.push(saved);
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ routine: saved }) });
  });
  await page.clock.setFixedTime(new Date(`${todayIso}T12:00:00Z`));
  await page.reload();
  await nav(page, "Программы").click();
  await expect(page.getByRole("heading", { name: "План на неделю", exact: true })).toBeVisible();
  return { store, puts };
}

test.use({ locale: "ru-RU", timezoneId: "Europe/Saratov", serviceWorkers: "block" });

test("План на неделю скрывает цикл Лейда до даты старта и позволяет перейти к неделе старта", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 860 });
  // Сегодня Вс 22 нояб., старт цикла — Пн 23 нояб.
  await setupLaid(page, "2026-11-23", "2026-11-22");

  // На текущей неделе (16–22 нояб.) нет ни одной тренировки Лейда
  const week = page.locator(".program-week");
  await expect(week.locator(".day-session")).toHaveCount(0);
  await expect(page.locator(".program-week-upcoming")).toContainText("Дэвид Лейд · DUP начнётся 23 нояб.");

  // Кнопка «К неделе старта» переносит календарь прямо на 23–29 нояб.
  await page.getByRole("button", { name: "К неделе старта", exact: true }).click();
  await expect(week.locator(".program-day").first()).toHaveAttribute("data-date", "2026-11-23");
  await expect(week.locator('.program-day[data-date="2026-11-23"]')).toContainText("Лейд · Ноги 1");
  await expect(week.locator('.program-day[data-date="2026-11-28"]')).toContainText("Лейд · Тяга 2");
  await expect(week.locator('.program-day[data-date="2026-11-29"]')).toContainText("Свободный день");
});

test("Перестановка дней цикла Лейда (Пн Жим 1, Вт Тяга 1, Ср отдых, Чт Жим 2, Пт Тяга 2, Сб–Вс Ноги) обновляет план, карточку и расписание без поломок", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { store } = await setupLaid(page, "2026-11-23", "2026-11-22");

  const lead = page.getByLabel("Программа Дэвида Лейда");
  await lead.getByRole("button", { name: "Дни недели", exact: true }).click();
  const dlg = page.getByRole("dialog", { name: "Дни недели · Дэвид Лейд" });
  await expect(dlg).toBeVisible();

  // Двигаем: Ноги 1 на Сб/Вс, Ноги 2 на Сб/Вс, День отдыха на Ср (кнопками ↑/↓ — доступно и на телефоне, и с клавиатуры)
  // Старт: [Ноги 1, Жим 1, Тяга 1, Ноги 2, Жим 2, Тяга 2, Отдых]
  for (let i = 0; i < 6; i++) {
    await dlg.locator('[data-slot="legs1"] .laid-move-down').click();
  }
  // Теперь: [Жим 1, Тяга 1, Ноги 2, Жим 2, Тяга 2, Отдых, Ноги 1]
  for (let i = 0; i < 3; i++) {
    await dlg.locator('[data-slot="legs2"] .laid-move-down').click();
  }
  // Теперь: [Жим 1, Тяга 1, Жим 2, Тяга 2, Отдых, Ноги 2, Ноги 1]
  await dlg.locator('[data-slot="rest"] .laid-move-up').click();
  await dlg.locator('[data-slot="rest"] .laid-move-up').click();
  // Теперь: [Жим 1, Тяга 1, Отдых, Жим 2, Тяга 2, Ноги 2, Ноги 1]
  await dlg.locator('[data-slot="legs1"] .laid-move-up').click();
  // Итог: [Жим 1, Тяга 1, Отдых, Жим 2, Тяга 2, Ноги 1, Ноги 2]

  const order = await dlg.locator(".laid-week-slot").evaluateAll((els) => els.map((el) => el.getAttribute("data-slot")));
  expect(order).toEqual(["push1", "pull1", "rest", "push2", "pull2", "legs1", "legs2"]);
  await expect(dlg.locator(".laid-week-hints")).toContainText("Ноги 1 и Ноги 2 стоят подряд (Сб–Вс)");

  // На 390px нет горизонтального переполнения и обрезки
  expect(await overflow(page)).toBeLessThanOrEqual(1);
  expect((await clipped(page, "dialog[open]")).wide).toEqual([]);

  await dlg.getByRole("button", { name: "Сохранить расписание", exact: true }).click();
  await expect(dlg).toBeHidden();
  await expect(page.locator(".laid-notice")).toContainText("Дни цикла Лейда обновлены: выходной — Ср.");

  // Проверяем обновлённые дни в хранилище
  const byDay = Object.fromEntries(store.map((r) => [r.periodization!.day, r.days]));
  expect(byDay).toEqual({ push1: [0], pull1: [1], push2: [3], pull2: [4], legs1: [5], legs2: [6] });

  // Карточка «Дэвид Лейд · DUP» показывает дни в новом порядке (Пн Жим 1 … Вс Ноги 2) и выходной Ср
  await expect(lead).toContainText("выходной Ср");
  const cardOrder = await lead.locator(".laid-day-tile b").allTextContents();
  expect(cardOrder).toEqual(["Жим 1", "Тяга 1", "Жим 2", "Тяга 2", "Ноги 1", "Ноги 2"]);

  // На неделе старта 23–29 нояб. календарь «План на неделю» показывает ровно новую раскладку
  await page.getByRole("button", { name: "К неделе старта", exact: true }).click();
  const week = page.locator(".program-week");
  await expect(week.locator('.program-day[data-date="2026-11-23"]')).toContainText("Лейд · Жим 1");
  await expect(week.locator('.program-day[data-date="2026-11-24"]')).toContainText("Лейд · Тяга 1");
  await expect(week.locator('.program-day[data-date="2026-11-25"]')).toContainText("Свободный день");
  await expect(week.locator('.program-day[data-date="2026-11-26"]')).toContainText("Лейд · Жим 2");
  await expect(week.locator('.program-day[data-date="2026-11-27"]')).toContainText("Лейд · Тяга 2");
  await expect(week.locator('.program-day[data-date="2026-11-28"]')).toContainText("Лейд · Ноги 1");
  await expect(week.locator('.program-day[data-date="2026-11-29"]')).toContainText("Лейд · Ноги 2");

  // Цели касания ≥ 44px и нет переполнения на 320px
  await page.setViewportSize({ width: 320, height: 640 });
  expect(await overflow(page)).toBeLessThanOrEqual(1);
  expect(await smallTargets(page)).toEqual([]);
});

test("Перетаскивание мышью за ручку и клавиатурный режим (Space + Arrow + Esc) работают без закрытия окна", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 860 });
  await setupLaid(page, "2026-11-23", "2026-11-22");
  await page.getByLabel("Программа Дэвида Лейда").getByRole("button", { name: "Дни недели", exact: true }).click();
  const dlg = page.getByRole("dialog", { name: "Дни недели · Дэвид Лейд" });

  // Клавиатурный режим: захватить Ноги 1, сдвинуть на Вт, затем отменить по Esc (модалка остаётся открытой!)
  const handle = dlg.locator('[data-slot="legs1"] .laid-drag-handle');
  await handle.focus();
  await page.keyboard.press("Space");
  await expect(handle).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("ArrowDown");
  expect(await dlg.locator(".laid-week-slot").first().getAttribute("data-slot")).toBe("push1");
  await page.keyboard.press("Escape");
  await expect(dlg).toBeVisible();
  await expect(handle).toHaveAttribute("aria-pressed", "false");
  expect(await dlg.locator(".laid-week-slot").first().getAttribute("data-slot")).toBe("legs1");

  // Перетаскивание за ручку: переносим Отдых (Вс) в позицию между Тягой 1 и Ногами 2 (Чт)
  const restHandle = dlg.locator('[data-slot="rest"] .laid-drag-handle');
  const legs2Row = dlg.locator('[data-slot="legs2"]');
  const fromBox = (await restHandle.boundingBox())!;
  const toBox = (await legs2Row.boundingBox())!;
  await page.mouse.move(fromBox.x + fromBox.width / 2, fromBox.y + fromBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(toBox.x + toBox.width / 2, toBox.y + 4, { steps: 10 });
  await expect(dlg.locator(".laid-week-editor-list")).toHaveAttribute("data-drop", "active");
  await page.mouse.up();
  const afterDrag = await dlg.locator(".laid-week-slot").evaluateAll((els) => els.map((el) => el.getAttribute("data-slot")));
  expect(afterDrag).toEqual(["legs1", "push1", "pull1", "rest", "legs2", "push2", "pull2"]);
});
