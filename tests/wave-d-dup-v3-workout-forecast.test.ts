import test from "node:test";
import assert from "node:assert/strict";
import { LaidDupPlan } from "../src/domain/LaidDupPlan";
import { PeriodizationRules } from "../src/domain/PeriodizationRules";
import { TrainingProgram } from "../src/domain/TrainingProgram";
import { LivePrDetector } from "../src/domain/LivePrDetector";
import { ExerciseSwap } from "../src/domain/ExerciseSwap";
import { StrengthForecast } from "../src/domain/StrengthForecast";
import { StrengthTotal } from "../src/domain/StrengthTotal";
import { BiomechanicsProfileStore } from "../src/domain/BiomechanicsProfile";
import { EXERCISES } from "../src/lib/catalog";
import { makeExerciseEntry, makeWorkout } from "../src/lib/model";
import type { Exercise, LaidMaxes, Workout } from "../src/lib/types";

const MAXES: LaidMaxes = { squat: 140, bench: 100, deadlift: 160, ohp: 80 };
const START = "2026-10-05";

function doneSession(
  id: string,
  date: string,
  items: Array<{
    exerciseId: string;
    weight: number;
    reps: number;
    rir?: number | null;
    rom?: "full" | "shortened_partial" | "lengthened_partial";
    machineInstanceId?: string;
    grip?: "pronated" | "supinated" | "neutral" | "wide" | "narrow" | "mixed";
  }>,
  name = "Тренировка",
  revision = 1,
): Workout {
  const w = makeWorkout(items.map((x) => x.exerciseId), [], "UTC", true);
  w.id = id;
  w.name = name;
  w.date = date;
  w.revision = revision;
  w.exercises = w.exercises.map((e, i) => {
    const it = items[i];
    return {
      ...e,
      ...(it.machineInstanceId ? { machineInstanceId: it.machineInstanceId } : {}),
      ...(it.grip || it.rom
        ? {
            execution: {
              ...(it.grip ? { grip: it.grip } : {}),
              ...(it.rom ? { rom: it.rom } : {}),
            },
          }
        : {}),
      sets: [
        {
          id: `${id}-${i}-0`,
          weight: it.weight,
          reps: it.reps,
          rir: it.rir === undefined ? 2 : it.rir,
          warmup: false,
          done: true,
        },
      ],
    };
  });
  return w;
}

test("DUP v3 respects longLevers profile (no || true), allows disabling week 6 deload, and binds legs2 RDL to deadlift", () => {
  const origLocalStorage = (globalThis as { localStorage?: unknown }).localStorage;
  const mem = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, v); },
    removeItem: (k: string) => { mem.delete(k); },
  };
  try {
    // 1. longLevers = false must use standard loadDrop (12% on W1 H), NOT long-lever 15%
    BiomechanicsProfileStore.save({ longLevers: false, biacromialCm: null });
    const stdW1 = LaidDupPlan.day("push1", 0, MAXES, { version: "v3" });
    assert.equal(
      stdW1.v3LoadDropPct,
      12,
      `Expected standard 12% load drop when longLevers=false, got ${stdW1.v3LoadDropPct}%`,
    );

    // 2. Disabling Week 6 deload via withDeloadWeek(v3, 5, false) actually turns off deload & passes PeriodizationRules
    const v3 = LaidDupPlan.routines({
      version: "v3",
      maxes: MAXES,
      extras: true,
      light: true,
      startMonday: START,
    });
    const noDeload = LaidDupPlan.withDeloadWeek(v3, 5, false);
    const pNoDeload = noDeload[0].periodization!;
    assert.equal(PeriodizationRules.check(pNoDeload).ok, true);
    assert.equal(
      LaidDupPlan.isDeloadWeek(pNoDeload, 5),
      false,
      "Disabling Week 6 deload on v3 must make week 6 non-deload",
    );
    const w6Plan = LaidDupPlan.day("push1", 5, MAXES, {
      version: "v3",
      deloadWeeks: pNoDeload.deloadWeeks,
    });
    assert.equal(w6Plan.isDeload, false, "LaidDupPlan.day must honor disabled deloadWeeks: [] on v3");
    assert.equal(w6Plan.work.sets, 2);

    // 3. legs2 on v3 is RDL (75% of deadlift TM): deadlift painFlag must protect legs2, squat painFlag must not
    const dlPainLegs2 = LaidDupPlan.day("legs2", 0, MAXES, { version: "v3", painFlags: ["deadlift"] });
    assert.equal(dlPainLegs2.lift, "deadlift");
    assert.equal(dlPainLegs2.prescriptionMode, "rir_range");
    assert.equal(dlPainLegs2.heavy.weightKg, 0);

    const sqPainLegs2 = LaidDupPlan.day("legs2", 0, MAXES, { version: "v3", painFlags: ["squat"] });
    assert.equal(sqPainLegs2.prescriptionMode, "percent_1rm");
    assert.ok(sqPainLegs2.heavy.weightKg > 0);
  } finally {
    if (origLocalStorage === undefined) delete (globalThis as { localStorage?: unknown }).localStorage;
    else (globalThis as { localStorage?: unknown }).localStorage = origLocalStorage;
  }
});

