import { AnalyticsFacts } from "../domain/AnalyticsFacts";
import { calendarWeek, addCalendarDays, localDate } from "../lib/calendar";
import { TrainingVolume } from "../domain/TrainingVolume";
import { useMemo } from "react";
import { Check } from "lucide-react";
import type { Workout } from "../lib/model";
import { quantityWord } from "../lib/quantity";
import { VolumeLabel } from "../domain/VolumeLabel";

const weekRange = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", timeZone: "UTC" });

export default function WeeklyActivityBar({
  workouts,
  timeZone,
}: {
  workouts: Workout[];
  timeZone?: string;
}) {
  const weekData = useMemo(() => {
    const now = new Date();
    const today = localDate(now,timeZone);
    const monday = calendarWeek(today).from;
    const eligible = new AnalyticsFacts(workouts,{from:monday,timeZone,now}).workouts();
    const days: {
      dateStr: string;
      dayName: string;
      dayNum: number;
      isToday: boolean;
      workouts: Workout[];
    }[] = [];

    const dayNames = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

    let totalTonnage = 0;
    let totalWorkouts = 0;
    let totalWorkingSets = 0;

    for (let i = 0; i < 7; i++) {
      const dateStr = addCalendarDays(monday,i);
      const isToday = dateStr === today;
      const dayWorkouts = eligible.filter((w)=>w.date===dateStr);
      totalWorkouts += dayWorkouts.length;
      const dayTonnage = TrainingVolume.summarize(dayWorkouts,"working",{timeZone,now}).total;
      totalWorkingSets += new AnalyticsFacts(dayWorkouts,{timeZone,now}).sets().length;
      totalTonnage += dayTonnage;

      days.push({
        dateStr,
        dayName: dayNames[i],
        dayNum: Number(dateStr.slice(-2)),
        isToday,
        workouts: dayWorkouts,
      });
    }

    const omitted = TrainingVolume.summarize(eligible, "working", { timeZone, now }).omittedSets;
    return { days, totalTonnage, totalWorkouts, totalWorkingSets, omitted };
  }, [workouts, timeZone]);

  const tonnageLabel = VolumeLabel.short(weekData.totalTonnage);
  const range = weekRange.formatRange(
    new Date(weekData.days[0].dateStr + "T12:00:00Z"),
    new Date(weekData.days[6].dateStr + "T12:00:00Z"),
  );

  return (
    <section className="weekly-activity-bar" aria-labelledby="week-activity-title">
      <div className="weekly-summary-header">
        <h2 id="week-activity-title">Эта неделя</h2>
        <span className="week-range">{range}</span>
      </div>
      <ol className="week-days-strip" role="list" aria-label="Дни недели">
        {weekData.days.map((day) => {
          const hasWorkout = day.workouts.length > 0;
          return (
            <li
              key={day.dateStr}
              className={`week-day-cell ${day.isToday ? "is-today" : ""} ${hasWorkout ? "has-workout" : ""}`}
              aria-current={day.isToday ? "date" : undefined}
              title={hasWorkout ? day.workouts.map((workout) => workout.name).join(", ") : undefined}
            >
              <span className="day-name">{day.dayName}</span>
              <time className="day-num" dateTime={day.dateStr}>{day.dayNum}</time>
              {hasWorkout ? <><Check size={13} aria-hidden="true" /><span className="sr-only">Есть тренировка</span></> : <span className="week-day-dash" aria-hidden="true" />}
            </li>
          );
        })}
      </ol>
      <div className="weekly-stats-badges">
        <span className="stat-badge">
          <b>{weekData.totalWorkouts}</b>{" "}<span>{quantityWord(weekData.totalWorkouts, "тренировка", "тренировки", "тренировок")}</span>
        </span>
        <span className="stat-badge" title={weekData.totalTonnage > 0 ? undefined : VolumeLabel.reason(weekData.omitted)}>
          <b>{tonnageLabel}</b> <span>тоннаж</span>
        </span>
        <span className="stat-badge">
          <b>{weekData.totalWorkingSets}</b>{" "}<span>{quantityWord(weekData.totalWorkingSets, "подход", "подхода", "подходов")}</span>
        </span>
      </div>
    </section>
  );
}
