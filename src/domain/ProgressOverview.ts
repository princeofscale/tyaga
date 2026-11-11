import { addCalendarDays, localDate } from "../lib/calendar";
import { volumeSummary, workingSets, type Workout } from "../lib/model";
import { PersonalRecordsCalculator } from "./PersonalRecords";
/** Equal calendar windows and like-for-like e1RM comparisons; missing baselines remain unknown. */
export class ProgressOverview {
  static calculate(
    workouts: Workout[],
    days: number,
    timeZone: string,
    now = new Date(),
  ) {
    const end = localDate(now, timeZone),
      start = addCalendarDays(end, 1 - days),
      priorStart = addCalendarDays(start, -days);
    const current = workouts.filter(
      (w) => w.date >= start && w.date <= end && workingSets([w]) > 0,
    );
    const previous = workouts.filter(
      (w) => w.date >= priorStart && w.date < start && workingSets([w]) > 0,
    );
    const weeks = new Set(
      current.map((w) =>
        Math.floor((Date.parse(w.date) - Date.parse(start)) / (7 * 86400000)),
      ),
    );
    const currentPrs = new PersonalRecordsCalculator(
      current,
    ).calculateRecords();
    const priorPrs = new Map(
      new PersonalRecordsCalculator(previous)
        .calculateRecords()
        .map((p) => [p.key, p]),
    );
    const changes = currentPrs.flatMap((p) => {
      const before = priorPrs.get(p.key)?.bestE1rm?.e1rm,
        after = p.bestE1rm?.e1rm;
      return before && after ? [((after - before) / before) * 100] : [];
    });
    const sets = workingSets(current),
      previousSets = workingSets(previous);
    return {
      current,
      previous,
      start,
      end,
      workouts: current.length,
      activeWeeks: weeks.size,
      totalWeeks: days / 7,
      sets,
      volumeKg: volumeSummary(current).total,
      workloadChange: previousSets
        ? Math.round(((sets - previousSets) / previousSets) * 100)
        : null,
      strengthChange: changes.length
        ? Math.round(changes.reduce((s, c) => s + c, 0) / changes.length)
        : null,
      comparedLifts: changes.length,
    };
  }
}
