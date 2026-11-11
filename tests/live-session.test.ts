import test from "node:test";
import assert from "node:assert/strict";
import { makeWorkout } from "../src/lib/model";
import type { Workout, WorkoutExercise } from "../src/lib/model";
import type { LiveState } from "../src/lib/liveRoom";
import { validLiveState } from "../server/LiveRoomService";
import {
  LIVE_HEARTBEAT_MS,
  LivePresenter,
  LivePushPolicy,
  LiveStateBuilder,
  RoomCode,
  RoomLink,
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

test("live state: tonnage is rounded to whole kilograms", () => {
  const w = twoLifts();
  w.exercises[0].sets[0].weight = 22.5;
  w.exercises[0].sets[0].reps = 3; // 67,5 кг
  w.exercises[0].sets[0].done = true;
  assert.equal(LiveStateBuilder.fromWorkout(w, { now: NOW, nameOf }).tonnageKg, 68);
});

test("live state: finished wins over everything else and drops the rest timer", () => {
  const w = twoLifts();
  finish(w, 0, 3);
  const state = LiveStateBuilder.fromWorkout(w, { now: NOW, nameOf, restEndsAt: NOW + 30_000, finished: true });
  assert.equal(state.phase, "done");
  assert.equal(state.restEndsAt, null);
});

test("live state: whatever the builder makes of a long name, a rest or a finish, the room accepts it", () => {
  const w = twoLifts();
  w.exercises[0].displayNameSnapshot = "Т".repeat(120); // личное упражнение может называться до 120 знаков
  finish(w, 0, 1);
  const resting = LiveStateBuilder.fromWorkout(w, { now: NOW, nameOf, restEndsAt: NOW + 90_000 });
  assert.equal(resting.phase, "resting");
  assert.doesNotThrow(() => validLiveState(resting, NOW));
  assert.doesNotThrow(() => validLiveState(LiveStateBuilder.fromWorkout(w, { now: NOW, nameOf, finished: true }), NOW));
  assert.ok(resting.exercise!.endsWith("…") && resting.exercise!.length <= 80);
  // Эмодзи (две кодовые единицы) не разрезаются посередине, и результат всё равно проходит проверку.
  w.exercises[0].displayNameSnapshot = "💪".repeat(60);
  const emoji = LiveStateBuilder.fromWorkout(w, { now: NOW, nameOf });
  assert.doesNotThrow(() => validLiveState(emoji, NOW));
  assert.doesNotMatch(emoji.exercise!, /[\ud800-\udbff](?![\udc00-\udfff])/);
  // Имя, которое помещается, остаётся как есть; пустое — не название.
  w.exercises[0].displayNameSnapshot = "Жим штанги лёжа";
  assert.equal(LiveStateBuilder.fromWorkout(w, { now: NOW, nameOf }).exercise, "Жим штанги лёжа");
  w.exercises[0].displayNameSnapshot = "   ";
  assert.equal(LiveStateBuilder.fromWorkout(w, { now: NOW, nameOf }).exercise, null);
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

test("room link: carries the code and tolerates typing noise", () => {
  assert.equal(RoomLink.build("https://tyaga.example", "h7kq2"), "https://tyaga.example/?r=H7KQ2");
  assert.equal(RoomLink.parse("?r=h7-kq2"), "H7KQ2");
  assert.equal(RoomLink.parse("?utm=1&r=H7KQ2"), "H7KQ2");
  assert.equal(RoomLink.parse("?r=H7KQ0"), null);
  assert.equal(RoomLink.parse("?friend=A1B2C3D4E5F6"), null);
  assert.equal(RoomLink.parse(""), null);
});

test("room link: stripping removes only the room code and leaves friend invitations alone", () => {
  assert.equal(RoomLink.strip("?r=H7KQ2"), "");
  assert.equal(RoomLink.strip("?r=H7KQ2&utm=1"), "?utm=1");
  assert.equal(RoomLink.strip("?friend=A1B2C3D4E5F6&r=H7KQ2"), "?friend=A1B2C3D4E5F6");
  assert.equal(RoomLink.strip("?utm=1&r=H7KQ2&x=2"), "?utm=1&x=2");
  assert.equal(RoomLink.strip("?friend=A1B2C3D4E5F6"), "?friend=A1B2C3D4E5F6");
  assert.equal(RoomLink.strip(""), "");
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
