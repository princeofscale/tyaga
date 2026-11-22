import { useMemo, useState } from "react";
import { ProgressOverview, type WeekBucket } from "../domain/ProgressOverview";
import { DateText } from "../domain/DateText";
import { addCalendarDays } from "../lib/calendar";
import { quantity } from "../lib/quantity";
import { fmt } from "../lib/model";

/**
 * Неделя за неделей: столбцы рабочих подходов с интерактивным выбором недели.
 */
export default function WeeklyTrendChart({ buckets }: { buckets: WeekBucket[] }) {
  const [selectedStart, setSelectedStart] = useState<string | null>(null);
  const max = Math.max(1, ...buckets.map((b) => b.sets));
  const empty = buckets.filter((b) => !b.workouts).length;
  const active = useMemo(
    () => (selectedStart ? buckets.find((b) => b.start === selectedStart) ?? null : null),
    [buckets, selectedStart],
  );
  const axis = useMemo(() => {
    const all = ProgressOverview.axis(buckets);
    const step = Math.max(1, Math.ceil(all.length / 8));
    return all.filter((_, i) => i % step === 0);
  }, [buckets]);
  const years = useMemo(() => {
    const out: { index: number; text: string }[] = [];
    buckets.forEach((bucket, index) => {
      const key = DateText.monthKey(addCalendarDays(bucket.start, 3));
      const year = key.slice(0, 4);
      if (!out.length || (key.endsWith("-01") && out.at(-1)!.text !== year)) out.push({ index, text: year });
    });
    return out;
  }, [buckets]);
  const total = buckets.length;
  return (
    <figure className="weekly-trend" aria-label="Подходы по неделям">
      <figcaption className="weekly-trend-head">
        <div>
          <b>{quantity(total, "неделя", "недели", "недель")}</b>
          <span> · пустых {empty}</span>
        </div>
        {active ? (
          <span className="weekly-trend-readout" aria-live="polite">
            {DateText.day(active.start)} — {DateText.day(addCalendarDays(active.start, 6))}:{" "}
            {active.workouts ? `${active.sets} подх. · ${fmt(active.volumeKg)} кг` : "отдых"}
          </span>
        ) : null}
      </figcaption>
      <div
        className="weekly-trend-bars"
        style={total > 100 ? ({ "--trend-gap": "0px" } as React.CSSProperties) : undefined}
        role="img"
        aria-label={`Рабочие подходы по ${total} неделям, пустых недель ${empty}`}
      >
        {buckets.map((b) => (
          <i
            key={b.start}
            className={`${b.workouts ? "" : "empty"}${selectedStart === b.start ? " is-selected" : ""}`.trim()}
            style={{ height: b.workouts ? `${Math.max(6, (b.sets / max) * 100)}%` : undefined }}
            onMouseEnter={() => setSelectedStart(b.start)}
            onClick={() => setSelectedStart((prev) => (prev === b.start ? null : b.start))}
            title={`${DateText.day(b.start)} — ${DateText.day(addCalendarDays(b.start, 6))}: ${
              b.workouts ? `${quantity(b.workouts, "тренировка", "тренировки", "тренировок")}, ${b.sets} подх., ${fmt(b.volumeKg)} кг` : "без тренировок"
            }`}
          />
        ))}
      </div>
      <div className="weekly-trend-axis" aria-hidden="true">
        {axis.map((l) => (
          <span key={`${l.index}-${l.text}`} style={{ left: `${(l.index / total) * 100}%` }}>
            {l.text.slice(0, 3)}
          </span>
        ))}
      </div>
      <div className="weekly-trend-years" aria-hidden="true">
        {years.map((y) => (
          <span key={y.text} style={{ left: `${(y.index / total) * 100}%` }}>
            {y.text}
          </span>
        ))}
      </div>
    </figure>
  );
}
