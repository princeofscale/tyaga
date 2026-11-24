import test from "node:test";
import assert from "node:assert/strict";
import { WorkoutFlow } from "../src/domain/WorkoutFlow";
import { WorkoutUndo } from "../src/domain/WorkoutUndo";
import { newDraft } from "../src/lib/draft";
import type { SetEntry, WorkoutExercise } from "../src/lib/types";

function makeSet(id: string, overrides: Partial<Omit<SetEntry, "id">> = {}): SetEntry {
  return { id, weight: 50, reps: 8, rir: null, warmup: false, done: false, ...overrides };
}

function makeDraft(exercises: WorkoutExercise[]) {
  return newDraft({ id: "draft", name: "Workout", date: "2026-11-23", duration: 0, notes: "", exercises }, false, 0);
}

test("workout flow keeps stored order and numbers warmup and working sets separately", () => {
  const bench = {
    exerciseId: "bench",
    sets: [makeSet("a"), makeSet("b", { warmup: true }), makeSet("c"), makeSet("d", { warmup: true })],
  };
  const squat = {
    exerciseId: "squat",
    sets: [makeSet("e", { warmup: true }), makeSet("f")],
  };
  const flow = new WorkoutFlow([bench, squat]);
  assert.deepEqual(flow.positions.map(({ set, exerciseIndex, setIndex, number, count }) =>
    [set.id, exerciseIndex, setIndex, number, count]), [
    ["a", 0, 0, 1, 2],
    ["b", 0, 1, 1, 2],
    ["c", 0, 2, 2, 2],
    ["d", 0, 3, 2, 2],
    ["e", 1, 0, 1, 1],
    ["f", 1, 1, 1, 1],
  ]);
  assert.equal(flow.groups[0].entry, bench);
  assert.equal(flow.groups[1].positions[0], flow.positions[4]);
  assert.equal(flow.positions[4].entry, squat);
  assert.equal(flow.positions[4].set, squat.sets[0]);
});

test("after prefers forward unfinished rows across exercises, then wraps to a skipped row", () => {
  const flow = new WorkoutFlow([
    { exerciseId: "bench", sets: [makeSet("skipped"), makeSet("bench-done", { done: true })] },
    {
      exerciseId: "squat",
      sets: [makeSet("warmup", { warmup: true }), makeSet("squat-done", { done: true }), makeSet("working")],
    },
    { exerciseId: "row", sets: [makeSet("row-done", { done: true })] },
  ]);
  assert.deepEqual(flow.after("bench-done"), { position: flow.groups[1].positions[0], wrapped: false });
  assert.deepEqual(flow.after("warmup"), { position: flow.groups[1].positions[2], wrapped: false });
  assert.deepEqual(flow.after("working"), { position: flow.groups[0].positions[0], wrapped: true });
  assert.equal(flow.after("missing"), undefined);
});

test("after never returns the current row and is absent when all rows are done", () => {
  const first = makeSet("first", { done: true });
  const middle = makeSet("middle", { warmup: true });
  const last = makeSet("last", { done: true });
  const flow = new WorkoutFlow([{ exerciseId: "bench", sets: [first, middle, last] }]);
  assert.equal(flow.after("middle"), undefined);
  assert.equal(new WorkoutFlow([{ exerciseId: "bench", sets: [first, { ...middle, done: true }, last] }]).after("first"), undefined);
  assert.equal(new WorkoutFlow([]).after("first"), undefined);
});

test("current keeps explicit selections; workout and exercise fallbacks differ when complete", () => {
  const bench = {
    exerciseId: "bench",
    sets: [makeSet("first", { done: true }), makeSet("unfinished", { warmup: true })],
  };
  const squat = {
    exerciseId: "squat",
    sets: [makeSet("squat-first", { done: true }), makeSet("last", { done: true })],
  };
  const flow = new WorkoutFlow([bench, squat, { exerciseId: "row", sets: [] }]);
  assert.equal(flow.current("first")?.set.id, "first");
  assert.equal(flow.current(null)?.set.id, "unfinished");
  assert.equal(flow.current("stale")?.set.id, "unfinished");
  assert.equal(flow.forExercise(0)?.set.id, "unfinished");
  assert.equal(flow.forExercise(1)?.set.id, "squat-first");
  assert.equal(flow.forExercise(2), undefined);
  assert.equal(flow.forExercise(3), undefined);
  const complete = new WorkoutFlow([squat]);
  assert.equal(complete.current(null)?.set.id, "last");
  assert.equal(complete.current("stale")?.set.id, "last");
  assert.equal(complete.current("squat-first")?.set.id, "squat-first");
  assert.equal(new WorkoutFlow([]).current(null), undefined);
});

