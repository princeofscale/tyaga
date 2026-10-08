import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import initSqlJs from "sql.js";
import { LocalD1 } from "../src/device/LocalD1";
import { handleApi, type Env } from "../server/index";
import { makeWorkout, type Workout } from "../src/lib/model";

// The Android build runs this same API on sql.js instead of Cloudflare D1.
test("offline backend: profile, session token, workout save and atomic batches on sql.js", async () => {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.exec("PRAGMA foreign_keys = ON");
  for (const file of (await readdir("drizzle")).filter((f) => f.endsWith(".sql")).sort())
    db.exec(await readFile("drizzle/" + file, "utf8"));
  let token = "";
  const env = { DB: new LocalD1(db), onSessionToken: (t: string) => (token = t) } as unknown as Env;
  const call = async (path: string, method = "GET", body?: unknown) => {
    const headers = new Headers({ "oai-authenticated-user-id": "device", Origin: "https://localhost" });
    if (body !== undefined) headers.set("Content-Type", "application/json");
    if (token) headers.set("Cookie", `__Host-tyaga_session=${token}`);
    const response = await handleApi(
      new Request("https://localhost" + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }),
      env,
    );
    return { status: response.status, data: (await response.json()) as any };
  };

  assert.equal((await call("/api/data")).status, 401);
  const registered = await call("/api/auth/register", "POST", {
    email: "me@tyaga.app", password: "a device passphrase", displayName: "Атлет", timeZone: "UTC",
  });
  assert.equal(registered.status, 201);
  assert.match(token, /^[a-f0-9]{64}$/, "the hook hands the session token to the host");

  const w: Workout = makeWorkout(["bench"], [], "UTC");
  w.exercises[0].sets[0] = { ...w.exercises[0].sets[0], done: true, weight: 80 };
  const saved = await call("/api/workouts", "PUT", w);
  assert.equal(saved.status, 200);
  assert.equal(saved.data.workout.revision, 1);
  const data = await call("/api/data");
  assert.equal(data.data.workouts.length, 1);
  assert.equal(data.data.workouts[0].exercises[0].sets[0].weight, 80);

  const d1 = new LocalD1(db);
  await assert.rejects(d1.batch([
    d1.prepare("UPDATE accounts SET display_name = ?").bind("Не сохранится"),
    d1.prepare("INSERT INTO missing_table VALUES (1)"),
  ]));
  assert.equal(await d1.prepare("SELECT display_name FROM accounts").first("display_name"), "Атлет");

  const loggedOut = await call("/api/auth/logout", "POST", {});
  assert.equal(loggedOut.status, 200);
  assert.equal(token, "", "logout clears the stored token");
});
