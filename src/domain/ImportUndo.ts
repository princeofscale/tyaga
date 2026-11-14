import type { Workout } from "../lib/types";

export type ImportRecord = {
  at: string;
  /** Workouts that the import wrote (added or replaced). */
  ids: string[];
  imported: number;
  replaced: number;
  kept: number;
};
type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/**
 * "Undo import" without a server change: the ids an import wrote are kept on
 * this device, and undoing deletes exactly those — and only the ones still
 * exactly as imported (revision 1). A workout the user edited afterwards, or
 * one that is already gone, is left alone and reported.
 */
export class ImportUndo {
  constructor(
    private store: Store | null,
    private accountId: string,
  ) {}
  private get key() {
    return `tyaga-last-import:${this.accountId}`;
  }
  read(): ImportRecord | null {
    try {
      const value = JSON.parse(this.store?.getItem(this.key) ?? "null");
      if (
        value &&
        typeof value.at === "string" &&
        Array.isArray(value.ids) &&
        value.ids.every((id: unknown) => typeof id === "string") &&
        value.ids.length
      )
        return {
          at: value.at,
          ids: value.ids,
          imported: Number(value.imported) || 0,
          replaced: Number(value.replaced) || 0,
          kept: Number(value.kept) || 0,
        };
    } catch {
      /* unreadable record: nothing to undo */
    }
    return null;
  }
  save(record: ImportRecord) {
    try {
      if (record.ids.length) this.store?.setItem(this.key, JSON.stringify(record));
    } catch {
      /* storage may be unavailable; the import itself is already saved */
    }
  }
  clear() {
    try {
      this.store?.removeItem(this.key);
    } catch {
      /* ignore */
    }
  }
  static plan(record: ImportRecord, workouts: Workout[]) {
    const byId = new Map(workouts.map((w) => [w.id, w]));
    const remove: Array<{ id: string; revision: number }> = [];
    let edited = 0,
      gone = 0;
    for (const id of record.ids) {
      const w = byId.get(id);
      if (!w) gone++;
      else if ((w.revision ?? 0) > 1) edited++;
      else remove.push({ id, revision: w.revision ?? 1 });
    }
    return { remove, edited, gone };
  }
}
