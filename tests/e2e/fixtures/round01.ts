import { expect, type Page } from "@playwright/test";
import { DEFAULT_SETTINGS, makeWorkout } from "../../../src/lib/model";
import type { Exercise, Routine, Workout } from "../../../src/lib/types";
import { PersonalExerciseFactory } from "../../../server/PersonalExerciseFactory";
import { mockWeights, weightFixture } from "./bodyweight";
import { mockLive } from "./live";

/** Фиксированное «сейчас»: вторник 10 ноября 2026, неделя с понедельника 9-го. */
export const NOW = new Date("2026-11-10T12:00:00Z");
const ZONE = "Europe/Saratov";

export type Round01Options = {
  workouts?: Workout[];
  /** Программы пользователя (`/api/product`). */
  routines?: Routine[];
  /** Незавершённые импорты, которые сервер показывает как черновик (`GET /api/import/runs`). */
  pendingImports?: Array<{ runId: string; total: number }>;
  /** Журнал веса отвечает только после `releaseWeights()`: так повторяется загрузка «уже после открытия профиля». */
  holdWeights?: boolean;
  /** Выход из аккаунта: приложение стартует без входа, `POST /api/auth/register|login` впускает (другая почта — другой аккаунт). */
  signedOut?: boolean;
  /** Личные упражнения аккаунта (`/api/product`); импорт добавляет к ним «Мои» так же, как воркер. */
  customExercises?: Exercise[];
  /** Точные совпадения базы упражнений для `POST /api/exercises/resolve` (имя из файла → упражнения). */
  resolveMatches?: Record<string, Exercise[]>;
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
  const importBodies: any[] = [];
  const deleted: string[] = [];
  const savedBodies: Workout[] = [];
  const recoveryRequests: Array<{ currentPassword?: string }> = [];
  /** Серверные квитанции импорта: запись, отмена и «уже отменён» ведут себя как на воркере. */
  const customs: Exercise[] = [...(options.customExercises ?? [])];
  const customPuts: unknown[] = [];
  const staged = new Map<string, any[]>();
  const customByKey = new Map<string, Exercise>();
  const runs: Array<{ runId: string; manifestHash: string; at: string; total: number; ids: string[] }> = [];
  const undone = new Set<string>();
  const pending = (options.pendingImports ?? []).map((p) => ({ ...p, manifestHash: "pending", at: NOW.toISOString() }));
  page.on("pageerror", (e) => errors.push(e.message));
  let signedIn = !options.signedOut;
  const other = { id: "round01-user-b", email: "other@example.test", displayName: "Вика", timeZone: ZONE, bodyMassKg: null as number | null, revision: 1, createdAt: NOW.toISOString() };
  const profile = {
    id: "round01-user",
    email: "round01@example.test",
    displayName: "Саша",
    timeZone: ZONE,
    bodyMassKg: null as number | null,
    revision: 1,
    createdAt: NOW.toISOString(),
  };
  let active: typeof profile = profile;
  await page.route("**/api/**", async (route) => {
    const r = route.request();
    const path = new URL(r.url()).pathname;
    const method = r.method();
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (path === "/api/auth/session") return json({ registered: true, profile: signedIn ? active : null });
    if (path === "/api/auth/logout" && method === "POST") {
      signedIn = false;
      return json({ ok: true });
    }
    if ((path === "/api/auth/register" || path === "/api/auth/login") && method === "POST") {
      const body = r.postDataJSON();
      active = body.email === other.email ? other : profile;
      signedIn = true;
      return json({ profile: active, ...(path.endsWith("register") ? { recoveryCode: "RECOVERY-1" } : {}) }, path.endsWith("register") ? 201 : 200);
    }
    if (path === "/api/auth/recovery-code" && method === "POST") {
      recoveryRequests.push(r.postDataJSON());
      if (r.postDataJSON().currentPassword !== "correct horse battery")
        return json({ error: "Текущий пароль не подошёл." }, 401);
      return json({ recoveryCode: `0123456789abcdef0123456789abcd${String(recoveryRequests.length).padStart(2, "0")}` });
    }
    if (path === "/api/auth/profile" && method === "PUT") {
      const body = r.postDataJSON();
      profileBodies.push(body);
      Object.assign(profile, body, { revision: profile.revision + 1 });
      return json({ profile });
    }
    if (path === "/api/challenges") return json({ accountId: profile.id, challenges: [] });
    if (path === "/api/data")
      return json({ workouts: active === profile ? workouts : [], settings: { ...DEFAULT_SETTINGS, timeZone: ZONE } });
    if (path === "/api/product") return json({ routines: options.routines ?? [], favorites: [], customExercises: customs });
    if (path === "/api/exercises/resolve" && method === "POST") {
      const names: string[] = r.postDataJSON().names ?? [];
      return json({ matches: Object.fromEntries(names.map((n) => [n, options.resolveMatches?.[n] ?? []])) });
    }
    if (path === "/api/import/metadata" && method === "POST") return json({ idMap: {}, exercises: [] });
    if (path === "/api/custom-exercises" && method === "PUT") {
      const body = r.postDataJSON();
      customPuts.push(body);
      const exercise = await new PersonalExerciseFactory().create(body);
      const at = customs.findIndex((e) => e.custom?.familyId === exercise.custom?.familyId);
      if (at !== -1) customs.splice(at, 1);
      customs.unshift(exercise);
      return json({ exercise });
    }
    if (path === "/api/import" && method === "POST") {
      const body = r.postDataJSON();
      importBodies.push(body);
      if (undone.has(body.runId)) return json({ error: "Этот импорт уже отменён. Начни новую операцию." }, 400);
      if (body.dryRun) return json({ imported: 0, skipped: 0, exercises: [], exerciseIdMap: {}, workouts: [] });
      // Длинный файл приходит частями: части копятся, «записать» публикует их одним run.
      if (body.parts > 1 && !body.finalize) {
        staged.set(body.runId, [...(staged.get(body.runId) ?? []), ...body.workouts]);
        return json({ imported: body.workouts.length, part: body.part });
      }
      if (body.finalize) body.workouts = staged.get(body.runId) ?? [];
      // Названия без упражнения каталога становятся «Моими» с происхождением файла, как на воркере.
      const newCustoms: Exercise[] = [];
      const idMap: Record<string, string> = {};
      for (const source of body.workouts)
        for (const e of source.exercises) {
          if (e.exerciseId) continue;
          const key = `${e.sourceName}|${e.type}`;
          let found = customByKey.get(key);
          if (!found) {
            found = await new PersonalExerciseFactory().create({
              familyId: `fam-${customByKey.size + customs.length + 1}`,
              name: e.displayName ?? e.sourceName, nameEn: e.sourceName, aliases: [e.sourceName], notes: `Импорт из ${body.format}.`,
              equipment: "gym", declaredZones: [], origin: body.format,
              recording: { type: e.type ?? "reps", loadMode: "legacy_unspecified", implementCount: 1, laterality: "bilateral" },
            });
            customByKey.set(key, found);
            customs.unshift(found);
            newCustoms.push(found);
          }
          e.exerciseId = found.id;
          e.customDefinition = found;
        }
      const added: Workout[] = [];
      let replaced = 0,
        kept = 0;
      for (const source of body.workouts) {
        const id = `import:test:${source.sourceKey}`;
        const at = workouts.findIndex((w) => w.id === id);
        // Копия Тяги: тренировка с тем же идентификатором уже есть — сервер её не трогает.
        if (body.format === "tyaga" && source.nativeId && workouts.some((w) => w.id === source.nativeId)) continue;
        if (at !== -1 && !(body.replace && workouts[at].revision === 1)) {
          if (at !== -1 && body.replace) kept++;
          continue;
        }
        if (at !== -1) {
          workouts.splice(at, 1);
          replaced++;
        }
        const w = makeWorkout([], [], ZONE);
        added.push({
          ...w,
          id,
          name: source.name,
          date: source.date,
          duration: source.duration,
          createdAt: `${source.date}T10:00:00.000Z`,
          revision: 1,
          exercises: source.exercises.map((e: any) => ({
            exerciseId: e.exerciseId,
            catalogRevision: e.customDefinition ? 3 : e.catalogRevision,
            ...(e.customDefinition ? { externalDefinition: e.customDefinition } : {}),
            ...(e.equipmentNote ? { equipmentNote: e.equipmentNote } : {}),
            displayNameSnapshot: e.displayName,
            sets: e.sets.map((s: any, i: number) => ({ ...s, id: `${id}:${i}` })),
          })),
        });
      }
      workouts.unshift(...added);
      const runId = body.runId ?? `run-${runs.length + 1}`;
      for (const earlier of runs) earlier.ids = earlier.ids.filter((id) => !added.some((w) => w.id === id));
      runs.unshift({ runId, manifestHash: body.manifestHash ?? "", at: NOW.toISOString(), total: added.length, ids: added.map((w) => w.id) });
      return json({
        imported: added.length,
        replaced,
        kept,
        runId,
        addedIds: added.map((w) => w.id),
        skipped: body.workouts.length - added.length,
        workouts: added,
        exercises: newCustoms,
        exerciseIdMap: idMap,
      });
    }
    if (path === "/api/import/runs" && method === "GET")
      return json({
        runs: runs.filter((run) => run.ids.length).map((run) => ({ runId: run.runId, manifestHash: run.manifestHash, at: run.at, total: run.total, activeCount: run.ids.length })),
        pending,
      });
    if (path === "/api/import/undo" && method === "POST") {
      const { runId } = r.postDataJSON();
      const draft = pending.findIndex((p) => p.runId === runId);
      if (draft !== -1) {
        pending.splice(draft, 1);
        undone.add(runId);
        return json({ removed: 0, restored: 0, kept: 0, runId });
      }
      const run = runs.find((x) => x.runId === runId);
      if (!run) return json({ error: "Этот импорт для текущего аккаунта не найден" }, 400);
      let removed = 0;
      for (const id of run.ids) {
        const at = workouts.findIndex((w) => w.id === id);
        if (at !== -1) {
          workouts.splice(at, 1);
          deleted.push(id);
          removed++;
        }
      }
      run.ids = [];
      undone.add(runId);
      return json({ removed, restored: 0, kept: 0, runId });
    }
    if (path.startsWith("/api/workouts/") && method === "DELETE") {
      const id = decodeURIComponent(path.slice("/api/workouts/".length));
      const at = workouts.findIndex((w) => w.id === id);
      if (at !== -1) workouts.splice(at, 1);
      deleted.push(id);
      return json({ deleted: id });
    }
    if (path === "/api/workouts" && method === "PUT") {
      const w = r.postDataJSON();
      const saved = { ...w, revision: 1 };
      // Как воркер: тот же id — та же запись (повторная отправка не плодит дубль).
      const at = workouts.findIndex((x) => x.id === w.id);
      if (at !== -1) workouts[at] = saved;
      else workouts.unshift(saved);
      savedBodies.push(w);
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
  if (!options.signedOut) await expect(page.getByRole("heading", { name: "Сегодня", exact: true })).toBeVisible();
  return { workouts, customs, customPuts, runs, pending, profile, profileBodies, importBodies, deleted, savedBodies, recoveryRequests, weights, errors, unexpected, releaseWeights: () => releaseWeights() };
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

/**
 * Отметить подход ✓ так, как это делает человек: подход без веса и повторов не записывается (R03-REQ01),
 * поэтому пустые поля сначала заполняются, а введённые значения не трогаются.
 */
export async function mark(page: Page, n: number, name = "Жим штанги лёжа", weight = "60", reps = "8") {
  for (const [kind, value] of [["вес", weight], ["повторы", reps]] as const) {
    const input = page.getByLabel(`${name}, подход ${n}, ${kind}`, { exact: true });
    if ((await input.count()) && (await input.inputValue()) === "") await input.fill(value);
  }
  await page.getByRole("button", { name: `Отметить выполненным: ${name}, подход ${n}`, exact: true }).click();
}
