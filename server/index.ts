import { MachineRepository } from "./MachineRepository";
import { validMachine } from "./validation";
import { ChallengeRepository } from "./ChallengeRepository";
import { DEFAULT_SETTINGS, type Workout } from "../src/lib/model";
import {
  validWorkout,
  validSettings,
  validRevision,
  InputError,
  validRoutine,
  str,
  num,
  object,
} from "./validation";
import { SyncService } from "./SyncService";
import { ExerciseRepository } from "./ExerciseRepository";
import { ProductRepository } from "./ProductRepository";
import { PersonalExerciseFactory } from "./PersonalExerciseFactory";
import { HistoryImportService } from "./HistoryImportService";
import { ImportReceiptService } from "./ImportReceiptService";
import { BackupImportService } from "./BackupImportService";
import { exerciseById } from "../src/lib/model";
import { AccountService, AuthError } from "./AccountService";
import { FriendsRepository } from "./FriendsRepository";
import { SharedProgramRepository } from "./SharedProgramRepository";
import { MeetupRepository } from "./MeetupRepository";
import { LiveRoomService } from "./LiveRoomService";
import { BodyweightRepository } from "./BodyweightRepository";
import { BiomechanicsAgentService } from "./BiomechanicsAgentService";
import { BodyTooLargeError, json, readTextLimited } from "./http";
export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  AI?: Ai;
  OPENAI_API_KEY?: string;
  OPENAI_BASE_URL?: string;
  OPENAI_MODEL?: string;
  onSessionToken?: (token: string) => void;
}
const MAX_BODY_BYTES = 500_000;
type WorkoutRow = { payload: string; revision: number; updated_at: string };
const fromRow = (row: WorkoutRow): Workout => ({
  ...JSON.parse(row.payload),
  revision: row.revision,
  updatedAt: row.updated_at,
});