test("DUP v3 version-aware helpers, TM autoreg guards, suggestion/autoMaxes, waveProgress, superset preservation & guidance", () => {
  const v3 = LaidDupPlan.routines({
    version: "v3",
    maxes: MAXES,
    extras: true,
    light: true,
    startMonday: START,
  });
  const first = v3[0].periodization!;

  // Version-aware base exercise IDs (trap-bar-deadlift & incline-bar)
  assert.equal(LaidDupPlan.liftExerciseId("deadlift", undefined, "v3"), "trap-bar-deadlift");
  assert.equal(LaidDupPlan.liftExerciseId("ohp", undefined, "v3"), "incline-bar");

  // cycleSummary & calibrationReady find trap-bar-deadlift and incline-bar workouts on v3
  const v3Workouts = [
    doneSession("v3-1", "2026-10-07", [{ exerciseId: "trap-bar-deadlift", weight: 150, reps: 5, rir: 2 }]),
    doneSession("v3-2", "2026-10-09", [{ exerciseId: "incline-bar", weight: 75, reps: 6, rir: 2 }]),
    doneSession("v3-3", "2026-10-14", [{ exerciseId: "trap-bar-deadlift", weight: 155, reps: 5, rir: 2 }]),
    doneSession("v3-4", "2026-10-16", [{ exerciseId: "incline-bar", weight: 80, reps: 5, rir: 2 }]),
  ];
  const summary = LaidDupPlan.cycleSummary(v3, v3Workouts, "2026-11-20");
  const dlSum = summary.lifts.find((l) => l.lift === "deadlift")!;
  const ohpSum = summary.lifts.find((l) => l.lift === "ohp")!;
  assert.ok(dlSum.bestE1rm !== null && dlSum.bestE1rm > 170, `v3 summary missed trap-bar-deadlift (got ${dlSum.bestE1rm})`);
  assert.ok(ohpSum.bestE1rm !== null && ohpSum.bestE1rm > 85, `v3 summary missed incline-bar (got ${ohpSum.bestE1rm})`);

  const calP = { ...first, calibrationLifts: ["deadlift", "ohp"] as ("deadlift" | "ohp")[] };
  const ready = LaidDupPlan.calibrationReady(calP, v3Workouts, "2026-10-18");
  assert.deepEqual(ready.map((r) => r.lift).sort(), ["deadlift", "ohp"]);

  // autoMaxes must return null when 6-week v3 cycle is finished (week 7 = 2026-11-16)
  const finishedAuto = LaidDupPlan.autoMaxes(
    first,
    [doneSession("v3-big", "2026-11-12", [{ exerciseId: "bench", weight: 130, reps: 1, rir: 0 }])],
    "2026-11-18",
  );
  assert.equal(finishedAuto, null, "Finished 6-week v3 cycle must not auto-escalate maxes");

  // suggestion on v2/v3 compares 90% TM (NOT raw 1RM) so 100 kg TM with 105 kg e1RM (TM=95) does NOT inflate
  const noInflate = LaidDupPlan.suggestion(
    first,
    [doneSession("v3-norm", "2026-10-08", [{ exerciseId: "bench", weight: 90, reps: 5, rir: 2 }])], // e1RM=105, 90% TM=95 <= 100
    "2026-10-12",
  );
  assert.equal(noInflate.length, 0, "v3 90% TM must not inflate from raw e1RM=105 when current TM=100");

  // tmAutoregSuggestions on v3 must skip sessions with null RIR (no fabricated RIR=2) and out-of-range weights (>12% off)
  const nullRirBench = doneSession("v3-null-rir", "2026-10-07", [{ exerciseId: "bench", weight: 82.5, reps: 10, rir: null }]);
  const wildWeightBench = doneSession("v3-wild", "2026-10-08", [{ exerciseId: "bench", weight: 40, reps: 12, rir: 4 }]);
  assert.deepEqual(
    LaidDupPlan.tmAutoregSuggestions(first, [nullRirBench, wildWeightBench], "2026-10-11"),
    [],
    "v3 TM autoreg must ignore null-RIR sets and out-of-range weights",
  );

  // withSubstitutions preserves supersetId on v3 Upper B & populates assistanceKg on assisted_bodyweight
  const subbed = LaidDupPlan.withSubstitutions(v3, {
    lateral: "lateral-cable-single",
    "pullup-weighted": "pullup-assisted",
  });
  const upperBSub = subbed.find((r) => r.periodization!.day === "push2")!;
  const latSub = upperBSub.exercises.find((e) => e.exerciseId === "lateral-cable-single")!;
  assert.ok(latSub.supersetId?.includes("B"), "withSubstitutions must preserve supersetId");
  const pullASub = subbed.find((r) => r.periodization!.day === "pull1")!;
  const assistedEntry = pullASub.exercises.find((e) => e.exerciseId === "pullup-assisted")!;
  assert.equal(assistedEntry.sets[0].assistanceKg, 0, "assisted_bodyweight replacement must include assistanceKg");

  // buildExerciseGuidance resolves substituted v3 slot (keeps SS tag and LP on Week 4/5)
  const upperBPlanW4 = LaidDupPlan.day("push2", 3, MAXES, { version: "v3", substitutions: { lateral: "lateral-cable-single" } });
  const latGuidance = LaidDupPlan.exerciseGuidance("push2", "lateral-cable-single", upperBPlanW4, { lateral: "lateral-cable-single" });
  assert.equal(latGuidance.supersetTag, "SS B1", "Substituted v3 superset exercise must preserve SS tag");
  assert.equal(latGuidance.lengthenedPartials, true, "Substituted v3 LP-eligible exercise on Week 4 must keep LP");

  // restSecondsForSet & describe respect plan.isDeload and version v3
  const w6DeloadPlan = LaidDupPlan.day("push1", 5, MAXES, { version: "v3" });
  assert.equal(
    LaidDupPlan.restSecondsForSet("push1", "bench", w6DeloadPlan, { isTopSet: true }),
    120,
    "restSecondsForSet must honor plan.isDeload even without options.deload",
  );
  assert.match(
    LaidDupPlan.describe(w6DeloadPlan),
    /из 6/,
    "formatDayDescription must pass version to buildWeekLabel (not print 'из 9')",
  );

  // TrainingProgram.start on v3 Week 6 deload applies -10% accessory weight (not -35% v1)
  const pushA = v3.find((r) => r.periodization!.day === "push1")!;
  const prevPushA = doneSession("prev-pa", "2026-11-02", [{ exerciseId: "pec-deck-fly", weight: 50, reps: 12, rir: 1 }]);
  const w6Workout = new TrainingProgram(pushA).start([prevPushA], "UTC", "2026-11-10", undefined, { cycle: v3 });
  const pecDeload = w6Workout.exercises.find((e) => e.exerciseId === "pec-deck-fly")!;
  assert.equal(pecDeload.sets[0].weight, 45, "DUP v3 deload accessories must use 90% weight (-10%), not 65%");

  // waveProgress on v3 has 6 weeks and does not pollute squat with legs2 RDL
  const wp = LaidDupPlan.waveProgress(v3, v3Workouts, "2026-11-18");
  const sqWp = wp.find((x) => x.lift === "squat")!;
  assert.equal(sqWp.weeks.length, 6);
  assert.equal(sqWp.weeks[5].isDeload, true);
  assert.equal(sqWp.weeks[5].wave, 3);
  const w1Legs1Plan = LaidDupPlan.day("legs1", 0, MAXES, { version: "v3" });
  assert.equal(sqWp.weeks[0].plannedTopKg, w1Legs1Plan.heavy.weightKg);
});

