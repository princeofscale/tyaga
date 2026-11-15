import { useMemo, useState } from "react";
import { m, useReducedMotion } from "motion/react";
import { ProgressOverview as Overview, OVERVIEW_PERIODS, type OverviewPeriod } from "../domain/ProgressOverview";
import { DateText } from "../domain/DateText";
import WeeklyTrendChart from "./WeeklyTrendChart";
import { fmt, type Workout, type Settings } from "../lib/model";
import StatsAnalytics from "./StatsAnalytics";
import { quantityWord } from "../lib/quantity";
import { VolumeLabel } from "../domain/VolumeLabel";
export default function ProgressOverview({
  workouts,
  settings,
  onStrength,
}: {
  workouts: Workout[];
  settings: Settings;
  onStrength: (key: string) => void;
}) {
  const [period, setPeriod] = useState<OverviewPeriod>("4w");
  const reduced = useReducedMotion();
  const zone = settings.timeZone ?? "UTC";
  const days = useMemo(() => Overview.days(period, workouts, zone), [period, workouts, zone]);
  const data = useMemo(() => Overview.calculate(workouts, days, zone), [workouts, days, zone]);
  const long = days > 84;
  const buckets = useMemo(() => (long ? Overview.weekly(data.current, data.start, data.end, zone) : []), [long, data, zone]);
  const label = OVERVIEW_PERIODS.find((p) => p.id === period)!.label.toLowerCase();
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
          <p>
            За {period === "all" ? "всё время" : label}: {DateText.day(data.start)} — {DateText.day(data.end)}. Сравнение с предыдущим периодом той же длины.
          </p>
        </div>
        <div
          className="progress-period"
          role="group"
          aria-label="Период прогресса"
        >
          {OVERVIEW_PERIODS.map((p) => (
            <button key={p.id} aria-pressed={p.id === period} onClick={() => setPeriod(p.id)}>
              {p.label}
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
            Активных недель: {data.activeWeeks} из {data.totalWeeks}
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
          <p title={data.volumeKg > 0 ? undefined : VolumeLabel.reason(data.volumeOmitted)}>
            {VolumeLabel.overview(data.volumeKg, data.volumeOmitted)} ·{" "}
            {data.workloadChange === null
              ? "Нет прошлого периода"
              : `${data.workloadChange > 0 ? "+" : ""}${data.workloadChange}% подходов`}
          </p>
        </article>
      </div>
      {data.bestGrowth && long ? (
        <p className="overview-best-growth">
          Лучший рост за период: <b>{data.bestGrowth.name}</b> {data.bestGrowth.percent > 0 ? "+" : ""}
          {data.bestGrowth.percent}% по расчётному 1ПМ.
        </p>
      ) : null}
      {long ? <WeeklyTrendChart buckets={buckets} /> : null}
      <StatsAnalytics
        key={period}
        workouts={data.current}
        settings={settings}
        compact
        weeks={Math.max(Math.ceil(days / 7), data.totalWeeks)}
        rangeStart={data.start}
        onOpenExerciseStrength={onStrength}
      />
    </m.div>
  );
}
