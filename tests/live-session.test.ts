import test from "node:test";
import assert from "node:assert/strict";
import { makeWorkout } from "../src/lib/model";
import type { Workout, WorkoutExercise } from "../src/lib/model";
import type { LiveState } from "../src/lib/social";
import {
  InviteLink,
  LIVE_HEARTBEAT_MS,
  LivePresenter,
  LivePushPolicy,
  LiveStateBuilder,
  RoomCode,
  StandingsBoard,
  WorkoutTally,
} from "../src/domain/LiveSession";

const nameOf = (entry: WorkoutExercise) => entry.displayNameSnapshot ?? entry.exerciseId;
const NOW = Date.parse("2026-11-11T10:00:00Z");

/** Тренировка из двух упражнений: у каждого три рабочих подхода по 60 кг × 10. */
function twoLifts(): Workout {
  const w = makeWorkout(["bench", "squat"], [], "UTC");
  for (const e of w.exercises)
    for (const s of e.sets) {
      s.weight = 60;
      s.reps = 10;
    }
  return w;
}
const finish = (w: Workout, exercise: number, count: number) => {
  for (const s of w.exercises[exercise].sets.slice(0, count)) s.done = true;
};

test("live state: a workout with nothing logged yet is idle and names no exercise", () => {
  const empty = makeWorkout([], [], "UTC");
  const state = LiveStateBuilder.fromWorkout(empty, { now: NOW, nameOf });
  assert.equal(state.phase, "idle");
  assert.equal(state.exercise, null);
  assert.equal(state.setsTotal, 0);
  assert.equal(state.setsDone, 0);
  assert.equal(state.lastSet, null);
});

test("live state: warm-up sets are not counted, working sets and tonnage are", () => {
  const w = twoLifts();
  w.exercises[0].sets[0].warmup = true;
  w.exercises[0].sets[0].done = true; // разминка выполнена, но в счёт не идёт
  w.exercises[0].sets[1].done = true;
  w.exercises[0].sets[2].done = true;
  const state = LiveStateBuilder.fromWorkout(w, { now: NOW, nameOf });
  assert.equal(state.setsDone, 2);
  assert.equal(state.setsTotal, 5); // 2 рабочих в первом + 3 во втором
  assert.equal(state.tonnageKg, 1200); // 2 × 60 × 10
  assert.equal(state.phase, "lifting");
});

test("live state: the current exercise is the first one that still has a working set to do", () => {
  const w = twoLifts();
  w.exercises[0].displayNameSnapshot = "Жим штанги лёжа";
  w.exercises[1].displayNameSnapshot = "Приседания";
  finish(w, 0, 3);
  assert.equal(LiveStateBuilder.fromWorkout(w, { now: NOW, nameOf }).exercise, "Приседания");
  finish(w, 1, 3);
  // всё сделано: остаётся последнее упражнение, а не пустота
  assert.equal(LiveStateBuilder.fromWorkout(w, { now: NOW, nameOf }).exercise, "Приседания");
});

test("live state: the last set is the latest done working set", () => {
  const w = twoLifts();
  w.exercises[0].sets[0].done = true;
  w.exercises[0].sets[1].done = true;
  w.exercises[0].sets[1].weight = 82.5;
  w.exercises[0].sets[1].reps = 8;
  const state = LiveStateBuilder.fromWorkout(w, { now: NOW, nameOf });
  assert.deepEqual(state.lastSet, { kg: 82.5, reps: 8 });
});

test("live state: a running rest timer makes the phase resting, an expired one does not", () => {
  const w = twoLifts();
  finish(w, 0, 1);
  const resting = LiveStateBuilder.fromWorkout(w, { now: NOW, nameOf, restEndsAt: NOW + 45_000 });
  assert.equal(resting.phase, "resting");
  assert.equal(resting.restEndsAt, new Date(NOW + 45_000).toISOString());
  const expired = LiveStateBuilder.fromWorkout(w, { now: NOW, nameOf, restEndsAt: NOW - 1_000 });
  assert.equal(expired.phase, "lifting");
  assert.equal(expired.restEndsAt, null);
});

test("live state: finished wins over everything else and drops the rest timer", () => {
  const w = twoLifts();
  finish(w, 0, 3);
  const state = LiveStateBuilder.fromWorkout(w, { now: NOW, nameOf, restEndsAt: NOW + 30_000, finished: true });
  assert.equal(state.phase, "done");
  assert.equal(state.restEndsAt, null);
});

test("room code: normalized input is upper-case without separators", () => {
  assert.equal(RoomCode.normalize(" k7-m2q "), "K7M2Q");
  assert.equal(RoomCode.normalize("h7 kq2"), "H7KQ2");
  assert.equal(RoomCode.normalize(""), "");
});

test("room code: only five characters from the unambiguous alphabet are valid", () => {
  assert.ok(RoomCode.isValid("H7KQ2"));
  for (const bad of ["H7KQ", "H7KQ22", "H7KQ0", "H7KQO", "H7KQI", "H7KQ1", "H7KQL", "h7kq2", "H7K Q", ""])
    assert.ok(!RoomCode.isValid(bad), bad);
});

