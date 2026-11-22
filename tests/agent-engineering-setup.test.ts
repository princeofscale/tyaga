import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import initSqlJs, { type Database } from "sql.js";
import {
  generateSQLiteDrizzleJson,
  generateSQLiteMigration,
  type DrizzleSQLiteSnapshotJSON,
} from "drizzle-kit/api";
import * as schema from "../db/schema";
import { setup } from "./fixtures/api";
import { MachineRegistry } from "../src/domain/MachineRegistry";
import { LiveStateBuilder } from "../src/domain/LiveSession";
import { JournalBackup } from "../src/domain/JournalBackup";
import { DEFAULT_SETTINGS, entryName, makeWorkout } from "../src/lib/model";
import { LocalD1 } from "../src/device/LocalD1";
import { SyncService } from "../server/SyncService";
import type { LiveRoom } from "../src/lib/liveRoom";
import type { MachineInstance, ProductData, Workout } from "../src/lib/types";

type Journal = {
  entries: { idx: number; when: number; tag: string; breakpoints: boolean }[];
};
const roomsFile = "0010_live_rooms.sql";
const machinesFile = "0010_machines.sql";
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const snapshot = async (path: string) =>
  JSON.parse(await readFile(path, "utf8")) as DrizzleSQLiteSnapshotJSON;

async function migrationFiles() {
  return (await readdir("drizzle")).filter((file) => file.endsWith(".sql")).sort();
}

function rows(db: Database, query: string) {
  return db.exec(query)[0]?.values ?? [];
}

