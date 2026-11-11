import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { BodyweightJournal } from "../src/services/BodyweightJournal";
import { ApiError, type ApiClient } from "../src/services/ApiClient";
import {
  BodyweightDocument,
  type WeightDocument,
} from "../src/domain/BodyweightDocument";
const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
afterEach(() => {
  if (original) Object.defineProperty(globalThis, "localStorage", original);
  else Reflect.deleteProperty(globalThis, "localStorage");
});
function memory(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  const storage: Storage = {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
    removeItem: (key) => {
      data.delete(key);
    },
    clear: () => data.clear(),
    key: (i) => [...data.keys()][i] ?? null,
    get length() {
      return data.size;
    },
  };
  return storage;
}
function use(storage: Storage) {
  Object.defineProperty(globalThis, "localStorage", {
    value: storage,
    configurable: true,
  });
}
function backend() {
  const docs = new Map<string, WeightDocument>();
  let offline = false,
    lost = false,
    owner = "user",
    writes = 0;
  const client: Pick<ApiClient, "request"> = {
    async request<T>(path: string, method = "GET", body?: unknown): Promise<T> {
      if (offline) throw Error("offline");
      if (method === "GET")
        return { documents: [...docs.values()], accountId: owner } as T;
      const key = decodeURIComponent(path.split("/").at(-1)!);
      const input = body as {
        accountId: string;
        value: unknown;
        revision: number;
        mutationId: string;
      };
      assert.equal(input.accountId, owner);
      const current = docs.get(key);
      if (current?.mutationId === input.mutationId)
        return { document: current } as T;
      if ((current?.revision ?? 0) !== input.revision)
        throw new ApiError("conflict", 409, {
          document: current ?? null,
        } as never);
      const document: WeightDocument = {
        key,
        value: BodyweightDocument.value(key, input.value),
        revision: input.revision + 1,
        mutationId: input.mutationId,
        updatedAt: new Date().toISOString(),
      };
      docs.set(key, document);
      writes++;
      if (lost) {
        lost = false;
        throw Error("lost response");
      }
      return { document } as T;
    },
  };
  return {
    client,
    docs,
    get writes() {
      return writes;
    },
    offline: (v: boolean) => {
      offline = v;
    },
    lost: () => {
      lost = true;
    },
    owner: (v: string) => {
      owner = v;
    },
  };
}

test("legacy records migrate once with IDs/notes intact; original keys remain a backup", async () => {
  const entry = {
    id: "legacy-id",
    date: "2026-11-01",
    weightKg: 61.5,
    note: "before breakfast",
    createdAt: 1,
  };
  const storage = memory({
    "tyaga-bodyweight:user": JSON.stringify([entry]),
    "tyaga-bodyweight-goal:user": JSON.stringify({
      targetWeightKg: 70,
      startWeightKg: 61.5,
    }),
  });
  use(storage);
  const server = backend(),
    journal = new BodyweightJournal("user", "UTC", server.client);
  assert.equal(journal.pendingCount, 2);
  await journal.sync();
  assert.equal(journal.error, "");
  assert.equal(journal.pendingCount, 0);
  assert.equal(server.docs.get("weight:2026-11-01")?.value?.id, "legacy-id");
  assert.equal(
    storage.getItem("tyaga-bodyweight:user"),
    JSON.stringify([entry]),
  );
  await new BodyweightJournal("user", "UTC", server.client).sync();
  assert.equal(server.writes, 2);
});

test("offline edits survive reload and a lost acknowledgement is replay-safe", async () => {
  const storage = memory();
  use(storage);
  const server = backend();
  server.offline(true);
  const first = new BodyweightJournal("user", "UTC", server.client);
  first.tracker.addEntry(61.5, "2026-11-01", "note");
  await first.sync();
  assert.equal(first.pendingCount, 1);
  assert.match(first.error, /offline/);
  const restored = new BodyweightJournal("user", "UTC", server.client);
  assert.equal(restored.tracker.getEntries()[0].weightKg, 61.5);
  server.offline(false);
  server.lost();
  await restored.sync();
  assert.equal(restored.pendingCount, 1);
  assert.equal(server.writes, 1);
  await restored.sync();
  assert.equal(restored.pendingCount, 0);
  assert.equal(server.writes, 1);
});

test("two devices show a conflict and require an explicit choice before replacing the other version", async () => {
  const a = memory(),
    b = memory(),
    server = backend();
  use(a);
  const first = new BodyweightJournal("user", "UTC", server.client);
  await first.sync();
  use(b);
  const second = new BodyweightJournal("user", "UTC", server.client);
  await second.sync();
  second.tracker.addEntry(62, "2026-11-01");
  use(a);
  first.tracker.addEntry(61, "2026-11-01");
  await first.sync();
  use(b);
  await second.sync();
  assert.equal(second.conflicts.length, 1);
  assert.equal(second.tracker.getEntries()[0].weightKg, 62);
  assert.equal(server.writes, 1);
  second.resolve("weight:2026-11-01", true);
  await second.sync();
  assert.equal(second.pendingCount, 0);
  assert.equal(server.writes, 2);
  use(a);
  await first.sync();
  assert.equal(first.tracker.getEntries()[0].weightKg, 62);
});

test("quota and changed sessions cannot lose queued data or upload it to another account", async () => {
  const storage = memory();
  use(storage);
  const server = backend(),
    journal = new BodyweightJournal("user", "UTC", server.client);
  storage.setItem = () => {
    throw Error("quota");
  };
  assert.throws(() => journal.tracker.addEntry(61, "2026-11-01"), /сохранить/);
  assert.equal(journal.tracker.getEntries().length, 0);
  use(memory());
  const next = new BodyweightJournal("user", "UTC", server.client);
  next.tracker.addEntry(61, "2026-11-01");
  server.owner("another-user");
  await next.sync();
  assert.match(next.error, /Аккаунт изменился/);
  assert.equal(server.writes, 0);
  assert.equal(next.pendingCount, 1);
});

test("native cloud bindings never seed a second account from the first account's phone backup", () => {
  use(
    memory({
      "tyaga-bodyweight:user": JSON.stringify([
        { id: "private", date: "2026-11-01", weightKg: 61, createdAt: 1 },
      ]),
      "tyaga-bodyweight-bound:user": "first@example.test",
    }),
  );
  const journal = new BodyweightJournal(
    "user",
    "UTC",
    backend().client,
    "second@example.test",
  );
  assert.equal(journal.tracker.getEntries().length, 0);
  assert.equal(journal.pendingCount, 0);
});
