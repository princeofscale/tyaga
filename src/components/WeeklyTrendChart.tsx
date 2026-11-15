import { useMemo } from "react";
import { ProgressOverview, type WeekBucket } from "../domain/ProgressOverview";
import { DateText } from "../domain/DateText";
import { addCalendarDays } from "../lib/calendar";
import { quantity } from "../lib/quantity";
import { fmt } from "../lib/model";

/**
 * Неделя за неделей: высота столбца — рабочие подходы, пустые недели видны насечкой.
 * Ось подписана месяцами (год — у первой подписи и у января), поэтому «где были провалы» читается за год и больше.
 */
export default function WeeklyTrendChart({ buckets }: { buckets: WeekBucket[] }) {
  const max = Math.max(1, ...buckets.map((b) => b.sets));
  const empty = buckets.filter((b) => !b.workouts).length;
  const axis = useMemo(() => {
    const all = ProgressOverview.axis(buckets);
    // Подписи месяцев не должны налезать друг на друга: на длинном периоде оставляем каждую вторую (первая — всегда).
    return all.length > 8 ? all.filter((_, i) => i % 2 === 0) : all;
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
      <figcaption>
        <b>{quantity(total, "неделя", "недели", "недель")}</b>
        <span>
          Пустых недель: {empty}. Высота столбца — рабочие подходы за неделю.
        </span>
      </figcaption>
      <div className="weekly-trend-bars" role="img" aria-label={`Рабочие подходы по ${total} неделям, пустых недель ${empty}`}>
        {buckets.map((b) => (
          <i
            key={b.start}
            className={b.workouts ? "" : "empty"}
            style={{ height: b.workouts ? `${Math.max(6, (b.sets / max) * 100)}%` : undefined }}
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
