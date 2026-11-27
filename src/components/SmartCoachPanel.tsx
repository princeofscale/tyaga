import { useMemo, useState } from "react";
import { m, useReducedMotion } from "motion/react";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BatteryCharging,
  Brain,
  CheckCircle2,
  ChevronRight,
  Flame,
  Info,
  RefreshCw,
  ShieldAlert,
  TrendingUp,
} from "lucide-react";
import {
  SmartCoach,
  type CoachActionV2,
  type CoachInsightCategory,
  type CoachStateV2,
} from "../domain/SmartCoach";
import type { DeloadPlanRecord } from "../domain/DeloadPlan";
import { fmt, type Routine, type Workout } from "../lib/model";
import "../styles/progress.css";

const FILTERS: Array<{ id: "all" | CoachInsightCategory; label: string }> = [
  { id: "all", label: "Все" },
  { id: "overload", label: "Перегрузка" },
  { id: "underload", label: "Недогруз" },
  { id: "progress", label: "Прогресс" },
  { id: "balance", label: "Баланс" },
];

const CATEGORY_LABEL: Record<CoachInsightCategory, string> = {
  overload: "Перегрузка",
  underload: "Недогруз",
  progress: "Прогресс",
  balance: "Баланс",
};

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

function parseMetricPct(metric?: string): number | null {
  if (!metric) return null;
  const match = metric.match(/(\d+(?:[.,]\d+)?)\s*%/);
  if (!match) return null;
  const num = Number(match[1].replace(",", "."));
  return Number.isFinite(num) ? Math.max(0, Math.min(100, num)) : null;
}

