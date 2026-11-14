import type { Workout } from "../lib/types";

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export type PendingItem = {
  workout: Workout;
  queuedAt: string;
  /** Последний отказ сервера (конфликт версий, 4xx): тренировка остаётся в очереди, данные не теряются. */
  error?: string;
};

/**
 * Завершённые тренировки, которые не удалось отправить из-за отсутствия связи (R03-REQ04).
 * Лежат на устройстве, привязаны к аккаунту, переживают перезагрузку и уходят на сервер сами.
 * Повторная отправка безопасна: `PUT /api/workouts` с тем же id и тем же содержимым возвращает уже
 * записанную тренировку (сервер сравнивает содержимое), поэтому дублей нет. Сохраняется ровно то
 * содержимое, которое отправлялось, — без пересчёта длительности.
 */
export class PendingWorkouts {
  constructor(
    private storage: () => Store | null = () => (typeof localStorage === "undefined" ? null : localStorage),
    private accountId: string,
  ) {}

  static key(accountId: string) {
    return `tyaga-pending-workouts:${accountId}`;
  }
  private store() {
    try { return this.storage(); } catch { return null; }
  }

  list(): PendingItem[] {
    try {
      const raw = this.store()?.getItem(PendingWorkouts.key(this.accountId));
      const items = raw ? (JSON.parse(raw) as PendingItem[]) : [];
      return Array.isArray(items) ? items.filter((i) => i && typeof i.workout?.id === "string") : [];
    } catch { return []; }
  }
  private write(items: PendingItem[]) {
    try {
      const store = this.store();
      if (!store) return false;
      if (!items.length) store.removeItem(PendingWorkouts.key(this.accountId));
      else store.setItem(PendingWorkouts.key(this.accountId), JSON.stringify(items));
      return true;
    } catch { return false; }
  }

  /** Ставит тренировку в очередь (та же тренировка заменяется). `false` — хранилище не приняло. */
  add(workout: Workout, now = new Date()) {
    const rest = this.list().filter((i) => i.workout.id !== workout.id);
    return this.write([...rest, { workout, queuedAt: now.toISOString() }]);
  }
  remove(id: string) {
    this.write(this.list().filter((i) => i.workout.id !== id));
  }
  fail(id: string, message: string) {
    this.write(this.list().map((i) => (i.workout.id === id ? { ...i, error: message } : i)));
  }
  clearError(id: string) {
    this.write(this.list().map((i) => (i.workout.id === id ? { workout: i.workout, queuedAt: i.queuedAt } : i)));
  }

  /**
   * Журнал для экрана: тренировка из очереди заменяет серверную с тем же id (правка, ещё не ушедшая),
   * если сервер не успел записать более новую ревизию (потерянный ответ на отправку).
   */
  static merge(stored: Workout[], items: PendingItem[]) {
    if (!items.length) return stored;
    const queued = new Map(items.map((i) => [i.workout.id, i.workout]));
    const kept = stored.filter((w) => {
      const q = queued.get(w.id);
      return !q || (w.revision ?? 0) > (q.revision ?? 0);
    });
    const shown = items.map((i) => i.workout).filter((q) => !kept.some((w) => w.id === q.id));
    return [...shown, ...kept].sort((a, b) => b.date.localeCompare(a.date));
  }

  /**
   * Ошибка «нет связи или сервер недоступен» — тренировку нужно оставить в очереди и повторить.
   * Отказ сервера (4xx) повторять молча нельзя: он останется в очереди с понятной ошибкой.
   */
  static isRetryable(error: unknown) {
    if (!(error instanceof Error) || error.name === "AbortError") return false;
    const status = (error as { status?: unknown }).status;
    return typeof status !== "number" || status >= 500;
  }
  /** Сессия истекла: отправка подождёт нового входа, ошибкой это не считается. */
  static needsSignIn(error: unknown) {
    return (error as { status?: unknown } | null)?.status === 401;
  }
}