test("LivePrDetector keys by ExecutionIdentity, excludes partial ROM, and deduplicates revisions", () => {
  const history = [
    doneSession("w1", "2026-11-01", [{ exerciseId: "bench", weight: 100, reps: 1, rir: 0 }], "Bench", 1),
    // Newer revision of w1 lowers weight from 100 -> 80
    doneSession("w1", "2026-11-01", [{ exerciseId: "bench", weight: 80, reps: 1, rir: 0 }], "Bench", 2),
    // Partial ROM lift (120x1) must NOT set baseline PR
    doneSession("w2", "2026-11-05", [{ exerciseId: "bench", weight: 120, reps: 1, rir: 0, rom: "shortened_partial" }]),
    // Different machine on lat-pulldown
    doneSession("w3", "2026-11-06", [{ exerciseId: "lat-pulldown", weight: 70, reps: 8, machineInstanceId: "m-a" }]),
  ];
  const det = new LivePrDetector(history);

  // Full ROM 90x1 beats deduplicated 80x1 (ignoring stale rev 100 and partial ROM 120)
  const benchEntry = {
    ...makeExerciseEntry("bench"),
    sets: [{ id: "s1", weight: 90, reps: 1, rir: 0, warmup: false, done: true }],
  };
  const hit = det.checkSet(benchEntry, benchEntry.sets[0]);
  assert.ok(hit && hit.previousBest === 80 && hit.e1rm === 90, `Expected PR over 80 kg, got ${JSON.stringify(hit)}`);

  // Partial ROM set during workout must NOT fire a live PR
  const partialEntry = {
    ...makeExerciseEntry("bench"),
    execution: { rom: "lengthened_partial" as const },
    sets: [{ id: "s2", weight: 110, reps: 1, rir: 0, warmup: false, done: true }],
  };
  assert.equal(det.checkSet(partialEntry, partialEntry.sets[0]), null);

  // Machine m-b has NO prior baseline on lat-pulldown (must not compare against m-a)
  const machineB = {
    ...makeExerciseEntry("lat-pulldown"),
    machineInstanceId: "m-b",
    sets: [{ id: "s3", weight: 80, reps: 8, rir: 1, warmup: false, done: true }],
  };
  assert.equal(det.checkSet(machineB, machineB.sets[0]), null);
});

