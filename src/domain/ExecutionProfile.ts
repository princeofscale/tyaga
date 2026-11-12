import type { ExecutionProfile as Profile } from "../lib/types";

export class ExecutionProfile {
  static parse(value: unknown): Profile {
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error("Проверь параметры выполнения");
    const v = value as Record<string, unknown>;
    const result: Profile = {};
    if (v.rom !== undefined) {
      if (
        !["full", "lengthened_partial", "shortened_partial", "custom"].includes(
          String(v.rom),
        )
      )
        throw new Error("Неизвестная амплитуда");
      result.rom = v.rom as Profile["rom"];
    }
    for (const key of ["grip", "stance", "attachment", "tempo"] as const) {
      if (v[key] === undefined) continue;
      if (typeof v[key] !== "string" || v[key].length > 80)
        throw new Error("Проверь описание выполнения");
      if (v[key].trim()) result[key] = v[key].trim();
    }
    for (const key of [
      "benchAngle",
      "torsoAngle",
      "startAngle",
      "endAngle",
    ] as const) {
      if (v[key] === undefined) continue;
      const min = key === "benchAngle" ? -90 : key === "torsoAngle" ? -180 : 0;
      const max = key === "benchAngle" ? 90 : 180;
      if (
        typeof v[key] !== "number" ||
        !Number.isFinite(v[key]) ||
        v[key] < min ||
        v[key] > max
      )
        throw new Error("Проверь углы выполнения");
      result[key] = v[key];
    }
    return result;
  }
}
