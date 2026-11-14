import test from "node:test";
import assert from "node:assert/strict";
import { ImportUndo, type ImportRecord } from "../src/domain/ImportUndo";
import type { Workout } from "../src/lib/types";

const memory = () => {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
};
const w = (id: string, revision: number) => ({ id, revision }) as Workout;
const record: ImportRecord = { at: "2026-11-14T10:00:00Z", ids: ["a", "b", "c", "d"], imported: 4, replaced: 1, kept: 0 };

test("ImportUndo keeps the last import per account and survives a reload", () => {
  const store = memory();
  new ImportUndo(store, "u1").save(record);
  assert.deepEqual(new ImportUndo(store, "u1").read(), record);
  assert.equal(new ImportUndo(store, "u2").read(), null, "another account sees nothing");
  new ImportUndo(store, "u1").clear();
  assert.equal(new ImportUndo(store, "u1").read(), null);
});

test("ImportUndo ignores corrupt records and works without storage", () => {
  const store = memory();
  store.setItem("tyaga-last-import:u1", "{not json");
  assert.equal(new ImportUndo(store, "u1").read(), null);
  store.setItem("tyaga-last-import:u1", JSON.stringify({ at: 1, ids: "x" }));
  assert.equal(new ImportUndo(store, "u1").read(), null);
  const none = new ImportUndo(null, "u1");
  none.save(record);
  assert.equal(none.read(), null);
});

test("ImportUndo removes only workouts still exactly as imported", () => {
  const plan = ImportUndo.plan(record, [w("a", 1), w("b", 2), w("c", 1), w("other", 1)]);
  assert.deepEqual(plan.remove, [
    { id: "a", revision: 1 },
    { id: "c", revision: 1 },
  ]);
  assert.equal(plan.edited, 1, "b was edited after the import");
  assert.equal(plan.gone, 1, "d was already deleted");
});
