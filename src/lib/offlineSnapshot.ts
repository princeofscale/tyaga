import type { AccountProfile } from "./account";
import type { ProductData, Settings, Workout } from "./types";

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export type DataSnapshot = { workouts: Workout[]; settings: Settings; product: ProductData };

/**
 * Копия последнего успешного ответа сервера на устройстве, чтобы закрытое и открытое снова без связи
 * приложение показывало «Сегодня», «Программы» и «Историю». Это копия для чтения: правда остаётся
 * на сервере, при возвращении связи приложение берёт свежие данные. Профиль стирается при выходе.
 */
export class OfflineSnapshot {
  private static readonly sessionKey = "tyaga-offline:session";
  private static dataKey = (accountId: string) => `tyaga-offline:data:${accountId}`;

  constructor(private storage: () => Store | null = () => (typeof localStorage === "undefined" ? null : localStorage)) {}

  private store() {
    try { return this.storage(); } catch { return null; }
  }
  private read<T>(key: string): T | null {
    try {
      const raw = this.store()?.getItem(key);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch { return null; }
  }
  private write(key: string, value: unknown) {
    try { this.store()?.setItem(key, JSON.stringify(value)); } catch { /* переполненное хранилище: работаем без копии */ }
  }

  session() {
    const profile = this.read<AccountProfile>(OfflineSnapshot.sessionKey);
    return profile && typeof profile.id === "string" ? profile : null;
  }
  saveSession(profile: AccountProfile) { this.write(OfflineSnapshot.sessionKey, profile); }

  data(accountId: string) {
    const snapshot = this.read<DataSnapshot>(OfflineSnapshot.dataKey(accountId));
    return snapshot && Array.isArray(snapshot.workouts) && snapshot.settings && snapshot.product ? snapshot : null;
  }
  saveData(accountId: string, snapshot: DataSnapshot) { this.write(OfflineSnapshot.dataKey(accountId), snapshot); }

  /** Выход из аккаунта: копии больше нет — чужое устройство не покажет чужой журнал. */
  clear(accountId?: string) {
    try {
      const store = this.store();
      const id = accountId ?? this.session()?.id;
      store?.removeItem(OfflineSnapshot.sessionKey);
      if (id) store?.removeItem(OfflineSnapshot.dataKey(id));
    } catch { /* ignore */ }
  }
}
export const offlineSnapshot = new OfflineSnapshot();
