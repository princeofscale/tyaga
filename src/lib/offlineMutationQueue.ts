import { ApiError } from "../services/ApiClient";

export type OfflineMutation = {
  /** Уникальный идемпотентный идентификатор операции (UUID) — переживает ретраи на нестабильном интернете. */
  opId: string;
  /** Coalescing key, e.g. `favorite:bench`, `settings`, `workout-delete:<id>`. */
  key: string;
  path: string;
  method: "PUT" | "POST" | "DELETE";
  body: unknown;
  queuedAt: string;
  error?: string;
};

export type SyncHealthState = "saved" | "pending" | "conflict";

export type DroppedMutation = {
  key: string;
  path: string;
  method: "PUT" | "POST" | "DELETE";
  status?: number;
  message: string;
};

export type FlushResult = {
  sent: number;
  failed: number;
  remaining: number;
  conflicts: number;
  dropped: DroppedMutation[];
  storageError: boolean;
};

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const MAX_QUEUE_ITEMS = 100;
const MAX_QUEUE_AGE_MS = 30 * 86400000;

/**
 * Офлайн-очередь коротких изменений (избранное, настройки, удаление тренировки) для web-PWA.
 * Хранится отдельно по аккаунту, свёртывает повторные правки одного ресурса и очищается при выходе.
 */
export class OfflineMutationQueue {
  static key(accountId: string) {
    return `tyaga-offline-mutations:${accountId}`;
  }

  static isRetryable(error: unknown): boolean {
    if (error instanceof ApiError) return error.status >= 500 || error.status === 408 || error.status === 429;
    return !(error instanceof Error && error.name === "AbortError");
  }

  private inflight: Promise<FlushResult> | null = null;

  constructor(
    private accountId: string,
    private storage: () => Store | null = () => (typeof localStorage === "undefined" ? null : localStorage),
  ) {}

  private store() {
    try {
      return this.storage();
    } catch {
      return null;
    }
  }

  read(): OfflineMutation[] {
    try {
      const raw = this.store()?.getItem(OfflineMutationQueue.key(this.accountId));
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      const cutoff = Date.now() - MAX_QUEUE_AGE_MS;
      const valid = parsed
        .filter((item): item is OfflineMutation => {
          if (!item || typeof item.key !== "string" || typeof item.path !== "string") return false;
          const ts = typeof item.queuedAt === "string" ? Date.parse(item.queuedAt) : NaN;
          return !Number.isFinite(ts) || ts >= cutoff;
        })
        .map((item) => ({
          ...item,
          opId: typeof item.opId === "string" && item.opId.trim() ? item.opId : crypto.randomUUID(),
        }));
      return valid.slice(-MAX_QUEUE_ITEMS);
    } catch {
      return [];
    }
  }

  private write(items: OfflineMutation[]): boolean {
    try {
      const s = this.store();
      if (!s) return false;
      const key = OfflineMutationQueue.key(this.accountId);
      const bounded = items.slice(-MAX_QUEUE_ITEMS);
      if (!bounded.length) s.removeItem(key);
      else s.setItem(key, JSON.stringify(bounded));
      return true;
    } catch {
      return false;
    }
  }

  enqueue(mutation: Omit<OfflineMutation, "queuedAt" | "opId"> & { opId?: string }): boolean {
    const items = this.read().filter((item) => item.key !== mutation.key);
    items.push({
      ...mutation,
      opId: mutation.opId?.trim() || crypto.randomUUID(),
      queuedAt: new Date().toISOString(),
    });
    return this.write(items);
  }

  /** Компактный 3-уровневый статус синхронизации для UI: saved / pending / conflict. */
  status(hasConflict = false): SyncHealthState {
    if (hasConflict) return "conflict";
    return this.read().length > 0 ? "pending" : "saved";
  }

  remove(key: string): void {
    const next = this.read().filter((item) => item.key !== key);
    this.write(next);
  }

  async flush(
    send: (path: string, method: "PUT" | "POST" | "DELETE", body: unknown, meta?: { opId: string }) => Promise<unknown>,
  ): Promise<FlushResult> {
    if (this.inflight) return this.inflight;
    const run = this.runFlush(send).finally(() => {
      if (this.inflight === run) this.inflight = null;
    });
    this.inflight = run;
    return run;
  }

  private async runFlush(
    send: (path: string, method: "PUT" | "POST" | "DELETE", body: unknown, meta?: { opId: string }) => Promise<unknown>,
  ): Promise<FlushResult> {
    const items = this.read();
    if (!items.length) {
      return { sent: 0, failed: 0, remaining: 0, conflicts: 0, dropped: [], storageError: false };
    }
    let sent = 0;
    let failed = 0;
    let conflicts = 0;
    const dropped: DroppedMutation[] = [];
    const remaining: OfflineMutation[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      try {
        await send(item.path, item.method, item.body, { opId: item.opId });
        sent++;
      } catch (error) {
        if (OfflineMutationQueue.isRetryable(error)) {
          remaining.push(...items.slice(i));
          break;
        }
        // Любой терминальный 4xx (400/401/403/404/409/422) или AbortError не повторяем бесконечно.
        failed++;
        const status = error instanceof ApiError ? error.status : undefined;
        if (status === 409) conflicts++;
        dropped.push({
          key: item.key,
          path: item.path,
          method: item.method,
          status,
          message: error instanceof Error ? error.message : "Не удалось применить изменение",
        });
      }
    }
    const saved = this.write(remaining);
    return { sent, failed, remaining: remaining.length, conflicts, dropped, storageError: !saved };
  }
}
