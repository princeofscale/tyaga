import test from "node:test";
import assert from "node:assert/strict";
import { setup } from "./fixtures/api";
import {
  makeWorkout,
  weekStart,
  localDate,
  addCalendarDays,
} from "../src/lib/model";
import type { FriendsData } from "../src/domain/FriendsService";
import type { TeamChallenge } from "../src/domain/TeamChallenge";
test("challenge consent, frozen individual goals, ownership, private summaries and revoked friendship", async () => {
  const { call, ids, db } = await setup();
  try {
    const accountId = ids.get("a")!,
      other = ids.get("b")!;
    const a = (await call<FriendsData>("a", "/api/friends")).data,
      b = (await call<FriendsData>("b", "/api/friends")).data;
    await call("a", "/api/friends/requests", "POST", { code: b.me.inviteCode });
    await call("b", `/api/friends/connections/${a.me.id}`, "PUT", {});
    const start = weekStart(new Date(), "UTC"),
      input = {
        id: "four-weeks",
        name: "Ритм команды",
        startDate: start,
        target: 1,
        friendIds: [other],
        accountId,
      };
    assert.equal(
      (await call("a", "/api/challenges", "POST", input, "https://other.test"))
        .status,
      403,
    );
    assert.equal(
      (
        await call("a", "/api/challenges", "POST", {
          ...input,
          accountId: other,
        })
      ).status,
      401,
    );
    assert.equal(
      (
        await call("a", "/api/challenges", "POST", {
          ...input,
          startDate: addCalendarDays(start, 1),
        })
      ).status,
      400,
    );
    assert.equal(
      (await call("a", "/api/challenges", "POST", input)).status,
      200,
    );
    assert.equal(
      (await call("a", "/api/challenges", "POST", input)).status,
      200,
    );
    assert.equal(
      (await call("a", "/api/challenges", "POST", { ...input, target: 2 }))
        .status,
      409,
    );
    const read = async (who: string) =>
      (await call<{ challenges: TeamChallenge[] }>(who, "/api/challenges")).data
        .challenges;
    assert.equal((await read("outsider")).length, 0);
    assert.equal((await read("b"))[0].myResponse, "invited");
    assert.ok((await read("b"))[0].participants.every((p) => !p.weeks));
    assert.equal(
      (
        await call("outsider", "/api/challenges/four-weeks", "PUT", {
          action: "accept",
          target: 2,
          accountId: ids.get("outsider"),
        })
      ).status,
      404,
    );
    assert.equal(
      (
        await call("b", "/api/challenges/four-weeks", "PUT", {
          action: "cancel",
          accountId: other,
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await call("b", "/api/challenges/four-weeks", "PUT", {
          action: "accept",
          target: 4,
          accountId: other,
        })
      ).status,
      200,
    );
    await call("b", "/api/friends/goal", "PUT", { target: 1 });
    await call("b", "/api/challenges/four-weeks", "PUT", {
      action: "accept",
      target: 1,
      accountId: other,
    });
    for (let i = 0; i < 2; i++) {
      const w = makeWorkout(["bench"], [], "UTC");
      w.date = localDate(new Date(), "UTC");
      w.name = "Private workout title";
      w.notes = "SECRET private note";
      w.exercises[0].sets[0].done = true;
      assert.equal((await call("a", "/api/workouts", "PUT", w)).status, 200);
    }
    const room = (await read("a"))[0];
    assert.equal(room.participants.find((p) => p.id === other)!.target, 4);
    assert.equal(
      room.participants.find((p) => p.id === accountId)!.weeks![0].count,
      2,
    );
    assert.ok(
      !JSON.stringify(room).match(
        /SECRET|Private workout|weightKg|bodyMass|email/,
      ),
    );
    await call("b", "/api/challenges/four-weeks", "PUT", {
      action: "decline",
      accountId: other,
    });
    await call("b", "/api/challenges/four-weeks", "PUT", {
      action: "accept",
      target: 1,
      accountId: other,
    });
    assert.equal(
      (await read("b"))[0].participants.find((p) => p.id === other)!.target,
      4,
    );
    await call("a", `/api/friends/connections/${other}`, "DELETE", {});
    assert.equal((await read("b")).length, 0);
    assert.equal((await read("a"))[0].participants.length, 1);
    assert.equal(
      (
        await call("b", "/api/challenges/four-weeks", "PUT", {
          action: "accept",
          target: 1,
          accountId: other,
        })
      ).status,
      404,
    );
    assert.equal(
      (
        await call("a", "/api/challenges/four-weeks", "PUT", {
          action: "cancel",
          accountId,
        })
      ).status,
      200,
    );
    assert.equal((await read("a"))[0].cancelled, true);
  } finally {
    db.close();
  }
});
test("workout body mass accepts the same range as the weighing journal", async () => {
  const { call, db } = await setup();
  try {
    const w = makeWorkout(["pullup"], [], "UTC");
    w.exercises[0].bodyMassKg = 450;
    w.exercises[0].sets[0].done = true;
    assert.equal((await call("a", "/api/workouts", "PUT", w)).status, 200);
    assert.equal(
      (
        await call("a", "/api/workouts", "PUT", {
          ...w,
          id: crypto.randomUUID(),
          exercises: [{ ...w.exercises[0], bodyMassKg: 501 }],
        })
      ).status,
      400,
    );
  } finally {
    db.close();
  }
});

test("curated release-3 machines require identity, while old backups retain an isolated unknown-machine marker", async () => {
  const { call, db } = await setup();
  try {
    const w = makeWorkout(["extension-v-pushdown"], [], "UTC");
    w.exercises[0].sets[0].done = true;
    assert.equal((await call("a", "/api/workouts", "PUT", w)).status, 400);
    const { WorkoutImport } = await import("../src/domain/WorkoutImport");
    const preview = new WorkoutImport({
      dateOrder: "dmy",
      weightUnit: "kg",
      distanceUnit: "km",
      timeZone: "UTC",
    }).parse(JSON.stringify({ version: 3, workouts: [w] }), "tyaga");
    const imported = await call<{ workouts: (typeof w)[] }>(
      "a",
      "/api/import",
      "POST",
      { format: "tyaga", workouts: preview.workouts },
    );
    assert.equal(imported.status, 200);
    assert.match(
      imported.data.workouts[0].exercises[0].equipmentNote!,
      /Не указан · импорт/,
    );
  } finally {
    db.close();
  }
});
