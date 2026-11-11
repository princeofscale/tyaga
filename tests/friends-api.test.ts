import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { makeWorkout } from "../src/lib/model";
import type { FriendsData } from "../src/domain/FriendsService";

test("real friends: mutual consent, private summaries, expiring presence, idempotent kudos and revocation", async () => {
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
  const cookies = new Map<string, string>();
  const base = "https://tyaga.test";
  const call = (
    who: string,
    path = "/api/friends",
    method = "GET",
    body?: unknown,
    origin = base,
  ) =>
    mf.dispatchFetch(base + path, {
      method,
      headers: {
        "oai-authenticated-user-id": who,
        Cookie: cookies.get(who) ?? "",
        Origin: origin,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const read = async (who: string) => {
    const r = await call(who);
    assert.equal(r.status, 200);
    return (await r.json()) as FriendsData;
  };
  try {
    for (const file of (await readdir("drizzle"))
      .filter((p) => p.endsWith(".sql"))
      .sort())
      for (const statement of (await readFile("drizzle/" + file, "utf8"))
        .split("--> statement-breakpoint")
        .filter((s) => s.trim()))
        await db.prepare(statement.trim()).run();
    assert.equal((await call("alice")).status, 401);
    for (const who of ["alice", "bob", "outsider"]) {
      const registered = await call(who, "/api/auth/register", "POST", {
        email: `${who}@example.test`,
        password: "friends test passphrase",
        displayName: who,
        timeZone: "UTC",
      });
      assert.equal(registered.status, 201);
      cookies.set(who, registered.headers.get("Set-Cookie")!.split(";")[0]);
    }
    const alice = await read("alice"),
      bob = await read("bob"),
      outsider = await read("outsider");
    assert.deepEqual(alice.friends, []);
    assert.deepEqual(alice.feed, []);
    assert.match(alice.me.inviteCode, /^[A-F0-9]{12}$/);
    assert.equal(
      (await read("alice")).me.inviteCode,
      alice.me.inviteCode,
      "invite survives reload",
    );
    const w = makeWorkout(["bench"], [], "UTC");
    w.name = "День спины";
    w.notes = "private notes";
    w.exercises[0].sets[0] = {
      ...w.exercises[0].sets[0],
      done: true,
      weight: 60,
      reps: 8,
    };
    assert.equal((await call("bob", "/api/workouts", "PUT", w)).status, 200);
    assert.equal(
      (
        await call("bob", "/api/friends/status", "PUT", {
          inGym: true,
          gym: "Другой зал",
          focus: "Спина",
        })
      ).status,
      200,
    );
    assert.equal((await read("alice")).feed.length, 0);
    assert.equal(
      (
        await call("alice", "/api/friends/requests", "POST", {
          code: alice.me.inviteCode,
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await call("alice", "/api/friends/requests", "POST", {
          code: "000000000000",
        })
      ).status,
      404,
    );
    assert.equal(
      (
        await call(
          "alice",
          "/api/friends/requests",
          "POST",
          { code: bob.me.inviteCode },
          "https://evil.example",
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await call("alice", "/api/friends/requests", "POST", {
          code: bob.me.inviteCode,
        })
      ).status,
      200,
    );
    // Repeated and reverse sends never duplicate or silently accept relationships.
    await call("alice", "/api/friends/requests", "POST", {
      code: bob.me.inviteCode,
    });
    await call("bob", "/api/friends/requests", "POST", {
      code: alice.me.inviteCode,
    });
    const pending = await read("alice");
    assert.equal(pending.requests.length, 1);
    assert.equal(pending.requests[0].direction, "outgoing");
    assert.equal(pending.friends.length, 0);
    assert.equal(pending.feed.length, 0);
    assert.equal((await read("bob")).requests[0].direction, "incoming");
    assert.equal(
      (await call("alice", `/api/friends/connections/${bob.me.id}`, "PUT", {}))
        .status,
      404,
    );
    assert.equal(
      (
        await call(
          "outsider",
          `/api/friends/connections/${alice.me.id}`,
          "PUT",
          {},
        )
      ).status,
      404,
    );
    assert.equal(
      (
        await call("alice", `/api/friends/kudos/${w.id}`, "PUT", {
          given: true,
        })
      ).status,
      404,
    );
    assert.equal(
      (await call("bob", `/api/friends/connections/${alice.me.id}`, "PUT", {}))
        .status,
      200,
    );
    const connected = await read("alice");
    assert.equal(connected.friends.length, 1);
    assert.equal(connected.requests.length, 0);
    assert.equal(connected.friends[0].gym, "Другой зал");
    assert.ok(connected.friends[0].activeUntil > Date.now());
    assert.ok(connected.friends[0].activeUntil <= Date.now() + 7200000);
    assert.equal(connected.friends[0].weekWorkouts, 1);
    assert.equal(connected.feed[0].setsCount, 1);
    assert.equal(connected.feed[0].volumeKg, 480);
    const serialized = JSON.stringify(connected);
    for (const secret of [
      "private notes",
      "@example.test",
      "password_hash",
      "bodyMassKg",
      "platform_id",
      "exercises",
      "recovery",
    ])
      assert.ok(
        !serialized.includes(secret),
        `summary must not expose ${secret}`,
      );
    assert.equal((await read("outsider")).feed.length, 0);
    assert.equal(
      (
        await call("outsider", `/api/friends/kudos/${w.id}`, "PUT", {
          given: true,
        })
      ).status,
      404,
    );
    assert.equal(
      (await call("bob", `/api/friends/kudos/${w.id}`, "PUT", { given: true }))
        .status,
      404,
    );
    for (let i = 0; i < 2; i++)
      assert.equal(
        (
          await call("alice", `/api/friends/kudos/${w.id}`, "PUT", {
            given: true,
          })
        ).status,
        200,
      );
    assert.equal((await read("bob")).feed[0].kudosCount, 1);
    assert.equal((await read("alice")).feed[0].hasGivenKudos, true);
    await call("alice", `/api/friends/kudos/${w.id}`, "PUT", { given: false });
    assert.equal((await read("bob")).feed[0].kudosCount, 0);
    await call("alice", `/api/friends/kudos/${w.id}`, "PUT", { given: true });
    await db
      .prepare(
        "UPDATE social_profiles SET active_until = ? WHERE account_id = ?",
      )
      .bind(Date.now() - 1, bob.me.id)
      .run();
    assert.ok((await read("alice")).friends[0].activeUntil < Date.now());
    assert.equal(
      (
        await call("bob", "/api/friends/status", "PUT", {
          inGym: true,
          gym: "a".repeat(61),
          focus: "",
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await call("bob", "/api/friends/status", "PUT", {
          inGym: "yes",
          gym: "",
          focus: "",
        })
      ).status,
      400,
    );
    assert.equal(
      (await call("bob", "/api/friends/status", "PUT", null)).status,
      400,
    );
    assert.equal(
      (
        await call(
          "alice",
          `/api/friends/connections/${bob.me.id}`,
          "DELETE",
          {},
        )
      ).status,
      200,
    );
    assert.equal((await read("alice")).feed.length, 0);
    assert.equal((await read("bob")).friends.length, 0);
    assert.equal(
      (
        await call("alice", `/api/friends/kudos/${w.id}`, "PUT", {
          given: true,
        })
      ).status,
      404,
    );
    assert.equal((await read("bob")).feed[0].kudosCount, 0);
    // Decline/cancel is allowed for either party; unrelated users cannot remove another pair.
    await call("bob", "/api/friends/requests", "POST", {
      code: outsider.me.inviteCode,
    });
    await call("alice", `/api/friends/connections/${bob.me.id}`, "DELETE", {});
    assert.equal((await read("outsider")).requests.length, 1);
    await call(
      "outsider",
      `/api/friends/connections/${bob.me.id}`,
      "DELETE",
      {},
    );
    assert.equal((await read("bob")).requests.length, 0);
    await db
      .prepare("INSERT INTO auth_limits VALUES (?, 30, ?)")
      .bind(`social:${outsider.me.id}`, Date.now())
      .run();
    assert.equal(
      (
        await call("outsider", "/api/friends/requests", "POST", {
          code: bob.me.inviteCode,
        })
      ).status,
      429,
    );
  } finally {
    await mf.dispose();
  }
});
