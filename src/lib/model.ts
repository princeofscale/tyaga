import { AnalyticsFacts, type FactsOptions } from "../domain/AnalyticsFacts";
import { TrainingVolume } from "../domain/TrainingVolume";
import { WorkoutReference } from "../domain/WorkoutReference";
import { PreviousSets } from "../domain/PreviousSets";
import {
  TrainingAnalytics,
  type AnalysisOptions,
} from "../domain/TrainingAnalytics";
import { MUSCLES, ANATOMICAL_MUSCLES, CHEST_HEADS, DELTOID_HEADS } from "../data/muscles";
export { MUSCLES, ANATOMICAL_MUSCLES, CHEST_HEADS, DELTOID_HEADS };
import {
  EXERCISES,
  exerciseById,
  entrySpec,
} from "./catalog";
import {
  localDate,
  weekStart,
  browserTimeZone,
  addCalendarDays,
} from "./calendar";
import type {
  Settings,
  MuscleLoad,
  Workout,
  SetEntry,
  WorkoutExercise,
  Muscle,
  Equipment,
  Exercise,
  SetKind,
} from "./types";
export type { SetKind };
export * from "./types";
export * from "./catalog";
export * from "./calendar";
export const ANALYSIS_VERSION = 2;
export const E1RM_FORMULA_VERSION = "epley-1";
export const DEFAULT_SETTINGS: Settings = {
  goals: Object.fromEntries(MUSCLES.map((m) => [m.id, m.goal])) as Record<
    Muscle,
    number
  >,
  equipment: "gym",
  restSeconds: 90,
};
export const fmt = (n: number) =>
  new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 }).format(n);
export type { AnalysisOptions };
export function muscleLoad(
  workouts: Workout[],
  settings = DEFAULT_SETTINGS,
  options: AnalysisOptions = {},
): MuscleLoad[] {
  return new TrainingAnalytics(workouts, { timeZone: settings.timeZone, ...options }).zoneLoad(settings);
}
export function anatomicalLoad(
  workouts: Workout[],
  options: AnalysisOptions = {},
) {
  return new TrainingAnalytics(workouts, options).anatomicalLoad();
}
// Frozen release-1 analysis for inspecting historical calculations.
export function legacyMuscleLoad(
  workouts: Workout[],
  settings = DEFAULT_SETTINGS,
): MuscleLoad[] {
  const loads = muscleLoad([], settings);
  for (const w of workouts)
    for (const we of w.exercises) {
      if ((we.catalogRevision ?? 1) !== 1) continue;
      const e = exerciseById(we.exerciseId, 1);
      if (!e) continue;
      for (const s of we.sets)
        if (s.done && !s.warmup) {
          if (s.rir === null) continue;
          const factor = s.rir <= 3 ? 1 : s.rir <= 5 ? 0.75 : 0.5;
          for (const m of loads) {
            if (e.primary.includes(m.id)) m.direct += factor;
            else if (e.secondary.includes(m.id)) m.indirect += factor * 0.5;
          }
        }
    }
  return loads.map((m) => ({
    ...m,
    total: m.direct + m.indirect,
    ratio: (m.direct + m.indirect) / m.goal,
  }));
}
export const balanceScore = (loads: MuscleLoad[]) =>
  loads.length
    ? Math.round(
        (loads.reduce((s, m) => s + Math.min(m.ratio, 1), 0) / loads.length) *
          100,
      )
    : 0;
export const volumeSummary = TrainingVolume.summarize.bind(TrainingVolume);
export const volume = (workouts: Workout[]) => volumeSummary(workouts).total;
export const workingSets = (workouts: Workout[], options: FactsOptions = {}) => new AnalyticsFacts(workouts,options).sets().length;
export const estimatedOneRepMax = TrainingVolume.e1rm.bind(TrainingVolume);
export function makeSets(count = 3, weight = 0, reps = 10, rir: number | null = 2): SetEntry[] {
  return Array.from({ length: count }, () => ({
    id: crypto.randomUUID(),
    weight,
    reps,
    rir,
    warmup: false,
    done: false,
  }));
}
/** The same exercise variant from the most recent workout, skipping `excludeId`. */
export const lastEntry = WorkoutReference.latest.bind(WorkoutReference);
/**
 * Новое упражнение в тренировке. С историей подход N берёт подход N из прошлого раза (`PreviousSets`);
 * без истории при `blank: true` повторы и RIR остаются пустыми — в поле видна только серая подсказка, и записать
 * можно лишь то, что введено. Живая тренировка всегда создаётся с `blank: true`; без него — заготовка
 * программы и фикстуры (там нужны числа по умолчанию 3×10, RIR 2).
 */
