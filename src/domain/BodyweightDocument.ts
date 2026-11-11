import type { BodyweightEntry, BodyweightGoal } from "./BodyweightTracker";
export type WeightValue = BodyweightEntry | BodyweightGoal | null;
export type WeightDocument = {
  key: string;
  value: WeightValue;
  revision: number;
  mutationId: string;
  updatedAt: string;
};

/** Shared validation for browser cache, authenticated API and device replication. */
export class BodyweightDocument {
  static key(key: string) {
    if (key === "goal") return key;
    if (!/^weight:\d{4}-\d{2}-\d{2}$/.test(key))
      throw new Error("Некорректный ключ взвешивания");
    const date = key.slice(7),
      parsed = new Date(date + "T12:00:00Z");
    if (
      !Number.isFinite(parsed.getTime()) ||
      parsed.toISOString().slice(0, 10) !== date
    )
      throw new Error("Проверь дату взвешивания");
    return key;
  }
  static value(key: string, value: unknown): WeightValue {
    this.key(key);
    if (value === null) return null;
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error("Некорректные данные веса");
    const v = value as Record<string, unknown>;
    const weight = (n: unknown) =>
      typeof n === "number" && Number.isFinite(n) && n >= 20 && n <= 500;
    if (key === "goal") {
      if (
        ![v.targetWeightKg, v.startWeightKg].every(
          (n) => n === null || weight(n),
        )
      )
        throw new Error("Цель: от 20 до 500 кг");
      return {
        targetWeightKg: v.targetWeightKg as number | null,
        startWeightKg: v.startWeightKg as number | null,
      };
    }
    if (
      v.date !== key.slice(7) ||
      !weight(v.weightKg) ||
      typeof v.id !== "string" ||
      !v.id.length ||
      v.id.length > 100 ||
      typeof v.createdAt !== "number" ||
      !Number.isFinite(v.createdAt) ||
      v.createdAt < 0 ||
      (v.note !== undefined &&
        (typeof v.note !== "string" || v.note.length > 200))
    )
      throw new Error("Проверь замер: вес, дата и заметка до 200 символов");
    return {
      id: v.id,
      date: v.date as string,
      weightKg: v.weightKg as number,
      createdAt: v.createdAt,
      note: typeof v.note === "string" ? v.note : "",
    };
  }
}
