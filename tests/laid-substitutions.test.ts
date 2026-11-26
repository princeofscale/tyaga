import test from "node:test";
import assert from "node:assert/strict";
import { LaidDupPlan, LAID_WEEKS } from "../src/domain/LaidDupPlan";
import { PeriodizationRules } from "../src/domain/PeriodizationRules";
import { TrainingProgram } from "../src/domain/TrainingProgram";
import { TrainingVolume } from "../src/domain/TrainingVolume";
import { BiomechanicsEngine } from "../src/domain/BiomechanicsEngine";
import { ExerciseAlternativesFinder } from "../src/domain/ExerciseAlternatives";
import { InputError, validPeriodization } from "../server/validation";
import { exerciseById, makeExerciseEntry, makeSets } from "../src/lib/model";
import type { LaidMaxes, Workout } from "../src/lib/types";

const MAXES: LaidMaxes = { squat: 120, bench: 100, deadlift: 160, ohp: 65 };
const START = "2026-11-09";

function doneWorkout(date: string, items: [id: string, weight: number, reps: number][]): Workout {
  return {
    id: crypto.randomUUID(),
    name: "Тренировка",
    date,
    duration: 45,
    notes: "",
    exercises: items.map(([id, weight, reps]) => ({
      ...makeExerciseEntry(id),
      sets: makeSets(1, weight, reps).map((s) => ({ ...s, done: true, rir: 1 })),
    })),
  };
}

test("PeriodizationRules & validPeriodization validate substitutions identically on client and server", () => {
  const base = LaidDupPlan.routines({ maxes: MAXES, extras: true, light: false, startMonday: START })[0].periodization!;
  const cases: [string, unknown, boolean][] = [
    ["без замен", base, true],
    ["валидная замена становой", { ...base, substitutions: { "deadlift-bar": "barbell-hip-thrust" } }, true],
    ["несколько замен", { ...base, substitutions: { "deadlift-bar": "barbell-hip-thrust", "deadlift-stiff": "legcurl-prone" } }, true],
    ["самозамена запрещена", { ...base, substitutions: { "deadlift-bar": "deadlift-bar" } }, false],
    ["пустое значение запрещено", { ...base, substitutions: { "deadlift-bar": "" } }, false],
    ["не объект", { ...base, substitutions: ["barbell-hip-thrust"] }, false],
    ["число в значении", { ...base, substitutions: { "deadlift-bar": 123 } }, false],
    [
      "больше 30 замен",
      { ...base, substitutions: Object.fromEntries(Array.from({ length: 31 }, (_, i) => [`a${i}`, `b${i}`])) },
      false,
    ],
  ];

  for (const [label, value, expected] of cases) {
    const clientOk = PeriodizationRules.check(value).ok;
    let serverOk = true;
    try {
      validPeriodization(value);
    } catch (e) {
      assert.ok(e instanceof InputError, label);
      serverOk = false;
    }
    assert.equal(clientOk, expected, `client: ${label}`);
    assert.equal(serverOk, expected, `server: ${label}`);
  }
});