export function makeExerciseEntry(
  id: string,
  history: Workout[] = [],
  referenceDate = localDate(),
  timeZone?: string,
  blank = false,
): WorkoutExercise {
  const e = exerciseById(id)!;
  const entry: WorkoutExercise = { ...entrySpec(id), sets: blank ? makeSets(3, 0, 0, null) : makeSets() };
  if (e.recording.type === "duration")
    entry.sets = makeSets(3, 0, 1).map((s) => ({
      ...s,
      rir: null,
      durationSeconds: 30,
    }));
  const working = lastEntry(history, entry, undefined, referenceDate, { timeZone })
    ?.sets.filter((s) => s.done && !s.warmup) ?? [];
  if (working.length)
    entry.sets = entry.sets.map((s, i) => ({
      ...s,
      ...PreviousSets.patch(PreviousSets.pick(working, i)!, {
        timed: e.recording.type === "duration",
        assistance: e.recording.loadMode === "assisted_bodyweight",
      }),
    }));
  else if (e.recording.loadMode === "assisted_bodyweight")
    entry.sets.forEach((s) => {
      s.assistanceKg = 0;
    });
  return entry;
}
export function makeWorkout(
  ids: string[] = [],
  history: Workout[] = [],
  timeZone = browserTimeZone(),
  blank = false,
): Workout {
  return {
    id: crypto.randomUUID(),
    name: "Новая тренировка",
    date: localDate(new Date(), timeZone),
    duration: 0,
    notes: "",
    exercises: ids.map((id) => makeExerciseEntry(id, history, localDate(new Date(), timeZone), timeZone, blank)),
    revision: 0,
    timeZone,
    createdAt: new Date().toISOString(),
    analysisVersion: 2,
  };
}
export function repeatWorkout(
  original: Workout,
  timeZone = browserTimeZone(),
): Workout {
  const w = makeWorkout([], [], timeZone);
  return {
    ...w,
    name: original.name,
    analysisVersion: ANALYSIS_VERSION,
    exercises: original.exercises.map((we) => ({
      ...structuredClone(we),
      sets: we.sets.map((s) => ({
        ...s,
        id: crypto.randomUUID(),
        done: false,
      })),
    })),
  };
}
export function buildBalancePlan(
  loads: MuscleLoad[],
  minutes: number,
  equipment: Equipment,
  excluded: Muscle[] = [],
  restSeconds = 90,
) {
  const remaining = Object.fromEntries(
    loads.map((m) => [m.id, Math.max(0, m.goal - m.direct)]),
  ) as Record<Muscle, number>;
  const pool = EXERCISES.filter(
    (e) =>
      (equipment === "gym" ||
        e.equipment === equipment ||
        e.equipment === "bodyweight") &&
      ![
        ...e.primary,
        ...e.secondary,
        ...e.muscles.map(
          (m) => ANATOMICAL_MUSCLES.find((x) => x.id === m.muscleId)!.zone,
        ),
      ].some((m) => excluded.includes(m)),
  );
  const picks: {
    exercise: Exercise;
    reason: string;
    gains: Partial<Record<Muscle, number>>;
  }[] = [];
  let seconds = 180;
  const exerciseSeconds = (e: Exercise) =>
    90 +
    3 * 10 * 3 * (e.recording.repsMode === "per_side" ? 2 : 1) +
    2 * restSeconds;
  while (picks.length < 6) {
    const candidates = pool
      .filter(
        (e) =>
          !picks.some((p) => p.exercise.familyId === e.familyId) &&
          seconds + exerciseSeconds(e) <= minutes * 60,
      )
      .map((e) => ({
        e,
        directScore: e.primary.reduce(
          (s, m) => s + Math.min(remaining[m], 3),
          0,
        ),
        tieScore: e.secondary.reduce(
          (s, m) => s + Math.min(remaining[m], 3),
          0,
        ),
      }))
      .sort((a, b) => b.directScore - a.directScore || b.tieScore - a.tieScore);
    const best = candidates[0];
    if (!best || best.directScore <= 0) break;
    const target = [...best.e.primary].sort(
      (a, b) => remaining[b] - remaining[a],
    )[0];
    const muscle = loads.find((m) => m.id === target)!;
    const gains: Partial<Record<Muscle, number>> = {};
    best.e.primary.forEach((m) => {
      gains[m] = 3;
      remaining[m] = Math.max(0, remaining[m] - 3);
    });
    picks.push({
      exercise: best.e,
      reason: `${muscle.short}: ${fmt(muscle.direct)} из ${muscle.goal} прямых подходов. Если выполнить план — ещё 3.`,
      gains,
    });
    seconds += exerciseSeconds(best.e);
  }
  const projected = loads.map((m) => {
    const direct =
      m.direct + picks.reduce((s, p) => s + (p.gains[m.id] ?? 0), 0);
    return { ...m, direct, total: direct, ratio: direct / m.goal };
  });
  return {
    picks,
    minutes: picks.length ? Math.ceil(seconds / 60) : 0,
    before: balanceScore(loads),
    after: balanceScore(projected),
    projected,
  };
}
export function demoWorkouts(now = new Date(), timeZone?: string): Workout[] {
  const start = weekStart(now, timeZone);
  const workouts: Workout[] = [];
  for (let week = 3; week >= 0; week--)
    for (let day = 0; day < 3; day++) {
      const date = addCalendarDays(start, -week * 7 + day * 2);
      if (date > localDate(now, timeZone)) continue;
      const ids =
        day === 0
          ? ["bench", "incline-db", "ohp", "triceps-push"]
          : day === 1
            ? ["lat-pulldown", "row", "curl", "facepull-er"]
            : ["squat", "legpress", "bench", "crunch"];
      const weights =
        day === 0
          ? [60 + (3 - week) * 2.5, 20, 16, 25]
          : day === 1
            ? [50, 45, 12, 15]
            : [60, 100, 60 + (3 - week) * 2.5, 0];
      workouts.push({
        id: `demo-${week}-${day}`,
        date,
        name: ["Грудь и плечи", "Спина и руки", "Ноги и грудь"][day],
        duration: [52, 48, 61][day],
        notes: "",
        analysisVersion: 2,
        exercises: ids.map((id, j) => ({
          ...entrySpec(id),
          ...(exerciseById(id)?.recording.loadMode === "machine_stack"
            ? { equipmentNote: "Демонстрационный тренажёр" }
            : {}),
          sets: Array.from({ length: 3 + (j === 0 ? 1 : 0) }, (_, k) => ({
            id: `s-${k}`,
            weight: weights[j],
            reps: 10 - (k % 2) * 2,
            rir: 2,
            warmup: false,
            done: true,
          })),
        })),
      });
    }
  return workouts.sort((a, b) => b.date.localeCompare(a.date));
}
