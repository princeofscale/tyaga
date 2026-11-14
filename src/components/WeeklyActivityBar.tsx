import { AnalyticsFacts } from "../domain/AnalyticsFacts";
import { calendarWeek, addCalendarDays, localDate } from "../lib/calendar";
import { TrainingVolume } from "../domain/TrainingVolume";
import { useMemo } from "react";
import { Check, Flame, Trophy, Calendar } from "lucide-react";
import { type Workout, fmt } from "../lib/model";
import { quantityWord } from "../lib/quantity";
import { VolumeLabel } from "../domain/VolumeLabel";

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
      tonnage: number;
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
        tonnage: dayTonnage,
      });
    }

    const omitted = TrainingVolume.summarize(eligible, "working", { timeZone, now }).omittedSets;
    return { days, totalTonnage, totalWorkouts, totalWorkingSets, omitted };
  }, [workouts, timeZone]);

  const tonnageLabel = VolumeLabel.short(weekData.totalTonnage);

  return (
    <div className="weekly-activity-bar">
      <div className="weekly-summary-header">
        <div className="weekly-title-wrap">
          <Calendar size={14} className="text-accent" />
          <span className="weekly-title">Активность за неделю</span>
        </div>
        <div className="weekly-stats-badges">
          <span className="stat-badge">
            <Flame size={12} className="text-accent" />
            <b>{weekData.totalWorkouts}</b> {quantityWord(weekData.totalWorkouts, "тренировка", "тренировки", "тренировок")}
          </span>
          <span
            className="stat-badge"
            title={weekData.totalTonnage > 0 ? undefined : VolumeLabel.reason(weekData.omitted)}
          >
            <b>{tonnageLabel}</b>
          </span>
          <span className="stat-badge">
            <b>{weekData.totalWorkingSets}</b> {quantityWord(weekData.totalWorkingSets, "подход", "подхода", "подходов")}
          </span>
        </div>
      </div>

      <div className="week-days-strip">
        {weekData.days.map((day) => {
          const hasWorkout = day.workouts.length > 0;
          return (
            <div
              key={day.dateStr}
              className={`week-day-cell ${day.isToday ? "is-today" : ""} ${hasWorkout ? "has-workout" : ""}`}
              title={
                hasWorkout
                  ? `${day.dayName}: ${day.workouts.map((w) => w.name).join(", ")} (${fmt(day.tonnage)} кг)`
                  : `${day.dayName}, ${day.dayNum}`
              }
            >
              <span className="day-name">{day.dayName}</span>
              <div className="day-circle">
                {hasWorkout ? (
                  <Check size={14} className="check-icon" />
                ) : (
                  <span className="day-num">{day.dayNum}</span>
                )}
              </div>
              {hasWorkout && (
                <span className="day-tonnage-mini">
                  {VolumeLabel.short(day.tonnage)}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
