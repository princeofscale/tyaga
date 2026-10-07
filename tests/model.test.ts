import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_SETTINGS,
  EXERCISES,
  ANATOMICAL_MUSCLES,
  EVIDENCE,
  balanceScore,
  buildBalancePlan,
  estimatedOneRepMax,
  exerciseForEntry,
  makeWorkout,
  makeExerciseEntry,
  repeatWorkout,
  muscleLoad,
  anatomicalLoad,
  legacyMuscleLoad,
  volume,
  volumeSummary,
  workingSets,
  weekStart,
  localDate,
  progressKey,
  recordedLoad,
  type SetEntry,
  type Workout,
} from "../src/lib/model";
import { validWorkout, validSettings, InputError } from "../server/validation";
import {
  newDraft,
  parseDraft,
  persistDraft,
  elapsedMs,
  checkpointDraft,
} from "../src/lib/draft";
const set = (patch: Partial<SetEntry> = {}): SetEntry => ({
  id: crypto.randomUUID(),
  weight: 60,
  reps: 10,
  rir: 2,
  warmup: false,
  done: true,
  ...patch,
});
function sample(id = "bench", patch: Partial<SetEntry> = {}) {
  const w = makeWorkout([id], [], "UTC");
  const spec = exerciseForEntry(w.exercises[0])!.recording;
  w.exercises[0].sets = [
    set({
      ...(["bodyweight", "assisted_bodyweight"].includes(spec.loadMode)
        ? { weight: 0 }
        : {}),
      ...(spec.loadMode === "assisted_bodyweight" ? { assistanceKg: 40 } : {}),
      ...patch,
    }),
  ];
  if (["machine_stack", "assisted_bodyweight"].includes(spec.loadMode))
    w.exercises[0].equipmentNote = "Машина A";
  return w;
}
const legacy = (id: string, patch: Partial<SetEntry> = {}): Workout => ({
  id: "old",
  name: "До обновления",
  date: "2026-10-06",
  notes: "",
  duration: 40,
  exercises: [{ exerciseId: id, sets: [set(patch)] }],
});

