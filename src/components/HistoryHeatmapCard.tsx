import { useMemo } from "react";
import { Flame, TrendingDown, TrendingUp } from "lucide-react";
import { HistoryHeatmap } from "../domain/HistoryHeatmap";
import { fmt, type Workout } from "../lib/model";
import { quantityWord } from "../lib/quantity";

const DAY_LABELS = ["Пн", "", "Ср", "", "Пт", "", "Вс"] as const;

export default function HistoryHeatmapCard({
  workouts,
  today,
  timeZone,
}: {
  workouts: Workout[];
  today: string;
  timeZone?: string;
}) {
  const data = useMemo(
    () => new HistoryHeatmap(workouts, today, { timeZone, weeksCount: 16 }).build(),
    [workouts, today, timeZone],
  );

  const { comparison } = data;
  const setsDeltaLabel =
    comparison.setsDelta > 0
      ? `+${comparison.setsDelta}`
      : comparison.setsDelta < 0
        ? String(comparison.setsDelta)
        : "0";

  return (
    <section className="history-heatmap-card panel" aria-label="Теплокарта активности за 16 недель">
      <div className="heatmap-head">
        <div>
          <span className="heatmap-eyebrow">
            <Flame size={13} aria-hidden="true" />
            Активность · 16 недель
          </span>
          <h3>
            {data.totalWorkouts} {quantityWord(data.totalWorkouts, "тренировка", "тренировки", "тренировок")} · {data.totalSets} раб. подх.
          </h3>
        </div>
        <div className="heatmap-legend" aria-hidden="true">
          <span>Меньше</span>
          {[0, 1, 2, 3, 4].map((lvl) => (
            <i key={lvl} className={`hm-cell lvl-${lvl}`} />
          ))}
          <span>Больше</span>
        </div>
      </div>

      <div className="heatmap-scroll">
        <div className="heatmap-weekdays" aria-hidden="true">
          {DAY_LABELS.map((lbl, idx) => (
            <span key={idx}>{lbl}</span>
          ))}
        </div>
        <div className="heatmap-grid" role="grid" aria-label="Сетка тренировок по дням">
          {data.weeks.map((week, wi) => (
            <div key={wi} className="heatmap-col" role="row">
              {week.map((cell) => (
                <span
                  key={cell.date}
                  role="gridcell"
                  className={`hm-cell lvl-${cell.level}${cell.isToday ? " is-today" : ""}${cell.isFuture ? " is-future" : ""}`}
                  title={
                    cell.isFuture
                      ? cell.date
                      : cell.workingSets > 0
                        ? `${cell.date}: ${cell.workingSets} раб. подх.`
                        : `${cell.date}: отдых`
                  }
                />
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* Сравнение: эта неделя vs прошлая */}
      <div className="heatmap-wow" aria-label="Сравнение последних 7 дней с предыдущими">
        <div className="heatmap-wow-item">
          <small>Подходы (7 дн. vs пред.)</small>
          <strong>
            {comparison.current.workingSets}
            <span className={`heatmap-delta${comparison.setsDelta > 0 ? " is-up" : comparison.setsDelta < 0 ? " is-down" : ""}`}>
              {comparison.setsDelta > 0 ? <TrendingUp size={12} aria-hidden="true" /> : comparison.setsDelta < 0 ? <TrendingDown size={12} aria-hidden="true" /> : null}
              {setsDeltaLabel}
            </span>
          </strong>
        </div>
        <div className="heatmap-wow-item">
          <small>Рабочий тоннаж (7 дн.)</small>
          <strong>
            {comparison.current.tonnageKg > 0 ? `${fmt(Math.round(comparison.current.tonnageKg / 100) / 10)} т` : "—"}
            {comparison.tonnageDeltaPct !== null ? (
              <span className={`heatmap-delta${comparison.tonnageDeltaPct > 0 ? " is-up" : comparison.tonnageDeltaPct < 0 ? " is-down" : ""}`}>
                {comparison.tonnageDeltaPct > 0 ? `+${comparison.tonnageDeltaPct}%` : `${comparison.tonnageDeltaPct}%`}
              </span>
            ) : null}
          </strong>
        </div>
        <div className="heatmap-wow-item">
          <small>Средний RIR</small>
          <strong>
            {comparison.current.avgRir !== null ? fmt(comparison.current.avgRir) : "—"}
            {comparison.previous.avgRir !== null ? (
              <span className="heatmap-prev">пред. {fmt(comparison.previous.avgRir)}</span>
            ) : null}
          </strong>
        </div>
      </div>
    </section>
  );
}
