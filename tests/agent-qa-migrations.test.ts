import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync, mkdirSync, mkdtempSync, writeFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomUUID } from "node:crypto";
import initSqlJs from "sql.js";
const root = realpathSync(fileURLToPath(new URL("../", import.meta.url)));
const artifact = join(root, "artifacts/agent-evolution/qa/setup");
mkdirSync(artifact, { recursive: true });
const run = mkdtempSync(join(artifact, "migration-"));
const logDir = join(run, "wrangler-logs"); mkdirSync(logDir);
const files = readdirSync(join(root, "drizzle")).filter(f => f.endsWith(".sql")).sort();
const publishedFiles = files.filter((f) => f !== "0011_import_receipts.sql");
assert.equal(publishedFiles.length, 12);
assert.equal(files.length, 13);
const journal = JSON.parse(readFileSync(join(root, "drizzle/meta/_journal.json"), "utf8"));
const pinned = {
  "sql": [
    {
      "file": "0000_romantic_medusa.sql",
      "ref": "b766eec0588a5bd688742dac26b45411d85e82e3",
      "sha256": "34925e2f6eaadd3d48e5dabf8a1b3531f7efdebeb15b7729a6d04b1d9cc31715"
    },
    {
      "file": "0001_misty_ghost_rider.sql",
      "ref": "b766eec0588a5bd688742dac26b45411d85e82e3",
      "sha256": "6637a4fd0055e1b7c6306fa59435f8189fd8238ba873aa6873a44f3fc9615538"
    },
    {
      "file": "0002_left_ma_gnuci.sql",
      "ref": "b766eec0588a5bd688742dac26b45411d85e82e3",
      "sha256": "98f531d23e7575ff8e9d136086ebb5f025d50c7307a4752af0f0642feed25dfa"
    },
    {
      "file": "0003_jazzy_zarda.sql",
      "ref": "b766eec0588a5bd688742dac26b45411d85e82e3",
      "sha256": "4e0df8f75b2edcaeb48b6e4045e7c7d89ea6d630233fb58b6e1f56569408f308"
    },
    {
      "file": "0004_fat_oracle.sql",
      "ref": "b766eec0588a5bd688742dac26b45411d85e82e3",
      "sha256": "47ce371c7cd81f61a08e7bcf42a3bb7e2f8ac8c6622bcfae0f6fc8512309a50f"
    },
    {
      "file": "0005_young_jazinda.sql",
      "ref": "b766eec0588a5bd688742dac26b45411d85e82e3",
      "sha256": "5c723a68fefea0ac2b2470bcaf01d470fa571c80412bd05440dae48c7b6347d5"
    },
    {
      "file": "0006_sync.sql",
      "ref": "b766eec0588a5bd688742dac26b45411d85e82e3",
      "sha256": "31d6f4b6748bf3068a110f85d32277d6ac5c163cba890830ab387c78a881ea8b"
    },
    {
      "file": "0007_wise_rhodey.sql",
      "ref": "b766eec0588a5bd688742dac26b45411d85e82e3",
      "sha256": "463a4beda1b0279630a2470e4bc05eda66b1c28dec550d1932ae33d26a6bc851"
    },
    {
      "file": "0008_flaky_microbe.sql",
      "ref": "b766eec0588a5bd688742dac26b45411d85e82e3",
      "sha256": "cfa352cf0cb8732735486f4e695044a4c2bee830dbfc60a25b05246ad695bd56"
    },
    {
      "file": "0009_noisy_iron_lad.sql",
      "ref": "b766eec0588a5bd688742dac26b45411d85e82e3",
      "sha256": "f1c69bce6d482610eadf28edad7a35cad0fc212d742c2c513af9b325d77029f6"
    },
    {
      "file": "0010_live_rooms.sql",
      "ref": "c708843daa05f68a5bc5417fcb1de7bafed8a369",
      "sha256": "09938ab09d9bb0d81750fad6c3c6115d16eb1faedeb7970ff3ef069eadfc9a3d"
    },
    {
      "file": "0010_machines.sql",
      "ref": "b766eec0588a5bd688742dac26b45411d85e82e3",
      "sha256": "91f6eb0effb0e109e05702fbeffbf07341d1363ccf47a5132fb196ee66f77eb9"
    }
  ],
  "journals": {
    "rooms": {
      "version": "7",
      "dialect": "sqlite",
      "entries": [
        {
          "idx": 0,
          "version": "6",
          "when": 1791312645633,
          "tag": "0000_romantic_medusa",
          "breakpoints": true
        },
        {
          "idx": 1,
          "version": "6",
          "when": 1791343912284,
          "tag": "0001_misty_ghost_rider",
          "breakpoints": true
        },
        {
          "idx": 2,
          "version": "6",
          "when": 1791349904705,
          "tag": "0002_left_ma_gnuci",
          "breakpoints": true
        },
        {
          "idx": 3,
          "version": "6",
          "when": 1791350056725,
          "tag": "0003_jazzy_zarda",
          "breakpoints": true
        },
        {
          "idx": 4,
          "version": "6",
          "when": 1791361791580,
          "tag": "0004_fat_oracle",
          "breakpoints": true
        },
        {
          "idx": 5,
          "version": "6",
          "when": 1791373834977,
          "tag": "0005_young_jazinda",
          "breakpoints": true
        },
        {
          "idx": 6,
          "version": "6",
          "when": 1791373834978,
          "tag": "0006_sync",
          "breakpoints": true
        },
        {
          "idx": 7,
          "version": "6",
          "when": 1794326047519,
          "tag": "0007_wise_rhodey",
          "breakpoints": true
        },
        {
          "idx": 8,
          "version": "6",
          "when": 1794384907315,
          "tag": "0008_flaky_microbe",
          "breakpoints": true
        },
        {
          "idx": 9,
          "version": "6",
          "when": 1794399174183,
          "tag": "0009_noisy_iron_lad",
          "breakpoints": true
        },
        {
          "idx": 10,
          "version": "6",
          "when": 1794424045113,
          "tag": "0010_live_rooms",
          "breakpoints": true
        }
      ]
    },
    "machines": {
      "version": "7",
      "dialect": "sqlite",
      "entries": [
        {
          "idx": 0,
          "version": "6",
          "when": 1791312645633,
          "tag": "0000_romantic_medusa",
          "breakpoints": true
        },
        {
          "idx": 1,
          "version": "6",
          "when": 1791343912284,
          "tag": "0001_misty_ghost_rider",
          "breakpoints": true
        },
        {
          "idx": 2,
          "version": "6",
          "when": 1791349904705,
          "tag": "0002_left_ma_gnuci",
          "breakpoints": true
        },
        {
          "idx": 3,
          "version": "6",
          "when": 1791350056725,
          "tag": "0003_jazzy_zarda",
          "breakpoints": true
        },
        {
          "idx": 4,
          "version": "6",
          "when": 1791361791580,
          "tag": "0004_fat_oracle",
          "breakpoints": true
        },
        {
          "idx": 5,
          "version": "6",
          "when": 1791373834977,
          "tag": "0005_young_jazinda",
          "breakpoints": true
        },
        {
          "idx": 6,
          "version": "6",
          "when": 1791373834978,
          "tag": "0006_sync",
          "breakpoints": true
        },
        {
          "idx": 7,
          "version": "6",
          "when": 1794326047519,
          "tag": "0007_wise_rhodey",
          "breakpoints": true
        },
        {
          "idx": 8,
          "version": "6",
          "when": 1794384907315,
          "tag": "0008_flaky_microbe",
          "breakpoints": true
        },
        {
          "idx": 9,
          "version": "6",
          "when": 1794399174183,
          "tag": "0009_noisy_iron_lad",
          "breakpoints": true
        },
        {
          "idx": 10,
          "version": "6",
          "when": 1794468210926,
          "tag": "0010_machines",
          "breakpoints": true
        }
      ]
    }
  },
  "snapshots": {
    "rooms": {
      "ref": "c708843daa05f68a5bc5417fcb1de7bafed8a369",
      "path": "drizzle/meta/0010_snapshot.json",
      "sha256": "bd31820cd90d2e78203a4c136451742113f4ba4405686104420971fe297c0367",
      "id": "e4b94493-3e00-4b0c-a6f2-34c3a46ed0ca",
      "prevId": "00b73f44-a273-437c-9f06-39162f02a0c7"
    },
    "machines": {
      "ref": "b766eec0588a5bd688742dac26b45411d85e82e3",
      "path": "drizzle/provenance/0010_machines_snapshot.original.json",
      "sha256": "a4e6aa9adaa1cf0446c0cc14bb97da72d96c74a7aad636affc70b838320a84b8",
      "id": "e829fac1-a32e-4fb4-9757-428ec8ba8768",
      "prevId": "00b73f44-a273-437c-9f06-39162f02a0c7"
    }
  }
};
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
assert.deepEqual(files, [...pinned.sql.map(entry => entry.file), "0011_import_receipts.sql"]);
const publishedSql = new Map(pinned.sql.map(entry => { const sql = readFileSync(join(root, "drizzle", entry.file), "utf8"); assert.equal(sha(sql), entry.sha256, `published SQL changed: ${entry.file}`); return [entry.file, sql]; }));
const publishedDir = join(run, "published-migrations"); mkdirSync(publishedDir);
for (const [file, sql] of publishedSql) writeFileSync(join(publishedDir, file), sql, { flag: "wx" });
writeFileSync(join(publishedDir, "0011_import_receipts.sql"), readFileSync(join(root, "drizzle/0011_import_receipts.sql"), "utf8"), { flag: "wx" });
const originalSchemaSql = readFileSync(join(root, "drizzle/0011_import_receipts.sql"), "utf8");
const versions = {
  node: process.version,
  wrangler: JSON.parse(readFileSync(join(root, "node_modules/wrangler/package.json"), "utf8")).version,
  sqlJs: JSON.parse(readFileSync(join(root, "node_modules/sql.js/package.json"), "utf8")).version,
};
const report: { run: string; versions: typeof versions; provenance: unknown[]; cases: unknown[] } = { run, versions, provenance: [], cases: [] };
let command = 0;
function cli(label: string, args: string[], expectedSuccess = true) {
  assert.ok(args.includes("--local")); assert.ok(!args.includes("--remote"));
  const full = [join(root, "node_modules/wrangler/bin/wrangler.js"), ...args];
  const r = spawnSync(process.execPath, full, { cwd: root, encoding: "utf8", timeout: 120000, maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, CI: "true", NO_COLOR: "1", WRANGLER_SEND_METRICS: "false", WRANGLER_LOG_PATH: logDir } });
  const stem = `${String(++command).padStart(3, "0")}-${label}`;
  writeFileSync(join(run, stem + ".log"), `${process.execPath} ${full.join(" ")}\n${r.stdout}${r.stderr}\n[exit code: ${r.status}]\n`);
  console.log(`${stem}: [exit code: ${r.status}]${expectedSuccess ? "" : " (expected constraint rejection)"}`);
  assert.ifError(r.error);
  if (expectedSuccess) assert.equal(r.status, 0, `${stem}: ${r.stdout}${r.stderr}`);
  else assert.notEqual(r.status, 0, `${stem}: constraint was NOT enforced`);
  return r;
}
const SQL = await initSqlJs();
const reference = new SQL.Database(); reference.exec("PRAGMA foreign_keys=ON");
for (const sql of publishedSql.values()) reference.exec(sql);
const ddlQuery = "SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name NOT IN ('d1_migrations','__drizzle_migrations') ORDER BY type,name";
const schema = reference.exec(ddlQuery)[0].values.map(row => ({ type: String(row[0]), name: String(row[1]), tbl_name: String(row[2]), sql: String(row[3]).replace(/\s+/g, " ").trim() }));
writeFileSync(join(run, "published-sql-ddl-oracle.json"), JSON.stringify(schema, null, 2) + "\n");
const migratedSchema = new SQL.Database(); migratedSchema.exec("PRAGMA foreign_keys=ON");
for (const sql of publishedSql.values()) migratedSchema.exec(sql);
migratedSchema.exec(originalSchemaSql);
const newDdl = migratedSchema.exec(ddlQuery)[0].values.map(row => ({ type: String(row[0]), name: String(row[1]), tbl_name: String(row[2]), sql: String(row[3]).replace(/\s+/g, " ").trim() }));
migratedSchema.close();
const additiveNames = new Set(newDdl.filter((entry) => !schema.some((old) => old.name === entry.name)).map((entry) => entry.name));
const expectedSchema = [...schema, ...newDdl.filter((entry) => additiveNames.has(entry.name))]
  .sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name));

