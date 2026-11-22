import { expect, test, type Page } from "@playwright/test";
import type { AccountProfile } from "../../src/lib/account";
import type { ProductData, Routine, Workout } from "../../src/lib/types";
import { mockWeights } from "./fixtures/bodyweight";
import { mockLive } from "./fixtures/live";

// The clocks fall back in Amsterdam on Sunday 26 October. At both instants,
// Amsterdam is already on the next calendar day compared with the browser.
const SUNDAY = "2025-10-26";
const MONDAY = "2025-10-27";
const TUESDAY = "2025-10-28";
const NEXT_SUNDAY = "2025-11-02";
const SUNDAY_NOW = new Date("2025-10-25T22:30:00Z");
const MONDAY_NOW = new Date("2025-10-26T23:30:00Z");
const PLAN = "Жим по плану";
const BENCH = "Жим штанги лёжа";

test.use({ locale: "ru-RU", timezoneId: "America/Los_Angeles", reducedMotion: "reduce", serviceWorkers: "block" });

async function startCalendar(page: Page, days: number[]) {
  const profile: AccountProfile = {
    id: "calendar-user", email: "calendar@example.test", displayName: "Саша",
    timeZone: "Europe/Amsterdam", bodyMassKg: null, revision: 1, createdAt: SUNDAY_NOW.toISOString(),
  };
  const baseline: Routine = {
    id: "calendar-bench", name: PLAN, notes: "", days, revision: 1,
    restSeconds: 90, progression: "repeat", repMin: 6, repMax: 12, incrementKg: 2.5,
    exercises: [{
      exerciseId: "bench", displayNameSnapshot: BENCH,
      catalogRevision: 2, recordingSpecRevision: 2, muscleMappingRevision: 2, muscleModelRevision: 1,
      sets: [{ id: "calendar-set", weight: 60, reps: 8, rir: 2, warmup: false, done: false }],
    }],
  };
  // The route state is independent of the document and survives reload. Native
  // backup/SQL persistence is exercised separately in training-calendar.test.ts.
  const state = { routine: baseline, workouts: [] as Workout[] };
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    switch (request.method() + " " + path) {
      case "GET /api/auth/session":
        return route.fulfill({ json: { registered: true, profile } });
      case "GET /api/product":
        return route.fulfill({ json: { routines: [state.routine], customExercises: [], favorites: [] } satisfies ProductData });
      case "GET /api/data":
        return route.fulfill({ json: { workouts: state.workouts,
          settings: { goals: {}, equipment: "gym", restSeconds: 90, timeZone: profile.timeZone },
        } });
      case "GET /api/import/runs":
        return route.fulfill({ json: { runs: [], pending: [] } });
      case "GET /api/challenges":
        return route.fulfill({ json: { accountId: profile.id, challenges: [] } });
      case "PUT /api/routines": {
        const routine = request.postDataJSON() as Routine;
        if (routine.id !== state.routine.id || routine.revision !== state.routine.revision)
          return route.fulfill({ status: 409, json: { currentRoutine: state.routine } });
        state.routine = { ...routine, revision: routine.revision + 1 };
        return route.fulfill({ json: { routine: state.routine } });
      }
      case "PUT /api/workouts": {
        const workout = { ...request.postDataJSON() as Workout, revision: 1 };
        state.workouts = [workout, ...state.workouts.filter((entry) => entry.id !== workout.id)];
        return route.fulfill({ json: { workout } });
      }
      default:
        return route.fulfill({ status: 404, json: { error: "No calendar fixture for " + path } });
    }
  });
  await mockWeights(page, profile.id);
  await mockLive(page);
  await page.clock.setFixedTime(SUNDAY_NOW);
  await page.goto("/");
  return { state, baseline };
}

function expectOverride(current: Routine, baseline: Routine, to: string | null | undefined) {
  const { occurrenceOverrides, revision, ...template } = current;
  expect(revision).toBeGreaterThan(baseline.revision);
  expect({ ...template, revision: baseline.revision }).toStrictEqual(baseline);
  expect(occurrenceOverrides).toEqual(to === undefined ? undefined : [{ from: SUNDAY, to }]);
}

const nav = (page: Page, name: string) =>
  page.getByRole("navigation", { name: "Основная навигация" }).getByRole("button", { name, exact: true });

const plannerHeading = (page: Page) => page.getByRole("heading", { name: "План на неделю" });
const day = (page: Page, date: string) => page.locator(`.program-day[data-date="${date}"]`);
const slots = (page: Page, date: string) => day(page, date).getByRole("button", { name: /^Жим по плану/ });
const adjust = (page: Page, date: string) => day(page, date).getByRole("button", { name: /^Изменить план:/ });
const editor = (page: Page) => page.getByRole("dialog", { name: "Изменить тренировку в плане" });
const dateField = (page: Page) => editor(page).getByLabel("Новая дата", { exact: true });
const nextWeek = (page: Page) => page.getByRole("button", { name: "Следующая неделя плана" });
const overview = (page: Page) => page.getByRole("region", { name: PLAN, exact: true });
const startToday = (page: Page) => overview(page).getByRole("button", { name: "Начать тренировку", exact: true });

async function openPlanner(page: Page) {
  await nav(page, "Программы").click();
  await expect(plannerHeading(page)).toBeVisible();
}

async function moveTo(page: Page, date: string) {
  await dateField(page).fill(date);
  await editor(page).getByRole("button", { name: "Перенести", exact: true }).click();
  await expect(editor(page)).toBeHidden();
}