export async function handleApi(request: Request, env: Env, preReadBody?: string) {
  const url = new URL(request.url);
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204 });
  }
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
  const readJson = () => readBody(request, preReadBody);
  try {
    const accounts = new AccountService(env.DB, userId, env.onSessionToken);
    const authResponse = await accounts.handle(request, preReadBody);
    if (authResponse) return authResponse;
    const activeAccount = await accounts.require(request);
    if (url.pathname.startsWith("/api/v4/biomechanics/")) {
      const agentSvc = new BiomechanicsAgentService(env.DB, activeAccount.id, env);
      if (url.pathname === "/api/v4/biomechanics/resolve" && request.method === "POST") {
        const body = object(await readJson());
        const result = await agentSvc.resolve({
          queryText: str(body.queryText, 240, 1),
          locale: body.locale === "en" ? "en" : "ru",
          imageBase64: typeof body.imageBase64 === "string" ? body.imageBase64 : undefined,
          executionProfile:
            body.executionProfile && typeof body.executionProfile === "object"
              ? (body.executionProfile as Record<string, unknown>)
              : undefined,
          machineBrandHint:
            typeof body.machineBrandHint === "string" ? body.machineBrandHint.slice(0, 120) : undefined,
          userId: activeAccount.id,
          longLevers: body.longLevers === true,
        });
        return json(result);
      }
      if (url.pathname === "/api/v4/biomechanics/clarify" && request.method === "POST") {
        const body = object(await readJson());
        return json(
          await agentSvc.clarify({
            canonicalSlug: str(body.canonicalSlug, 80, 1),
            updatedDescriptor: body.updatedDescriptor as Parameters<BiomechanicsAgentService["clarify"]>[0]["updatedDescriptor"],
            executionPatch:
              body.executionPatch && typeof body.executionPatch === "object"
                ? (body.executionPatch as Record<string, unknown>)
                : undefined,
          }),
        );
      }
      if (url.pathname === "/api/v4/biomechanics/feedback" && request.method === "POST") {
        const body = object(await readJson());
        return json(
          await agentSvc.submitFeedback({
            canonicalSlug: str(body.canonicalSlug, 80, 1),
            proposedDescriptor: body.proposedDescriptor as Parameters<BiomechanicsAgentService["submitFeedback"]>[0]["proposedDescriptor"],
          }),
        );
      }
      if (url.pathname === "/api/v4/biomechanics/catalog/sync" && request.method === "GET") {
        const since = Number(url.searchParams.get("since") ?? "0") || 0;
        return json(await agentSvc.syncCatalog(since));
      }
      return json({ error: "Не найдено" }, 404);
    }
    if(url.pathname==="/api/challenges"||url.pathname.startsWith("/api/challenges/")) {
      const challenges=new ChallengeRepository(env.DB,activeAccount);
      if(url.pathname==="/api/challenges"&&request.method==="GET")return json(await challenges.read());
      if(url.pathname==="/api/challenges"&&request.method==="POST")return json(await challenges.create(await readJson()));
      if(request.method==="PUT"&&url.pathname.startsWith("/api/challenges/")){await challenges.act(str(decodeURIComponent(url.pathname.slice("/api/challenges/".length)),80,1),await readJson());return json({ok:true});}
      return json({error:"Не найдено"},404);
    }
    if (url.pathname === "/api/bodyweight" || url.pathname.startsWith("/api/bodyweight/")) {
      const weights = new BodyweightRepository(env.DB, userId, activeAccount.timeZone,activeAccount.id);
      if (request.method === "GET" && url.pathname === "/api/bodyweight") return json({...await weights.read(),accountId:activeAccount.id});
      if (request.method === "PUT" && url.pathname.startsWith("/api/bodyweight/")) {
        const key = decodeURIComponent(url.pathname.slice("/api/bodyweight/".length));
        if (!key) return json({ error: "Не найдено" }, 404);
        const result=await weights.save(key,await readJson());
        return result.saved?json({document:result.saved}):json({error:"Замер изменён на другом устройстве. Выбери версию для сохранения.",document:result.current},409);
      }
      return json({error:"Не найдено"},404);
    }
    if (url.pathname === "/api/friends/live" || url.pathname.startsWith("/api/friends/live/")) {
      const live = new LiveRoomService(env.DB, activeAccount.id);
      switch (`${request.method} ${url.pathname}`) {
        case "GET /api/friends/live":
          return json({ room: await live.current() });
        case "POST /api/friends/live":
          return json({ room: await live.create() });
        case "POST /api/friends/live/join":
          return json({ room: await live.join(await readJson()) });
        case "PUT /api/friends/live/state":
          return json({ room: await live.push(await readJson()) });
        case "DELETE /api/friends/live":
          await live.leave();
          return json({ room: null });
      }
      return json({ error: "Не найдено" }, 404);
    }
    if (url.pathname === "/api/friends" || url.pathname.startsWith("/api/friends/")) {
      const friends = new FriendsRepository(env.DB, activeAccount);
      const path = url.pathname;
      const meetups=new MeetupRepository(env.DB,activeAccount);
      const sharedPrograms = new SharedProgramRepository(env.DB, activeAccount);
      if(path === "/api/friends" && request.method === "GET") return json({...await friends.read(),meetups:await meetups.read(),sharedPrograms:await sharedPrograms.read()});
      if(path === "/api/friends/programs" && request.method === "POST") return json(await sharedPrograms.create(object(await readJson())));
      if(path.startsWith("/api/friends/programs/")) {
        const rest = path.slice("/api/friends/programs/".length);
        if (rest.endsWith("/adopt") && request.method === "POST") {
          const id = str(decodeURIComponent(rest.slice(0, -"/adopt".length)), 80, 1);
          await sharedPrograms.adopt(id);
          return json({ ok: true });
        }
        if (request.method === "DELETE") {
          await sharedPrograms.remove(str(decodeURIComponent(rest), 80, 1));
          return json({ ok: true });
        }
        return json({ error: "Не найдено" }, 404);
      }
      if(path === "/api/friends/meetups" && request.method === "POST") return json(await meetups.create(await readJson()));
      if(path.startsWith("/api/friends/meetups/") && request.method === "PUT") { await meetups.act(str(decodeURIComponent(path.slice("/api/friends/meetups/".length)),80,1),await readJson());return json({ok:true}); }
      if(path === "/api/friends/goal" && request.method === "PUT") {await friends.goal(object(await readJson()).target);return json({ok:true});}
      if (path === "/api/friends/requests" && request.method === "POST") {
        await friends.request(object(await readJson()).code);
        return json({ ok: true });
      }
      if (path === "/api/friends/status" && request.method === "PUT") {
        await friends.status(object(await readJson()));
        return json({ ok: true });
      }
      const match = path.match(/^\/api\/friends\/(connections|kudos)\/([^/]+)$/);
      if (match) {
        const id = str(decodeURIComponent(match[2]), 80, 1);
        if (match[1] === "connections" && request.method === "PUT") await friends.accept(id);
        else if (match[1] === "connections" && request.method === "DELETE") await friends.remove(id);
        else if (match[1] === "kudos" && request.method === "PUT") await friends.kudos(id, object(await readJson()).given);
        else return json({ error: "Не найдено" }, 404);
        return json({ ok: true });
      }
      return json({ error: "Не найдено" }, 404);
    }
    const machines = new MachineRepository(env.DB, userId);
    const product = new ProductRepository(env.DB, userId);
    const definitions = async (ids: string[]) => {
      const wger = await new ExerciseRepository(env.DB).findByIds(ids);
      const custom = await product.definitions(ids);
      return new Map([...wger, ...custom]);
    };
    if (request.method === "PUT" && url.pathname === "/api/machines") {
      const result = await machines.save(validMachine(await readJson()));
      return result.saved ? json({ machine: result.saved }) : json({ error: "Тренажёр изменён на другом устройстве", currentMachine: result.current }, 409);
    }
    if (request.method === "DELETE" && url.pathname.startsWith("/api/machines/")) {
      const v = object(await readJson());
      const archived = await machines.archive(str(decodeURIComponent(url.pathname.slice("/api/machines/".length)),80,1), validRevision(v.revision));
      return archived ? json({ ok: true }) : json({ error: "Тренажёр изменён на другом устройстве" }, 409);
    }
    if (request.method === "GET" && url.pathname === "/api/product")
      return json(await product.read());
    if (
      request.method === "POST" &&
      url.pathname === "/api/exercises/resolve"
    ) {
      const input = await readJson();
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
          await readJson(),
        ),
      );
    if (request.method === "POST" && url.pathname === "/api/import/undo")
      return json(await new ImportReceiptService(env.DB, userId).undo(await readJson()));
    if (request.method === "GET" && url.pathname === "/api/import/runs")
      return json(await new ImportReceiptService(env.DB, userId).runs());
    if (request.method === "POST" && url.pathname === "/api/import/metadata")
      return json(
        await new BackupImportService(env.DB, userId).import(
          await readJson(),
        ),
      );
    if (request.method === "PUT" && url.pathname === "/api/custom-exercises") {
      const exercise = await new PersonalExerciseFactory().create(
        await readJson(),
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
      const v = await readJson();
      const id = str(v.exerciseId, 80, 1);
      if (typeof v.favorite !== "boolean")
        throw new InputError("Проверь отметку избранного");
      if (v.favorite && !exerciseById(id) && !(await definitions([id])).has(id))
        throw new InputError("Упражнение недоступно");
      await product.favorite(id, v.favorite);
      return json({ exerciseId: id, favorite: v.favorite });
    }
    if (request.method === "PUT" && url.pathname === "/api/routines") {
      const input = await readJson();
      const ids = Array.isArray(input.exercises)
        ? input.exercises.map((e: { exerciseId: string }) => e.exerciseId)
        : [];
      const result = await product.saveRoutine(
        validRoutine(input, await definitions(ids), await machines.definitions()),
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
        body = await readJson();
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
    if (request.method === "GET" && url.pathname === "/api/sync/recovery")
      return json(await new SyncService(env.DB, userId).recovery());
    if (request.method === "GET" && url.pathname === "/api/sync/changes")
      return json(
        await new SyncService(env.DB, userId).changes(
          num(Number(url.searchParams.get("since") ?? 0), 0, Number.MAX_SAFE_INTEGER, true),
          200, url.searchParams.get("capabilities") === "machines-v1",
        ),
      );
    if (request.method === "POST" && url.pathname === "/api/sync/apply")
      return json(await new SyncService(env.DB, userId).apply(await readJson()));
    if (request.method === "GET" && url.pathname === "/api/exercises")
      return json(
        await new ExerciseRepository(env.DB).search(
          url.searchParams,
          url.searchParams.get("q")
            ? new Set(
                (
                  await env.DB.prepare(
                    "SELECT DISTINCT json_extract(e.value,'$.exerciseId') AS id FROM (SELECT payload FROM workouts WHERE owner_id=? ORDER BY date DESC LIMIT 300) w, json_each(w.payload,'$.exercises') e",
                  )
                    .bind(userId)
                    .all<{ id: string | null }>()
                ).results.flatMap((r) => (r.id ? [r.id] : [])),
              )
            : undefined,
        ),
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
          : { ...DEFAULT_SETTINGS, timeZone: activeAccount.timeZone, revision: 0 },
      });
    }
    if (request.method === "PUT" && url.pathname === "/api/settings") {
      const value = validSettings(await readJson());
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
      const input = await readJson();
      const externalIds = Array.isArray(input?.exercises)
        ? input.exercises.map((e: { exerciseId?: unknown }) =>
            typeof e?.exerciseId === "string" ? e.exerciseId : "",
          )
        : [];
      const importedExercises = await definitions(externalIds);
      const w = validWorkout(input, {
        timeZone: profile ? JSON.parse(profile.payload).timeZone : activeAccount.timeZone,
        importedExercises,
        machines: await machines.definitions(),
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
      const body = (await readJson()) as { revision?: unknown };
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
    if (error instanceof BodyTooLargeError) return json({ error: error.message }, 413);
    if (error instanceof AuthError) return json({ error: error.message }, error.status);
    if (error instanceof InputError) return json({ error: error.message }, 400);
    if (error instanceof URIError) return json({ error: "Некорректный адрес" }, 400);
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
async function readBody(request: Request, preReadBody?: string) {
  const body = preReadBody ?? (await readTextLimited(request, MAX_BODY_BYTES));
  if (new TextEncoder().encode(body).byteLength > MAX_BODY_BYTES)
    throw new BodyTooLargeError("Слишком большой запрос");
  return JSON.parse(body);
}
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) return handleApi(request, env);
    const response = await env.ASSETS.fetch(request);
    if (
      url.pathname === "/tyaga.apk" &&
      (response.headers.get("Content-Type") ?? "").includes("text/html")
    ) {
      return new Response("Android APK не опубликован", {
        status: 404,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        },
      });
    }
    const headers = new Headers(response.headers);
    headers.set("X-Content-Type-Options", "nosniff");
    headers.set("X-Frame-Options", "DENY");
    headers.set("Referrer-Policy", "same-origin");
    headers.set(
      "Content-Security-Policy",
      // connect-src: MediaPipe-модель анализа техники лежит на storage.googleapis.com
      // (src/services/PoseVideoAnalysis.ts). media-src/img-src включают blob: для
      // локального видео предпросмотра (PoseAnalysisPanel.tsx: URL.createObjectURL).
      // React style-атрибуты применяются через CSSOM и не требуют 'unsafe-inline'.
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self' https://storage.googleapis.com; font-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
    );
    headers.set("Permissions-Policy", "geolocation=(), microphone=()");
    return new Response(response.body, { status: response.status, headers });
  },
};
