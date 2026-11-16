import test from "node:test";
import assert from "node:assert/strict";
import { LaidDupPlan, LAID_WEEKS } from "../src/domain/LaidDupPlan";
import { TrainingProgram } from "../src/domain/TrainingProgram";
import { WarmupPlanner } from "../src/domain/WarmupPlanner";
import { PlateLoadingCalculator } from "../src/domain/PlateLoadingCalculator";
import { EXERCISES, exerciseById, makeWorkout } from "../src/lib/model";
import type { LaidDay, LaidMaxes, Routine, Workout } from "../src/lib/types";

const MAXES: LaidMaxes = { squat: 100, bench: 80, deadlift: 140, ohp: 60 };
const TZ = "UTC";
const DAYS = LaidDupPlan.DAYS;
const six = (opts: Partial<{ maxes: LaidMaxes; extras: boolean; light: boolean; startMonday: string }> = {}) =>
  LaidDupPlan.routines({ maxes: MAXES, extras: true, light: false, startMonday: "2026-11-09", ...opts });
const byDay = (routines: Routine[], day: LaidDay) => routines.find((r) => r.periodization?.day === day)!;

// ───────────── R10-REQ01: расчёт плана ─────────────
test("R10-REQ01: округление до 2,5 кг — к ближайшему, ровно посередине большее", () => {
  assert.equal(LaidDupPlan.roundKg(77.5), 77.5);
  assert.equal(LaidDupPlan.roundKg(76), 75);
  assert.equal(LaidDupPlan.roundKg(76.25), 77.5);
  assert.equal(LaidDupPlan.roundKg(86), 85);
  assert.equal(LaidDupPlan.roundKg(68), 67.5);
  assert.equal(LaidDupPlan.roundKg(133), 132.5);
  assert.equal(LaidDupPlan.roundKg(129.5), 130);
  assert.equal(LaidDupPlan.roundKg(1.24), 0);
  assert.equal(LaidDupPlan.roundKg(1.25), 2.5);
  assert.equal(LaidDupPlan.roundKg(0), 0);
  assert.equal(LaidDupPlan.roundKg(-5), 0);
  assert.equal(LaidDupPlan.roundKg(NaN), 0);
  // дробный максимум не ломает «половину вверх»: 82,5 × 0,925 = 76,3125 → 77,5
  assert.equal(LaidDupPlan.weight(82.5, 92.5), 77.5);
});

test("R10-REQ01: примеры ТЗ — присед 100: неделя 1 Ноги 1 / Ноги 2, неделя 2 Ноги 1, неделя 4 Ноги 1", () => {
  const p = (day: LaidDay, week: number) => LaidDupPlan.day(day, week, MAXES);
  assert.deepEqual([p("legs1", 0).heavy.reps, p("legs1", 0).heavy.weightKg, p("legs1", 0).work.sets, p("legs1", 0).work.reps, p("legs1", 0).work.weightKg], [5, 85, 4, 12, 65]);
  assert.deepEqual([p("legs2", 0).heavy.reps, p("legs2", 0).heavy.weightKg, p("legs2", 0).work.reps, p("legs2", 0).work.weightKg], [3, 90, 8, 75]);
  assert.deepEqual([p("legs1", 1).heavy.reps, p("legs1", 1).heavy.weightKg, p("legs1", 1).work.reps, p("legs1", 1).work.weightKg], [1, 95, 4, 85]);
  // неделя 4 = волна 2: 86 % → 85, 66 % → 65
  assert.deepEqual([p("legs1", 3).heavy.weightKg, p("legs1", 3).work.weightKg, p("legs1", 3).position.wave], [85, 65, 2]);
});

