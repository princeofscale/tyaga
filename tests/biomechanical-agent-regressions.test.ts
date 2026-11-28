import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ExerciseSwapModal from "../src/components/ExerciseSwapModal";
import ExerciseInfo from "../src/components/ExerciseInfo";
import { PersonalExerciseFactory } from "../server/PersonalExerciseFactory";
import { BackupImportService } from "../server/BackupImportService";
import { HistoryImportService } from "../server/HistoryImportService";
import { PersonalExerciseMarking } from "../src/domain/PersonalExerciseMarking";
import { WorkoutImport } from "../src/domain/WorkoutImport";
import { BiomechanicalMuscleAgent } from "../src/domain/BiomechanicalMuscleAgent";
import { MuscleParticipation } from "../src/domain/MuscleParticipation";
import { SubstitutionPolicy } from "../src/domain/SubstitutionPolicy";
import { TrainingAnalytics } from "../src/domain/TrainingAnalytics";
import { exerciseById, makeWorkout } from "../src/lib/model";

const agent = new BiomechanicalMuscleAgent();

for (const [queryText, want] of [
  ["Dumbbell Rear Delt Fly", ["deltoid-posterior"]],
  ["Reverse fly (dumbbells, bent over)", ["deltoid-posterior"]],
  ["Dumbbell Hammer Curl", ["brachialis", "brachioradialis"]],
]) {
  test(`offline analysis recognizes ${queryText}`, () => {
    const result = agent.resolveOffline({ queryText: String(queryText) });
    assert.deepEqual(result.solved.primaryMuscles, want);
    assert.equal(result.verification.passed, true);
  });
}

test("unrecognized text doesn't produce a movement, muscle assignment or an applicable marking", () => {
  for (const queryText of ["неизвестная модель XLLW", "ABC-001", "constructor"]) {
    const result = agent.resolveOffline({ queryText });
    assert.equal(result.verification.passed, false, queryText);
    assert.deepEqual(result.descriptor.actions, {}, queryText);
    assert.deepEqual(result.solved.muscles, {}, queryText);
    assert.equal(BiomechanicalMuscleAgent.exerciseMarking(result), null);
  }
});

test("a preliminary Hammer machine row cannot be applied before its clarification", () => {
  const result = agent.resolveOffline({ queryText: "Тяга в тренажёре Хаммер" });
  assert.equal(result.verification.passed, true);
  assert.equal(result.clarifyingQuestions.length, 2);
  assert.equal(BiomechanicalMuscleAgent.exerciseMarking?.(result), null);
});

const edit = {
  familyId: "personal-agent-test",
  name: "Synthetic bench variant",
  aliases: [],
  notes: "",
  equipment: "gym",
  recording: { type: "reps", loadMode: "total_external", implementCount: 1, laterality: "bilateral" },
};

test("applying a bench analysis preserves individual roles without counting assistant zones as direct", async () => {
  const result = agent.resolveOffline({ queryText: "bench" });
  const marking = BiomechanicalMuscleAgent.exerciseMarking?.(result);
  assert.ok(marking, "an applicable analysis produces a structured marking");
  assert.deepEqual(marking.zones, ["chest"]);
  const exercise = await new PersonalExerciseFactory().create({
    ...edit,
    declaredZones: marking.zones,
    muscleRoles: marking.muscleRoles,
  });
  assert.equal(MuscleParticipation.headRole("chest-mid", exercise), "primary");
  assert.equal(MuscleParticipation.headRole("deltoid-anterior", exercise), "assistant");
  assert.equal(exercise.muscles.find((m) => m.muscleId === "triceps-brachii")?.role, "assistant");
  assert.deepEqual(exercise.primary, ["chest"]);
  assert.deepEqual(new Set(exercise.secondary), new Set(["shoulders", "triceps"]));
  assert.equal(exercise.provenance.reviewStatus, "user-declared");

  const workout = makeWorkout(["bench"], [], "UTC");
  Object.assign(workout.exercises[0], {
    exerciseId: exercise.id,
    catalogRevision: 3,
    externalDefinition: exercise,
    sets: [{ id: "working-set", weight: 20, reps: 8, rir: 2, done: true, warmup: false }],
  });
  const shoulders = new TrainingAnalytics([workout]).zoneLoad().find((zone) => zone.id === "shoulders");
  assert.equal(shoulders?.direct, 0);
  assert.equal(shoulders?.indirect, 1);
});

