import { localDate } from "../lib/calendar";
import { DateText } from "./DateText";

/**
 * Запись тренировки задним числом (R07-REQ04). «Сегодня» считается по часовому поясу профиля,
 * а не браузера; даты — календарные строки ГГГГ-ММ-ДД. Модель сохранения не затрагивается.
 */
export class BackdatedWorkout {
  /** Дата тренировки раньше сегодняшней в поясе профиля. */
  static isBackdated(date: string, timeZone: string | undefined, now = new Date()) {
    return /^\d{4}-\d{2}-\d{2}$/.test(date) && date < localDate(now, timeZone);
  }

  /** Подпись в шапке: null — шапку не трогаем (обычная сегодняшняя тренировка). */
  static label(date: string, timeZone: string | undefined, retro = false, now = new Date()): string | null {
    const today = localDate(now, timeZone);
    const day = DateText.dayInYear(date, today.slice(0, 4));
    if (this.isBackdated(date, timeZone, now)) return `${day} · задним числом`;
    return retro ? `${day} · выбрать дату` : null;
  }

  /** Для не сегодняшней даты счётчик «от сейчас» не идёт: берётся указанная длительность. */
  static manualDuration(manual: boolean, date: string, timeZone: string | undefined, now = new Date()) {
    return manual || this.isBackdated(date, timeZone, now);
  }
}
