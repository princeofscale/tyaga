import type { Exercise, Routine, Workout } from "../lib/types";
import type { ImportedWorkout } from "./WorkoutImport";
import { quantity } from "../lib/quantity";
import { DateText } from "./DateText";
import { LaidDupPlan } from "./LaidDupPlan";

export type ExistingData = { workouts: Workout[]; routines: Routine[]; customExercises: Exercise[]; favorites: string[] };
export type Tally = { total: number; added: number; same: number; differs: number };

type Shape = {
  name: string;
  date: string;
  duration?: number;
  notes?: string;
  restSeconds?: number;
  exercises: {
    exerciseId?: string;
    bodyMassKg?: number;
    equipmentNote?: string;
    machineInstanceId?: string;
    execution?: unknown;
    sets: {
      weight?: number;
      reps?: number | null;
      rir?: number | null;
      warmup?: boolean;
      done?: boolean;
      kind?: string;
      assistanceKg?: number;
      durationSeconds?: number;
      distanceKm?: number;
      execution?: unknown;
    }[];
  }[];
};
const signature = (w: Shape) =>
  JSON.stringify([
    w.name,
    w.date,
    w.duration ?? 0,
    (w.notes ?? "").trim(),
    w.restSeconds ?? null,
    w.exercises.map((e) => [
      e.exerciseId ?? "",
      e.bodyMassKg ?? null,
      e.equipmentNote ?? "",
      e.machineInstanceId ?? "",
      e.execution ?? null,
      e.sets.map((s) => [
        s.weight ?? 0,
        s.reps ?? 0,
        s.rir ?? null,
        Boolean(s.warmup),
        s.done ?? true,
        s.kind ?? (s.warmup ? "warmup" : "normal"),
        s.assistanceKg ?? null,
        s.durationSeconds ?? null,
        s.distanceKm ?? null,
        s.execution ?? null,
      ]),
    ]),
  ]);

/**
 * Что сделает восстановление из копии, словами: сколько тренировок, программ, своих упражнений и избранного
 * новые, сколько уже есть в аккаунте и сколько отличаются. Сервер не перезаписывает существующую тренировку
 * с тем же идентификатором, поэтому «Отличаются» остаются в аккаунте как есть.
 */
export class RestorePlan {
  static workouts(incoming: ImportedWorkout[], existing: Workout[]): Tally {
    const byId = new Map(existing.map((w) => [w.id, w]));
    const tally: Tally = { total: incoming.length, added: 0, same: 0, differs: 0 };
    for (const w of incoming) {
      const have = w.nativeId ? byId.get(w.nativeId) : undefined;
      if (!have) tally.added++;
      else if (signature(have as unknown as Shape) === signature(w as unknown as Shape)) tally.same++;
      else tally.differs++;
    }
    return tally;
  }

  private static byKey<T>(incoming: T[], existing: T[], key: (item: T) => string, same: (a: T, b: T) => boolean): Tally {
    const have = new Map(existing.map((e) => [key(e), e]));
    const tally: Tally = { total: incoming.length, added: 0, same: 0, differs: 0 };
    for (const item of incoming) {
      const found = have.get(key(item));
      if (!found) tally.added++;
      else if (same(found, item)) tally.same++;
      else tally.differs++;
    }
    return tally;
  }

  /**
   * Программа цикла Лейда при восстановлении получает новый id (`restore:…`), но сохраняет `cycleId` и день:
   * по ним повторное восстановление узнаёт уже перенесённую программу, а не считает её новой (R11-REQ03).
   */
  private static laidKey(r: Routine) {
    const p = LaidDupPlan.periodizationOf(r);
    return p ? `laid:${p.cycleId}:${p.day}` : r.id;
  }
  static routines(incoming: Routine[], existing: Routine[]) {
    return this.byKey(incoming, existing, (r) => this.laidKey(r), (a, b) => a.name === b.name && JSON.stringify(a.days) === JSON.stringify(b.days));
  }

  /**
   * Предупреждение над «Импортировать»: у аккаунта уже есть цикл Лейда, а копия принесёт ещё один (с другим `cycleId`).
   * Пусто, если у аккаунта циклов нет, в копии нет программ с периодизацией или все её циклы уже на месте.
   * Даты — старты циклов («18 янв.»; с годом, если он не текущий).
   */
  static laidNotice(incoming: Routine[], existing: Routine[], currentYear: string): string {
    const mine = LaidDupPlan.cycles(existing);
    if (!mine.length) return "";
    const have = new Set(mine.map((c) => LaidDupPlan.periodizationOf(c[0])!.cycleId));
    const fresh = LaidDupPlan.cycles(incoming.filter((r) => !existing.some((e) => e.id === r.id))).filter(
      (c) => !have.has(LaidDupPlan.periodizationOf(c[0])!.cycleId),
    );
    if (!fresh.length) return "";
    const starts = (cycles: Routine[][]) =>
      cycles.map((c) => DateText.dayInYear(LaidDupPlan.periodizationOf(c[0])!.startMonday, currentYear)).join(", ");
    const total = mine.length + fresh.length;
    const words = ["", "", "два", "три", "четыре"];
    const after = words[total] ? `будут ${words[total]} цикла` : `будет ${quantity(total, "цикл", "цикла", "циклов")}`;
    return (
      `В копии есть ${fresh.length === 1 ? "цикл" : "циклы"} Лейда (старт ${starts(fresh)}), ` +
      `а у тебя уже есть ${mine.length === 1 ? "свой" : "свои"} (старт ${starts(mine)}). После импорта ${after}.`
    );
  }
  static customExercises(incoming: Exercise[], existing: Exercise[]) {
    return this.byKey(incoming, existing, (e) => e.custom?.familyId ?? e.id, (a, b) => a.id === b.id);
  }
  static favorites(incoming: string[], existing: string[]): Tally {
    const have = new Set(existing);
    const added = incoming.filter((id) => !have.has(id)).length;
    return { total: incoming.length, added, same: incoming.length - added, differs: 0 };
  }

  static words(t: Tally) {
    return `Новых ${t.added} · Уже есть ${t.same} · Отличаются ${t.differs}`;
  }

  /** «Ничего нового: все 240 тренировок уже в аккаунте» — только если и остальное уже на месте. */
  static nothingNew(workouts: Tally, others: Tally[]) {
    if (workouts.total && workouts.added === 0 && others.every((o) => o.added === 0))
      return `Ничего нового: ${workouts.differs ? `все ${quantity(workouts.total, "тренировка", "тренировки", "тренировок")} уже есть в аккаунте (${workouts.differs} отличаются, останутся как в аккаунте)` : `все ${quantity(workouts.total, "тренировка", "тренировки", "тренировок")} уже в аккаунте`}`;
    return "";
  }
}
