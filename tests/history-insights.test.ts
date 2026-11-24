import test from "node:test";
import assert from "node:assert/strict";
import { HistoryInsights } from "../src/domain/HistoryInsights";
import { HistoryFilter } from "../src/domain/HistoryFilter";
import { entryName, makeWorkout } from "../src/lib/model";
import type { Workout } from "../src/lib/types";

function done(name: string, date: string, items: [id: string, weight: number, reps: number][], createdAt = `${date}T10:00:00.000Z`): Workout {
  const w = makeWorkout(items.map(([id]) => id), [], "UTC", true);
  w.name = name;
  w.date = date;
  w.createdAt = createdAt;
  w.duration = 50;
  w.exercises = w.exercises.map((e, i) => ({
    ...e,
    sets: [
      { id: `w-${date}-${i}`, weight: items[i][1] / 2, reps: 5, rir: null, warmup: true, done: true },
      { id: `s-${date}-${i}`, weight: items[i][1], reps: items[i][2], rir: 1, warmup: false, done: true },
    ],
  }));
  return w;
}

test("HistoryInsights: первое появление упражнения — не рекорд, рост расчётного 1ПМ — рекорд", () => {
  const a = done("Ноги", "2026-10-01", [["squat", 100, 5]]);
  const b = done("Ноги", "2026-10-08", [["squat", 100, 5]]);
  const c = done("Ноги", "2026-10-15", [["squat", 105, 5]]);
  const records = HistoryInsights.records([c, a, b]);
  assert.equal(records.has(a.id), false);
  assert.equal(records.has(b.id), false, "повтор того же веса — не рекорд");
  assert.deepEqual(records.get(c.id), ["Приседания со штангой"]);
});

test("HistoryInsights: лучший подход — рабочий, разминка не считается", () => {
  const w = done("Жим", "2026-10-01", [["bench", 100, 5]]);
  const best = HistoryInsights.bestSet(w.exercises[0]);
  assert.equal(best?.setId, "s-2026-10-01-0");
  assert.ok(Math.abs((best?.e1rm ?? 0) - 100 * (1 + 5 / 30)) < 1e-9);
});

test("HistoryInsights: сравнение с прошлой тренировкой того же типа и по упражнениям", () => {
  const legsOld = done("Ноги", "2026-10-01", [["squat", 100, 5]]);
  const press = done("Жим", "2026-10-03", [["bench", 80, 5]]);
  const legsDeload = done("Ноги [Разгрузка]", "2026-10-05", [["squat", 90, 5]]);
  const legs = done("Ноги", "2026-10-08", [["squat", 102.5, 5]]);
  const all = [legs, press, legsOld, legsDeload];
  assert.equal(HistoryInsights.previous(legs, all)?.id, legsDeload.id, "разгрузка — тот же тип");
  assert.equal(HistoryInsights.previous(legsOld, all), null);
  const [squat] = HistoryInsights.exercises(legs, all);
  assert.equal(squat.previousDate, "2026-10-05");
  assert.ok(Math.abs((squat.previousBest ?? 0) - 90 * (1 + 5 / 30)) < 1e-9);
  assert.equal(squat.record, true);
  const [first] = HistoryInsights.exercises(legsOld, all);
  assert.equal(first.previousBest, null);
  assert.equal(first.record, false);
});

test("HistoryInsights: две тренировки одного дня — порядок по моменту создания", () => {
  const morning = done("Утро", "2026-10-01", [["bench", 60, 5]], "2026-10-01T06:00:00.000Z");
  const evening = done("Вечер", "2026-10-01", [["bench", 60, 5]], "2026-10-01T18:00:00.000Z");
  assert.deepEqual(HistoryInsights.newestFirst([morning, evening]).map((w) => w.name), ["Вечер", "Утро"]);
  assert.deepEqual(HistoryInsights.newestFirst([evening, morning]).map((w) => w.name), ["Вечер", "Утро"]);
});

test("HistoryInsights: итоги, длительность и день недели", () => {
  const a = done("Жим", "2026-11-09", [["bench", 100, 5]]);
  const b = done("Жим", "2026-11-10", [["bench", 100, 5]]);
  const totals = HistoryInsights.totals([a, b]);
  assert.equal(totals.minutes, 100);
  assert.equal(totals.sets, 2);
  assert.ok(totals.tonnage > 0);
  assert.equal(HistoryInsights.duration(50), "50 мин");
  assert.equal(HistoryInsights.duration(100), "1 ч 40 мин");
  assert.equal(HistoryInsights.duration(725), "12 ч");
  assert.equal(HistoryInsights.weekday("2026-11-09"), "пн");
  assert.equal(HistoryInsights.weekday("2026-11-15"), "вс");
});

test("HistoryFilter: поиск не различает «е» и «ё» и не ломает даты", () => {
  const w = done("Жим", "2026-01-20", [["bench", 100, 5]]);
  assert.match(entryName(w.exercises[0]), /лёжа/);
  const find = (text: string) => HistoryFilter.filter([w], { ...HistoryFilter.EMPTY, text }, entryName).length;
  assert.equal(find("лежа"), 1);
  assert.equal(find("ЛЁЖА"), 1);
  assert.equal(find("20.01.2026"), 1);
  assert.equal(find("20 янв"), 1);
  assert.equal(find("присед"), 0);
});