test("Замена становой тяги на весь цикл сохраняет периодизацию DUP, 9-недельные волны и корректный объём", () => {
  const subs = { "deadlift-bar": "barbell-hip-thrust" };
  const cycle = LaidDupPlan.routines({
    maxes: { ...MAXES, deadlift: 140 },
    extras: true,
    light: false,
    startMonday: START,
    substitutions: subs,
  });

  const pull1 = cycle.find((r) => r.periodization!.day === "pull1")!;
  const pull2 = cycle.find((r) => r.periodization!.day === "pull2")!;

  assert.equal(pull1.exercises[0].exerciseId, "barbell-hip-thrust");
  assert.equal(pull2.exercises[0].exerciseId, "barbell-hip-thrust");
  assert.ok(!pull1.exercises.some((e) => e.exerciseId === "deadlift-bar"));
  assert.ok(!pull2.exercises.some((e) => e.exerciseId === "deadlift-bar"));

  // Проверка старта тренировки на неделе 1 (Pull 1: 1×3 @ 90% = 125 кг, 4×6 @ 80% = 112.5 кг)
  const w1 = new TrainingProgram(pull1).start([], "UTC", "2026-11-11");
  assert.equal(w1.exercises[0].exerciseId, "barbell-hip-thrust");
  assert.deepEqual(
    w1.exercises[0].sets.map((s) => [s.weight, s.reps]),
    [
      [125, 3],
      [112.5, 6],
      [112.5, 6],
      [112.5, 6],
      [112.5, 6],
    ],
  );
  assert.match(w1.exercises[0].progressionNote ?? "", /Тяжёлый подход: 1 × 3/);
  assert.match(w1.exercises[0].progressionNote ?? "", /Замена вместо «Становая тяга со штангой»/);

  // Неделя 7 (волна 3): проценты растут (92.5% и 82% от 140 = 130 и 115)
  const w7 = new TrainingProgram(pull1).start([], "UTC", "2026-12-23");
  assert.equal(w7.exercises[0].sets[0].weight, 130);
  assert.equal(w7.exercises[0].sets[1].weight, 115);

  // Выполненный объём (тоннаж) считается корректно для заменённого упражнения
  const completed: Workout = {
    ...w1,
    exercises: [
      {
        ...w1.exercises[0],
        sets: w1.exercises[0].sets.map((s) => ({ ...s, done: true })),
      },
    ],
  };
  const expectedVolume = 125 * 3 + 4 * 112.5 * 6;
  assert.equal(TrainingVolume.summarize([completed]).total, expectedVolume);

  // Плановый объём по мышцам и осевая нагрузка пересчитываются: замена становой на ягодичный мост снижает осевую на 10 подх./нед
  const origVol = LaidDupPlan.weeklyMuscleVolume({ extras: true });
  const nextVol = LaidDupPlan.weeklyMuscleVolume({ extras: true, substitutions: subs });
  assert.equal(origVol.axialSets - nextVol.axialSets, 10);
  const origGlutes = origVol.muscles.find((m) => m.id === "glutes")!.sets;
  const nextGlutes = nextVol.muscles.find((m) => m.id === "glutes")!.sets;
  assert.ok(nextGlutes >= origGlutes, "объём ягодиц не падает при замене на ягодичный мост");

  // Заменённый лифт не помечается как «добавлено»
  assert.equal(LaidDupPlan.isAdded("pull1", "barbell-hip-thrust", subs), false);
  assert.equal(LaidDupPlan.exerciseSpec("pull1", "barbell-hip-thrust", subs).replacedFrom, "deadlift-bar");
  assert.equal(LaidDupPlan.exerciseSpec("pull1", "barbell-hip-thrust", subs).role, "lift");
});

test("Оценка 1ПМ из истории и автопересчёт максимумов отслеживают заменённое упражнение, а не старую становую", () => {
  const subs = { "deadlift-bar": "barbell-hip-thrust" };
  const cycle = LaidDupPlan.routines({
    maxes: { ...MAXES, deadlift: 100 },
    extras: true,
    light: false,
    startMonday: START,
    substitutions: subs,
  });

  // В истории становая 200×1 (не должна влиять!) и ягодичный мост 120×1 (+20% к 100 → должен сработать автопересчёт)
  const workouts = [
    doneWorkout("2026-11-15", [["deadlift-bar", 200, 1]]),
    doneWorkout("2026-11-16", [["barbell-hip-thrust", 120, 1]]),
  ];

  const estimates = LaidDupPlan.estimates(workouts, "2026-11-18", subs);
  assert.equal(estimates.deadlift, 120);

  const auto = LaidDupPlan.autoMaxes(cycle[0].periodization!, workouts, "2026-11-18");
  assert.ok(auto);
  assert.equal(auto.applied.length, 1);
  assert.equal(auto.applied[0].lift, "deadlift");
  assert.equal(auto.applied[0].to, 120);
  assert.match(LaidDupPlan.autoNotice(auto, subs), /Хип-траст со штангой/);
});