const save = () => writeFileSync(join(run, "results.json"), JSON.stringify(report, null, 2) + "\n");

test("BL-MIG immutable published SQL hashes + historical journal + additive 0011 DDL", () => {
  assert.equal(publishedFiles.length, 12, "the pinned historical set remains twelve files");
  assert.equal(files.at(-1), "0011_import_receipts.sql", "new schema is additive and separately tracked");
  assert.deepEqual(newDdl.filter((entry) => !schema.some((old) => old.name === entry.name)).map((entry) => entry.name).sort(), [
    "idx_import_receipts_run", "idx_workout_import_receipt_active", "idx_workout_sync_recovery_owner",
    "workout_import_dependencies", "workout_import_finalize", "workout_import_finalize_requests",
    "workout_import_receipts", "workout_import_runs", "workout_import_staging", "workout_sync_recovery",
  ]);
  for (const entry of pinned.sql) { assert.equal(sha(publishedSql.get(entry.file)!), entry.sha256); report.provenance.push({ ...entry }); }
  assert.deepEqual(journal.entries.map((e: { idx: number }) => e.idx), Array.from({ length: 12 }, (_, i) => i), "journal retains historical lineage; 0011 is filename-only like prior SQL-only 0010 imports");
  const oldRooms = pinned.journals.rooms;
  const oldMachines = pinned.journals.machines;
  for (const prior of [...oldRooms.entries, ...oldMachines.entries]) {
    const now = journal.entries.find((e: { tag: string }) => e.tag === prior.tag);
    assert.ok(now); assert.equal(now.when, prior.when); assert.equal(now.version, prior.version); assert.equal(now.breakpoints, prior.breakpoints);
  }
  const roomsRaw = readFileSync(join(root, pinned.snapshots.rooms.path), "utf8"), machinesRaw = readFileSync(join(root, pinned.snapshots.machines.path), "utf8");
  assert.equal(sha(roomsRaw), pinned.snapshots.rooms.sha256); assert.equal(sha(machinesRaw), pinned.snapshots.machines.sha256);
  const rooms = JSON.parse(roomsRaw), machines = JSON.parse(machinesRaw);
  assert.equal(rooms.id, pinned.snapshots.rooms.id); assert.equal(rooms.prevId, pinned.snapshots.rooms.prevId);
  assert.equal(machines.id, pinned.snapshots.machines.id); assert.equal(machines.prevId, pinned.snapshots.machines.prevId);
  const combined = JSON.parse(readFileSync(join(root, "drizzle/meta/0011_snapshot.json"), "utf8"));
  assert.equal(combined.prevId, rooms.id); assert.notEqual(combined.id, rooms.id); assert.notEqual(combined.id, machines.id);
  assert.deepEqual(JSON.parse(readFileSync(join(root, "drizzle/meta/0010_snapshot.json"), "utf8")), rooms);
  const union = { ...rooms.tables, ...machines.tables };
  for (const name of Object.keys(rooms.tables)) if (machines.tables[name]) assert.deepEqual(rooms.tables[name], machines.tables[name], `divergent common table ${name}`);
  assert.deepEqual(combined.tables, union);
  const sqlTables = schema.filter(r => r.type === "table").map(r => r.name).sort();
  assert.equal(rooms.tables.sync_versions, undefined, "rooms historical snapshot must retain known SQL-only delta");
  assert.equal(machines.tables.sync_versions, undefined, "machines historical snapshot must retain known SQL-only delta");
  assert.deepEqual(sqlTables.filter(name => !Object.hasOwn(combined.tables, name)), ["sync_versions"], "ONLY published historical sync_versions may be SQL-only; no other missing table");
  assert.deepEqual(Object.keys(combined.tables).sort(), sqlTables.filter(name => name !== "sync_versions"));
  save();
});
for (const scenario of ["fresh", "0009-only", "rooms-only", "machines-only", "combined-replay"]) {
  test(`BL-MIG actual Wrangler filename ledger, fullDDL/sentinels/6effects/owners/replay: ${scenario}`, () => {
    const dir = join(run, scenario); mkdirSync(dir);
    const seed = join(dir, "seed-migrations"); mkdirSync(seed);
    const commonFiles = publishedFiles.filter(f => !f.startsWith("0010_"));
    const seedFiles = scenario === "fresh" ? [] : scenario === "0009-only" ? commonFiles : scenario === "rooms-only" ? [...commonFiles, "0010_live_rooms.sql"] : scenario === "machines-only" ? [...commonFiles, "0010_machines.sql"] : publishedFiles;
    for (const file of seedFiles) writeFileSync(join(seed, file), publishedSql.get(file)!, { flag: "wx" });
    const state = join(dir, "d1-state"), id = randomUUID();
    const config = (name: string, migrations: string) => {
      const target = join(dir, name);
      writeFileSync(target, JSON.stringify({ name: "tyaga-independent-qa-migrations", compatibility_date: "2025-09-27", d1_databases: [{ binding: "DB", database_name: "tyaga-independent-qa-migrations", database_id: id, migrations_dir: migrations }] }, null, 2) + "\n");
      return target;
    };
    const initialConfig = config("seed.json", seed), fullConfig = config("full.json", publishedDir);
    const args = ["--local", "--persist-to", state, "--config", fullConfig];
    const query = (label: string, sql: string) => {
      const result = cli(`${scenario}-${label}`, ["d1", "execute", "DB", ...args, "--command", sql, "--json"]);
      const responses = JSON.parse(result.stdout); assert.ok(Array.isArray(responses));
      for (const response of responses) assert.equal(response.success, true);
      return responses.flatMap((r: { results: Record<string, unknown>[] }) => r.results);
    };
    const owner = scenario + "-owner", account = scenario + "-account";
    const common = `INSERT INTO accounts(id,platform_id,email,display_name,password_hash,salt,recovery_hash,time_zone,body_mass_kg,revision,created_at) VALUES('${account}','${owner}','${scenario}@example.test','QA ${scenario}','qa-only','qa-only','qa-only','Europe/Amsterdam',69.7,11,'2026-10-25T23:30:00Z'); INSERT INTO workouts(id,owner_id,date,payload,updated_at,revision) VALUES('${scenario}-workout','${owner}','2026-10-26','{"sentinel":"${scenario}","nested":{"set":"legacy"}}','2026-10-25T23:30:00Z',7); INSERT INTO settings(owner_id,payload,revision) VALUES('${owner}','{"sentinel":"${scenario}","timeZone":"Europe/Amsterdam"}',3);`;
    const room = `INSERT INTO live_members(code,account_id,state,joined_at,updated_at) VALUES('QA8796','${account}','{"phase":"idle","sentinel":"${scenario}"}','2026-10-25T23:30:00Z','2026-10-25T23:30:00Z');`;
    const machine = `INSERT INTO machine_models(owner_id,id,payload) VALUES('${owner}','sentinel-model','{"sentinel":"${scenario}-model"}'); INSERT INTO machine_instances(owner_id,id,model_id,payload,revision,active,updated_at) VALUES('${owner}','sentinel-machine','sentinel-model','{"sentinel":"${scenario}-archived"}',13,0,'2026-10-25T23:30:00Z');`;
    const hasRoom = seedFiles.includes("0010_live_rooms.sql"), hasMachine = seedFiles.includes("0010_machines.sql");
    const sentinelSql = () => `SELECT 'account' AS document,* FROM accounts WHERE id='${account}'; SELECT 'workout' AS document,* FROM workouts WHERE id='${scenario}-workout'; SELECT 'settings' AS document,* FROM settings WHERE owner_id='${owner}'; ${hasRoom || scenario === "fresh" ? `SELECT 'room' AS document,* FROM live_members WHERE account_id='${account}';` : ""} ${hasMachine || scenario === "fresh" ? `SELECT 'model' AS document,* FROM machine_models WHERE owner_id='${owner}'; SELECT 'machine' AS document,* FROM machine_instances WHERE owner_id='${owner}';` : ""}`;
    let before: Record<string, unknown>[] = [];
    if (seedFiles.length) {
      cli(`${scenario}-initial-filename-migrations`, ["d1", "migrations", "apply", "DB", "--local", "--persist-to", state, "--config", initialConfig]);
      query("seed-distinct-sentinels", common + (hasRoom ? room : "") + (hasMachine ? machine : ""));
      before = query("prior-sentinels", sentinelSql()); assert.ok(before.length >= 3);
    }
    cli(`${scenario}-upgrade`, ["d1", "migrations", "apply", "DB", ...args]);
    assert.deepEqual(query("filename-ledger", "SELECT name FROM d1_migrations ORDER BY name").map(r => r.name), files);
    const actualSchema = query("full-DDL", ddlQuery).map((r): Record<string, unknown> & { sql: string } => ({ ...r, sql: String(r.sql).replace(/\s+/g, " ").trim() }));
    assert.deepEqual(actualSchema.filter(r => r.name === "_cf_METADATA"), [{ type: "table", name: "_cf_METADATA", tbl_name: "_cf_METADATA", sql: "CREATE TABLE _cf_METADATA ( key INTEGER PRIMARY KEY, value BLOB )" }], `${scenario}: unexpected D1 internal metadata DDL`);
    assert.deepEqual(actualSchema.filter(r => r.name !== "_cf_METADATA"), expectedSchema, `${scenario}: published DDL plus only additive 0011 objects`);
    assert.deepEqual(query("FK-check", "PRAGMA foreign_key_check"), []);
    if (scenario === "fresh") {
      query("fresh-sentinels-for-replay", common + room + machine);
      before = query("fresh-sentinels", sentinelSql());
    } else if (hasRoom && hasMachine) {
      assert.deepEqual(query("preserved-sentinels", sentinelSql()), before);
    } else {
      const preserved = query("preserved-sentinels", sentinelSql());
      assert.deepEqual(preserved.filter((row) => ["account", "workout", "settings"].includes(String(row.document))),
        before.filter((row) => ["account", "workout", "settings"].includes(String(row.document))));
      before = preserved;
    }

    const A = `${scenario}-trigger-a`, B = `${scenario}-trigger-b`;
    const select = (phase: string, kind: string) => `SELECT '${phase}' AS phase,owner_id,kind,doc_id,seq,version_at,deleted FROM sync_versions WHERE owner_id IN ('${A}','${B}') AND kind='${kind}' ORDER BY owner_id;`;
    const smoke = `INSERT INTO machine_models(owner_id,id,payload) VALUES('${B}','same-model','{"owner":"B"}'); INSERT INTO machine_models(owner_id,id,payload) VALUES('${A}','same-model','{"owner":"A"}'); ${select("model-insert","machine_model")} UPDATE machine_models SET payload='{"updated":"A"}' WHERE owner_id='${A}' AND id='same-model'; ${select("model-update","machine_model")} DELETE FROM machine_models WHERE owner_id='${A}' AND id='same-model'; ${select("model-delete","machine_model")} INSERT INTO machine_instances(owner_id,id,model_id,payload,revision,active,updated_at) VALUES('${B}','same-machine','same-model','{"owner":"B"}',1,1,'2026-11-09T12:00:00Z'); INSERT INTO machine_instances(owner_id,id,model_id,payload,revision,active,updated_at) VALUES('${A}','same-machine','same-model','{"owner":"A"}',1,1,'2026-11-09T12:00:00Z'); ${select("instance-insert","machine")} UPDATE machine_instances SET revision=2,payload='{"updated":"A"}' WHERE owner_id='${A}' AND id='same-machine'; ${select("instance-update","machine")} DELETE FROM machine_instances WHERE owner_id='${A}' AND id='same-machine'; ${select("instance-delete","machine")}`;
    const observations = query("six-individual-effects-and-two-owners", smoke).filter(r => r.phase);
    const phases = ["model-insert", "model-update", "model-delete", "instance-insert", "instance-update", "instance-delete"];
    assert.equal(observations.length, 12);
    for (let i = 0; i < phases.length; i++) {
      const phase = phases[i], rows = observations.filter(r => r.phase === phase);
      assert.equal(rows.length, 2);
      const a = rows.find(r => r.owner_id === A)!, b = rows.find(r => r.owner_id === B)!;
      assert.equal(a.deleted, phase.endsWith("delete") ? 1 : 0); assert.equal(b.deleted, 0);
      assert.ok(Number(a.seq) > 0); assert.match(String(a.version_at), /^\d{4}-\d{2}-\d{2}T.*Z$/);
      if (i % 3) {
        const previous = observations.find(r => r.phase === phases[i - 1] && r.owner_id === A)!;
        const firstB = observations.find(r => r.phase === phases[i - i % 3] && r.owner_id === B)!;
        assert.ok(Number(a.seq) > Number(previous.seq), `${phase}: no new event`);
        assert.equal(b.seq, firstB.seq, `${phase}: another owner changed`);
      }
    }
    assert.deepEqual(query("other-owner-payload", `SELECT payload FROM machine_models WHERE owner_id='${B}'; SELECT payload,revision FROM machine_instances WHERE owner_id='${B}';`), [{ payload: '{"owner":"B"}' }, { payload: '{"owner":"B"}', revision: 1 }]);
    const constraintSnapshotSql = "SELECT 'model' AS constraint_document,* FROM machine_models ORDER BY owner_id,id; SELECT 'machine' AS constraint_document,* FROM machine_instances ORDER BY owner_id,id; SELECT 'member' AS constraint_document,* FROM live_members ORDER BY code,account_id; SELECT 'event' AS constraint_document,* FROM sync_versions ORDER BY seq";
    const constraintBefore = query("before-declared-constraint-rejections", constraintSnapshotSql);
    const constraints = [
      { label: "duplicate-model-owner-pk", sql: `INSERT INTO machine_models(owner_id,id,payload) VALUES('${B}','same-model','{"should":"reject"}')`, message: /UNIQUE constraint failed: machine_models\.owner_id, machine_models\.id/ },
      { label: "duplicate-instance-owner-pk", sql: `INSERT INTO machine_instances(owner_id,id,model_id,payload,revision,active,updated_at) VALUES('${B}','same-machine','same-model','{"should":"reject"}',1,1,'2026-11-09T12:00:00Z')`, message: /UNIQUE constraint failed: machine_instances\.owner_id, machine_instances\.id/ },
      { label: "live-member-account-fk", sql: `INSERT INTO live_members(code,account_id,state,joined_at,updated_at) VALUES('QAFKX','${account}-missing','{}','2026-11-09T12:00:00Z','2026-11-09T12:00:00Z')`, message: /FOREIGN KEY constraint failed/ },
    ];
    for (const probe of constraints) { const rejected = cli(`${scenario}-${probe.label}`, ["d1", "execute", "DB", ...args, "--command", probe.sql, "--json"], false); assert.match(`${rejected.stdout}${rejected.stderr}`, probe.message); }
    assert.deepEqual(query("after-declared-constraint-rejections", constraintSnapshotSql), constraintBefore, "constraint rejection changed rows or emitted sync event");
    const eventsBefore = query("events-before-replay", "SELECT * FROM sync_versions ORDER BY seq");
    const replay = cli(`${scenario}-replay`, ["d1", "migrations", "apply", "DB", ...args]); assert.match(replay.stdout, /No migrations to apply/);
    assert.deepEqual(query("events-after-replay", "SELECT * FROM sync_versions ORDER BY seq"), eventsBefore);
    assert.deepEqual(query("sentinels-after-replay", sentinelSql()), before);
    assert.deepEqual(query("FK-after-trigger-replay", "PRAGMA foreign_key_check"), []);
    report.cases.push({ scenario, status: "PASS", seedFiles, databaseId: id, state, fullDDL: actualSchema.length, sentinelRows: before.length, sixEffects: observations, constraintRejections: 3, constraintFailureNoMutation: true, replayNoExtraEvents: true }); save();
  });
}