test("R10-REQ01: критерий 3 — максимумы 100 / 80 / 140 / 60, неделя 1", () => {
  const push1 = LaidDupPlan.day("push1", 0, MAXES);
  assert.equal(LaidDupPlan.line(push1), "1 × 1 × 75 кг · 4 × 4 × 67,5 кг");
  const pull2 = LaidDupPlan.day("pull2", 0, MAXES);
  assert.equal(LaidDupPlan.line(pull2), "1 × 1 × 132,5 кг · 4 × 2 × 130 кг");
  assert.equal(LaidDupPlan.line(LaidDupPlan.day("legs1", 0, MAXES)), "1 × 5 × 85 кг · 4 × 12 × 65 кг");
  // армейский жим 60: Push 2, неделя 1 — 5 повторений 85 % = 51 → 50, рабочие 4 × 12 × 65 % = 39 → 40
  assert.equal(LaidDupPlan.line(LaidDupPlan.day("push2", 0, MAXES)), "1 × 5 × 50 кг · 4 × 12 × 40 кг");
});

test("R10-REQ01: схема всех 9 недель × 6 дней совпадает с таблицей исследования", () => {
  // [тяжёлый подход, рабочие повторения] по неделе волны 1 / 2 / 3
  const table: Record<LaidDay, [number, number][]> = {
    legs1: [[5, 12], [1, 4], [3, 8]],
    push1: [[1, 4], [3, 8], [5, 12]],
    pull1: [[3, 6], [1, 2], [5, 10]],
    legs2: [[3, 8], [5, 12], [1, 4]],
    push2: [[5, 12], [1, 4], [3, 8]],
    pull2: [[1, 2], [5, 10], [3, 6]],
  };
  const heavyPct: Record<number, number[]> = { 5: [85, 86, 88], 3: [90, 91, 92.5], 1: [95, 96.5, 97.5] };
  const workPct: Record<number, number[]> = { 12: [65, 66, 67], 10: [70, 71, 72], 8: [75, 76, 77], 6: [80, 81, 82], 4: [85, 86, 87], 2: [92.5, 93, 93.5] };
  for (let week = 0; week < LAID_WEEKS; week++)
    for (const day of DAYS) {
      const plan = LaidDupPlan.day(day, week, MAXES);
      const [heavy, work] = table[day][week % 3];
      const wave = Math.floor(week / 3);
      assert.equal(plan.position.wave, wave + 1);
      assert.equal(plan.heavy.reps, heavy, `${day} н.${week + 1}`);
      assert.equal(plan.work.reps, work, `${day} н.${week + 1}`);
      assert.equal(plan.heavy.percent, heavyPct[heavy][wave]);
      assert.equal(plan.work.percent, workPct[work][wave]);
      assert.equal(plan.heavy.weightKg, LaidDupPlan.roundKg((MAXES[plan.lift] * heavyPct[heavy][wave]) / 100));
      assert.equal(plan.work.weightKg, LaidDupPlan.roundKg((MAXES[plan.lift] * workPct[work][wave]) / 100));
      assert.equal(plan.work.sets, 4);
      assert.equal(plan.heavy.light, false);
    }
});

test("R10-REQ01: базовое упражнение дня — присед / жим / становая / армейский жим по таблице", () => {
  const lift = Object.fromEntries(DAYS.map((d) => [d, LaidDupPlan.day(d, 0, MAXES).liftExerciseId]));
  assert.deepEqual(lift, { legs1: "squat", legs2: "squat", push1: "bench", push2: "ohp-bar", pull1: "deadlift-bar", pull2: "deadlift-bar" });
  assert.equal(exerciseById("ohp-bar")!.name, "Жим штанги стоя");
});

test("R10-REQ01: неделя 10 и дальше — схема недели 9 и пометка «цикл закончен»; до старта и мусор не ломают расчёт", () => {
  const w9 = LaidDupPlan.day("legs1", 8, MAXES);
  const w10 = LaidDupPlan.day("legs1", 9, MAXES);
  const w25 = LaidDupPlan.day("legs1", 24, MAXES);
  assert.deepEqual([w10.heavy, w10.work], [w9.heavy, w9.work]);
  assert.deepEqual([w25.heavy, w25.work], [w9.heavy, w9.work]);
  assert.equal(w9.position.finished, false);
  assert.equal(w10.position.finished, true);
  assert.match(LaidDupPlan.weekLabel(w10.position), /Неделя 10.*цикл закончен — обнови максимумы/);
  assert.equal(LaidDupPlan.weekLabel(w9.position), "Неделя 9 из 9 · волна 3");
  for (const raw of [-1, -40, NaN, Infinity]) {
    const plan = LaidDupPlan.day("push1", raw, MAXES);
    assert.ok(plan.position.week >= 0 && plan.position.week < LAID_WEEKS);
    assert.ok(Number.isFinite(plan.heavy.weightKg));
  }
  assert.equal(LaidDupPlan.day("push1", -3, MAXES).position.beforeStart, true);
  assert.equal(LaidDupPlan.weekLabel(LaidDupPlan.position(3)), "Неделя 4 из 9 · волна 2");
});

