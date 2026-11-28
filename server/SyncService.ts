import { isCalendarDate } from "../src/lib/calendar";
import {
  InputError,
  object,
  str,
  num,
  validCycle,
  validMachine,
  validPeriodization,
  validOccurrenceOverrides,
  validProgramDate,
  validSettings,
} from "./validation";

// Device ↔ cloud replication. Triggers (drizzle/0006_sync.sql) record every
// write in sync_versions; a document's version time travels with it, so the
// newer edit wins on both sides and replaying a change is a no-op.
export type SyncKind = "workout" | "routine" | "custom_exercise" | "settings" | "favorite" | "machine_model" | "machine";
export type SyncDoc = {
  kind: SyncKind;
  id: string;
  versionAt: string;
  deleted: boolean;
  row?: Record<string, string | number>;
};
type Column = [name: string, type: "text" | "int"];
const TABLES: Record<SyncKind, { columns: Column[]; key: string; read: string; upsert: string; remove: string }> = {
  machine_model: {
    columns: [["id", "text"], ["payload", "text"]], key: "id",
    read: "SELECT id,payload FROM machine_models WHERE owner_id=? AND id=?",
    upsert: "INSERT INTO machine_models(owner_id,id,payload) VALUES (?,?,?) ON CONFLICT(owner_id,id) DO NOTHING",
    remove: "DELETE FROM machine_models WHERE owner_id=? AND id=?",
  },
  machine: {
    columns: [["id", "text"], ["model_id", "text"], ["payload", "text"], ["revision", "int"], ["active", "int"], ["updated_at", "text"]], key: "id",
    read: "SELECT id,model_id,payload,revision,active,updated_at FROM machine_instances WHERE owner_id=? AND id=?",
    upsert: "INSERT INTO machine_instances(owner_id,id,model_id,payload,revision,active,updated_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(owner_id,id) DO UPDATE SET model_id=excluded.model_id,payload=excluded.payload,revision=excluded.revision,active=excluded.active,updated_at=excluded.updated_at",
    remove: "DELETE FROM machine_instances WHERE owner_id=? AND id=?",
  },
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
const MAX_DOC_PAYLOAD_CHARS = 100_000;
const SINGLE_PK_OWNER_CHECKS: Partial<Record<SyncKind, string>> = {
  workout: "SELECT owner_id FROM workouts WHERE id = ?",
  routine: "SELECT owner_id FROM routines WHERE id = ?",
  custom_exercise: "SELECT owner_id FROM custom_exercises WHERE id = ?",
};
type VersionRow = { seq: number; kind: SyncKind; doc_id: string; version_at: string; deleted: number };

function canonicalVersionAt(raw: string): string {
  if (!VERSION.test(raw)) throw new InputError("Некорректная версия документа");
  const ms = Date.parse(raw);
  if (!Number.isFinite(ms)) throw new InputError("Некорректная версия документа");
  return new Date(ms).toISOString();
}

function isNewerVersion(incoming: string, current: string | undefined): boolean {
  if (!current) return true;
  const inMs = Date.parse(incoming);
  const curMs = Date.parse(current);
  if (Number.isFinite(inMs) && Number.isFinite(curMs)) return inMs > curMs;
  return incoming > current;
}

export class SyncService {
  constructor(private db: D1Database, private ownerId: string) {}

  /** Documents changed after `since` (a seq cursor), oldest first. */
  async changes(since: number, limit = 200, includeMachines = true) {
    const page = (await this.db
      .prepare("SELECT seq, kind, doc_id, version_at, deleted FROM sync_versions WHERE owner_id = ? AND seq > ? ORDER BY seq LIMIT ?")
      .bind(this.ownerId, since, limit)
      .all<VersionRow>()).results;
    const versions = page.filter((v) => Object.hasOwn(TABLES, v.kind) && (includeMachines || !["machine", "machine_model"].includes(v.kind)));
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
    return { docs, cursor: page.at(-1)?.seq ?? since, more: page.length === limit };
  }

  /** Writes each document that is newer than the local copy; older ones are skipped. */
  async apply(input: unknown) {
    const list = object(input).docs;
    if (!Array.isArray(list) || list.length > 100) throw new InputError("Не больше 100 документов за раз");
    const rawDocs = list.map(parseDoc);
    // Идемпотентная дедупликация внутри одного батча: при повторе одного (kind, id) побеждает самая свежая versionAt.
    const dedup = new Map<string, SyncDoc>();
    for (const d of rawDocs) {
      const k = `${d.kind}:${d.id}`;
      const prev = dedup.get(k);
      if (!prev || isNewerVersion(d.versionAt, prev.versionAt)) dedup.set(k, d);
    }
    const docs = [...dedup.values()];
    const local = docs.length
      ? await this.db.batch(docs.map((d) => this.db
        .prepare("SELECT version_at FROM sync_versions WHERE owner_id = ? AND kind = ? AND doc_id = ?")
        .bind(this.ownerId, d.kind, d.id)))
      : [];
    const currentWorkouts = docs.some((d) => d.kind === "workout")
      ? await this.db.batch(docs.map((d) => d.kind === "workout"
        ? this.db.prepare("SELECT date,payload,revision FROM workouts WHERE owner_id=? AND id=?").bind(this.ownerId, d.id)
        : this.db.prepare("SELECT NULL AS date,NULL AS payload,NULL AS revision WHERE 0")))
      : [];
    const existingOwners = docs.length
      ? await this.db.batch(docs.map((d) => {
          const check = !d.deleted ? SINGLE_PK_OWNER_CHECKS[d.kind] : undefined;
          return check
            ? this.db.prepare(check).bind(d.id)
            : this.db.prepare("SELECT NULL AS owner_id WHERE 0");
        }))
      : [];
    const newer = docs.filter((d, i) => {
      const existingOwner = (existingOwners[i].results[0] as { owner_id: string } | undefined)?.owner_id;
      if (existingOwner && existingOwner !== this.ownerId) return false;
      const current = (local[i].results[0] as { version_at: string } | undefined)?.version_at;
      return isNewerVersion(d.versionAt, current);
    });
    const statements = newer.flatMap((d) => {
      const table = TABLES[d.kind];
      const idx = docs.indexOf(d);
      const prior = d.kind === "workout"
        ? (currentWorkouts[idx].results[0] as { date: string; payload: string; revision: number } | undefined)
        : undefined;
      const localVersion = d.kind === "workout"
        ? (local[idx].results[0] as { version_at: string } | undefined)?.version_at
        : undefined;
      const preserveLocal = !!prior && !!localVersion &&
        (!d.deleted ? isNewerVersion(d.versionAt, localVersion) && String(d.row?.payload) !== prior.payload : isNewerVersion(d.versionAt, localVersion));
      const recovery = preserveLocal ? [this.db.prepare(
        `INSERT INTO workout_sync_recovery(owner_id,workout_id,version_at,date,payload,revision,received_at)
         VALUES(?,?,?,?,?,?,?) ON CONFLICT(owner_id,workout_id,version_at,payload) DO NOTHING`,
      ).bind(this.ownerId, d.id, localVersion!, prior!.date, prior!.payload, prior!.revision, new Date().toISOString())] : [];
      const write = d.deleted
        ? this.db.prepare(table.remove).bind(this.ownerId, d.id)
        : this.db.prepare(table.upsert).bind(this.ownerId, ...table.columns.map(([name]) => d.row![name]));
      return [
        ...recovery,
        write,
        // The trigger stamped "now"; keep the document's own version time instead.
        this.db.prepare("DELETE FROM sync_versions WHERE owner_id = ? AND kind = ? AND doc_id = ?").bind(this.ownerId, d.kind, d.id),
        this.db
          .prepare("INSERT INTO sync_versions (owner_id, kind, doc_id, version_at, deleted) VALUES (?, ?, ?, ?, ?)")
          .bind(this.ownerId, d.kind, d.id, d.versionAt, d.deleted ? 1 : 0),
      ];
    });
    if (statements.length) await this.db.batch(statements);
    return { applied: newer.length, skipped: rawDocs.length - newer.length };
  }

  async recovery() {
    const rows = await this.db.prepare(
      "SELECT workout_id AS id,version_at AS versionAt,date,payload,revision,received_at AS receivedAt FROM workout_sync_recovery WHERE owner_id=? ORDER BY received_at DESC LIMIT 100",
    ).bind(this.ownerId).all<{ id: string; versionAt: string; date: string; payload: string; revision: number; receivedAt: string }>();
    return { records: rows.results.map((r) => ({ ...r, workout: JSON.parse(r.payload) })) };
  }
}

function validateWorkoutSyncPayload(id: string, rowDate: string, payload: Record<string, unknown>) {
  if (!isCalendarDate(rowDate)) throw new InputError("Некорректная дата тренировки");
  if (payload.id !== undefined && str(payload.id, 80, 1) !== id)
    throw new InputError("ID тренировки не совпадает с документом");
  if (payload.date !== undefined) {
    const payloadDate = str(payload.date, 10, 10);
    if (!isCalendarDate(payloadDate))
      throw new InputError("Некорректная дата в данных тренировки");
  }
  str(payload.name, 120, 1);
  if (payload.duration !== undefined) num(payload.duration, 0, 1440);
  if (payload.notes !== undefined) str(payload.notes, 2000);
  if (payload.programDate !== undefined) validProgramDate(payload.programDate);
  if (!Array.isArray(payload.exercises) || !payload.exercises.length || payload.exercises.length > 30)
    throw new InputError("В синхронизируемой тренировке должен быть список упражнений");
  for (const rawEx of payload.exercises) {
    const ex = object(rawEx);
    str(ex.exerciseId, 80, 1);
    if (!Array.isArray(ex.sets) || !ex.sets.length || ex.sets.length > 30)
      throw new InputError("В упражнении тренировки должен быть список подходов");
    for (const rawSet of ex.sets) {
      const s = object(rawSet);
      str(s.id, 80, 1);
      num(s.weight, 0, 1000);
      num(s.reps, 0, 200, true);
      if ((s.done !== undefined && typeof s.done !== "boolean") || (s.warmup !== undefined && typeof s.warmup !== "boolean"))
        throw new InputError("Проверь отметки подхода");
      if (s.rir !== null && s.rir !== undefined) num(s.rir, 0, 10);
    }
  }
}

function validateRoutineSyncPayload(id: string, payload: Record<string, unknown>) {
  if (payload.id !== undefined && str(payload.id, 80, 1) !== id)
    throw new InputError("ID программы не совпадает с документом");
  str(payload.name, 120, 1);
  if (payload.notes !== undefined) str(payload.notes, 2000);
  if (
    !Array.isArray(payload.days) ||
    payload.days.length > 7 ||
    new Set(payload.days).size !== payload.days.length
  )
    throw new InputError("Проверь дни программы");
  for (const d of payload.days) num(d, 0, 6, true);
  num(payload.restSeconds, 15, 600, true);
  if (!["repeat", "double"].includes(String(payload.progression)))
    throw new InputError("Проверь правило прогрессии");
  const repMin = num(payload.repMin, 1, 200, true);
  num(payload.repMax, repMin, 200, true);
  num(payload.incrementKg, 0.25, 50);
  if (!Array.isArray(payload.exercises) || !payload.exercises.length || payload.exercises.length > 30)
    throw new InputError("Некорректный список упражнений программы");
  for (const rawEx of payload.exercises) {
    const ex = object(rawEx);
    str(ex.exerciseId, 80, 1);
    if (!Array.isArray(ex.sets) || !ex.sets.length || ex.sets.length > 30)
      throw new InputError("В упражнении программы должен быть список подходов");
    for (const rawSet of ex.sets) {
      const s = object(rawSet);
      str(s.id, 80, 1);
      num(s.weight, 0, 1000);
      num(s.reps, 0, 200, true);
      if (typeof s.done !== "boolean" || typeof s.warmup !== "boolean")
        throw new InputError("Проверь отметки подхода в программе");
      if (s.rir !== null && s.rir !== undefined) num(s.rir, 0, 10);
    }
  }
  if (payload.cycle !== undefined) validCycle(payload.cycle);
  if (payload.periodization !== undefined) validPeriodization(payload.periodization);
  if (payload.occurrenceOverrides !== undefined) {
    const overrides = validOccurrenceOverrides(payload.occurrenceOverrides);
    if (overrides.length) payload.occurrenceOverrides = overrides;
    else delete payload.occurrenceOverrides;
  }
}

function parseDoc(value: unknown): SyncDoc {
  const v = object(value);
  if (typeof v.kind !== "string" || !Object.hasOwn(TABLES, v.kind)) throw new InputError("Неизвестный тип документа");
  const kind = v.kind as SyncKind;
  const table = TABLES[kind];
  const id = str(v.id, 200, 1);
  const versionAt = canonicalVersionAt(str(v.versionAt, 40, 1));
  if (kind === "settings" && id !== "settings") throw new InputError("Некорректный документ настроек");
  if (kind === "custom_exercise" && !id.startsWith("custom:"))
    throw new InputError("Некорректный ID личного упражнения");
  if (v.deleted === true) return { kind, id, versionAt, deleted: true };
  const source = object(v.row);
  const row: Record<string, string | number> = {};
  for (const [name, type] of table.columns)
    row[name] = type === "int" ? num(source[name], 0, 2147483646, true) : str(source[name], name === "payload" ? MAX_DOC_PAYLOAD_CHARS : 200);
  if (table.key && row[table.key] !== id) throw new InputError("Документ не совпадает с ключом");
  if ("payload" in row) {
    let payload: Record<string, unknown>;
    try { payload = object(JSON.parse(String(row.payload))); }
    catch { throw new InputError("Повреждённые данные документа"); }
    if (kind === "routine") {
      validateRoutineSyncPayload(id, payload);
      row.payload = JSON.stringify(payload);
    }
    if (kind === "workout") {
      validateWorkoutSyncPayload(id, String(row.date), payload);
    }
    if (kind === "settings") {
      validSettings({ ...payload, revision: row.revision });
    }
    if (kind === "machine") {
      if (row.active !== 0 && row.active !== 1) throw new InputError("Некорректный статус тренажёра");
      const machine = validMachine({ ...payload, id, revision: row.revision });
      if (row.model_id !== machine.model.id) throw new InputError("Модель тренажёра не совпадает с документом");
    }
    if (kind === "custom_exercise") {
      if (row.active !== 0 && row.active !== 1) throw new InputError("Некорректный статус упражнения");
      if (payload.id !== undefined && str(payload.id, 80, 1) !== id)
        throw new InputError("ID упражнения не совпадает с документом");
      str(payload.name, 120, 1);
    }
  }
  return { kind, id, versionAt, deleted: false, row };
}