test("ExerciseSwap does not carry weights across different machine_stack exercises or mismatched per_implement counts", () => {
  const ex = (id: string) => EXERCISES.find((e) => e.id === id) as Exercise;
  const pulldown = ex("lat-pulldown"); // machine_stack
  const legCurl = ex("legcurl-seated"); // machine_stack (different machine!)
  const doneStack = [{ id: "a", weight: 75, reps: 10, rir: 1, warmup: false, done: true }];
  const stackSwap = ExerciseSwap.sets(doneStack, pulldown.recording.loadMode, pulldown.recording.type, legCurl, [], pulldown);
  assert.equal(stackSwap.carried, false, "Different machine_stack exercises must not carry stack weights/done");
  assert.equal(stackSwap.sets[0].weight, 0);
  assert.equal(stackSwap.sets[0].done, false);

  const dbRow = ex("db-row"); // per_implement, implementCount: 1, unilateral
  const flatDbPress = ex("flat-db-press"); // per_implement, implementCount: 2, bilateral
  const doneRow = [{ id: "b", weight: 32, reps: 10, rir: 1, warmup: false, done: true }];
  const dbSwap = ExerciseSwap.sets(doneRow, dbRow.recording.loadMode, dbRow.recording.type, flatDbPress, [], dbRow);
  assert.equal(dbSwap.carried, false, "1-DB unilateral row must not carry weights/done into 2-DB bilateral press");
  assert.equal(dbSwap.sets[0].done, false);
});