test("R10-REQ01: «облегчённо» — три повторения вместо одного: 90 / 91 / 92,5 % по волнам, остальные подходы без изменений", () => {
  const light = (day: LaidDay, week: number) => LaidDupPlan.day(day, week, MAXES, { light: true });
  const l1 = light("legs1", 1);
  assert.deepEqual([l1.heavy.reps, l1.heavy.percent, l1.heavy.weightKg, l1.heavy.light], [3, 90, 90, true]);
  assert.equal(light("legs1", 4).heavy.percent, 91);
  assert.equal(light("legs1", 7).heavy.percent, 92.5);
  // там, где по таблице не одно повторение, подход остаётся прежним
  assert.deepEqual(light("legs1", 0).heavy, LaidDupPlan.day("legs1", 0, MAXES).heavy);
  assert.deepEqual(light("legs1", 2).heavy, LaidDupPlan.day("legs1", 2, MAXES).heavy);
  assert.deepEqual(light("legs1", 1).work, LaidDupPlan.day("legs1", 1, MAXES).work);
  assert.match(LaidDupPlan.describe(l1), /облегчённо, не по оригиналу/);
});

test("R10-REQ01: блок «добавлено» — состав по дням включён и выключен", () => {
  const ids = (routines: Routine[], day: LaidDay) => byDay(routines, day).exercises.map((e) => e.exerciseId);
  const on = six({ extras: true });
  const off = six({ extras: false });
  assert.ok(ids(on, "pull1").includes("rear-delt-fly") && ids(on, "pull2").includes("rear-delt-fly"));
  assert.ok(ids(on, "push1").includes("lateral-cable-single") && ids(on, "push2").includes("lateral-cable-single"));
  assert.ok(ids(on, "legs1").includes("hanging-leg-raise"));
  assert.ok(!ids(on, "legs2").includes("hanging-leg-raise"));
  assert.ok(ids(on, "pull2").includes("ab-roller") && !ids(on, "pull1").includes("ab-roller"));
  const added = new Set(["rear-delt-fly", "lateral-cable-single", "hanging-leg-raise", "ab-roller"]);
  for (const day of DAYS) {
    assert.ok(!ids(off, day).some((id) => added.has(id)), `${day}: без блока «добавлено» добавленных нет`);
    assert.deepEqual(ids(off, day), LaidDupPlan.originalIds(day), `${day}: без блока остаётся ровно оригинал`);
    for (const id of ids(on, day)) assert.equal(LaidDupPlan.isAdded(day, id), added.has(id), `${day} ${id}`);
  }
});

test("R10-REQ01: состав оригинала — шесть дней по таблице, названия упражнений есть в каталоге", () => {
  const names = (day: LaidDay) => byDay(six({ extras: false }), day).exercises.map((e) => exerciseById(e.exerciseId)!.name);
  assert.deepEqual(names("legs1"), ["Приседания со штангой", "Румынская тяга со штангой", "Выпады со штангой", "Гиперэкстензия"]);
  assert.deepEqual(names("push1"), [
    "Жим штанги лёжа", "Жим штанги с ног (push press)", "Отжимания на брусьях с дополнительным весом", "Разведения гантелей лёжа",
    "Махи гантелями в стороны", "Французский жим с EZ-штангой лёжа на наклонной", "Разгибание гантели из-за головы",
  ]);
  assert.deepEqual(names("pull1"), [
    "Становая тяга со штангой", "Становая тяга на прямых ногах", "Подтягивания с дополнительным весом", "Тяга Йейтса",
    "Шраги со штангой", "Подъём штанги на бицепс стоя", "Молотковые сгибания сидя",
  ]);
  assert.deepEqual(names("push2"), [
    "Жим штанги стоя", "Жим штанги на наклонной скамье 30°", "Отжимания на брусьях с дополнительным весом", "Махи гантелями в стороны",
    "Французский жим с EZ-штангой лёжа на наклонной", "Разгибание гантели из-за головы",
  ]);
  assert.deepEqual(names("legs2"), names("legs1"));
  assert.deepEqual(names("pull2").slice(1), names("pull1").slice(1));
});

