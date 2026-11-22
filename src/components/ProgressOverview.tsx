import { useMemo, useState } from "react";
import { m, useReducedMotion } from "motion/react";
import { Flame, TrendingUp } from "lucide-react";
import { ProgressOverview as Overview, OVERVIEW_PERIODS, type OverviewPeriod } from "../domain/ProgressOverview";
import { PersonalRecordsCalculator } from "../domain/PersonalRecords";
import { StrengthTotal } from "../domain/StrengthTotal";
import { DAY_NAMES } from "../domain/TrainingProgram";
import { DateText } from "../domain/DateText";
import { VolumeLabel } from "../domain/VolumeLabel";
import WeeklyTrendChart from "./WeeklyTrendChart";
import StrengthTotalCard from "./StrengthTotalCard";
import StatsAnalytics from "./StatsAnalytics";
import { quantityWord } from "../lib/quantity";
import type { Workout, Settings } from "../lib/model";
import "../styles/progress-redesign.css";

export default function ProgressOverview({
  workouts,
  settings,
  bodyMassKg,
  onStrength,
}: {
  workouts: Workout[];
  settings: Settings;
  bodyMassKg?: number | null;
  onStrength: (key: string) => void;
}) {
  const [period, setPeriod] = useState<OverviewPeriod>("4w");
  const reduced = useReducedMotion();
  const zone = settings.timeZone ?? "UTC";
  const days = useMemo(() => Overview.days(period, workouts, zone), [period, workouts, zone]);
  const data = useMemo(() => Overview.calculate(workouts, days, zone), [workouts, days, zone]);
  const long = days > 84;
  const buckets = useMemo(() => (long ? Overview.weekly(data.current, data.start, data.end, zone) : []), [long, data, zone]);
  const totalSummary = useMemo(
    () => StrengthTotal.fromWorkouts(workouts, zone, bodyMassKg),
    [workouts, zone, bodyMassKg],
  );
  const pulse = useMemo(
    () => StrengthTotal.weekdayPulse(data.current, zone),
    [data, zone],
  );
  const streak = useMemo(
    () => new PersonalRecordsCalculator(workouts).calculateStreak(zone),
    [workouts, zone],
  );
  const label = OVERVIEW_PERIODS.find((p) => p.id === period)!.label.toLowerCase();

  return (
    <div className="progress-overview">
      <div className="overview-period">
        <div>
          <h2>Сводка</h2>
          <p>
            За {period === "all" ? "всё время" : label}:{" "}
            <time dateTime={data.start}>{DateText.day(data.start)}</time> —{" "}
            <time dateTime={data.end}>{DateText.day(data.end)}</time>
          </p>
        </div>
        <div
          className="progress-period"
          role="group"
          aria-label="Период прогресса"
        >
          {OVERVIEW_PERIODS.map((p) => (
            <button key={p.id} type="button" aria-pressed={p.id === period} onClick={() => setPeriod(p.id)}>
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <div className="progress-metrics">
        <m.article
          className="progress-metric"
          initial={reduced ? false : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.22 }}
        >
          <span>Тренировки</span>
          <strong>
            {data.workouts}
            <small>
              {" "}
              {quantityWord(data.workouts, "тренировка", "тренировки", "тренировок")}
            </small>
          </strong>
          <p>
            Недель с залом: {data.activeWeeks} / {data.totalWeeks}
          </p>
        </m.article>

        <m.article
          className={`progress-metric accent${data.strengthChange !== null && data.strengthChange > 0 ? " is-positive" : ""}`}
          initial={reduced ? false : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.22, delay: reduced ? 0 : 0.04 }}
        >
          <span>Сила (e1RM)</span>
          <strong>
            {data.strengthChange === null
              ? "—"
              : `${data.strengthChange > 0 ? "+" : ""}${data.strengthChange}%`}
          </strong>
          <p>
            {data.comparedLifts
              ? `${data.comparedLifts} ${quantityWord(data.comparedLifts, "движение", "движения", "движений")}`
              : "Мало данных"}
          </p>
        </m.article>

        <m.article
          className="progress-metric"
          initial={reduced ? false : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.22, delay: reduced ? 0 : 0.08 }}
        >
          <span>Объём</span>
          <strong>
            {data.sets}
            <small>
              {" "}
              {quantityWord(data.sets, "рабочий подход", "рабочих подхода", "рабочих подходов")}
            </small>
          </strong>
          <p title={data.volumeKg > 0 ? undefined : VolumeLabel.reason(data.volumeOmitted)}>
            {VolumeLabel.overview(data.volumeKg, data.volumeOmitted)}
            {data.workloadChange !== null
              ? ` · ${data.workloadChange > 0 ? "+" : ""}${data.workloadChange}%`
              : ""}
          </p>
        </m.article>
      </div>

      {data.bestGrowth && long ? (
        <p className="overview-best-growth">
          <TrendingUp size={15} aria-hidden="true" />
          <span>Лидер роста:</span>
          <b>{data.bestGrowth.name}</b>
          <strong>
            {data.bestGrowth.percent > 0 ? "+" : ""}
            {data.bestGrowth.percent}%
          </strong>
        </p>
      ) : null}

      <StrengthTotalCard
        summary={totalSummary}
        bodyMassKg={bodyMassKg}
        onOpenLift={onStrength}
      />

      <section className="pulse-strip" aria-label="Серия и дни тренировок">
        <div className="pulse-streak">
          <div className="pulse-streak-icon" aria-hidden="true">
            <Flame size={20} />
          </div>
          <div className="pulse-streak-copy">
            <strong>
              {streak.currentWeekStreak} {quantityWord(streak.currentWeekStreak, "неделя", "недели", "недель")} подряд
            </strong>
            <span>Рекорд серии: {streak.bestWeekStreak} нед.</span>
          </div>
        </div>
        <div className="pulse-days" aria-label="Распределение тренировок по дням недели">
          {DAY_NAMES.map((day, idx) => {
            const count = pulse.counts[idx];
            const ratio = pulse.max > 0 ? count / pulse.max : 0;
            const isPeak = pulse.peakWeekday === idx && count > 0;
            return (
              <div
                key={day}
                className={`pulse-day${isPeak ? " is-peak" : ""}${count === 0 ? " is-empty" : ""}`}
                title={`${day}: ${count}`}
              >
                <div className="pulse-day-track" aria-hidden="true">
                  <m.span
                    className="pulse-day-bar"
                    style={{ height: `${count > 0 ? Math.max(18, Math.round(ratio * 100)) : 12}%` }}
                    initial={reduced ? false : { scaleY: 0 }}
                    animate={{ scaleY: 1 }}
                    transition={{ duration: reduced ? 0 : 0.32, delay: reduced ? 0 : idx * 0.025 }}
                  />
                </div>
                <span>{day}</span>
              </div>
            );
          })}
        </div>
      </section>

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
    </div>
  );
}
