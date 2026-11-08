import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { BodyweightTracker, type BodyweightEntry } from "../src/domain/BodyweightTracker";

const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
afterEach(() => {
  if (originalStorage) Object.defineProperty(globalThis, "localStorage", originalStorage);
  else Reflect.deleteProperty(globalThis, "localStorage");
});

function installStorage(storage: Storage): void {
  Object.defineProperty(globalThis, "localStorage", { configurable: true, writable: true, value: storage });
}

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  const writes: [string, string][] = [];
  const storage: Storage = {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => { writes.push([key, value]); data.set(key, value); },
    removeItem: (key) => { data.delete(key); },
    clear: () => data.clear(),
    get length() { return data.size; },
    key: (index) => [...data.keys()][index] ?? null,
  };
  installStorage(storage);
  return { storage, writes };
}

const entriesKey = "tyaga-bodyweight:user-123";
const goalKey = "tyaga-bodyweight-goal:user-123";
const realEntries: BodyweightEntry[] = [
  { id: "bw-real-2", date: "2026-11-08", weightKg: 79.5, note: "Утренний замер", createdAt: 1794106800000 },
  { id: "bw-1", date: "2026-11-01", weightKg: 80, createdAt: 1793502000000 },
];
const emptyGoal = { targetWeightKg: null, startWeightKg: null };

function assertEmpty(tracker: BodyweightTracker): void {
  assert.deepEqual(tracker.getEntries(), []);
  assert.deepEqual(tracker.getTrend(), []);
  assert.equal(tracker.getStats(), null);
  assert.deepEqual(tracker.getWeeklyRate(), { rateKgPerWeek: 0, direction: "maintenance", label: "Мало данных" });
}

test("BodyweightTracker starts empty without writing invented measurements or goals", () => {
  const { storage, writes } = memoryStorage();
  const tracker = new BodyweightTracker("user-123");
  assertEmpty(tracker);
  assert.deepEqual(tracker.getGoal(), emptyGoal);
  assert.equal(storage.length, 0);
  assert.deepEqual(writes, []);
});

test("BodyweightTracker tolerates a missing localStorage global", () => {
  Reflect.deleteProperty(globalThis, "localStorage");
  const tracker = new BodyweightTracker("user-123");
  assertEmpty(tracker);
  assert.deepEqual(tracker.getGoal(), emptyGoal);
  assert.doesNotThrow(() => tracker.saveEntries(realEntries));
  assert.doesNotThrow(() => tracker.setGoal(75));
});

test("BodyweightTracker tolerates a blocked localStorage getter", () => {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    get: () => { throw new Error("Storage access denied"); },
  });
  const tracker = new BodyweightTracker("user-123");
  assertEmpty(tracker);
  assert.deepEqual(tracker.getGoal(), emptyGoal);
  assert.doesNotThrow(() => tracker.saveEntries(realEntries));
  assert.doesNotThrow(() => tracker.setGoal(75));
});

test("BodyweightTracker tolerates blocked reads without writing fallback data", () => {
  const { storage, writes } = memoryStorage();
  storage.getItem = () => { throw new Error("Storage read denied"); };
  const tracker = new BodyweightTracker("user-123");
  assertEmpty(tracker);
  assert.deepEqual(tracker.getGoal(), emptyGoal);
  assert.deepEqual(writes, []);
});

for (const raw of [
  "not json", "null", "{}", "42", "[null]", "[{}]",
  JSON.stringify([{ ...realEntries[0], weightKg: "79.5" }]),
  JSON.stringify([{ ...realEntries[0], date: "2026-02-30" }]),
  JSON.stringify([{ ...realEntries[0], createdAt: null }]),
]) {
  test(`BodyweightTracker returns empty for malformed entries without replacing stored bytes: ${raw}`, () => {
    const { storage, writes } = memoryStorage({ [entriesKey]: raw });
    assertEmpty(new BodyweightTracker("user-123"));
    assert.equal(storage.getItem(entriesKey), raw);
    assert.deepEqual(writes, []);
  });
}

test("BodyweightTracker retains a deliberately saved empty history", () => {
  const { storage, writes } = memoryStorage({ [entriesKey]: "[ ]" });
  assertEmpty(new BodyweightTracker("user-123"));
  assert.equal(storage.getItem(entriesKey), "[ ]");
  assert.deepEqual(writes, []);
});

test("BodyweightTracker preserves real entries, IDs and notes and only sorts the returned history", () => {
  const raw = JSON.stringify(realEntries, null, 2);
  const { storage, writes } = memoryStorage({ [entriesKey]: raw });
  const tracker = new BodyweightTracker("user-123");
  assert.deepEqual(tracker.getEntries(), [realEntries[1], realEntries[0]]);
  assert.equal(tracker.getStats()?.count, 2);
  assert.equal(tracker.getStats()?.currentKg, 79.5);
  assert.equal(tracker.getTrend().length, 2);
  assert.equal(storage.getItem(entriesKey), raw);
  assert.deepEqual(writes, []);
});