test("R10-REQ06: новые записи каталога — честные, с мышцами, снарядом и правилом веса; ни одна не подменяет соседнюю", () => {
  const fresh = ["push-press", "dip-weighted", "fly-db-flat", "row-yates", "deadlift-stiff", "hammer-seated", "lunge-bar"];
  for (const id of fresh) {
    const e = exerciseById(id)!;
    assert.ok(e, id);
    assert.equal(e.catalogRevision, 3);
    assert.ok(e.muscles.some((m) => m.role === "primary"), `${id}: есть основная мышца`);
    assert.ok(e.limitations.length > 40, `${id}: сказано, чего запись не знает`);
    assert.equal(e.provenance.reviewStatus, "editorial");
  }
  assert.equal(exerciseById("dip-weighted")!.recording.loadMode, "added_bodyweight");
  assert.equal(exerciseById("lunge-bar")!.recording.repsMode, "per_side");
  assert.notEqual(exerciseById("push-press")!.familyId + exerciseById("push-press")!.name, exerciseById("ohp-bar")!.familyId + exerciseById("ohp-bar")!.name);
  assert.equal(new Set(EXERCISES.map((e) => e.name)).size, EXERCISES.length, "названия в каталоге не повторяются");
  // все упражнения программы есть в каталоге
  for (const r of six()) for (const e of r.exercises) assert.ok(exerciseById(e.exerciseId), e.exerciseId);
});

// ───────────── R10-REQ02/03: создание и запуск ─────────────
test("R10-REQ02: шесть программ с русскими названиями, днями Пн–Сб и общей настройкой", () => {
  const routines = six();
  assert.deepEqual(routines.map((r) => r.name), ["Лейд · Ноги 1", "Лейд · Жим 1", "Лейд · Тяга 1", "Лейд · Ноги 2", "Лейд · Жим 2", "Лейд · Тяга 2"]);
  assert.deepEqual(routines.map((r) => r.days), [[0], [1], [2], [3], [4], [5]]);
  assert.match(routines[0].notes, /Legs 1/);
  assert.equal(new Set(routines.map((r) => r.id)).size, 6);
  assert.equal(new Set(routines.map((r) => r.periodization!.cycleId)).size, 1);
  for (const r of routines) {
    assert.deepEqual(r.periodization!.maxes, MAXES);
    assert.equal(r.periodization!.startMonday, "2026-11-09");
    assert.equal(r.cycle, undefined, "разгрузочный цикл обычных программ к Лейду не применяется");
  }
  assert.equal(LaidDupPlan.cycles([...routines, TrainingProgram.empty()]).length, 1);
});

test("R10-REQ02: проверка введённого максимума — пусто, не число, ≤ 0, > 500, запятая и точка", () => {
  assert.equal(LaidDupPlan.checkMax("").error, "Введи максимум в килограммах.");
  assert.match(LaidDupPlan.checkMax("abc").error!, /число/);
  assert.match(LaidDupPlan.checkMax("0").error!, /больше нуля/);
  assert.match(LaidDupPlan.checkMax("-5").error!, /число/);
  assert.match(LaidDupPlan.checkMax("501").error!, /не больше 500/);
  assert.deepEqual(LaidDupPlan.checkMax("102,5"), { value: 102.5, error: null });
  assert.deepEqual(LaidDupPlan.checkMax(" 102.5 "), { value: 102.5, error: null });
  assert.deepEqual(LaidDupPlan.checkMax("500"), { value: 500, error: null });
});

