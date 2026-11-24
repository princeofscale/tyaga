import test from "node:test";
import assert from "node:assert/strict";
import { ExerciseAvoidStore, SubstitutionPolicy } from "../src/domain/SubstitutionPolicy";
import { LaidDupPlan } from "../src/domain/LaidDupPlan";
import { PeriodizationRules } from "../src/domain/PeriodizationRules";
import { OneRepMaxFormulas } from "../src/domain/OneRepMaxFormulas";
import { BiomechanicsEngine } from "../src/domain/BiomechanicsEngine";
import { DeloadEngine } from "../src/domain/DeloadEngine";
import { TrainingProgram } from "../src/domain/TrainingProgram";
import { OfflineMutationQueue } from "../src/lib/offlineMutationQueue";
import { SmartCoach } from "../src/domain/SmartCoach";
import { ApiClient } from "../src/services/ApiClient";
import { DEFAULT_SETTINGS, exerciseById, makeExerciseEntry, makeSets } from "../src/lib/model";
import { InputError, validPeriodization, validSettings } from "../server/validation";
import type { LaidMaxes, Routine, Workout } from "../src/lib/types";

const MAXES: LaidMaxes = { squat: 120, bench: 100, deadlift: 160, ohp: 65 };

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
    removeItem: (k: string) => {
      map.delete(k);
    },
  };
}

function makeDoneWorkout(
  date: string,
  name: string,
  items: [exerciseId: string, weight: number, reps: number, rir: number | null, sets?: number][],
): Workout {
  return {
    id: crypto.randomUUID(),
    name,
    date,
    duration: 50,
    notes: "",
    exercises: items.map(([id, weight, reps, rir, count = 3]) => ({
      ...makeExerciseEntry(id),
      sets: makeSets(count, weight, reps).map((s) => ({ ...s, rir, done: true })),
    })),
  };
}

// ───────────── Wave 1: SubstitutionPolicy A/B/C, Calibration, Pain Flags, Injury Map, Avoid Store, ROM Evidence ─────────────
test("Wave 1: SubstitutionPolicy classifies replacements into A / B / C and honors painFlag", () => {
  const deadlift = exerciseById("deadlift-bar")!;
  const rdl = exerciseById("rdl")!;
  const hipThrust = exerciseById("barbell-hip-thrust")!;
  const legCurl = exerciseById("legcurl-seated")!;

  // Same family barbell + own history -> Class A percent_1rm
  const clsA = SubstitutionPolicy.classify(deadlift, rdl, { hasOwnHistory: true });
  assert.equal(clsA.subClass, "A");
  assert.equal(clsA.prescriptionMode, "percent_1rm");

  // Different family compound without history -> Class B calibration
  const clsB = SubstitutionPolicy.classify(deadlift, hipThrust, { hasOwnHistory: false });
  assert.equal(clsB.subClass, "B");
  assert.equal(clsB.prescriptionMode, "calibration");
  assert.equal(clsB.allowHeavySingles, false);

  // Isolation -> Class C rir_range (never 95% heavy singles)
  const clsC = SubstitutionPolicy.classify(deadlift, legCurl, { hasOwnHistory: true });
  assert.equal(clsC.subClass, "C");
  assert.equal(clsC.prescriptionMode, "rir_range");

  // Pain flag forces Class C / rir_range even on close barbell variant
  const pain = SubstitutionPolicy.classify(deadlift, rdl, { hasOwnHistory: true, painFlag: true });
  assert.equal(pain.subClass, "C");
  assert.equal(pain.prescriptionMode, "rir_range");
});

test("Wave 1: injury zone filter excludes axial spinal loads for lower_back and overhead for shoulder", () => {
  assert.equal(SubstitutionPolicy.isZoneFriendly(exerciseById("deadlift-bar")!, "lower_back"), false);
  assert.equal(SubstitutionPolicy.isZoneFriendly(exerciseById("barbell-hip-thrust")!, "lower_back"), true);
  assert.equal(SubstitutionPolicy.isZoneFriendly(exerciseById("legcurl-seated")!, "lower_back"), true);
  assert.equal(SubstitutionPolicy.isZoneFriendly(exerciseById("ohp-bar")!, "shoulder"), false);
});

