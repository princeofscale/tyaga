import { useMemo, useState } from "react";
import { AnimatePresence, m, useReducedMotion } from "motion/react";
import {
  Activity,
  AlertTriangle,
  Brain,
  CheckCircle2,
  ChevronDown,
  Flame,
  Info,
  ShieldAlert,
  TrendingUp,
} from "lucide-react";
import {
  SmartCoach,
  type CoachInsightCategory,
  type CoachStateV2,
} from "../domain/SmartCoach";
import type { DeloadPlanRecord } from "../domain/DeloadPlan";
import { fmt, type Routine, type Workout } from "../lib/model";
import "../styles/progress.css";

const FILTERS: Array<{ id: "all" | CoachInsightCategory; label: string }> = [
  { id: "all", label: "Все выводы" },
  { id: "overload", label: "Перегрузка" },
  { id: "underload", label: "Недогруз" },
  { id: "progress", label: "Прогресс" },
  { id: "balance", label: "Баланс" },
];

const STATE_TONE: Record<CoachStateV2, string> = {
  PEAK_PROGRESSIVE: "is-peak",
  MANAGE_FATIGUE: "is-manage",
  DELOAD_ACTIVE: "is-deload",
  OVERLOAD_WARNING: "is-overload",
};

const READINESS_STATUS_LABEL = {
  fresh: "Свежая",
  usable: "Готова",
  recovering: "Восст.",
  fatigued: "Устала",
} as const;

