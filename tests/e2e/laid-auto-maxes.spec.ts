import { test, expect, type Page } from "@playwright/test";
import { nav, round01Fixture, doneWorkout } from "./fixtures/round01";
import { LaidDupPlan } from "../../src/domain/LaidDupPlan";
import type { LaidMaxes, Routine, Workout } from "../../src/lib/types";

/**
 * Максимумы Лейда. По умолчанию тихого автоповышения нет: подход на 5 % выше действующего максимума
 * даёт подсказку с кнопкой «Пересчитать с недели N». Если в цикле явно включён autoEscalate —
 * план пересчитывается сам и приложение говорит об этом. «Сегодня» — вторник 10 нояб. 2026.
 */
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, locale: "ru-RU", timezoneId: "Europe/Saratov" });

const MAXES: LaidMaxes = { squat: 100, bench: 80, deadlift: 140, ohp: 60 };
const sixRoutines = (autoEscalate = false) =>
  LaidDupPlan.routines({ maxes: MAXES, extras: true, light: false, startMonday: "2026-11-09", autoEscalate }).map((r) => ({
    ...r,
    revision: 1,
  }));

/** Приложение с шестью программами цикла в памяти: PUT /api/routines сохраняет, GET /api/product отдаёт. */
async function laidApp(page: Page, workouts: Workout[], autoEscalate = false) {
  await round01Fixture(page, { workouts });
  const store: Routine[] = sixRoutines(autoEscalate);
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
  await page.reload();
  return { store, puts };
}

test("R12-АВТО: по умолчанию подход на 12,5 % выше максимума сам ничего не пересчитывает — только подсказка", async ({ page }) => {
  const { store, puts } = await laidApp(page, [doneWorkout("Жим", "2026-11-10", [["bench", 90, 1, 1]])]);
  await nav(page, "Программы").click();
  // тихого пересчёта нет: цикл не меняется, пока пользователь не нажмёт кнопку
  await expect(page.locator(".laid-suggest")).toContainText("Можно обновить максимум: жим лёжа 80 → 90 кг.");
  await expect(page.getByRole("button", { name: "Пересчитать с недели 1", exact: true })).toBeVisible();
  await page.waitForTimeout(700);
  expect(puts.length).toBe(0);
  expect(store.every((r) => r.periodization!.maxes.bench === 80)).toBe(true);
  await expect(page.getByText(/Максимумы обновлены автоматически/)).toHaveCount(0);
});

test("R12-АВТО: с включённым «Автоповышением 1ПМ» подход на 12,5 % выше максимума поднимает его сам — шесть программ, без повторных пересчётов", async ({ page }) => {
  const { store, puts } = await laidApp(page, [doneWorkout("Жим", "2026-11-10", [["bench", 90, 1, 1]])], true);
  // уведомление живёт на экране «Программы»
  await nav(page, "Программы").click();
  // пересчёт идёт сам, без нажатий: ждём уведомление и сохранение всех шести программ
  await expect(page.getByText(/Максимумы обновлены автоматически: жим лёжа 80 → 90 кг/)).toBeVisible();
  await expect.poll(() => puts.length).toBe(6);
  expect(store.every((r) => r.periodization!.maxes.bench === 90 && r.periodization!.maxes.squat === 100)).toBe(true);
  expect(store.map((r) => r.periodization!.maxesFromWeek)).toEqual([0, 0, 0, 0, 0, 0]);
  // второй проход того же правила не случается: те же подходы больше не поднимают максимум
  await page.waitForTimeout(700);
  expect(puts.length).toBe(6);
  // карточка и расписание показывают новые числа
  await nav(page, "Программы").click();
  await expect(page.locator(".laid-card-maxes").filter({ hasText: "жим лёжа" })).toContainText("90 кг");
});

test("R12-АВТО: без роста на 5 % ничего не пересчитывается и уведомления нет", async ({ page }) => {
  const { store, puts } = await laidApp(page, [doneWorkout("Жим", "2026-11-10", [["bench", 83, 1, 1]])]);
  await nav(page, "Программы").click();
  await expect(page.getByRole("heading", { name: "Сохранённые программы" })).toBeVisible();
  await page.waitForTimeout(700);
  expect(puts.length).toBe(0);
  expect(store.every((r) => r.periodization!.maxes.bench === 80)).toBe(true);
  await expect(page.getByText(/Максимумы обновлены автоматически/)).toHaveCount(0);
  await expect(page.locator(".laid-card-maxes").filter({ hasText: "жим лёжа" })).toContainText("80 кг");
});
