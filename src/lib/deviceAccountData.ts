type Store = Pick<Storage, "getItem" | "setItem" | "removeItem" | "key" | "length">;

/**
 * Всё личное, что приложение держит в браузере (localStorage) и локальной базе устройства (IndexedDB):
 * черновик тренировки, кэш журнала веса, сведения о последнем импорте, ключи операций импорта,
 * офлайн-копия профиля и данных, а также `tyaga-cloud` (токен облачной синхронизации).
 * Настройки оформления и звука (`tyaga_theme_accent`, `tyaga_sound_muted`) личными не считаются и остаются.
 * Cache Storage личного не содержит: туда попадают только файлы оболочки приложения (service worker).
 */
export class DeviceAccountData {
  /** Ключи, у которых после префикса стоит id аккаунта. */
  private static readonly perAccount = [
    "tyaga-draft-account:", "tyaga-bodyweight-sync:", "tyaga-bodyweight-bound:", "tyaga-bodyweight-goal:",
    "tyaga-bodyweight:", "tyaga-last-import:", "tyaga-offline:data:", "tyaga-offline-mutations:", "tyaga-pending-workouts:", "tyaga-deload:", "tyaga-live-finished:",
    "tyaga-nutrition-v5:", "tyaga-avoid-exercises:", "tyaga-joint-pain-logs-v3:", "tyaga-biomechanics-profile-v1:",
  ];
  private static readonly legacyUnscoped = [
    "tyaga-joint-pain-logs-v3",
    "tyaga-biomechanics-profile-v1",
  ];

  constructor(private storage: () => Store | null = () => (typeof localStorage === "undefined" ? null : localStorage)) {}

  private keys(): string[] {
    try {
      const store = this.storage();
      if (!store) return [];
      return Array.from({ length: store.length }, (_, i) => store.key(i)).filter((k): k is string => !!k);
    } catch { return []; }
  }
  private remove(keys: string[]) {
    try { const store = this.storage(); for (const key of keys) store?.removeItem(key); } catch { /* хранилище недоступно */ }
    return keys;
  }

  /** Выход из аккаунта: стирает всё личное в localStorage (включая tyaga-cloud) и базу IndexedDB tyaga-device. */
  wipe() {
    const removed = this.remove(this.keys().filter((k) => k.startsWith("tyaga-")));
    try {
      if (typeof indexedDB !== "undefined" && typeof indexedDB.deleteDatabase === "function") {
        indexedDB.deleteDatabase("tyaga-device");
      }
    } catch {
      /* IndexedDB недоступна в приватном режиме или тестовом окружении */
    }
    return removed;
  }

  /**
   * Сессия истекла: стираются копии, которые сервер отдаст заново (офлайн-копия, кэш журнала веса,
   * сведения об импорте). Начатая тренировка и очередь отправки остаются: это ещё не сохранённая работа,
   * её стирает только выход из аккаунта (с предупреждением) или вход под другим аккаунтом.
   */
  wipeCaches() {
    const caches = ["tyaga-offline:", "tyaga-bodyweight", "tyaga-last-import:", "tyaga-import-run:"];
    return this.remove(this.keys().filter((k) => caches.some((p) => k.startsWith(p))));
  }

  /** Вошёл другой аккаунт: данные прежних аккаунтов на этом устройстве стираются, свои остаются. */
  purgeOthers(accountId: string) {
    return this.remove(this.keys().filter((k) => {
      if (DeviceAccountData.legacyUnscoped.includes(k)) return true;
      const prefix = DeviceAccountData.perAccount.find((p) => k.startsWith(p));
      return !!prefix && k.slice(prefix.length).split(":")[0] !== accountId;
    }));
  }
}
export const deviceAccountData = new DeviceAccountData();
