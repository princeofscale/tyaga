import test from "node:test";
import assert from "node:assert/strict";
import { AnalyticsFacts } from "../src/domain/AnalyticsFacts";
import { PersonalRecordsCalculator } from "../src/domain/PersonalRecords";
import { TrainingAnalytics } from "../src/domain/TrainingAnalytics";
import { ProgressSeries } from "../src/domain/ProgressSeries";
import { TrainingVolume } from "../src/domain/TrainingVolume";
import { WorkoutReference } from "../src/domain/WorkoutReference";
import { ProgressOverview } from "../src/domain/ProgressOverview";
import {
  calendarWeek,
  trailingWindow,
  addCalendarDays,
} from "../src/lib/calendar";
import {
  makeWorkout,
  repeatWorkout,
  ANALYSIS_VERSION,
  DEFAULT_SETTINGS,
  progressKey,
  lastEntry,
  estimatedOneRepMax,
} from "../src/lib/model";
import { SessionReport } from "../src/domain/SessionReport";
import type { Workout } from "../src/lib/types";
const NOW = new Date("2026-11-09T12:00:00Z"); // Monday
function sample(date = "2026-11-09", id = "bench"): Workout {
  const w = makeWorkout([id]);
  w.date = date;
  w.exercises[0].sets = [
    { id: "work", weight: 60, reps: 10, rir: 2, warmup: false, done: true },
  ];
  return w;
}

test("future, unfinished and warmup-only work cannot enter any aggregate", () => {
  const good = sample(),
    future = sample("2026-11-10"),
    warm = sample("2026-11-08"),
    pending = sample("2026-11-07");
  warm.exercises[0].sets[0].warmup = true;
  pending.exercises[0].sets[0].done = false;
  const history = [good, future, warm, pending],
    options = { now: NOW, timeZone: "UTC" };
  assert.equal(new AnalyticsFacts(history, options).sets().length, 1);
  const calc = new PersonalRecordsCalculator(history, NOW);
  assert.equal(calc.calculateRecords("UTC")[0].totalVolume, 600);
  assert.equal(calc.calculateStreak("UTC").totalWeeks, 1);
  assert.equal(calc.calculateVolumeTrends("UTC").recentVolume, 600);
  assert.equal(
    calc.calculateHeatmap(12, "UTC").reduce((n, d) => n + d.workingSets, 0),
    1,
  );
  assert.equal(
    ProgressSeries.strength(history, progressKey(good.exercises[0]), options)
      .length,
    1,
  );
  assert.equal(
    new TrainingAnalytics(history, options)
      .zoneLoad()
      .find((m) => m.id === "chest")!.direct,
    1,
  );
  assert.equal(ProgressOverview.calculate(history, 28, "UTC", NOW).sets, 1);
});

test("12 calendar-week buckets include current Monday and 11 previous Mondays only", () => {
  const history = Array.from({ length: 14 }, (_, i) =>
    sample(addCalendarDays("2026-11-09", -i * 7)),
  );
  history.push(sample("2026-11-10"));
  const rows = new PersonalRecordsCalculator(
    history,
    NOW,
  ).calculateVolumeTrends("UTC").weeklyAverages;
  assert.equal(rows.length, 12);
  assert.equal(rows[0].weekStart, "2026-08-24");
  assert.equal(rows.at(-1)!.weekStart, "2026-11-09");
});

test("Sunday/Monday, ISO week 53 and year transitions use calendar dates", () => {
  assert.deepEqual(calendarWeek("2021-01-01"), {
    from: "2020-12-28",
    through: "2021-01-03",
  });
  assert.equal(calendarWeek("2026-11-08").from, "2026-11-02");
  assert.equal(calendarWeek("2026-11-09").from, "2026-11-09");
  assert.deepEqual(trailingWindow("2027-01-03", 7), {
    from: "2026-12-28",
    through: "2027-01-03",
  });
  assert.throws(() => calendarWeek("2026-02-30"), RangeError);
});

test("eligibility follows account local midnight across Amsterdam DST", () => {
  const w = sample("2026-10-26");
  const now = new Date("2026-10-25T23:30:00Z");
  assert.equal(
    new AnalyticsFacts([w], { now, timeZone: "UTC" }).sets().length,
    0,
  );
  assert.equal(
    new AnalyticsFacts([w], { now, timeZone: "Europe/Amsterdam" }).sets()
      .length,
    1,
  );
  assert.deepEqual(calendarWeek("2026-03-29"), {
    from: "2026-03-23",
    through: "2026-03-29",
  });
});

test("invalid numbers are skipped and reported without poisoning volume/e1RM", () => {
  const w = sample();
  const base = w.exercises[0].sets[0];
  w.exercises[0].sets.push(
    ...[NaN, Infinity, -1].map((weight, i) => ({
      ...base,
      id: `bad-${i}`,
      weight,
    })),
    { ...base, id: "bad-reps", reps: NaN },
  );
  const summary = TrainingVolume.summarize([w]);
  assert.equal(summary.total, 600);
  assert.equal(summary.invalidSets, 4);
  assert.equal(
    new TrainingAnalytics([w]).zoneLoad().find((m) => m.id === "chest")!.direct,
    1,
  );
  for (const set of w.exercises[0].sets.slice(1))
    assert.equal(estimatedOneRepMax(set, w.exercises[0]), null);
});

