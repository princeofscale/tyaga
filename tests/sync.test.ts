import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import initSqlJs from "sql.js";
import { LocalD1 } from "../src/device/LocalD1";
import { handleApi, type Env } from "../server/index";
import cloud from "../server/cloud";
import { replicate, type SyncPage } from "../src/lib/replicate";
import { makeWorkout, type Workout } from "../src/lib/model";

const CLOUD = "https://tyaga.example";
const APP = "https://localhost"; // the Android WebView origin

async function database() {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.exec("PRAGMA foreign_keys = ON");
  for (const file of (await readdir("drizzle")).filter((f) => f.endsWith(".sql")).sort())
    db.exec(await readFile("drizzle/" + file, "utf8"));
  return new LocalD1(db);
}

/** The phone: the API on its own database, as src/device/localBackend.ts runs it. */
async function phone() {
  let token = "";
  const env = { DB: await database(), onSessionToken: (t: string) => (token = t) } as unknown as Env;
  const call = async (path: string, method = "GET", body?: unknown) => {
    const headers = new Headers({ "oai-authenticated-user-id": "device", Origin: APP });
    if (body !== undefined) headers.set("Content-Type", "application/json");
    if (token) headers.set("Cookie", `__Host-tyaga_session=${token}`);
    const response = await handleApi(new Request(APP + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), env);
    return { status: response.status, data: (await response.json()) as any };
  };
  assert.equal((await call("/api/auth/register", "POST", { email: "me@tyaga.app", password: "a device passphrase", displayName: "Атлет", timeZone: "UTC" })).status, 201);
  return call;
}

/** The cloud Worker, reached cross-origin from the app with a Bearer token. */
async function cloudWorker() {
  const env = { DB: await database() } as unknown as Env;
  const call = async (path: string, init: { method?: string; body?: unknown; token?: string; origin?: string; headers?: Record<string, string> } = {}) => {
    const headers = new Headers({ Origin: init.origin ?? APP, ...init.headers });
    if (init.token) headers.set("Authorization", `Bearer ${init.token}`);
    if (init.body !== undefined) headers.set("Content-Type", "application/json");
    const response = await cloud.fetch(
      new Request(CLOUD + path, { method: init.method ?? (init.body === undefined ? "GET" : "POST"), headers, body: init.body === undefined ? undefined : JSON.stringify(init.body) }),
      env,
    );
    return { response, status: response.status, data: (await response.json().catch(() => ({}))) as any };
  };
  return call;
}

function completed(weight: number): Workout {
  const w = makeWorkout(["bench"], [], "UTC");
  w.exercises[0].sets[0] = { ...w.exercises[0].sets[0], done: true, weight };
  return w;
}
const pause = () => new Promise((r) => setTimeout(r, 5));

test("cloud gateway: own sign-in, CORS for the app, no identity spoofing", async () => {
  const call = await cloudWorker();
  const preflight = await call("/api/sync/changes", { method: "OPTIONS" });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.response.headers.get("Access-Control-Allow-Origin"), "*");

  const a = await call("/api/auth/register", { body: { email: "a@example.test", password: "first passphrase", displayName: "A", timeZone: "UTC" } });
  assert.equal(a.status, 201);
  const tokenA = a.response.headers.get("X-Tyaga-Session")!;
  assert.match(tokenA, /^[a-f0-9]{64}$/);
  assert.equal(a.response.headers.get("Set-Cookie"), null, "the app gets the token, not a cookie");
  assert.equal((await call("/api/auth/register", { body: { email: "A@example.test", password: "other passphrase", displayName: "A2", timeZone: "UTC" } })).status, 409);

  const web = await call("/api/auth/register", { origin: CLOUD, body: { email: "b@example.test", password: "second passphrase", displayName: "B", timeZone: "UTC" } });
  assert.equal(web.status, 201);
  assert.match(web.response.headers.get("Set-Cookie") ?? "", /__Host-tyaga_session=[a-f0-9]{64}/, "the website keeps cookies");
  assert.equal(web.response.headers.get("X-Tyaga-Session"), null);
  const platformB = (await call("/api/data", { origin: CLOUD, headers: { Cookie: web.response.headers.get("Set-Cookie")!.split(";")[0] } })).status;
  assert.equal(platformB, 200);

  assert.equal((await call("/api/workouts", { method: "PUT", token: tokenA, body: completed(70) })).status, 200);
  // A forged identity header is ignored: A still only sees A's journal.
  const spoofed = await call("/api/data", { token: tokenA, headers: { "oai-authenticated-user-id": "someone-else" } });
  assert.equal(spoofed.data.workouts.length, 1);
  assert.equal((await call("/api/data")).status, 401, "no token, no journal");

  const login = await call("/api/auth/login", { body: { email: "a@example.test", password: "first passphrase" } });
  assert.equal(login.status, 200);
  assert.equal((await call("/api/data", { token: login.response.headers.get("X-Tyaga-Session")! })).data.workouts.length, 1);
  assert.equal((await call("/api/auth/login", { body: { email: "a@example.test", password: "wrong passphrase" } })).status, 401);
});

