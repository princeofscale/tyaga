import { useEffect, useMemo, useState } from "react";
import { AlertCircle, ArrowRight, CheckCircle2, Layers, ShieldCheck, Sparkles } from "lucide-react";
import {
  REGION_META,
  type AuditedHypertrophyRegion,
} from "../domain/BiomechanicsCatalogV3";
import { BiomechanicsProfileStore } from "../domain/BiomechanicsProfile";
import { HypertrophyAuditEngine } from "../domain/HypertrophyAuditEngine";
import { JointGuardEngine, JointPainStore } from "../domain/JointGuardEngine";
import { WeakLinkAnalyzer } from "../domain/WeakLinkAnalyzer";
import { exerciseById, fmt, type Routine, type Workout } from "../lib/model";

type AuditSource = "week" | "program";

function mapWeakLinksToRegions(workouts: Workout[], timeZone?: string, bodyMassKg?: number | null, longLevers = false): AuditedHypertrophyRegion[] {
  const wl = new WeakLinkAnalyzer(workouts, { timeZone, bodyMassKg, longLevers }).build();
  const out = new Set<AuditedHypertrophyRegion>();
  for (const axis of wl.axes) {
    if (axis.status !== "lagging") continue;
    if (axis.id === "row_vs_bench" || axis.id === "row_vs_ohp") {
      out.add("upper_back");
      out.add("delt_rear");
    } else if (axis.id === "vpull_vs_bench") {
      out.add("lats");
    } else if (axis.id === "ohp_vs_bench") {
      out.add("chest_upper");
      out.add("delt_mid");
    } else if (axis.id === "squat_vs_bench") {
      out.add("quads_vasti");
      out.add("quads_rectus_femoris");
    } else if (axis.id === "hinge_vs_squat") {
      out.add("hams_hinge");
      out.add("hams_knee_flexion");
    }
  }
  return [...out];
}

type Props = {
  accountId?: string;
  workouts: Workout[];
  routines?: Routine[];
  today?: string;
  timeZone?: string;
  bodyMassKg?: number | null;
  onOpenExerciseDetail?: (exerciseId: string) => void;
};

/**
 * Карточка HypertrophyAuditEngine (Модуль B «Тяга v3»):
 * оценивает региональное покрытие 18 пучков, долю стимула в растянутой позиции (45–70%),
 * средний SFR (с учётом longLevers) и суставную безопасность JointGuardEngine.
 */
