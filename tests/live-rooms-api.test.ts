import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { RoomCode } from "../src/domain/LiveSession";

/** Миграции из drizzle/ на пустой D1; владелец запроса регистрируется при первом обращении. */
async function sandbox() {
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      workers: [
        {
          modules: true,
          scriptPath: "dist/server/index.js",
          compatibilityDate: "2025-09-27",
          d1Databases: ["DB"],
        },
      ],
      cf: false,
    }),
  );
  const db = await mf.getD1Database("DB");
  for (const file of (await readdir("drizzle")).filter((p) => p.endsWith(".sql")).sort())
    for (const statement of (await readFile("drizzle/" + file, "utf8"))
      .split("--> statement-breakpoint")
      .filter((s) => s.trim()))
      await db.prepare(statement.trim()).run();
  const base = "http://localhost";
  const cookies = new Map<string, Promise<string>>();
  const accountCookie = (owner: string) => {
    if (!cookies.has(owner))
      cookies.set(
        owner,
        (async () => {
          const response = await mf.dispatchFetch(base + "/api/auth/register", {
            method: "POST",
            headers: { "oai-authenticated-user-id": owner, Origin: base, "Content-Type": "application/json" },
            body: JSON.stringify({
              email: `${owner}@example.test`,
              password: "test account passphrase",
              displayName: owner,
              timeZone: "UTC",
            }),
          });
          assert.equal(response.status, 201);
          return response.headers.get("Set-Cookie")!.split(";")[0];
        })(),
      );
    return cookies.get(owner)!;
  };
  const request = async (path: string, method = "GET", body?: unknown, owner: string | null = "alpha", origin = base) =>
    mf.dispatchFetch(base + path, {
      method,
      headers: {
        ...(owner ? { "oai-authenticated-user-id": owner, Cookie: await accountCookie(owner) } : {}),
        Origin: origin,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const live = (method: string, path: string, body: unknown, owner: string) =>
    request("/api/friends/live" + path, method, body, owner);
  /** Номер аккаунта в базе: комнаты привязаны к нему, а не к идентификатору платформы. */
  const accountId = async (owner: string) => {
    await accountCookie(owner);
    return (await db.prepare("SELECT id FROM accounts WHERE platform_id=?").bind(owner).first<{ id: string }>())!.id;
  };
  return { mf, db, request, live, accountId };
}

const liveState = (over: Record<string, unknown> = {}) => ({
  phase: "lifting",
  exercise: "Жим штанги лёжа",
  setsDone: 2,
  setsTotal: 5,
  tonnageKg: 1200,
  lastSet: { kg: 60, reps: 10 },
  restEndsAt: null,
  ...over,
});

test("live rooms: a code lets two people in, each sees the other's progress and nothing more", async () => {
  const { mf, live } = await sandbox();
  try {
    assert.deepEqual(await (await live("GET", "", undefined, "alpha")).json(), { room: null });

    const made = (await (await live("POST", "", undefined, "alpha")).json()) as any;
    assert.ok(RoomCode.isValid(made.room.code));
    assert.equal(made.room.members.length, 1);
    assert.equal(made.room.members[0].isMe, true);
    assert.equal(made.room.members[0].state, null);

    // Код можно ввести как угодно: регистр, пробелы и дефис не мешают.
    const typed = ` ${made.room.code.slice(0, 2).toLowerCase()}-${made.room.code.slice(2)} `;
    const joined = (await (await live("POST", "/join", { code: typed }, "beta")).json()) as any;
    assert.equal(joined.room.code, made.room.code);
    assert.deepEqual(
      joined.room.members.map((m: any) => [m.displayName, m.isMe]),
      [["alpha", false], ["beta", true]],
    );

    // Альфа выкладывает состояние: Бета его видит, лишние поля до неё не доходят.
    assert.equal((await live("PUT", "/state", liveState({ notes: "секрет" }), "alpha")).status, 200);
    const betaView = (await (await live("GET", "", undefined, "beta")).json()) as any;
    assert.deepEqual(betaView.room.members[0].state, liveState());
    assert.ok(!JSON.stringify(betaView).includes("секрет"));
    const alphaView = (await (await live("GET", "", undefined, "alpha")).json()) as any;
    assert.equal(alphaView.room.members[1].state, null);

    // Посторонний комнату не видит.
    assert.deepEqual(await (await live("GET", "", undefined, "gamma")).json(), { room: null });

    // Неверный код — понятная ошибка, а не пустая комната.
    for (const code of ["ZZZZZ", "H7KQ", "00000", ""]) {
      const miss = await live("POST", "/join", { code }, "gamma");
      assert.equal(miss.status, 400, code);
    }
    const unknown = await live("POST", "/join", { code: "ZZZZZ" }, "gamma");
    assert.match(((await unknown.json()) as any).error, /не найдена/);
  } finally {
    await mf.dispose();
  }
});

test("live rooms: members are known by name only, never by email or account id", async () => {
  const { mf, live, accountId } = await sandbox();
  try {
    const code = ((await (await live("POST", "", undefined, "alpha")).json()) as any).room.code as string;
    const room = JSON.stringify(((await (await live("POST", "/join", { code }, "beta")).json()) as any).room);
    for (const secret of ["alpha@example.test", "beta@example.test", await accountId("alpha"), await accountId("beta")])
      assert.ok(!room.includes(secret), `в ответе комнаты не должно быть ${secret}`);
    assert.deepEqual(
      Object.keys(JSON.parse(room).members[0]).sort(),
      ["displayName", "id", "isMe", "state", "updatedAt"],
    );
  } finally {
    await mf.dispose();
  }
});

test("live rooms: they need a signed-in account and a same-origin JSON request", async () => {
  const { mf, request, live } = await sandbox();
  try {
    assert.equal((await request("/api/friends/live", "GET", undefined, null)).status, 401);
    assert.equal((await request("/api/friends/live", "POST", {}, "alpha", "https://evil.example")).status, 403);
    assert.deepEqual(await (await live("GET", "", undefined, "alpha")).json(), { room: null });
  } finally {
    await mf.dispose();
  }
});

test("live rooms: a pushed state is checked field by field and needs a room", async () => {
  const { mf, live } = await sandbox();
  try {
    const orphan = await live("PUT", "/state", liveState(), "alpha");
    assert.equal(orphan.status, 400);
    assert.match(((await orphan.json()) as any).error, /Сначала войдите в комнату/);

    await live("POST", "", undefined, "alpha");
    const invalid: Record<string, unknown>[] = [
      liveState({ phase: "sleeping" }),
      liveState({ exercise: 5 }),
      liveState({ exercise: "я".repeat(81) }),
      liveState({ setsDone: 6, setsTotal: 5 }),
      liveState({ setsTotal: 1.5 }),
      liveState({ tonnageKg: -1 }),
      liveState({ tonnageKg: 2_000_000 }),
      liveState({ lastSet: { kg: -5, reps: 8 } }),
      liveState({ lastSet: { kg: 60 } }),
      liveState({ restEndsAt: "завтра" }),
      liveState({ restEndsAt: "11 November 2026 10:00" }),
      liveState({ restEndsAt: new Date(Date.now() + 3 * 3_600_000).toISOString() }),
    ];
    for (const state of invalid)
      assert.equal((await live("PUT", "/state", state, "alpha")).status, 400, JSON.stringify(state));

    // Самая большая тренировка, которую принимает приложение (30 × 30 подходов), комнату не ломает.
    const biggest = liveState({
      exercise: "я".repeat(80),
      setsDone: 900,
      setsTotal: 900,
      tonnageKg: 1_000_000,
      lastSet: { kg: 1000, reps: 200 },
    });
    assert.equal((await live("PUT", "/state", biggest, "alpha")).status, 200);

    // Начало тренировки без подходов и идущий отдых допустимы.
    const start = liveState({ phase: "idle", exercise: null, setsDone: 0, lastSet: null });
    assert.equal((await live("PUT", "/state", start, "alpha")).status, 200);
    const soon = new Date(Date.now() + 45_000).toISOString();
    const resting = (await (await live("PUT", "/state", liveState({ phase: "resting", restEndsAt: soon }), "alpha")).json()) as any;
    assert.equal(resting.room.members[0].state.restEndsAt, soon);
  } finally {
    await mf.dispose();
  }
});

test("live rooms: six seats, one room per person, empty rooms vanish and silent ones expire", async () => {
  const { mf, db, live, accountId } = await sandbox();
  try {
    const roomOf = async (owner: string) => ((await (await live("GET", "", undefined, owner)).json()) as any).room;
    const code = ((await (await live("POST", "", undefined, "p1")).json()) as any).room.code as string;
    for (const name of ["p2", "p3", "p4", "p5", "p6"])
      assert.equal((await live("POST", "/join", { code }, name)).status, 200, name);

    // Седьмому места нет, но прежняя комната у него остаётся.
    const own = ((await (await live("POST", "", undefined, "p7")).json()) as any).room.code as string;
    const full = await live("POST", "/join", { code }, "p7");
    assert.equal(full.status, 400);
    assert.match(((await full.json()) as any).error, /заполнена/);
    assert.equal((await roomOf("p7")).code, own);

    // Один человек — одна комната: при переходе прежняя освобождает место, а старое состояние не едет следом.
    assert.equal((await live("PUT", "/state", liveState(), "p6")).status, 200);
    const moved = (await (await live("POST", "/join", { code: own }, "p6")).json()) as any;
    assert.equal(moved.room.members.length, 2);
    assert.equal(moved.room.members.find((m: any) => m.isMe).state, null);
    assert.equal((await roomOf("p1")).members.length, 5);
    assert.equal((await live("POST", "/join", { code }, "p7")).status, 200);
    assert.equal((await roomOf("p1")).members.length, 6);

    // Повторный вход в свою комнату ничего не меняет.
    assert.equal((await roomOf("p1")).code, code);
    assert.equal(((await (await live("POST", "/join", { code }, "p1")).json()) as any).room.members.length, 6);

    // Когда уходит последний, комната исчезает вместе с кодом.
    assert.deepEqual(await (await live("DELETE", "", undefined, "p6")).json(), { room: null });
    const gone = await live("POST", "/join", { code: own }, "p1");
    assert.equal(gone.status, 400);
    assert.match(((await gone.json()) as any).error, /не найдена/);
    assert.equal((await roomOf("p1")).code, code);

    // Молчание дольше двенадцати часов выбрасывает из комнаты, вернуть её пушем нельзя.
    const stale = new Date(Date.now() - 13 * 3_600_000).toISOString();
    await db.prepare("UPDATE live_members SET updated_at=? WHERE account_id=?").bind(stale, await accountId("p2")).run();
    assert.equal(await roomOf("p2"), null);
    assert.equal((await live("PUT", "/state", liveState(), "p2")).status, 400);
    assert.equal((await roomOf("p1")).members.length, 5);

    // Комната, в которой давно никто не отвечает, закрыта целиком.
    await db.prepare("UPDATE live_members SET updated_at=?").bind(stale).run();
    const lonely = await live("POST", "/join", { code }, "p8");
    assert.equal(lonely.status, 400);
    assert.match(((await lonely.json()) as any).error, /не найдена/);
  } finally {
    await mf.dispose();
  }
});

test("live rooms: creating never drops you into an occupied room, even when the generated code collides", async () => {
  const { mf, db, live, accountId } = await sandbox();
  try {
    // Генератор с заданными байтами: первая попытка даёт «ABCDE», вторая — «FGHJK».
    const scripted = () => {
      let call = 0;
      return (count: number) => {
        const base = call++ === 0 ? 0 : 5;
        return Uint8Array.from({ length: count }, (_, i) => base + (i % 5));
      };
    };
    const { LiveRoomService } = await import("../server/LiveRoomService");
    const first = await new LiveRoomService(db as never, await accountId("alpha"), scripted()).create();
    assert.equal(first.code, "ABCDE");
    const second = await new LiveRoomService(db as never, await accountId("beta"), scripted()).create();
    assert.equal(second.code, "FGHJK");
    assert.equal(second.members.length, 1);
    assert.equal((await live("GET", "", undefined, "alpha").then((r) => r.json()) as any).room.members.length, 1);
  } finally {
    await mf.dispose();
  }
});

test("live rooms: the friends overview and its invitations are not affected by rooms", async () => {
  const { mf, request, live } = await sandbox();
  try {
    const before = (await (await request("/api/friends", "GET", undefined, "alpha")).json()) as any;
    await live("POST", "", undefined, "alpha");
    const after = (await (await request("/api/friends", "GET", undefined, "alpha")).json()) as any;
    assert.deepEqual(after.me.inviteCode, before.me.inviteCode);
    assert.deepEqual(Object.keys(after).sort(), Object.keys(before).sort());
  } finally {
    await mf.dispose();
  }
});
