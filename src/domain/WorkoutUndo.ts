import type { Draft } from "../lib/draft";
import type { WorkoutExercise, SetEntry } from "../lib/types";
export type WorkoutRemoval =
  | { kind: "exercise"; index: number; exercise: WorkoutExercise }
  | { kind: "set"; exerciseId: string; index: number; set: SetEntry };
/** Restores the removed item only, preserving all edits made after deletion. */
export class WorkoutUndo {
  static valid(value: unknown): value is WorkoutRemoval {
    if (!value || typeof value !== "object") return false;
    const v = value as Record<string, unknown>;
    if (
      !Number.isInteger(v.index) ||
      Number(v.index) < 0 ||
      Number(v.index) > 30
    )
      return false;
    if (v.kind === "exercise") {
      const e = v.exercise as WorkoutExercise;
      return (
        !!e &&
        typeof e.exerciseId === "string" &&
        Array.isArray(e.sets) &&
        e.sets.length > 0 &&
        e.sets.length <= 30 &&
        e.sets.every((s) => this.validSet(s))
      );
    }
    return (
      v.kind === "set" &&
      typeof v.exerciseId === "string" &&
      this.validSet(v.set)
    );
  }
  private static validSet(value: unknown): value is SetEntry {
    if (!value || typeof value !== "object") return false;
    const s = value as SetEntry;
    return (
      typeof s.id === "string" &&
      Number.isFinite(s.weight) &&
      Number.isFinite(s.reps) &&
      typeof s.done === "boolean" &&
      typeof s.warmup === "boolean" &&
      (s.rir === null || Number.isFinite(s.rir))
    );
  }
  static exercise(draft: Draft, index: number): Draft {
    const exercise = draft.workout.exercises[index];
    if (!exercise) return draft;
    return {
      ...draft,
      workout: {
        ...draft.workout,
        exercises: draft.workout.exercises.filter((_, i) => i !== index),
      },
      removals: [
        ...(draft.removals ?? []),
        {
          kind: "exercise",
          index,
          exercise: structuredClone(exercise),
        } as WorkoutRemoval,
      ].slice(-10),
    };
  }
  static set(draft: Draft, exerciseIndex: number): Draft {
    const exercise = draft.workout.exercises[exerciseIndex];
    if (!exercise || exercise.sets.length <= 1) return draft;
    return {
      ...draft,
      workout: {
        ...draft.workout,
        exercises: draft.workout.exercises.map((e, i) =>
          i === exerciseIndex ? { ...e, sets: e.sets.slice(0, -1) } : e,
        ),
      },
      removals: [
        ...(draft.removals ?? []),
        {
          kind: "set",
          exerciseId: exercise.exerciseId,
          index: exercise.sets.length - 1,
          set: structuredClone(exercise.sets.at(-1)!),
        } as WorkoutRemoval,
      ].slice(-10),
    };
  }
  static restore(draft: Draft): Draft {
    const item = draft.removals?.at(-1);
    if (!this.valid(item)) throw new Error("Не удалось восстановить удаление");
    const exercises = [...draft.workout.exercises];
    if (item.kind === "exercise") {
      if (
        exercises.some((e) => e.exerciseId === item.exercise.exerciseId) ||
        exercises.length >= 30
      )
        throw new Error(
          "Это упражнение уже добавлено или достигнут лимит. Остальные изменения сохранены.",
        );
      exercises.splice(
        Math.min(item.index, exercises.length),
        0,
        structuredClone(item.exercise),
      );
    } else {
      const index = exercises.findIndex(
        (e) => e.exerciseId === item.exerciseId,
      );
      if (index < 0 || exercises[index].sets.length >= 30)
        throw new Error("Сначала восстанови упражнение");
      const e = exercises[index];
      if (e.sets.some((s) => s.id === item.set.id))
        throw new Error("Подход уже восстановлен");
      const sets = [...e.sets];
      sets.splice(
        Math.min(item.index, sets.length),
        0,
        structuredClone(item.set),
      );
      exercises[index] = { ...e, sets };
    }
    return {
      ...draft,
      workout: { ...draft.workout, exercises },
      removals: draft.removals!.slice(0, -1),
    };
  }
}