test("room code: generated codes are valid and use rejection sampling instead of modulo bias", () => {
  const bytes = (values: number[]) => {
    let i = 0;
    return (n: number) => Uint8Array.from({ length: n }, () => values[i++ % values.length]);
  };
  // 255 и 250 лежат в «хвосте» (≥ 248) и отбрасываются, остальные байты берутся по модулю 31
  assert.equal(RoomCode.generate(bytes([255, 250, 0, 1, 2, 3, 4])), "ABCDE");
  for (let i = 0; i < 300; i++) assert.ok(RoomCode.isValid(RoomCode.generate()));
});

test("standings: ranked by tonnage, ties broken by sessions, shares are relative to the leader", () => {
  const board = StandingsBoard.rank([
    { tag: "c", displayName: "Вера", isMe: false, sessions: 1, sets: 5, tonnageKg: 2000 },
    { tag: "a", displayName: "Аня", isMe: true, sessions: 2, sets: 9, tonnageKg: 4000 },
    { tag: "b", displayName: "Боря", isMe: false, sessions: 3, sets: 9, tonnageKg: 2000 },
    { tag: "d", displayName: "Дима", isMe: false, sessions: 0, sets: 0, tonnageKg: 0 },
  ]);
  assert.deepEqual(board.map((r) => r.tag), ["a", "b", "c", "d"]);
  assert.deepEqual(board.map((r) => r.rank), [1, 2, 3, 4]);
  assert.deepEqual(board.map((r) => r.share), [1, 0.5, 0.5, 0]);
  assert.equal(board[0].leader, true);
  assert.equal(board[1].leader, false);
});

test("standings: nobody has trained yet — no leader and no NaN shares", () => {
  const board = StandingsBoard.rank([
    { tag: "a", displayName: "Аня", isMe: true, sessions: 0, sets: 0, tonnageKg: 0 },
    { tag: "b", displayName: "Боря", isMe: false, sessions: 0, sets: 0, tonnageKg: 0 },
  ]);
  assert.deepEqual(board.map((r) => r.share), [0, 0]);
  assert.ok(board.every((r) => !r.leader));
  assert.deepEqual(StandingsBoard.rank([]), []);
});

test("invite link: built from the site origin and a normalized tag", () => {
  assert.equal(InviteLink.build("https://tyaga.example", "@Ivan_Power"), "https://tyaga.example/?p=ivan_power");
});

test("invite link: only a valid tag is taken from the address, other parameters are ignored", () => {
  assert.equal(InviteLink.parse("?p=Ivan_Power"), "ivan_power");
  assert.equal(InviteLink.parse("?utm=1&p=anna_k"), "anna_k");
  assert.equal(InviteLink.parse("?p=ab"), null);
  assert.equal(InviteLink.parse("?p=has space"), null);
  assert.equal(InviteLink.parse("?x=1"), null);
  assert.equal(InviteLink.parse(""), null);
});

test("invite link: a room link carries the code and tolerates typing noise", () => {
  assert.equal(InviteLink.buildRoom("https://tyaga.example", "h7kq2"), "https://tyaga.example/?r=H7KQ2");
  assert.equal(InviteLink.parseRoom("?r=h7-kq2"), "H7KQ2");
  assert.equal(InviteLink.parseRoom("?utm=1&r=H7KQ2"), "H7KQ2");
  assert.equal(InviteLink.parseRoom("?r=H7KQ0"), null);
  assert.equal(InviteLink.parseRoom("?p=ivan_power"), null);
  assert.equal(InviteLink.parseRoom(""), null);
});

test("invite link: stripping removes only the invitation parameters", () => {
  assert.equal(InviteLink.strip("?p=ivan_power"), "");
  assert.equal(InviteLink.strip("?r=H7KQ2&utm=1"), "?utm=1");
  assert.equal(InviteLink.strip("?utm=1&p=anna_k&r=H7KQ2&x=2"), "?utm=1&x=2");
  assert.equal(InviteLink.strip(""), "");
});

const lifting = (over: Partial<LiveState> = {}): LiveState => ({
  phase: "lifting",
  exercise: "Присед",
  setsDone: 1,
  setsTotal: 3,
  tonnageKg: 600,
  lastSet: { kg: 60, reps: 10 },
  restEndsAt: null,
  ...over,
});
const iso = (ms: number) => new Date(ms).toISOString();
const seen = (state: LiveState | null, updatedAt = iso(NOW)) => ({ state, updatedAt });