export default function HypertrophyAuditCard({
  accountId,
  workouts,
  routines = [],
  today,
  timeZone,
  bodyMassKg,
  onOpenExerciseDetail,
}: Props) {
  const hasRoutines = routines.length > 0;
  const [source, setSource] = useState<AuditSource>("week");
  const [profile, setProfile] = useState(() => BiomechanicsProfileStore.read(undefined, accountId));
  const [painLogs, setPainLogs] = useState(() => JointPainStore.read(undefined, Date.now(), accountId));

  useEffect(() => {
    const sync = () => {
      setProfile(BiomechanicsProfileStore.read(undefined, accountId));
      setPainLogs(JointPainStore.read(undefined, Date.now(), accountId));
    };
    sync();
    window.addEventListener("tyaga:biomechanics-profile-change", sync);
    window.addEventListener("tyaga:joint-pain-change", sync);
    return () => {
      window.removeEventListener("tyaga:biomechanics-profile-change", sync);
      window.removeEventListener("tyaga:joint-pain-change", sync);
    };
  }, [accountId]);

  const priorityRegions = useMemo(
    () => mapWeakLinksToRegions(workouts, timeZone, bodyMassKg, profile.longLevers),
    [workouts, timeZone, bodyMassKg, profile.longLevers],
  );

  const report = useMemo(() => {
    const engine = new HypertrophyAuditEngine(new JointGuardEngine());
    if (source === "program" && hasRoutines) {
      return engine.auditRoutines(routines, {
        longLevers: profile.longLevers,
        painLogs,
        weakLinks: { priorityRegions },
      });
    }
    return engine.auditWorkouts(workouts, {
      today,
      timeZone,
      longLevers: profile.longLevers,
      painLogs,
      weakLinks: { priorityRegions },
    });
  }, [source, hasRoutines, routines, workouts, today, timeZone, profile.longLevers, painLogs, priorityRegions]);

  const effectiveSource = source === "program" && !hasRoutines ? "week" : source;
  const scoreTone =
    report.totalScore >= 85
      ? "is-good"
      : report.totalScore >= 65
        ? "is-watch"
        : "is-alert";

  return (
    <section className="tel-card ha-card" aria-label="Аудит гипертрофии и SFR">
      <div className="ha-head">
        <div className="ha-title-group">
          <span className="tel-eyebrow-pill">
            <Layers size={14} aria-hidden="true" />
            Ядро v3 · Регионы и SFR
          </span>
          <h2>Аудит гипертрофии</h2>
        </div>

        <div className="ha-head-right">
          {profile.longLevers ? (
            <span className="wl-meta-chip is-biomech">
              <Sparkles size={12} aria-hidden="true" />
              SFR рычагов
            </span>
          ) : null}
          {hasRoutines ? (
            <div className="sf-sex-toggle" role="group" aria-label="Источник аудита">
              <button
                type="button"
                className={effectiveSource === "week" ? "is-active" : ""}
                aria-pressed={effectiveSource === "week"}
                onClick={() => setSource("week")}
              >
                7 дн.
              </button>
              <button
                type="button"
                className={effectiveSource === "program" ? "is-active" : ""}
                aria-pressed={effectiveSource === "program"}
                onClick={() => setSource("program")}
              >
                План
              </button>
            </div>
          ) : null}
        </div>
      </div>

      {report.totalSets === 0 ? (
        <div className="ha-empty">
          <Layers size={18} aria-hidden="true" />
          <span>
            {effectiveSource === "week"
              ? "За последние 7 дней нет завершённых рабочих подходов. Запиши тренировку или переключись на «План»."
              : "Добавь упражнения в программу — аудит сразу проверит 18 регионов и SFR."}
          </span>
        </div>
      ) : (
        <>
          {/* Главная полоса: общий балл + 4 субиндекса */}
          <div className="ha-score-grid">
            <div className={`ha-total-box ${scoreTone}`}>
              <span className="ha-total-label">Индекс качества</span>
              <strong className="ha-total-num">
                {fmt(report.totalScore)}
                <small>/100</small>
              </strong>
              <span className="ha-total-sub">{report.totalSets} раб. подх.</span>
            </div>

            <div className="ha-submetrics">
              <div className="ha-sub-row">
                <div className="ha-sub-meta">
                  <span>Покрытие 18 регионов</span>
                  <b>{fmt(report.regionalCoverageScore)}%</b>
                </div>
                <div className="ha-bar" aria-hidden="true">
                  <span style={{ width: `${Math.min(100, report.regionalCoverageScore)}%` }} />
                </div>
              </div>

              <div className="ha-sub-row">
                <div className="ha-sub-meta">
                  <span>Стимул в растяжении (цель 45–70%)</span>
                  <b>{fmt(report.stretchStimulusShare)}%</b>
                </div>
                <div className="ha-bar" aria-hidden="true">
                  <span style={{ width: `${Math.min(100, report.stretchMetricScore)}%` }} />
                </div>
              </div>

              <div className="ha-sub-row">
                <div className="ha-sub-meta">
                  <span>Средний SFR</span>
                  <b>{fmt(report.averageSfr)} / 10</b>
                </div>
                <div className="ha-bar" aria-hidden="true">
                  <span style={{ width: `${Math.min(100, report.sfrScore)}%` }} />
                </div>
              </div>

              <div className="ha-sub-row">
                <div className="ha-sub-meta">
                  <span>Защита суставов (JointGuard)</span>
                  <b>{fmt(report.jointSafetyScore)}%</b>
                </div>
                <div className="ha-bar is-safety" aria-hidden="true">
                  <span style={{ width: `${Math.min(100, report.jointSafetyScore)}%` }} />
                </div>
              </div>
            </div>
          </div>

          {/* Слепые зоны */}
          {report.blindSpots.length > 0 ? (
            <div className="ha-blindspots">
              <div className="ha-section-label">
                <AlertCircle size={14} aria-hidden="true" />
                <span>Слепые зоны ({report.blindSpots.length} из 18)</span>
              </div>
              <div className="ha-chip-wrap">
                {report.blindSpots.slice(0, 8).map((bs) => (
                  <span
                    key={bs.region}
                    className={`ha-bs-chip${bs.isWeakLinkPriority ? " is-priority" : ""}`}
                    title={bs.isWeakLinkPriority ? "Приоритет от детектора слабых звеньев" : undefined}
                  >
                    {REGION_META[bs.region].label}
                    <b>
                      {fmt(bs.volume)}/{fmt(bs.threshold)}
                    </b>
                  </span>
                ))}
              </div>
            </div>
          ) : (
            <div className="ha-perfect-banner">
              <CheckCircle2 size={16} aria-hidden="true" />
              <span>Все 18 гипертрофических регионов закрыты выше порога MEV!</span>
            </div>
          )}

          {/* Топ-3 безопасных улучшения */}
          {report.recommendations.length > 0 ? (
            <div className="ha-recs">
              <div className="ha-section-label">
                <ShieldCheck size={14} aria-hidden="true" />
                <span>Топ-{report.recommendations.length} безопасных улучшений</span>
              </div>
              <div className="ha-rec-list">
                {report.recommendations.map((rec, idx) => {
                  const addName = exerciseById(rec.addExerciseId)?.name ?? rec.addExerciseId;
                  const remName = rec.removeExerciseId
                    ? (exerciseById(rec.removeExerciseId)?.name ?? rec.removeExerciseId)
                    : null;
                  return (
                    <div className={`ha-rec-card is-${rec.type}`} key={`${rec.addExerciseId}-${idx}`}>
                      <div className="ha-rec-head">
                        <span className={`ha-rec-badge is-${rec.type}`}>
                          {rec.type === "joint_safety"
                            ? "Суставы"
                            : rec.type === "improve_sfr"
                              ? "SFR"
                              : "Регион"}
                        </span>
                        <div className="ha-rec-title">
                          {remName ? (
                            <>
                              <span className="ha-rec-old">{remName}</span>
                              <ArrowRight size={13} aria-hidden="true" />
                            </>
                          ) : (
                            <span className="ha-rec-plus">+ </span>
                          )}
                          {onOpenExerciseDetail ? (
                            <button
                              type="button"
                              className="ha-rec-link"
                              onClick={() => onOpenExerciseDetail(rec.addExerciseId)}
                            >
                              {addName}
                            </button>
                          ) : (
                            <strong>{addName}</strong>
                          )}
                        </div>
                      </div>
                      <p className="ha-rec-reason">{rec.reason}</p>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
