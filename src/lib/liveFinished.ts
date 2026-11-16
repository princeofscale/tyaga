const key = (accountId: string) => `tyaga-live-finished:${accountId}`;

/**
 * Какая тренировка была последней завершена в комнате «Вместе» на этом устройстве. Правка именно её пересчитывает
 * итог «Закончил · N т»; правка любой другой записи комнату не трогает (R09-QA-01).
 */
export class LiveFinished {
  static read(accountId: string, storage: Pick<Storage, "getItem"> = localStorage): string | null {
    try {
      return storage.getItem(key(accountId));
    } catch {
      return null;
    }
  }

  static write(accountId: string, workoutId: string, storage: Pick<Storage, "setItem"> = localStorage): void {
    try {
      storage.setItem(key(accountId), workoutId);
    } catch {
      // Хранилище недоступно: правка тогда просто не пересчитает комнату.
    }
  }
}
