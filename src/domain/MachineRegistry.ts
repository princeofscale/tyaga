import type { MachineInstance, MachineModel } from "../lib/types";

export class MachineRegistry {
  static create(): MachineInstance {
    return {
      id: crypto.randomUUID(),
      model: {
        id: crypto.randomUUID(),
        manufacturer: "",
        model: "",
        mechanism: "selectorized",
        loadSemantics: "stack_marking",
      },
      gym: "",
      nickname: "",
      aliases: [],
      revision: 0,
    };
  }
  static parse(value: unknown): MachineInstance {
    const object = (v: unknown): Record<string, unknown> => {
      if (!v || typeof v !== "object" || Array.isArray(v))
        throw new Error("Проверь данные тренажёра");
      return v as Record<string, unknown>;
    };
    const text = (v: unknown, max = 120, required = false) => {
      if (typeof v !== "string" || v.length > max || (required && !v.trim()))
        throw new Error("Проверь название тренажёра");
      return v.trim();
    };
    const v = object(value),
      m = object(v.model);
    if (
      ![
        "selectorized",
        "plate_loaded",
        "cable",
        "lever",
        "smith",
        "other",
      ].includes(String(m.mechanism)) ||
      !["stack_marking", "plates_added", "total_external"].includes(
        String(m.loadSemantics),
      )
    )
      throw new Error("Проверь механизм и правило веса тренажёра");
    if (!Array.isArray(v.aliases) || v.aliases.length > 20)
      throw new Error("Не больше 20 названий тренажёра");
    if (
      !Number.isInteger(v.revision ?? 0) ||
      Number(v.revision ?? 0) < 0 ||
      Number(v.revision ?? 0) > 2147483646
    )
      throw new Error("Некорректная версия тренажёра");
    const model: MachineModel = {
      id: text(m.id, 80, true),
      manufacturer: text(m.manufacturer),
      model: text(m.model, 120, true),
      mechanism: m.mechanism as MachineModel["mechanism"],
      loadSemantics: m.loadSemantics as MachineModel["loadSemantics"],
    };
    const result: MachineInstance = {
      id: text(v.id, 80, true),
      model,
      gym: text(v.gym ?? ""),
      nickname: text(v.nickname, 120, true),
      aliases: [...new Set(v.aliases.map((a) => text(a)))],
      revision: Number(v.revision ?? 0),
    };
    if (v.stationId !== undefined) result.stationId = text(v.stationId, 80);
    if (v.calibration !== undefined) {
      const c = object(v.calibration);
      result.calibration = {};
      for (const key of ["stackRatio", "pulleyRatio"] as const) {
        if (c[key] === undefined) continue;
        if (
          typeof c[key] !== "number" ||
          !Number.isFinite(c[key]) ||
          c[key] <= 0 ||
          c[key] > 100
        )
          throw new Error(
            "Коэффициент тренажёра должен быть больше 0 и не больше 100",
          );
        result.calibration[key] = c[key];
      }
      if (c.notes !== undefined) result.calibration.notes = text(c.notes, 500);
    }
    return result;
  }
  static search(machines: MachineInstance[], query: string) {
    const term = query.trim().toLocaleLowerCase("ru");
    return machines.filter((m) =>
      [m.nickname, m.gym, m.model.manufacturer, m.model.model, ...m.aliases]
        .join(" ")
        .toLocaleLowerCase("ru")
        .includes(term),
    );
  }
}
