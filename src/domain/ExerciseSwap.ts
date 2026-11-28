import type { Exercise, SetEntry, WorkoutExercise } from "../lib/types";
import { PreviousSets } from "./PreviousSets";

/**
 * Замена упражнения посреди тренировки (R08-REQ01). Если у нового упражнения то же правило веса и тот же тип записи
 * (штанга → штанга), подходы остаются как есть. Если правило другое (штанга → гантели, жим → отжимания), числа и ✓
 * старого упражнения новому не принадлежат: вместо них берутся значения из «Прошлого» нового упражнения, а без
 * истории поля остаются пустыми. Выполненный подход старого упражнения в новое не переходит.
 */
export class ExerciseSwap {
  /** Правило веса и тип записи (с учётом тренажёра и числа снарядов/латеральности). */
  static sameRule(
    oldLoadMode: string | undefined,
    oldType: string | undefined,
    next: Exercise,
    oldExercise?: Exercise,
  ) {
    if (oldLoadMode !== next.recording.loadMode || oldType !== next.recording.type) return false;
    if (next.recording.loadMode === "machine_stack" && (!oldExercise || oldExercise.id !== next.id)) {
      return false;
    }
    if (oldExercise && next.recording.loadMode === "per_implement") {
      const oldCount = oldExercise.recording.implementCount ?? 2;
      const nextCount = next.recording.implementCount ?? 2;
      const oldLat = oldExercise.recording.laterality ?? "bilateral";
      const nextLat = next.recording.laterality ?? "bilateral";
      if (oldCount !== nextCount || oldLat !== nextLat) return false;
    }
    return true;
  }

  /**
   * Подходы после замены. `previousWorking` — выполненные рабочие подходы нового упражнения из последней тренировки
   * (подход N берёт подход N, если их меньше — последний, как «Повторить прошлые»).
   */
  static sets(
    oldSets: SetEntry[],
    oldLoadMode: string | undefined,
    oldType: string | undefined,
    next: Exercise,
    previousWorking: SetEntry[],
    oldExercise?: Exercise,
  ): { sets: SetEntry[]; carried: boolean } {
    if (ExerciseSwap.sameRule(oldLoadMode, oldType, next, oldExercise)) return { sets: oldSets, carried: true };
    const timed = next.recording.type === "duration";
    const assistance = next.recording.loadMode === "assisted_bodyweight";
    // Разминка настроена под вес старого упражнения: в новом её нет, остаются рабочие подходы.
    const working = oldSets.filter((set) => !set.warmup);
    const slots = working.length ? working : [undefined, undefined, undefined];
    const sets = slots.map((slot, index): SetEntry => {
      const base: SetEntry = {
        id: slot?.id ?? crypto.randomUUID(),
        weight: 0,
        reps: timed ? 1 : 0,
        rir: null,
        warmup: false,
        done: false,
        ...(timed ? { durationSeconds: 30 } : {}),
        ...(assistance ? { assistanceKg: 0 } : {}),
      };
      const prior = previousWorking.length ? PreviousSets.pick(previousWorking, index) : undefined;
      return prior ? { ...base, ...PreviousSets.patch(prior, { timed, assistance }) } : base;
    });
    return { sets, carried: false };
  }

  /** Поля записи, привязанные к старому упражнению (станция, профиль исполнения) при другом правиле веса не переносятся. */
  static entry(old: WorkoutExercise, carried: boolean): WorkoutExercise {
    if (carried) return old;
    const { machineInstanceId: _m, machineSnapshot: _s, execution: _e, progressionNote: _p, equipmentNote: _n, ...rest } = old;
    return rest;
  }
}
