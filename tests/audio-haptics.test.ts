import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { AudioHapticsEngine } from "../src/lib/audioHaptics";

const key = "tyaga_sound_muted";
const moduleUrl = new URL("../src/lib/audioHaptics.ts", import.meta.url).href;
const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
afterEach(() => {
  if (originalStorage) Object.defineProperty(globalThis, "localStorage", originalStorage);
  else Reflect.deleteProperty(globalThis, "localStorage");
});

function memoryStorage(value?: string) {
  const data = new Map<string, string>(value === undefined ? [] : [[key, value]]);
  const writes: [string, string][] = [];
  const storage: Storage = {
    getItem: (name) => data.get(name) ?? null,
    setItem: (name, next) => { writes.push([name, next]); data.set(name, next); },
    removeItem: (name) => { data.delete(name); },
    clear: () => data.clear(),
    get length() { return data.size; },
    key: (index) => [...data.keys()][index] ?? null,
  };
  Object.defineProperty(globalThis, "localStorage", { configurable: true, writable: true, value: storage });
  return { storage, writes };
}

function assertRamMute(engine: AudioHapticsEngine): void {
  assert.equal(engine.isMuted(), false);
  assert.doesNotThrow(() => engine.setMuted(true));
  assert.equal(engine.isMuted(), true);
  assert.equal(engine.toggleMute(), false);
  assert.equal(engine.isMuted(), false);
  assert.equal(engine.toggleMute(), true);
  assert.equal(engine.isMuted(), true);
}

for (const mode of ["missing", "getter", "read"] as const) {
  test(`audio singleton can be imported with ${mode} storage and retains mute changes in RAM`, async () => {
    let attempts = 0;
    if (mode === "missing") {
      Reflect.deleteProperty(globalThis, "localStorage");
    } else if (mode === "getter") {
      Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        get: () => { attempts++; throw new Error("Storage access denied"); },
      });
    } else {
      const { storage } = memoryStorage();
      storage.getItem = () => { attempts++; throw new Error("Storage read denied"); };
      storage.setItem = () => { throw new Error("Storage write denied"); };
    }
    // A unique ESM URL exercises the eager singleton constructor, not a cached import.
    const fresh = await import(`${moduleUrl}?storage-regression=${mode}`);
    assert.ok(fresh.audioHaptics instanceof fresh.AudioHapticsEngine);
    if (mode !== "missing") assert.ok(attempts > 0, "fresh module must access the blocked storage");
    assertRamMute(fresh.audioHaptics);
  });
}

test("AudioHapticsEngine safely defaults to unmuted without writing a preference", () => {
  const { storage, writes } = memoryStorage();
  assert.equal(new AudioHapticsEngine().isMuted(), false);
  assert.equal(storage.getItem(key), null);
  assert.deepEqual(writes, []);
});

for (const value of ["1", "0", "true"]) {
  test(`AudioHapticsEngine preserves the current stored preference encoding: ${value}`, () => {
    const { storage, writes } = memoryStorage(value);
    assert.equal(new AudioHapticsEngine().isMuted(), value === "1");
    assert.equal(storage.getItem(key), value);
    assert.deepEqual(writes, []);
  });
}

test("AudioHapticsEngine persists mute changes when storage works", () => {
  const { storage, writes } = memoryStorage("1");
  const engine = new AudioHapticsEngine();
  assert.equal(engine.isMuted(), true);
  engine.setMuted(false);
  assert.equal(engine.isMuted(), false);
  assert.equal(storage.getItem(key), "0");
  assert.equal(new AudioHapticsEngine().isMuted(), false);
  assert.equal(engine.toggleMute(), true);
  assert.equal(storage.getItem(key), "1");
  assert.equal(new AudioHapticsEngine().isMuted(), true);
  assert.deepEqual(writes, [[key, "0"], [key, "1"]]);
});

test("AudioHapticsEngine keeps mute state in RAM when setItem throws", () => {
  const { storage } = memoryStorage("1");
  const engine = new AudioHapticsEngine();
  storage.setItem = () => { throw new Error("Storage write denied"); };
  assert.doesNotThrow(() => engine.setMuted(false));
  assert.equal(engine.isMuted(), false);
  assert.equal(engine.toggleMute(), true);
  assert.equal(engine.toggleMute(), false);
  assert.equal(engine.isMuted(), false);
  assert.equal(storage.getItem(key), "1");
});

test("AudioHapticsEngine handles a storage getter becoming blocked after construction", () => {
  memoryStorage("0");
  const engine = new AudioHapticsEngine();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    get: () => { throw new Error("Storage access denied"); },
  });
  assertRamMute(engine);
});

test("AudioHapticsEngine handles a getItem property getter that throws", () => {
  const { storage } = memoryStorage();
  Object.defineProperty(storage, "getItem", { get: () => { throw new Error("Storage method unavailable"); } });
  assertRamMute(new AudioHapticsEngine());
});

test("AudioHapticsEngine handles a setItem property getter that throws", () => {
  const { storage } = memoryStorage();
  const engine = new AudioHapticsEngine();
  Object.defineProperty(storage, "setItem", { get: () => { throw new Error("Storage method unavailable"); } });
  assertRamMute(engine);
});