test("working bench set has direct chest/triceps and separate shoulder assistance; warmup/undone are omitted", () => {
  const w = sample();
  w.exercises[0].sets.push(set({ warmup: true }), set({ done: false }));
  const loads = muscleLoad([w]);
  assert.equal(loads.find((m) => m.id === "chest")!.direct, 1);
  assert.equal(loads.find((m) => m.id === "triceps")!.direct, 1);
  assert.equal(loads.find((m) => m.id === "shoulders")!.indirect, 1);
  assert.equal(loads.find((m) => m.id === "shoulders")!.total, 0);
  assert.equal(workingSets([w]), 1);
  assert.equal(volume([w]), 600);
});
test("RIR is a separate optional filter, never a stimulus multiplier", () => {
  const w = sample();
  w.exercises[0].sets = [set({ rir: 2 }), set({ rir: 4 }), set({ rir: 8 })];
  assert.equal(muscleLoad([w]).find((m) => m.id === "chest")!.direct, 3);
  assert.equal(
    muscleLoad([w], DEFAULT_SETTINGS, { maxRir: 3 }).find(
      (m) => m.id === "chest",
    )!.direct,
    1,
  );
});
test("RDL back and squat core/hamstrings are stabilization, without direct or assisting volume", () => {
  const rdl = muscleLoad([sample("rdl")]).find((m) => m.id === "back")!;
  assert.equal(rdl.direct, 0);
  assert.equal(rdl.indirect, 0);
  assert.equal(rdl.stabilizing, 1);
  for (const id of ["squat", "goblet", "body-squat"]) {
    const core = muscleLoad([sample(id)]).find((m) => m.id === "core")!;
    assert.equal(core.direct + core.indirect, 0);
    assert.equal(core.stabilizing, 1);
  }
  assert.equal(
    muscleLoad([sample("squat")]).find((m) => m.id === "hamstrings")!.indirect,
    0,
  );
});
test("lateral raise does not award a direct set to every deltoid portion", () => {
  const rows = anatomicalLoad([sample("lateral")]);
  assert.equal(rows.find((m) => m.id === "deltoid-middle")!.direct, 1);
  assert.equal(rows.find((m) => m.id === "deltoid-anterior")!.direct, 0);
  assert.equal(rows.find((m) => m.id === "deltoid-posterior")!.direct, 0);
});
test("catalogue and source references are unique and complete, with explicit inference and limitations", () => {
  assert.equal(new Set(EXERCISES.map((e) => e.id)).size, EXERCISES.length);
  assert.ok(ANATOMICAL_MUSCLES.length >= 30);
  for (const e of EXERCISES) {
    assert.equal(e.catalogRevision, 2);
    assert.ok(e.variant && e.limitations && e.provenance.license);
    assert.equal(
      new Set(e.muscles.map((m) => m.muscleId)).size,
      e.muscles.length,
    );
    for (const m of e.muscles) {
      assert.ok(ANATOMICAL_MUSCLES.some((a) => a.id === m.muscleId));
      assert.equal(m.basis, "anatomical-inference");
    }
    for (const id of [...e.evidence, ...e.muscles.flatMap((m) => m.sources)])
      assert.ok(
        EVIDENCE.some((s) => s.id === id),
        `missing source ${id}`,
      );
  }
});
test("historical mapping stays frozen; an explicit recalculation never mutates history or guesses its weight", () => {
  const old = legacy("rdl");
  const before = JSON.stringify(old);
  assert.equal(muscleLoad([old]).find((m) => m.id === "back")!.indirect, 1);
  assert.equal(
    legacyMuscleLoad([old]).find((m) => m.id === "back")!.indirect,
    0.5,
  );
  assert.equal(
    muscleLoad([old], DEFAULT_SETTINGS, { mapping: "current" }).find(
      (m) => m.id === "back",
    )!.indirect,
    0,
  );
  assert.equal(JSON.stringify(old), before);
  assert.equal(volume([old]), 0);
  assert.equal(
    estimatedOneRepMax(old.exercises[0].sets[0], old.exercises[0]),
    null,
  );
});
test("ambiguous historical variants are not silently converted into seated curls or hip thrusts", () => {
  for (const id of ["hipthrust", "legcurl", "calf", "lunge", "facepull"]) {
    const old = legacy(id);
    assert.equal(exerciseForEntry(old.exercises[0])!.catalogRevision, 1);
    assert.equal(volume([old]), 0);
    assert.equal(
      muscleLoad([old], DEFAULT_SETTINGS, { mapping: "current" }).length,
      10,
    );
  }
  for (const id of [
    "glute-bridge",
    "barbell-hip-thrust",
    "legcurl-seated",
    "legcurl-prone",
    "calf-standing",
    "calf-seated",
    "lunge-reverse",
    "facepull-er",
  ])
    assert.ok(EXERCISES.some((e) => e.id === id));
});
test("two-dumbbell volume uses two implements; a two-hand single dumbbell stays one implement", () => {
  assert.equal(volume([sample("incline-db", { weight: 20 })]), 400);
  assert.equal(volume([sample("triceps-db", { weight: 20 })]), 200);
});
test("unilateral volume multiplies only explicitly selected sides and implements", () => {
  const row = sample("db-row", { weight: 20 });
  assert.equal(volume([row]), 400);
  row.exercises[0].performedSides = "left";
  assert.equal(volume([row]), 200);
  const lunge = sample("lunge-reverse", { weight: 20 });
  assert.equal(volume([lunge]), 800);
  lunge.exercises[0].performedSides = "right";
  assert.equal(volume([lunge]), 400);
});
test("bodyweight, assistance, machines and unspecified legacy values are never pooled with external free weights", () => {
  const assisted = sample("pullup-assisted");
  assisted.exercises[0].bodyMassKg = 80;
  assert.equal(
    recordedLoad(assisted.exercises[0], assisted.exercises[0].sets[0]),
    40,
  );
  const summary = volumeSummary([
    assisted,
    sample("pullup-weighted", { weight: 20 }),
    sample("lat-pulldown"),
    legacy("bench"),
  ]);
  assert.equal(summary.total, 0);
  assert.equal(summary.omittedSets, 4);
  for (const w of [
    assisted,
    sample("pullup-weighted", { weight: 20 }),
    sample("lat-pulldown"),
  ])
    assert.equal(
      estimatedOneRepMax(w.exercises[0].sets[0], w.exercises[0]),
      null,
    );
});
test("e1RM uses eligible recorded weight and per-dumbbell semantics, excludes warmup and >12 reps", () => {
  const w = sample();
  const we = w.exercises[0];
  assert.equal(estimatedOneRepMax(set({ reps: 1 }), we), 60);
  assert.equal(estimatedOneRepMax(set({ reps: 13 }), we), null);
  assert.equal(estimatedOneRepMax(set({ warmup: true }), we), null);
  assert.equal(estimatedOneRepMax(set(), we), 80);
  const db = sample("incline-db", { weight: 20 });
  assert.ok(
    Math.abs(
      estimatedOneRepMax(db.exercises[0].sets[0], db.exercises[0])! -
        26.6666667,
    ) < 0.001,
  );
});
test("references use the final working set of the latest matching session, without adopting ambiguous old weights", () => {
  const first = sample();
  first.createdAt = "2026-10-06T10:00:00Z";
  first.exercises[0].sets = [
    set({ weight: 80 }),
    set({ weight: 90 }),
    set({ weight: 85 }),
    set({ weight: 20, warmup: true }),
  ];
  const earlier = sample();
  earlier.createdAt = "2026-10-06T09:00:00Z";
  earlier.exercises[0].sets = [set({ weight: 50 })];
  assert.equal(makeExerciseEntry("bench", [earlier, first]).sets[0].weight, 85);
  assert.equal(
    makeExerciseEntry("incline-db", [legacy("incline-db", { weight: 20 })])
      .sets[0].weight,
    0,
  );
  const a = sample("lat-pulldown");
  const b = structuredClone(a);
  b.exercises[0].equipmentNote = "Машина B";
  assert.notEqual(progressKey(a.exercises[0]), progressKey(b.exercises[0]));
});
test("repeat clones actual set count, warmup flags and recording version, with fresh IDs and no completion marks", () => {
  const w = sample("db-row");
  w.exercises[0].sets.push(
    set({ warmup: true }),
    set({ reps: 8 }),
    set({ reps: 6 }),
  );
  w.exercises[0].performedSides = "right";
  const copy = repeatWorkout(w, "UTC");
  assert.notEqual(copy.id, w.id);
  assert.equal(copy.exercises[0].sets.length, 4);
  assert.equal(copy.exercises[0].performedSides, "right");
  assert.equal(copy.exercises[0].catalogRevision, 2);
  assert.equal(copy.exercises[0].sets[1].warmup, true);
  assert.ok(copy.exercises[0].sets.every((s) => !s.done));
  assert.notEqual(copy.exercises[0].sets[0].id, w.exercises[0].sets[0].id);
});
test("coverage cannot compensate one missing zone with excess work in another", () => {
  const empty = muscleLoad([]);
  assert.equal(balanceScore(empty), 0);
  assert.equal(
    balanceScore(
      empty.map((m) => (m.id === "chest" ? { ...m, ratio: 10 } : m)),
    ),
    10,
  );
});
test("planner respects actual rest budget, equipment, and excluded stabilizers", () => {
  for (const rest of [30, 90, 180]) {
    const plan = buildBalancePlan(
      muscleLoad([]),
      20,
      "dumbbells",
      ["back", "core"],
      rest,
    );
    assert.ok(plan.minutes <= 20);
    assert.ok(plan.picks.length);
    for (const p of plan.picks) {
      assert.ok(["dumbbells", "bodyweight"].includes(p.exercise.equipment));
      assert.ok(
        !p.exercise.muscles.some((m) =>
          ["back", "core"].includes(
            ANATOMICAL_MUSCLES.find((a) => a.id === m.muscleId)!.zone,
          ),
        ),
      );
    }
    assert.ok(plan.after > plan.before);
  }
});
test("planner gains apply only to direct roles and fully covered goals yield no extra work", () => {
  const plan = buildBalancePlan(muscleLoad([]), 20, "gym");
  for (const p of plan.picks)
    assert.ok(
      Object.keys(p.gains).every((id) =>
        p.exercise.primary.includes(id as never),
      ),
    );
  const full = muscleLoad([]).map((m) => ({
    ...m,
    direct: m.goal,
    total: m.goal,
    ratio: 1,
  }));
  assert.equal(buildBalancePlan(full, 60, "gym").picks.length, 0);
});
test("date validation agrees with local midnight in Amsterdam, Los Angeles and Tokyo", () => {
  for (const [timeZone, now, day] of [
    ["Europe/Amsterdam", "2026-10-05T22:30:00Z", "2026-10-06"],
    ["America/Los_Angeles", "2026-10-07T02:00:00Z", "2026-10-06"],
    ["Asia/Tokyo", "2026-10-06T15:30:00Z", "2026-10-07"],
  ]) {
    const w = sample();
    w.timeZone = timeZone;
    w.date = day;
    assert.equal(validWorkout(w, { now: new Date(now) }).date, day);
    const next = new Date(day + "T12:00:00Z");
    next.setUTCDate(next.getUTCDate() + 1);
    assert.throws(
      () =>
        validWorkout(
          { ...w, date: next.toISOString().slice(0, 10) },
          { now: new Date(now) },
        ),
      InputError,
    );
  }
});
test("DST and Sunday/Monday calendar boundaries use calendar dates, not 24-hour intervals", () => {
  assert.equal(
    localDate(new Date("2026-03-29T00:30:00Z"), "Europe/Amsterdam"),
    "2026-03-29",
  );
  assert.equal(
    localDate(new Date("2026-03-29T01:30:00Z"), "Europe/Amsterdam"),
    "2026-03-29",
  );
  assert.equal(
    weekStart(new Date("2026-10-25T01:30:00Z"), "Europe/Amsterdam"),
    "2026-10-19",
  );
  assert.equal(
    weekStart(new Date("2026-10-12T00:30:00Z"), "America/Los_Angeles"),
    "2026-10-05",
  );
  assert.equal(
    weekStart(new Date("2026-10-11T15:30:00Z"), "Asia/Tokyo"),
    "2026-10-12",
  );
});
test("validation rejects impossible dates, unknown time zones, version mismatches and duplicate sets", () => {
  const w = sample();
  assert.equal(validWorkout(w).id, w.id);
  for (const date of ["2026-99-99", "2026-02-30"])
    assert.throws(() => validWorkout({ ...w, date }), InputError);
  assert.throws(
    () => validWorkout({ ...w, timeZone: "Mars/Base" }),
    InputError,
  );
  const bad = structuredClone(w);
  bad.exercises[0].muscleMappingRevision = 1;
  assert.throws(() => validWorkout(bad), InputError);
  bad.exercises[0] = structuredClone(w.exercises[0]);
  bad.exercises[0].sets.push(bad.exercises[0].sets[0]);
  assert.throws(() => validWorkout(bad), InputError);
});
test("validation rejects warmup-only and unfinished sessions, ambiguous sides and missing machine identity", () => {
  assert.throws(
    () => validWorkout(sample("bench", { warmup: true })),
    InputError,
  );
  assert.throws(() => validWorkout(makeWorkout(["bench"])), InputError);
  const row = sample("db-row");
  delete row.exercises[0].performedSides;
  assert.throws(() => validWorkout(row), InputError);
  const machine = sample("lat-pulldown");
  delete machine.exercises[0].equipmentNote;
  assert.throws(() => validWorkout(machine), InputError);
  const assisted = sample("pullup-assisted", { weight: -20 });
  assert.throws(() => validWorkout(assisted), InputError);
});
test("settings validate targets, rest seconds, revision and IANA time zone", () => {
  assert.deepEqual(validSettings(DEFAULT_SETTINGS), {
    ...DEFAULT_SETTINGS,
    revision: 0,
  });
  assert.equal(
    validSettings({ ...DEFAULT_SETTINGS, timeZone: "Europe/Amsterdam" })
      .timeZone,
    "Europe/Amsterdam",
  );
  assert.throws(
    () =>
      validSettings({
        ...DEFAULT_SETTINGS,
        goals: { ...DEFAULT_SETTINGS.goals, chest: 0 },
      }),
    InputError,
  );
  assert.throws(
    () => validSettings({ ...DEFAULT_SETTINGS, restSeconds: 0 }),
    InputError,
  );
  assert.throws(
    () => validSettings({ ...DEFAULT_SETTINGS, revision: -1 }),
    InputError,
  );
});
test("rest deadline survives reload while the active workout clock does not include eight closed hours", () => {
  const d = newDraft(sample(), false, 1000);
  d.restUntil = 100000;
  d.clock.elapsedMs = 300000;
  const restored = parseDraft(JSON.stringify(d))!;
  assert.equal(restored.restUntil, 100000);
  assert.equal(restored.clock.runningSince, null);
  assert.equal(elapsedMs(restored, 8 * 3600000), 300000);
  const delayed = checkpointDraft(d, 8 * 3600000);
  assert.equal(delayed.clock.runningSince, null);
  assert.ok(delayed.clock.elapsedMs <= 360000);
});
test("legacy drafts restore paused without assuming wall-clock duration; corrupt drafts are ignored", () => {
  const restored = parseDraft(
    JSON.stringify({
      workout: legacy("bench"),
      startedAt: 1000,
      editing: false,
    }),
  )!;
  assert.equal(restored.clock.elapsedMs, 0);
  assert.equal(restored.clock.runningSince, null);
  assert.equal(parseDraft("{broken"), null);
  assert.equal(
    parseDraft(
      JSON.stringify({
        workout: { exercises: [{ exerciseId: "missing", sets: [] }] },
        startedAt: 0,
        editing: false,
      }),
    ),
    null,
  );
});
test("quota and disabled-storage failures are reported rather than marked saved", () => {
  const throwing = {
    setItem() {
      throw new Error("QuotaExceededError");
    },
    removeItem() {
      throw new Error("SecurityError");
    },
  };
  assert.equal(persistDraft(throwing, newDraft(sample())), "failed");
  assert.equal(persistDraft(throwing, null), "failed");
  let stored = "";
  const ok = {
    setItem(_key: string, value: string) {
      stored = value;
    },
    removeItem() {
      stored = "";
    },
  };
  assert.equal(persistDraft(ok, newDraft(sample())), "saved");
  assert.ok(parseDraft(stored));
});
