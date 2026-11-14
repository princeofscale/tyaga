import { BodyweightDocument } from "./BodyweightDocument";
import type { BodyweightEntry, BodyweightGoal } from "./BodyweightTracker";
import type { ProductData, Settings, Workout } from "../lib/types";
import { THEMES, type ThemeId } from "../lib/theme";
export type ProfileBackup = {
  displayName: string;
  timeZone: string;
  bodyMassKg: number | null;
};
export type WeightBackup = { entries: BodyweightEntry[]; goal: BodyweightGoal };
export class JournalBackup {
  static weights(value: unknown): WeightBackup {
    if (!value || typeof value !== "object")
      throw new Error("Не удалось прочитать вес в резервной копии");
    const v = value as Record<string, unknown>;
    if (!Array.isArray(v.entries) || v.entries.length > 10000)
      throw new Error("Проверь список взвешиваний в копии");
    const entries = v.entries.map((e) => {
      if (!e || typeof e !== "object") throw new Error("Повреждён замер веса");
      const date = (e as BodyweightEntry).date;
      return BodyweightDocument.value(`weight:${date}`, e) as BodyweightEntry;
    });
    if (new Set(entries.map((e) => e.date)).size !== entries.length)
      throw new Error("В копии повторяются даты взвешиваний");
    const goal = BodyweightDocument.value("goal", v.goal);
    if (!goal) throw new Error("В копии повреждена цель веса");
    return {
      entries: entries.sort((a, b) => a.date.localeCompare(b.date)),
      goal: goal as BodyweightGoal,
    };
  }
  static merge(
    current: BodyweightEntry[],
    incoming: BodyweightEntry[],
    replace = false,
  ) {
    const result = new Map(current.map((e) => [e.date, e]));
    const conflictDates: string[] = [];
    let added = 0,
      same = 0;
    for (const entry of incoming) {
      const existing = result.get(entry.date);
      if (!existing) {
        added++;
        result.set(entry.date, entry);
      } else if (
        existing.weightKg === entry.weightKg &&
        (existing.note ?? "") === (entry.note ?? "")
      )
        same++;
      else {
        conflictDates.push(entry.date);
        if (replace) result.set(entry.date, entry);
      }
    }
    return {
      entries: [...result.values()].sort((a, b) =>
        a.date.localeCompare(b.date),
      ),
      added,
      same,
      conflictDates,
    };
  }
  static theme(value: unknown): ThemeId | undefined {
    if (value === undefined) return undefined;
    if (typeof value !== "string" || !THEMES.some((t) => t.id === value))
      throw new Error("В копии неизвестная тема");
    return value as ThemeId;
  }
  static profile(value: unknown): ProfileBackup | undefined {
    if (value === undefined) return undefined;
    if (!value || typeof value !== "object")
      throw new Error("В копии повреждён профиль");
    const p = value as ProfileBackup;
    if (
      typeof p.displayName !== "string" ||
      !p.displayName.trim() ||
      p.displayName.length > 80 ||
      typeof p.timeZone !== "string" ||
      (p.bodyMassKg !== null &&
        (!Number.isFinite(p.bodyMassKg) ||
          p.bodyMassKg < 20 ||
          p.bodyMassKg > 500))
    )
      throw new Error("Проверь имя, часовой пояс и массу в копии");
    try {
      new Intl.DateTimeFormat("ru", { timeZone: p.timeZone });
    } catch {
      throw new Error("В копии неизвестный часовой пояс");
    }
    return {
      displayName: p.displayName.trim(),
      timeZone: p.timeZone,
      bodyMassKg: p.bodyMassKg,
    };
  }
  static create(
    workouts: Workout[],
    settings: Settings,
    product: ProductData,
    weights: WeightBackup,
    theme: ThemeId,
    profile?: ProfileBackup,
  ) {
    return {
      format: "tyaga-backup",
      version: 5,
      analysisVersion: 2,
      e1rmFormulaVersion: "epley-1",
      exportedAt: new Date().toISOString(),
      workouts,
      settings,
      machines: product.machines ?? [],
      routines: product.routines,
      customExercises: product.customExercises,
      favorites: product.favorites,
      bodyweight: weights,
      theme,
      profile,
    };
  }
}
