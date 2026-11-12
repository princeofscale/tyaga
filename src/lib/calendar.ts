export function validTimeZone(zone: string) {
  try {
    new Intl.DateTimeFormat("en", { timeZone: zone }).format();
    return zone.length <= 80;
  } catch {
    return false;
  }
}
export const browserTimeZone = () =>
  Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
export function localDate(date = new Date(), timeZone?: string) {
  if (!timeZone)
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  const p = new Intl.DateTimeFormat("en", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const field = (type: string) => p.find((v) => v.type === type)!.value;
  return `${field("year")}-${field("month")}-${field("day")}`;
}
export function addCalendarDays(date: string, days: number) {
  const d = new Date(date + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
export function weekStart(date = new Date(), timeZone?: string) {
  const day = localDate(date, timeZone);
  const weekday = new Date(day + "T12:00:00Z").getUTCDay();
  return addCalendarDays(day, -((weekday + 6) % 7));
}
export function dateLabel(date: string, long = false) {
  return new Date(date + "T12:00:00").toLocaleDateString("ru-RU", {
    day: "numeric",
    month: long ? "long" : "short",
  });
}

export function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + "T12:00:00Z");
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export function calendarWeek(date: string) {
  if (!isCalendarDate(date)) throw new RangeError("Некорректная календарная дата");
  const start = addCalendarDays(date, -((new Date(date + "T12:00:00Z").getUTCDay() + 6) % 7));
  return { from: start, through: addCalendarDays(start, 6) };
}
export function trailingWindow(today: string, days: number) {
  if (!isCalendarDate(today) || !Number.isInteger(days) || days < 1 || days > 36600)
    throw new RangeError("Некорректное календарное окно");
  return { from: addCalendarDays(today, 1 - days), through: today };
}
