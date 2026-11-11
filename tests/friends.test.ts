import test from "node:test";
import assert from "node:assert/strict";
import { FriendsService, type Athlete } from "../src/domain/FriendsService";
import { makeWorkout } from "../src/lib/model";

test("invite codes accept copied formatting and links, reject arbitrary names and malformed links", () => {
  for (const input of [
    "a1b2c3d4e5f6",
    "A1B2–C3D4–E5F6",
    " A1B2 C3D4 E5F6 ",
    "https://tyaga.example/?friend=A1B2C3D4E5F6",
  ])
    assert.equal(FriendsService.inviteCode(input), "A1B2C3D4E5F6");
  for (const input of [
    "",
    "@ivan",
    "not a code",
    "A1B2C3D4E5F678",
    "https://bad:link",
    "https://tyaga.example/?other=A1B2C3D4E5F6",
  ])
    assert.equal(FriendsService.inviteCode(input), null);
});

test("social week and 30-day feed use the viewer's calendar across timezone and year boundaries", () => {
  const now = new Date("2027-01-03T22:30:00Z");
  assert.deepEqual(FriendsService.week(now, "Europe/Moscow"), {
    today: "2027-01-04",
    start: "2027-01-04",
    feedStart: "2026-12-06",
  });
  assert.deepEqual(FriendsService.week(now, "America/Los_Angeles"), {
    today: "2027-01-03",
    start: "2026-12-28",
    feedStart: "2026-12-05",
  });
});

test("team goal caps contributions so one athlete cannot complete everyone's target", () => {
  const athlete = (weekWorkouts: number): Athlete => ({
    id: "a",
    displayName: "Атлет",
    gym: "",
    focus: "",
    activeUntil: 0,
    weekWorkouts,
  });
  assert.deepEqual(FriendsService.teamProgress([athlete(8), athlete(0)]), {
    done: 3,
    target: 6,
    percent: 50,
  });
  assert.deepEqual(FriendsService.teamProgress([]), {
    done: 0,
    target: 0,
    percent: 0,
  });
});

test("workout summary counts only completed working sets and supported free-weight volume", () => {
  const w = makeWorkout(["bench"], [], "UTC");
  w.exercises[0].sets = [
    { id: "working", weight: 60, reps: 8, done: true, warmup: false, rir: 2 },
    { id: "warmup", weight: 20, reps: 10, done: true, warmup: true, rir: 5 },
    {
      id: "incomplete",
      weight: 80,
      reps: 5,
      done: false,
      warmup: false,
      rir: null,
    },
  ];
  assert.deepEqual(FriendsService.workout(w), { setsCount: 1, volumeKg: 480 });
});
