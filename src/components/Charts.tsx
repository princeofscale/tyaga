import {
  fmt,
  localDate,
  addCalendarDays,
  volumeSummary,
  type Workout,
} from "../lib/model";
import { DateText } from "../domain/DateText";

export function VolumeChart({
  workouts,
  timeZone,
}: {
  workouts: Workout[];
  timeZone?: string;
}) {
  const today = localDate(new Date(), timeZone);
  const days = Array.from({ length: 28 }, (_, i) => {
    const date = addCalendarDays(today, -27 + i);
    return {
      date,
      day: Number(date.slice(8)),
      value: volumeSummary(workouts.filter((w) => w.date === date), "all").total,
    };
  });
  const max = Math.max(...days.map((d) => d.value), 1);
  return (
    <div
      className="volume-chart"
      role="img"
      aria-label={`Объём за 28 дней: ${fmt(days.reduce((s, d) => s + d.value, 0))} кг`}
    >
      <div className="volume-y">
        <span>{fmt(max / 1000)} т</span>
        <span>{fmt(max / 2000)} т</span>
        <span>0</span>
      </div>
      <div className="volume-bars">
        {days.map((d, i) => (
          <div className="bar-column" key={d.date}>
            <div
              className={`bar ${i >= 21 ? "recent" : ""}`}
              style={{
                height: `${Math.max(d.value ? 5 : 2, (d.value / max) * 100)}%`,
              }}
              title={`${DateText.day(d.date)}: ${fmt(d.value)} кг`}
            />
            <span>{i % 7 === 0 || i === 27 ? d.day : ""}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
