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
  assert.deepEqual(res, { sent: 2, failed: 0, remaining: 0 });
  assert.equal(queue.read().length, 0);
  assert.equal(sent.length, 2);
});

test("OfflineMutationQueue keeps items on network error and drops stale 409 conflicts without blocking later items", async () => {
  const store = memStorage();
  const queue = new OfflineMutationQueue("acc-2", () => store);
  queue.enqueue({ key: "workout-delete:w1", path: "/api/workouts/w1", method: "DELETE", body: { revision: 1 } });
  queue.enqueue({ key: "favorite:squat", path: "/api/favorites", method: "PUT", body: { exerciseId: "squat", favorite: true } });

  // First flush fails with network error: everything remains queued.
  const offline = await queue.flush(async () => {
    throw new Error("Failed to fetch");
  });
  assert.deepEqual(offline, { sent: 0, failed: 0, remaining: 2 });

  // Second flush gets 409 on w1 delete, then succeeds on squat favorite.
  const synced = await queue.flush(async (path) => {
    if (path.includes("/workouts/w1")) throw new ApiError("Конфликт", 409, {});
  });
  assert.deepEqual(synced, { sent: 1, failed: 1, remaining: 0 });
  assert.equal(queue.read().length, 0);
});
