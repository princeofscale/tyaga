import data from "../data/wger/catalog-v1.json";
import {
  WgerExerciseAdapter,
  WGER_ZONES,
  type WgerSnapshot,
} from "../src/domain/WgerExercise";
import type { Exercise } from "../src/lib/types";

const snapshot = data as WgerSnapshot;
export class ExerciseRepository {
  private adapter = new WgerExerciseAdapter(
    snapshot.release,
    snapshot.fetchedAt,
  );
  constructor(private db: D1Database) {}
  async ensureImported(): Promise<number> {
    const ready = await this.db
      .prepare("SELECT record_count FROM catalog_releases WHERE id = ?")
      .bind(snapshot.release)
      .first<{ record_count: number }>();
    if (ready?.record_count === snapshot.count) return snapshot.count;
    const memberships = await this.db
      .prepare("SELECT exercise_id FROM catalog_memberships WHERE release = ?")
      .bind(snapshot.release)
      .all<{ exercise_id: string }>();
    const present = new Set(memberships.results.map((r) => r.exercise_id));
    const pending = snapshot.exercises
      .filter((r) => !present.has(r.id))
      .slice(0, 200);
    const statements: D1PreparedStatement[] = [];
    // At most 200 records / 36 queries per request, 80 parameters per statement.
    // The client continues incomplete imports. Batches are atomic and retry-safe.
    for (let i = 0; i < pending.length; i += 8) {
      const rows = pending.slice(i, i + 8);
      const bindings = rows.flatMap((record) => {
        const exercise = this.adapter.toExercise(record);
        const zones = [
          ...new Set(
            [...record.muscles, ...record.secondaryMuscles]
              .map((m) => WGER_ZONES[m.id])
              .filter(Boolean),
          ),
        ];
        return [
          exercise.id,
          record.sourceId,
          snapshot.release,
          exercise.name,
          `${exercise.name} ${exercise.nameEn} ${record.aliases.join(" ")}`.toLocaleLowerCase(),
          JSON.stringify(zones),
          exercise.equipment,
          record.language,
          record.loggable ? 1 : 0,
          JSON.stringify(exercise),
        ];
      });
      statements.push(
        this.db
          .prepare(
            `INSERT INTO exercise_catalog (id,source_id,release,name,search_text,zones,equipment,language,loggable,payload) VALUES ${rows.map(() => "(?,?,?,?,?,?,?,?,?,?)").join(",")} ON CONFLICT(id) DO NOTHING`,
          )
          .bind(...bindings),
      );
    }
    for (let i = 0; i < pending.length; i += 40) {
      const rows = pending.slice(i, i + 40);
      statements.push(
        this.db
          .prepare(
            `INSERT INTO catalog_memberships (release,exercise_id) VALUES ${rows.map(() => "(?,?)").join(",")} ON CONFLICT DO NOTHING`,
          )
          .bind(...rows.flatMap((r) => [snapshot.release, r.id])),
      );
    }
    if (statements.length) await this.db.batch(statements);
    const total = await this.db
      .prepare(
        "SELECT COUNT(*) AS count FROM catalog_memberships WHERE release = ?",
      )
      .bind(snapshot.release)
      .first<{ count: number }>();
    const imported = total?.count ?? 0;
    if (imported === snapshot.count)
      await this.db
        .prepare(
          "INSERT INTO catalog_releases (id,record_count,imported_at) VALUES (?,?,?) ON CONFLICT(id) DO NOTHING",
        )
        .bind(snapshot.release, snapshot.count, snapshot.fetchedAt)
        .run();
    return imported;
  }
  async search(params: URLSearchParams) {
    const imported = await this.ensureImported();
    if (imported < snapshot.count)
      return {
        exercises: [],
        total: 0,
        page: 1,
        pageSize: 24,
        catalogTotal: snapshot.count,
        russianCount: snapshot.exercises.filter((e) => e.language === "ru")
          .length,
        release: snapshot.release,
        fetchedAt: snapshot.fetchedAt,
        importing: true,
        imported,
      };
    const query = (params.get("q") ?? "")
      .trim()
      .toLocaleLowerCase()
      .slice(0, 100)
      .replace(/[\\%_]/g, "\\$&");
    const zone = params.get("muscle") ?? "all";
    const equipment = params.get("equipment") ?? "all";
    const page = Math.max(1, Math.min(10000, Number(params.get("page")) || 1));
    const language = params.get("language") ?? "all";
    const where = ["catalog_memberships.release = ?"];
    const bindings: (string | number)[] = [snapshot.release];
    if (query) {
      where.push("search_text LIKE ? ESCAPE '\\'");
      bindings.push("%" + query + "%");
    }
    if (zone !== "all") {
      where.push("EXISTS (SELECT 1 FROM json_each(zones) WHERE value = ?)");
      bindings.push(zone);
    }
    if (!["all", "gym"].includes(equipment)) {
      where.push("equipment = ?");
      bindings.push(equipment);
    }
    if (["ru", "en"].includes(language)) {
      where.push("language = ?");
      bindings.push(language);
    }
    const clause = where.join(" AND ");
    const [rows, count] = await Promise.all([
      this.db
        .prepare(
          `SELECT payload FROM exercise_catalog JOIN catalog_memberships ON exercise_catalog.id = catalog_memberships.exercise_id WHERE ${clause} ORDER BY name, exercise_catalog.id LIMIT 24 OFFSET ?`,
        )
        .bind(...bindings, (Math.floor(page) - 1) * 24)
        .all<{ payload: string }>(),
      this.db
        .prepare(
          `SELECT COUNT(*) AS count FROM exercise_catalog JOIN catalog_memberships ON exercise_catalog.id = catalog_memberships.exercise_id WHERE ${clause}`,
        )
        .bind(...bindings)
        .first<{ count: number }>(),
    ]);
    return {
      exercises: rows.results.map((r) => JSON.parse(r.payload) as Exercise),
      total: count?.count ?? 0,
      page: Math.floor(page),
      pageSize: 24,
      catalogTotal: snapshot.count,
      russianCount: snapshot.exercises.filter((e) => e.language === "ru")
        .length,
      release: snapshot.release,
      fetchedAt: snapshot.fetchedAt,
    };
  }
  async findByIds(ids: string[]): Promise<Map<string, Exercise>> {
    const unique = [...new Set(ids)]
      .filter((id) => id.startsWith("wger:"))
      .slice(0, 30);
    if (!unique.length) return new Map();
    await this.ensureImported();
    const rows = await this.db
      .prepare(
        `SELECT id,payload FROM exercise_catalog WHERE id IN (${unique.map(() => "?").join(",")})`,
      )
      .bind(...unique)
      .all<{ id: string; payload: string }>();
    return new Map(rows.results.map((r) => [r.id, JSON.parse(r.payload)]));
  }
}