test("R10-REQ02: старт — понедельник этой или следующей недели; по умолчанию пн–ср — эта, чт–вс — следующая", () => {
  // 2026-11-10 — вторник
  assert.equal(LaidDupPlan.startMonday("2026-11-10", "this"), "2026-11-09");
  assert.equal(LaidDupPlan.startMonday("2026-11-10", "next"), "2026-11-16");
  assert.equal(LaidDupPlan.startMonday("2026-11-09", "this"), "2026-11-09");
  assert.equal(LaidDupPlan.startMonday("2026-11-15", "this"), "2026-11-09", "воскресенье — ещё прежняя неделя");
  const defaults = ["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14", "2026-11-15"].map((d) => LaidDupPlan.defaultStart(d));
  assert.deepEqual(defaults, ["this", "this", "this", "next", "next", "next", "next"]);
});

test("R10-REQ03: номер недели по календарю от понедельника старта; до старта — отрицательный, пропущенные недели считаются", () => {
  assert.equal(LaidDupPlan.weekOf("2026-11-09", "2026-11-09"), 0);
  assert.equal(LaidDupPlan.weekOf("2026-11-09", "2026-11-15"), 0);
  assert.equal(LaidDupPlan.weekOf("2026-11-09", "2026-11-16"), 1);
  assert.equal(LaidDupPlan.weekOf("2026-11-09", "2027-01-04"), 8);
  assert.equal(LaidDupPlan.weekOf("2026-11-09", "2027-01-11"), 9);
  assert.equal(LaidDupPlan.weekOf("2026-11-09", "2026-11-08"), -1);
  assert.equal(LaidDupPlan.weekOf("2026-11-16", "2026-11-10"), -1);
  // через перевод стрелок и границу года счёт не плывёт
  assert.equal(LaidDupPlan.weekOf("2026-03-23", "2026-04-06"), 2);
  assert.equal(LaidDupPlan.weekOf("2026-12-28", "2027-01-04"), 1);
});

const laidDone = (routine: Routine, date: string): Workout => ({ ...makeWorkout([], [], TZ), id: `w-${routine.id}-${date}`, date, routineId: routine.id });

test("R10-REQ03: старт Ноги 1 недели 1 — тяжёлый подход, четыре рабочих, заметка недели, вспомогательные без выдуманных чисел", () => {
  const legs1 = byDay(six(), "legs1");
  const workout = new TrainingProgram(legs1).start([], TZ, "2026-11-09");
  assert.equal(workout.name, "Лейд · Ноги 1");
  assert.equal(workout.routineId, legs1.id);
  assert.match(workout.notes, /Неделя 1 из 9 · волна 1/);
  const squat = workout.exercises[0];
  assert.equal(squat.exerciseId, "squat");
  assert.deepEqual(squat.sets.map((s) => [s.weight, s.reps, s.warmup, s.done]), [[85, 5, false, false], ...Array.from({ length: 4 }, () => [65, 12, false, false])]);
  assert.match(squat.progressionNote!, /1 × 5 повторений · 85 % от 1ПМ \(100 кг\) = 85 кг/);
  assert.match(squat.progressionNote!, /Затем 4 × 12 · 65 % = 65 кг/);
  assert.doesNotMatch(squat.progressionNote!, /5ПМ/);
  const rdl = workout.exercises[1];
  assert.deepEqual(rdl.sets.map((s) => [s.weight, s.reps]), [[0, 0], [0, 0], [0, 0]], "без истории вес и повторы пусты");
  assert.equal(rdl.repMin, 10);
  assert.equal(rdl.progressionNote, undefined, "оригинальное упражнение без пометки «добавлено»");
  const last = workout.exercises.at(-1)!;
  assert.equal(last.exerciseId, "hanging-leg-raise");
  assert.match(last.progressionNote!, /Добавлено к оригиналу/);
  assert.equal(new Set(workout.exercises.flatMap((e) => e.sets.map((s) => s.id))).size, workout.exercises.reduce((n, e) => n + e.sets.length, 0));
});