test("the personal exercise factory rejects anatomy IDs and roles it does not recognize", async () => {
  const factory = new PersonalExerciseFactory();
  const primary = { muscleId: "pectoralis-sternal", role: "primary" };
  for (const invalid of [
    { muscleId: "unrecognized-muscle", role: "assistant" },
    { muscleId: "deltoid-anterior", role: "unrecognized-role" },
    { muscleId: "pectoralis-sternal", role: "assistant" },
  ]) {
    await assert.rejects(factory.create({ ...edit, muscleRoles: [primary, invalid] }));
  }
});

const rolePayload = [
  { muscleId: "deltoid-anterior", role: "assistant" },
  { muscleId: "pectoralis-sternal", role: "primary" },
];

// Storage boundary only: empty synthetic account, no filesystem, D1 or migrations.
const emptyAccount = {
  prepare() {
    return {
      bind() { return this; },
      async first() { return null; },
      async all() { return { results: [] }; },
    };
  },
  async batch() { return []; },
} as unknown as D1Database;

for (const path of ["bulk tags", "backup metadata", "backup history"] as const) {
  test(`personal roles survive ${path}`, async () => {
    const factory = new PersonalExerciseFactory();
    const original = await factory.create({ ...edit, muscleRoles: rolePayload });
    const restored = path === "bulk tags"
      ? await factory.create(PersonalExerciseMarking.payload(original, { zones: ["chest"] }))
      : path === "backup metadata"
        ? (await new BackupImportService(emptyAccount, "synthetic-user").import({ kind: "custom", items: [original] })).exercises[0]
        : (await restoreHistory(original)).exercises[0];
    assert.ok(restored);
    assert.deepEqual(
      restored.muscles.map(({ muscleId, role }: { muscleId: string; role: string }) => ({ muscleId, role })),
      rolePayload,
    );
    assert.deepEqual(restored.primary, ["chest"]);
    assert.deepEqual(restored.secondary, ["shoulders"]);
  });
}

async function restoreHistory(exercise: Awaited<ReturnType<PersonalExerciseFactory["create"]>>) {
  const workout = makeWorkout(["bench"], [], "UTC");
  Object.assign(workout.exercises[0], {
    exerciseId: exercise.id,
    catalogRevision: 3,
    externalDefinition: exercise,
    sets: [{ id: "working-set", weight: 20, reps: 8, rir: 2, done: true, warmup: false }],
  });
  const backup = new WorkoutImport({ dateOrder: "dmy", timeZone: "UTC", weightUnit: "kg", distanceUnit: "km" }).parse(
    JSON.stringify({ format: "tyaga-backup", version: 5, workouts: [workout] }), "tyaga",
  );
  return new HistoryImportService(emptyAccount, "synthetic-user").import({ format: backup.format, workouts: backup.workouts, dryRun: true });
}

test("supported setups are not promised to eliminate axial load", () => {
  for (const queryText of ["Pendulum Squat", "Belt Squat", "Hammer Strength Iso-Lateral High Row"]) {
    const result = agent.resolveOffline({ queryText });
    assert.ok(result.solved.axialLoadMultiplier > 0);
    assert.doesNotMatch(result.rationale, /нулевой осевой|полная разгрузка поясницы|без нагрузки на поясницу/i);
  }
});

test("the loaded calf-legpress catalog entry uses the calf-position evidence tag", () => {
  const evidence = SubstitutionPolicy.lengthenedEvidence(exerciseById("calf-legpress"));
  assert.equal(evidence.level, "moderate");
  assert.match(evidence.citation, /Kinoshita/);
});

test("stretch tags don't classify rear-delt fly or incline curl as chest variants", () => {
  assert.equal(SubstitutionPolicy.lengthenedEvidence(exerciseById("rear-delt-fly")).level, "none");
  assert.equal(SubstitutionPolicy.lengthenedEvidence(exerciseById("curl-incline-db")).level, "limited");
});

test("a hack squat alternative does not claim it has zero axial load", () => {
  const original = exerciseById("squat");
  assert.ok(original);
  const markup = renderToStaticMarkup(createElement(ExerciseSwapModal, {
    currentExercise: original,
    onSwap: () => {},
    onClose: () => {},
  }));
  assert.match(markup, /Гакк-присед в тренажёре/);
  assert.doesNotMatch(markup, /без осевой/i);
});

test("ExerciseInfo does not describe user-declared model roles as source-verified editorial data", async () => {
  const exercise = await new PersonalExerciseFactory().create({ ...edit, muscleRoles: rolePayload });
  const markup = renderToStaticMarkup(createElement(ExerciseInfo, {
    exercise,
    onAdd: () => {},
    disabled: false,
  }));
  assert.doesNotMatch(markup, /с помощью ИИ и сверена/i);
  assert.doesNotMatch(markup, /редакционная модель/i);
});