test("push policy: the first state and every change go out, an unchanged one only as a heartbeat", () => {
  const sent = LivePushPolicy.mark(lifting(), NOW);
  assert.ok(LivePushPolicy.due(null, lifting(), NOW));
  assert.ok(!LivePushPolicy.due(sent, lifting(), NOW + 10_000));
  assert.ok(!LivePushPolicy.due(sent, lifting(), NOW + LIVE_HEARTBEAT_MS - 1));
  assert.ok(LivePushPolicy.due(sent, lifting(), NOW + LIVE_HEARTBEAT_MS));
  assert.ok(LivePushPolicy.due(sent, lifting({ setsDone: 2 }), NOW + 1));
  assert.ok(LivePushPolicy.due(sent, lifting({ restEndsAt: iso(NOW + 60_000) }), NOW + 1));
  assert.ok(LivePushPolicy.due(sent, lifting({ phase: "done" }), NOW + 1));
});

test("presenter: a partner's line says what they do right now", () => {
  assert.equal(LivePresenter.headline(seen(null), NOW), "Ждёт старта");
  assert.equal(
    LivePresenter.headline(seen(lifting({ phase: "idle", exercise: "Жим лёжа", setsDone: 0 })), NOW),
    "Готовится · Жим лёжа",
  );
  assert.equal(
    LivePresenter.headline(seen(lifting({ phase: "idle", exercise: null, setsDone: 0, setsTotal: 0 })), NOW),
    "Готовится",
  );
  assert.equal(LivePresenter.headline(seen(lifting()), NOW), "Присед · 1/3");
  assert.equal(
    LivePresenter.headline(seen(lifting({ phase: "resting", restEndsAt: iso(NOW + 42_000) })), NOW),
    "Отдых 0:42 · 1/3",
  );
  assert.equal(LivePresenter.headline(seen(lifting({ phase: "done", tonnageKg: 12_400, setsDone: 3 })), NOW), "Закончил · 12,4 т");
});

test("presenter: a finished rest timer turns back into a set count without a new push", () => {
  const over = lifting({ phase: "resting", restEndsAt: iso(NOW - 1_000) });
  assert.equal(LivePresenter.headline(seen(over), NOW), "Присед · 1/3");
  assert.equal(LivePresenter.restLeft(over, NOW), 0);
  assert.equal(LivePresenter.restLeft(lifting({ phase: "resting", restEndsAt: iso(NOW + 41_200) }), NOW), 42);
  assert.equal(LivePresenter.restLeft(lifting(), NOW), 0);
  assert.equal(LivePresenter.restLeft(null, NOW), 0);
});

test("presenter: three silent minutes mean no connection, except for a finished workout or an empty seat", () => {
  const silent = iso(NOW - 4 * 60_000);
  assert.equal(LivePresenter.headline(seen(lifting(), silent), NOW), "Нет связи");
  assert.equal(LivePresenter.headline(seen(lifting(), iso(NOW - 2 * 60_000)), NOW), "Присед · 1/3");
  assert.equal(LivePresenter.headline(seen(lifting({ phase: "done", tonnageKg: 8000 }), silent), NOW), "Закончил · 8 т");
  assert.equal(LivePresenter.headline(seen(null, silent), NOW), "Ждёт старта");
  assert.ok(LivePresenter.isAway(seen(lifting(), silent), NOW));
  assert.ok(!LivePresenter.isAway(seen(lifting(), iso(NOW - 2 * 60_000)), NOW));
  assert.ok(!LivePresenter.isAway(seen(lifting({ phase: "done" }), silent), NOW));
  assert.ok(!LivePresenter.isAway(seen(null, silent), NOW));
});

test("presenter: clock and progress are plain numbers for the interface", () => {
  assert.equal(LivePresenter.clock(42), "0:42");
  assert.equal(LivePresenter.clock(65), "1:05");
  assert.equal(LivePresenter.clock(600), "10:00");
  assert.equal(LivePresenter.clock(-5), "0:00");
  assert.equal(LivePresenter.progress(lifting({ setsDone: 1, setsTotal: 4 })), 0.25);
  assert.equal(LivePresenter.progress(lifting({ setsDone: 0, setsTotal: 0 })), 0);
  assert.equal(LivePresenter.progress(null), 0);
});

test("workout tally: sessions, working sets and working tonnage — warm-ups never count", () => {
  const first = twoLifts();
  first.exercises[0].sets[0].warmup = true;
  finish(first, 0, 3); // разминка выполнена, но в итог не входит: остаются два рабочих подхода
  const second = twoLifts();
  finish(second, 1, 3);
  assert.deepEqual(WorkoutTally.of([first, second]), { sessions: 2, sets: 5, tonnageKg: 3000 });
  assert.deepEqual(WorkoutTally.of([]), { sessions: 0, sets: 0, tonnageKg: 0 });
});

test("workout tally: unfinished sets add nothing and tonnage is rounded to whole kilograms", () => {
  const w = twoLifts();
  w.exercises[0].sets[0].weight = 22.5;
  w.exercises[0].sets[0].reps = 3; // 67,5 кг
  w.exercises[0].sets[0].done = true;
  w.exercises[0].sets[1].done = false;
  assert.deepEqual(WorkoutTally.of([w]), { sessions: 1, sets: 1, tonnageKg: 68 });
});