test("Замена волновой подсобки (push-press) сохраняет волновые повторения 4/8/12 и не считается добавленной", () => {
  const subs = { "push-press": "ohp" };
  const cycle = LaidDupPlan.routines({
    maxes: MAXES,
    extras: true,
    light: false,
    startMonday: START,
    substitutions: subs,
  });
  const push1 = cycle.find((r) => r.periodization!.day === "push1")!;
  assert.ok(push1.exercises.some((e) => e.exerciseId === "ohp"));
  assert.equal(LaidDupPlan.isAdded("push1", "ohp", subs), false);
  assert.equal(LaidDupPlan.auxReps("push1", "ohp", 0, subs), 4);
  assert.equal(LaidDupPlan.auxReps("push1", "ohp", 1, subs), 8);
  assert.equal(LaidDupPlan.auxReps("push1", "ohp", 2, subs), 12);
  assert.match(LaidDupPlan.waveAuxSummary("push1", 1, subs) ?? "", /8/);

  const w2 = new TrainingProgram(push1).start([], "UTC", "2026-11-17");
  const auxEntry = w2.exercises.find((e) => e.exerciseId === "ohp")!;
  assert.equal(auxEntry.repMin, 8);
  assert.equal(auxEntry.repMax, 8);
  assert.match(auxEntry.progressionNote ?? "", /Волна недели: 3 × 8/);
});

test("withSubstitutions обновляет уже активный цикл с текущей недели, сохраняя прошлые максимумы, дни недели и биомеханику", () => {
  const cycle = LaidDupPlan.routines({
    maxes: MAXES,
    extras: true,
    light: false,
    startMonday: START,
    rhythm: "3x1x3",
  }).map((r) => ({ ...r, revision: 2 }));

  const updated = LaidDupPlan.withSubstitutions(
    cycle,
    { "deadlift-bar": "barbell-hip-thrust", "deadlift-stiff": "legcurl-prone" },
    { maxes: { ...MAXES, deadlift: 130 }, fromWeek: 2 },
  );

  assert.equal(updated.length, 6);
  // Дни недели (3+1+3) сохранены
  assert.deepEqual(
    updated.map((r) => r.days),
    cycle.map((r) => r.days),
  );
  // Прошлые недели (0..1) хранят прежние 160 кг, с недели 2 действуют 130 кг
  for (const r of updated) {
    assert.equal(LaidDupPlan.maxesFor(r.periodization!, 0).deadlift, 160);
    assert.equal(LaidDupPlan.maxesFor(r.periodization!, 2).deadlift, 130);
    assert.deepEqual(r.periodization!.substitutions, {
      "deadlift-bar": "barbell-hip-thrust",
      "deadlift-stiff": "legcurl-prone",
    });
  }

  // В Pull 1/2 заменены оба упражнения
  const pull1 = updated.find((r) => r.periodization!.day === "pull1")!;
  assert.equal(pull1.exercises[0].exerciseId, "barbell-hip-thrust");
  assert.equal(pull1.exercises[1].exerciseId, "legcurl-prone");

  // Биомеханический аудит: осевая нагрузка снижена, предупреждение о тяге перед ногами не стреляет на не-осевых заменах
  const auditBefore = BiomechanicsEngine.auditLaidCycle(cycle, [], "2026-11-12");
  const auditAfter = BiomechanicsEngine.auditLaidCycle(updated, [], "2026-11-12");
  assert.ok(auditAfter.weeklyAxialSets < auditBefore.weeklyAxialSets);
  assert.ok(!auditAfter.topSetFeedback.some((s) => s.id === "laid-pull-before-legs"));

  // Возврат к оригиналу очищает поле substitutions
  const restored = LaidDupPlan.withSubstitutions(updated, undefined, { maxes: MAXES, fromWeek: 3 });
  const restoredPull1 = restored.find((r) => r.periodization!.day === "pull1")!;
  assert.equal(restoredPull1.periodization!.substitutions, undefined);
  assert.equal(restoredPull1.exercises[0].exerciseId, "deadlift-bar");
  assert.equal(restoredPull1.exercises[1].exerciseId, "deadlift-stiff");
  assert.equal(LAID_WEEKS, 9);
});

