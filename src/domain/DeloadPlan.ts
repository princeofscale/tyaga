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
    const record: DeloadPlanRecord = { mode, from: today, until: addCalendarDays(today, 6), programs };
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

  /** «85% веса, 50% подходов». */
  static parameters(mode: DeloadMode) {
    const preset = DELOAD_PRESETS[mode];
    return `${Math.round(preset.intensityMultiplier * 100)}% веса, ${Math.round(preset.volumeMultiplier * 100)}% подходов`;
  }
  static describe(record: DeloadPlanRecord) {
    const names = record.programs.slice(0, 4).join(", ") + (record.programs.length > 4 ? ` и ещё ${record.programs.length - 4}` : "");
    return `Разгрузка на неделю: ${DeloadPlan.parameters(record.mode)} — применена к программам ${names}.`;
  }

  /** Тренировка из программы с разгрузкой; своя разгрузочная неделя цикла программы второй раз не уменьшается. */
  static workout(workout: Workout, record: DeloadPlanRecord | null, programIsDeload = false): Workout {
    if (!record || programIsDeload) return workout;
    const result = DeloadEngine.transformWorkoutForDeload(workout, record.mode);
    // Новая тренировка получает собственный id при запуске, а не id шаблона разгрузки.
    return { ...result, id: workout.id };
  }
}
