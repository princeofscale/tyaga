import test from "node:test";
import assert from "node:assert/strict";
import { makeWorkout } from "../src/lib/model";
import { AnalyticsFacts } from "../src/domain/AnalyticsFacts";
import { TrainingVolume } from "../src/domain/TrainingVolume";
import { MachineRegistry } from "../src/domain/MachineRegistry";
import { JournalBackup } from "../src/domain/JournalBackup";
import { calendarWeek, trailingWindow } from "../src/lib/calendar";
const now = new Date("2026-11-09T12:00:00Z");
const options = { now, timeZone: "UTC" };
function sample(id = "bench", weight = 60) {
  const w = makeWorkout([id]);
  w.date = "2026-11-09";
  w.exercises[0].sets = [1, 2, 3].map(n => ({ id: `qa-${n}`, weight, reps: 10, rir: 2, warmup: false, done: true }));
  return w;
}
test("BL-MATH completed 3x60x10=1800; warmup/incomplete/future/duplicate excluded", () => {
  const w = sample();
  w.exercises[0].sets.push({ id: "warm", weight: 20, reps: 15, rir: 2, warmup: true, done: true });
  w.exercises[0].sets.push({ id: "pending", weight: 100, reps: 10, rir: 2, warmup: false, done: false });
  w.exercises[0].sets.push({ ...w.exercises[0].sets[0] });
  const future = sample(); future.date = "2026-11-10";
  assert.equal(new AnalyticsFacts([w, future], options).sets().length, 3);
  assert.equal(TrainingVolume.summarize([w, future], "working", options).total, 1800);
  assert.equal(TrainingVolume.summarize([w], "warmup", options).total, 300);
  assert.equal(TrainingVolume.e1rm(w.exercises[0].sets[0], w.exercises[0]), 80);
  assert.equal(TrainingVolume.e1rm(w.exercises[0].sets[3], w.exercises[0]), null);
});
test("BL-MACHINE 3x50x10=1500 machine markings; zero free-weight tonne contribution", () => {
  const w = sample("row", 50), m = MachineRegistry.create();
  m.nickname = "[QA] Station";
  w.exercises[0].machineInstanceId = m.id;
  w.exercises[0].machineSnapshot = m;
  assert.equal(TrainingVolume.summarize([w], "working", options).total, 0);
  assert.equal(TrainingVolume.machines([w], options).reduce((n, r) => n + r.volume, 0), 1500);
});
test("BL-CALENDAR Sunday/Monday/ISO53 and local midnight across DST", () => {
  assert.deepEqual(calendarWeek("2021-01-01"), { from: "2020-12-28", through: "2021-01-03" });
  assert.equal(calendarWeek("2026-11-08").from, "2026-11-02");
  assert.equal(calendarWeek("2026-11-09").from, "2026-11-09");
  assert.deepEqual(trailingWindow("2027-01-03", 7), { from: "2026-12-28", through: "2027-01-03" });
  assert.throws(() => calendarWeek("2026-02-30"), RangeError);
  const w = sample(); w.date = "2026-10-26";
  const midnight = new Date("2026-10-25T23:30:00Z");
  assert.equal(new AnalyticsFacts([w], { now: midnight, timeZone: "UTC" }).sets().length, 0);
  assert.equal(new AnalyticsFacts([w], { now: midnight, timeZone: "Europe/Amsterdam" }).sets().length, 3);
});
test("BL-BACKUP weight merge is idempotent and explicit conflicts do not silently overwrite", () => {
  const current = [{ id: "qa-existing", createdAt: 1794182400000, date: "2026-11-08", weightKg: 75, note: "QA" }];
  const incoming = [{ id: "qa-conflict", createdAt: 1794182400000, date: "2026-11-08", weightKg: 76, note: "changed" }, { id: "qa-new", createdAt: 1794268800000, date: "2026-11-09", weightKg: 74 }];
  const preview = JournalBackup.merge(current, incoming);
  assert.deepEqual(preview.conflictDates, ["2026-11-08"]);
  assert.equal(preview.entries[0].weightKg, 75);
  assert.equal(preview.added, 1);
  const replaced = JournalBackup.merge(current, incoming, true);
  assert.equal(replaced.entries[0].weightKg, 76);
  const replay = JournalBackup.merge(replaced.entries, incoming);
  assert.equal(replay.added, 0); assert.equal(replay.same, 2); assert.deepEqual(replay.conflictDates, []);
  assert.equal(current[0].weightKg, 75);
});