test("Замена разведений гантелей на бабочку и превью дня с известными весами, повторами и RIR по неделям", () => {
  const fly = exerciseById("fly-db-flat")!;
  const alternatives = ExerciseAlternativesFinder.findAlternatives(fly);
  assert.ok(
    alternatives.some((a) => a.exercise.id === "pec-deck-fly"),
    "пек-дек («бабочка») должен предлагаться среди топовых альтернатив для разведений гантелей лёжа",
  );

  const cycle = LaidDupPlan.routines({
    maxes: { squat: 100, bench: 80, deadlift: 140, ohp: 60 },
    extras: true,
    light: false,
    startMonday: START,
    substitutions: { "fly-db-flat": "pec-deck-fly" },
    deloadWeeks: [6],
  });
  const push1 = cycle.find((r) => r.periodization!.day === "push1")!;
  const workouts = [doneWorkout("2026-11-05", [["pec-deck-fly", 45, 10]])];

  // Неделя 1 (волна 1): база по % DUP, бабочка — вес из истории, push-press — 3 × 4
  const week1 = LaidDupPlan.dayExercisesPreview(push1, 0, workouts, "2026-11-10");
  const bench = week1.find((x) => x.exerciseId === "bench")!;
  const pecDeck = week1.find((x) => x.exerciseId === "pec-deck-fly")!;
  const pushPressW1 = week1.find((x) => x.exerciseId === "push-press")!;

  assert.equal(bench.setsRepsLabel, "1×1 + 4×4");
  assert.equal(bench.weightLabel, "75 / 67,5 кг");
  assert.equal(bench.rirLabel, "Топ 1–2 · раб. 2–3");

  assert.equal(pecDeck.originalId, "fly-db-flat");
  assert.equal(pecDeck.isReplaced, true);
  assert.equal(pecDeck.setsRepsLabel, "3 × 10");
  assert.equal(pecDeck.weightLabel, "45 кг");
  assert.equal(pecDeck.weightSource, "history");
  assert.equal(pecDeck.rirLabel, "RIR 1–2");

  assert.equal(pushPressW1.setsRepsLabel, "3 × 4");

  // Неделя 2 (волна 1): волновая подсобка сдвигается на 3 × 8
  const week2 = LaidDupPlan.dayExercisesPreview(push1, 1, workouts, "2026-11-17");
  assert.equal(week2.find((x) => x.exerciseId === "push-press")!.setsRepsLabel, "3 × 8");

  // Разгрузочная неделя (индекс 6): вес бабочки снижен до 65 % (29,5 кг), подходы уполовинены, RIR 3–4
  const deloadWeek = LaidDupPlan.dayExercisesPreview(push1, 6, workouts, "2026-12-22");
  const pecDeckDeload = deloadWeek.find((x) => x.exerciseId === "pec-deck-fly")!;
  assert.equal(pecDeckDeload.setsRepsLabel, "1 × 10");
  assert.equal(pecDeckDeload.weightSource, "deload");
  assert.match(pecDeckDeload.weightLabel, /29,5 кг \(65 %\)/);
  assert.equal(pecDeckDeload.rirLabel, "RIR 3–4");
});

test("waveProgress считает плановые пики и фактический e1RM по волнам 1 → 2 → 3", () => {
  const cycle = LaidDupPlan.routines({
    maxes: { squat: 100, bench: 80, deadlift: 140, ohp: 60 },
    extras: true,
    light: false,
    startMonday: START,
  });

  const workouts = [
    doneWorkout("2026-11-10", [["bench", 75, 3]]), // Неделя 1 (Волна 1): e1RM = 75 * (1 + 3/30) = 82.5
    doneWorkout("2026-12-02", [["bench", 80, 3]]), // Неделя 4 (Волна 2): e1RM = 80 * 1.1 = 88
  ];

  const series = LaidDupPlan.waveProgress(cycle, workouts, "2026-12-05");
  assert.equal(series.length, 4);

  const bench = series.find((s) => s.lift === "bench")!;
  assert.equal(bench.weeks.length, 9);
  assert.equal(bench.startMaxKg, 80);
  assert.equal(bench.bestE1rm, 88);
  assert.equal(bench.deltaKg, 8);
  assert.equal(bench.waves[0].bestE1rm, 82.5);
  assert.equal(bench.waves[1].bestE1rm, 88);
  assert.equal(bench.waves[2].bestE1rm, null);
  assert.ok((bench.waves[2].plannedPeakKg ?? 0) >= (bench.waves[0].plannedPeakKg ?? 0));
});