function ActionKindIcon({ kind }: { kind: CoachActionV2["kind"] }) {
  switch (kind) {
    case "deload":
      return <ShieldAlert size={16} aria-hidden="true" />;
    case "readiness":
      return <BatteryCharging size={16} aria-hidden="true" />;
    case "detraining":
      return <RefreshCw size={16} aria-hidden="true" />;
    case "plateau":
      return <Flame size={16} aria-hidden="true" />;
    case "progression":
    case "tm_update":
    default:
      return <TrendingUp size={16} aria-hidden="true" />;
  }
}

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

  const report = useMemo(
    () => SmartCoach.analyze(workouts, routines, today, timeZone, undefined, accountId, deload),
    [workouts, routines, today, timeZone, accountId, deload],
  );

  const v2 = report.v2;
  const axialPct = Math.min(130, Math.round(v2.deload.axialUtilization * 100));
  const localPct = Math.min(130, Math.round(v2.deload.localUtilization * 100));

  const readinessSummary = useMemo(() => {
    const readyCount = v2.readiness.filter((g) => g.readinessPct >= 75).length;
    const recoveringCount = v2.readiness.length - readyCount;
    return { readyCount, recoveringCount };
  }, [v2.readiness]);

  const insightCounts = useMemo(() => {
    const attention = report.insights.filter(
      (i) => i.severity === "critical" || i.severity === "warn",
    ).length;
    const positive = report.insights.filter((i) => i.severity === "good").length;
    return { attention, positive };
  }, [report.insights]);

  const showCategoryFilters = report.insights.length > 4;
  const visibleInsights = useMemo(
    () =>
      !showCategoryFilters || filter === "all"
        ? report.insights
        : report.insights.filter((i) => i.category === filter),
    [report.insights, filter, showCategoryFilters],
  );

  return (
    <div className="coach-panel coach-v2">
      {/* 1. Главный командный блок «Контроль усталости» */}
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
              <span>
                Осевая / ЦНС <small className="coach-ewma-tau">τ 4 дн.</small>
              </span>
              <strong className={axialPct >= 100 ? "is-high" : axialPct >= 85 ? "is-warn" : ""}>
                {axialPct}%
              </strong>
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
              <span>
                Локальная усталость <small className="coach-ewma-tau">τ 10 дн.</small>
              </span>
              <strong className={localPct >= 100 ? "is-high" : localPct >= 85 ? "is-warn" : ""}>
                {localPct}%
              </strong>
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

      {/* 2. Главные приоритетные сигналы (вкл. карточки восстановления типа «Спина / шир.: восстановление 20%») */}
      {v2.actions.length > 0 && (
        <div className="coach-v2-actions-wrap">
          <section className="coach-v2-actions" aria-label="Главные действия">
            {v2.actions.map((act) => {
              const recoveryPct = act.kind === "readiness" ? parseMetricPct(act.metric) : null;
              return (
                <article key={act.id} className={`coach-v2-action-card kind-${act.kind}`}>
                  <div className="coach-v2-action-head">
                    <span className="coach-v2-action-title">
                      <span className={`coach-v2-action-icon kind-${act.kind}`}>
                        <ActionKindIcon kind={act.kind} />
                      </span>
                      <strong>{act.title}</strong>
                    </span>
                    {act.metric && (
                      <span className={`coach-insight-metric kind-${act.kind}`}>{act.metric}</span>
                    )}
                  </div>
                  {recoveryPct !== null ? (
                    <div className="coach-action-meter" aria-hidden="true">
                      <span
                        className={`coach-action-meter-fill${recoveryPct < 45 ? " is-low" : recoveryPct < 75 ? " is-mid" : " is-ok"}`}
                        style={{ width: `${Math.max(4, recoveryPct)}%` }}
                      />
                    </div>
                  ) : null}
                  <p>{act.detail}</p>
                </article>
              );
            })}
          </section>
        </div>
      )}

      {/* 3. Готовность 12 мышечных групп — главный визуальный радар восстановления */}
      <section className="coach-readiness-card" aria-label="Готовность 12 мышечных групп">
        <div className="coach-readiness-head">
          <div className="coach-readiness-title-group">
            <h3>Готовность мышц</h3>
            <small>Порог для тяжёлой работы ≥ 75%</small>
          </div>
          <div className="coach-readiness-counters">
            <span className="coach-r-pill is-ready">Готовы {readinessSummary.readyCount}/12</span>
            {readinessSummary.recoveringCount > 0 ? (
              <span className="coach-r-pill is-rest">
                Восст. {readinessSummary.recoveringCount}
              </span>
            ) : null}
          </div>
        </div>
        <div className="coach-readiness-grid">
          {v2.readiness.map((g) => (
            <div
              key={g.id}
              className={`coach-readiness-chip status-${g.status}`}
              title={`${g.label}: ${g.readinessPct}% (${READINESS_STATUS_LABEL[g.status]}, T½ ${g.halfLifeHours} ч)`}
            >
              <div className="coach-r-chip-top">
                <span className="coach-readiness-name">{g.label}</span>
                <strong className="coach-readiness-pct">{g.readinessPct}%</strong>
              </div>
              <div className="coach-r-bar" aria-hidden="true">
                <span
                  className="coach-r-bar-fill"
                  style={{ width: `${Math.max(4, Math.min(100, g.readinessPct))}%` }}
                />
              </div>
              <div className="coach-r-chip-foot">
                <span>{READINESS_STATUS_LABEL[g.status]}</span>
                <span>T½ {g.halfLifeHours}ч</span>
              </div>
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

      {/* 5. Переработанный «Подробный разбор» на нативном <details> без визуального шума */}
      {report.insights.length > 0 && (
        <details className="coach-v2-disclosure">
          <summary className="coach-v2-disclosure-summary coach-details-toggle">
            <span className="coach-disclosure-main">
              <ChevronRight size={16} className="coach-disclosure-chevron" aria-hidden="true" />
              <span className="coach-disclosure-label">
                Подробный разбор ({report.insights.length})
              </span>
            </span>
            <span className="coach-disclosure-pills">
              {insightCounts.attention > 0 ? (
                <span className="coach-disc-pill is-warn">{insightCounts.attention} внимание</span>
              ) : null}
              {insightCounts.positive > 0 ? (
                <span className="coach-disc-pill is-good">{insightCounts.positive} плюс</span>
              ) : null}
            </span>
          </summary>

          <div className="coach-details-body">
            {showCategoryFilters ? (
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
            ) : null}

            <div className="coach-insights-v2-list">
              {visibleInsights.length === 0 ? (
                <p className="coach-insight-detail">В этой категории замечаний нет — всё ровно.</p>
              ) : (
                visibleInsights.map((insight) => (
                  <article
                    key={insight.id}
                    className={`coach-insight-v2 coach-insight-card sev-${insight.severity}`}
                  >
                    <div className="coach-insight-v2-head">
                      <div className="coach-insight-v2-left">
                        <span className={`coach-insight-v2-icon sev-${insight.severity}`}>
                          {insight.severity === "critical" || insight.severity === "warn" ? (
                            <AlertTriangle size={15} aria-hidden="true" />
                          ) : insight.severity === "good" ? (
                            <CheckCircle2 size={15} aria-hidden="true" />
                          ) : (
                            <Info size={15} aria-hidden="true" />
                          )}
                        </span>
                        <div className="coach-insight-v2-titles">
                          <span className="coach-insight-v2-cat">
                            {CATEGORY_LABEL[insight.category]}
                          </span>
                          <strong className="coach-insight-v2-title">{insight.title}</strong>
                        </div>
                      </div>
                      {insight.metric ? (
                        <span className={`coach-insight-v2-metric sev-${insight.severity}`}>
                          {insight.metric}
                        </span>
                      ) : null}
                    </div>

                    <p className="coach-insight-v2-detail">{insight.detail}</p>

                    <div className="coach-insight-v2-action">
                      <ArrowRight size={14} aria-hidden="true" />
                      <span>{insight.action}</span>
                    </div>
                  </article>
                ))
              )}
            </div>
          </div>
        </details>
      )}
    </div>
  );
}
