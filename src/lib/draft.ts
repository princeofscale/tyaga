import { WorkoutUndo, type WorkoutRemoval } from "../domain/WorkoutUndo";
import {
  exerciseForEntry,
  makeWorkout,
  type Workout,
  type WorkoutExercise,
} from "./model";
export type Draft = {
  removals?: WorkoutRemoval[];
  meetupId?: string;
  meetupGym?: string;
  workout: Workout;
  startedAt: number;
  editing: boolean;
  clock: { elapsedMs: number; runningSince: number | null };
  restFocus?: { exerciseId: string; setId: string };
  restUntil: number | null;
  pausedRest: number | null;
  manualDuration: boolean;
  /** Начата через «Записать тренировку»: в шапке видна дата записи (R07-REQ04). */
  retro?: boolean;
  restored?: boolean;
  /** R11-REQ02: окно (вкладка), которое сейчас пишет этот черновик, и момент, когда оно стало основным. Ставятся только при записи. */
  owner?: string;
  claim?: number;
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
/** Разрыв до 2 часов считаем обычной паузой в зале (экран погас, переключили приложение). */
const ACTIVE_GAP_LIMIT_MS = 2 * 60 * 60 * 1000;
/** Если тренировку забыли открытой дольше 2 часов — не накручиваем лишние часы. */
const ABANDONED_TAIL_MS = 60_000;

export function elapsedMs(draft: Draft, now = Date.now()) {
  if (draft.clock.runningSince === null) return draft.clock.elapsedMs;
  const gap = Math.max(0, now - draft.clock.runningSince);
  return (
    draft.clock.elapsedMs +
    (gap > ACTIVE_GAP_LIMIT_MS ? ABANDONED_TAIL_MS : gap)
  );
}
export function checkpointDraft(
  draft: Draft,
  now = Date.now(),
  pause = false,
): Draft {
  if (draft.clock.runningSince === null) return draft;
  const gap = Math.max(0, now - draft.clock.runningSince);
  const abandoned = gap > ACTIVE_GAP_LIMIT_MS;
  return {
    ...draft,
    clock: {
      elapsedMs:
        draft.clock.elapsedMs + (abandoned ? ABANDONED_TAIL_MS : gap),
      runningSince: pause || abandoned ? null : now,
    },
  };
}
export function parseDraft(text: string | null, mode: "restore" | "handoff" = "restore"): Draft | null {
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
      removals: Array.isArray(d.removals)
        ? d.removals
            .filter((value: unknown) => WorkoutUndo.valid(value))
            .slice(-10)
        : [],
      meetupGym:
        typeof d.meetupGym === "string" ? d.meetupGym.slice(0, 60) : undefined,
      meetupId:
        typeof d.meetupId === "string" && d.meetupId.length <= 80
          ? d.meetupId
          : undefined,
      clock: {
        elapsedMs: clockValid ? d.clock.elapsedMs : 0,
        runningSince: mode === "handoff" && clockValid && Number.isFinite(d.clock.runningSince) ? d.clock.runningSince : null,
      },
      restFocus:
        d.restFocus &&
        typeof d.restFocus.exerciseId === "string" &&
        typeof d.restFocus.setId === "string"
          ? { exerciseId: d.restFocus.exerciseId, setId: d.restFocus.setId }
          : undefined,
      restUntil: Number.isFinite(d.restUntil) ? d.restUntil : null,
      pausedRest: Number.isFinite(d.pausedRest) ? d.pausedRest : null,
      manualDuration: d.editing || !!d.manualDuration,
      retro: d.retro === true ? true : undefined,
      owner: typeof d.owner === "string" && d.owner.length <= 80 ? d.owner : undefined,
      claim: Number.isFinite(d.claim) ? d.claim : undefined,
      restored: mode === "restore" || d.restored === true ? true : undefined,
    };
  } catch {
    return null;
  }
}
/** id тренировки в сохранённом черновике; null, если записи нет или она не читается. */
export function storedDraftId(raw: string | null): string | null {
  const draft = parseDraft(raw);
  return draft ? draft.workout.id : null;
}
type DraftStore = Pick<Storage, "getItem" | "removeItem">;
export type DraftRecord = { id: string; startedAt: number; owner?: string; claim?: number };

export function draftRecord(draft: Draft): DraftRecord {
  return { id: draft.workout.id, startedAt: draft.startedAt, owner: draft.owner, claim: draft.claim };
}

export function matchesDraft(draft: Draft, record: DraftRecord): boolean {
  return draft.workout.id === record.id && draft.startedAt === record.startedAt;
}

export function matchesDraftRecord(draft: Draft, record: DraftRecord): boolean {
  return matchesDraft(draft, record) && draft.owner === record.owner && draft.claim === record.claim;
}

/** Do not remove another editing attempt or a newer claim, even if the workout ID matches. */
export function removeDraftRecord(getStorage: () => DraftStore, key: string, record: DraftRecord): "removed" | "changed" | "failed" {
  try {
    const storage = getStorage();
    const raw = storage.getItem(key);
    const stored = parseDraft(raw);
    if (!stored || !matchesDraftRecord(stored, record)) return "changed";
    storage.removeItem(key);
    return "removed";
  } catch {
    return "failed";
  }
}

/**
 * Сохраняет черновик или убирает его ключ. `ownId` — тренировка, которую эта вкладка вела до сих пор:
 * ключ общий для всех вкладок, и устаревшая вкладка не должна стирать черновик другой тренировки, начатой в соседней (R09-QA-08).
 */
export function persistDraft(
  storage: Pick<Storage, "setItem" | "removeItem"> & Partial<Pick<Storage, "getItem">>,
  draft: Draft | null,
  key = DRAFT_KEY,
  ownId: string | null = null,
  owner?: string,
): PersistenceStatus {
  try {
    if (draft) storage.setItem(key, JSON.stringify(draft));
    else {
      const stored = ownId && storage.getItem ? parseDraft(storage.getItem(key)) : null;
      if (!stored || (stored.workout.id === ownId && (!owner || !stored.owner || stored.owner === owner))) storage.removeItem(key);
    }
    return "saved";
  } catch {
    return "failed";
  }
}
export function readDraft(key = DRAFT_KEY): Draft | null {
  try {
    return parseDraft(localStorage.getItem(key));
  } catch {
    return null;
  }
}
