import { setup } from "./fixtures/api";
import test from "node:test";
import assert from "node:assert/strict";
import { makeWorkout } from "../src/lib/model";
import type { FriendsData } from "../src/domain/FriendsService";

test("weight documents are private, compare-and-swap, retry safe, and keep delete tombstones", async () => {
  const { call, ids, db } = await setup();
  try {
    const accountId = ids.get("a")!;
    const today = new Date().toISOString().slice(0, 10);
    const key = `weight:${today}`;
    const value = {
      id: "original-legacy-id",
      date: today,
      weightKg: 61.5,
      note: "private weigh-in",
      createdAt: Date.now(),
    };
    const input = { accountId, value, revision: 0, mutationId: "first" };
    assert.equal(
      (
        await call(
          "a",
          "/api/bodyweight/" + key,
          "PUT",
          input,
          "https://evil.test",
        )
      ).status,
      403,
    );
    const created = await call<{ document: { revision: number } }>(
      "a",
      "/api/bodyweight/" + key,
      "PUT",
      input,
    );
    assert.equal(created.status, 200);
    assert.equal(created.data.document.revision, 1);
    assert.equal(
      (
        await call<{ document: { revision: number } }>(
          "a",
          "/api/bodyweight/" + key,
          "PUT",
          input,
        )
      ).data.document.revision,
      1,
    );
    assert.equal(
      (await call<{ documents: unknown[] }>("b", "/api/bodyweight")).data
        .documents.length,
      0,
    );
    assert.equal(
      (await call("b", "/api/bodyweight/" + key, "PUT", input)).status,
      401,
    );
    const updated = await call<{ document: { revision: number } }>(
      "a",
      "/api/bodyweight/" + key,
      "PUT",
      {
        ...input,
        value: { ...value, weightKg: 62 },
        revision: 1,
        mutationId: "edit",
      },
    );
    assert.equal(updated.data.document.revision, 2);
    assert.equal(
      (
        await call("a", "/api/bodyweight/" + key, "PUT", {
          ...input,
          mutationId: "stale-other-device",
        })
      ).status,
      409,
    );
    const deleted = await call<{ document: { value: null; revision: number } }>(
      "a",
      "/api/bodyweight/" + key,
      "PUT",
      { accountId, value: null, revision: 2, mutationId: "delete" },
    );
    assert.equal(deleted.data.document.value, null);
    assert.equal(deleted.data.document.revision, 3);
    assert.equal(
      (await call("a", "/api/bodyweight/" + key, "PUT", input)).status,
      409,
      "old retry cannot resurrect a deleted entry",
    );
    assert.equal(
      (
        await call("a", "/api/bodyweight/weight:2099-01-01", "PUT", {
          ...input,
          value: { ...value, date: "2099-01-01" },
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await call("a", "/api/bodyweight/goal", "PUT", {
          accountId,
          value: { targetWeightKg: 70, startWeightKg: 61.5 },
          revision: 0,
          mutationId: "goal",
        })
      ).status,
      200,
    );
  } finally {
    db.close();
  }
});

test("meetups: invitation consent, remote gyms, personal targets, shared completion and access revocation", async () => {
  const { call, ids, db } = await setup();
  try {
    const read = async (owner: string) =>
      (await call<FriendsData>(owner, "/api/friends")).data;
    const a = await read("a"),
      b = await read("b");
    await call("a", "/api/friends/requests", "POST", { code: b.me.inviteCode });
    await call("b", `/api/friends/connections/${a.me.id}`, "PUT", {});
    assert.equal(
      (await call("a", "/api/friends/goal", "PUT", { target: 2 })).status,
      200,
    );
    assert.equal((await read("a")).me.weeklyTarget, 2);
    assert.equal(
      (await call("a", "/api/friends/goal", "PUT", { target: 0 })).status,
      400,
    );
    const input = {
      id: "meetup-test",
      name: "Тренировка вместе",
      gym: "Зал A",
      startsAt: new Date(Date.now() - 60000).toISOString(),
      friendIds: [b.me.id],
    };
    assert.equal(
      (
        await call("a", "/api/friends/meetups", "POST", {
          ...input,
          id: "bad",
          friendIds: [ids.get("outsider")],
        })
      ).status,
      403,
    );
    assert.equal(
      (await call("a", "/api/friends/meetups", "POST", input)).status,
      200,
    );
    assert.equal(
      (await call("a", "/api/friends/meetups", "POST", input)).status,
      200,
    );
    assert.equal((await read("b")).meetups?.[0].myResponse, "invited");
    assert.equal((await read("outsider")).meetups?.length, 0);
    assert.equal(
      (
        await call("outsider", "/api/friends/meetups/meetup-test", "PUT", {
          action: "accept",
        })
      ).status,
      404,
    );
    assert.equal(
      (
        await call("b", "/api/friends/meetups/meetup-test", "PUT", {
          action: "finish",
          workoutId: "not-mine",
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await call("b", "/api/friends/meetups/meetup-test", "PUT", {
          action: "accept",
          gym: "Зал B",
        })
      ).status,
      200,
    );
    const savedIds = new Map<string, string>();
    for (const who of ["a", "b"]) {
      const w = makeWorkout(["bench"], [], "UTC");
      w.name = `Вместе · ${who}`;
      w.notes = "PRIVATE NOTES DO NOT SHARE";
      w.duration = 30;
      w.exercises[0].sets[0].done = true;
      const saved = await call<{ workout: { id: string } }>(
        who,
        "/api/workouts",
        "PUT",
        w,
      );
      assert.equal(saved.status, 200);
      savedIds.set(who, saved.data.workout.id);
      assert.equal(
        (
          await call(who, "/api/friends/meetups/meetup-test", "PUT", {
            action: "finish",
            workoutId: saved.data.workout.id,
          })
        ).status,
        200,
      );
    }
    const room = (await read("a")).meetups![0];
    assert.equal(room.participants.filter((p) => p.summary).length, 2);
    assert.ok(room.participants.some((p) => p.gym === "Зал B"));
    assert.ok(!JSON.stringify(room).includes("PRIVATE"));
    assert.equal(
      (
        await call("a", "/api/friends/meetups", "POST", {
          ...input,
          id: "second-meetup",
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await call("a", "/api/friends/meetups/second-meetup", "PUT", {
          action: "finish",
          workoutId: savedIds.get("a"),
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await call("b", "/api/friends/meetups/meetup-test", "PUT", {
          action: "cancel",
        })
      ).status,
      403,
    );
    await call("a", `/api/friends/connections/${b.me.id}`, "DELETE", {});
    assert.equal((await read("b")).meetups?.length, 0);
    assert.equal((await read("a")).meetups![0].participants.length, 1);
  } finally {
    db.close();
  }
});
