import { useMemo, useState } from "react";
import { m, useReducedMotion } from "motion/react";
import { Activity, Dumbbell, Flame, Layers, TrendingUp } from "lucide-react";
import { ProgressOverview as Overview, OVERVIEW_PERIODS, type OverviewPeriod } from "../domain/ProgressOverview";
import { PersonalRecordsCalculator } from "../domain/PersonalRecords";
import { StrengthTotal } from "../domain/StrengthTotal";
import { DAY_NAMES } from "../domain/TrainingProgram";
import { DateText } from "../domain/DateText";
import { VolumeLabel } from "../domain/VolumeLabel";
import WeeklyTrendChart from "./WeeklyTrendChart";
import StrengthTotalCard from "./StrengthTotalCard";
import StrengthForecastCard from "./StrengthForecastCard";
import WeakLinkRadarCard from "./WeakLinkRadarCard";
import StatsAnalytics from "./StatsAnalytics";
import { quantityWord } from "../lib/quantity";
import type { Workout, Settings } from "../lib/model";
import "../styles/progress.css";

export default function ProgressOverview({
  workouts,
  settings,
  bodyMassKg,
  onStrength,
  onOpenExerciseDetail,
}: {
  workouts: Workout[];
  settings: Settings;
  bodyMassKg?: number | null;
  onStrength: (key: string) => void;
  onOpenExerciseDetail?: (exerciseId: string) => void;
}) {
  const [period, setPeriod] = useState<OverviewPeriod>("4w");
  const reduced = useReducedMotion();
  const zone = settings.timeZone ?? "UTC";
  const days = useMemo(() => Overview.days(period, workouts, zone), [period, workouts, zone]);
  const data = useMemo(() => Overview.calculate(workouts, days, zone), [workouts, days, zone]);
  const long = days > 84;
  const buckets = useMemo(
    () => (long ? Overview.weekly(data.current, data.start, data.end, zone) : []),
    [long, data, zone],
  );
  const totalSummary = useMemo(
    () => StrengthTotal.fromWorkouts(workouts, zone, bodyMassKg),
    [workouts, zone, bodyMassKg],
  );
  const pulse = useMemo(() => StrengthTotal.weekdayPulse(data.current, zone), [data, zone]);
  const streak = useMemo(
    () => new PersonalRecordsCalculator(workouts).calculateStreak(zone),
    [workouts, zone],
  );
  const label = OVERVIEW_PERIODS.find((p) => p.id === period)!.label.toLowerCase();

  return (
    <div className="progress-overview tel-panel">
      {/* Hero-блок в стиле ИИ-анализа */}
      <m.section
        className="tel-hero is-single"
        aria-label="Сводка прогресса"
        initial={reduced ? false : { opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
      >
        <div className="tel-card-head">
          <div style={{ display: "grid", gap: 6 }}>
            <span className="tel-eyebrow-pill">
              <Activity size={14} aria-hidden="true" />
              Сводка · {period === "all" ? "всё время" : label}
            </span>
            <h2 style={{ margin: 0, fontSize: "clamp(1.3rem, 1rem + 1vw, 1.7rem)" }}>
              <time dateTime={data.start}>{DateText.day(data.start)}</time> —{" "}
              <time dateTime={data.end}>{DateText.day(data.end)}</time>
            </h2>
          </div>

          <div className="tel-pill-row" role="group" aria-label="Период прогресса">
            {OVERVIEW_PERIODS.map((p) => (
              <button
                key={p.id}
                type="button"
                className={`tel-pill-btn${p.id === period ? " active" : ""}`}
                aria-pressed={p.id === period}
                onClick={() => setPeriod(p.id)}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {data.bestGrowth && long ? (
          <div className="coach-next-chip">
            <TrendingUp size={15} aria-hidden="true" />
            <b>Лидер роста:</b>
            <span>{data.bestGrowth.name}</span>
            <span className="coach-rir-badge">
              {data.bestGrowth.percent > 0 ? "+" : ""}
              {data.bestGrowth.percent}%
            </span>
          </div>
        ) : null}
      </m.section>

      {/* 4 карточки телеметрии (как в ИИ-анализе) */}
      <section className="tel-metric-grid" aria-label="Ключевые показатели">
        <m.article
          className="tel-metric-card"
          initial={reduced ? false : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
        >
          <span className="tel-metric-label">
            <Dumbbell size={13} aria-hidden="true" />
            Тренировки
          </span>
          <b className="tel-metric-val">{data.workouts}</b>
          <span className="tel-metric-sub">
            Недель с залом: {data.activeWeeks} из {data.totalWeeks}
          </span>
        </m.article>

        <m.article
          className={`tel-metric-card${data.strengthChange !== null && data.strengthChange > 0 ? " is-accent" : ""}`}
          initial={reduced ? false : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2, delay: reduced ? 0 : 0.04 }}
        >
          <span className="tel-metric-label">
            <TrendingUp size={13} aria-hidden="true" />
            Сила (e1RM)
          </span>
          <b className="tel-metric-val">
            {data.strengthChange === null
              ? "—"
              : `${data.strengthChange > 0 ? "+" : ""}${data.strengthChange}%`}
          </b>
          <span className="tel-metric-sub">
            {data.comparedLifts
              ? `${data.comparedLifts} ${quantityWord(data.comparedLifts, "движение", "движения", "движений")}`
              : "Нужно больше данных"}
          </span>
        </m.article>

        <m.article
          className="tel-metric-card"
          initial={reduced ? false : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2, delay: reduced ? 0 : 0.08 }}
        >
          <span className="tel-metric-label">
            <Layers size={13} aria-hidden="true" />
            Рабочие подходы
          </span>
          <b className="tel-metric-val">{data.sets}</b>
          <span className="tel-metric-sub" title={data.volumeKg > 0 ? undefined : VolumeLabel.reason(data.volumeOmitted)}>
            {VolumeLabel.overview(data.volumeKg, data.volumeOmitted)}
            {data.workloadChange !== null
              ? ` · ${data.workloadChange > 0 ? "+" : ""}${data.workloadChange}%`
              : ""}
          </span>
        </m.article>

        <m.article
          className="tel-metric-card"
          initial={reduced ? false : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2, delay: reduced ? 0 : 0.12 }}
        >
          <span className="tel-metric-label">
            <Flame size={13} aria-hidden="true" />
            Серия недель
          </span>
          <b className="tel-metric-val">
            {streak.currentWeekStreak} <small>нед.</small>
          </b>
          <span className="tel-metric-sub">Рекорд: {streak.bestWeekStreak} нед.</span>
        </m.article>
      </section>

      <StrengthTotalCard
        summary={totalSummary}
        bodyMassKg={bodyMassKg}
        onOpenLift={onStrength}
      />

      <StrengthForecastCard
        workouts={workouts}
        timeZone={zone}
        bodyMassKg={bodyMassKg}
        onOpenLift={onStrength}
      />

      <WeakLinkRadarCard
        workouts={workouts}
        timeZone={zone}
        bodyMassKg={bodyMassKg}
        onOpenExerciseDetail={onOpenExerciseDetail}
      />

      <section className="pulse-strip" aria-label="Дни тренировок">
        <div className="pulse-streak">
          <div className="pulse-streak-icon" aria-hidden="true">
            <Flame size={20} />
          </div>
          <div className="pulse-streak-copy">
            <strong>Ритм недели</strong>
            <span>Чаще всего тренируешься по выбранным дням</span>
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
