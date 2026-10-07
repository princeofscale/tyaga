import {
  exerciseForEntry,
  makeWorkout,
  type Workout,
  type WorkoutExercise,
} from "./model";
export type Draft = {
  workout: Workout;
  startedAt: number;
  editing: boolean;
  clock: { elapsedMs: number; runningSince: number | null };
  restUntil: number | null;
  pausedRest: number | null;
  manualDuration: boolean;
  restored?: boolean;
};
export type PersistenceStatus = "saved" | "failed" | "pending";
export const DRAFT_KEY = "tyaga-draft-v1";
export function newDraft(
  workout = makeWorkout(),
  editing = false,
  now = Date.now(),
): Draft {
  return {
    workout,
    startedAt: now,
    editing,
    clock: { elapsedMs: 0, runningSince: editing ? null : now },
    restUntil: null,
    pausedRest: null,
    manualDuration: editing,
  };
}
export function elapsedMs(draft: Draft, now = Date.now()) {
  return (
    draft.clock.elapsedMs +
    (draft.clock.runningSince === null
      ? 0
      : Math.max(0, Math.min(now - draft.clock.runningSince, 60000)))
  );
}
export function checkpointDraft(
  draft: Draft,
  now = Date.now(),
  pause = false,
): Draft {
  if (draft.clock.runningSince === null) return draft;
  const gap = now - draft.clock.runningSince;
  return {
    ...draft,
    clock: {
      elapsedMs: elapsedMs(draft, now),
      runningSince: pause || gap > 60000 ? null : now,
    },
  };
}
export function parseDraft(text: string | null): Draft | null {
  try {
    const d = JSON.parse(text ?? "null");
    if (
      !d?.workout ||
      !Array.isArray(d.workout.exercises) ||
      d.workout.exercises.length > 30 ||
      typeof d.workout.id !== "string" ||
      typeof d.workout.name !== "string" ||
      typeof d.workout.date !== "string" ||
      typeof d.workout.notes !== "string" ||
      !Number.isFinite(d.workout.duration) ||
      !Number.isFinite(d.startedAt) ||
      typeof d.editing !== "boolean"
    )
      return null;
    if (
      d.workout.exercises.some((e: WorkoutExercise) => {
        const exercise = e && exerciseForEntry(e);
        return (
          !exercise ||
          (e.catalogRevision !== undefined &&
            exercise.catalogRevision !== e.catalogRevision) ||
          !Array.isArray(e.sets) ||
          e.sets.length < 1 ||
          e.sets.length > 30 ||
          e.sets.some(
            (s) =>
              !s ||
              typeof s.id !== "string" ||
              !Number.isFinite(s.weight) ||
              !Number.isFinite(s.reps) ||
              (s.rir !== null && !Number.isFinite(s.rir)) ||
              typeof s.done !== "boolean" ||
              typeof s.warmup !== "boolean",
          )
        );
      })
    )
      return null;
    const clockValid =
      d.clock && Number.isFinite(d.clock.elapsedMs) && d.clock.elapsedMs >= 0;
    return {
      ...d,
      clock: {
        elapsedMs: clockValid ? d.clock.elapsedMs : 0,
        runningSince: null,
      },
      restUntil: Number.isFinite(d.restUntil) ? d.restUntil : null,
      pausedRest: Number.isFinite(d.pausedRest) ? d.pausedRest : null,
      manualDuration: d.editing || !!d.manualDuration,
      restored: true,
    };
  } catch {
    return null;
  }
}
export function persistDraft(
  storage: Pick<Storage, "setItem" | "removeItem">,
  draft: Draft | null,
): PersistenceStatus {
  try {
    if (draft) storage.setItem(DRAFT_KEY, JSON.stringify(draft));
    else storage.removeItem(DRAFT_KEY);
    return "saved";
  } catch {
    return "failed";
  }
}
export function readDraft(): Draft | null {
  try {
    return parseDraft(localStorage.getItem(DRAFT_KEY));
  } catch {
    return null;
  }
}