test("StrengthForecast and StrengthTotal exclude dumbbell ohp from Barbell OHP, skip partial ROM/deload/unknown, window bestE1rm, and clamp mid-projection", () => {
  const today = "2026-11-27";
  const now = new Date(`${today}T12:00:00Z`);
  const history = [
    // Seated Dumbbell Press (id="ohp") must NOT be counted as Barbell OHP
    doneSession("s-db", "2026-11-20", [{ exerciseId: "ohp", weight: 35, reps: 8 }]),
    // Ancient 2-year-old bench PR (150 kg) outside 180-day window
    doneSession("s-old", "2024-01-10", [{ exerciseId: "bench", weight: 150, reps: 1 }]),
    // Recent 180-day rising bench (80 -> 85 -> 90 x 1)
    doneSession("s-r1", "2026-10-15", [{ exerciseId: "bench", weight: 80, reps: 1 }]),
    doneSession("s-r2", "2026-11-05", [{ exerciseId: "bench", weight: 85, reps: 1 }]),
    doneSession("s-r3", "2026-11-26", [{ exerciseId: "bench", weight: 90, reps: 1 }]),
    // Partial ROM squat (200x1) & deload bench (50x5) must be ignored
    doneSession("s-part", "2026-11-22", [{ exerciseId: "squat", weight: 200, reps: 1, rom: "shortened_partial" }]),
    doneSession("s-deload", "2026-11-27", [{ exerciseId: "bench", weight: 50, reps: 5 }], "[Разгрузка] Жим"),
  ];

  const total = StrengthTotal.fromWorkouts(history, "UTC", 80, now);
  assert.equal(total.lifts.ohp.e1rmKg, null, "Seated dumbbell press (id='ohp') must not be counted as Barbell OHP");

  const report = new StrengthForecast(history, { today, now, timeZone: "UTC", bodyMassKg: 80 }).build({ bench: 92 });
  assert.equal(report.lifts.ohp.currentE1rm, null, "StrengthForecast must not match dumbbell press id='ohp' as Barbell OHP");
  assert.equal(report.lifts.squat.currentE1rm, null, "Partial ROM sets must not pollute StrengthForecast");
  assert.ok(
    (report.lifts.bench.currentE1rm ?? 0) < 100,
    `Ancient 2-year-old 150 kg PR must not override 180d bench currentE1rm (got ${report.lifts.bench.currentE1rm})`,
  );
  // Midpoint of projection must never overshoot targetKg (92)
  if (report.lifts.bench.projection.length >= 2) {
    assert.ok(
      report.lifts.bench.projection[1].e1rm <= report.lifts.bench.targetKg,
      `Projection midpoint ${report.lifts.bench.projection[1].e1rm} exceeded targetKg ${report.lifts.bench.targetKg}`,
    );
  }
});
