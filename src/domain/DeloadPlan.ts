import { addCalendarDays } from "../lib/calendar";
import type { Routine, Workout } from "../lib/types";
import { DELOAD_PRESETS, DeloadEngine, type DeloadMode } from "./DeloadEngine";

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export type DeloadPlanRecord = {
  mode: DeloadMode;
  /** Первый день разгрузки и последний (включительно): неделя с момента нажатия. */
  from: string;
  until: string;
  /** Названия программ, к которым применена разгрузка. */
  programs: string[];
  /** Рабочих подходов в этих программах до разгрузки и после: процент в сообщении считается по ним, а не по пресету. */
  sets?: { before: number; after: number };
};
export type DeloadApplication =
  | { applied: true; record: DeloadPlanRecord; message: string }
  | { applied: false; message: string };

/**
 * Разгрузка на неделю «Применить к тренировкам» (R04-REQ02).
 * Сохранённые программы и история не меняются: разгрузка — пометка на устройстве, по которой запуск программы
 * на этой неделе даёт уменьшенный вес и число подходов. «Отменить» снимает пометку, и программа снова
 * запускается как раньше.
 */
export class DeloadPlan {
  constructor(
    private storage: () => Store | null = () => (typeof localStorage === "undefined" ? null : localStorage),
    private accountId: string,
  ) {}

  static key(accountId: string) {
    return `tyaga-deload:${accountId}`;
  }
  private store() {
    try { return this.storage(); } catch { return null; }
  }

  /** Действующая разгрузка на `today`; просроченная стирается. */
  read(today: string): DeloadPlanRecord | null {
    const store = this.store();
    try {
      const raw = store?.getItem(DeloadPlan.key(this.accountId));
      const record = raw ? (JSON.parse(raw) as DeloadPlanRecord) : null;
      if (!record || !(record.mode in DELOAD_PRESETS) || typeof record.until !== "string") return null;
      if (record.until < today) {
        store?.removeItem(DeloadPlan.key(this.accountId));
        return null;
      }
      return { ...record, programs: Array.isArray(record.programs) ? record.programs : [] };
    } catch {
      return null;
    }
  }

  /** Нечего менять, если нет сохранённых программ: разгрузка действует на запуск программ. */
  apply(mode: DeloadMode, today: string, routines: Routine[]): DeloadApplication {
    const programs = routines.map((r) => r.name).filter(Boolean);
    if (!programs.length)
      return {
        applied: false,
        message: "Нечего менять: нет сохранённых программ. Разгрузка меняет запуск программ; пустую тренировку собери с меньшим весом сам.",
      };
    const record: DeloadPlanRecord = { mode, from: today, until: addCalendarDays(today, 6), programs, sets: DeloadPlan.setCounts(routines, mode) };
    try {
      const store = this.store();
      if (!store) throw new Error("storage unavailable");
      store.setItem(DeloadPlan.key(this.accountId), JSON.stringify(record));
    } catch {
      return { applied: false, message: "Не удалось сохранить разгрузку на устройстве: хранилище недоступно." };
    }
    return { applied: true, record, message: DeloadPlan.describe(record) };
  }

  cancel() {
    try { this.store()?.removeItem(DeloadPlan.key(this.accountId)); } catch { /* хранилище недоступно */ }
  }

  /** Рабочие подходы программ до и после разгрузки по тому же правилу, что и `DeloadEngine` (округление на каждое упражнение, минимум 1). */
  static setCounts(routines: Routine[], mode: DeloadMode) {
    const multiplier = DELOAD_PRESETS[mode].volumeMultiplier;
    let before = 0;
    let after = 0;
    for (const routine of routines)
      for (const exercise of routine.exercises) {
        const working = exercise.sets.filter((set) => !set.warmup).length;
        if (!working) continue;
        before += working;
        after += Math.max(1, Math.round(working * multiplier));
      }
    return { before, after };
  }

  /**
   * «85% веса, 50% подходов». Если известны реальные подходы программ, процент честный:
   * при трёх подходах пресет 50% даёт два (67%), и так и написано — «67% подходов (9 → 6)».
   */
  static parameters(mode: DeloadMode, sets?: { before: number; after: number }) {
    const preset = DELOAD_PRESETS[mode];
    const volume = sets && sets.before > 0 ? `${Math.round((sets.after / sets.before) * 100)}% подходов (${sets.before} → ${sets.after})` : `${Math.round(preset.volumeMultiplier * 100)}% подходов`;
    return `${Math.round(preset.intensityMultiplier * 100)}% веса, ${volume}`;
  }
  static describe(record: DeloadPlanRecord) {
    const names = record.programs.slice(0, 4).join(", ") + (record.programs.length > 4 ? ` и ещё ${record.programs.length - 4}` : "");
    return `Разгрузка на неделю: ${DeloadPlan.parameters(record.mode, record.sets)} — применена к программам ${names}.`;
  }

  /** Тренировка из программы с разгрузкой; своя разгрузочная неделя цикла программы второй раз не уменьшается. */
  static workout(workout: Workout, record: DeloadPlanRecord | null, programIsDeload = false): Workout {
    if (!record || programIsDeload) return workout;
    const result = DeloadEngine.transformWorkoutForDeload(workout, record.mode);
    // Новая тренировка получает собственный id при запуске, а не id шаблона разгрузки.
    return { ...result, id: workout.id };
  }
}
