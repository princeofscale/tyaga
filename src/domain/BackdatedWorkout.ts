import { localDate } from "../lib/calendar";
import { DateText } from "./DateText";

/** Что нужно знать о черновике, чтобы понять, пишется ли тренировка задним числом. */
export type BackdatedDraft = {
  retro?: boolean;
  startedAt: number;
  manualDuration: boolean;
  editing?: boolean;
  workout: { date: string; timeZone?: string };
};

/**
 * Запись тренировки задним числом (R07-REQ04). «Сегодня» считается по часовому поясу профиля,
 * а не браузера; даты — календарные строки ГГГГ-ММ-ДД. Модель сохранения не затрагивается.
 *
 * «Задним числом» — это дата раньше сегодняшней, выбранная человеком: тренировка начата через «Записать тренировку»
 * либо дату в «Деталях» поменяли на другой день, чем день старта. Обычная тренировка, начатая до полуночи
 * и идущая после, остаётся обычной: таймер считает реальную длительность.
 */
export class BackdatedWorkout {
  private static valid(date: string) {
    return /^\d{4}-\d{2}-\d{2}$/.test(date);
  }

  static isBackdated(draft: BackdatedDraft, fallbackZone: string | undefined, now = new Date()) {
    const zone = draft.workout.timeZone ?? fallbackZone;
    const date = draft.workout.date;
    if (draft.editing || !this.valid(date) || date >= localDate(now, zone)) return false;
    // обычная тренировка: дата осталась днём старта — это не «задним числом», даже после полуночи
    return !!draft.retro || date !== localDate(new Date(draft.startedAt), zone);
  }

  /** Подпись в шапке: null — шапку не трогаем (обычная тренировка). */
  static label(draft: BackdatedDraft, fallbackZone: string | undefined, now = new Date()): string | null {
    if (draft.editing) return null;
    const zone = draft.workout.timeZone ?? fallbackZone;
    const day = DateText.dayInYear(draft.workout.date, localDate(now, zone).slice(0, 4));
    if (this.isBackdated(draft, fallbackZone, now)) return `${day} · задним числом`;
    return draft.retro ? `${day} · выбрать дату` : null;
  }

  /** Для записи задним числом счётчик «от сейчас» не идёт: берётся указанная длительность. */
  static manualDuration(draft: BackdatedDraft, fallbackZone: string | undefined, now = new Date()) {
    return draft.manualDuration || this.isBackdated(draft, fallbackZone, now);
  }
}
