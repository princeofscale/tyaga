import { DEFAULT_SETTINGS, type Workout } from "../src/lib/model";
import {
  validWorkout,
  validSettings,
  validRevision,
  InputError,
  validRoutine,
  str,
} from "./validation";
import { ExerciseRepository } from "./ExerciseRepository";
import { ProductRepository } from "./ProductRepository";
import { PersonalExerciseFactory } from "./PersonalExerciseFactory";
import { HistoryImportService } from "./HistoryImportService";
import { BackupImportService } from "./BackupImportService";
import { exerciseById } from "../src/lib/model";
interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
}
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
type WorkoutRow = { payload: string; revision: number; updated_at: string };
const fromRow = (row: WorkoutRow): Workout => ({
  ...JSON.parse(row.payload),
  revision: row.revision,
  updatedAt: row.updated_at,
});

export async function handleApi(request: Request, env: Env) {
  const url = new URL(request.url);
  const userId = request.headers.get("oai-authenticated-user-id");
  if (!userId)
    return json(
      { error: "Войдите в аккаунт, чтобы сохранить тренировки." },
      401,
    );
  if (!["GET", "HEAD"].includes(request.method)) {
    const origin = request.headers.get("Origin");
    if (!origin || origin !== url.origin)
      return json({ error: "Недопустимый источник запроса" }, 403);
    if (
      !(request.headers.get("Content-Type") ?? "").startsWith(
        "application/json",
      )
    )
      return json({ error: "Требуется JSON" }, 415);
  }
  try {
    const product = new ProductRepository(env.DB, userId);
    const definitions = async (ids: string[]) => {
      const [wger, custom] = await Promise.all([
        new ExerciseRepository(env.DB).findByIds(ids),
        product.definitions(ids),
      ]);
      return new Map([...wger, ...custom]);
    };
    if (request.method === "GET" && url.pathname === "/api/product")
      return json(await product.read());
    if (
      request.method === "POST" &&
      url.pathname === "/api/exercises/resolve"
    ) {
      const input = await readBody(request);
      if (!Array.isArray(input.names) || input.names.length > 80)
        throw new InputError("Не больше 80 названий за запрос");
      return json({
        matches: new ExerciseRepository(env.DB).resolve(
          input.names.map((v: unknown) => str(v, 120, 1)),
        ),
      });
    }
    if (request.method === "POST" && url.pathname === "/api/import")
      return json(
        await new HistoryImportService(env.DB, userId).import(
          await readBody(request),
        ),
      );
    if (request.method === "POST" && url.pathname === "/api/import/metadata")
      return json(
        await new BackupImportService(env.DB, userId).import(
          await readBody(request),
        ),
      );
    if (request.method === "PUT" && url.pathname === "/api/custom-exercises") {
      const exercise = await new PersonalExerciseFactory().create(
        await readBody(request),
      );
      return json({ exercise: await product.saveExercise(exercise) });
    }
    if (
      request.method === "DELETE" &&
      url.pathname.startsWith("/api/custom-exercises/")
    ) {
      const id = str(
        decodeURIComponent(url.pathname.slice("/api/custom-exercises/".length)),
        80,
        1,
      );
      await product.removeExercise(id);
      return json({ deleted: id });
    }
    if (request.method === "PUT" && url.pathname === "/api/favorites") {
      const v = await readBody(request);
      const id = str(v.exerciseId, 80, 1);
      if (typeof v.favorite !== "boolean")
        throw new InputError("Проверь отметку избранного");
      if (v.favorite && !exerciseById(id) && !(await definitions([id])).has(id))
        throw new InputError("Упражнение недоступно");
      await product.favorite(id, v.favorite);
      return json({ exerciseId: id, favorite: v.favorite });
    }
    if (request.method === "PUT" && url.pathname === "/api/routines") {
      const input = await readBody(request);
      const ids = Array.isArray(input.exercises)
        ? input.exercises.map((e: { exerciseId: string }) => e.exerciseId)
        : [];
      const result = await product.saveRoutine(
        validRoutine(input, await definitions(ids)),
      );
      return result.saved
        ? json({ routine: result.saved })
        : json(
            {
              error:
                "Программа изменилась на другом устройстве. Форма сохранена; загрузите актуальную версию или сохраните копию.",
              currentRoutine: result.current,
            },
            409,
          );
    }
    if (
      request.method === "DELETE" &&
      url.pathname.startsWith("/api/routines/")
    ) {
      const id = str(
          decodeURIComponent(url.pathname.slice("/api/routines/".length)),
          80,
          1,
        ),
        body = await readBody(request);
      if (body.revision === undefined)
        throw new InputError("Для удаления нужна версия программы");
      const current = await product.removeRoutine(
        id,
        validRevision(body.revision),
      );
      return current
        ? json(
            {
              error:
                "Программа изменилась. Проверьте актуальную версию перед удалением.",
              currentRoutine: current,
            },
            409,
          )
        : json({ deleted: id });
    }
    if (request.method === "GET" && url.pathname === "/api/exercises")
      return json(
        await new ExerciseRepository(env.DB).search(url.searchParams),
      );
    if (request.method === "GET" && url.pathname === "/api/data") {
      // One D1 call returns a consistent journal/settings snapshot and avoids
      // issuing concurrent reads against the same database connection.
      const results = await env.DB.batch([
        env.DB.prepare(
          "SELECT payload, revision, updated_at FROM workouts WHERE owner_id = ? ORDER BY date DESC, updated_at DESC, id DESC",
        ).bind(userId),
        env.DB.prepare(
          "SELECT payload, revision FROM settings WHERE owner_id = ?",
        ).bind(userId),
      ]);
      const rows = results[0].results as WorkoutRow[];
      const setting = results[1].results[0] as
        { payload: string; revision: number } | undefined;
      return json({
        workouts: rows.map(fromRow),
        settings: setting
          ? { ...JSON.parse(setting.payload), revision: setting.revision }
          : { ...DEFAULT_SETTINGS, revision: 0 },
      });
    }
    if (request.method === "PUT" && url.pathname === "/api/settings") {
      const value = validSettings(await readBody(request));
      const { revision = 0, ...content } = value;
      const payload = JSON.stringify(content);
      const saved = await env.DB.prepare(
        "INSERT INTO settings (owner_id, payload, revision) VALUES (?, ?, 1) ON CONFLICT(owner_id) DO UPDATE SET payload = excluded.payload, revision = settings.revision + 1 WHERE settings.revision = ? RETURNING payload, revision",
      )
        .bind(userId, payload, revision)
        .first<{ payload: string; revision: number }>();
      if (saved)
        return json({
          settings: { ...JSON.parse(saved.payload), revision: saved.revision },
        });
      const current = await env.DB.prepare(
        "SELECT payload, revision FROM settings WHERE owner_id = ?",
      )
        .bind(userId)
        .first<{ payload: string; revision: number }>();
      if (current?.payload === payload)
        return json({
          settings: {
            ...JSON.parse(current.payload),
            revision: current.revision,
          },
        });
      return json(
        {
          error:
            "Ориентиры изменились на другом устройстве. Загрузите актуальные настройки перед повторным изменением.",
          settings: current
            ? { ...JSON.parse(current.payload), revision: current.revision }
            : null,
        },
        409,
      );
    }
    if (request.method === "PUT" && url.pathname === "/api/workouts") {
      const profile = await env.DB.prepare(
        "SELECT payload FROM settings WHERE owner_id = ?",
      )
        .bind(userId)
        .first<{ payload: string }>();
      const input = await readBody(request);
      const externalIds = Array.isArray(input?.exercises)
        ? input.exercises.map((e: { exerciseId?: unknown }) =>
            typeof e?.exerciseId === "string" ? e.exerciseId : "",
          )
        : [];
      const importedExercises = await definitions(externalIds);
      const w = validWorkout(input, {
        timeZone: profile ? JSON.parse(profile.payload).timeZone : "UTC",
        importedExercises,
      });
      const { revision = 0, updatedAt: _updatedAt, ...content } = w;
      const payload = JSON.stringify(content);
      const stamp = new Date().toISOString();
      // Revision comparison and write occur atomically in SQLite. An edit cannot recreate a deleted row.
      const saved =
        revision === 0
          ? await env.DB.prepare(
              "INSERT INTO workouts (id, owner_id, date, payload, updated_at, revision) VALUES (?, ?, ?, ?, ?, 1) ON CONFLICT(id) DO UPDATE SET date = excluded.date, payload = excluded.payload, updated_at = excluded.updated_at, revision = workouts.revision + 1 WHERE workouts.owner_id = excluded.owner_id AND workouts.revision = 0 RETURNING payload, revision, updated_at",
            )
              .bind(w.id, userId, w.date, payload, stamp)
              .first<WorkoutRow>()
          : await env.DB.prepare(
              "UPDATE workouts SET date = ?, payload = ?, updated_at = ?, revision = revision + 1 WHERE id = ? AND owner_id = ? AND revision = ? RETURNING payload, revision, updated_at",
            )
              .bind(w.date, payload, stamp, w.id, userId, revision)
              .first<WorkoutRow>();
      if (saved) return json({ workout: fromRow(saved) });
      const current = await env.DB.prepare(
        "SELECT owner_id, payload, revision, updated_at FROM workouts WHERE id = ?",
      )
        .bind(w.id)
        .first<WorkoutRow & { owner_id: string }>();
      if (current && current.owner_id !== userId)
        return json({ error: "Тренировка недоступна" }, 403);
      // Retry after a committed write with a lost response is idempotent.
      if (current?.payload === payload)
        return json({ workout: fromRow(current) });
      return json(
        {
          error: current
            ? "Тренировка изменена на другом устройстве. Твой черновик сохранён в форме; выбери, как продолжить."
            : "Эта тренировка была удалена. Можно сохранить черновик отдельной копией.",
          current: current ? fromRow(current) : null,
        },
        409,
      );
    }
    if (
      request.method === "DELETE" &&
      url.pathname.startsWith("/api/workouts/")
    ) {
      const id = decodeURIComponent(
        url.pathname.slice("/api/workouts/".length),
      );
      if (!id || id.length > 80) throw new InputError("Некорректный ID");
      const body = (await readBody(request)) as { revision?: unknown };
      if (!body || typeof body !== "object" || body.revision === undefined)
        throw new InputError("Для удаления нужна версия записи");
      const revision = validRevision(body.revision);
      await env.DB.prepare(
        "DELETE FROM workouts WHERE id = ? AND owner_id = ? AND revision = ?",
      )
        .bind(id, userId, revision)
        .run();
      const current = await env.DB.prepare(
        "SELECT payload, revision, updated_at FROM workouts WHERE id = ? AND owner_id = ?",
      )
        .bind(id, userId)
        .first<WorkoutRow>();
      if (current)
        return json(
          {
            error:
              "Тренировка изменена на другом устройстве. Проверь актуальную версию перед удалением.",
            current: fromRow(current),
          },
          409,
        );
      return json({ deleted: id });
    }
    return json({ error: "Не найдено" }, 404);
  } catch (error) {
    if (error instanceof InputError) return json({ error: error.message }, 400);
    if (error instanceof SyntaxError)
      return json({ error: "Некорректный JSON" }, 400);
    console.error(
      "Workout storage request failed",
      error instanceof Error ? error.message : "unknown",
    );
    return json(
      {
        error:
          "Не удалось обратиться к хранилищу. Форма остаётся открытой — попробуйте ещё раз.",
      },
      503,
    );
  }
}
async function readBody(request: Request) {
  const body = await request.text();
  if (body.length > 500000) throw new InputError("Слишком большой запрос");
  return JSON.parse(body);
}
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) return handleApi(request, env);
    const response = await env.ASSETS.fetch(request);
    const headers = new Headers(response.headers);
    headers.set("X-Content-Type-Options", "nosniff");
    headers.set("Referrer-Policy", "same-origin");
    headers.set(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'",
    );
    return new Response(response.body, { status: response.status, headers });
  },
};