test("Wave 1: DUP calibrationLifts & painFlags avoid bogus 95% weights and block autoMaxes", () => {
  const cycle = LaidDupPlan.routines({
    maxes: MAXES,
    extras: true,
    light: false,
    startMonday: "2026-11-09",
    substitutions: { "deadlift-bar": "barbell-hip-thrust" },
    calibrationLifts: ["deadlift"],
    painFlags: ["squat"],
  });

  // Client & server validation agree
  for (const r of cycle) {
    assert.equal(PeriodizationRules.check(r.periodization).ok, true);
    assert.doesNotThrow(() => validPeriodization(r.periodization));
  }
  assert.throws(
    () => validPeriodization({ ...cycle[0].periodization, painFlags: ["invalid"] }),
    InputError,
  );

  // Calibration lift starts at 0 kg (no fabricated 95% of old deadlift max) and RIR 2
  const pull2 = cycle.find((r) => r.periodization!.day === "pull2")!;
  const pullPlan = LaidDupPlan.planFor(pull2, "2026-11-14")!;
  assert.equal(pullPlan.prescriptionMode, "calibration");
  assert.equal(pullPlan.heavy.weightKg, 0);
  assert.match(LaidDupPlan.line(pullPlan), /Калибровка/);

  // Pain-flagged squat disables 95% singles (shifts to 5 reps RIR) and blocks autoMaxes
  const legs1 = cycle.find((r) => r.periodization!.day === "legs1")!;
  const legsPlan = LaidDupPlan.planFor(legs1, "2026-11-16")!; // Week 2 normally 1x1 @ 95%
  assert.equal(legsPlan.prescriptionMode, "rir_range");
  assert.equal(legsPlan.heavy.reps, 5);
  assert.equal(legsPlan.heavy.weightKg, 0);

  const hugeSquat = makeDoneWorkout("2026-11-15", "Присед", [["squat", 160, 1, 1, 1]]);
  const auto = LaidDupPlan.autoMaxes(legs1.periodization!, [hugeSquat], "2026-11-18");
  assert.equal(auto, null, "painFlags must block automatic 1RM escalation");
});

test("Wave 1: ExerciseAvoidStore persists account-scoped avoid list and ROM evidence tags are honest", () => {
  const store = new ExerciseAvoidStore("acc-1", () => storage);
  const storage = memoryStorage();
  assert.deepEqual(store.read(), []);
  store.add("deadlift-bar", "pain", "Поясница");
  assert.equal(store.ids().has("deadlift-bar"), true);
  assert.equal(store.read()[0].reason, "pain");
  store.remove("deadlift-bar");
  assert.equal(store.ids().has("deadlift-bar"), false);

  assert.equal(SubstitutionPolicy.lengthenedEvidence(exerciseById("legcurl-seated")).level, "strong");
  assert.equal(SubstitutionPolicy.lengthenedEvidence(exerciseById("calf-standing-machine")).level, "strong");
  assert.equal(SubstitutionPolicy.lengthenedEvidence(exerciseById("triceps-db")).level, "strong");
  assert.equal(SubstitutionPolicy.lengthenedEvidence(exerciseById("curl-bar")).level, "limited");
});

// ───────────── Wave 2: e1RM Confidence, RIR Bands, Structural Fatigue, Equipment-Aware DDP, Adaptive Deload ─────────────
test("Wave 2: OneRepMaxFormulas.e1rmWithConfidence assigns high/moderate/low and rejects >15 effective reps", () => {
  assert.equal(OneRepMaxFormulas.e1rmWithConfidence(100, 3, 1)?.confidence, "high");
  assert.equal(OneRepMaxFormulas.e1rmWithConfidence(100, 7, 1)?.confidence, "moderate");
  assert.equal(OneRepMaxFormulas.e1rmWithConfidence(100, 12, 1)?.confidence, "low");
  assert.equal(OneRepMaxFormulas.e1rmWithConfidence(100, 14, 3), null);
});

