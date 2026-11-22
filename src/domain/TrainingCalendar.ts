import { addCalendarDays, isCalendarDate } from "../lib/calendar";
import type { Routine, Workout } from "../lib/types";
import { LaidDupPlan } from "./LaidDupPlan";

export type ScheduledTraining = { routine: Routine; date: string; originalDate: string };
export const MAX_OCCURRENCE_OVERRIDES = 128;

export function calendarWeekday(date: string) {
  return (new Date(date + "T12:00:00Z").getUTCDay() + 6) % 7;
}

/** Date-only instances of a weekly template. Moves always keep the original occurrence key. */
export class TrainingCalendar {
  /** Periodized cycles (e.g. David Laid DUP) do not schedule recurring occurrences before `startMonday`. */
  static activeOn(routine: Routine, date: string): boolean {
    const start = LaidDupPlan.periodizationOf(routine)?.startMonday;
    return !start || date >= start;
  }

  static onDate(routines: readonly Routine[], date: string): ScheduledTraining[] {
    if (!isCalendarDate(date)) return [];
    const weekday = calendarWeekday(date);
    return routines.flatMap((routine) => {
      const overrides = routine.occurrenceOverrides ?? [];
      const originals = overrides
        .filter((o) => o.to === date && this.activeOn(routine, o.from))
        .map((o) => o.from);
      if (this.activeOn(routine, date) && routine.days.includes(weekday) && !overrides.some((o) => o.from === date))
        originals.push(date);
      return originals.sort().map((originalDate) => ({ routine, date, originalDate }));
    });
  }

  static completed(slot: ScheduledTraining, workouts: readonly Workout[]): Workout | undefined {
    return workouts.find((w) => w.routineId === slot.routine.id && w.programDate === slot.originalDate)
      ?? (slot.originalDate === slot.date
        ? workouts.find((w) => w.routineId === slot.routine.id && w.programDate === undefined && w.date === slot.date)
        : undefined);
  }

  /** The next incomplete occurrence strictly after date, in the same tie order as onDate. */
  static next(routines: readonly Routine[], date: string, workouts: readonly Workout[] = []): ScheduledTraining | undefined {
    if (!isCalendarDate(date)) return undefined;
    const after = addCalendarDays(date, 1);
    let next: ScheduledTraining | undefined;
    const consider = (slot: ScheduledTraining) => {
      if (next && (slot.date > next.date || (slot.date === next.date &&
        (slot.routine !== next.routine || slot.originalDate >= next.originalDate)))) return;
      if (!this.completed(slot, workouts)) next = slot;
    };
    for (const routine of routines) {
      const start = LaidDupPlan.periodizationOf(routine)?.startMonday;
      const overrides = routine.occurrenceOverrides ?? [];
      const changed = new Set(overrides.map((o) => o.from));
      for (const { from, to } of overrides)
        if (to && to > date && (!start || from >= start)) consider({ routine, date: to, originalDate: from });
      // Walk each recurring weekday directly rather than scanning every day between moves.
      const earliest = start && start > after ? start : after;
      const earliestWeekday = calendarWeekday(earliest);
      for (const day of routine.days) {
        let candidate = addCalendarDays(earliest, (day - earliestWeekday + 7) % 7);
        while (isCalendarDate(candidate) && (!next || candidate <= next.date)) {
          if (!changed.has(candidate)) consider({ routine, date: candidate, originalDate: candidate });
          if (next?.date === candidate) break;
          candidate = addCalendarDays(candidate, 7);
        }
      }
    }
    return next;
  }

  /** Update one occurrence: null skips it, undefined (or its original day) restores it. */
  static withOverride(
    routine: Routine,
    originalDate: string,
    destination: string | null | undefined,
    workouts: readonly Workout[],
  ): Routine {
    if (!isCalendarDate(originalDate) || (typeof destination === "string" && !isCalendarDate(destination)))
      throw new Error("Проверь дату тренировки");
    const overrides = routine.occurrenceOverrides ?? [];
    const current = overrides.find((o) => o.from === originalDate);
    if (!current && (!this.activeOn(routine, originalDate) || !routine.days.includes(calendarWeekday(originalDate))))
      throw new Error("Этой тренировки больше нет в плане");
    if (this.completed({ routine, originalDate, date: current?.to ?? originalDate }, workouts))
      throw new Error("Выполненную тренировку нельзя перенести или пропустить");
    const rest = overrides.filter((o) => o.from !== originalDate);
    if (destination !== undefined && destination !== originalDate)
      rest.push({ from: originalDate, to: destination });
    if (rest.length > MAX_OCCURRENCE_OVERRIDES)
      throw new Error("Слишком много разовых правок. Сначала верни одну из тренировок в план.");
    rest.sort((a, b) => a.from.localeCompare(b.from));
    return { ...routine, occurrenceOverrides: rest.length ? rest : undefined };
  }
}
