import type { SetEntry } from "../lib/types";

export type PropagatedField = "weight" | "reps" | "rir" | "assistanceKg" | "durationSeconds";
const FIELDS: PropagatedField[] = ["weight", "reps", "rir", "assistanceKg", "durationSeconds"];
const kindOf = (set: SetEntry) => set.kind ?? (set.warmup ? "warmup" : "normal");

/** Кто пойдёт за правкой: для каждого поля — id строк ниже, которые на начало правки были «не тронуты». */
export type SetFollowers = { setId: string; byField: Partial<Record<PropagatedField, string[]>> };

/**
 * Одинаковые подходы не набирают заново: правка вес/повторы/RIR в строке
 * переносится на строки ниже, которые ещё не тронуты. Это касается и набора
 * с клавиатуры, и кнопок шагов веса, RIR и подстановки прошлого результата.
 *
 * «Не тронута» значит «значение поля равно тому, что было в правимой строке
 * до правки», поэтому отдельного признака в черновике не нужно и формат
 * данных не меняется. Это сравнение делается ОДИН раз — на начало правки
 * (фокус в поле или нажатие кнопки). Промежуточные значения при наборе
 * («1» на пути к «12») последователей не меняют: строка, где число поправили
 * руками, остаётся как есть. Выполненные подходы, разминка и подходы другого
 * типа (дропсет, мио-повторы) не затрагиваются.
 */
export class SetPropagation {
  /** Определяет последователей правки строки `index` по её текущим значениям. */
  static followers(sets: SetEntry[], index: number): SetFollowers | null {
    const source = sets[index];
    if (!source) return null;
    const byField: SetFollowers["byField"] = {};
    if (!source.done)
      sets.forEach((set, i) => {
        if (i <= index || set.done || kindOf(set) !== kindOf(source)) return;
        for (const field of FIELDS)
          if (set[field] === source[field]) (byField[field] ??= []).push(set.id);
      });
    return { setId: source.id, byField };
  }

  /**
   * Применяет правку к строке и к последователям. `followers` — снимок на начало
   * правки; без него (кнопки) последователи определяются по текущим значениям.
   */
  static apply(sets: SetEntry[], index: number, patch: Partial<SetEntry>, followers?: SetFollowers | null): SetEntry[] {
    const source = sets[index];
    if (!source) return sets;
    const snapshot = followers && followers.setId === source.id ? followers : this.followers(sets, index);
    return sets.map((set, i) => {
      if (i === index) return { ...set, ...patch };
      if (i < index || set.done || !snapshot) return set;
      const follow: Partial<SetEntry> = {};
      for (const field of FIELDS)
        if (field in patch && snapshot.byField[field]?.includes(set.id))
          Object.assign(follow, { [field]: patch[field] });
      return Object.keys(follow).length ? { ...set, ...follow } : set;
    });
  }
}
