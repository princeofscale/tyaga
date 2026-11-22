import { mkdir } from "node:fs/promises";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { TrainingProgram } from "../../src/domain/TrainingProgram";
import { makeExerciseEntry, makeSets } from "../../src/lib/model";
import { doneWorkout, nav, round01Fixture } from "./fixtures/round01";

const plan = (id: string, name: string, day: number, exercises: string[]) => ({
  ...TrainingProgram.empty(), id, name, days: [day],
  exercises: exercises.map((exercise) => ({ ...makeExerciseEntry(exercise), sets: makeSets(3, 60, 8) })),
});
const push = plan("design-bench", "Жим · объём", 0, ["bench", "ohp", "triceps-push"]);
const pull = plan("design-pull", "Тяга · сила", 1, ["deadlift-bar", "row", "lat-pulldown"]);
const legs = plan("design-legs", "Ноги", 4, ["squat", "rdl", "legpress"]);

async function openPrograms(page: Page) {
  const logged = { ...doneWorkout("Жим · объём", "2026-11-09", [["bench", 70, 8, 3]]), routineId: push.id };
  const fixture = await round01Fixture(page, { routines: [push, pull, legs], workouts: [logged] });
  await nav(page, "Программы").click();
  await expect(page.getByRole("heading", { name: "План на неделю", exact: true })).toBeVisible();
  await expect(page.locator(".day-session.completed")).toContainText("Записано");
  await expect(page.locator(".program-day.today")).toContainText("Тяга · сила");
  return fixture;
}

async function measureLayout(page: Page) {
  return page.locator(".programs-ledger").evaluate((pane) => {
    const days = [...pane.querySelectorAll(".program-day")].map((day) => day.getBoundingClientRect());
    const targets = [...pane.querySelectorAll<HTMLButtonElement>("button")].flatMap((button) => {
      const rect = button.getBoundingClientRect();
      return rect.width && ((rect.width < 43.9) || (rect.height < 43.9)) ? [button.textContent?.trim() || button.ariaLabel] : [];
    });
    return { rows: new Set(days.map((rect) => rect.y)).size, days: days.length, targets,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth };
  });
}

async function saveScreenshot(page: Page, name: string) {
  await page.evaluate(() => document.fonts.ready.then(() => null));
  await mkdir("artifacts/programs-ledger", { recursive: true });
  await page.screenshot({ path: "artifacts/programs-ledger/" + name + ".png", fullPage: true, animations: "disabled" });
}

async function sampleWeekEntry(button: Locator) {
  return button.evaluate(async (control) => {
    const initialWeek = document.querySelector(".program-week");
    const x: number[] = [];
    (control as HTMLButtonElement).click();
    for (let frame = 0; frame < 24; frame++) {
      await new Promise(requestAnimationFrame);
      const week = document.querySelector(".program-week");
      if (week && week !== initialWeek) x.push(new DOMMatrixReadOnly(getComputedStyle(week).transform).m41);
    }
    return x;
  });
}

test.use({ serviceWorkers: "block" });

test("weekly calendar enters from the chosen direction, keeps focus and has one set of controls", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 920 });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  const fixture = await openPrograms(page);
  const next = page.getByRole("button", { name: "Следующая неделя плана", exact: true });
  const previous = page.getByRole("button", { name: "Предыдущая неделя плана", exact: true });
  const week = page.locator(".program-week");
  await expect(week).toHaveCSS("transform", "none");
  await saveScreenshot(page, "programs-desktop");
  await next.focus();
  const forward = await sampleWeekEntry(next);
  expect(forward.some((x) => x > 1)).toBe(true);
  await expect(next).toBeFocused();
  await expect(week).toHaveCount(1);
  await expect(week.locator(".program-day").first()).toHaveAttribute("data-date", "2026-11-16");
  await expect(week).toHaveCSS("transform", "none");
  await previous.focus();
  const backward = await sampleWeekEntry(previous);
  expect(backward.some((x) => x < -1)).toBe(true);
  await expect(previous).toBeFocused();
  await expect(week.locator(".program-day").first()).toHaveAttribute("data-date", "2026-11-09");
  await expect(week).toHaveCSS("transform", "none");
  expect(await measureLayout(page)).toEqual({ rows: 1, days: 7, targets: [], overflow: 0 });
  await expect(page.getByRole("heading", { name: "Сохранённые программы", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Шаблоны", exact: true })).toBeVisible();
  await expect(page.locator(".programs-ledger")).not.toContainText(/Собери свой ритм|Отправная точка|ТВОИ ШАБЛОНЫ/);
  expect(fixture.errors).toEqual([]);
});

test("mobile Programs reflows without small targets and skips motion when requested", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  const fixture = await openPrograms(page);
  await saveScreenshot(page, "programs-mobile");
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 800 });
    expect(await measureLayout(page)).toEqual({ rows: 7, days: 7, targets: [], overflow: 0 });
  }
  await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
  expect(await measureLayout(page)).toEqual({ rows: 7, days: 7, targets: [], overflow: 0 });
  await page.evaluate(() => { document.documentElement.style.fontSize = ""; });
  const next = page.getByRole("button", { name: "Следующая неделя плана", exact: true });
  const reduced = await sampleWeekEntry(next);
  expect(reduced.length).toBeGreaterThan(0);
  expect(reduced.every((x) => Math.abs(x) < 0.01)).toBe(true);
  const today = page.locator(".program-week-controls").getByRole("button", { name: "Сегодня", exact: true });
  await today.focus();
  await today.press("Enter");
  await expect(today).toBeFocused();
  const thrust = page.locator(".routine-card").filter({ has: page.getByRole("heading", { name: "Тяга · сила", exact: true }) });
  await expect(thrust.getByRole("list", { name: "Упражнения программы" })).toContainText("3 × 8");
  const edit = thrust.getByRole("button", { name: "Редактировать программу Тяга · сила" });
  await edit.click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
  await page.locator(".starter-card").filter({ hasText: "Дэвид Лейд" }).click();
  await expect(page.getByRole("dialog")).toContainText("Дэвид Лейд");
  expect(fixture.errors).toEqual([]);
});
