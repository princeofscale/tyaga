import { DeloadEngine } from "./DeloadEngine";
import {
  entryName,
  estimatedOneRepMax,
  fmt,
  progressKey,
  volumeSummary,
  workingSets,
  type Workout,
  type WorkoutExercise,
} from "../lib/model";

/** Лучший рабочий подход упражнения по расчётному 1ПМ (Эпли). */
export type BestSet = { setId: string; e1rm: number };

export type ExerciseInsight = {
  best: BestSet | null;
  /** Лучший расчётный 1ПМ этого упражнения в прошлый раз, когда оно было в журнале. */
  previousBest: number | null;
  previousDate: string | null;
  /** Расчётный 1ПМ выше всех прежних записей упражнения (первое появление — точка отсчёта, не рекорд). */
  record: boolean;
};

export type HistoryTotals = { tonnage: number; omittedSets: number; minutes: number; sets: number };

const WEEKDAYS = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];
const EPS = 0.05;

/** Хронологический порядок: дата, затем момент создания — две тренировки одного дня не меняются местами. */
const chrono = (a: Workout, b: Workout) =>
  a.date.localeCompare(b.date) || (a.createdAt ?? "").localeCompare(b.createdAt ?? "") || a.id.localeCompare(b.id);

/**
 * Факты для «Истории»: рекорды, лучший подход, сравнение с прошлой такой же тренировкой и итоги месяца.
 * Всё считается из записанных подходов, без оценок «хорошо/плохо».
 */
export class HistoryInsights {
  static newestFirst(workouts: Workout[]) {
    return [...workouts].sort((a, b) => chrono(b, a));
  }

  /** «пн» … «вс» по календарной строке ГГГГ-ММ-ДД, без часовых поясов. */
  static weekday(date: string) {
    const d = new Date(`${date.slice(0, 10)}T12:00:00Z`);
    return Number.isFinite(d.getTime()) ? WEEKDAYS[d.getUTCDay()] : "";
  }

  static bestSet(entry: WorkoutExercise): BestSet | null {
    let best: BestSet | null = null;
    for (const set of entry.sets) {
      const e1rm = estimatedOneRepMax(set, entry);
      if (e1rm !== null && (!best || e1rm > best.e1rm)) best = { setId: set.id, e1rm };
    }
    return best;
  }

  /** Тренировка → названия упражнений, где побит прежний расчётный максимум. */
  static records(workouts: Workout[]): Map<string, string[]> {
    const top = new Map<string, number>();
    const result = new Map<string, string[]>();
    for (const w of [...workouts].sort(chrono)) {
      const names: string[] = [];
      const local = new Map<string, number>();
      for (const entry of w.exercises) {
        const best = this.bestSet(entry);
        if (!best) continue;
        const key = progressKey(entry);
        const before = top.get(key);
        if (before !== undefined && best.e1rm > before + EPS && best.e1rm > (local.get(key) ?? 0)) {
          if (!names.includes(entryName(entry))) names.push(entryName(entry));
        }
        local.set(key, Math.max(local.get(key) ?? 0, best.e1rm));
      }
      for (const [key, value] of local) top.set(key, Math.max(top.get(key) ?? 0, value));
      if (names.length) result.set(w.id, names);
    }
    return result;
  }

  /** Прошлая тренировка того же типа («Ноги» и «Ноги [Разгрузка]» — один тип). */
  static previous(workout: Workout, workouts: Workout[]): Workout | null {
    const type = DeloadEngine.baseName(workout.name);
    let found: Workout | null = null;
    for (const w of workouts) {
      if (w.id === workout.id || chrono(w, workout) >= 0) continue;
      if (DeloadEngine.baseName(w.name) !== type) continue;
      if (!found || chrono(w, found) > 0) found = w;
    }
    return found;
  }

  /** По упражнениям тренировки (в том же порядке): лучший подход, прошлый раз и рекорд. */
  static exercises(workout: Workout, workouts: Workout[]): ExerciseInsight[] {
    const before = workouts.filter((w) => w.id !== workout.id && chrono(w, workout) < 0).sort(chrono);
    return workout.exercises.map((entry) => {
      const best = this.bestSet(entry);
      const key = progressKey(entry);
      let max: number | null = null;
      let previousBest: number | null = null;
      let previousDate: string | null = null;
      for (const w of before) {
        let session: number | null = null;
        for (const other of w.exercises) {
          if (progressKey(other) !== key) continue;
          const b = this.bestSet(other);
          if (b && (session === null || b.e1rm > session)) session = b.e1rm;
        }
        if (session === null) continue;
        max = max === null ? session : Math.max(max, session);
        previousBest = session;
        previousDate = w.date;
      }
      return { best, previousBest, previousDate, record: !!best && max !== null && best.e1rm > max + EPS };
    });
  }

  static totals(workouts: Workout[]): HistoryTotals {
    const volume = volumeSummary(workouts, "all");
    return {
      tonnage: volume.total,
      omittedSets: volume.omittedSets,
      minutes: workouts.reduce((sum, w) => sum + (Number.isFinite(w.duration) ? Math.max(0, w.duration) : 0), 0),
      sets: workingSets(workouts),
    };
  }

  /** «50 мин», «1 ч 40 мин», «12 ч». */
  static duration(minutes: number) {
    const m = Math.max(0, Math.round(minutes));
    if (m < 60) return `${m} мин`;
    const h = Math.floor(m / 60);
    const rest = m % 60;
    return rest && h < 10 ? `${h} ч ${rest} мин` : `${h} ч`;
  }

  /** Коротко для плитки: «50 мин», «3,3 ч». */
  static hours(minutes: number) {
    const m = Math.max(0, Math.round(minutes));
    return m < 60 ? `${m} мин` : `${fmt(Math.round(m / 6) / 10)} ч`;
  }
}
