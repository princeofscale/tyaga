import { isCalendarDate } from "../lib/calendar";
import type { LaidDay, LaidMaxes, RoutinePeriodization } from "../lib/types";

export type PeriodizationCheck = { ok: true; value: RoutinePeriodization } | { ok: false; message: string };

const KEYS = [
  "kind",
  "cycleId",
  "day",
  "startMonday",
  "maxes",
  "maxesFromWeek",
  "earlier",
  "extras",
  "light",
  "substitutions",
  "calibrationLifts",
  "painFlags",
];
const LIFTS = ["bench", "deadlift", "ohp", "squat"] as const;
const MAX_SUBSTITUTIONS = 30;
const fail = (message: string): PeriodizationCheck => ({ ok: false, message });
const plain = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const whole = (v: unknown, min: number, max: number): v is number => typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;

/**
 * Единые правила структуры `Routine.periodization`: по ним проверяют и сервер (`validPeriodization`, 400 с текстом),
 * и клиент (`LaidDupPlan.periodizationOf`: не прошло — программа обычная). Тексты ошибок — для человека.
 */
export class PeriodizationRules {
  static readonly DAYS: LaidDay[] = ["legs1", "push1", "pull1", "legs2", "push2", "pull2"];
  static readonly MAX_KG = 500;

  private static maxes(value: unknown): LaidMaxes | null {
    if (!plain(value) || Object.keys(value).sort().join() !== LIFTS.join()) return null;
    const kg = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v >= 1 && v <= PeriodizationRules.MAX_KG;
    const m = value;
    return kg(m.squat) && kg(m.bench) && kg(m.deadlift) && kg(m.ohp) ? (m as unknown as LaidMaxes) : null;
  }

  static check(value: unknown): PeriodizationCheck {
    if (!plain(value)) return fail("Проверь периодизацию программы");
    const p = value;
    if (Object.keys(p).some((key) => !KEYS.includes(key))) return fail("Проверь периодизацию программы");
    if (p.kind !== "laid-dup") return fail("Проверь вид периодизации");
    const day = PeriodizationRules.DAYS.find((d) => d === p.day);
    if (!day) return fail("Проверь день периодизации");
    const startMonday = p.startMonday;
    if (typeof startMonday !== "string" || startMonday.length !== 10 || !isCalendarDate(startMonday) || new Date(startMonday + "T12:00:00Z").getUTCDay() !== 1)
      return fail("Старт программы — понедельник");
    if (!whole(p.maxesFromWeek, 0, 9)) return fail("Проверь номер недели максимумов");
    const earlier: { fromWeek: number; maxes: LaidMaxes }[] = [];
    if (p.earlier !== undefined) {
      if (!Array.isArray(p.earlier) || p.earlier.length > 8) return fail("Проверь прежние максимумы");
      for (const item of p.earlier) {
        if (!plain(item) || Object.keys(item).sort().join() !== "fromWeek,maxes") return fail("Проверь прежние максимумы");
        const maxes = PeriodizationRules.maxes(item.maxes);
        if (!whole(item.fromWeek, 0, 9) || !maxes) return fail("Проверь прежние максимумы");
        if (item.fromWeek >= p.maxesFromWeek || (earlier.length && item.fromWeek <= earlier[earlier.length - 1].fromWeek))
          return fail("Проверь недели прежних максимумов");
        earlier.push({ fromWeek: item.fromWeek, maxes });
      }
    }
    const maxes = PeriodizationRules.maxes(p.maxes);
    if (!maxes) return fail("Проверь максимумы программы");
    if (typeof p.cycleId !== "string" || p.cycleId.length > 80 || p.cycleId.trim().length < 1) return fail("Проверь цикл программы");
    if (typeof p.extras !== "boolean" || typeof p.light !== "boolean") return fail("Проверь настройки периодизации");
    let substitutions: Record<string, string> | undefined;
    if (p.substitutions !== undefined) {
      if (!plain(p.substitutions)) return fail("Проверь замены упражнений");
      const entries = Object.entries(p.substitutions);
      if (entries.length > MAX_SUBSTITUTIONS) return fail("Проверь замены упражнений");
      const cleaned: Record<string, string> = {};
      for (const [orig, repl] of entries) {
        const from = orig.trim();
        const to = typeof repl === "string" ? repl.trim() : "";
        if (!from || from.length > 80 || !to || to.length > 80 || from === to)
          return fail("Проверь замены упражнений");
        cleaned[from] = to;
      }
      if (Object.keys(cleaned).length > 0) substitutions = cleaned;
    }
    const checkLiftList = (raw: unknown, msg: string): (keyof LaidMaxes)[] | undefined | null => {
      if (raw === undefined) return undefined;
      if (!Array.isArray(raw) || raw.length > 4) return null;
      const seen = new Set<keyof LaidMaxes>();
      for (const item of raw) {
        if (typeof item !== "string" || !(LIFTS as readonly string[]).includes(item)) return null;
        seen.add(item as keyof LaidMaxes);
      }
      if (seen.size !== raw.length) return null;
      void msg;
      return seen.size ? [...seen] : undefined;
    };
    const calibrationLifts = checkLiftList(p.calibrationLifts, "Проверь список калибровки");
    if (calibrationLifts === null) return fail("Проверь список калибровки");
    const painFlags = checkLiftList(p.painFlags, "Проверь пометки боли");
    if (painFlags === null) return fail("Проверь пометки боли");
    return {
      ok: true,
      value: {
        kind: "laid-dup",
        cycleId: p.cycleId.trim(),
        day,
        startMonday,
        maxes: { squat: maxes.squat, bench: maxes.bench, deadlift: maxes.deadlift, ohp: maxes.ohp },
        maxesFromWeek: p.maxesFromWeek,
        ...(earlier.length ? { earlier } : {}),
        extras: p.extras,
        light: p.light,
        ...(substitutions ? { substitutions } : {}),
        ...(calibrationLifts ? { calibrationLifts } : {}),
        ...(painFlags ? { painFlags } : {}),
      },
    };
  }
}
