import type { Exercise, Routine, Workout } from "../lib/types";
import type { ImportedWorkout } from "./WorkoutImport";
import { quantity } from "../lib/quantity";

export type ExistingData = { workouts: Workout[]; routines: Routine[]; customExercises: Exercise[]; favorites: string[] };
export type Tally = { total: number; added: number; same: number; differs: number };

type Shape = { name: string; date: string; exercises: { exerciseId?: string; sets: { weight?: number; reps?: number | null }[] }[] };
const signature = (w: Shape) =>
  JSON.stringify([w.name, w.date, w.exercises.map((e) => [e.exerciseId ?? "", e.sets.map((s) => [s.weight ?? 0, s.reps ?? 0])])]);

/**
 * Что сделает восстановление из копии, словами: сколько тренировок, программ, своих упражнений и избранного
 * новые, сколько уже есть в аккаунте и сколько отличаются. Сервер не перезаписывает существующую тренировку
 * с тем же идентификатором, поэтому «Отличаются» остаются в аккаунте как есть.
 */
export class RestorePlan {
  static workouts(incoming: ImportedWorkout[], existing: Workout[]): Tally {
    const byId = new Map(existing.map((w) => [w.id, w]));
    const tally: Tally = { total: incoming.length, added: 0, same: 0, differs: 0 };
    for (const w of incoming) {
      const have = w.nativeId ? byId.get(w.nativeId) : undefined;
      if (!have) tally.added++;
      else if (signature(have as unknown as Shape) === signature(w as unknown as Shape)) tally.same++;
      else tally.differs++;
    }
    return tally;
  }

  private static byKey<T>(incoming: T[], existing: T[], key: (item: T) => string, same: (a: T, b: T) => boolean): Tally {
    const have = new Map(existing.map((e) => [key(e), e]));
    const tally: Tally = { total: incoming.length, added: 0, same: 0, differs: 0 };
    for (const item of incoming) {
      const found = have.get(key(item));
      if (!found) tally.added++;
      else if (same(found, item)) tally.same++;
      else tally.differs++;
    }
    return tally;
  }

  static routines(incoming: Routine[], existing: Routine[]) {
    return this.byKey(incoming, existing, (r) => r.id, (a, b) => a.name === b.name && JSON.stringify(a.days) === JSON.stringify(b.days));
  }
  static customExercises(incoming: Exercise[], existing: Exercise[]) {
    return this.byKey(incoming, existing, (e) => e.custom?.familyId ?? e.id, (a, b) => a.id === b.id);
  }
  static favorites(incoming: string[], existing: string[]): Tally {
    const have = new Set(existing);
    const added = incoming.filter((id) => !have.has(id)).length;
    return { total: incoming.length, added, same: incoming.length - added, differs: 0 };
  }

  static words(t: Tally) {
    return `Новых ${t.added} · Уже есть ${t.same} · Отличаются ${t.differs}`;
  }

  /** «Ничего нового: все 240 тренировок уже в аккаунте» — только если и остальное уже на месте. */
  static nothingNew(workouts: Tally, others: Tally[]) {
    if (workouts.total && workouts.added === 0 && others.every((o) => o.added === 0))
      return `Ничего нового: ${workouts.differs ? `все ${quantity(workouts.total, "тренировка", "тренировки", "тренировок")} уже есть в аккаунте (${workouts.differs} отличаются, останутся как в аккаунте)` : `все ${quantity(workouts.total, "тренировка", "тренировки", "тренировок")} уже в аккаунте`}`;
    return "";
  }
}
