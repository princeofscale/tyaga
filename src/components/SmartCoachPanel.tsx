import { useMemo, useState } from "react";
import { AnimatePresence, m, useReducedMotion } from "motion/react";
import {
  Activity,
  AlertTriangle,
  Brain,
  CheckCircle2,
  Flame,
  Info,
  ShieldAlert,
  TrendingUp,
} from "lucide-react";
import { SmartCoach, type CoachInsightCategory } from "../domain/SmartCoach";
import { fmt, type Routine, type Workout } from "../lib/model";
import "../styles/progress.css";

const GAUGE_R = 46;
const GAUGE_C = 2 * Math.PI * GAUGE_R;

const FILTERS: Array<{ id: "all" | CoachInsightCategory; label: string }> = [
  { id: "all", label: "Все выводы" },
  { id: "overload", label: "Перегрузка" },
  { id: "underload", label: "Недогруз" },
  { id: "progress", label: "Прогресс" },
  { id: "balance", label: "Баланс" },
];

export default function SmartCoachPanel({
  workouts,
  routines,
  today,
  timeZone,
}: {
  workouts: Workout[];
  routines: Routine[];
  today: string;
  timeZone?: string;
}) {
  const reduced = useReducedMotion();
  const [filter, setFilter] = useState<"all" | CoachInsightCategory>("all");

  const report = useMemo(
    () => SmartCoach.analyze(workouts, routines, today, timeZone),
    [workouts, routines, today, timeZone],
  );

  const visibleInsights = useMemo(
    () =>
      filter === "all"
        ? report.insights
        : report.insights.filter((i) => i.category === filter),
    [report.insights, filter],
  );

  const gaugeOffset = GAUGE_C * (1 - report.score / 100);

  return (
    <div className="coach-panel">
      {/* Главная карточка готовности и статуса */}
      <m.section
        className={`coach-hero status-${report.status}`}
        aria-label="Сводка ИИ-анализа тренировок"
        initial={reduced ? false : { opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
      >
        <div className="coach-gauge" aria-label={`Индекс баланса нагрузки: ${report.score} из 100`}>
          <svg viewBox="0 0 112 112" aria-hidden="true">
            <circle className="coach-gauge-track" cx="56" cy="56" r={GAUGE_R} />
            <m.circle
              className="coach-gauge-fill"
              cx="56"
              cy="56"
              r={GAUGE_R}
              strokeDasharray={GAUGE_C}
              initial={reduced ? false : { strokeDashoffset: GAUGE_C }}
              animate={{ strokeDashoffset: gaugeOffset }}
              transition={reduced ? { duration: 0 } : { duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
            />
          </svg>
          <div className="coach-gauge-center">
            <strong>{report.score}</strong>
            <span>индекс</span>
          </div>
        </div>

        <div className="coach-hero-copy">
          <span className="coach-status-pill">
            <Brain size={14} aria-hidden="true" />
            {report.statusLabel}
          </span>
          <h2>{report.headline}</h2>
          <div className="coach-next-chip">
            <b>Следующая тренировка:</b>
            <span>{report.nextSession.headline}</span>
            <span className="coach-rir-badge">{report.nextSession.recommendedRir}</span>
          </div>
        </div>
      </m.section>

      {/* 4 ключевых показателя телеметрии */}
      <section className="coach-telemetry-grid" aria-label="Показатели нагрузки">
        <m.article
          className="coach-metric-card"
          initial={reduced ? false : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.22 }}
        >
          <span className="coach-metric-label">
            <Activity size={13} aria-hidden="true" />
            Нагрузка (ACWR)
          </span>
          <b className="coach-metric-val">{report.acwr !== null ? fmt(report.acwr) : "—"}</b>
          <span className="coach-metric-sub">
            {report.acwrLabel} · {report.acuteSets} / {fmt(report.chronicWeeklyAvg)} подх.
          </span>
        </m.article>

        <m.article
          className="coach-metric-card"
          initial={reduced ? false : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.22, delay: reduced ? 0 : 0.04 }}
        >
          <span className="coach-metric-label">
            <Flame size={13} aria-hidden="true" />
            Стимул (7 дн.)
          </span>
          <b className="coach-metric-val">
            {fmt(report.biomechanics.effectiveSetsTotal)}
          </b>
          <span className="coach-metric-sub">
            {report.biomechanics.avgRir !== null
              ? `Средний RIR ${fmt(report.biomechanics.avgRir)} · ${report.biomechanics.failureSets} в отказ`
              : `${report.biomechanics.workingSets} рабочих подходов`}
          </span>
        </m.article>

        <m.article
          className="coach-metric-card"
          initial={reduced ? false : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.22, delay: reduced ? 0 : 0.08 }}
        >
          <span className="coach-metric-label">
            <ShieldAlert size={13} aria-hidden="true" />
            Осевая нагрузка
          </span>
          <b className="coach-metric-val">{report.biomechanics.axialHardSets}</b>
          <span className="coach-metric-sub">
            тяжёлых осевых подх. за 7 дн.
          </span>
        </m.article>

        <m.article
          className="coach-metric-card"
          initial={reduced ? false : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.22, delay: reduced ? 0 : 0.12 }}
        >
          <span className="coach-metric-label">
            <TrendingUp size={13} aria-hidden="true" />
            Жимы / Тяги (28 дн.)
          </span>
          <b className="coach-metric-val">
            {report.ratios.pushSets} : {report.ratios.pullSets}
          </b>
          <span className="coach-metric-sub">
            {report.ratios.pushPullStatus === "balanced"
              ? "Сбалансировано"
              : report.ratios.pushPullStatus === "push-dominant"
                ? "Перекос в жимы"
                : report.ratios.pushPullStatus === "pull-dominant"
                  ? "Перекос в тяги"
                  : "Мало данных"}
          </span>
        </m.article>
      </section>

      {/* Фильтр и лента выводов ИИ */}
      {report.insights.length > 0 && (
        <section aria-label="Разбор и рекомендации">
          <div className="coach-filter-row" role="tablist" aria-label="Категории анализа">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                role="tab"
                aria-selected={filter === f.id}
                className={`coach-filter-btn${filter === f.id ? " active" : ""}`}
                onClick={() => setFilter(f.id)}
              >
                {f.label}
              </button>
            ))}
          </div>

          <div className="coach-insights-list" style={{ marginTop: 12 }}>
            <AnimatePresence mode="popLayout" initial={false}>
              {visibleInsights.length === 0 ? (
                <m.p
                  key="empty-filter"
                  className="coach-insight-detail"
                  initial={reduced ? false : { opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                >
                  В этой категории замечаний нет — всё ровно.
                </m.p>
              ) : (
                visibleInsights.map((insight, idx) => (
                  <m.article
                    key={insight.id}
                    layout={!reduced}
                    className={`coach-insight-card sev-${insight.severity}`}
                    initial={reduced ? false : { opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={reduced ? undefined : { opacity: 0, y: -6 }}
                    transition={{ duration: 0.2, delay: reduced ? 0 : idx * 0.03 }}
                  >
                    <div className="coach-insight-top">
                      <span className="coach-insight-title">
                        {insight.severity === "critical" || insight.severity === "warn" ? (
                          <AlertTriangle size={16} aria-hidden="true" />
                        ) : insight.severity === "good" ? (
                          <CheckCircle2 size={16} aria-hidden="true" />
                        ) : (
                          <Info size={16} aria-hidden="true" />
                        )}
                        {insight.title}
                      </span>
                      {insight.metric && <span className="coach-insight-metric">{insight.metric}</span>}
                    </div>
                    <p className="coach-insight-detail">{insight.detail}</p>
                    <p className="coach-insight-action">{insight.action}</p>
                  </m.article>
                ))
              )}
            </AnimatePresence>
          </div>
        </section>
      )}

      {/* Динамика e1RM по движениям (рост / плато / спад) */}
      {report.liftTrends.length > 0 && (
        <section className="coach-trends-card" aria-label="Динамика силы по упражнениям">
          <h3>Динамика силы (последние 3 нед. vs ранее)</h3>
          <div className="coach-trends-list">
            {report.liftTrends.slice(0, 6).map((t) => (
              <div key={t.exerciseId} className="coach-trend-row">
                <div className="coach-trend-name">
                  <b>{t.name}</b>
                  <small>
                    e1RM: {fmt(t.priorE1rm)} → {fmt(t.recentE1rm)} кг · {t.sessionsCount} тр.
                  </small>
                </div>
                <span className={`coach-trend-badge ${t.status}`}>
                  {t.changePct > 0 ? `+${fmt(t.changePct)}%` : `${fmt(t.changePct)}%`}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