export default function SmartCoachPanel({
  workouts,
  routines,
  today,
  timeZone,
  accountId,
  deload,
}: {
  workouts: Workout[];
  routines: Routine[];
  today: string;
  timeZone?: string;
  accountId?: string;
  deload?: DeloadPlanRecord | null;
}) {
  const reduced = useReducedMotion();
  const [filter, setFilter] = useState<"all" | CoachInsightCategory>("all");
  const [showAllDetails, setShowAllDetails] = useState(false);

  const report = useMemo(
    () => SmartCoach.analyze(workouts, routines, today, timeZone, undefined, accountId, deload),
    [workouts, routines, today, timeZone, accountId, deload],
  );

  const v2 = report.v2;
  const axialPct = Math.min(130, Math.round(v2.deload.axialUtilization * 100));
  const localPct = Math.min(130, Math.round(v2.deload.localUtilization * 100));

  const visibleInsights = useMemo(
    () =>
      filter === "all"
        ? report.insights
        : report.insights.filter((i) => i.category === filter),
    [report.insights, filter],
  );

  return (
    <div className="coach-panel coach-v2">
      {/* 1. Единый главный вердикт SmartCoach v2 (без произвольного балла 0–100) */}
      <m.section
        className={`coach-v2-hero ${STATE_TONE[v2.state]}`}
        aria-label="Сводка Умного Коуча v2"
        initial={reduced ? false : { opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
      >
        <div className="coach-v2-hero-top">
          <span className={`coach-v2-state-pill ${STATE_TONE[v2.state]}`}>
            <Brain size={14} aria-hidden="true" />
            {v2.stateLabel}
          </span>
          <span className="coach-rir-badge">{report.nextSession.recommendedRir}</span>
        </div>
        <h2 className="coach-v2-verdict">{v2.verdict}</h2>

        {/* 2-компонентный EWMA-индикатор: Осевая/ЦНС (τ=4д) и Локальная (τ=10д) */}
        <div className="coach-ewma-bars" aria-label="Утилизация усталости EWMA">
          <div className="coach-ewma-row">
            <div className="coach-ewma-head">
              <span>Осевая / ЦНС</span>
              <strong className={axialPct >= 100 ? "is-high" : ""}>{axialPct}%</strong>
            </div>
            <div className="coach-ewma-track" aria-hidden="true">
              <span
                className={`coach-ewma-fill${axialPct >= 100 ? " is-high" : axialPct >= 85 ? " is-warn" : ""}`}
                style={{ width: `${Math.min(100, axialPct)}%` }}
              />
            </div>
          </div>
          <div className="coach-ewma-row">
            <div className="coach-ewma-head">
              <span>Локальная усталость</span>
              <strong className={localPct >= 100 ? "is-high" : ""}>{localPct}%</strong>
            </div>
            <div className="coach-ewma-track" aria-hidden="true">
              <span
                className={`coach-ewma-fill${localPct >= 100 ? " is-high" : localPct >= 85 ? " is-warn" : ""}`}
                style={{ width: `${Math.min(100, localPct)}%` }}
              />
            </div>
          </div>
        </div>

        <div className="coach-v2-meta-strip">
          <span>
            <Activity size={13} aria-hidden="true" />
            {report.planAdherence
              ? `План 14 дн.: ${report.planAdherence.pct}% (${report.planAdherence.done}/${report.planAdherence.planned})`
              : `За 7 дн.: ${report.acuteSets} подх.`}
          </span>
          <span>
            <Flame size={13} aria-hidden="true" />
            {v2.deload.rirDrift !== null
              ? `Дрейф RIR: ${v2.deload.rirDrift > 0 ? `+${fmt(v2.deload.rirDrift)}` : fmt(v2.deload.rirDrift)}`
              : `RIR 0–2: ${report.biomechanics.rirBands.high}/${report.biomechanics.workingSets}`}
          </span>
          <span>
            <TrendingUp size={13} aria-hidden="true" />
            Жим:Тяга {report.ratios.pushSets}:{report.ratios.pullSets}
          </span>
        </div>
      </m.section>

      {report.painFlagsSummary.count > 0 && (
        <div className="coach-pain-banner" role="status">
          <ShieldAlert size={15} aria-hidden="true" />
          <span>
            <b>Ограничения (боль):</b> {report.painFlagsSummary.names.slice(0, 4).join(", ")}
            {report.painFlagsSummary.count > 4 ? ` и ещё ${report.painFlagsSummary.count - 4}` : ""}. Автоповышение для них отключено.
          </span>
        </div>
      )}

      {/* 2. Бюджет UX: максимум 3 приоритизированных действия */}
      {v2.actions.length > 0 && (
        <section className="coach-v2-actions" aria-label="Главные действия">
          {v2.actions.map((act) => (
            <article key={act.id} className={`coach-v2-action-card kind-${act.kind}`}>
              <div className="coach-v2-action-head">
                <strong>{act.title}</strong>
                {act.metric && <span className="coach-insight-metric">{act.metric}</span>}
              </div>
              <p>{act.detail}</p>
            </article>
          ))}
        </section>
      )}

      {/* 3. Гранулярная готовность 12 мышечных групп (порог повторной тренировки ≥75%) */}
      <section className="coach-readiness-card" aria-label="Готовность 12 мышечных групп">
        <div className="coach-readiness-head">
          <h3>Готовность мышц</h3>
          <small>Порог для работы ≥ 75 %</small>
        </div>
        <div className="coach-readiness-grid">
          {v2.readiness.map((g) => (
            <div
              key={g.id}
              className={`coach-readiness-chip status-${g.status}`}
              title={`${g.label}: ${g.readinessPct}% (${READINESS_STATUS_LABEL[g.status]}, T½ ${g.halfLifeHours} ч)`}
            >
              <span className="coach-readiness-name">{g.label}</span>
              <strong className="coach-readiness-pct">{g.readinessPct}%</strong>
            </div>
          ))}
        </div>
      </section>

      {/* 4. Динамика e1RM по движениям (рост / плато / спад) */}
      {report.liftTrends.length > 0 && (
        <section className="coach-trends-card" aria-label="Динамика силы по упражнениям">
          <h3>Динамика силы (последние 3 нед. vs ранее)</h3>
          <div className="coach-trends-list">
            {report.liftTrends.slice(0, 6).map((t) => (
              <div key={t.exerciseId} className="coach-trend-row">
                <div className="coach-trend-name">
                  <b>{t.name}</b>
                  <small>
                    e1RM: {fmt(t.priorE1rm)} → {fmt(t.recentE1rm)} кг · {t.sessionsCount} тр. ·{" "}
                    {t.confidence === "high"
                      ? "высокая точность"
                      : t.confidence === "moderate"
                        ? "средняя точность"
                        : "ориентир"}
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

      {/* 5. Сворачиваемый подробный разбор (чтобы не перегружать главный экран) */}
      {report.insights.length > 0 && (
        <section className="coach-details-disclosure" aria-label="Подробные заметки">
          <button
            type="button"
            className="coach-details-toggle"
            aria-expanded={showAllDetails}
            onClick={() => setShowAllDetails((prev) => !prev)}
          >
            <span>Подробный разбор ({report.insights.length})</span>
            <ChevronDown
              size={16}
              aria-hidden="true"
              style={{
                transform: showAllDetails ? "rotate(180deg)" : undefined,
                transition: "transform 160ms ease",
              }}
            />
          </button>

          {showAllDetails && (
            <div className="coach-details-body">
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
                          {insight.metric && (
                            <span className="coach-insight-metric">{insight.metric}</span>
                          )}
                        </div>
                        <p className="coach-insight-detail">{insight.detail}</p>
                        <p className="coach-insight-action">{insight.action}</p>
                      </m.article>
                    ))
                  )}
                </AnimatePresence>
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
