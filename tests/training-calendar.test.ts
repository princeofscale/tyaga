import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import initSqlJs from "sql.js";
import { BackupImportService } from "../server/BackupImportService";
import { HistoryImportService } from "../server/HistoryImportService";
import { ProductRepository } from "../server/ProductRepository";
import { SyncService } from "../server/SyncService";
import { validOccurrenceOverrides, validRoutine, validWorkout } from "../server/validation";
import { LocalD1 } from "../src/device/LocalD1";
import { LaidDupPlan } from "../src/domain/LaidDupPlan";
import { TrainingCalendar, MAX_OCCURRENCE_OVERRIDES, calendarWeekday } from "../src/domain/TrainingCalendar";
import { TrainingProgram, DELOAD_CYCLE } from "../src/domain/TrainingProgram";
import { WorkoutImport } from "../src/domain/WorkoutImport";
import { addCalendarDays } from "../src/lib/calendar";
import { makeExerciseEntry, makeWorkout } from "../src/lib/model";
import type { Routine, Workout } from "../src/lib/types";

const MON = "2026-11-09";
const FRI = "2026-11-13";
const END = "2026-11-15";
const NEXT_MON = "2026-11-16";
const WEEK_AFTER = "2026-11-23";
const routine = (...days: number[]): Routine => ({
  ...TrainingProgram.empty(), name: "Силовая по плану", exercises: [makeExerciseEntry("bench")], days,
});
function saved(r: Routine, actualDate: string, originalDate?: string): Workout {
  const w = makeWorkout(["bench"], [], "UTC");
  w.routineId = r.id;
  w.date = actualDate;
  if (originalDate !== undefined) w.programDate = originalDate;
  w.exercises[0].sets[0] = { ...w.exercises[0].sets[0], weight: 80, reps: 5, done: true };
  return w;
}

test("move, reschedule, skip and restore one occurrence without rewriting the template", () => {
  const plan = { ...routine(0, 4), revision: 7 };
  const another = routine(6);
  const moved = TrainingCalendar.withOverride(plan, FRI, END, []);
  assert.equal(moved.revision, 7);
  assert.deepEqual(moved.days, plan.days);
  assert.equal(plan.occurrenceOverrides, undefined);
  assert.deepEqual(TrainingCalendar.onDate([moved], FRI), []);
  assert.deepEqual(TrainingCalendar.onDate([moved, another], END), [
    { routine: moved, date: END, originalDate: FRI }, { routine: another, date: END, originalDate: END },
  ]);
  const movedAgain = TrainingCalendar.withOverride(moved, FRI, NEXT_MON, []);
  assert.deepEqual(TrainingCalendar.onDate([movedAgain], NEXT_MON).map((s) => s.originalDate), [FRI, NEXT_MON]);
  const skipped = TrainingCalendar.withOverride(movedAgain, FRI, null, []);
  assert.deepEqual(TrainingCalendar.onDate([skipped], NEXT_MON).map((s) => s.originalDate), [NEXT_MON]);
  const restored = TrainingCalendar.withOverride(skipped, FRI, undefined, []);
  assert.equal(restored.occurrenceOverrides, undefined);
  assert.equal(TrainingCalendar.onDate([restored], FRI)[0]?.originalDate, FRI);
  assert.equal(TrainingCalendar.onDate([restored], "2026-11-20")[0]?.originalDate, "2026-11-20");
  assert.throws(() => TrainingCalendar.withOverride(plan, END, NEXT_MON, []), /нет в плане/);
});

