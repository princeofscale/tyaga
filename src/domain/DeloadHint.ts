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
   * Тренажёры (блок/стек), «вес тела», «помощь», разминка и уже отмеченные подходы не меняются:
   * `skipped` — сколько упражнений пропущено как тренажёры или вес тела.
   */
  static apply(
    workout: Workout,
    mode: DeloadMode,
    base: (entry: WorkoutExercise) => SetEntry[] | undefined,
  ): { workout: Workout; changed: number; exercises: number; skipped: number } {
    let changed = 0;
    let touched = 0;
    let skipped = 0;
    const exercises = workout.exercises.map((entry) => {
      const loadMode = exerciseForEntry(entry)?.recording.loadMode;
      if (!DeloadHint.isFree(loadMode)) {
        if (entry.sets.some((set) => !set.warmup && !set.done)) skipped += 1;
        return entry;
      }
      const source = (base(entry) ?? []).filter((set) => !set.warmup && set.weight > 0);
      if (!source.length) return entry;
      let index = 0;
      const before = changed;
      const sets = entry.sets.map((set) => {
        if (set.warmup) return set;
        const reference = source[Math.min(index++, source.length - 1)];
        if (set.done) return set;
        const weight = DeloadEngine.scaleLoad(reference.weight, loadMode, mode);
        if (weight === set.weight) return set;
        changed += 1;
        return { ...set, weight };
      });
      if (changed > before) touched += 1;
      return { ...entry, sets };
    });
    return { workout: changed ? { ...workout, exercises } : workout, changed, exercises: touched, skipped };
  }

  /** Свободные веса: штанга, гантели, блины/«вес тела + пояс». Тренажёры, «вес тела» и «помощь» сюда не входят. */
  static isFree(loadMode: string | undefined) {
    return loadMode === "total_external" || loadMode === "per_implement" || loadMode === "added_bodyweight";
  }
}
