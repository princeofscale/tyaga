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
    db.exec(sql);
    db.run("INSERT INTO device_migrations (name) VALUES (?)", [name]);
    db.exec("COMMIT");
  }
  const getState = (key: string) => scalar(db, "SELECT value FROM device_state WHERE key = ?", [key]) as string | null;
  const setState = (key: string, value: string) =>
    db.run("INSERT INTO device_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [key, value]);
  const persist = async () => {
    // export() reopens the database, which resets pragmas.
    const bytes = db.export();
    pragmas();
    await store("readwrite", (f) => f.put(bytes, "db"));
  };
  await persist();
  void navigator.storage?.persist?.();

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
      const response = await handleApi(local, env);
      if (scalar(db, "SELECT total_changes()") !== before) {
        await persist();
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
  if (session.profile) return;
  let credentials = JSON.parse(getState("credentials") ?? "null");
  if (!session.registered || !credentials) {
    if (session.registered) return; // Unknown password: AccountGate shows the normal sign-in.
    credentials = {
      email: "me@tyaga.app",
      password: [...crypto.getRandomValues(new Uint8Array(24))].map((b) => b.toString(16).padStart(2, "0")).join(""),
    };
    setState("credentials", JSON.stringify(credentials));
    await call("/api/auth/register", {
      ...credentials,
      displayName: "Атлет",
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    });
  } else await call("/api/auth/login", credentials);
}