test("completion uses origin metadata, and legacy dates count only for their unmoved slot", () => {
  const plan = TrainingCalendar.withOverride(routine(0), MON, NEXT_MON, []);
  const [moved, unchanged] = TrainingCalendar.onDate([plan], NEXT_MON);
  const oldWorkout = saved(plan, NEXT_MON);
  const movedWorkout = saved(plan, "2026-11-17", MON);
  assert.equal(TrainingCalendar.completed(moved, [oldWorkout]), undefined);
  assert.equal(TrainingCalendar.completed(unchanged, [movedWorkout, oldWorkout]), oldWorkout);
  assert.equal(TrainingCalendar.completed(moved, [oldWorkout, movedWorkout]), movedWorkout);
  assert.equal(TrainingCalendar.completed(moved, [saved(routine(0), NEXT_MON, MON)]), undefined);
  assert.throws(() => TrainingCalendar.withOverride(plan, MON, null, [movedWorkout]), /Выполненную/);
  assert.throws(() => TrainingCalendar.withOverride(plan, NEXT_MON, END, [oldWorkout]), /Выполненную/);
  assert.equal(TrainingCalendar.next([plan], MON, [oldWorkout])?.originalDate, MON);
  assert.equal(TrainingCalendar.next([plan], MON, [movedWorkout])?.originalDate, NEXT_MON);
  assert.equal(TrainingCalendar.next([plan], MON, [movedWorkout, oldWorkout])?.date, WEEK_AFTER);
  assert.equal(TrainingCalendar.next([plan], NEXT_MON)?.date, WEEK_AFTER);
});

test("next crosses week and year boundaries without a fixed search horizon", () => {
  const sunday = "2026-10-25"; // A DST transition in Europe/Amsterdam; calendar dates do not shift.
  const plan = { ...routine(6), occurrenceOverrides: Array.from({ length: 12 }, (_, i) => ({
    from: addCalendarDays(sunday, i * 7), to: null,
  })) };
  assert.equal(TrainingCalendar.next([plan], "2026-10-23")?.date, "2027-01-17");
  const moved = TrainingCalendar.withOverride(routine(6), sunday, "2026-10-24", []);
  assert.equal(TrainingCalendar.next([plan, moved], "2026-10-23")?.date, "2026-10-24");
  assert.equal(TrainingCalendar.next([routine()], sunday), undefined);
  assert.equal(TrainingCalendar.next([plan], "2026-02-31"), undefined);
  assert.deepEqual(TrainingCalendar.onDate([plan], "2026-02-31"), []);
});

test("standard deload uses the planned week and anchors the cycle by the first workout's original date", () => {
  const plan = routine(4);
  plan.cycle = DELOAD_CYCLE;
  plan.exercises[0].sets = Array.from({ length: 4 }, (_, i) => ({
    id: String(i), weight: 100, reps: 8, rir: null, warmup: false, done: false,
  }));
  const program = new TrainingProgram(plan);
  const first = program.start([], "UTC", MON, "2026-11-06");
  first.exercises[0].sets = first.exercises[0].sets.map((s) => ({ ...s, reps: 8, done: true }));
  const history = [first];
  assert.equal(program.weekIndex(history, "2026-12-04"), 4);
  const moved = program.start(history, "UTC", "2026-12-07", "2026-12-04");
  assert.equal(moved.date, "2026-12-07");
  assert.equal(moved.programDate, "2026-12-04");
  assert.match(moved.notes, /Разгрузочная неделя 5 из 5/);
  assert.deepEqual(moved.exercises[0].sets.map(({ weight, rir }) => [weight, rir]), [[70, 4], [70, 4]]);
  assert.equal(program.start(history, "UTC", "2026-12-07").exercises[0].sets.length, 4);
});

test("Laid work across a Monday boundary uses the original week's wave", () => {
  const plan = LaidDupPlan.routines({ startMonday: MON, extras: false, light: false,
    maxes: { squat: 100, bench: 80, deadlift: 140, ohp: 60 } }).find((r) => r.periodization?.day === "push1")!;
  const from = addCalendarDays(MON, plan.days[0]);
  const to = NEXT_MON;
  const workout = new TrainingProgram(plan).start([], "UTC", to, from);
  const phase = LaidDupPlan.planFor(plan, from)!;
  const actualPhase = LaidDupPlan.planFor(plan, to)!;
  assert.notDeepEqual(phase.heavy, actualPhase.heavy);
  const heavy = workout.exercises.find((e) => e.exerciseId === phase.liftExerciseId)!.sets[0];
  assert.equal(workout.date, to);
  assert.equal(workout.programDate, from);
  assert.equal(heavy.weight, phase.heavy.weightKg);
  assert.equal(heavy.reps, phase.heavy.reps);
});

