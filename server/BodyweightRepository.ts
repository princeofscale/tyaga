import {
  BodyweightDocument,
  type WeightDocument,
} from "../src/domain/BodyweightDocument";
import { localDate } from "../src/lib/calendar";
import { AuthError } from "./AccountService";
import { InputError, object, str, num } from "./validation";
type Row = {
  doc_key: string;
  payload: string;
  revision: number;
  mutation_id: string;
  updated_at: string;
  deleted: number;
};
const fromRow = (r: Row): WeightDocument => ({
  key: r.doc_key,
  value: r.deleted ? null : JSON.parse(r.payload),
  revision: r.revision,
  mutationId: r.mutation_id,
  updatedAt: r.updated_at,
});

/** Per-day compare-and-swap documents retain tombstones and mutation IDs for safe retries. */
export class BodyweightRepository {
  constructor(
    private db: D1Database,
    private owner: string,
    private timeZone: string,
    private accountId: string,
  ) {}
  async read() {
    const rows = await this.db
      .prepare(
        "SELECT * FROM bodyweight_documents WHERE owner_id = ? ORDER BY doc_key",
      )
      .bind(this.owner)
      .all<Row>();
    return { documents: rows.results.map(fromRow) };
  }
  async save(key: string, input: unknown) {
    const v = object(input);
    if (v.accountId !== this.accountId)
      throw new AuthError("Аккаунт изменился. Открой журнал веса заново.", 401);
    let value;
    try {
      value = BodyweightDocument.value(key, v.value);
    } catch (e) {
      throw new InputError((e as Error).message);
    }
    if (
      key !== "goal" &&
      value !== null &&
      key.slice(7) > localDate(new Date(), this.timeZone)
    )
      throw new InputError("Дата взвешивания не может быть в будущем");
    const revision = num(v.revision, 0, 2147483645, true),
      mutationId = str(v.mutationId, 100, 1),
      payload = JSON.stringify(value ?? {}),
      deleted = value === null ? 1 : 0;
    const current = await this.db
      .prepare(
        "SELECT * FROM bodyweight_documents WHERE owner_id = ? AND doc_key = ?",
      )
      .bind(this.owner, key)
      .first<Row>();
    if (
      current?.mutation_id === mutationId &&
      current.payload === payload &&
      current.deleted === deleted
    )
      return { saved: fromRow(current) };
    const saved = await this.db
      .prepare(
        `INSERT INTO bodyweight_documents (owner_id,doc_key,payload,revision,mutation_id,updated_at,deleted)
      SELECT ?,?,?,?,?,?,? WHERE ?=0 OR EXISTS(SELECT 1 FROM bodyweight_documents WHERE owner_id=? AND doc_key=? AND revision=?)
      ON CONFLICT(owner_id,doc_key) DO UPDATE SET payload=excluded.payload,revision=excluded.revision,mutation_id=excluded.mutation_id,updated_at=excluded.updated_at,deleted=excluded.deleted
      WHERE bodyweight_documents.revision=excluded.revision-1 RETURNING *`,
      )
      .bind(
        this.owner,
        key,
        payload,
        revision + 1,
        mutationId,
        new Date().toISOString(),
        deleted,
        revision,
        this.owner,
        key,
        revision,
      )
      .first<Row>();
    if (saved) return { saved: fromRow(saved) };
    const latest = await this.db
      .prepare(
        "SELECT * FROM bodyweight_documents WHERE owner_id=? AND doc_key=?",
      )
      .bind(this.owner, key)
      .first<Row>();
    return { current: latest ? fromRow(latest) : null };
  }
}
