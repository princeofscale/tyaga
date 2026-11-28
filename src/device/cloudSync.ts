// Keeps the phone's offline journal and the Cloudflare account in step:
// local changes go up, cloud changes come down, the newer edit wins.
import { api } from "../services/ApiClient";
import { browserTimeZone } from "../lib/calendar";
import { replicate, type SyncPage } from "../lib/replicate";
import type { AccountProfile } from "../lib/account";

export const CLOUD_URL = (import.meta.env?.VITE_CLOUD_URL ?? "").replace(/\/$/, "");
export type CloudState = {
  accountId?: string;
  email: string;
  token: string;
  localCursor: number;
  cloudCursor: number;
  lastSyncAt?: string;
  error?: string;
};
const KEY = "tyaga-cloud";

export function cloudState(): CloudState | null {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "null");
  } catch {
    return null;
  }
}
function store(state: CloudState | null) {
  try {
    if (state) localStorage.setItem(KEY, JSON.stringify(state));
    else localStorage.removeItem(KEY);
  } catch {
    /* localStorage недоступен */
  }
  if (typeof window !== "undefined") window.dispatchEvent(new Event("tyaga:cloud"));
}

class CloudError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}
async function cloud<T>(path: string, token: string | null, body?: unknown) {
  let response: Response;
  try {
    response = await fetch(CLOUD_URL + path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    throw new CloudError("Нет связи с облаком. Синхронизируем, когда появится интернет.", 0);
  }
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new CloudError(data.error ?? "Облако недоступно", response.status);
  return { data, token: response.headers.get("X-Tyaga-Session") };
}

/** Signs in (or registers) to the cloud and runs the first full sync. */
export async function connectCloud(
  mode: "login" | "register",
  email: string,
  password: string,
  displayName: string,
) {
  const { data, token } = await cloud<{ profile: AccountProfile; recoveryCode?: string }>(
    `/api/auth/${mode}`,
    null,
    { email, password, displayName, timeZone: browserTimeZone() },
  );
  if (!token) throw new Error("Облако не выдало сессию. Попробуй ещё раз.");
  let localAccountId: string | undefined;
  try {
    const me = await api<{ profile: AccountProfile | null }>("/api/auth/session");
    localAccountId = me.profile?.id;
    if (me.profile) {
      // The phone takes the cloud account's name, time zone and body mass.
      await api("/api/auth/profile", "PUT", {
        displayName: data.profile.displayName,
        timeZone: data.profile.timeZone,
        bodyMassKg: data.profile.bodyMassKg,
        revision: me.profile.revision,
      });
      window.dispatchEvent(new Event("tyaga:auth-expired")); // AccountGate re-reads it
    }
  } catch {
    /* Keeping the local name is fine. */
  }
  store({ accountId: localAccountId, email: data.profile.email, token, localCursor: 0, cloudCursor: 0 });
  await syncCloud();
  return data.recoveryCode;
}

export function disconnectCloud() {
  store(null);
}

let running: Promise<void> | null = null;
export const syncCloud = () => (running ??= run().finally(() => (running = null)));

async function run() {
  const start = cloudState();
  if (!CLOUD_URL || !start) return;
  // Проверяем, что локальный аккаунт на устройстве совпадает с владельцем токена облака.
  try {
    const session = await api<{ profile: AccountProfile | null }>("/api/auth/session");
    if (!session.profile) return;
    if (start.accountId && session.profile.id !== start.accountId) {
      disconnectCloud();
      return;
    }
  } catch {
    return;
  }
  let state = start;
  const keep = (patch: Partial<CloudState>) => {
    if (cloudState()?.token !== start.token) throw new Error("Облако отключено");
    state = { ...state, ...patch };
    store(state);
  };
  try {
    await replicate(
      (since) => api<SyncPage>(`/api/sync/changes?since=${since}&capabilities=machines-v1`),
      (docs) => cloud("/api/sync/apply", state.token, { docs }),
      state.localCursor,
      (cursor) => keep({ localCursor: cursor }),
    );
    let changed = 0;
    await replicate(
      async (since) => (await cloud<SyncPage>(`/api/sync/changes?since=${since}&capabilities=machines-v1`, state.token)).data,
      async (docs) => {
        changed += (await api<{ applied: number }>("/api/sync/apply", "POST", { docs })).applied;
      },
      state.cloudCursor,
      (cursor) => keep({ cloudCursor: cursor }),
    );
    keep({ lastSyncAt: new Date().toISOString(), error: undefined });
    if (changed) window.dispatchEvent(new Event("tyaga:synced"));
  } catch (e) {
    if (cloudState()?.token !== start.token) return;
    store({
      ...state,
      error:
        e instanceof CloudError && e.status === 401
          ? "Вход в облако истёк — отключи облако и войди снова."
          : e instanceof Error
            ? e.message
            : "Не удалось синхронизировать",
    });
  }
}

/** Syncs on launch, a few seconds after local edits, on reconnect and on resume. */
export function startCloudSync() {
  if (!CLOUD_URL) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  window.addEventListener("tyaga:local-change", () => {
    clearTimeout(timer);
    timer = setTimeout(() => void syncCloud(), 3000);
  });
  window.addEventListener("online", () => void syncCloud());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void syncCloud();
  });
  void syncCloud();
}
