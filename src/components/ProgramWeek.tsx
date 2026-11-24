import { useId, useMemo, useState, type Ref } from "react";
import { CalendarClock, Check, ChevronLeft, ChevronRight, Ellipsis, Play } from "lucide-react";
import { m, useReducedMotion } from "motion/react";
import { LaidDupPlan } from "../domain/LaidDupPlan";
import { TrainingCalendar, type ScheduledTraining } from "../domain/TrainingCalendar";
import { DAY_NAMES } from "../domain/TrainingProgram";
import { addCalendarDays, calendarWeek, dateLabel } from "../lib/calendar";
import { quantity } from "../lib/quantity";
import type { Routine, Workout } from "../lib/types";
import "../styles/programs.css";

interface ProgramWeekProps {
  routines: readonly Routine[];
  workouts: readonly Workout[];
  today: string;
  notice: string;
  headingRef: Ref<HTMLHeadingElement>;
  onAdjust: (routine: Routine, originalDate: string) => void;
  onEdit: (routine: Routine) => void;
  onStart: (routine: Routine, slot: ScheduledTraining) => void;
  onOpenWorkout?: (workout: Workout) => void;
}

export default function ProgramWeek({
  routines, workouts, today, notice, headingRef, onAdjust, onEdit, onStart, onOpenWorkout,
}: ProgramWeekProps) {
  const headingId = useId();
  const weekId = useId();
  const reduceMotion = useReducedMotion();
  const [{ offset, direction }, setWeek] = useState({ offset: 0, direction: 0 });
  const anchor = addCalendarDays(calendarWeek(today).from, offset * 7);
  const end = addCalendarDays(anchor, 6);
  const sameMonth = anchor.slice(0, 7) === end.slice(0, 7);
  const press = reduceMotion ? undefined : { scale: 0.97, transition: { duration: 0.1 } };

  function shift(by: -1 | 1) {
    setWeek((week) => ({ offset: week.offset + by, direction: by }));
  }

  function showToday() {
    setWeek((week) => week.offset === 0 ? week : { offset: 0, direction: -Math.sign(week.offset) });
  }

  function jumpToDate(targetDate: string) {
    const baseMonday = calendarWeek(today).from;
    const targetMonday = calendarWeek(targetDate).from;
    const diffDays = Math.round(
      (new Date(targetMonday + "T12:00:00Z").getTime() - new Date(baseMonday + "T12:00:00Z").getTime()) / 86_400_000,
    );
    const nextOffset = Math.round(diffDays / 7);
    setWeek((week) => week.offset === nextOffset ? week : { offset: nextOffset, direction: Math.sign(nextOffset - week.offset) });
  }

  const upcomingStart = useMemo(() => {
    const starts = LaidDupPlan.cycles(routines as Routine[])
      .map((cycle) => cycle[0].periodization!.startMonday)
      .filter((start) => start > end)
      .sort();
    return starts[0] ?? null;
  }, [routines, end]);

  return (
    <section className="program-planner" aria-labelledby={headingId}>
      <header className="program-week-head">
        <div>
          <h2 id={headingId} ref={headingRef} tabIndex={-1}>План на неделю</h2>
          <p className="program-week-range" aria-live="polite" aria-atomic="true">
            <time dateTime={anchor}>{sameMonth ? Number(anchor.slice(-2)) : dateLabel(anchor, true)}</time>
            {sameMonth ? "–" : " — "}<time dateTime={end}>{dateLabel(end, true)}</time>
          </p>
        </div>
        <div className="program-week-controls" role="group" aria-label="Неделя плана">
          <m.button type="button" aria-controls={weekId} aria-label="Предыдущая неделя плана" whileTap={press} onClick={() => shift(-1)}>
            <ChevronLeft size={18} aria-hidden="true" />
          </m.button>
          <m.button type="button" aria-controls={weekId} aria-current={offset === 0 ? "true" : undefined} whileTap={press} onClick={showToday}>
            Сегодня
          </m.button>
          <m.button type="button" aria-controls={weekId} aria-label="Следующая неделя плана" whileTap={press} onClick={() => shift(1)}>
            <ChevronRight size={18} aria-hidden="true" />
          </m.button>
        </div>
      </header>
      <div className="program-week-frame" id={weekId}>
        <m.ol
          className="program-week"
          key={anchor}
          role="list"
          initial={reduceMotion || !direction ? false : { x: direction * 14, opacity: 0.4 }}
          animate={{ x: 0, opacity: 1 }}
          transition={{ duration: reduceMotion ? 0 : 0.19, ease: [0.22, 0.7, 0.3, 1] }}
        >
          {DAY_NAMES.map((day, index) => {
            const date = addCalendarDays(anchor, index);
            const isToday = today === date;
            const slots = TrainingCalendar.onDate(routines, date)
              .map((slot) => ({ slot, done: TrainingCalendar.completed(slot, workouts) }))
              .sort((a, b) => Number(!!a.done) - Number(!!b.done));
            const adjustments = routines.flatMap((routine) => {
              if (!TrainingCalendar.activeOn(routine, date)) return [];
              const override = routine.occurrenceOverrides?.find((item) => item.from === date);
              return override ? [{ routine, override }] : [];
            });
            const recorded = workouts.filter((workout) => workout.date === date && !slots.some(({ done }) => done?.id === workout.id));
            const isRest = !slots.length && !adjustments.length && !recorded.length;

            return (
              <li className={`program-day${isToday ? " today" : ""}${isRest ? " is-rest" : ""}`} data-date={date} key={date}>
                <time className="program-day-label" dateTime={date} aria-current={isToday ? "date" : undefined}>
                  <span>{day}</span>
                  <b>{Number(date.slice(-2))}</b>
                </time>
                <div className="program-day-sessions">
                  {slots.map(({ slot, done }) => {
                    const { routine, originalDate } = slot;
                    const moved = date !== originalDate;
                    const startsToday = isToday && !done;
                    return (
                      <div className={`calendar-slot${done ? "" : " adjustable"}`} key={`${routine.id}:${originalDate}`}>
                        <button
                          type="button"
                          className={`day-session${done ? " completed" : ""}${startsToday ? " is-start" : ""}`}
                          disabled={!!done && !onOpenWorkout}
                          onClick={() => {
                            if (done) onOpenWorkout?.(done);
                            else if (isToday) onStart(routine, slot);
                            else onEdit(routine);
                          }}
                        >
                          <b>{startsToday ? <Play size={11} fill="currentColor" aria-hidden="true" /> : null}{routine.name}</b>
                          <small>
                            {done ? <Check size={13} aria-hidden="true" /> : null}
                            <span>{done ? "Записано" : moved ? `С ${dateLabel(originalDate)}`
                              : quantity(routine.exercises.length, "упражнение", "упражнения", "упражнений")}</span>
                          </small>
                        </button>
                        {!done ? (
                          <button
                            type="button"
                            className="calendar-adjust"
                            aria-label={`Изменить план: ${routine.name}, ${dateLabel(originalDate, true)}`}
                            onClick={() => onAdjust(routine, originalDate)}
                          >
                            <Ellipsis size={18} aria-hidden="true" />
                          </button>
                        ) : null}
                      </div>
                    );
                  })}
                  {adjustments.map(({ routine, override }) => {
                    const done = TrainingCalendar.completed({ routine, date: override.to ?? date, originalDate: date }, workouts);
                    return (
                      <button
                        type="button"
                        className={`day-session calendar-adjusted${done ? " completed" : ""}`}
                        key={`${routine.id}:adjustment`}
                        disabled={!!done && !onOpenWorkout}
                        onClick={() => done ? onOpenWorkout?.(done) : onAdjust(routine, date)}
                      >
                        <b>{routine.name}</b>
                        <small>
                          {done ? <Check size={13} aria-hidden="true" /> : <CalendarClock size={13} aria-hidden="true" />}
                          <span>{override.to ? `Перенесено на ${dateLabel(override.to)}` : "Пропущено"}</span>
                        </small>
                      </button>
                    );
                  })}
                  {isRest && <span className="rest-day">Свободный день</span>}
                  {recorded.map((workout) => (
                    <div className="day-recorded" key={workout.id}>
                      <Check size={13} aria-hidden="true" />
                      <span>{workout.name}</span>
                    </div>
                  ))}
                </div>
              </li>
            );
          })}
        </m.ol>
      </div>
      {upcomingStart ? (
        <div className="program-week-upcoming" role="note">
          <span>
            Дэвид Лейд · DUP начнётся <b>{dateLabel(upcomingStart)}</b>
          </span>
          <button type="button" className="program-week-jump" onClick={() => jumpToDate(upcomingStart)}>
            К неделе старта
          </button>
        </div>
      ) : null}
      <p className="calendar-notice" role="status">{notice}</p>
    </section>
  );
}
