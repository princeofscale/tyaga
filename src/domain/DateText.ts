/**
 * Один формат даты на весь журнал: «6 нояб. 2026». Даты хранятся как ГГГГ-ММ-ДД, но человеку их не показываем.
 * Всё считается по календарной строке, без часовых поясов: «6 нояб.» не должно сдвигаться на соседний день.
 */
const SHORT = ["янв.", "февр.", "мар.", "апр.", "мая", "июн.", "июл.", "авг.", "сент.", "окт.", "нояб.", "дек."];
const NOMINATIVE = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];

export class DateText {
  static readonly NOMINATIVE = NOMINATIVE;

  private static parts(date: string) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date);
    if (!m) return null;
    return { year: +m[1], month: +m[2], day: +m[3] };
  }

  /** «6 нояб. 2026» — для списков выбора, предпросмотра импорта и подписей графиков. */
  static day(date: string) {
    const p = this.parts(date);
    return p ? `${p.day} ${SHORT[p.month - 1]} ${p.year}` : date;
  }

  /** «6 нояб.» для текущего года и «6 нояб. 2025» для остальных. */
  static dayInYear(date: string, currentYear: string) {
    const p = this.parts(date);
    if (!p) return date;
    return String(p.year) === currentYear ? `${p.day} ${SHORT[p.month - 1]}` : `${p.day} ${SHORT[p.month - 1]} ${p.year}`;
  }

  /** «нояб.» — короткое название месяца. */
  static monthShort(date: string) {
    const p = this.parts(date);
    return p ? SHORT[p.month - 1] : "";
  }

  /** «2026-10» из любой календарной даты. */
  static monthKey(date: string) {
    return date.slice(0, 7);
  }

  /** «Октябрь 2026» из «2026-10» или полной даты. */
  static month(key: string) {
    const p = /^(\d{4})-(\d{2})/.exec(key);
    return p ? `${NOMINATIVE[+p[2] - 1]} ${p[1]}` : key;
  }

  /** «6 нояб. 2026 в 13:20» — момент операции (ISO со временем); с `currentYear` год текущего года опускается: «6 нояб. в 13:20». */
  static moment(iso: string, timeZone?: string, currentYear?: string) {
    const when = new Date(iso);
    if (!Number.isFinite(when.getTime())) return iso;
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(when);
    const field = (type: string) => parts.find((p) => p.type === type)!.value;
    const date = `${field("year")}-${field("month")}-${field("day")}`;
    return `${currentYear ? this.dayInYear(date, currentYear) : this.day(date)} в ${field("hour")}:${field("minute")}`;
  }
}
