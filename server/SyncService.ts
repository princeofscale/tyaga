import { InputError, object, str, num } from "./validation";

// Device ↔ cloud replication. Triggers (drizzle/0006_sync.sql) record every
// write in sync_versions; a document's version time travels with it, so the
// newer edit wins on both sides and replaying a change is a no-op.
export type SyncKind = "workout" | "routine" | "custom_exercise" | "settings" | "favorite";
export type SyncDoc = {
  kind: SyncKind;
  id: string;
  versionAt: string;
  deleted: boolean;
  row?: Record<string, string | number>;
};
type Column = [name: string, type: "text" | "int"];
const TABLES: Record<SyncKind, { columns: Column[]; key: string; read: string; upsert: string; remove: string }> = {
  workout: {
    columns: [["id", "text"], ["date", "text"], ["payload", "text"], ["updated_at", "text"], ["revision", "int"]],
    key: "id",
    read: "SELECT id, date, payload, updated_at, revision FROM workouts WHERE owner_id = ? AND id = ?",
    upsert: "INSERT INTO workouts (owner_id, id, date, payload, updated_at, revision) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET date = excluded.date, payload = excluded.payload, updated_at = excluded.updated_at, revision = excluded.revision WHERE workouts.owner_id = excluded.owner_id",
    remove: "DELETE FROM workouts WHERE owner_id = ? AND id = ?",
  },
  routine: {
    columns: [["id", "text"], ["payload", "text"], ["revision", "int"], ["updated_at", "text"]],
    key: "id",
    read: "SELECT id, payload, revision, updated_at FROM routines WHERE owner_id = ? AND id = ?",
    upsert: "INSERT INTO routines (owner_id, id, payload, revision, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, revision = excluded.revision, updated_at = excluded.updated_at WHERE routines.owner_id = excluded.owner_id",
    remove: "DELETE FROM routines WHERE owner_id = ? AND id = ?",
  },
  custom_exercise: {
    columns: [["id", "text"], ["family_id", "text"], ["payload", "text"], ["active", "int"], ["updated_at", "text"]],
    key: "id",
    read: "SELECT id, family_id, payload, active, updated_at FROM custom_exercises WHERE owner_id = ? AND id = ?",
    upsert: "INSERT INTO custom_exercises (owner_id, id, family_id, payload, active, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET family_id = excluded.family_id, payload = excluded.payload, active = excluded.active, updated_at = excluded.updated_at WHERE custom_exercises.owner_id = excluded.owner_id",
    remove: "DELETE FROM custom_exercises WHERE owner_id = ? AND id = ?",
  },
  settings: {
    columns: [["payload", "text"], ["revision", "int"]],
    key: "",
    read: "SELECT payload, revision FROM settings WHERE owner_id = ? AND ? = 'settings'",
    upsert: "INSERT INTO settings (owner_id, payload, revision) VALUES (?, ?, ?) ON CONFLICT(owner_id) DO UPDATE SET payload = excluded.payload, revision = excluded.revision",
    remove: "DELETE FROM settings WHERE owner_id = ? AND ? = 'settings'",
  },
  favorite: {
    columns: [["exercise_id", "text"]],
    key: "exercise_id",
    read: "SELECT exercise_id FROM favorite_exercises WHERE owner_id = ? AND exercise_id = ?",
    upsert: "INSERT INTO favorite_exercises (owner_id, exercise_id) VALUES (?, ?) ON CONFLICT DO NOTHING",
    remove: "DELETE FROM favorite_exercises WHERE owner_id = ? AND exercise_id = ?",
  },
};
const VERSION = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
type VersionRow = { seq: number; kind: SyncKind; doc_id: string; version_at: string; deleted: number };

export class SyncService {
  constructor(private db: D1Database, private ownerId: string) {}

