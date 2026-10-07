import type { Exercise, Workout, WorkoutExercise } from "../src/lib/types";
import { exerciseById } from "../src/lib/model";
import { normalizeSearch } from "../src/lib/search";
import { ExerciseRepository } from "./ExerciseRepository";
import { ProductRepository } from "./ProductRepository";
import { PersonalExerciseFactory, digest } from "./PersonalExerciseFactory";
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
      input.workouts.length > 10 ||
      !input.workouts.length
    )
      throw new InputError("Импорт принимает от 1 до 10 сессий в пакете");
    const inputs = input.workouts.map(object);
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
      if (existing) continue;
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
            displayNameSnapshot: definition.name,
            sets: e.sets.map((s, i) => ({
              ...object(s),
              id: `${id}:${workouts.length}:${i}:${(source.exercises as unknown[]).indexOf(e)}`,
            })) as WorkoutExercise["sets"],
            ...(e.equipmentNote
              ? { equipmentNote: str(e.equipmentNote, 120) }
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
          analysisVersion: 2,
          ...(source.routineId
            ? { routineId: routineMap.get(String(source.routineId)) }
            : {}),
          ...(source.restSeconds ? { restSeconds: source.restSeconds } : {}),
        },
        { timeZone, importedExercises: definitions },
      );
      workouts.push(w);
    }
    const duplicateIds = inputs
      .filter((w) => typeof w.nativeId === "string")
      .map((w) => str(w.nativeId, 80, 1));
    const keys = [...new Set([...workouts.map((w) => w.id), ...duplicateIds])];
    const existing = await this.db
      .prepare(
        `SELECT id FROM workouts WHERE owner_id=? AND id IN (${keys.map(() => "?").join(",")})`,
      )
      .bind(this.owner, ...keys)
      .all<{ id: string }>();
    const present = new Set(existing.results.map((w) => w.id));
    const pending = workouts.filter(
      (w, i) =>
        !present.has(w.id) && !present.has(String(inputs[i].nativeId ?? "")),
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
        exercises: [...proposals.values()],
        exerciseIdMap: idMap,
        workouts: [],
      };
    const stamp = new Date().toISOString(),
      statements: D1PreparedStatement[] = [];
    // Validate the entire package before one atomic D1 batch; no partial sessions.
    for (const e of proposals.values())
      statements.push(
        this.db
          .prepare(
            "INSERT INTO custom_exercises (id,owner_id,family_id,payload,active,updated_at) VALUES (?,?,?,?,1,?) ON CONFLICT(id) DO NOTHING",
          )
          .bind(e.id, this.owner, e.custom!.familyId, JSON.stringify(e), stamp),
      );
    for (const w of unique)
      statements.push(
        this.db
          .prepare(
            "INSERT INTO workouts (id,owner_id,date,payload,updated_at,revision) VALUES (?,?,?,?,?,1) ON CONFLICT(id) DO NOTHING",
          )
          .bind(
            w.id,
            this.owner,
            w.date,
            JSON.stringify({ ...w, revision: undefined }),
            stamp,
          ),
      );
    const results = statements.length ? await this.db.batch(statements) : [];
    const imported = results
      .slice(proposals.size)
      .reduce((n, r) => n + (r.meta.changes ?? 0), 0);
    const rows = unique.length
      ? await this.db
          .prepare(
            `SELECT payload,revision,updated_at FROM workouts WHERE owner_id=? AND id IN (${unique.map(() => "?").join(",")})`,
          )
          .bind(this.owner, ...unique.map((w) => w.id))
          .all<{ payload: string; revision: number; updated_at: string }>()
      : { results: [] };
    return {
      imported,
      skipped: inputs.length - imported,
      workouts: rows.results.map((r) => ({
        ...JSON.parse(r.payload),
        revision: r.revision,
        updatedAt: r.updated_at,
      })),
      exercises: [...proposals.values()],
      exerciseIdMap: idMap,
    };
  }
}
