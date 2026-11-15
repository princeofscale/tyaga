import { AnalyticsFacts } from "./AnalyticsFacts";
import { addCalendarDays, localDate, weekStart } from "../lib/calendar";
import { DateText } from "./DateText";
import { volumeSummary, workingSets, type Workout } from "../lib/model";
import { PersonalRecordsCalculator } from "./PersonalRecords";
export type OverviewPeriod = "4w" | "8w" | "12w" | "6m" | "year" | "all";
export const OVERVIEW_PERIODS: { id: OverviewPeriod; label: string }[] = [
  { id: "4w", label: "4 нед." },
  { id: "8w", label: "8 нед." },
  { id: "12w", label: "12 нед." },
  { id: "6m", label: "6 месяцев" },
  { id: "year", label: "Год" },
  { id: "all", label: "Всё" },
];
export type WeekBucket = { start: string; workouts: number; sets: number; volumeKg: number };
const daysBetween = (from: string, to: string) => Math.round((Date.parse(to + "T12:00:00Z") - Date.parse(from + "T12:00:00Z")) / 86400000);
const sameDayBefore = (date: string, years: number, months: number) => {
  const d = new Date(date + "T12:00:00Z");
  d.setUTCFullYear(d.getUTCFullYear() - years);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - months);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d.toISOString().slice(0, 10);
};
/** Equal calendar windows and like-for-like e1RM comparisons; missing baselines remain unknown. */
export class ProgressOverview {
  /**
   * Сколько дней в периоде, включая сегодняшний. «6 месяцев» и «Год» — от той же даты в прошлом (включительно),
   * чтобы тренировка ровно годичной давности не выпадала; «Всё» — от первой тренировки (не меньше 4 недель).
   */
  static days(period: OverviewPeriod, workouts: Workout[], timeZone: string, now = new Date()) {
    const end = localDate(now, timeZone);
    if (period === "4w") return 28;
    if (period === "8w") return 56;
    if (period === "12w") return 84;
    if (period === "6m") return daysBetween(sameDayBefore(end, 0, 6), end) + 1;
    if (period === "year") return daysBetween(sameDayBefore(end, 1, 0), end) + 1;
    const first = workouts.reduce((min, w) => (w.date < min ? w.date : min), end);
    return Math.max(28, daysBetween(first, end) + 1);
  }

  /** Недели (с понедельника), в которые попадает период: для графика «по неделям» с подписями месяцев. */
  static weekly(current: Workout[], start: string, end: string, timeZone: string, now = new Date()): WeekBucket[] {
    const first = weekStart(new Date(start + "T12:00:00Z"), "UTC");
    const buckets = new Map<string, WeekBucket>();
    for (let at = first; at <= end; at = addCalendarDays(at, 7)) buckets.set(at, { start: at, workouts: 0, sets: 0, volumeKg: 0 });
    for (const w of current) {
      const bucket = buckets.get(weekStart(new Date(w.date + "T12:00:00Z"), "UTC"));
      if (!bucket) continue;
      bucket.workouts += 1;
      bucket.sets += new AnalyticsFacts([w], { now, timeZone }).sets().length;
      bucket.volumeKg += volumeSummary([w], "working", { now, timeZone }).total;
    }
    return [...buckets.values()];
  }

  /** Подписи оси: месяц на первой неделе, в которой он начался; год — у января и у первой подписи. */
  static axis(buckets: WeekBucket[]) {
    const labels: { index: number; text: string }[] = [];
    let previous = "";
    buckets.forEach((bucket, index) => {
      // Неделя относится к тому месяцу, на который падает её четверг (как в ISO-неделях).
      const key = DateText.monthKey(addCalendarDays(bucket.start, 3));
      if (key === previous) return;
      previous = key;
      const text = DateText.monthShort(`${key}-01`).replace(/\.$/, "");
      labels.push({ index, text: !labels.length || key.endsWith("-01") ? `${text} ${key.slice(0, 4)}` : text });
    });
    return labels;
  }

  static calculate(
    workouts: Workout[],
    days: number,
    timeZone: string,
    now = new Date(),
  ) {
    const end = localDate(now, timeZone),
      start = addCalendarDays(end, 1 - days),
      priorStart = addCalendarDays(start, -days);
    const options = { now, timeZone };
    const current = new AnalyticsFacts(workouts, { ...options, from: start, through: end }).workouts();
    const previous = new AnalyticsFacts(workouts, { ...options, from: priorStart, through: addCalendarDays(start,-1) }).workouts();
    // Недели — календарные (пн–вс), как столбцы графика: «активных» и «всего» считаются одним способом.
    const weekOf = (date: string) => weekStart(new Date(date + "T12:00:00Z"), "UTC");
    const weeks = new Set(current.map((w) => weekOf(w.date)));
    const calendarWeeks = Math.round(daysBetween(weekOf(start), weekOf(end)) / 7) + 1;
    const currentPrs = new PersonalRecordsCalculator(
      current, now,
    ).calculateRecords(timeZone);
    const priorPrs = new Map(
      new PersonalRecordsCalculator(previous, now)
        .calculateRecords(timeZone)
        .map((p) => [p.key, p]),
    );
    const changes = currentPrs.flatMap((p) => {
      const before = priorPrs.get(p.key)?.bestE1rm?.e1rm,
        after = p.bestE1rm?.e1rm;
      return before && after ? [((after - before) / before) * 100] : [];
    });
    const sets = new AnalyticsFacts(current, options).sets().length,
      previousSets = new AnalyticsFacts(previous, options).sets().length;
    const growth = currentPrs.flatMap((p) => {
      const before = priorPrs.get(p.key)?.bestE1rm?.e1rm,
        after = p.bestE1rm?.e1rm;
      return before && after ? [{ name: p.name, percent: Math.round(((after - before) / before) * 100) }] : [];
    });
    return {
      bestGrowth: growth.length ? growth.reduce((a, b) => (b.percent > a.percent ? b : a)) : null,
      current,
      previous,
      start,
      end,
      workouts: current.length,
      activeWeeks: weeks.size,
      totalWeeks: calendarWeeks,
      days,
      sets,
      volumeKg: volumeSummary(current,"working",options).total,
      volumeOmitted: volumeSummary(current,"working",options).omittedSets,      workloadChange: previousSets
        ? Math.round(((sets - previousSets) / previousSets) * 100)
        : null,
      strengthChange: changes.length
        ? Math.round(changes.reduce((s, c) => s + c, 0) / changes.length)
        : null,
      comparedLifts: changes.length,
    };
  }
}
