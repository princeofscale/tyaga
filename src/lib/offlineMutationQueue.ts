import { ApiError } from "../services/ApiClient";

export type OfflineMutation = {
  /** Coalescing key, e.g. `favorite:bench`, `settings`, `workout-delete:<id>`. */
  key: string;
  path: string;
  method: "PUT" | "POST" | "DELETE";
  body: unknown;
  queuedAt: string;
  error?: string;
};

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

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
      return Array.isArray(parsed)
        ? parsed.filter((item): item is OfflineMutation => Boolean(item && typeof item.key === "string" && typeof item.path === "string"))
        : [];
    } catch {
      return [];
    }
  }

  private write(items: OfflineMutation[]): boolean {
    try {
      const s = this.store();
      if (!s) return false;
      const key = OfflineMutationQueue.key(this.accountId);
      if (!items.length) s.removeItem(key);
      else s.setItem(key, JSON.stringify(items));
      return true;
    } catch {
      return false;
    }
  }

  enqueue(mutation: Omit<OfflineMutation, "queuedAt">): boolean {
    const items = this.read().filter((item) => item.key !== mutation.key);
    items.push({ ...mutation, queuedAt: new Date().toISOString() });
    return this.write(items);
  }

  remove(key: string): void {
    const next = this.read().filter((item) => item.key !== key);
    this.write(next);
  }

  async flush(
    send: (path: string, method: "PUT" | "POST" | "DELETE", body: unknown) => Promise<unknown>,
  ): Promise<{ sent: number; failed: number; remaining: number }> {
    const items = this.read();
    if (!items.length) return { sent: 0, failed: 0, remaining: 0 };
    let sent = 0;
    let failed = 0;
    const remaining: OfflineMutation[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      try {
        await send(item.path, item.method, item.body);
        sent++;
      } catch (error) {
        if (OfflineMutationQueue.isRetryable(error)) {
          remaining.push(...items.slice(i));
          break;
        }
        if (error instanceof ApiError && (error.status === 404 || error.status === 409)) {
          // Ресурс уже удалён или устарел: не зацикливаем очередь.
          failed++;
          continue;
        }
        failed++;
        remaining.push({ ...item, error: error instanceof Error ? error.message : "Ошибка отправки" });
      }
    }
    this.write(remaining);
    return { sent, failed, remaining: remaining.length };
  }
}