test("R10-REQ03: вспомогательные берут вес из «Прошлого»; тяжёлый подход его не подменяет", () => {
  const legs1 = byDay(six(), "legs1");
  const prior = new TrainingProgram(legs1).start([], TZ, "2026-11-09");
  prior.exercises[0].sets.forEach((s) => ((s.weight = 120), (s.done = true)));
  prior.exercises[1].sets.forEach((s) => ((s.weight = 90), (s.reps = 9), (s.done = true)));
  const next = new TrainingProgram(legs1).start([{ ...prior, id: "prev", date: "2026-11-09" }], TZ, "2026-11-16");
  assert.deepEqual(next.exercises[0].sets.map((s) => s.weight), [95, 85, 85, 85, 85], "неделя 2: 1 × 1 × 95 и 4 × 4 × 85 по плану, а не 120 из истории");
  assert.deepEqual(next.exercises[1].sets.map((s) => [s.weight, s.reps]), [[90, 9], [90, 9], [90, 9]]);
});

test("R10-REQ03: недельные повторения push press и жима на наклонной; Жим 1 и Жим 2 собираются по своей неделе", () => {
  const routines = six();
  const reps = (day: LaidDay, id: string, date: string) => {
    const w = new TrainingProgram(byDay(routines, day)).start([], TZ, date);
    return w.exercises.find((e) => e.exerciseId === id)!.repMin;
  };
  assert.deepEqual(["2026-11-10", "2026-11-17", "2026-11-24"].map((d) => reps("push1", "push-press", d)), [4, 8, 12]);
  assert.deepEqual(["2026-11-10", "2026-11-17", "2026-11-24"].map((d) => reps("push2", "incline-bar", d)), [12, 4, 8]);
  // неделя 4 — снова первая неделя волны
  assert.equal(reps("push1", "push-press", "2026-11-30"), 4);
});

test("R10-REQ03: подмена даты — недели 1, 2, 5, 9, 10, до старта", () => {
  const legs1 = byDay(six(), "legs1");
  const at = (date: string) => new TrainingProgram(legs1).start([], TZ, date);
  const sets = (w: Workout) => w.exercises[0].sets.map((s) => `${s.weight}×${s.reps}`);
  assert.deepEqual(sets(at("2026-11-09")), ["85×5", "65×12", "65×12", "65×12", "65×12"]);
  assert.deepEqual(sets(at("2026-11-16")), ["95×1", "85×4", "85×4", "85×4", "85×4"]);
  // неделя 5 (волна 2, неделя 2): присед 1 × 1 × 96,5 % = 96,5 → 97,5; 4 × 4 × 86 % = 86 → 85
  assert.deepEqual(sets(at("2026-12-07")), ["97.5×1", "85×4", "85×4", "85×4", "85×4"]);
  // неделя 9 (волна 3, неделя 3): присед 3 × 92,5 % = 92,5; 4 × 8 × 77 % = 77 → 77,5
  const w9 = at("2027-01-04");
  assert.deepEqual(sets(w9), ["92.5×3", "77.5×8", "77.5×8", "77.5×8", "77.5×8"]);
  assert.match(w9.notes, /Неделя 9 из 9 · волна 3/);
  const w10 = at("2027-01-11");
  assert.deepEqual(sets(w10), sets(w9), "неделя 10 — схема недели 9");
  assert.match(w10.notes, /цикл закончен — обнови максимумы/);
  assert.deepEqual(sets(at("2026-11-03")), sets(at("2026-11-09")), "до старта — как первая неделя");
});

test("R10-REQ03: разминка и калькулятор блинов считаются от веса тяжёлого подхода; разминка вне рабочего тоннажа", () => {
  const w = new TrainingProgram(byDay(six(), "legs1")).start([], TZ, "2026-11-16");
  const squat = w.exercises[0];
  const warmup = new WarmupPlanner(squat).create();
  assert.equal(squat.sets[0].weight, 95);
  assert.deepEqual(warmup.map((s) => s.weight), [37.5, 57.5, 75], "40 / 60 / 80 % от 95 кг (округлено до 2,5), а не от рабочих 85");
  assert.ok(warmup.every((s) => s.warmup));
  const plates = PlateLoadingCalculator.calculate(squat.sets[0].weight);
  assert.equal(plates.actualLoaded, 95);
  assert.deepEqual(plates.plates, [25, 10, 2.5]);
  const withWarmup = { ...squat, sets: [...warmup, ...squat.sets] };
  const working = withWarmup.sets.filter((s) => !s.warmup);
  assert.equal(working.length, 5);
});

