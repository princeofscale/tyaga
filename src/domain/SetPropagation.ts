import type { SetEntry } from "../lib/types";

type Field = "weight" | "reps" | "rir" | "assistanceKg" | "durationSeconds";
const FIELDS: Field[] = ["weight", "reps", "rir", "assistanceKg", "durationSeconds"];
const kindOf = (set: SetEntry) => set.kind ?? (set.warmup ? "warmup" : "normal");

/**
 * Одинаковые подходы не набирают заново: правка вес/повторы/RIR в строке
 * переносится на строки ниже, которые ещё не тронуты.
 *
 * «Не тронута» значит «значение поля равно тому, что было в правимой строке до
 * правки», поэтому отдельного признака в черновике не нужно и он не меняется.
 * Строка, где число уже поправили руками, остаётся как есть. Выполненные
 * подходы, разминка и подходы другого типа (дропсет, мио-повторы) не затрагиваются.
 */
export class SetPropagation {
  static apply(sets: SetEntry[], index: number, patch: Partial<SetEntry>): SetEntry[] {
    const source = sets[index];
    if (!source) return sets;
    const changed = source.done ? [] : FIELDS.filter((field) => field in patch && patch[field] !== source[field]);
    return sets.map((set, i) => {
      if (i === index) return { ...set, ...patch };
      if (i < index || set.done || kindOf(set) !== kindOf(source)) return set;
      const follow: Partial<SetEntry> = {};
      for (const field of changed)
        if (set[field] === source[field]) Object.assign(follow, { [field]: patch[field] });
      return Object.keys(follow).length ? { ...set, ...follow } : set;
    });
  }
}