test("working progress counts draft flags even when numbers are not eligible for analytics", () => {
  const flow = new WorkoutFlow([
    {
      exerciseId: "bench",
      sets: [
        makeSet("no-reps", { done: true, reps: 0 }),
        makeSet("pending"),
        makeSet("high-weight", { done: true, weight: 1200 }),
        makeSet("warmup-done", { warmup: true, done: true }),
      ],
    },
    { exerciseId: "squat", sets: [makeSet("drop", { done: true, kind: "dropset" })] },
    { exerciseId: "row", sets: [makeSet("warmup-only", { warmup: true })] },
  ]);
  assert.deepEqual(flow.groups.map(({ workingDone, workingTotal }) => [workingDone, workingTotal]), [[2, 3], [1, 1], [0, 0]]);
  assert.equal(flow.workingDone, 3);
  assert.equal(flow.workingTotal, 4);
});

test("targeted undo restores a cloned middle set at its index without reverting later edits", () => {
  const first = makeSet("first");
  const middle = makeSet("middle", { warmup: true, done: true, execution: { grip: "wide" } });
  const last = makeSet("last");
  const bench = { exerciseId: "bench", sets: [first, middle, last] };
  const squat = { exerciseId: "squat", sets: [makeSet("squat-first")] };
  const draft = makeDraft([bench, squat]);
  const deleted = WorkoutUndo.set(draft, 0, 1);
  assert.deepEqual(deleted.workout.exercises[0].sets, [first, last]);
  assert.deepEqual(draft.workout.exercises[0].sets, [first, middle, last]);
  const removal = deleted.removals?.at(-1);
  assert.ok(removal?.kind === "set");
  assert.equal(removal.index, 1);
  assert.deepEqual(removal.set, middle);
  assert.notEqual(removal.set, middle);
  assert.notEqual(removal.set.execution, middle.execution);

  const updatedFirst = { ...first, weight: 72.5, done: true };
  const added = makeSet("added");
  const edited = {
    ...deleted,
    workout: {
      ...deleted.workout,
      notes: "Edited after removing the set",
      exercises: [squat, { ...bench, sets: [updatedFirst, last, added] }],
    },
  };
  const restored = WorkoutUndo.restore(edited);
  assert.equal(restored.workout.notes, edited.workout.notes);
  assert.equal(restored.workout.exercises[0], squat);
  assert.deepEqual(restored.workout.exercises[1].sets, [updatedFirst, middle, last, added]);
  assert.notEqual(restored.workout.exercises[1].sets[1], removal.set);
  assert.deepEqual(restored.removals, []);
});

test("set removal defaults to last, rejects invalid indices, and keeps at least one row", () => {
  const first = makeSet("first");
  const last = makeSet("last");
  const draft = makeDraft([{ exerciseId: "bench", sets: [first, last] }]);
  for (const index of [-1, 0.5, 2, NaN, Infinity]) {
    assert.equal(WorkoutUndo.set(draft, 0, index), draft);
  }
  assert.equal(WorkoutUndo.set(draft, 0.5, 0), draft);
  assert.equal(WorkoutUndo.set(draft, 1, 0), draft);
  const withoutFirst = WorkoutUndo.set(draft, 0, 0);
  assert.deepEqual(withoutFirst.workout.exercises[0].sets, [last]);
  const withoutLast = WorkoutUndo.set(draft, 0);
  assert.deepEqual(withoutLast.workout.exercises[0].sets, [first]);
  assert.equal(withoutLast.removals?.at(-1)?.index, 1);
  assert.equal(WorkoutUndo.set(withoutLast, 0, 0), withoutLast);
  assert.equal(WorkoutUndo.set(withoutLast, 0), withoutLast);
});
