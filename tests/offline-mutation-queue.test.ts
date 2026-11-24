import test from "node:test";
import assert from "node:assert/strict";
import { OfflineMutationQueue } from "../src/lib/offlineMutationQueue";
import { ApiError } from "../src/services/ApiClient";

function memStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
}

test("OfflineMutationQueue coalesces duplicate keys and flushes FIFO on reconnect", async () => {
  const store = memStorage();
  const queue = new OfflineMutationQueue("acc-1", () => store);

  assert.equal(queue.enqueue({ key: "favorite:bench", path: "/api/favorites", method: "PUT", body: { exerciseId: "bench", favorite: true } }), true);
  assert.equal(queue.enqueue({ key: "favorite:bench", path: "/api/favorites", method: "PUT", body: { exerciseId: "bench", favorite: false } }), true);
  assert.equal(queue.enqueue({ key: "settings", path: "/api/settings", method: "PUT", body: { restSeconds: 120 } }), true);
  assert.equal(queue.read().length, 2);
  assert.deepEqual(queue.read()[0].body, { exerciseId: "bench", favorite: false });

  const sent: string[] = [];
  const res = await queue.flush(async (path, method, body) => {
    sent.push(`${method} ${path} ${JSON.stringify(body)}`);
  });
  assert.equal(res.sent, 2);
  assert.equal(res.failed, 0);
  assert.equal(res.remaining, 0);
  assert.equal(res.conflicts, 0);
  assert.equal(res.dropped.length, 0);
  assert.equal(res.storageError, false);
  assert.equal(queue.read().length, 0);
  assert.equal(sent.length, 2);
});

test("OfflineMutationQueue keeps items on network error and drops terminal 4xx (400/401/403/409/422) without looping", async () => {
  const store = memStorage();
  const queue = new OfflineMutationQueue("acc-2", () => store);
  queue.enqueue({ key: "workout-delete:w1", path: "/api/workouts/w1", method: "DELETE", body: { revision: 1 } });
  queue.enqueue({ key: "settings", path: "/api/settings", method: "PUT", body: { restSeconds: -5 } });
  queue.enqueue({ key: "favorite:squat", path: "/api/favorites", method: "PUT", body: { exerciseId: "squat", favorite: true } });

  // First flush fails with network error: everything remains queued.
  const offline = await queue.flush(async () => {
    throw new Error("Failed to fetch");
  });
  assert.equal(offline.sent, 0);
  assert.equal(offline.failed, 0);
  assert.equal(offline.remaining, 3);

  // Second flush: 409 on delete, 400 on settings, 200 on favorite — none stay stuck in queue.
  const synced = await queue.flush(async (path) => {
    if (path.includes("/workouts/w1")) throw new ApiError("Конфликт", 409, {});
    if (path === "/api/settings") throw new ApiError("Неверные настройки", 400, {});
  });
  assert.equal(synced.sent, 1);
  assert.equal(synced.failed, 2);
  assert.equal(synced.conflicts, 1);
  assert.equal(synced.remaining, 0);
  assert.equal(synced.dropped.length, 2);
  assert.equal(queue.read().length, 0);
});

test("OfflineMutationQueue deduplicates concurrent flush() calls and prunes expired items", async () => {
  const store = memStorage();
  const queue = new OfflineMutationQueue("acc-3", () => store);
  // Seed an expired item (40 days old) + one fresh item.
  store.setItem(
    OfflineMutationQueue.key("acc-3"),
    JSON.stringify([
      { key: "old", path: "/api/favorites", method: "PUT", body: {}, queuedAt: new Date(Date.now() - 40 * 86400000).toISOString() },
      { key: "fresh", path: "/api/favorites", method: "PUT", body: { exerciseId: "bench", favorite: true }, queuedAt: new Date().toISOString() },
    ]),
  );
  assert.equal(queue.read().length, 1);
  assert.equal(queue.read()[0].key, "fresh");

  let calls = 0;
  const send = async () => {
    calls++;
    await new Promise((r) => setTimeout(r, 15));
  };
  const [a, b] = await Promise.all([queue.flush(send), queue.flush(send)]);
  assert.equal(calls, 1, "parallel flush calls must share one in-flight run");
  assert.equal(a.sent, 1);
  assert.equal(b.sent, 1);
});
