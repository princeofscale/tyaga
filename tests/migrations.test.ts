import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFile, readdir } from "node:fs/promises";
import initSqlJs from "sql.js";
import { checkMigrations } from "../scripts/check-migrations.mjs";

test("drizzle/ migrations have valid sequential numbering without new duplicates", () => {
  const { files, errors } = checkMigrations();
  assert.deepEqual(errors, []);
  assert.ok(files.length >= 14);
});

test("checkMigrations rejects new duplicate migration numbers and gaps", () => {
  const dir = mkdtempSync(join(tmpdir(), "tyaga-mig-check-"));
  try {
    writeFileSync(join(dir, "0000_init.sql"), "SELECT 1;");
    writeFileSync(join(dir, "0001_first.sql"), "SELECT 1;");
    writeFileSync(join(dir, "0001_second.sql"), "SELECT 1;");
    writeFileSync(join(dir, "0003_gap.sql"), "SELECT 1;");
    const { errors } = checkMigrations(dir);
    assert.ok(errors.some((e) => e.includes("0001")));
    assert.ok(errors.some((e) => e.includes("Разрыв")));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("all drizzle/ migrations apply cleanly in order with zero foreign key violations", async () => {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  try {
    db.exec("PRAGMA foreign_keys = ON");
    const files = (await readdir("drizzle")).filter((f) => f.endsWith(".sql")).sort();
    for (const file of files) db.exec(await readFile(join("drizzle", file), "utf8"));
    assert.deepEqual(db.exec("PRAGMA foreign_key_check"), []);
  } finally {
    db.close();
  }
});