test("phone and cloud converge: push, pull, newer edit wins, deletes and favorites travel", async () => {
  const local = await phone();
  const remote = await cloudWorker();
  const token = (await remote("/api/auth/register", { body: { email: "me@example.test", password: "cloud passphrase", displayName: "Я", timeZone: "UTC" } })).response.headers.get("X-Tyaga-Session")!;
  const cursors = { local: 0, cloud: 0 };
  const sync = async () => {
    let pushed = 0;
    let pulled = 0;
    cursors.local = await replicate(
      async (since) => (await local(`/api/sync/changes?since=${since}`)).data as SyncPage,
      async (docs) => { pushed += (await remote("/api/sync/apply", { token, body: { docs } })).data.applied; },
      cursors.local,
    );
    cursors.cloud = await replicate(
      async (since) => (await remote(`/api/sync/changes?since=${since}`, { token })).data as SyncPage,
      async (docs) => { pulled += (await local("/api/sync/apply", "POST", { docs })).data.applied; },
      cursors.cloud,
    );
    return { pushed, pulled };
  };

  const offline = completed(80);
  assert.equal((await local("/api/workouts", "PUT", offline)).status, 200);
  assert.equal((await local("/api/favorites", "PUT", { exerciseId: "bench", favorite: true })).status, 200);
  const fromWeb = completed(100);
  assert.equal((await remote("/api/workouts", { method: "PUT", token, body: fromWeb })).status, 200);

  await sync();
  const cloudData = (await remote("/api/data", { token })).data;
  assert.deepEqual(cloudData.workouts.map((w: Workout) => w.id).sort(), [offline.id, fromWeb.id].sort());
  assert.deepEqual((await remote("/api/product", { token })).data.favorites, ["bench"]);
  assert.equal((await local("/api/data")).data.workouts.length, 2, "the web workout reached the phone");
  assert.deepEqual(await sync(), { pushed: 0, pulled: 0 }, "a second sync changes nothing");

  // Both sides edit the same workout; the later edit wins everywhere.
  const onPhone = (await local("/api/data")).data.workouts.find((w: Workout) => w.id === offline.id);
  onPhone.exercises[0].sets[0].weight = 85;
  assert.equal((await local("/api/workouts", "PUT", onPhone)).status, 200);
  await pause();
  const onCloud = (await remote("/api/data", { token })).data.workouts.find((w: Workout) => w.id === offline.id);
  onCloud.exercises[0].sets[0].weight = 90;
  assert.equal((await remote("/api/workouts", { method: "PUT", token, body: onCloud })).status, 200);
  await sync();
  const weight = (data: { workouts: Workout[] }) => data.workouts.find((w) => w.id === offline.id)!.exercises[0].sets[0].weight;
  assert.equal(weight((await local("/api/data")).data), 90);
  assert.equal(weight((await remote("/api/data", { token })).data), 90);

  // Deleting on the phone and un-favoriting reach the cloud as tombstones.
  const revision = (await local("/api/data")).data.workouts.find((w: Workout) => w.id === fromWeb.id).revision;
  assert.equal((await local("/api/workouts/" + fromWeb.id, "DELETE", { revision })).status, 200);
  assert.equal((await local("/api/favorites", "PUT", { exerciseId: "bench", favorite: false })).status, 200);
  await sync();
  assert.deepEqual((await remote("/api/data", { token })).data.workouts.map((w: Workout) => w.id), [offline.id]);
  assert.deepEqual((await remote("/api/product", { token })).data.favorites, []);
  assert.deepEqual(await sync(), { pushed: 0, pulled: 0 });
});
