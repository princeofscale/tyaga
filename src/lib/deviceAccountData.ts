type Store = Pick<Storage, "getItem" | "setItem" | "removeItem" | "key" | "length">;

/**
 * Всё личное, что приложение держит в браузере (localStorage): черновик тренировки, кэш журнала веса,
 * сведения о последнем импорте, ключи операций импорта, офлайн-копия профиля и данных. Всё это
 * начинается с `tyaga-`. Настройки оформления и звука (`tyaga_theme_accent`, `tyaga_sound_muted`)
 * личными не считаются и остаются. `tyaga-cloud` — ключ синхронизации Android-сборки, не веб-аккаунта.
 * Cache Storage личного не содержит: туда попадают только файлы оболочки приложения (service worker).
 */
export class DeviceAccountData {
  private static readonly kept = new Set(["tyaga-cloud"]);
  /** Ключи, у которых после префикса стоит id аккаунта. */
  private static readonly perAccount = [
    "tyaga-draft-account:", "tyaga-bodyweight-sync:", "tyaga-bodyweight-bound:", "tyaga-bodyweight-goal:",
    "tyaga-bodyweight:", "tyaga-last-import:", "tyaga-offline:data:", "tyaga-offline-mutations:", "tyaga-pending-workouts:", "tyaga-deload:", "tyaga-live-finished:",
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

  /** Выход из аккаунта: на устройстве не остаётся ничего личного. Возвращает стёртые ключи. */
  wipe() {
    return this.remove(this.keys().filter((k) => k.startsWith("tyaga-") && !DeviceAccountData.kept.has(k)));
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
      const prefix = DeviceAccountData.perAccount.find((p) => k.startsWith(p));
      return !!prefix && k.slice(prefix.length).split(":")[0] !== accountId;
    }));
  }
}
export const deviceAccountData = new DeviceAccountData();
