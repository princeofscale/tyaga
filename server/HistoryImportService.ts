import { MachineRepository } from "./MachineRepository";
import { validMachine } from "./validation";
import type { Exercise, Workout, WorkoutExercise } from "../src/lib/types";
import { exerciseById } from "../src/lib/model";
import { normalizeSearch } from "../src/lib/search";
import { ExerciseRepository } from "./ExerciseRepository";
import { ProductRepository } from "./ProductRepository";
import { PersonalExerciseFactory, digest } from "./PersonalExerciseFactory";
import { ImportReceiptService, canonicalHash, type ImportReceipt } from "./ImportReceiptService";
import { object, str, validWorkout, InputError } from "./validation";

export class HistoryImportService {
  constructor(
    private db: D1Database,
    private owner: string,
  ) {}
  async import(value: unknown) {
    const input = object(value);
    const format = str(input.format, 20, 1);
    if (
      !["strong", "hevy", "fitnotes", "tyaga"].includes(format) ||
      !Array.isArray(input.workouts) ||
      input.workouts.length > 30 ||
      !input.workouts.length
    )
      throw new InputError("Импорт принимает от 1 до 30 сессий целиком; при большем файле разбей экспорт");
    const inputs = input.workouts.map(object);
    // A runId is a recovery token only after commit; legacy calls get a fresh one.
    const runId = input.runId === undefined ? crypto.randomUUID() : str(input.runId, 80, 1);
    const manifestHash = await canonicalHash({ format, workouts: inputs, replace: input.replace === true });
    if (input.manifestHash !== undefined && str(input.manifestHash, 64, 1) !== manifestHash)
      throw new InputError("Файл импорта изменился. Проверь файл перед повтором.");
    const previousRun = await this.db.prepare(
      "SELECT manifest_hash,result,state FROM workout_import_runs WHERE owner_id=? AND run_id=?",
    ).bind(this.owner, runId).first<{ manifest_hash: string; result: string; state: string }>();
    if (previousRun) {
      if (previousRun.manifest_hash !== manifestHash) throw new InputError("Повтор импорта изменился: начни новую операцию");
      if (previousRun.state === "undone") throw new InputError("Этот импорт уже отменён. Начни новую операцию.");
      if (previousRun.state === "committed") return JSON.parse(previousRun.result);
      if (previousRun.state === "failed") {
        await this.db.batch([
          this.db.prepare("DELETE FROM workout_import_staging WHERE owner_id=? AND run_id=? AND EXISTS (SELECT 1 FROM workout_import_runs WHERE owner_id=? AND run_id=? AND state='failed')").bind(this.owner, runId, this.owner, runId),
          this.db.prepare("DELETE FROM workout_import_receipts WHERE owner_id=? AND run_id=? AND active=0 AND EXISTS (SELECT 1 FROM workout_import_runs WHERE owner_id=? AND run_id=? AND state='failed')").bind(this.owner, runId, this.owner, runId),
          this.db.prepare("DELETE FROM workout_import_runs WHERE owner_id=? AND run_id=? AND state='failed'").bind(this.owner, runId),
        ]);
      }
    }
    const profile = await this.db
      .prepare("SELECT payload FROM settings WHERE owner_id=?")
      .bind(this.owner)
      .first<{ payload: string }>();
    const timeZone = profile
      ? (JSON.parse(profile.payload).timeZone ?? "UTC")
      : "UTC";
    const ownerHash = await digest(this.owner);
    const routineIds = inputs
      .filter((w) => typeof w.routineId === "string")
      .map((w) => str(w.routineId, 80, 1));
    const routineRows = routineIds.length
      ? await this.db
          .prepare(
            `SELECT id FROM routines WHERE owner_id=? AND id IN (${routineIds.map(() => "?").join(",")})`,
          )
          .bind(this.owner, ...routineIds)
          .all<{ id: string }>()
      : { results: [] };
    const routineMap = new Map<string, string>();
    for (const id of routineIds)
      routineMap.set(
        id,
        routineRows.results.some((r) => r.id === id)
          ? id
          : `restore:${ownerHash}:${await digest(id)}`,
      );
    const proposals = new Map<string, Exercise>(),
      idMap: Record<string, string> = {};
    const allEntries = inputs.flatMap((w) => {
      if (
        !Array.isArray(w.exercises) ||
        w.exercises.length > 30 ||
        !w.exercises.length
      )
        throw new InputError("Проверь упражнения импорта");
      return w.exercises.map(object);
    });
    const machineRepository = new MachineRepository(this.db, this.owner);
    const machineDefinitions = await machineRepository.definitions();
    const machineProposals = new Map<string, import("../src/lib/types").MachineInstance>();
    for (const entry of allEntries) {
      if (entry.machineInstanceId === undefined || machineDefinitions.has(String(entry.machineInstanceId))) continue;
      const machine = validMachine(entry.machineSnapshot);
      if (machine.id !== entry.machineInstanceId) throw new InputError("Тренажёр не совпадает со снимком");
      await machineRepository.validateModel(machine);
      machineDefinitions.set(machine.id, machine);
      machineProposals.set(machine.id, machine);
    }
    const ids = allEntries.map((e) =>
      typeof e.exerciseId === "string" ? e.exerciseId : "",
    );
    if (
      new Set(
        allEntries.map(
          (e) => String(e.exerciseId ?? e.sourceName) + "|" + String(e.type),
        ),
      ).size > 30
    )
      throw new InputError("В пакете не больше 30 разных вариантов упражнения");
    const uniqueNames = new Set(
      allEntries
        .filter(
          (e) => !e.exerciseId || String(e.exerciseId).startsWith("custom:"),
        )
        .map((e) => String(e.sourceName)),
    );
    if (uniqueNames.size > 30)
      throw new InputError("В одном пакете не больше 30 личных вариантов");
    const [wger, personal] = await Promise.all([
      new ExerciseRepository(this.db).findByIds(ids),
      new ProductRepository(this.db, this.owner).definitions(ids),
    ]);
    const definitions = new Map([...wger, ...personal]);
    for (const e of allEntries) {
      const existing =
        typeof e.exerciseId === "string"
          ? (exerciseById(
              e.exerciseId,
              (e.catalogRevision ?? 2) as 1 | 2 | 3,
            ) ?? definitions.get(e.exerciseId))
          : undefined;
      if (existing) {
        e.resolvedId = existing.id;
        if (typeof e.exerciseId === "string") idMap[e.exerciseId] = existing.id;
        continue;
      }
      if (e.exerciseId && !String(e.exerciseId).startsWith("custom:"))
        throw new InputError("Неизвестный вариант в импорте");
      const sourceName = str(e.sourceName, 120, 1),
        name = str(e.displayName ?? sourceName, 120, 1);
      const raw = e.definition ? object(e.definition) : null;
      const custom = raw?.custom ? object(raw.custom) : null;
      const key = custom
        ? `restore|${str(custom.familyId, 36, 1)}`
        : `${format}|${normalizeSearch(sourceName)}|${String(e.type)}`;
      const familyId = (await digest(this.owner + "|" + key)).slice(0, 24);
      const exercise = await new PersonalExerciseFactory().create({
        familyId,
        name,
        nameEn: typeof raw?.nameEn === "string" ? raw.nameEn : sourceName,
        aliases: Array.isArray(raw?.aliases) ? raw.aliases : [sourceName],
        notes:
          typeof raw?.tip === "string"
            ? raw.tip
            : `Импорт из ${format}. Записанные значения источника сохранены.`,
        equipment: raw?.equipment ?? "gym",
        declaredZones: custom?.declaredZones ?? [],
        basedOnExerciseId: custom?.basedOnExerciseId ?? "",
        origin: format,
        recording: raw?.recording ?? {
          type: e.type ?? "reps",
          loadMode: "legacy_unspecified",
          implementCount: 1,
          laterality: "bilateral",
        },
      });
      proposals.set(exercise.id, exercise);
      e.resolvedId = exercise.id;
      if (typeof e.exerciseId === "string") idMap[e.exerciseId] = exercise.id;
      definitions.set(exercise.id, exercise);
    }
    // Hash the source session identity, not transient UI IDs or translated labels.
    const workouts: Workout[] = [];
    for (const source of inputs) {
      const key = str(source.sourceKey, 1000, 1);
      const id = `import:${ownerHash}:${await digest(key)}`;
      const entries = (source.exercises as Record<string, unknown>[]).map(
        (e) => {
          const exerciseId = String(e.resolvedId ?? e.exerciseId),
            definition =
              exerciseById(exerciseId, (e.catalogRevision ?? 2) as 1 | 2 | 3) ??
              definitions.get(exerciseId);
          if (!definition)
            throw new InputError("Не удалось найти упражнение импорта");
          if (!Array.isArray(e.sets) || e.sets.length > 30)
            throw new InputError("Проверь подходы импорта");
          const entry: WorkoutExercise = {
            exerciseId,
            catalogRevision: definition.catalogRevision,
            recordingSpecRevision: definition.catalogRevision,
            muscleMappingRevision: definition.catalogRevision,
            ...(e.muscleModelRevision !== undefined ? { muscleModelRevision: e.muscleModelRevision as 1 } : {}),
            displayNameSnapshot: definition.name,
            ...(e.execution !== undefined ? { execution: e.execution as WorkoutExercise["execution"] } : {}),
            ...(e.supersetId !== undefined ? { supersetId: e.supersetId as string } : {}),
            ...(e.machineInstanceId !== undefined ? { machineInstanceId: String(e.machineInstanceId), machineSnapshot: e.machineSnapshot ? validMachine(e.machineSnapshot) : machineDefinitions.get(String(e.machineInstanceId)) } : {}),
            sets: e.sets.map((s, i) => ({
              ...object(s),
              id: `${id}:${workouts.length}:${i}:${(source.exercises as unknown[]).indexOf(e)}`,
            })) as WorkoutExercise["sets"],
            ...(e.equipmentNote
              ? { equipmentNote: str(e.equipmentNote, 120) }
              : format === "tyaga" && !e.machineInstanceId &&
                  definition.catalogRevision === 3 &&
                  !definition.source &&
                  !definition.custom &&
                  ["machine_stack", "assisted_bodyweight"].includes(
                    definition.recording.loadMode,
                  )
                ? {
                    equipmentNote: `Не указан · импорт ${source.date} · ${id.slice(-8)}`,
                  }
                : {}),
            ...(definition.recording.laterality === "unilateral"
              ? {
                  performedSides: (e.performedSides ??
                    "both") as WorkoutExercise["performedSides"],
                }
              : {}),
            ...(e.bodyMassKg !== undefined
              ? { bodyMassKg: e.bodyMassKg as number }
              : {}),
          };
          return entry;
        },
      );
      const merged =
        format === "tyaga"
          ? entries
          : [
              ...entries
                .reduce((map, e) => {
                  const previous = map.get(e.exerciseId);
                  if (previous) previous.sets.push(...e.sets);
                  else map.set(e.exerciseId, e);
                  return map;
                }, new Map<string, WorkoutExercise>())
                .values(),
            ];
      const w = validWorkout(
        {
          id,
          name: source.name,
          date: source.date,
          duration: source.duration,
          notes: source.notes,
          exercises: merged,
          timeZone: source.timeZone ?? timeZone,
          revision: 0,
          analysisVersion: format === "tyaga" ? source.analysisVersion ?? 2 : 2,
          ...(format === "tyaga" && source.wearable
            ? { wearable: source.wearable }
            : {}),
          ...(source.routineId
            ? { routineId: routineMap.get(String(source.routineId)) }
            : {}),
          ...(source.restSeconds ? { restSeconds: source.restSeconds } : {}),
        },
        { timeZone, importedExercises: definitions, machines: machineDefinitions },
      );
      workouts.push(w);
    }
    const duplicateIds = inputs
      .filter((w) => typeof w.nativeId === "string")
      .map((w) => str(w.nativeId, 80, 1));
    const keys = [...new Set([...workouts.map((w) => w.id), ...duplicateIds])];
    const existing = await this.db
      .prepare(
        `SELECT id,payload,date,revision FROM workouts WHERE owner_id=? AND id IN (${keys.map(() => "?").join(",")})`,
      )
      .bind(this.owner, ...keys)
      .all<{ id: string; payload: string; date: string; revision: number }>();
    const present = new Set(existing.results.map((w) => w.id));
    const byId = new Map(existing.results.map((w) => [w.id, w]));
    const receipts = await new ImportReceiptService(this.db, this.owner).active(workouts.map((w) => w.id));
    // Revision alone is never proof. A receipt tied to the same owner and the
    // identical imported payload is required even when sync sent revision=1.
    const replace = new Set<string>();
    if (input.replace === true && format !== "tyaga") {
      for (const current of existing.results) {
        const receipt = receipts.get(current.id);
        if (receipt && receipt.revision === current.revision &&
          receipt.payload === current.payload &&
          receipt.payload_hash === await canonicalHash(JSON.parse(current.payload)))
          replace.add(current.id);
      }
    }
    const kept =
      input.replace === true && format !== "tyaga"
        ? workouts.filter((w) => present.has(w.id) && !replace.has(w.id)).length
        : 0;
    const pending = workouts.filter(
      (w, i) =>
        (!present.has(w.id) || replace.has(w.id)) &&
        !present.has(String(inputs[i].nativeId ?? "")),
    );
    const unique = [...new Map(pending.map((w) => [w.id, w])).values()];
    const proposedIds = [...proposals.keys()];
    if (proposedIds.length) {
      const current = await this.db
        .prepare(
          `SELECT id FROM custom_exercises WHERE owner_id=? AND id IN (${proposedIds.map(() => "?").join(",")})`,
        )
        .bind(this.owner, ...proposedIds)
        .all<{ id: string }>();
      const count = await this.db
        .prepare(
          "SELECT COUNT(*) AS count FROM custom_exercises WHERE owner_id=? AND active=1",
        )
        .bind(this.owner)
        .first<{ count: number }>();
      if (
        (count?.count ?? 0) +
          proposedIds.filter((id) => !current.results.some((r) => r.id === id))
            .length >
        200
      )
        throw new InputError(
          "Личный каталог ограничен 200 вариантами. Сопоставь упражнения с библиотекой.",
        );
    }
    if (input.dryRun === true)
      return {
        imported: 0,
        skipped: inputs.length - unique.length,
        ready: unique.length,
        replaceable: unique.filter((w) => replace.has(w.id)).length,
        kept,
        exercises: [...proposals.values()],
        exerciseIdMap: idMap,
        workouts: [],
      };
    const stamp = new Date().toISOString();
    const replacing = unique.filter((w) => replace.has(w.id));
    const prepared = await Promise.all(unique.map(async (w) => {
      const payload = JSON.stringify({ ...w, revision: undefined });
      return { w, payload, hash: await canonicalHash(JSON.parse(payload)) };
    }));
    const response = {
      imported: prepared.length,
      replaced: replacing.length,
      kept,
      runId,
      addedIds: unique.map((w) => w.id),
      skipped: inputs.length - prepared.length,
      workouts: prepared.map(({ w }) => ({ ...w, revision: byId.has(w.id) ? byId.get(w.id)!.revision + 1 : 1, updatedAt: stamp })),
      exercises: [...proposals.values()],
      exerciseIdMap: idMap,
    };
    // Staging writes are invisible to all journal APIs. A single finalize
    // statement runs the trigger that writes every workout, switches receipts,
    // and flips the run to committed; SQLite rolls all trigger effects back if
    // any workout write fails.
    const runRow = await this.db.prepare(
      "SELECT state,manifest_hash,result FROM workout_import_runs WHERE owner_id=? AND run_id=?",
    ).bind(this.owner, runId).first<{ state: string; manifest_hash: string; result: string }>();
    if (runRow?.state === "committed") return JSON.parse(runRow.result);
    if (runRow?.state === "undone") throw new InputError("Этот импорт уже отменён. Начни новую операцию.");
    const statements: D1PreparedStatement[] = [
      this.db.prepare(
        `INSERT INTO workout_import_runs(owner_id,run_id,manifest_hash,created_at,state,workout_count,result)
         VALUES(?,?,?,?, 'staging',?,?) ON CONFLICT(owner_id,run_id) DO UPDATE SET result=excluded.result
         WHERE workout_import_runs.owner_id=excluded.owner_id AND workout_import_runs.manifest_hash=excluded.manifest_hash
           AND workout_import_runs.state='staging'`,
      ).bind(this.owner, runId, manifestHash, stamp, prepared.length, JSON.stringify(response)),
      this.db.prepare("DELETE FROM workout_import_staging WHERE owner_id=? AND run_id=? AND EXISTS (SELECT 1 FROM workout_import_runs WHERE owner_id=? AND run_id=? AND state='staging')")
        .bind(this.owner, runId, this.owner, runId),
      this.db.prepare("DELETE FROM workout_import_dependencies WHERE owner_id=? AND run_id=? AND EXISTS (SELECT 1 FROM workout_import_runs WHERE owner_id=? AND run_id=? AND state='staging')")
        .bind(this.owner, runId, this.owner, runId),
    ];
    for (const { w, payload, hash } of prepared) {
      const old = byId.get(w.id);
      const previous = old ? receipts.get(w.id)! : null;
      statements.push(this.db.prepare(
        `INSERT INTO workout_import_staging
         (owner_id,run_id,workout_id,payload,payload_hash,date,action,expected_revision,expected_payload,
          previous_run_id,previous_payload_hash,previous_payload,previous_date,previous_revision)
         SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS
           (SELECT 1 FROM workout_import_runs WHERE owner_id=? AND run_id=? AND state='staging')`,
      ).bind(this.owner, runId, w.id, payload, hash, w.date, old ? "replaced" : "added",
        old?.revision ?? null, old?.payload ?? null, previous?.run_id ?? null,
        previous?.payload_hash ?? null, previous?.payload ?? null, old?.date ?? null,
        old?.revision ?? null, this.owner, runId));
    }
    for (const machine of machineProposals.values()) {
      const { revision: _revision, ...content } = machine;
      statements.push(this.db.prepare(
        "INSERT INTO workout_import_dependencies(owner_id,run_id,kind,id,model_id,payload,revision,updated_at) VALUES(?,?,'machine',?,?,?,?,?)",
      ).bind(this.owner, runId, machine.id, machine.model.id, JSON.stringify(content), 1, stamp));
      statements.push(this.db.prepare(
        "INSERT INTO workout_import_dependencies(owner_id,run_id,kind,id,model_id,payload,revision,updated_at) VALUES(?,?,'machine_model',?,?,?,1,?)",
      ).bind(this.owner, runId, machine.model.id, machine.model.id, JSON.stringify(machine.model), stamp));
    }
    for (const e of proposals.values()) {
      statements.push(this.db.prepare(
        "INSERT INTO workout_import_dependencies(owner_id,run_id,kind,id,payload,revision,updated_at) VALUES(?,?,'custom_exercise',?,?,1,?)",
      ).bind(this.owner, runId, e.id, JSON.stringify(e), stamp));
    }
    await this.db.batch(statements);
    const staged = await this.db.prepare(
      "SELECT COUNT(*) AS count FROM workout_import_staging WHERE owner_id=? AND run_id=?",
    ).bind(this.owner, runId).first<{ count: number }>();
    if (staged?.count !== prepared.length) throw new InputError("Импорт не подготовлен полностью. Повтори эту же операцию.");
    await this.db.prepare(
      "INSERT INTO workout_import_finalize_requests(owner_id,run_id) VALUES(?,?)",
    ).bind(this.owner, runId).run();
    const committed = await this.db.prepare(
      "SELECT state,result FROM workout_import_runs WHERE owner_id=? AND run_id=?",
    ).bind(this.owner, runId).first<{ state: string; result: string }>();
    if (committed?.state !== "committed") throw new InputError("Импорт ещё не завершён. Повтори ту же операцию.");
    const result = JSON.parse(committed.result);
    return result;
  }
}