  /** Documents changed after `since` (a seq cursor), oldest first. */
  async changes(since: number, limit = 200) {
    const versions = (await this.db
      .prepare("SELECT seq, kind, doc_id, version_at, deleted FROM sync_versions WHERE owner_id = ? AND seq > ? ORDER BY seq LIMIT ?")
      .bind(this.ownerId, since, limit)
      .all<VersionRow>()).results.filter((v) => v.kind in TABLES);
    const live = versions.filter((v) => !v.deleted);
    const rows = live.length
      ? await this.db.batch(live.map((v) => this.db.prepare(TABLES[v.kind].read).bind(this.ownerId, v.doc_id)))
      : [];
    const found = new Map(live.map((v, i) => [v.seq, rows[i].results[0] as SyncDoc["row"] | undefined]));
    const docs: SyncDoc[] = versions.map((v) => {
      const row = found.get(v.seq);
      return row
        ? { kind: v.kind, id: v.doc_id, versionAt: v.version_at, deleted: false, row }
        : { kind: v.kind, id: v.doc_id, versionAt: v.version_at, deleted: true };
    });
    return { docs, cursor: versions.at(-1)?.seq ?? since, more: versions.length === limit };
  }

  /** Writes each document that is newer than the local copy; older ones are skipped. */
  async apply(input: unknown) {
    const list = object(input).docs;
    if (!Array.isArray(list) || list.length > 100) throw new InputError("Не больше 100 документов за раз");
    const docs = list.map(parseDoc);
    const local = docs.length
      ? await this.db.batch(docs.map((d) => this.db
        .prepare("SELECT version_at FROM sync_versions WHERE owner_id = ? AND kind = ? AND doc_id = ?")
        .bind(this.ownerId, d.kind, d.id)))
      : [];
    const newer = docs.filter((d, i) => {
      const current = (local[i].results[0] as { version_at: string } | undefined)?.version_at;
      return !current || d.versionAt > current;
    });
    const statements = newer.flatMap((d) => {
      const table = TABLES[d.kind];
      const write = d.deleted
        ? this.db.prepare(table.remove).bind(this.ownerId, d.id)
        : this.db.prepare(table.upsert).bind(this.ownerId, ...table.columns.map(([name]) => d.row![name]));
      return [
        write,
        // The trigger stamped "now"; keep the document's own version time instead.
        this.db.prepare("DELETE FROM sync_versions WHERE owner_id = ? AND kind = ? AND doc_id = ?").bind(this.ownerId, d.kind, d.id),
        this.db
          .prepare("INSERT INTO sync_versions (owner_id, kind, doc_id, version_at, deleted) VALUES (?, ?, ?, ?, ?)")
          .bind(this.ownerId, d.kind, d.id, d.versionAt, d.deleted ? 1 : 0),
      ];
    });
    if (statements.length) await this.db.batch(statements);
    return { applied: newer.length, skipped: docs.length - newer.length };
  }
}

function parseDoc(value: unknown): SyncDoc {
  const v = object(value);
  if (typeof v.kind !== "string" || !(v.kind in TABLES)) throw new InputError("Неизвестный тип документа");
  const kind = v.kind as SyncKind;
  const table = TABLES[kind];
  const id = str(v.id, 200, 1);
  const versionAt = str(v.versionAt, 40, 1);
  if (!VERSION.test(versionAt)) throw new InputError("Некорректная версия документа");
  if (kind === "settings" && id !== "settings") throw new InputError("Некорректный документ настроек");
  if (v.deleted === true) return { kind, id, versionAt, deleted: true };
  const source = object(v.row);
  const row: Record<string, string | number> = {};
  for (const [name, type] of table.columns)
    row[name] = type === "int" ? num(source[name], 0, 2147483646, true) : str(source[name], 400000);
  if (table.key && row[table.key] !== id) throw new InputError("Документ не совпадает с ключом");
  if ("payload" in row) {
    try { object(JSON.parse(String(row.payload))); }
    catch { throw new InputError("Повреждённые данные документа"); }
  }
  return { kind, id, versionAt, deleted: false, row };
}
