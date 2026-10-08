import type { Database, SqlValue } from "sql.js";

const toSql = (value: unknown): SqlValue => {
  // D1 rejects undefined too; failing loudly keeps the two backends identical.
  if (value === undefined) throw new TypeError("D1_TYPE_ERROR: undefined");
  if (typeof value === "boolean") return value ? 1 : 0;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  return value as SqlValue;
};

/** The slice of D1's statement API the server uses: bind/all/first/run. */
class Statement {
  constructor(
    private db: Database,
    private sql: string,
    private params: unknown[] = [],
  ) {}
  bind(...params: unknown[]) {
    return new Statement(this.db, this.sql, params);
  }
  rows() {
    const statement = this.db.prepare(this.sql);
    try {
      statement.bind(this.params.map(toSql));
      const rows: Record<string, SqlValue>[] = [];
      while (statement.step()) rows.push(statement.getAsObject());
      return rows;
    } finally {
      statement.free();
    }
  }
  async all() {
    return { results: this.rows(), success: true, meta: {} };
  }
  async first(column?: string) {
    const row = this.rows()[0];
    return row ? (column ? row[column] : row) : null;
  }
  async run() {
    this.rows();
    return { results: [], success: true, meta: { changes: this.db.getRowsModified() } };
  }
}

/** D1Database on top of an sql.js database; batch() is atomic like D1's. */
export class LocalD1 {
  constructor(private db: Database) {}
  prepare(sql: string) {
    return new Statement(this.db, sql);
  }
  async batch(statements: Statement[]) {
    this.db.exec("BEGIN");
    try {
      const results = statements.map((s) => ({ results: s.rows(), success: true, meta: {} }));
      this.db.exec("COMMIT");
      return results;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
}
