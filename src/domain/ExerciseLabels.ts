import { MUSCLES } from "../data/muscles";
import type { Exercise } from "../lib/types";
import { detectExerciseEquipment } from "./ExerciseAlternatives";

const NAMES = {
  barbell: "Штанга",
  dumbbell: "Гантели",
  cable: "Блок / Кроссовер",
  machine: "Тренажёр",
  bodyweight: "Свой вес",
} as const;

/** Русские подписи снаряда и мышц упражнения: те же слова, что в фильтрах окна «Заменить» и «Анатомических альтернативах» (R08-REQ02). */
export class ExerciseLabels {
  /**
   * «Штанга», «Гантели», «Блок / Кроссовер», «Тренажёр», «Свой вес». Для `gym`, где снаряд по названию не определить,
   * везде одно слово — «Штанга / тренажёр».
   */
  static equipment(exercise: Pick<Exercise, "id" | "name" | "equipment" | "recording">): string {
    const detected = detectExerciseEquipment(exercise as Exercise);
    if (detected === "barbell" && exercise.equipment === "gym" && !/штанг|гриф|становая/i.test(exercise.name)) return "Штанга / тренажёр";
    return NAMES[detected];
  }

  /** «Квадрицепс, Ягодицы» — названия групп мышц, не внутренние идентификаторы. */
  static muscles(ids: readonly string[]): string {
    return ids.map((id) => MUSCLES.find((m) => m.id === id)?.short ?? id).join(", ");
  }

  /** «Штанга · Квадрицепс, Ягодицы». */
  static meta(exercise: Pick<Exercise, "id" | "name" | "equipment" | "recording" | "primary">): string {
    return `${ExerciseLabels.equipment(exercise)} · ${ExerciseLabels.muscles(exercise.primary)}`;
  }
}