test("Wave 2: BiomechanicsEngine reports RIR bands and separates structuralLoadSets", () => {
  const w = makeDoneWorkout("2026-11-15", "День", [
    ["squat", 100, 5, 1, 3], // 3 high RIR + 3 axial structural
    ["bench", 80, 8, 3, 2], // 2 moderate RIR
    ["lateral", 10, 15, 5, 2], // 2 light RIR
  ]);
  const report = BiomechanicsEngine.analyzeWeek([w], "2026-11-16", { timeZone: "UTC", now: new Date("2026-11-16T12:00:00Z") });
  assert.deepEqual(report.rirBands, { high: 3, moderate: 2, light: 2, unknown: 0 });
  assert.equal(report.structuralLoadSets, 3);
});

test("Wave 2: Equipment-aware DDP prevents >12% jump on light barbell isolation (15 kg + 2.5 kg = +17%)", () => {
  const routine: Routine = {
    ...TrainingProgram.empty(),
    name: "Верх",
    progression: "double",
    repMin: 10,
    repMax: 12,
    incrementKg: 2.5,
    exercises: [
      { ...makeExerciseEntry("curl-bar"), sets: makeSets(3, 15, 12), repMin: 10, repMax: 12 },
      { ...makeExerciseEntry("bench"), sets: makeSets(3, 80, 10), repMin: 8, repMax: 10 },
    ],
  };
  const prev = makeDoneWorkout("2026-11-10", "Верх", [
    ["curl-bar", 15, 12, 1, 3],
    ["bench", 80, 10, 1, 3],
  ]);
  const started = new TrainingProgram(routine).start([prev], "UTC", "2026-11-14");
  const curl = started.exercises.find((e) => e.exerciseId === "curl-bar")!;
  const bench = started.exercises.find((e) => e.exerciseId === "bench")!;

  // 15 -> 17.5 kg (+17% > 12%): keeps 15 kg, expands repMax to 14, explains why
  assert.equal(curl.sets[0].weight, 15);
  assert.equal(curl.repMax, 14);
  assert.match(curl.progressionNote ?? "", /17%/);

  // 80 -> 82.5 kg (+3.1% <= 12%): normal weight increment
  assert.equal(bench.sets[0].weight, 82.5);
});

test("Wave 2: DeloadEngine detects multi-session e1RM dips and negative RIR drift", () => {
  const prior = [
    makeDoneWorkout("2026-10-20", "База", [
      ["squat", 120, 5, 3, 3],
      ["bench", 100, 5, 3, 3],
    ]),
    makeDoneWorkout("2026-10-27", "База", [
      ["squat", 120, 5, 3, 3],
      ["bench", 100, 5, 3, 3],
    ]),
  ];
  const recent = [
    makeDoneWorkout("2026-11-10", "База", [
      ["squat", 110, 5, 1, 3],
      ["bench", 92.5, 5, 1, 3],
    ]),
    makeDoneWorkout("2026-11-14", "База", [
      ["squat", 110, 5, 1, 3],
      ["bench", 92.5, 5, 1, 3],
    ]),
  ];
  const assessment = DeloadEngine.assessFatigue([...prior, ...recent], new Date("2026-11-16T12:00:00Z"), "UTC");
  assert.equal(assessment.performanceDips, 2);
  assert.ok(assessment.rirDrift !== null && assessment.rirDrift! <= -1.5);
  assert.match(assessment.observedPatternNote ?? "", /Паттерн совместим с накопленной усталостью/);
});

// ───────────── Wave 3: Idempotent opId Outbox Queue ─────────────
test("Wave 3: OfflineMutationQueue attaches stable opId across retries and reports 3-state status", async () => {
  const storage = memoryStorage();
  const queue = new OfflineMutationQueue("acc-sync", () => storage);
  assert.equal(queue.status(), "saved");

  queue.enqueue({ key: "settings", path: "/api/settings", method: "PUT", body: { restSeconds: 120 } });
  const items = queue.read();
  assert.equal(items.length, 1);
  assert.ok(items[0].opId.length >= 8);
  assert.equal(queue.status(), "pending");
  assert.equal(queue.status(true), "conflict");

  const seenOpIds: string[] = [];
  await queue.flush(async (_path, _method, _body, meta) => {
    seenOpIds.push(meta?.opId ?? "");
    throw new Error("network down");
  });
  await queue.flush(async (_path, _method, _body, meta) => {
    seenOpIds.push(meta?.opId ?? "");
  });
  assert.equal(seenOpIds.length, 2);
  assert.equal(seenOpIds[0], seenOpIds[1], "same opId must be sent on retry for idempotency");
  assert.equal(queue.status(), "saved");
});