test("validation accepts bounded exact dates only and strips unrecognized fields", () => {
  const plan = routine(0, 4);
  const overrides = [{ from: FRI, to: END, unrelated: true }, { from: MON, to: null }];
  assert.deepEqual(validRoutine({ ...plan, occurrenceOverrides: overrides }, new Map()).occurrenceOverrides,
    [{ from: MON, to: null }, { from: FRI, to: END }]);
  assert.equal(validRoutine({ ...plan, occurrenceOverrides: [{ from: MON, to: MON }] }, new Map()).occurrenceOverrides, undefined);
  for (const value of [null, [{}], [{ from: MON }], [{ from: "2026-02-29", to: null }],
    [{ from: MON, to: FRI }, { from: MON, to: null }],
    [{ from: MON, to: FRI + "T12:00:00Z" }],
    Array.from({ length: MAX_OCCURRENCE_OVERRIDES + 1 }, (_, i) => ({ from: addCalendarDays(MON, i), to: null })),
  ]) assert.throws(() => validOccurrenceOverrides(value));
  assert.throws(() => validWorkout(saved(plan, MON, " 2026-11-09"), { now: new Date("2026-11-10T12:00Z") }), /дату/);
  assert.equal(validWorkout(saved(plan, MON, FRI), { now: new Date("2026-11-10T12:00Z") }).programDate, FRI);
});

async function database() {
  const SQL = await initSqlJs();
  const raw = new SQL.Database();
  raw.exec("PRAGMA foreign_keys=ON");
  for (const file of (await readdir("drizzle")).filter((f) => f.endsWith(".sql")).sort())
    raw.exec(await readFile("drizzle/" + file, "utf8"));
  return { db: new LocalD1(raw) as unknown as D1Database, raw };
}

test("native backup and local device sync retain adjustments and the workout occurrence key", async () => {
  const first = await database();
  const second = await database();
  try {
    const source = "2024-10-28";
    const destination = "2024-11-02";
    const plan = TrainingCalendar.withOverride(routine(calendarWeekday(source)), source, destination, []);
    const workout = saved(plan, destination, source);
    const backup = new WorkoutImport({ dateOrder: "dmy", timeZone: "UTC", weightUnit: "kg", distanceUnit: "km" }).parse(
      JSON.stringify({ format: "tyaga-backup", version: 5, workouts: [workout], routines: [plan] }), "tyaga",
    );
    assert.equal(backup.workouts[0].programDate, source);
    const owner = "calendar-restore";
    await new BackupImportService(first.db, owner).import({ kind: "routines", items: backup.extras?.routines });
    await new HistoryImportService(first.db, owner).import({ format: backup.format, workouts: backup.workouts });
    const docs = (await new SyncService(first.db, owner).changes(0)).docs;
    const receiver = new SyncService(second.db, "calendar-device");
    assert.equal((await receiver.apply({ docs })).applied, 2);
    const [restored] = (await new ProductRepository(second.db, "calendar-device").read()).routines;
    const syncedDocs = (await receiver.changes(0)).docs;
    const restoredWorkout = JSON.parse(String(syncedDocs.find((d) => d.kind === "workout")?.row?.payload)) as Workout;
    assert.deepEqual(restored.occurrenceOverrides, plan.occurrenceOverrides);
    assert.equal(restoredWorkout.routineId, restored.id);
    assert.equal(restoredWorkout.date, destination);
    assert.equal(restoredWorkout.programDate, source);
    assert.equal(TrainingCalendar.completed(TrainingCalendar.onDate([restored], destination)[0], [restoredWorkout]), restoredWorkout);
    const workoutDoc = docs.find((d) => d.kind === "workout")!;
    await assert.rejects(receiver.apply({ docs: [{ ...workoutDoc, row: {
      ...workoutDoc.row, payload: JSON.stringify({ ...restoredWorkout, programDate: "2024-11-31" }),
    } }] }), /дату тренировки по плану/);
  } finally {
    first.raw.close();
    second.raw.close();
  }
});
