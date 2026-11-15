import { exerciseForEntry } from "../lib/model";
import type { SetEntry, Workout, WorkoutExercise } from "../lib/types";
import { DateText } from "./DateText";
import { DELOAD_PRESETS, DeloadEngine, type DeloadMode } from "./DeloadEngine";
import type { DeloadPlanRecord } from "./DeloadPlan";

/**
 * Напоминание о разгрузке на свободной тренировке (R07-REQ05). Признак «[Разгрузка]» в названии и запуск
 * программ не меняются: это строка с датой окончания и кнопка, которая по нажатию ставит разгрузочный вес.
 */
export class DeloadHint {
  /** «85 %» — для подписи кнопки. */
  static percent(mode: DeloadMode) {
    return Math.round(DELOAD_PRESETS[mode].intensityMultiplier * 100);
  }

  /** «Разгрузка до 21 нояб.: 85 % веса, 64 % подходов»; null, когда разгрузки нет или она закончилась. */
  static line(record: DeloadPlanRecord | null | undefined, today: string): string | null {
    if (!record || record.until < today) return null;
    const preset = DELOAD_PRESETS[record.mode];
    const volume =
      record.sets && record.sets.before > 0
        ? Math.round((record.sets.after / record.sets.before) * 100)
        : Math.round(preset.volumeMultiplier * 100);
    return `Разгрузка до ${DateText.dayInYear(record.until, today.slice(0, 4))}: ${DeloadHint.percent(record.mode)} % веса, ${volume} % подходов`;
  }

  /**
   * Ставит разгрузочный вес невыполненным рабочим подходам свободных весов. Вес считается от последней обычной
   * (не разгрузочной) тренировки, а не от текущего значения, поэтому повторное нажатие ничего не снижает второй раз.
   * Машины без внешней нагрузки, «вес тела», разминка и уже отмеченные подходы не меняются.
   */
  static apply(
    workout: Workout,
    mode: DeloadMode,
    base: (entry: WorkoutExercise) => SetEntry[] | undefined,
  ): { workout: Workout; changed: number } {
    let changed = 0;
    const exercises = workout.exercises.map((entry) => {
      const loadMode = exerciseForEntry(entry)?.recording.loadMode;
      if (!DeloadEngine.isScalable(loadMode)) return entry;
      const source = (base(entry) ?? []).filter((set) => !set.warmup && set.weight > 0);
      if (!source.length) return entry;
      let index = 0;
      const sets = entry.sets.map((set) => {
        if (set.warmup) return set;
        const reference = source[Math.min(index++, source.length - 1)];
        if (set.done) return set;
        const weight = DeloadEngine.scaleLoad(reference.weight, loadMode, mode);
        if (weight === set.weight) return set;
        changed += 1;
        return { ...set, weight };
      });
      return { ...entry, sets };
    });
    return { workout: changed ? { ...workout, exercises } : workout, changed };
  }
}