for (const goal of [
  emptyGoal,
  { targetWeightKg: 75, startWeightKg: null },
  { targetWeightKg: 75, startWeightKg: 80 },
  { targetWeightKg: null, startWeightKg: 80 },
]) {
  test(`BodyweightTracker preserves a saved goal without rewriting it: ${JSON.stringify(goal)}`, () => {
    const raw = JSON.stringify(goal, null, 2);
    const { storage, writes } = memoryStorage({ [goalKey]: raw });
    assert.deepEqual(new BodyweightTracker("user-123").getGoal(), goal);
    assert.equal(storage.getItem(goalKey), raw);
    assert.deepEqual(writes, []);
  });
}

for (const raw of [
  "not json", "null", "[]", "{}", "75",
  '{"targetWeightKg":"75","startWeightKg":80}',
  '{"targetWeightKg":75}',
  '{"targetWeightKg":1e400,"startWeightKg":80}',
]) {
  test(`BodyweightTracker uses an empty goal for malformed storage without replacing it: ${raw}`, () => {
    const { storage, writes } = memoryStorage({ [goalKey]: raw });
    assert.deepEqual(new BodyweightTracker("user-123").getGoal(), emptyGoal);
    assert.equal(storage.getItem(goalKey), raw);
    assert.deepEqual(writes, []);
  });
}

test("BodyweightTracker adds only requested entries, updates the same day and recalculates stats", () => {
  const { writes } = memoryStorage();
  const tracker = new BodyweightTracker("user-123");
  const added = tracker.addEntry(80.5, "2026-11-08", "  Утренний замер  ");
  assert.equal(added.weightKg, 80.5);
  assert.equal(added.date, "2026-11-08");
  assert.equal(added.note, "Утренний замер");
  assert.deepEqual(tracker.getStats(), {
    currentKg: 80.5, startKg: 80.5, minKg: 80.5, maxKg: 80.5,
    averageKg: 80.5, totalChangeKg: 0, count: 1,
  });
  assert.equal(tracker.getTrend()[0].emaKg, 80.5);
  assert.equal(writes.length, 1);
  const updated = tracker.addEntry(80.2, "2026-11-08", "Повторный замер");
  assert.equal(updated.id, added.id);
  assert.equal(tracker.getEntries().length, 1);
  assert.equal(tracker.getStats()?.currentKg, 80.2);
  tracker.removeEntry(added.id);
  assertEmpty(tracker);
});

test("BodyweightTracker sets a goal on empty history without creating sample weights", () => {
  const { storage, writes } = memoryStorage();
  const tracker = new BodyweightTracker("user-123");
  tracker.setGoal(75);
  assert.deepEqual(tracker.getGoal(), { targetWeightKg: 75, startWeightKg: null });
  assertEmpty(tracker);
  assert.equal(storage.getItem(entriesKey), null);
  assert.equal(writes.length, 1);
  assert.equal(writes[0][0], goalKey);
});

test("BodyweightTracker calculates goals and weekly rate from actual saved measurements", () => {
  memoryStorage({ [entriesKey]: JSON.stringify(realEntries) });
  const tracker = new BodyweightTracker("user-123");
  tracker.setGoal(75);
  assert.deepEqual(tracker.getGoal(), { targetWeightKg: 75, startWeightKg: 79.5 });
  assert.deepEqual(tracker.getWeeklyRate(), { rateKgPerWeek: -0.5, direction: "loss", label: "-0.5 кг/нед (снижение)" });
});

test("BodyweightTracker keeps account storage isolated without seeding a new account", () => {
  const raw = JSON.stringify(realEntries);
  const { storage, writes } = memoryStorage({ [entriesKey]: raw });
  assertEmpty(new BodyweightTracker("another-account"));
  assert.equal(storage.getItem(entriesKey), raw);
  assert.deepEqual(writes, []);
});

test("BodyweightTracker tolerates blocked writes and leaves existing measurements and goals intact", () => {
  const raw = JSON.stringify(realEntries);
  const goalRaw = JSON.stringify({ targetWeightKg: 75, startWeightKg: 80 });
  const { storage } = memoryStorage({ [entriesKey]: raw, [goalKey]: goalRaw });
  storage.setItem = () => { throw new Error("Storage write denied"); };
  const tracker = new BodyweightTracker("user-123");
  assert.doesNotThrow(() => tracker.addEntry(79, "2026-11-09"));
  assert.doesNotThrow(() => tracker.removeEntry(realEntries[0].id));
  assert.doesNotThrow(() => tracker.setGoal(72));
  assert.equal(storage.getItem(entriesKey), raw);
  assert.equal(storage.getItem(goalKey), goalRaw);
  assert.deepEqual(tracker.getEntries(), [realEntries[1], realEntries[0]]);
});
