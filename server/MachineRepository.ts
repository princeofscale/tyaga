import type { MachineInstance } from "../src/lib/types";
import { InputError } from "./validation";

export class MachineRepository {
  constructor(
    private db: D1Database,
    private owner: string,
  ) {}
  async read(activeOnly = true): Promise<MachineInstance[]> {
    const rows = await this.db
      .prepare(
        `SELECT payload,revision FROM machine_instances WHERE owner_id=? ${activeOnly ? "AND active=1" : ""} ORDER BY updated_at DESC,id`,
      )
      .bind(this.owner)
      .all<{ payload: string; revision: number }>();
    return rows.results.map((r) => ({
      ...JSON.parse(r.payload),
      revision: r.revision,
    }));
  }
  async definitions() {
    return new Map((await this.read(false)).map((m) => [m.id, m]));
  }
  statements(machine: MachineInstance, restore = false) {
    const stamp = new Date().toISOString();
    const { revision, ...content } = machine;
    return [
      this.db
        .prepare(
          "INSERT INTO machine_models (owner_id,id,payload) VALUES (?,?,?) ON CONFLICT(owner_id,id) DO NOTHING",
        )
        .bind(this.owner, machine.model.id, JSON.stringify(machine.model)),
      restore
        ? this.db
            .prepare(
              "INSERT INTO machine_instances (owner_id,id,model_id,payload,revision,active,updated_at) VALUES (?,?,?,?,1,1,?) ON CONFLICT(owner_id,id) DO NOTHING RETURNING id",
            )
            .bind(
              this.owner,
              machine.id,
              machine.model.id,
              JSON.stringify(content),
              stamp,
            )
        : revision === 0
          ? this.db
              .prepare(
                "INSERT INTO machine_instances (owner_id,id,model_id,payload,revision,active,updated_at) VALUES (?,?,?,?,1,1,?) ON CONFLICT(owner_id,id) DO NOTHING RETURNING id",
              )
              .bind(
                this.owner,
                machine.id,
                machine.model.id,
                JSON.stringify(content),
                stamp,
              )
          : this.db
              .prepare(
                "UPDATE machine_instances SET model_id=?,payload=?,revision=revision+1,active=1,updated_at=? WHERE owner_id=? AND id=? AND revision=? RETURNING id",
              )
              .bind(
                machine.model.id,
                JSON.stringify(content),
                stamp,
                this.owner,
                machine.id,
                revision,
              ),
    ];
  }
  async validateModel(machine: MachineInstance) {
    const existing = await this.db
      .prepare("SELECT payload FROM machine_models WHERE owner_id=? AND id=?")
      .bind(this.owner, machine.model.id)
      .first<{ payload: string }>();
    if (existing && existing.payload !== JSON.stringify(machine.model))
      throw new InputError(
        "Описание модели изменилось. Создай отдельную модель тренажёра.",
      );
  }
  async save(machine: MachineInstance) {
    await this.validateModel(machine);
    const previous = await this.db
      .prepare(
        "SELECT model_id FROM machine_instances WHERE owner_id=? AND id=?",
      )
      .bind(this.owner, machine.id)
      .first<{ model_id: string }>();
    if (previous && previous.model_id !== machine.model.id)
      throw new InputError("Для другой модели создай новую станцию");
    const count = await this.db
      .prepare(
        "SELECT COUNT(*) AS count FROM machine_instances WHERE owner_id=? AND active=1 AND id<>?",
      )
      .bind(this.owner, machine.id)
      .first<{ count: number }>();
    if ((count?.count ?? 0) >= 200)
      throw new InputError("Можно сохранить до 200 тренажёров");
    const result = await this.db.batch(this.statements(machine));
    const current = (await this.definitions()).get(machine.id) ?? null;
    if (result[1].results.length) return { saved: current };
    if (current) {
      const { revision: _currentRevision, ...currentContent } = current;
      const { revision: _inputRevision, ...inputContent } = machine;
      if (JSON.stringify(currentContent) === JSON.stringify(inputContent))
        return { saved: current };
    }
    return { current };
  }
  async archive(id: string, revision: number) {
    const result = await this.db
      .prepare(
        "UPDATE machine_instances SET active=0,revision=revision+1,updated_at=? WHERE owner_id=? AND id=? AND revision=? RETURNING id",
      )
      .bind(new Date().toISOString(), this.owner, id, revision)
      .all();
    if (result.results.length) return true;
    const current = await this.db
      .prepare(
        "SELECT revision,active FROM machine_instances WHERE owner_id=? AND id=?",
      )
      .bind(this.owner, id)
      .first<{ revision: number; active: number }>();
    return current?.active === 0 && current.revision === revision + 1;
  }
}
