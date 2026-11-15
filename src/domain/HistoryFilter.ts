import type { Workout } from "../lib/types";
import { DeloadEngine } from "./DeloadEngine";
import { normalizeSearch } from "../lib/search";
import { DateText } from "./DateText";

export type HistoryQuery = {
  /** Свободный текст: название, упражнение, а также «окт», «октябрь 2026», «2026-10», «2026». */
  text: string;
  /** «all» либо месяц «ГГГГ-ММ». */
  month: string;
  /** «all» либо точное название тренировки. */
  type: string;
  /** Свой диапазон дат (включительно), пустая строка — без границы. */
  from: string;
  to: string;
};
export type HistoryGroup = { key: string; label: string; items: Workout[] };

const MONTH_STEMS = [
  ["январь", "января"],
  ["февраль", "февраля"],
  ["март", "марта"],
  ["апрель", "апреля"],
  ["май", "мая"],
  ["июнь", "июня"],
  ["июль", "июля"],
  ["август", "августа"],
  ["сентябрь", "сентября"],
  ["октябрь", "октября"],
  ["ноябрь", "ноября"],
  ["декабрь", "декабря"],
];

/**
 * Отбор и группировка длинной «Истории». Поиск понимает месяц и год словами и цифрами:
 * «окт», «октябрь 2026», «2026-10», «10.2026» — каждое слово запроса должно подойти либо по тексту, либо по дате.
 */
export class HistoryFilter {
  static readonly EMPTY: HistoryQuery = { text: "", month: "all", type: "all", from: "", to: "" };

  /** Номер месяца (1–12) для слова вроде «окт», «октября», иначе 0. Короткое слово — только от трёх букв. */
  static monthOf(token: string) {
    const word = normalizeSearch(token);
    if (word.length < 3) return 0;
    const at = MONTH_STEMS.findIndex((names) => names.some((name) => normalizeSearch(name).startsWith(word)));
    return at + 1;
  }

  private static dateMatch(date: string, token: string) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(token)) return date === token;
    if (/^\d{4}-\d{2}$/.test(token)) return date.startsWith(token);
    const full = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(token);
    if (full) return date === `${full[3]}-${full[2].padStart(2, "0")}-${full[1].padStart(2, "0")}`;
    const dayMonth = /^(\d{1,2})\.(\d{1,2})$/.exec(token);
    if (dayMonth) return date.slice(5) === `${dayMonth[2].padStart(2, "0")}-${dayMonth[1].padStart(2, "0")}`;
    const dotted = /^(\d{1,2})\.(\d{4})$/.exec(token);
    if (dotted) return date.startsWith(`${dotted[2]}-${dotted[1].padStart(2, "0")}`);
    if (/^\d{4}$/.test(token)) return date.startsWith(token);
    // «20 янв»: число — день месяца (если не подошло по тексту), слово — месяц.
    if (/^\d{1,2}$/.test(token)) return +token === +date.slice(8, 10);
    const month = this.monthOf(token);
    return month > 0 && +date.slice(5, 7) === month;
  }

  static matches(workout: Workout, query: HistoryQuery, entryName: (e: Workout["exercises"][number]) => string) {
    if (query.month !== "all" && DateText.monthKey(workout.date) !== query.month) return false;
    if (query.type !== "all" && DeloadEngine.baseName(workout.name) !== query.type) return false;
    if (query.from && workout.date < query.from) return false;
    if (query.to && workout.date > query.to) return false;
    const tokens = query.text.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!tokens.length) return true;
    const haystack = `${workout.name} ${workout.exercises.map(entryName).join(" ")}`.toLowerCase();
    return tokens.every((token) => haystack.includes(token) || this.dateMatch(workout.date, token));
  }

  static filter(workouts: Workout[], query: HistoryQuery, entryName: (e: Workout["exercises"][number]) => string) {
    const active = query.text.trim() || query.month !== "all" || query.type !== "all" || query.from || query.to;
    return active ? workouts.filter((w) => this.matches(w, query, entryName)) : workouts;
  }

  static isActive(query: HistoryQuery) {
    return !!(query.text.trim() || query.month !== "all" || query.type !== "all" || query.from || query.to);
  }

  /** Месяцы с тренировками, новые первыми: для выбора периода и перехода к месяцу. */
  static months(workouts: Workout[]) {
    const counts = new Map<string, number>();
    for (const w of workouts) counts.set(DateText.monthKey(w.date), (counts.get(DateText.monthKey(w.date)) ?? 0) + 1);
    return [...counts.entries()]
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([key, count]) => ({ key, label: DateText.month(key), count }));
  }

  /** Названия тренировок по частоте («Ноги», «Тяга»…). */
  static types(workouts: Workout[]) {
    const counts = new Map<string, number>();
    // «Ноги А» и «Ноги А [Разгрузка]» — один тип: разгрузка видна в названии карточки, но не дробит отбор.
    for (const w of workouts) {
      const type = DeloadEngine.baseName(w.name);
      counts.set(type, (counts.get(type) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ru")).map(([name, count]) => ({ name, count }));
  }

  /** Тренировки, уже отсортированные по убыванию даты, разложены по месяцам без перестановки. */
  static groups(workouts: Workout[]): HistoryGroup[] {
    const groups: HistoryGroup[] = [];
    for (const w of workouts) {
      const key = DateText.monthKey(w.date);
      const last = groups.at(-1);
      if (last?.key === key) last.items.push(w);
      else groups.push({ key, label: DateText.month(key), items: [w] });
    }
    return groups;
  }
}
