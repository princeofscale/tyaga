import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import initSqlJs from "sql.js";
import { LocalD1 } from "../src/device/LocalD1";
import { SyncService, type SyncDoc } from "../server/SyncService";

async function localDatabase(publishedOnly = false) {
  const SQL = await initSqlJs();
  const raw = new SQL.Database();
  raw.exec("PRAGMA foreign_keys=ON");
  const files = (await readdir("drizzle")).filter((p) => p.endsWith(".sql")).sort();
  for (const file of files.filter((p) => !publishedOnly || p !== "0011_import_receipts.sql"))
    raw.exec(await readFile(`drizzle/${file}`, "utf8"));
  return { db: new LocalD1(raw) as unknown as D1Database, raw };
}

const row = (id: string, notes: string, weight: number, revision: number, updatedAt: string) => ({
  id, date: "2026-10-05", revision, updated_at: updatedAt,
  payload: JSON.stringify({ id, date: "2026-10-05", name: "Тяга", notes,
    exercises: [{ exerciseId: "deadlift-bar", sets: [{ id: "set1", weight, reps: 8, done: true }] }] }),
});

test("0011 is additive to old local D1: no rewritten history, no legacy import receipts", async () => {
  const { db, raw } = await localDatabase(true);
  try {
    await db.prepare("INSERT INTO workouts(id,owner_id,date,payload,updated_at,revision) VALUES(?,?,?,?,?,?)")
      .bind("import:legacy", "owner", "2026-10-05", '{"notes":"historical"}', "2026-10-05T12:00:00.000Z", 1).run();
    raw.exec(await readFile("drizzle/0011_import_receipts.sql", "utf8"));
    const original = await db.prepare("SELECT payload,revision FROM workouts WHERE owner_id=? AND id=?")
      .bind("owner", "import:legacy").first<{ payload: string; revision: number }>();
    assert.deepEqual(original, { payload: '{"notes":"historical"}', revision: 1 });
    assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM workout_import_receipts").first<{ n: number }>())?.n, 0);
    assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM workout_import_runs").first<{ n: number }>())?.n, 0);
  } finally { raw.close(); }
});

test("two independent D1s preserve a phone offline edit before a newer cloud import/tombstone", async () => {
  const phone = await localDatabase();
  const cloud = await localDatabase();
  try {
    const owner = "owner";
    const id = "import:owner:same-session";
    const initial = row(id, "from import", 100, 1, "2026-11-14T10:00:00.000Z");
    for (const db of [phone.db, cloud.db])
      await db.prepare("INSERT INTO workouts(id,owner_id,date,payload,updated_at,revision) VALUES(?,?,?,?,?,?)")
        .bind(id, owner, initial.date, initial.payload, initial.updated_at, initial.revision).run();
    const phoneEdited = row(id, "PHONE OFFLINE", 135, 2, "2026-11-14T11:00:00.000Z");
    await phone.db.prepare("UPDATE workouts SET payload=?,revision=?,updated_at=? WHERE owner_id=? AND id=?")
      .bind(phoneEdited.payload, phoneEdited.revision, phoneEdited.updated_at, owner, id).run();
    const newerCloud = row(id, "CLOUD REIMPORT", 110, 2, "2030-01-01T00:00:00.000Z");
    await cloud.db.prepare("UPDATE workouts SET payload=?,revision=?,updated_at=? WHERE owner_id=? AND id=?")
      .bind(newerCloud.payload, newerCloud.revision, newerCloud.updated_at, owner, id).run();
    const phoneDoc: SyncDoc = { kind: "workout", id, deleted: false, versionAt: phoneEdited.updated_at, row: phoneEdited };
    const cloudSync = new SyncService(cloud.db, owner);
    const stalePush = await cloudSync.apply({ docs: [phoneDoc] });
    assert.equal(stalePush.applied, 0, "cloud newer version wins");
    const pull: SyncDoc = { kind: "workout", id, deleted: false, versionAt: newerCloud.updated_at, row: newerCloud };
    const phoneSync = new SyncService(phone.db, owner);
    assert.equal((await phoneSync.apply({ docs: [pull] })).applied, 1);
    const archive = await phoneSync.recovery();
    assert.equal(archive.records.length, 1);
    assert.equal(archive.records[0].id, id);
    assert.equal(archive.records[0].payload, phoneEdited.payload);
    assert.equal(archive.records[0].revision, 2);
    assert.equal((await new SyncService(phone.db, "other-owner").recovery()).records.length, 0);
    const current = await phone.db.prepare("SELECT payload FROM workouts WHERE owner_id=? AND id=?")
      .bind(owner, id).first<{ payload: string }>();
    assert.equal(current?.payload, newerCloud.payload);
    const tombstone: SyncDoc = { kind: "workout", id, deleted: true, versionAt: "2031-01-01T00:00:00.000Z" };
    assert.equal((await phoneSync.apply({ docs: [tombstone] })).applied, 1);
    assert.equal((await phone.db.prepare("SELECT COUNT(*) AS n FROM workouts WHERE owner_id=? AND id=?").bind(owner, id).first<{ n: number }>())?.n, 0);
    assert.equal((await phoneSync.recovery()).records.length, 2, "incoming tombstone saved the previous document as well");
    assert.equal((await new SyncService(phone.db, "other-owner").recovery()).records.length, 0);
  } finally { phone.raw.close(); cloud.raw.close(); }
});