test("R10-REQ03: обычные программы запускаются как раньше: разгрузочный цикл и «Прошлое»", () => {
  const plain = TrainingProgram.starter("strength")[0];
  const w = new TrainingProgram(plain).start([], TZ, "2026-11-09");
  assert.equal(w.exercises.length, 3);
  assert.equal(w.notes, plain.notes);
  assert.equal(plain.periodization, undefined);
  // цикл разгрузки у программы с периодизацией не срабатывает, даже если поле cycle осталось
  const odd = { ...byDay(six(), "legs1"), cycle: { weeks: 2, deloadWeek: 1, setFactor: 0.5, weightFactor: 0.7, deloadRir: 4 } };
  const lagging = new TrainingProgram(odd).start([laidDone(odd, "2026-11-09")], TZ, "2026-11-16");
  assert.equal(lagging.exercises[0].sets.length, 5);
  assert.equal(lagging.exercises[0].sets[0].weight, 95);
});

// ───────────── R10-REQ04: расписание, отметки, подсказки ─────────────
test("R10-REQ04: «Сделана» / «Пропущена» / «Впереди»; дни до старта и будущее пропущенными не считаются", () => {
  const routines = six({ startMonday: "2026-11-09" });
  const legs1 = byDay(routines, "legs1"); // понедельник
  const push1 = byDay(routines, "push1"); // вторник
  const history = [laidDone(legs1, "2026-11-10")];
  // сегодня среда 11 нояб., неделя 1
  assert.deepEqual(LaidDupPlan.status(legs1, history, 0, "2026-11-11"), { state: "done", date: "2026-11-10" });
  assert.deepEqual(LaidDupPlan.status(push1, history, 0, "2026-11-11"), { state: "missed" });
  assert.deepEqual(LaidDupPlan.status(byDay(routines, "pull1"), history, 0, "2026-11-11"), { state: "ahead" }, "среда ещё идёт");
  assert.deepEqual(LaidDupPlan.status(byDay(routines, "pull1"), history, 0, "2026-11-12"), { state: "missed" });
  assert.deepEqual(LaidDupPlan.status(legs1, history, 1, "2026-11-11"), { state: "ahead" });
  assert.deepEqual(LaidDupPlan.status(legs1, history, 0, "2026-11-20"), { state: "done", date: "2026-11-10" });
  assert.deepEqual(LaidDupPlan.status(push1, history, 0, "2026-11-20"), { state: "missed" });
  // до старта ничего не пропущено: старт со следующего понедельника
  const later = six({ startMonday: "2026-11-16" });
  assert.deepEqual(LaidDupPlan.status(byDay(later, "legs1"), [], 0, "2026-11-12"), { state: "ahead" });
  // тренировка другой программы не засчитывается
  assert.deepEqual(LaidDupPlan.status(push1, [laidDone(legs1, "2026-11-10")], 0, "2026-11-20"), { state: "missed" });
});

test("R10-REQ04: оценка 1ПМ по истории — Эпли, 100 × 8 → 126,7; без истории — null; рабочие подходы без отметки не считаются", () => {
  const w = makeWorkout(["bench"], [], TZ, true);
  w.date = "2026-11-02";
  w.exercises[0].sets = [
    { id: "a", weight: 100, reps: 8, rir: 2, warmup: false, done: true },
    { id: "b", weight: 150, reps: 8, rir: 2, warmup: false, done: false },
    { id: "c", weight: 150, reps: 8, rir: 2, warmup: true, done: true },
  ];
  assert.equal(LaidDupPlan.estimate([w], "bench"), 126.7);
  assert.equal(LaidDupPlan.estimate([w], "squat"), null);
  assert.deepEqual(LaidDupPlan.estimates([w], "2026-11-16"), { squat: null, bench: 126.7, deadlift: null, ohp: null });
  assert.equal(LaidDupPlan.estimates([w], "2027-06-16").bench, null, "за полгода назад старше — не считается");
});

