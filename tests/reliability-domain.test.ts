import test from "node:test";
import assert from "node:assert/strict";
import { BodyMass } from "../src/domain/BodyMass";
import { JournalBackup } from "../src/domain/JournalBackup";
import { WorkoutImport } from "../src/domain/WorkoutImport";
import {
  TeamChallengeProgress,
  type ChallengeParticipant,
} from "../src/domain/TeamChallenge";
import { RestTimerAction } from "../src/domain/RestTimerAction";
import {
  RestTimerService,
  type RestTimerBridge,
  type RestTimerCommand,
} from "../src/services/RestTimerService";
import { DEFAULT_SETTINGS, makeWorkout } from "../src/lib/model";
import { newDraft } from "../src/lib/draft";
const entries = [
  { id: "old", date: "2026-11-01", weightKg: 70, createdAt: 1, note: "" },
  { id: "new", date: "2026-11-10", weightKg: 72, createdAt: 2, note: "" },
];
test("new workout mass follows the date while a saved/repeated source retains its snapshot", () => {
  assert.equal(BodyMass.at(entries, "2026-11-05", 65), 70);
  assert.equal(BodyMass.at(entries, "2026-10-01", null), null);
  const old = makeWorkout(["pullup"], [], "UTC");
  old.exercises[0].bodyMassKg = 65;
  const next = BodyMass.workout(old, BodyMass.at(entries, "2026-11-11", null));
  assert.equal(next.exercises[0].bodyMassKg, 72);
  assert.equal(old.exercises[0].bodyMassKg, 65);
});
test("complete backup roundtrips journal metadata, weight, goal and preferences without credentials", () => {
  const workout = makeWorkout(["bench"], [], "UTC");
  workout.exercises[0].sets[0].done = true;
  const backup = JournalBackup.create(
    [workout],
    DEFAULT_SETTINGS,
    { routines: [], customExercises: [], favorites: ["bench"] },
    { entries, goal: { targetWeightKg: 75, startWeightKg: 70 } },
    "lime",
    { displayName: "Атлет", timeZone: "UTC", bodyMassKg: 72 },
  );
  const restored = new WorkoutImport({
    dateOrder: "dmy",
    weightUnit: "kg",
    distanceUnit: "km",
    timeZone: "UTC",
  }).parse(JSON.stringify(backup), "tyaga");
  assert.equal(restored.workouts[0].nativeId, workout.id);
  assert.deepEqual(restored.extras?.bodyweight?.entries, entries);
  assert.equal(restored.extras?.bodyweight?.goal.targetWeightKg, 75);
  assert.equal(restored.extras?.favorites[0], "bench");
  assert.equal(restored.extras?.profile?.bodyMassKg, 72);
  assert.equal(restored.extras?.theme, "lime");
  assert.ok(!JSON.stringify(backup).match(/password|token|email|session/i));
  assert.throws(
    () =>
      JournalBackup.weights({
        entries: [...entries, entries[0]],
        goal: backup.bodyweight.goal,
      }),
    /повторяются/,
  );
  assert.throws(() =>
    JournalBackup.weights({
      entries: [{ ...entries[0], date: "2026-02-31" }],
      goal: backup.bodyweight.goal,
    }),
  );
  assert.throws(() =>
    JournalBackup.profile({
      displayName: "A",
      timeZone: "bad-zone",
      bodyMassKg: 70,
    }),
  );
});
test("restoring weight previews conflicts and keeps current measurements unless replacement is selected", () => {
  const changed = { ...entries[0], weightKg: 71 };
  const plan = JournalBackup.merge([changed], [...entries]);
  assert.equal(plan.added, 1);
  assert.deepEqual(plan.conflictDates, ["2026-11-01"]);
  assert.equal(plan.entries[0].weightKg, 71);
  assert.equal(
    JournalBackup.merge([changed], entries, true).entries[0].weightKg,
    70,
  );
  assert.equal(
    JournalBackup.merge(entries, [
      ...entries.map((e) => ({ ...e, id: "other-id" })),
    ]).same,
    2,
  );
});
test("four-week goals are capped individually, respect boundaries and do not join streaks across athletes", () => {
  const weeks = TeamChallengeProgress.weeks("2026-11-02", "2026-11-30", 1, [
    { date: "2026-11-01", n: 9 },
    { date: "2026-11-02", n: 3 },
    { date: "2026-11-09", n: 1 },
    { date: "2026-11-16", n: 1 },
    { date: "2026-11-23", n: 1 },
    { date: "2026-11-30", n: 10 },
  ]);
  const p: ChallengeParticipant = {
    id: "a",
    displayName: "<script>&",
    response: "accepted",
    target: 1,
    weeks,
  };
  const summary = TeamChallengeProgress.summary([p, { ...p, id: "b" }]);
  assert.equal(summary.done, 8);
  assert.equal(summary.target, 8);
  assert.equal(summary.bestStreak, 4);
  assert.equal(summary.fulfilled, 8);
  const future = TeamChallengeProgress.weeks("2026-11-02", "2026-11-10", 2, [
    { date: "2026-11-16", n: 9 },
  ]);
  assert.equal(future[2].count, 0);
  assert.equal(future[2].phase, "future");
  const card = TeamChallengeProgress.card(
    {
      id: "c",
      name: "<unsafe>",
      hostId: "a",
      startDate: "2026-11-02",
      endDate: "2026-11-29",
      today: "2026-11-30",
      cancelled: false,
      myResponse: "accepted",
      participants: [p],
    },
    p,
  );
  assert.ok(card.includes("&lt;unsafe&gt;"));
  assert.ok(!card.includes("<script>"));
});
test("notification actions resume the matching draft only, retaining all logged values", () => {
  const draft = newDraft(makeWorkout(["bench"], [], "UTC"));
  draft.restUntil = 100;
  const action = {
    id: "action",
    type: "extend" as const,
    accountId: "a",
    workoutId: draft.workout.id,
    until: 999,
    exerciseId: "bench",
    setId: draft.workout.exercises[0].sets[1].id,
  };
  assert.equal(RestTimerAction.apply(draft, "b", action), draft);
  assert.equal(
    RestTimerAction.apply({ ...draft, pausedRest: 60 }, "a", action)
      ?.pausedRest,
    60,
  );
  assert.equal(
    RestTimerAction.apply(draft, "a", { ...action, workoutId: "other" }),
    draft,
  );
  const next = RestTimerAction.apply(draft, "a", action)!;
  assert.equal(next.restUntil, 999);
  assert.deepEqual(next.workout, draft.workout);
  assert.equal(next.restFocus?.setId, action.setId);
});
test("rapid timer changes serialize an in-flight schedule and finish with cancellation", async () => {
  const commands: RestTimerCommand[] = [];
  let release: () => void = () => {};
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  const native = {
    sync: async (c: RestTimerCommand) => {
      commands.push(c);
      if (commands.length === 1) await barrier;
    },
  } as unknown as RestTimerBridge;
  const service = new RestTimerService(native, () => true);
  const first = service.sync({ accountId: "a", workoutId: "w", until: 100 });
  await Promise.resolve();
  const second = service.sync({ accountId: "a", workoutId: "w", until: 200 });
  const cancel = service.sync({ accountId: "a", workoutId: "w", until: null });
  release();
  await Promise.all([first, second, cancel]);
  assert.deepEqual(
    commands.map((c) => c.until),
    [100, null],
  );
});