async function applyByFilename(db: Database, files: string[]) {
  db.exec("CREATE TABLE IF NOT EXISTS d1_migrations (name TEXT PRIMARY KEY)");
  const applied = new Set(rows(db, "SELECT name FROM d1_migrations").map((row) => row[0]));
  for (const file of files) {
    if (applied.has(file)) continue;
    db.exec("BEGIN");
    try {
      db.exec(await readFile(`drizzle/${file}`, "utf8"));
      db.run("INSERT INTO d1_migrations(name) VALUES (?)", [file]);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
}

const seedCommon = (db: Database) => db.exec(`
  INSERT INTO accounts(id,platform_id,email,display_name,password_hash,salt,recovery_hash,time_zone,revision,created_at)
  VALUES('setup-account','setup-owner','setup@example.test','SETUP sentinel','test-only','test-only','test-only','UTC',4,'2026-11-01T00:00:00Z');
  INSERT INTO workouts(id,owner_id,date,payload,updated_at,revision)
  VALUES('setup-workout','setup-owner','2026-11-01','{"sentinel":"legacy-history"}','2026-11-01T00:00:00Z',7);
  INSERT INTO settings(owner_id,payload,revision)
  VALUES('setup-owner','{"sentinel":"legacy-settings"}',3);
`);

test("SETUP: both published 0010 files and original snapshots retain their provenance", async () => {
  assert.equal(sha256(await readFile(`drizzle/${roomsFile}`)), "09938ab09d9bb0d81750fad6c3c6115d16eb1faedeb7970ff3ef069eadfc9a3d");
  assert.equal(sha256(await readFile(`drizzle/${machinesFile}`)), "91f6eb0effb0e109e05702fbeffbf07341d1363ccf47a5132fb196ee66f77eb9");
  assert.equal(sha256(await readFile("drizzle/meta/0010_snapshot.json")), "bd31820cd90d2e78203a4c136451742113f4ba4405686104420971fe297c0367");
  assert.equal(sha256(await readFile("drizzle/provenance/0010_machines_snapshot.original.json")), "a4e6aa9adaa1cf0446c0cc14bb97da72d96c74a7aad636affc70b838320a84b8");
  const journal = JSON.parse(await readFile("drizzle/meta/_journal.json", "utf8")) as Journal;
  assert.deepEqual(journal.entries.map((entry) => entry.idx), journal.entries.map((_, index) => index));
  assert.equal(new Set(journal.entries.map((entry) => entry.tag)).size, journal.entries.length);
  assert.equal(journal.entries[10].tag, "0010_live_rooms");
  assert.equal(journal.entries[10].when, 1794424045113);
  assert.equal(journal.entries[11].tag, "0010_machines");
  assert.equal(journal.entries[11].when, 1794468210926);
  assert.deepEqual((await migrationFiles()).slice(0, 12), journal.entries.slice(0, 12).map((entry) => `${entry.tag}.sql`));
  const rooms = await snapshot("drizzle/meta/0010_snapshot.json");
  const machines = await snapshot("drizzle/provenance/0010_machines_snapshot.original.json");
  const combined = await snapshot("drizzle/meta/0011_snapshot.json");
  assert.equal(combined.prevId, rooms.id);
  assert.notEqual(combined.id, rooms.id);
  assert.notEqual(combined.id, machines.id);
  assert.deepEqual(Object.keys(combined.tables).sort(), [...new Set([...Object.keys(rooms.tables), ...Object.keys(machines.tables)])].sort());
  for (const parent of [rooms, machines]) {
    for (const [name, table] of Object.entries(parent.tables)) assert.deepEqual(combined.tables[name], table, name);
  }
});

test("SETUP: Drizzle emits exactly the email index for 0012, then a clean current diff", async () => {
  const combined = await snapshot("drizzle/meta/0011_snapshot.json");
  const latest = await snapshot("drizzle/meta/0012_snapshot.json");
  const current = await generateSQLiteDrizzleJson(schema, combined.id);
  assert.deepEqual(await generateSQLiteMigration(combined, current), ["CREATE UNIQUE INDEX `idx_accounts_email` ON `accounts` (`email`);"]);
  assert.equal(latest.prevId, combined.id);
  assert.deepEqual(await generateSQLiteMigration(latest, current), []);
});

for (const branch of ["empty", "rooms-only", "machines-only"] as const) {
  test(`SETUP: filename-based ${branch} upgrade preserves rows, indexes, FK and sync triggers`, async () => {
    const SQL = await initSqlJs();
    const db = new SQL.Database();
    try {
      db.exec("PRAGMA foreign_keys=ON");
      const files = await migrationFiles();
      if (branch !== "empty") {
        await applyByFilename(db, files.filter((file) => !file.startsWith("0010_") || file === (branch === "rooms-only" ? roomsFile : machinesFile)));
        seedCommon(db);
        if (branch === "rooms-only") {
          db.exec("INSERT INTO live_members(code,account_id,state,joined_at,updated_at) VALUES('K7M2Q','setup-account','{\"phase\":\"idle\"}','2026-11-01T00:00:00Z','2026-11-01T00:00:00Z')");
        } else {
          db.exec(`
            INSERT INTO machine_models(owner_id,id,payload) VALUES('setup-owner','setup-model','{"sentinel":"immutable-model"}');
            INSERT INTO machine_instances(owner_id,id,model_id,payload,revision,active,updated_at)
            VALUES('setup-owner','setup-machine','setup-model','{"sentinel":"archived-machine"}',5,0,'2026-11-01T00:00:00Z');
          `);
        }
      }
      const before = branch === "empty" ? [] : rows(db, "SELECT payload,revision FROM workouts WHERE id='setup-workout'");
      await applyByFilename(db, files);
      const applied = rows(db, "SELECT name FROM d1_migrations ORDER BY name");
      assert.deepEqual(applied.map((row) => row[0]), files);
      if (branch !== "empty") {
        assert.deepEqual(rows(db, "SELECT payload,revision FROM workouts WHERE id='setup-workout'"), before);
        assert.deepEqual(rows(db, "SELECT payload,revision FROM settings WHERE owner_id='setup-owner'"), [['{"sentinel":"legacy-settings"}', 3]]);
        assert.deepEqual(rows(db, "SELECT revision FROM accounts WHERE id='setup-account'"), [[4]]);
      }
      if (branch === "rooms-only") assert.deepEqual(rows(db, "SELECT code,state FROM live_members WHERE account_id='setup-account'"), [["K7M2Q", '{"phase":"idle"}']]);
      if (branch === "machines-only") {
        assert.deepEqual(rows(db, "SELECT payload,revision,active FROM machine_instances WHERE id='setup-machine'"), [['{"sentinel":"archived-machine"}', 5, 0]]);
        assert.deepEqual(rows(db, "SELECT payload FROM machine_models WHERE id='setup-model'"), [['{"sentinel":"immutable-model"}']]);
      }
      const tableNames = new Set(rows(db, "SELECT name FROM sqlite_master WHERE type='table'").map((row) => row[0]));
      const combined = await snapshot("drizzle/meta/0011_snapshot.json");
      for (const name of Object.keys(combined.tables)) assert.ok(tableNames.has(name), name);
      assert.equal(rows(db, "SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'sync_machine_%'").length, 6);
      for (const index of ["idx_accounts_email", "idx_live_members_account", "idx_live_members_code", "idx_machines_owner"]) {
        assert.equal(rows(db, `SELECT name FROM sqlite_master WHERE type='index' AND name='${index}'`).length, 1, index);
      }
      assert.deepEqual(db.exec("PRAGMA foreign_key_check"), []);
      await applyByFilename(db, files);
      assert.deepEqual(rows(db, "SELECT name FROM d1_migrations ORDER BY name"), applied);
      db.exec(`
        INSERT INTO machine_models(owner_id,id,payload) VALUES('trigger-owner','trigger-model','{}');
        UPDATE machine_models SET payload='{"updated":true}' WHERE owner_id='trigger-owner';
        DELETE FROM machine_models WHERE owner_id='trigger-owner';
        INSERT INTO machine_instances(owner_id,id,model_id,payload,updated_at) VALUES('trigger-owner','trigger-machine','trigger-model','{}','2026-11-01T00:00:00Z');
        UPDATE machine_instances SET revision=2 WHERE owner_id='trigger-owner';
        DELETE FROM machine_instances WHERE owner_id='trigger-owner';
      `);
      assert.deepEqual(rows(db, "SELECT kind,doc_id,deleted FROM sync_versions WHERE owner_id='trigger-owner' ORDER BY kind"), [["machine", "trigger-machine", 1], ["machine_model", "trigger-model", 1]]);
    } finally {
      db.close();
    }
  });
}

test("SETUP: duplicate normalized email cannot bypass registration pre-check", async () => {
  const { call } = await setup();
  const registration = {
    email: "Race@Example.test", password: "a long shared test password",
    displayName: "Гонка", timeZone: "Europe/Saratov",
  };
  const first = await call("race-owner", "/api/auth/register", "POST", registration);
  assert.equal(first.status, 201);
  const second = await call("race-other-owner", "/api/auth/register", "POST", { ...registration, email: "race@example.test" });
  assert.equal(second.status, 409);
  assert.equal(second.data.error, "Эта почта уже зарегистрирована. Войди с ней.");
});

test("SETUP: rooms and private owner-scoped machines coexist without leaking social state into sync or backup", async () => {
  const { call, db } = await setup();
  try {
    const machine = MachineRegistry.create();
    machine.nickname = "PRIVATE-MACHINE-SENTINEL";
    machine.gym = "PRIVATE-GYM-SENTINEL";
    machine.model.model = "SETUP Model";
    machine.model.manufacturer = "SETUP";
    const saved = await call<{ machine: MachineInstance }>("a", "/api/machines", "PUT", machine);
    assert.equal(saved.status, 200);
    assert.deepEqual((await call<ProductData>("b", "/api/product")).data.machines, []);
    const made = await call<{ room: LiveRoom }>("a", "/api/friends/live", "POST");
    assert.equal(made.status, 200);
    const joined = await call<{ room: LiveRoom }>("b", "/api/friends/live/join", "POST", { code: made.data.room.code });
    assert.equal(joined.status, 200);
    const workout = makeWorkout(["row"]);
    workout.notes = "PRIVATE-HISTORY-SENTINEL";
    workout.exercises[0].machineInstanceId = machine.id;
    workout.exercises[0].machineSnapshot = saved.data.machine;
    workout.exercises[0].sets[0].done = true;
    workout.exercises[0].sets[0].weight = 50;
    assert.equal((await call("a", "/api/workouts", "PUT", workout)).status, 200);
    const state = LiveStateBuilder.fromWorkout(workout, { now: Date.now(), nameOf: entryName });
    assert.equal((await call("a", "/api/friends/live/state", "PUT", { ...state, notes: workout.notes, machineSnapshot: machine })).status, 200);
    const visible = await call<{ room: LiveRoom }>("b", "/api/friends/live");
    assert.equal(visible.data.room.members.length, 2);
    for (const secret of [machine.id, machine.nickname, machine.gym, workout.notes, "a@example.test"]) assert.ok(!JSON.stringify(visible.data).includes(secret), secret);
    const changes = new SyncService(new LocalD1(db) as unknown as D1Database, "a");
    const before = await changes.changes(0);
    assert.ok(before.docs.some((doc) => doc.kind === "machine"));
    assert.ok(before.docs.some((doc) => doc.kind === "machine_model"));
    assert.ok(!JSON.stringify(before).includes(made.data.room.code));
    const legacy = await changes.changes(0, 200, false);
    assert.ok(legacy.docs.every((doc) => doc.kind !== "machine" && doc.kind !== "machine_model"));
    assert.equal(legacy.cursor, before.cursor);
    assert.equal((await call("a", "/api/friends/live", "DELETE")).status, 200);
    assert.deepEqual(await changes.changes(before.cursor), { docs: [], cursor: before.cursor, more: false });
    const history = (await call<{ workouts: Workout[] }>("a", "/api/data")).data.workouts;
    const product = (await call<ProductData>("a", "/api/product")).data;
    const backup = JournalBackup.create(history, DEFAULT_SETTINGS, product, { entries: [], goal: { targetWeightKg: null, startWeightKg: null } }, "lime");
    assert.equal(backup.machines[0].id, machine.id);
    assert.equal(backup.workouts[0].exercises[0].machineSnapshot?.id, machine.id);
    assert.ok(!Object.hasOwn(backup, "rooms"));
    assert.ok(!Object.hasOwn(backup, "live_members"));
    assert.ok(!JSON.stringify(backup).includes(made.data.room.code));
    assert.deepEqual(db.exec("PRAGMA foreign_key_check"), []);
  } finally {
    db.close();
  }
});
