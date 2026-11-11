import { useMemo, useState } from "react";
import { m, useReducedMotion } from "motion/react";
import { ProgressOverview as Overview } from "../domain/ProgressOverview";
import { fmt, type Workout, type Settings } from "../lib/model";
import StatsAnalytics from "./StatsAnalytics";
import { quantityWord } from "../lib/quantity";
export default function ProgressOverview({
  workouts,
  settings,
  onStrength,
}: {
  workouts: Workout[];
  settings: Settings;
  onStrength: (key: string) => void;
}) {
  const [days, setDays] = useState(28);
  const reduced = useReducedMotion();
  const data = useMemo(
    () => Overview.calculate(workouts, days, settings.timeZone ?? "UTC"),
    [workouts, days, settings.timeZone],
  );
  return (
    <m.div
      className="progress-overview"
      initial={reduced ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
    >
      <div className="overview-period">
        <div>
          <h2>Твой тренировочный ритм</h2>
          <p>Сравнение с предыдущим периодом той же длины.</p>
        </div>
        <div
          className="progress-period"
          role="group"
          aria-label="Период прогресса"
        >
          {[28, 56, 84].map((d) => (
            <button
              key={d}
              aria-pressed={d === days}
              onClick={() => setDays(d)}
            >
              {d / 7} нед.
            </button>
          ))}
        </div>
      </div>
      <div className="progress-metrics">
        <article className="progress-metric">
          <span>Регулярность</span>
          <strong>
            {data.workouts}
            <small>
              {" "}
              {quantityWord(
                data.workouts,
                "тренировка",
                "тренировки",
                "тренировок",
              )}
            </small>
          </strong>
          <p>
            Активных недель: {data.activeWeeks} · период {data.totalWeeks} нед.
          </p>
        </article>
        <article className="progress-metric accent">
          <span>Изменение силы</span>
          <strong>
            {data.strengthChange === null
              ? "—"
              : `${data.strengthChange > 0 ? "+" : ""}${data.strengthChange}%`}
          </strong>
          <p>
            {data.comparedLifts
              ? `По расчётному 1ПМ: ${data.comparedLifts} ${quantityWord(data.comparedLifts, "упражнение", "упражнения", "упражнений")}`
              : "Нужны сопоставимые подходы в обоих периодах"}
          </p>
        </article>
        <article className="progress-metric">
          <span>Нагрузка</span>
          <strong>
            {data.sets}
            <small>
              {" "}
              {quantityWord(
                data.sets,
                "рабочий подход",
                "рабочих подхода",
                "рабочих подходов",
              )}
            </small>
          </strong>
          <p>
            {fmt(data.volumeKg / 1000)} т свободных весов ·{" "}
            {data.workloadChange === null
              ? "Нет прошлого периода"
              : `${data.workloadChange > 0 ? "+" : ""}${data.workloadChange}% подходов`}
          </p>
        </article>
      </div>
      <StatsAnalytics
        key={days}
        workouts={data.current}
        settings={settings}
        compact
        weeks={days / 7}
        rangeStart={data.start}
        onOpenExerciseStrength={onStrength}
      />
    </m.div>
  );
}
