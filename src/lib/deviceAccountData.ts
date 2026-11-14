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
    "tyaga-bodyweight:", "tyaga-last-import:", "tyaga-offline:data:",
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

  /** Вошёл другой аккаунт: данные прежних аккаунтов на этом устройстве стираются, свои остаются. */
  purgeOthers(accountId: string) {
    return this.remove(this.keys().filter((k) => {
      const prefix = DeviceAccountData.perAccount.find((p) => k.startsWith(p));
      return !!prefix && k.slice(prefix.length).split(":")[0] !== accountId;
    }));
  }
}
export const deviceAccountData = new DeviceAccountData();
