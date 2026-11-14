import { expect, type Page } from "@playwright/test";
import { DEFAULT_SETTINGS, makeWorkout } from "../../../src/lib/model";
import type { Workout } from "../../../src/lib/types";
import { mockWeights, weightFixture } from "./bodyweight";
import { mockLive } from "./live";

/** Фиксированное «сейчас»: вторник 10 ноября 2026, неделя с понедельника 9-го. */
export const NOW = new Date("2026-11-10T12:00:00Z");
const ZONE = "Europe/Saratov";

export type Round01Options = {
  workouts?: Workout[];
  /** Журнал веса отвечает только после `releaseWeights()`: так повторяется загрузка «уже после открытия профиля». */
  holdWeights?: boolean;
};

/** Законченная тренировка: подходы выполнены, `exercises` — [id, вес, повторы, число подходов]. */
export function doneWorkout(
  name: string,
  date: string,
  plan: [string, number, number, number][],
): Workout {
  const w = makeWorkout(plan.map(([id]) => id));
  w.name = name;
  w.date = date;
  w.timeZone = ZONE;
  w.createdAt = `${date}T10:00:00.000Z`;
  w.duration = 50;
  w.exercises.forEach((e, i) => {
    const [, weight, reps, count] = plan[i];
    e.sets = e.sets.slice(0, count).map((s) => ({ ...s, weight, reps, rir: 1, done: true }));
  });
  return w;
}

/**
 * Приложение целиком на подставных ответах: ни один запрос не уходит на воркер или D1.
 * Сохранённые тренировки и профиль живут в памяти страницы теста.
 */
export async function round01Fixture(page: Page, options: Round01Options = {}) {
  await page.clock.setFixedTime(NOW);
  const workouts: Workout[] = (options.workouts ?? []).map((w) => ({ ...w, revision: 1 }));
  const errors: string[] = [];
  const unexpected: string[] = [];
  const profileBodies: unknown[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const profile = {
    id: "round01-user",
    email: "round01@example.test",
    displayName: "Саша",
    timeZone: ZONE,
    bodyMassKg: null as number | null,
    revision: 1,
    createdAt: NOW.toISOString(),
  };
  await page.route("**/api/**", async (route) => {
    const r = route.request();
    const path = new URL(r.url()).pathname;
    const method = r.method();
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (path === "/api/auth/session") return json({ registered: true, profile });
    if (path === "/api/auth/profile" && method === "PUT") {
      const body = r.postDataJSON();
      profileBodies.push(body);
      Object.assign(profile, body, { revision: profile.revision + 1 });
      return json({ profile });
    }
    if (path === "/api/challenges") return json({ accountId: profile.id, challenges: [] });
    if (path === "/api/data")
      return json({ workouts, settings: { ...DEFAULT_SETTINGS, timeZone: ZONE } });
    if (path === "/api/product") return json({ routines: [], favorites: [], customExercises: [] });
    if (path === "/api/workouts" && method === "PUT") {
      const w = r.postDataJSON();
      const saved = { ...w, revision: 1 };
      workouts.unshift(saved);
      return json({ workout: saved });
    }
    if (path.startsWith("/api/friends"))
      return json({
        me: { id: profile.id, displayName: "Саша", inviteCode: "A1B2C3D4E5F6", gym: "", focus: "", activeUntil: 0, weekWorkouts: 0, weeklyTarget: 3 },
        friends: [], requests: [], feed: [], meetups: [],
        weekStart: "2026-11-09", today: "2026-11-10", serverTime: NOW.getTime(),
      });
    unexpected.push(`${method} ${path}`);
    return json({ error: "Не подставлено; запрос никуда не ушёл" }, 503);
  });
  const weights = weightFixture();
  await mockWeights(page, profile.id, weights);
  // Маршруты проверяются с последнего: этот ждёт и передаёт запрос дальше, в mockWeights.
  let releaseWeights = () => {};
  const gate = options.holdWeights ? new Promise<void>((done) => (releaseWeights = done)) : null;
  await page.route("**/api/bodyweight**", async (route, request) => {
    if (gate && request.method() === "GET") await gate;
    return route.fallback();
  });
  await mockLive(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Сегодня", exact: true })).toBeVisible();
  return { workouts, profile, profileBodies, weights, errors, unexpected, releaseWeights: () => releaseWeights() };
}

export const nav = (page: Page, name: string) =>
  page.getByRole("navigation", { name: "Основная навигация" }).getByRole("button", { name, exact: true });

/** Начать тренировку с «Сегодня» и добавить упражнения по названию. */
export async function startWith(page: Page, ...names: string[]) {
  await page.getByRole("button", { name: "Начать тренировку", exact: true }).first().click();
  await page.getByRole("button", { name: "Добавить упражнение", exact: true }).click();
  for (const name of names)
    await page.getByRole("button", { name: `Добавить ${name}`, exact: true }).click();
  await page.getByRole("button", { name: "Готово", exact: true }).click();
}