test("R10-REQ04: «Можно обновить максимум» — от 5 % выше введённого, по свежим подходам; граница 4,9 % и 5 %", () => {
  const p = byDay(six({ maxes: { squat: 100, bench: 80, deadlift: 140, ohp: 60 } }), "push1").periodization!;
  const set = (weight: number, reps: number) => ({ id: crypto.randomUUID(), weight, reps, rir: null, warmup: false, done: true });
  const doneAt = (date: string, sets: ReturnType<typeof set>[]): Workout => {
    const w = makeWorkout(["bench"], [], TZ, true);
    w.date = date;
    w.exercises[0].sets = sets;
    return w;
  };
  // 84 кг × 1 = 84 = +5 % к 80 → подсказка; 83,9 — нет
  assert.equal(LaidDupPlan.suggestion(p, [doneAt("2026-11-10", [set(84, 1)])], "2026-11-12").length, 1);
  assert.equal(LaidDupPlan.suggestion(p, [doneAt("2026-11-10", [set(83.9, 1)])], "2026-11-12").length, 0);
  const found = LaidDupPlan.suggestion(p, [doneAt("2026-11-10", [set(90, 1)])], "2026-11-12")[0];
  assert.deepEqual([found.lift, found.from, found.estimate, found.to], ["bench", 80, 90, 90]);
  // 100 × 8 → 126,7: предлагается 125 (вниз до 2,5), а не 126,7
  assert.equal(LaidDupPlan.suggestion(p, [doneAt("2026-11-10", [set(100, 8)])], "2026-11-12")[0].to, 125);
  // старше 28 дней — не свежие подходы
  assert.equal(LaidDupPlan.suggestion(p, [doneAt("2026-09-01", [set(100, 1)])], "2026-11-12").length, 0);
  // подходы до действующей настройки (обновление с недели 2) не считаются
  const updated = LaidDupPlan.withMaxes(p, { ...p.maxes, bench: 85 }, 1);
  assert.equal(LaidDupPlan.suggestion(updated, [doneAt("2026-11-10", [set(100, 1)])], "2026-11-18").length, 0);
  assert.equal(LaidDupPlan.suggestion(updated, [doneAt("2026-11-16", [set(100, 1)])], "2026-11-18").length, 1);
});

test("R10-REQ04: пересчёт максимумов с текущей недели — прошлые недели остаются на прежних числах", () => {
  const routines = six({ startMonday: "2026-11-09" });
  const legs1 = byDay(routines, "legs1");
  // сегодня неделя 2 (индекс 1): новые максимумы действуют с неё
  const updated = { ...legs1, periodization: LaidDupPlan.withMaxes(legs1.periodization!, { ...MAXES, squat: 120 }, 1) };
  const at = (date: string) => LaidDupPlan.planFor(updated, date)!;
  assert.equal(at("2026-11-09").heavy.weightKg, 85, "неделя 1 — по прежним 100 (85 %)");
  assert.equal(at("2026-11-16").heavy.weightKg, 115, "неделя 2 — по новым 120: 95 % = 114 → 115");
  assert.equal(at("2026-11-23").maxKg, 120);
  assert.deepEqual(updated.periodization.earlier, [{ fromWeek: 0, maxes: MAXES }]);
  // повторное обновление: цепочка прежних сохраняется по возрастанию недель
  const again = LaidDupPlan.withMaxes(updated.periodization, { ...MAXES, squat: 130 }, 3);
  assert.deepEqual(again.earlier!.map((e) => e.fromWeek), [0, 1]);
  assert.equal(LaidDupPlan.maxesFor(again, 2).squat, 120);
  assert.equal(LaidDupPlan.maxesFor(again, 3).squat, 130);
  assert.equal(LaidDupPlan.maxesFor(again, 0).squat, 100);
  // обновление с той же недели заменяет настройку, а не копит дубли
  const sameWeek = LaidDupPlan.withMaxes(updated.periodization, { ...MAXES, squat: 125 }, 1);
  assert.deepEqual(sameWeek.earlier!.map((e) => e.fromWeek), [0]);
  assert.equal(LaidDupPlan.maxesFor(sameWeek, 1).squat, 125);
});
