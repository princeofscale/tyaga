import type { Exercise, ProductData, Routine } from "../src/lib/types";
import { InputError } from "./validation";

export class ProductRepository {
  constructor(
    private db: D1Database,
    private owner: string,
  ) {}
  async read(): Promise<ProductData> {
    const [routines, custom, favorites, definitions] = await this.db.batch([
      this.db
        .prepare(
          "SELECT payload,revision,updated_at FROM routines WHERE owner_id=? ORDER BY updated_at DESC,id",
        )
        .bind(this.owner),
      this.db
        .prepare(
          "SELECT payload FROM custom_exercises WHERE owner_id=? AND active=1 ORDER BY updated_at DESC,id",
        )
        .bind(this.owner),
      this.db
        .prepare(
          "SELECT exercise_id FROM favorite_exercises WHERE owner_id=? ORDER BY exercise_id",
        )
        .bind(this.owner),
      this.db
        .prepare(
          "SELECT e.payload FROM exercise_catalog e JOIN favorite_exercises f ON f.exercise_id=e.id WHERE f.owner_id=? UNION ALL SELECT e.payload FROM custom_exercises e JOIN favorite_exercises f ON f.exercise_id=e.id AND f.owner_id=e.owner_id WHERE f.owner_id=? LIMIT 200",
        )
        .bind(this.owner, this.owner),
    ]);
    return {
      routines: (routines.results as {payload:string;revision:number;updated_at:string}[]).map((r) => ({
        ...JSON.parse(r.payload),
        revision: r.revision,
        updatedAt: r.updated_at,
      })),
      customExercises: (custom.results as {payload:string}[]).map((r) => JSON.parse(r.payload)),
      favorites: (favorites.results as {exercise_id:string}[]).map((r) => r.exercise_id),
      favoriteDefinitions: (definitions.results as {payload:string}[]).map((r) =>
        JSON.parse(r.payload),
      ),
    };
  }
  async definitions(ids: string[]): Promise<Map<string, Exercise>> {
    const unique = [...new Set(ids)]
      .filter((id) => typeof id === "string" && id.startsWith("custom:"))
      .slice(0, 75);
    if (!unique.length) return new Map();
    const rows = await this.db
      .prepare(
        `SELECT id,payload FROM custom_exercises WHERE owner_id=? AND id IN (${unique.map(() => "?").join(",")})`,
      )
      .bind(this.owner, ...unique)
      .all<{ id: string; payload: string }>();
    return new Map(rows.results.map((r) => [r.id, JSON.parse(r.payload)]));
  }
  async saveExercise(exercise: Exercise) {
    const family = exercise.custom!.familyId;
    const collision = await this.db
      .prepare("SELECT owner_id FROM custom_exercises WHERE id=?")
      .bind(exercise.id)
      .first<{ owner_id: string }>();
    if (collision && collision.owner_id !== this.owner)
      throw new InputError("Упражнение недоступно");
    const count = await this.db
      .prepare(
        "SELECT COUNT(*) AS count FROM custom_exercises WHERE owner_id=? AND active=1 AND family_id<>?",
      )
      .bind(this.owner, family)
      .first<{ count: number }>();
    if ((count?.count ?? 0) >= 200)
      throw new InputError("В личном каталоге уже 200 упражнений");
    await this.db.batch([
      this.db
        .prepare(
          "UPDATE custom_exercises SET active=0 WHERE owner_id=? AND family_id=?",
        )
        .bind(this.owner, family),
      this.db
        .prepare(
          "INSERT INTO custom_exercises (id,owner_id,family_id,payload,active,updated_at) VALUES (?,?,?,?,1,?) ON CONFLICT(id) DO UPDATE SET active=1 WHERE custom_exercises.owner_id=excluded.owner_id",
        )
        .bind(
          exercise.id,
          this.owner,
          family,
          JSON.stringify(exercise),
          new Date().toISOString(),
        ),
      this.db
        .prepare(
          "INSERT INTO favorite_exercises (owner_id,exercise_id) SELECT ?,? WHERE EXISTS (SELECT 1 FROM favorite_exercises f JOIN custom_exercises e ON e.id=f.exercise_id AND e.owner_id=f.owner_id WHERE f.owner_id=? AND e.family_id=?) ON CONFLICT DO NOTHING",
        )
        .bind(this.owner, exercise.id, this.owner, family),
      this.db
        .prepare(
          "DELETE FROM favorite_exercises WHERE owner_id=? AND exercise_id IN (SELECT id FROM custom_exercises WHERE owner_id=? AND family_id=? AND id<>?)",
        )
        .bind(this.owner, this.owner, family, exercise.id),
    ]);
    return exercise;
  }
  async removeExercise(id: string) {
    await this.db.batch([
      this.db
        .prepare(
          "UPDATE custom_exercises SET active=0 WHERE id=? AND owner_id=?",
        )
        .bind(id, this.owner),
      this.db
        .prepare(
          "DELETE FROM favorite_exercises WHERE owner_id=? AND exercise_id=?",
        )
        .bind(this.owner, id),
    ]);
  }
  async saveRoutine(routine: Routine) {
    const { revision, updatedAt: _stamp, ...content } = routine;
    const payload = JSON.stringify(content),
      stamp = new Date().toISOString();
    const count = await this.db
      .prepare(
        "SELECT COUNT(*) AS count FROM routines WHERE owner_id=? AND id<>?",
      )
      .bind(this.owner, routine.id)
      .first<{ count: number }>();
    if ((count?.count ?? 0) >= 50)
      throw new InputError("Можно сохранить до 50 программ");
    const saved =
      revision === 0
        ? await this.db
            .prepare(
              "INSERT INTO routines (id,owner_id,payload,revision,updated_at) VALUES (?,?,?,1,?) ON CONFLICT(id) DO NOTHING RETURNING payload,revision,updated_at",
            )
            .bind(routine.id, this.owner, payload, stamp)
            .first<{ payload: string; revision: number; updated_at: string }>()
        : await this.db
            .prepare(
              "UPDATE routines SET payload=?,revision=revision+1,updated_at=? WHERE id=? AND owner_id=? AND revision=? RETURNING payload,revision,updated_at",
            )
            .bind(payload, stamp, routine.id, this.owner, revision)
            .first<{ payload: string; revision: number; updated_at: string }>();
    if (saved)
      return {
        saved: {
          ...JSON.parse(saved.payload),
          revision: saved.revision,
          updatedAt: saved.updated_at,
        } as Routine,
      };
    const row = await this.db
      .prepare(
        "SELECT payload,revision,updated_at FROM routines WHERE id=? AND owner_id=?",
      )
      .bind(routine.id, this.owner)
      .first<{ payload: string; revision: number; updated_at: string }>();
    if (row?.payload === payload)
      return {
        saved: {
          ...JSON.parse(row.payload),
          revision: row.revision,
          updatedAt: row.updated_at,
        } as Routine,
      };
    return {
      current: row
        ? ({
            ...JSON.parse(row.payload),
            revision: row.revision,
            updatedAt: row.updated_at,
          } as Routine)
        : null,
    };
  }
  async removeRoutine(id: string, revision: number) {
    await this.db
      .prepare("DELETE FROM routines WHERE id=? AND owner_id=? AND revision=?")
      .bind(id, this.owner, revision)
      .run();
    const row = await this.db
      .prepare(
        "SELECT payload,revision,updated_at FROM routines WHERE id=? AND owner_id=?",
      )
      .bind(id, this.owner)
      .first<{ payload: string; revision: number; updated_at: string }>();
    return row
      ? ({
          ...JSON.parse(row.payload),
          revision: row.revision,
          updatedAt: row.updated_at,
        } as Routine)
      : null;
  }
  async favorite(id: string, favorite: boolean) {
    if (favorite) {
      const count = await this.db
        .prepare(
          "SELECT COUNT(*) AS count FROM favorite_exercises WHERE owner_id=? AND exercise_id<>?",
        )
        .bind(this.owner, id)
        .first<{ count: number }>();
      if ((count?.count ?? 0) >= 200)
        throw new InputError("В избранном уже 200 упражнений");
    }
    await (
      favorite
        ? this.db.prepare(
            "INSERT INTO favorite_exercises (owner_id,exercise_id) VALUES (?,?) ON CONFLICT DO NOTHING",
          )
        : this.db.prepare(
            "DELETE FROM favorite_exercises WHERE owner_id=? AND exercise_id=?",
          )
    )
      .bind(this.owner, id)
      .run();
  }
}
