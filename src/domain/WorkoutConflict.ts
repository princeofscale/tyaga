import { fmt, volumeSummary, workingSets, type Workout } from "../lib/model";

/** Сколько в тренировке рабочих подходов и какой у неё рабочий тоннаж: те же правила, что в карточке «Истории» и шапке тренировки. */
export class WorkoutDigest {
  static of(workout: Workout): { sets: number; tonnageKg: number } {
    return { sets: workingSets([workout]), tonnageKg: Math.round(volumeSummary([workout], "working").total) };
  }

  /**
   * «2 подх. · 1 358 кг»; без тоннажа (вес без правила, свой вес) — «2 подх. · тоннаж не считается».
   * Если в записи есть отмеченная разминка, добавляется «без разминки»: карточка «Истории» считает тоннаж вместе с ней,
   * шапка тренировки — без неё, и цифры в окне иначе выглядели бы ошибкой (R09-QA-05).
   */
  static line(workout: Workout): string {
    const { sets, tonnageKg } = WorkoutDigest.of(workout);
    const warm = workout.exercises.some((e) => e.sets.some((s) => s.warmup && s.done));
    return `${sets} подх. · ${tonnageKg > 0 ? `${fmt(tonnageKg)} кг${warm ? " без разминки" : ""}` : "тоннаж не считается"}`;
  }
}

export type ConflictAction = { label: string; effect: string };

/**
 * Окно «Эта тренировка уже сохранена в другом окне»: что случилось, чем различаются записи и что сделает каждая кнопка.
 * Поведение кнопок задаёт App; здесь только слова.
 */
export class WorkoutConflict {
  static readonly TITLE_SAVED = "Эта тренировка уже сохранена в другом окне";
  static readonly TITLE_DELETED = "Эта тренировка удалена в другом окне";

  static title(saved: Workout | null): string {
    return saved ? WorkoutConflict.TITLE_SAVED : WorkoutConflict.TITLE_DELETED;
  }

  /** Строки сравнения: «Сохранено: …», «Здесь: …». Для удалённой остаётся только «Здесь». */
  static summary(mine: Workout, saved: Workout | null): { label: string; value: string }[] {
    const here = { label: "Здесь", value: WorkoutDigest.line(mine) };
    return saved ? [{ label: "Сохранено", value: WorkoutDigest.line(saved) }, here] : [here];
  }

  static readonly KEEP_SAVED: ConflictAction = {
    label: "Оставить сохранённую, мою не сохранять",
    effect: "Мои правки пропадут: откроется сохранённая тренировка.",
  };
  static readonly SAVE_COPY: ConflictAction = {
    label: "Сохранить мою отдельной тренировкой",
    effect: "Откроется копия: проверь её и сохрани, в истории будет две записи.",
  };
  /** Когда исходной записи уже нет, копия остаётся единственной. */
  static readonly SAVE_COPY_DELETED: ConflictAction = {
    label: WorkoutConflict.SAVE_COPY.label,
    effect: "Откроется копия: проверь её и сохрани — в истории останется только она.",
  };
  static readonly DOWNLOAD: ConflictAction = {
    label: "Скачать мою в файл",
    effect: "Получишь файл с моей тренировкой, в истории ничего не изменится.",
  };

  /** Сообщение после «Сохранить мою отдельной тренировкой» (слова прежние). */
  static readonly COPY_READY = "Отдельный черновик готов. Сохрани его, когда проверишь.";
}
