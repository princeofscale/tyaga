import type { Exercise } from "../src/lib/types";
import { exerciseById } from "../src/lib/model";
import { ProductRepository } from "./ProductRepository";
import { ExerciseRepository } from "./ExerciseRepository";
import { PersonalExerciseFactory, digest } from "./PersonalExerciseFactory";
import { object, str, validRoutine, InputError } from "./validation";

export class BackupImportService {
  constructor(
    private db: D1Database,
    private owner: string,
  ) {}
  async import(value: unknown) {
    const v = object(value),
      kind = str(v.kind, 20, 1);
    if (!Array.isArray(v.items) || v.items.length > 10)
      throw new InputError("Не больше 10 записей метаданных в пакете");
    const product = new ProductRepository(this.db, this.owner),
      ownerHash = await digest(this.owner),
      idMap: Record<string, string> = {};
    const supplied = object(v.idMap ?? {});
    let created = 0,
      skipped = 0;
    const exercises: Exercise[] = [];
    if (kind === "custom") {
      if (v.items.length > 5)
        throw new InputError("Не больше пяти личных упражнений в пакете");
      const inputs = v.items.map(object);
      const known = await product.definitions(
        inputs.map((e) => str(e.id, 80, 1)),
      );
      for (const raw of inputs) {
        const id = str(raw.id, 80, 1);
        if (known.has(id)) {
          idMap[id] = id;
          skipped++;
          continue;
        }
        const custom = object(raw.custom);
        const familyId = (
          await digest(this.owner + "|restore|" + str(custom.familyId, 36, 1))
        ).slice(0, 24);
        const e = await new PersonalExerciseFactory().create({
          familyId,
          name: raw.name,
          nameEn: raw.nameEn ?? "",
          aliases: raw.aliases ?? [],
          notes: raw.tip ?? "",
          equipment: raw.equipment,
          declaredZones: custom.declaredZones ?? [],
          origin: "tyaga",
          recording: raw.recording,
        });
        // Restore without replacing a newer personal variant.
        const exists = await product.definitions([e.id]);
        if (!exists.has(e.id)) {
          await product.saveExercise(e);
          created++;
        } else skipped++;
        idMap[id] = e.id;
        exercises.push(e);
      }
    } else if (kind === "routines") {
      if (v.items.length > 2)
        throw new InputError("Не больше двух программ в пакете");
      for (const raw of v.items.map(object)) {
        const oldId = str(raw.id, 80, 1),
          id = `restore:${ownerHash}:${await digest(oldId)}`;
        const exists = await this.db
          .prepare("SELECT id FROM routines WHERE owner_id=? AND id IN (?,?)")
          .bind(this.owner, oldId, id)
          .first<{ id: string }>();
        if (exists) {
          idMap[oldId] = exists.id;
          skipped++;
          continue;
        }
        if (!Array.isArray(raw.exercises))
          throw new InputError("Проверь упражнения программы");
        const entries = raw.exercises.map((e) => {
          const entry = object(e),
            old = str(entry.exerciseId, 80, 1);
          return {
            ...entry,
            exerciseId:
              typeof supplied[old] === "string"
                ? str(supplied[old], 80, 1)
                : old,
          };
        });
        const ids = entries.map((e) => e.exerciseId),
          [wger, personal] = await Promise.all([
            new ExerciseRepository(this.db).findByIds(ids),
            product.definitions(ids),
          ]);
        const result = await product.saveRoutine(
          validRoutine(
            { ...raw, id, revision: 0, exercises: entries },
            new Map([...wger, ...personal]),
          ),
        );
        if (!result.saved)
          throw new InputError("Не удалось восстановить программу");
        idMap[oldId] = id;
        created++;
      }
    } else if (kind === "favorites") {
      const ids = v.items.map((raw) => {
        const id = str(raw, 80, 1);
        return typeof supplied[id] === "string" ? str(supplied[id], 80, 1) : id;
      });
      const [wger, personal] = await Promise.all([
        new ExerciseRepository(this.db).findByIds(ids),
        product.definitions(ids),
      ]);
      for (const id of ids) {
        if (exerciseById(id) || wger.has(id) || personal.has(id)) {
          await product.favorite(id, true);
          created++;
        } else skipped++;
      }
    } else throw new InputError("Неизвестный тип метаданных");
    return { created, skipped, idMap, exercises };
  }
}
