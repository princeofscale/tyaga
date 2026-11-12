import test from "node:test";
import assert from "node:assert/strict";
import { setup } from "./fixtures/api";
import { MachineRegistry } from "../src/domain/MachineRegistry";
import {
  makeWorkout,
  progressKey,
  volumeSummary,
  muscleLoad,
} from "../src/lib/model";
import { TrainingVolume } from "../src/domain/TrainingVolume";
import { JournalBackup } from "../src/domain/JournalBackup";
import { WorkoutImport } from "../src/domain/WorkoutImport";
import { DEFAULT_SETTINGS } from "../src/lib/model";
import { SyncService } from "../server/SyncService";
import { LocalD1 } from "../src/device/LocalD1";
import type { MachineInstance, ProductData, Workout } from "../src/lib/types";

function machine() {
  const m = MachineRegistry.create();
  m.nickname = "Блок у окна";
  m.gym = "Зал A";
  m.model.model = "Row 100";
  m.model.manufacturer = "Test";
  m.aliases = ["Старое название"];
  return m;
}

test("machine registry is owner-scoped, revision-safe, idempotent and preserves saved workout snapshots", async () => {
  const { call } = await setup();
  const m = machine();
  const saved = await call<{ machine: MachineInstance }>(
    "a",
    "/api/machines",
    "PUT",
    m,
  );
  assert.equal(saved.status, 200);
  assert.equal(saved.data.machine.revision, 1);
  assert.equal((await call("a", "/api/machines", "PUT", m)).status, 200);
  const product = await call<ProductData>("b", "/api/product");
  assert.equal(product.data.machines?.length, 0);
  const w = makeWorkout(["row"]);
  w.exercises[0].machineInstanceId = m.id;
  w.exercises[0].machineSnapshot = saved.data.machine;
  w.exercises[0].sets.forEach((s) => {
    s.done = true;
    s.weight = 50;
  });
  assert.equal((await call("a", "/api/workouts", "PUT", w)).status, 200);
  assert.equal(
    (await call("b", "/api/workouts", "PUT", { ...w, id: crypto.randomUUID() }))
      .status,
    400,
  );
  const renamed = {
    ...saved.data.machine,
    nickname: "Новое имя",
    aliases: ["Блок у окна"],
  };
  const rename = await call<{ machine: MachineInstance }>(
    "a",
    "/api/machines",
    "PUT",
    renamed,
  );
  assert.equal(rename.status, 200);
  assert.equal(rename.data.machine.revision, 2);
  assert.equal(
    (
      await call("a", "/api/machines", "PUT", {
        ...renamed,
        nickname: "Конкурирующая правка",
      })
    ).status,
    409,
  );
  const history = await call<{ workouts: Workout[] }>("a", "/api/data");
  assert.equal(
    history.data.workouts[0].exercises[0].machineSnapshot?.nickname,
    "Блок у окна",
  );
  const e = w.exercises[0];
  assert.equal(
    progressKey(e),
    progressKey({
      ...e,
      machineSnapshot: rename.data.machine,
      equipmentNote: "любой текст",
    }),
  );
  assert.equal(volumeSummary([w]).total, 0);
  assert.equal(TrainingVolume.machines([w])[0].volume, 1500);
  const before = muscleLoad([w]);
  e.machineInstanceId = "different";
  assert.deepEqual(muscleLoad([w]), before); // equipment identity never determines muscles
});

