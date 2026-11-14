import { InputError, object, str } from "./validation";

export async function canonicalHash(value: unknown) {
  const normalize = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(normalize);
    if (item && typeof item === "object")
      return Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, normalize(child)]));
    return item;
  };
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(normalize(value))));
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export type ImportReceipt = {
  owner_id: string;
  workout_id: string;
  run_id: string;
  payload_hash: string;
  payload: string;
  date: string;
  revision: number;
  action: string;
  active: number;
  previous_run_id: string | null;
  previous_payload_hash: string | null;
  previous_payload: string | null;
  previous_date: string | null;
  previous_revision: number | null;
};

/** Receipts are server-side proof, never a client-supplied revision or localStorage ID. */
export class ImportReceiptService {
  constructor(private db: D1Database, private owner: string) {}

  async active(ids: string[]) {
    if (!ids.length) return new Map<string, ImportReceipt>();
    const rows = await this.db.prepare(
      `SELECT * FROM workout_import_receipts WHERE owner_id=? AND active=1 AND workout_id IN (${ids.map(() => "?").join(",")})`,
    ).bind(this.owner, ...ids).all<ImportReceipt>();
    return new Map(rows.results.map((r) => [r.workout_id, r]));
  }

  async runs() {
    const rows = await this.db.prepare(
      `SELECT r.run_id AS runId,r.manifest_hash AS manifestHash,r.created_at AS at,
       r.workout_count AS total,COUNT(c.workout_id) AS activeCount FROM workout_import_runs r
       LEFT JOIN workout_import_receipts c ON c.owner_id=r.owner_id AND c.run_id=r.run_id AND c.active=1
       WHERE r.owner_id=? AND r.state='committed' GROUP BY r.run_id ORDER BY r.created_at DESC LIMIT 30`,
    ).bind(this.owner).all<{ runId: string; manifestHash: string; at: string; total: number; activeCount: number }>();
    const pending = await this.db.prepare(
      `SELECT run_id AS runId,manifest_hash AS manifestHash,created_at AS at,
       workout_count AS total FROM workout_import_runs
       WHERE owner_id=? AND state='staging' ORDER BY created_at DESC LIMIT 30`,
    ).bind(this.owner).all<{ runId: string; manifestHash: string; at: string; total: number }>();
    return { runs: rows.results.filter((r) => r.activeCount > 0), pending: pending.results };
  }