async function saveSet(page: Page, weight: string) {
  await page.getByLabel(`${BENCH}, подход 1, вес`, { exact: true }).fill(weight);
  await page.getByLabel(`${BENCH}, подход 1, повторы`, { exact: true }).fill("8");
  await page.getByRole("button", { name: `Отметить выполненным: ${BENCH}, подход 1`, exact: true }).click();
  await page.getByRole("button", { name: "Завершить тренировку", exact: true }).click();
  await expect(page.getByText("Тренировка сохранена", { exact: true })).toBeVisible();
}

test.describe("calendar on a narrow touch screen", () => {
  test.use({ viewport: { width: 320, height: 720 }, hasTouch: true, isMobile: true });

  test("moves, skips and restores one date across the DST week boundary", async ({ page }) => {
    const { state, baseline } = await startCalendar(page, [6]);
    await expect(startToday(page)).toBeVisible();
    await openPlanner(page);
    await expect(day(page, SUNDAY).locator("time[aria-current=date]")).toHaveAttribute("datetime", SUNDAY);

    await adjust(page, SUNDAY).focus();
    await page.keyboard.press("Enter");
    await expect(dateField(page)).toBeFocused();
    await expect(dateField(page)).toHaveAttribute("min", SUNDAY);
    await page.keyboard.press("Escape");
    await expect(editor(page)).toBeHidden();
    await expect(adjust(page, SUNDAY)).toBeFocused();

    await adjust(page, SUNDAY).tap();
    await expect(editor(page).locator("time")).toHaveAttribute("datetime", SUNDAY);
    await moveTo(page, TUESDAY);
    await expect(plannerHeading(page)).toBeFocused();
    await expect(slots(page, SUNDAY)).toContainText("Перенесено на");
    expectOverride(state.routine, baseline, TUESDAY);
    await nav(page, "Сегодня").click();
    await expect(page.getByText("День отдыха", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Следующая: Вт/ })).toBeVisible();

    await openPlanner(page);
    await nextWeek(page).click();
    await expect(day(page, MONDAY)).toContainText("Свободный день");
    await expect(slots(page, TUESDAY)).toContainText("С 26");
    await expect(slots(page, NEXT_SUNDAY)).not.toContainText(/Перенесено|Пропущено/);
    await expect(slots(page, NEXT_SUNDAY)).toHaveCount(1);

    await adjust(page, TUESDAY).tap();
    await expect(editor(page).locator("time")).toHaveCount(2);
    await editor(page).getByRole("button", { name: "Пропустить", exact: true }).click();
    await expect(editor(page)).toBeHidden();
    await expect(day(page, TUESDAY)).toContainText("Свободный день");
    expectOverride(state.routine, baseline, null);

    await page.reload();
    await openPlanner(page);
    await expect(slots(page, SUNDAY)).toContainText("Пропущено");
    await slots(page, SUNDAY).tap();
    await editor(page).getByRole("button", { name: "Вернуть в план", exact: true }).click();
    await expect(editor(page)).toBeHidden();
    await expect(adjust(page, SUNDAY)).toBeVisible();
    expectOverride(state.routine, baseline, undefined);
    await nextWeek(page).click();
    await expect(day(page, TUESDAY)).toContainText("Свободный день");
    await expect(slots(page, NEXT_SUNDAY)).toHaveCount(1);
    await nav(page, "Сегодня").click();
    await expect(startToday(page)).toBeVisible();
  });
});

test("starts the exact occurrence, saves its original date, and shows completed Today", async ({ page }) => {
  const { state, baseline } = await startCalendar(page, [0, 6]);
  await openPlanner(page);
  await adjust(page, SUNDAY).click();
  await moveTo(page, MONDAY);
  await page.clock.setFixedTime(MONDAY_NOW);
  await page.reload();
  await expect(page.locator(".today-head time")).toHaveAttribute("datetime", MONDAY);
  await openPlanner(page);
  await expect(slots(page, MONDAY)).toHaveCount(2);

  // Select the ordinary Monday slot, not the earlier Sunday slot moved to it.
  await slots(page, MONDAY).filter({ hasText: "1 упражнение" }).click();
  await saveSet(page, "60");
  expect(state.workouts).toMatchObject([{ routineId: baseline.id, date: MONDAY, programDate: MONDAY }]);
  await nav(page, "Сегодня").click();
  await expect(overview(page).getByText("По программе", { exact: true })).toBeVisible();
  await startToday(page).click();
  await expect(page.getByRole("button", { name: "Завершить тренировку", exact: true })).toBeVisible();
  await saveSet(page, "70");

  expect(state.workouts).toHaveLength(2);
  expect(state.workouts.find((w) => w.programDate === SUNDAY)).toMatchObject({
    routineId: baseline.id, date: MONDAY, programDate: SUNDAY,
    exercises: [{ sets: [{ weight: 70, reps: 8, done: true }] }],
  });
  expectOverride(state.routine, baseline, MONDAY);

  await page.reload();
  await expect(overview(page).getByText("Выполнено", { exact: true })).toBeVisible();
  await expect(startToday(page)).toHaveCount(0);
  await expect(overview(page).getByRole("button", { name: "Пустая тренировка", exact: true })).toBeVisible();
  await expect(overview(page).getByRole("button", { name: /^Следующая: Вс/ })).toBeVisible();
  await overview(page).getByRole("button", { name: "Посмотреть запись", exact: true }).click();
  await expect(page.getByRole("dialog", { name: PLAN })).toContainText(/70 кг × 8/);
});