test("set-level sides, ROM, superset kind and execution survive API and backup roundtrip", async () => {
  const { call } = await setup();
  const w = makeWorkout(["db-row"]),
    e = w.exercises[0];
  e.supersetId = "ss-1";
  e.execution = { grip: "нейтральный", torsoAngle: 30 };
  e.sets[0] = {
    ...e.sets[0],
    weight: 20,
    done: true,
    performedSides: "both",
    kind: "normal",
    execution: { rom: "full" },
  };
  e.sets[1] = {
    ...e.sets[1],
    weight: 20,
    done: true,
    performedSides: "left",
    kind: "dropset",
    execution: { rom: "lengthened_partial" },
  };
  e.sets = e.sets.slice(0, 2);
  const result = await call<{ workout: Workout }>(
    "a",
    "/api/workouts",
    "PUT",
    w,
  );
  assert.equal(result.status, 200);
  const data = await call<{ workouts: Workout[] }>("a", "/api/data");
  const restored = data.data.workouts[0].exercises[0];
  assert.equal(restored.supersetId, "ss-1");
  assert.equal(restored.execution?.torsoAngle, 30);
  assert.equal(restored.sets[1].performedSides, "left");
  assert.equal(restored.sets[1].kind, "dropset");
  assert.equal(restored.sets[1].execution?.rom, "lengthened_partial");
  assert.equal(volumeSummary(data.data.workouts).total, 600);
  const exported = JournalBackup.create(
    data.data.workouts,
    DEFAULT_SETTINGS,
    { routines: [], customExercises: [], favorites: [], machines: [] },
    { entries: [], goal: { targetWeightKg: null, startWeightKg: null } },
    "lime",
  );
  const parser = new WorkoutImport({
    dateOrder: "dmy",
    weightUnit: "kg",
    distanceUnit: "km",
    timeZone: "UTC",
  });
  const preview = parser.parse(JSON.stringify(exported), "tyaga");
  const imported = await call("b", "/api/import", "POST", {
    format: "tyaga",
    workouts: preview.workouts,
  });
  assert.equal(imported.status, 200);
  const copied = (await call<{ workouts: Workout[] }>("b", "/api/data")).data
    .workouts[0].exercises[0];
  assert.equal(copied.sets[1].performedSides, "left");
  assert.equal(copied.execution?.grip, "нейтральный");
  assert.equal(copied.sets[1].kind, "dropset");
  assert.equal(copied.supersetId, "ss-1");
});

test("machine snapshots import atomically with workouts and feed replication; legacy clients skip new kinds without cursor loss", async () => {
  const { call, db, ids } = await setup();
  const m = machine();
  const w = makeWorkout(["row"]);
  w.exercises[0].machineInstanceId = m.id;
  w.exercises[0].machineSnapshot = m;
  w.exercises[0].sets[0].done = true;
  const source = {
    sourceKey: "test-machine",
    name: w.name,
    date: w.date,
    duration: 30,
    notes: "",
    timeZone: "UTC",
    exercises: w.exercises.map((e) => ({
      ...e,
      sourceName: e.displayNameSnapshot,
      displayName: e.displayNameSnapshot,
      type: "reps",
    })),
  };
  const dry = await call("a", "/api/import", "POST", {
    format: "tyaga",
    workouts: [source],
    dryRun: true,
  });
  assert.equal(dry.status, 200);
  assert.equal(
    (await call<ProductData>("a", "/api/product")).data.machines?.length,
    0,
  );
  assert.equal(
    (
      await call("a", "/api/import", "POST", {
        format: "tyaga",
        workouts: [source],
      })
    ).status,
    200,
  );
  assert.equal(
    (await call<ProductData>("a", "/api/product")).data.machines?.[0].id,
    m.id,
  );
  const account = db.exec("SELECT platform_id FROM accounts WHERE id=?", [
    ids.get("a")!,
  ])[0].values[0][0] as string;
  const service = new SyncService(
    new LocalD1(db) as unknown as D1Database,
    account,
  );
  const changes = await service.changes(0);
  assert.ok(changes.docs.some((d) => d.kind === "machine"));
  assert.ok(changes.docs.some((d) => d.kind === "machine_model"));
  const legacy = await service.changes(0, 200, false);
  assert.ok(
    legacy.docs.every(
      (d) => d.kind !== "machine" && d.kind !== "machine_model",
    ),
  );
  assert.equal(legacy.cursor, changes.cursor);
});

test("malformed execution and calibration are rejected at the write boundary", async () => {
  const { call } = await setup();
  const m = machine();
  m.calibration = { pulleyRatio: -1 };
  assert.equal((await call("a", "/api/machines", "PUT", m)).status, 400);
  const w = makeWorkout(["bench"]);
  w.exercises[0].sets[0].done = true;
  w.exercises[0].execution = { startAngle: 200 };
  assert.equal((await call("a", "/api/workouts", "PUT", w)).status, 400);
});