  async undo(value: unknown) {
    const runId = str(object(value).runId, 80, 1);
    const run = await this.db.prepare(
      "SELECT run_id,state FROM workout_import_runs WHERE owner_id=? AND run_id=?",
    ).bind(this.owner, runId).first<{ run_id: string; state: string }>();
    if (!run) throw new InputError("Этот импорт для текущего аккаунта не найден");
    if (run.state === "staging") {
      await this.db.batch([
        this.db.prepare("DELETE FROM workout_import_staging WHERE owner_id=? AND run_id=?").bind(this.owner, runId),
        this.db.prepare("DELETE FROM workout_import_dependencies WHERE owner_id=? AND run_id=?").bind(this.owner, runId),
        this.db.prepare("UPDATE workout_import_runs SET state='undone' WHERE owner_id=? AND run_id=? AND state='staging'").bind(this.owner, runId),
      ]);
      return { removed: 0, restored: 0, kept: 0, runId };
    }
    if (run.state === "undone") return { removed: 0, restored: 0, kept: 0, runId };
    const rows = await this.db.prepare(
      "SELECT * FROM workout_import_receipts WHERE owner_id=? AND run_id=? ORDER BY workout_id",
    ).bind(this.owner, runId).all<ImportReceipt>();
    const statements: D1PreparedStatement[] = [];
    const outcomes: Array<{ kind: "removed" | "restored" | "kept"; start: number }> = [];
    for (const receipt of rows.results) {
      const start = statements.length;
      if (!receipt.active || await canonicalHash(JSON.parse(receipt.payload)) !== receipt.payload_hash) {
        outcomes.push({ kind: "kept", start });
        continue;
      }
      const current = await this.db.prepare(
        "SELECT payload,revision FROM workouts WHERE owner_id=? AND id=?",
      ).bind(this.owner, receipt.workout_id).first<{ payload: string; revision: number }>();
      if (!current || current.revision !== receipt.revision || await canonicalHash(JSON.parse(current.payload)) !== receipt.payload_hash) {
        outcomes.push({ kind: "kept", start });
        continue;
      }
      const stamp = new Date().toISOString() + ":" + crypto.randomUUID();
      if (receipt.action === "added") {
        statements.push(this.db.prepare(
          `DELETE FROM workouts WHERE owner_id=? AND id=? AND revision=? AND payload=?
           AND EXISTS (SELECT 1 FROM workout_import_receipts WHERE owner_id=? AND workout_id=? AND run_id=? AND active=1 AND payload_hash=?)
           AND NOT EXISTS (SELECT 1 FROM workout_kudos WHERE workout_id=?) RETURNING id`,
        ).bind(this.owner, receipt.workout_id, receipt.revision, receipt.payload,
          this.owner, receipt.workout_id, runId, receipt.payload_hash, receipt.workout_id));
        statements.push(this.db.prepare(
          `UPDATE workout_import_receipts SET active=0 WHERE owner_id=? AND workout_id=? AND run_id=?
           AND active=1 AND NOT EXISTS (SELECT 1 FROM workouts WHERE owner_id=? AND id=?)`,
        ).bind(this.owner, receipt.workout_id, runId, this.owner, receipt.workout_id));
        outcomes.push({ kind: "removed", start });
      } else if (receipt.action === "replaced" && receipt.previous_payload && receipt.previous_date && receipt.previous_run_id && receipt.previous_payload_hash && receipt.previous_revision !== null) {
        const nextRevision = receipt.revision + 1;
        statements.push(this.db.prepare(
          `UPDATE workouts SET date=?,payload=?,updated_at=?,revision=?
           WHERE owner_id=? AND id=? AND revision=? AND payload=?
           AND EXISTS (SELECT 1 FROM workout_import_receipts WHERE owner_id=? AND workout_id=? AND run_id=? AND active=1 AND payload_hash=?) RETURNING id`,
        ).bind(receipt.previous_date, receipt.previous_payload, stamp, nextRevision,
          this.owner, receipt.workout_id, receipt.revision, receipt.payload,
          this.owner, receipt.workout_id, runId, receipt.payload_hash));
        statements.push(this.db.prepare(
          `UPDATE workout_import_receipts SET active=0 WHERE owner_id=? AND workout_id=? AND run_id=?
           AND active=1 AND EXISTS (SELECT 1 FROM workouts WHERE owner_id=? AND id=? AND updated_at=? AND revision=?)`,
        ).bind(this.owner, receipt.workout_id, runId, this.owner, receipt.workout_id, stamp, nextRevision));
        statements.push(this.db.prepare(
          `UPDATE workout_import_receipts SET active=1,revision=? WHERE owner_id=? AND workout_id=? AND run_id=?
           AND active=0 AND payload_hash=? AND EXISTS (SELECT 1 FROM workouts WHERE owner_id=? AND id=? AND updated_at=? AND revision=?)`,
        ).bind(nextRevision, this.owner, receipt.workout_id, receipt.previous_run_id, receipt.previous_payload_hash,
          this.owner, receipt.workout_id, stamp, nextRevision));
        outcomes.push({ kind: "restored", start });
      } else outcomes.push({ kind: "kept", start });
    }
    const results = statements.length ? await this.db.batch(statements) : [];
    const allDone = outcomes.every((item) => item.kind === "kept" || !!results[item.start]?.results.length);
    if (allDone) await this.db.prepare(
      "UPDATE workout_import_runs SET state='undone' WHERE owner_id=? AND run_id=? AND state='committed'",
    ).bind(this.owner, runId).run();
    let removed = 0, restored = 0, kept = 0;
    for (const item of outcomes) {
      if (item.kind === "kept") { kept++; continue; }
      if (!results[item.start]?.results.length) kept++;
      else if (item.kind === "removed") removed++;
      else restored++;
    }
    return { removed, restored, kept, runId };
  }
}
