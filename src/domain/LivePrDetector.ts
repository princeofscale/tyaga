import { exerciseForEntry } from "../lib/catalog";
import type { SetEntry, Workout, WorkoutExercise } from "../lib/types";
import { DeloadEngine } from "./DeloadEngine";
import { ExecutionIdentity } from "./ExecutionIdentity";
import { OneRepMaxFormulas } from "./OneRepMaxFormulas";

export interface LivePrHit {
  e1rm: number;
  previousBest: number;
  deltaKg: number;
}

function isPartialRom(entry: WorkoutExercise, set: SetEntry): boolean {
  const rom = set.execution?.rom ?? entry.execution?.rom;
  return rom === "shortened_partial" || rom === "lengthened_partial";
}

/**
 * ООП-детектор живых личных рекордов (PR) прямо во время выполнения тренировки.
 * Предвычисляет исторические лучшие e1RM по ключу ExecutionIdentity один раз на сессию (O(1) на проверку подхода).
 */
export class LivePrDetector {
  private readonly historicalBest = new Map<string, number>();
  private readonly exerciseBest = new Map<string, number>();

  constructor(history: Workout[], excludeWorkoutId?: string) {
    const unique = new Map<string, Workout>();
    for (const w of history) {
      if (excludeWorkoutId && w.id === excludeWorkoutId) continue;
      const prev = unique.get(w.id);
      if (
        !prev ||
        (w.revision ?? 0) > (prev.revision ?? 0) ||
        ((w.revision ?? 0) === (prev.revision ?? 0) && (w.updatedAt ?? "") > (prev.updatedAt ?? ""))
      ) {
        unique.set(w.id, w);
      }
    }
    for (const w of unique.values()) {
      if (DeloadEngine.isDeloadName(w.name)) continue;
      for (const e of w.exercises) {
        const def = exerciseForEntry(e);
        if (!def?.recording.e1rmEligible || def.recording.type === "duration") continue;
        for (const s of e.sets) {
          if (!s.done || s.warmup || s.weight <= 0 || s.reps < 1 || s.reps > 12) continue;
          if (isPartialRom(e, s)) continue;
          const e1rm = OneRepMaxFormulas.round(OneRepMaxFormulas.epley(s.weight, s.reps));
          const key = ExecutionIdentity.key(e, s);
          const prev = this.historicalBest.get(key) ?? 0;
          if (e1rm > prev) this.historicalBest.set(key, e1rm);
          const prevEx = this.exerciseBest.get(e.exerciseId) ?? 0;
          if (e1rm > prevEx) this.exerciseBest.set(e.exerciseId, e1rm);
        }
      }
    }
  }

  /** Исторический лучший e1RM упражнения до текущей тренировки (null, если записей ещё нет). */
  bestBefore(exerciseId: string): number | null {
    return this.exerciseBest.get(exerciseId) ?? null;
  }

  /** Проверяет, побил ли выполненный подход исторический рекорд упражнения в том же профиле исполнения. */
  checkSet(entry: WorkoutExercise, set: SetEntry): LivePrHit | null {
    if (!set.done || set.warmup || set.weight <= 0 || set.reps < 1 || set.reps > 12) return null;
    if (isPartialRom(entry, set)) return null;
    const def = exerciseForEntry(entry);
    if (!def?.recording.e1rmEligible || def.recording.type === "duration") return null;
    const key = ExecutionIdentity.key(entry, set);
    const previousBest = this.historicalBest.get(key);
    if (!previousBest || previousBest <= 0) return null;

    const e1rm = OneRepMaxFormulas.round(OneRepMaxFormulas.epley(set.weight, set.reps));
    const deltaKg = Math.round((e1rm - previousBest) * 10) / 10;
    if (deltaKg < 0.5) return null;
    return { e1rm, previousBest, deltaKg };
  }

  /** Возвращает ID подходов внутри упражнения, которые стали новыми рекордами (только лучший на упражнение). */
  bestPrSetId(entry: WorkoutExercise): { setId: string; hit: LivePrHit } | null {
    let best: { setId: string; hit: LivePrHit } | null = null;
    for (const s of entry.sets) {
      const hit = this.checkSet(entry, s);
      if (!hit) continue;
      if (!best || hit.e1rm > best.hit.e1rm) {
        best = { setId: s.id, hit };
      }
    }
    return best;
  }
}
