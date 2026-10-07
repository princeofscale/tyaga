import test from "node:test";
import assert from "node:assert/strict";
import ru from "../data/wger/catalog-v2-ru.json";
import original from "../data/wger/catalog-v1.json";
import {
  EXERCISES,
  exerciseCatalog,
  makeWorkout,
  makeSets,
  entrySpec,
  muscleLoad,
  DEFAULT_SETTINGS,
} from "../src/lib/model";
import {
  WgerExerciseAdapter,
  type WgerRecord,
} from "../src/domain/WgerExercise";
import { TrainingProgram } from "../src/domain/TrainingProgram";
import { CsvTable, WorkoutImport } from "../src/domain/WorkoutImport";
import { newDraft, parseDraft } from "../src/lib/draft";
const importer = new WorkoutImport({
  dateOrder: "dmy",
  weightUnit: "kg",
  distanceUnit: "km",
  timeZone: "Europe/Amsterdam",
});

test("all 949 current catalogue exercises have Russian names and aliases; source release stays immutable", () => {
  assert.equal(ru.exercises.length, 918);
  assert.equal(EXERCISES.length, 31);
  for (const row of ru.exercises) {
    assert.match(row.name, /[а-яё]/i);
    assert.equal(row.language, "ru");
    assert.ok(row.aliases.length > 0);
    assert.ok(row.localization.sourceInstructions !== undefined);
    assert.ok(row.attributions.length > 0);
    const old = original.exercises.find((e) => e.sourceId === row.sourceId)!;
    assert.notEqual(row.id, old.id);
    assert.deepEqual(row.attributions, old.attributions);
  }
  for (const e of EXERCISES) {
    assert.match(e.name, /[а-яё]/i);
    assert.ok(e.aliases?.length);
  }
  assert.equal(exerciseCatalog.search({ text: "РДЛ" })[0].id, "rdl");
  assert.equal(exerciseCatalog.search({ text: "ЖИМ ЛЕЖА" })[0].id, "bench");
  assert.equal(exerciseCatalog.search({ text: "молотки" })[0].id, "hammer");
});
test("timed definitions and missing RIR survive draft reload and do not imply hard sets", () => {
  const row = ru.exercises.find((r) => r.sourceId === 458)!;
  const e = new WgerExerciseAdapter(ru.release, ru.fetchedAt).toExercise(
    row as WgerRecord,
  );
  exerciseCatalog.register([e]);
  const w = makeWorkout([e.id]);
  w.exercises[0].sets[0].durationSeconds = 45;
  assert.equal(w.exercises[0].sets[0].rir, null);
  const restored = parseDraft(JSON.stringify(newDraft(w)));
  assert.ok(restored);
  assert.equal(restored.workout.exercises[0].sets[0].durationSeconds, 45);
  assert.equal(restored.workout.exercises[0].sets[0].rir, null);
  const bench = makeWorkout(["bench"]);
  bench.exercises[0].sets = [{ ...makeSets(1)[0], done: true, rir: null }];
  assert.equal(
    muscleLoad([bench], DEFAULT_SETTINGS).find((m) => m.id === "chest")!.direct,
    1,
  );
  assert.equal(
    muscleLoad([bench], DEFAULT_SETTINGS, { maxRir: 3 }).find(
      (m) => m.id === "chest",
    )!.direct,
    0,
  );
});
test("double progression requires every planned working set, equal loads and a stable exercise rule", () => {
  const r = {
    ...TrainingProgram.empty(),
    name: "Прогрессия",
    progression: "double" as const,
    repMin: 8,
    repMax: 12,
    incrementKg: 2.5,
    exercises: [{ ...entrySpec("bench"), sets: makeSets(3, 50, 8) }],
  };
  const previous = makeWorkout(["bench"], [], "UTC");
  previous.exercises[0].sets = makeSets(3, 60, 12).map((s) => ({
    ...s,
    done: true,
  }));
  const program = new TrainingProgram(r);
  const increased = program.start([previous], "UTC");
  assert.equal(increased.exercises[0].sets[0].weight, 62.5);
  assert.equal(increased.exercises[0].sets[0].reps, 8);
  assert.equal(increased.routineId, r.id);
  assert.ok(increased.exercises[0].sets.every((s) => !s.done));
  previous.exercises[0].sets[2].done = false;
  assert.equal(
    program.start([previous], "UTC").exercises[0].sets[0].weight,
    60,
  );
  previous.exercises[0].sets.pop();
  assert.equal(
    program.start([previous], "UTC").exercises[0].sets[0].weight,
    60,
  );
  previous.exercises[0].sets = makeSets(3, 60, 12).map((s, i) => ({
    ...s,
    weight: i === 2 ? 55 : 60,
    done: true,
  }));
  assert.equal(
    program.start([previous], "UTC").exercises[0].sets[0].weight,
    60,
  );
});
test("CSV quoting, multilingual decimals and numeric date policy remain explicit", () => {
  assert.deepEqual(
    new CsvTable().parse(
      'Date,Exercise,Notes\n2026-10-06,"Squat, barbell","Line 1\nLine 2"',
    ),
    [
      ["Date", "Exercise", "Notes"],
      ["2026-10-06", "Squat, barbell", "Line 1\nLine 2"],
    ],
  );
  assert.throws(
    () => new CsvTable().parse('Date,Exercise\n2026-01-01,"unclosed'),
    /кавычки/,
  );
  const data = importer.parse(
    "Date;Exercise;Weight;Reps;Notes\n06.10.2026;Squat;60,5;8;Хорошо",
    "fitnotes",
  );
  assert.equal(data.workouts[0].date, "2026-10-06");
  assert.equal(data.workouts[0].exercises[0].sets[0].weight, 60.5);
  assert.equal(data.workouts[0].exercises[0].sets[0].rir, null);
});
test("Strong, Hevy and FitNotes imports preserve work, warmups, RPE and cardio units", () => {
  const strong = importer.parse(
    "Date,Workout Name,Duration,Exercise Name,Set Order,Weight,Reps,Seconds,RPE\n2026-10-06 18:00:00,Push,1h 5m,Bench Press,W,20,10,0,\n2026-10-06 18:00:00,Push,1h 5m,Bench Press,1,60,8,0,8",
    "strong",
  );
  assert.equal(strong.workouts.length, 1);
  assert.equal(strong.workouts[0].duration, 65);
  assert.equal(strong.workouts[0].exercises[0].sets[0].warmup, true);
  assert.equal(strong.workouts[0].exercises[0].sets[1].rir, 2);
  const hevy = importer.parse(
    'title,start_time,end_time,exercise_title,set_type,weight_kg,reps,duration_seconds,distance_km,rpe\nCardio,"6 Oct 2026, 09:00","6 Oct 2026, 09:30",Running,normal,0,,1800,5,',
    "hevy",
  );
  assert.equal(hevy.workouts[0].date, "2026-10-06");
  assert.equal(hevy.workouts[0].exercises[0].type, "duration");
  assert.equal(hevy.workouts[0].exercises[0].sets[0].durationSeconds, 1800);
  assert.equal(hevy.workouts[0].exercises[0].sets[0].distanceKm, 5);
  const fit = importer.parse(
    "Date,Exercise,Weight,Weight Unit,Reps,Distance,Distance Unit,Time\n2026-10-06,Walk,0,kg,0,2,miles,20:00",
    "fitnotes",
  );
  assert.equal(fit.workouts[0].exercises[0].sets[0].distanceKm, 3.2187);
  const pounds = importer.parse(
    "Date,Workout Name,Exercise Name,Weight (lbs),Reps,RPE\n2026-10-06,Push,Bench Press,100,8,7.5",
    "strong",
  );
  assert.equal(pounds.workouts[0].exercises[0].sets[0].weight, 45.3592);
  assert.equal(pounds.workouts[0].exercises[0].sets[0].rir, 2.5);
  assert.throws(
    () =>
      importer.parse(
        "Date,Workout Name,Exercise Name,Weight,Reps,RPE\n2026-10-06,Push,Bench Press,60,8,11",
        "strong",
      ),
    /RPE/,
  );
});
test("JSON backup parsing preserves catalog revisions and metadata without translating history", () => {
  const w = makeWorkout(["bench"]);
  w.exercises[0].sets[0].done = true;
  const data = importer.parse(
    JSON.stringify({
      version: 3,
      workouts: [w],
      routines: TrainingProgram.starter("full"),
      customExercises: [],
      favorites: ["bench"],
      settings: DEFAULT_SETTINGS,
    }),
    "tyaga",
  );
  assert.equal(data.workouts[0].nativeId, w.id);
  assert.equal(data.workouts[0].exercises[0].catalogRevision, 2);
  assert.equal(data.extras!.routines.length, 1);
  assert.equal(data.extras!.favorites[0], "bench");
});
