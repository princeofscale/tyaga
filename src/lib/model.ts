import {
  TrainingAnalytics,
  type AnalysisOptions,
} from "../domain/TrainingAnalytics";
import { MUSCLES, ANATOMICAL_MUSCLES } from "../data/muscles";
import {
  EXERCISES,
  exerciseById,
  exerciseForEntry,
  entrySpec,
  progressKey,
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
} from "./types";
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
  return new TrainingAnalytics(workouts, options).zoneLoad(settings);
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
export function volumeSummary(workouts: Workout[]) {
  let total = 0,
    omittedSets = 0;
  for (const w of workouts)
    for (const we of w.exercises) {
      const spec = exerciseForEntry(we)?.recording;
      for (const s of we.sets)
        if (s.done && !s.warmup) {
          if (
            !spec ||
            spec.type === "duration" ||
            !["total_external", "per_implement"].includes(spec.loadMode)
          ) {
            omittedSets++;
            continue;
          }
          const sides =
            spec.repsMode === "per_side" &&
            (we.performedSides ?? "both") === "both"
              ? 2
              : 1;
          total += s.weight * s.reps * spec.implementCount * sides;
        }
    }
  return { total, omittedSets };
}
export const volume = (workouts: Workout[]) => volumeSummary(workouts).total;
export const workingSets = (workouts: Workout[]) =>
  workouts.reduce(
    (s, w) =>
      s +
      w.exercises.reduce(
        (n, e) => n + e.sets.filter((x) => x.done && !x.warmup).length,
        0,
      ),
    0,
  );
export function estimatedOneRepMax(set: SetEntry, we: WorkoutExercise) {
  const spec = exerciseForEntry(we)?.recording;
  if (
    !spec?.e1rmEligible ||
    spec.type === "duration" ||
    !set.done ||
    set.warmup ||
    set.weight <= 0 ||
    set.reps < 1 ||
    set.reps > 12
  )
    return null;
  return set.reps === 1 ? set.weight : set.weight * (1 + set.reps / 30);
}
export function makeSets(count = 3, weight = 0, reps = 10): SetEntry[] {
  return Array.from({ length: count }, () => ({
    id: crypto.randomUUID(),
    weight,
    reps,
    rir: 2,
    warmup: false,
    done: false,
  }));
}
export function makeExerciseEntry(
  id: string,
  history: Workout[] = [],
): WorkoutExercise {
  const entry: WorkoutExercise = { ...entrySpec(id), sets: makeSets() };
  const e = exerciseById(id)!;
  if (e.recording.type === "duration")
    entry.sets = makeSets(3, 0, 1).map((s) => ({
      ...s,
      rir: null,
      durationSeconds: 30,
    }));
  const last = [...history]
    .sort(
      (a, b) =>
        b.date.localeCompare(a.date) ||
        (b.createdAt ?? "").localeCompare(a.createdAt ?? "") ||
        b.id.localeCompare(a.id),
    )
    .flatMap((w) => w.exercises)
    .find((we) => progressKey(we) === progressKey(entry));
  const previous = last?.sets.filter((s) => s.done && !s.warmup).at(-1);
  if (previous)
    entry.sets = makeSets(3, previous.weight, previous.reps).map((s) => ({
      ...s,
      ...(e.recording.type === "duration"
        ? { rir: null, durationSeconds: previous.durationSeconds ?? 30 }
        : {}),
      ...(e.recording.loadMode === "assisted_bodyweight"
        ? { assistanceKg: previous.assistanceKg ?? 0 }
        : {}),
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
): Workout {
  return {
    id: crypto.randomUUID(),
    name: "Новая тренировка",
    date: localDate(new Date(), timeZone),
    duration: 0,
    notes: "",
    exercises: ids.map((id) => makeExerciseEntry(id, history)),
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
    analysisVersion: original.analysisVersion ?? 1,
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
