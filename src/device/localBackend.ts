// Android build: the Worker API runs inside the app on SQLite (sql.js), so the
// journal works offline with no server. The database file lives in IndexedDB.
import initSqlJs, { type Database, type SqlValue } from "sql.js";
import { LocalD1 } from "./LocalD1";
import wasmUrl from "sql.js/dist/sql-wasm.wasm?url";
import { handleApi, type Env } from "../../server/index";

const migrations = import.meta.glob("../../drizzle/*.sql", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const PERSIST_DEBOUNCE_MS = 250;

const store = <T>(mode: IDBTransactionMode, run: (files: IDBObjectStore) => IDBRequest) =>
  new Promise<T>((resolve, reject) => {
    const open = indexedDB.open("tyaga-device", 1);
    open.onupgradeneeded = () => open.result.createObjectStore("files");
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const transaction = open.result.transaction("files", mode);
      const request = run(transaction.objectStore("files"));
      transaction.oncomplete = () => {
        open.result.close();
        resolve(request.result as T);
      };
      transaction.onerror = () => reject(transaction.error);
    };
  });

const scalar = (db: Database, sql: string, params: SqlValue[] = []) =>
  db.exec(sql, params)[0]?.values[0]?.[0] ?? null;

export async function installLocalBackend() {
  const SQL = await initSqlJs({ locateFile: () => wasmUrl });
  const saved = await store<Uint8Array | undefined>("readonly", (f) => f.get("db"));
  const db = new SQL.Database(saved);
  const pragmas = () => db.exec("PRAGMA foreign_keys = ON");
  pragmas();
  db.exec("CREATE TABLE IF NOT EXISTS device_migrations (name TEXT PRIMARY KEY)");
  db.exec("CREATE TABLE IF NOT EXISTS device_state (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
  for (const [path, sql] of Object.entries(migrations).sort(([a], [b]) => a.localeCompare(b))) {
    const name = path.split("/").pop()!;
    if (scalar(db, "SELECT 1 FROM device_migrations WHERE name = ?", [name])) continue;
    db.exec("BEGIN");
    try {
      db.exec(sql);
      db.run("INSERT INTO device_migrations (name) VALUES (?)", [name]);
      db.exec("COMMIT");
    } catch (error) {
      try { db.exec("ROLLBACK"); } catch { /* already rolled back */ }
      console.error(`Local device migration failed: ${name}`, error);
      throw new Error(`Не удалось обновить локальную базу (${name})`, { cause: error });
    }
  }
  const getState = (key: string) => scalar(db, "SELECT value FROM device_state WHERE key = ?", [key]) as string | null;
  const setState = (key: string, value: string) =>
    db.run("INSERT INTO device_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [key, value]);
  const deleteState = (key: string) =>
    db.run("DELETE FROM device_state WHERE key = ?", [key]);

  let persistTimer: ReturnType<typeof setTimeout> | undefined;
  let dirty = false;
  let writing: Promise<void> = Promise.resolve();
  const persistNow = () => {
    clearTimeout(persistTimer);
    persistTimer = undefined;
    if (!dirty) return writing;
    dirty = false;
    // export() reopens the database, which resets pragmas.
    const bytes = db.export();
    pragmas();
    writing = writing
      .then(() => store("readwrite", (f) => f.put(bytes, "db")))
      .then(() => undefined)
      .catch((e) => {
        dirty = true;
        console.error("Failed to persist device database", e);
      });
    return writing;
  };
  const schedulePersist = () => {
    dirty = true;
    clearTimeout(persistTimer);
    persistTimer = setTimeout(() => { void persistNow(); }, PERSIST_DEBOUNCE_MS);
  };
  dirty = true;
  await persistNow();
  void navigator.storage?.persist?.();
  if (typeof window !== "undefined") {
    window.addEventListener("pagehide", () => { void persistNow(); });
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") void persistNow();
    });
  }

  const env = {
    DB: new LocalD1(db),
    onSessionToken: (token: string) => setState("session", token),
  } as unknown as Env;
  let queue: Promise<unknown> = Promise.resolve();
  // One request at a time: sql.js is synchronous and the export must see a settled file.
  const serve = (request: Request) => {
    const next = queue.then(async () => {
      const headers = new Headers(request.headers); // a standalone Headers may carry Cookie
      headers.set("oai-authenticated-user-id", "device");
      headers.set("Origin", location.origin);
      const token = getState("session");
      if (token) headers.set("Cookie", `__Host-tyaga_session=${token}; tyaga_session=${token}`);
      const body = ["GET", "HEAD"].includes(request.method) ? "" : await request.text();
      const local = { url: request.url, method: request.method, headers, text: async () => body } as unknown as Request;
      const before = scalar(db, "SELECT total_changes()");
      const response = await handleApi(local, env, body || undefined);
      if (scalar(db, "SELECT total_changes()") !== before) {
        schedulePersist();
        window.dispatchEvent(new Event("tyaga:local-change")); // cloud sync listens
      }
      return response;
    });
    queue = next.catch(() => undefined);
    return next;
  };
  const nativeFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    return url.origin === location.origin && url.pathname.startsWith("/api/")
      ? serve(request)
      : nativeFetch(input, init);
  };

  // One profile per phone, created silently: the data never leaves the device.
  const call = async (path: string, body?: unknown) =>
    (await window.fetch(path, body === undefined ? undefined : {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })).json();
  const session = (await call("/api/auth/session")) as { registered: boolean; profile: unknown };
  if (session.profile) {
    // Очищаем устаревший plaintext-пароль от прошлых версий: сессия держится по токену.
    if (getState("credentials")) {
      deleteState("credentials");
      dirty = true;
      await persistNow();
    }
    return;
  }
  const legacyCredentials = JSON.parse(getState("credentials") ?? "null") as { email: string; password: string } | null;
  if (!session.registered) {
    const generated = {
      email: "me@tyaga.app",
      password: [...crypto.getRandomValues(new Uint8Array(24))].map((b) => b.toString(16).padStart(2, "0")).join(""),
    };
    await call("/api/auth/register", {
      ...generated,
      displayName: "Атлет",
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    });
    await persistNow();
  } else if (legacyCredentials) {
    await call("/api/auth/login", legacyCredentials);
    deleteState("credentials");
    dirty = true;
    await persistNow();
  } else {
    // Локальная офлайн-сессия истекла после долгого перерыва: выпускаем новую для единственного профиля устройства.
    const accountId = scalar(db, "SELECT id FROM accounts WHERE platform_id = 'device'") as string | null;
    if (accountId) {
      const hex = (bytes: ArrayBuffer | Uint8Array) =>
        [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
      const sha256 = async (v: string) => hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(v)));
      const token = hex(crypto.getRandomValues(new Uint8Array(32)));
      const tokenHash = await sha256(token);
      const sid = (await sha256(`sid:${tokenHash}`)).slice(0, 16);
      const now = Date.now();
      const ua = (typeof navigator !== "undefined" ? navigator.userAgent : "").slice(0, 200);
      db.run("DELETE FROM sessions WHERE expires_at <= ?", [now]);
      db.run(
        "INSERT INTO sessions (token_hash,id,account_id,user_agent,last_seen_at,expires_at,created_at) VALUES (?,?,?,?,?,?,?)",
        [tokenHash, sid, accountId, ua, now, now + 30 * 86_400_000, now],
      );
      setState("session", token);
      dirty = true;
      await persistNow();
    }
  }
}