test("duplicates are not counted twice; newer workout revisions replace older facts", () => {
  const w = sample();
  w.exercises[0].sets.push({ ...w.exercises[0].sets[0] });
  let result = new AnalyticsFacts([w, w]).read();
  assert.equal(result.sets.length, 1);
  assert.equal(result.diagnostics.duplicateSets, 1);
  assert.equal(result.diagnostics.duplicateWorkouts, 1);
  const revised = structuredClone(w);
  revised.revision = 2;
  revised.exercises[0].sets = [{ ...w.exercises[0].sets[0], weight: 80 }];
  assert.equal(TrainingVolume.summarize([w, revised]).total, 800);
  revised.exercises[0].sets = [];
  assert.equal(new AnalyticsFacts([w, revised]).sets().length, 0);
});

test("editing dates and deleting sets changes every view without mutating history", () => {
  const w = sample();
  const original = JSON.stringify(w);
  const calc = new PersonalRecordsCalculator([w], NOW);
  assert.equal(calc.calculateRecords()[0].totalSets, 1);
  assert.equal(JSON.stringify(w), original);
  const moved = { ...w, date: "2026-11-16" };
  assert.equal(
    new PersonalRecordsCalculator([moved], NOW).calculateRecords().length,
    0,
  );
  w.exercises[0].sets = [];
  assert.equal(
    new PersonalRecordsCalculator([w], NOW).calculateStreak().totalWeeks,
    0,
  );
});

test("last reference respects target workout date and ignores an incomplete later session", () => {
  const old = sample("2026-11-01"),
    future = sample("2026-11-20"),
    pending = sample("2026-11-08");
  old.exercises[0].sets[0].weight = 50;
  future.exercises[0].sets[0].weight = 100;
  pending.exercises[0].sets[0].done = false;
  assert.equal(
    lastEntry(
      [old, future, pending],
      old.exercises[0],
      undefined,
      "2026-11-09",
    )!.sets[0].weight,
    50,
  );
  assert.equal(
    lastEntry([old], old.exercises[0], undefined, "2026-10-30"),
    undefined,
  );
});

test("repeated legacy session uses the current analysis version and preserves catalog snapshots", () => {
  const original = sample();
  original.analysisVersion = 1;
  original.exercises[0].catalogRevision = 1;
  const result = repeatWorkout(original);
  assert.equal(result.analysisVersion, ANALYSIS_VERSION);
  assert.equal(result.exercises[0].catalogRevision, 1);
  assert.notEqual(
    result.exercises[0].sets[0].id,
    original.exercises[0].sets[0].id,
  );
});

test("per-set unilateral side overrides affect volume and comparison identity only for that set", () => {
  const w = sample("2026-11-09", "db-row"),
    entry = w.exercises[0];
  entry.performedSides = "both";
  entry.sets = [
    { ...entry.sets[0], id: "both", weight: 20 },
    { ...entry.sets[0], id: "left", weight: 20, performedSides: "left" },
  ];
  assert.equal(TrainingVolume.summarize([w]).total, 600);
  assert.equal(
    ProgressSeries.strength([w], progressKey(entry), { now: NOW })[0].sets
      .length,
    1,
  );
  assert.equal(
    ProgressSeries.strength([w], progressKey(entry, entry.sets[1]), {
      now: NOW,
    })[0].sets.length,
    1,
  );
});

test("ROM splits progress series without inventing extra muscle credit; supersets do not multiply sets", () => {
  const w = sample();
  const entry = w.exercises[0];
  entry.supersetId = "pair";
  entry.sets.push({
    ...entry.sets[0],
    id: "partial",
    execution: { rom: "lengthened_partial" },
  });
  assert.notEqual(
    progressKey(entry, entry.sets[0]),
    progressKey(entry, entry.sets[1]),
  );
  assert.equal(
    new TrainingAnalytics([w])
      .zoneLoad(DEFAULT_SETTINGS)
      .find((m) => m.id === "chest")!.direct,
    2,
  );
  assert.equal(new SessionReport(w).density.supersetGroups, 1);
});

test("aggregate and muscle maps use the account timezone when it is already tomorrow locally", () => {
  const now = new Date("2026-11-12T23:30:00Z");
  const w = sample("2026-11-13");
  const options = { now, timeZone: "Europe/Moscow" };
  const expected = new PersonalRecordsCalculator([w], now)
    .calculateHeatmap(1, "Europe/Moscow")
    .find((d) => d.date === w.date)!;
  assert.equal(expected.workingSets, 1);
  assert.equal(
    new TrainingAnalytics([w], options)
      .zoneLoad()
      .find((m) => m.id === "chest")!.direct,
    1,
  );
  assert.equal(TrainingVolume.summarize([w], "working", options).total, 600);
});
