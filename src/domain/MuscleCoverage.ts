import type { Exercise, Workout } from "../lib/types";
import { AnalyticsFacts, type FactsOptions } from "./AnalyticsFacts";

export type UnmarkedExercise = { exerciseId: string; name: string; sets: number; exercise?: Exercise };
export type CoverageReport = { exercises: number; sets: number; items: UnmarkedExercise[] };

/**
 * Какие подходы «Мышцы» не могут учесть: у упражнения нет ни разметки каталога, ни выбранных групп мышц.
 * Именно из-за них «Пресс 0» при трёх упражнениях на пресс — экран должен говорить об этом, а не молчать.
 */
export class MuscleCoverage {
  /** Нет мышц ни в самом упражнении, ни в отмеченных владельцем группах. */
  static unmarked(exercise: Exercise | undefined) {
    if (!exercise) return false;
    return !exercise.primary.length && !exercise.secondary.length && !(exercise.custom?.declaredZones?.length ?? 0);
  }

  /** Упражнения «Мои» без разметки — то, что массовая разметка предлагает выбрать первым. */
  static unmarkedPersonal(personal: Exercise[]) {
    return personal.filter((e) => this.unmarked(e));
  }

  /** Упражнения каталога (не «Мои») без мышц, которые есть в журнале: их размечают своей копией. */
  static catalogGaps(workouts: Workout[], options: FactsOptions = {}) {
    return this.report(workouts, options).items.filter((i) => i.exercise && !i.exercise.custom).map((i) => i.exercise!);
  }

  /** Подходы выбранных тренировок (те же, что идут в «Мышцы»), которые попали в упражнения без разметки. */
  static report(workouts: Workout[], options: FactsOptions = {}, nameOf?: (id: string, fallback: string) => string): CoverageReport {
    const byId = new Map<string, UnmarkedExercise>();
    for (const fact of new AnalyticsFacts(workouts, options).sets()) {
      if (!this.unmarked(fact.exercise)) continue;
      const row = byId.get(fact.entry.exerciseId) ?? {
        exerciseId: fact.entry.exerciseId,
        name: nameOf?.(fact.entry.exerciseId, fact.exercise?.name ?? fact.entry.exerciseId) ?? fact.exercise?.name ?? fact.entry.exerciseId,
        sets: 0,
        exercise: fact.exercise,
      };
      row.sets += 1;
      byId.set(fact.entry.exerciseId, row);
    }
    const items = [...byId.values()].sort((a, b) => b.sets - a.sets);
    return { exercises: items.length, sets: items.reduce((n, i) => n + i.sets, 0), items };
  }
}