// ───────────── Wave 4: minorMode, +5% autoMaxes cap, SmartCoach 5-metric dashboard, X-Tyaga-Op-Id ─────────────
test("Wave 4: validSettings accepts minorMode boolean, omits when false, rejects invalid", () => {
  const base = { ...DEFAULT_SETTINGS };
  const on = validSettings({ ...base, minorMode: true });
  assert.equal(on.minorMode, true);
  const off = validSettings({ ...base, minorMode: false });
  assert.equal(off.minorMode, undefined);
  assert.throws(() => validSettings({ ...base, minorMode: "yes" }), InputError);
});

test("Wave 4: LaidDupPlan.autoMaxes respects minorMode block and +5% maxJumpFactor cap", () => {
  const cycle = LaidDupPlan.routines({
    maxes: MAXES, // squat: 120, bench: 100
    extras: true,
    light: false,
    startMonday: "2026-11-09",
  });
  const legs1 = cycle.find((r) => r.periodization!.day === "legs1")!;
  // 140 kg x 1 @ RIR 1 -> e1RM ~145 kg (+20% jump from 120 kg)
  const bigSquat = makeDoneWorkout("2026-11-15", "Ноги", [["squat", 140, 1, 1, 1]]);

  // minorMode blocks auto-escalation completely
  assert.equal(
    LaidDupPlan.autoMaxes(legs1.periodization!, [bigSquat], "2026-11-16", {
      maxJumpFactor: 1.05,
      minorMode: true,
    }),
    null,
  );

  // maxJumpFactor 1.05 caps squat max at <= 120 * 1.05 = 126 kg (rounded to 2.5 -> 125)
  const capped = LaidDupPlan.autoMaxes(legs1.periodization!, [bigSquat], "2026-11-16", {
    maxJumpFactor: 1.05,
  });
  assert.ok(capped !== null);
  assert.ok(
    capped!.maxes.squat <= 126 && capped!.maxes.squat > 120,
    `expected squat in (120, 126], got ${capped!.maxes.squat}`,
  );
});

test("Wave 4: SmartCoach.analyze computes 5-metric Decision Dashboard (adherence, rirDrift, painFlags, e1RM confidence)", () => {
  const cycle = LaidDupPlan.routines({
    maxes: MAXES,
    extras: true,
    light: false,
    startMonday: "2026-11-02",
    painFlags: ["deadlift"],
  });
  const workouts = [
    makeDoneWorkout("2026-10-20", "Ноги", [["squat", 110, 5, 3, 3]]),
    makeDoneWorkout("2026-10-27", "Ноги", [["squat", 112.5, 5, 3, 3]]),
    makeDoneWorkout("2026-11-09", "Ноги", [["squat", 115, 5, 1, 3]]),
    makeDoneWorkout("2026-11-14", "Ноги", [["squat", 117.5, 5, 1, 3]]),
  ];
  const report = SmartCoach.analyze(
    workouts,
    cycle,
    "2026-11-16",
    "UTC",
    new Date("2026-11-16T12:00:00Z"),
  );
  assert.ok(report.planAdherence !== null);
  assert.ok(report.planAdherence!.planned > 0);
  assert.ok(report.rirDrift !== null && report.rirDrift <= -1.5);
  assert.equal(report.painFlagsSummary.count, 1); // deadlift painFlag from DUP cycle
  const squatTrend = report.liftTrends.find((t) => t.exerciseId === "squat");
  assert.ok(squatTrend);
  assert.equal(squatTrend!.confidence, "moderate"); // 5 reps + RIR 1 -> effective 6 reps -> moderate confidence
});

test("Wave 4: ApiClient.request forwards X-Tyaga-Op-Id header when supplied", async () => {
  let capturedHeaders: Record<string, string> = {};
  const client = new ApiClient(async (_input, init) => {
    capturedHeaders = (init?.headers ?? {}) as Record<string, string>;
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }, false);

  await client.request("/api/settings", "PUT", { restSeconds: 90 }, undefined, {
    "X-Tyaga-Op-Id": "op-test-123",
  });
  assert.equal(capturedHeaders["X-Tyaga-Op-Id"], "op-test-123");
  assert.equal(capturedHeaders["Content-Type"], "application/json");
});
