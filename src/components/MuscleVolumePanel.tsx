import { useMemo, useState, type ReactNode } from "react";
import { AnimatePresence, m, useReducedMotion } from "motion/react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Flame,
  Info,
  ShieldAlert,
  TrendingUp,
} from "lucide-react";
import { VolumeLandmarksCalculator, type VolumePhase } from "../domain/VolumeLandmarks";
import { fmt, type Muscle, type MuscleLoad } from "../lib/model";
import Select from "./Select";
import "../styles/progress.css";

const GAUGE_R = 46;
const GAUGE_C = 2 * Math.PI * GAUGE_R;

type PhaseFilter = "all" | "growth" | "maintenance" | "low" | "high";

const PHASE_FILTERS: Array<{ id: PhaseFilter; label: string }> = [
  { id: "all", label: "Все мышцы" },
  { id: "growth", label: "Набор массы" },
  { id: "maintenance", label: "Поддержка" },
  { id: "low", label: "Мало / пусто" },
  { id: "high", label: "Высокий объём" },
];

function filterMatches(phase: VolumePhase, filter: PhaseFilter): boolean {
  if (filter === "all") return true;
  if (filter === "growth") return phase === "min_growth" || phase === "optimal_growth";
  if (filter === "maintenance") return phase === "maintenance";
  if (filter === "low") return phase === "no_sets" || phase === "below_mv";
  return phase === "high_volume" || phase === "overreaching";
}

export default function MuscleVolumePanel({
  loads,
  anatomy,
  selectedMuscle,
  onSelectMuscle,
  hardSetsOnly,
  onHardSetsChange,
  hasLegacy,
  mapping,
  onMappingChange,
  unmarkedNote,
  weekOffset = 0,
}: {
  loads: MuscleLoad[];
  anatomy: Array<{ id: string; name: string; zone: Muscle; direct: number; assisting: number; stabilizing: number }>;
  selectedMuscle: Muscle | null;
  onSelectMuscle: (m: Muscle | null) => void;
  hardSetsOnly: boolean;
  onHardSetsChange: (value: boolean) => void;
  hasLegacy: boolean;
  mapping: "recorded" | "current";
  onMappingChange: (value: "recorded" | "current") => void;
  unmarkedNote?: ReactNode;
  weekOffset?: number;
}) {
  const reduced = useReducedMotion();
  const [filter, setFilter] = useState<PhaseFilter>("all");

  const rows = useMemo(() => {
    const assessed = VolumeLandmarksCalculator.assessWeeklyLoads(loads);
    return loads.map((load, i) => ({
      load,
      assessment: assessed[i],
    }));
  }, [loads]);

  const counts = useMemo(() => {
    let growth = 0;
    let maintenance = 0;
    let low = 0;
    let high = 0;
    let overreaching = 0;
    for (const r of rows) {
      const p = r.assessment.phase;
      if (p === "min_growth" || p === "optimal_growth") growth += 1;
      else if (p === "maintenance") maintenance += 1;
      else if (p === "no_sets" || p === "below_mv") low += 1;
      else {
        high += 1;
        if (p === "overreaching") overreaching += 1;
      }
    }
    return { growth, maintenance, low, high, overreaching };
  }, [rows]);

  const totalEffective = useMemo(
    () => rows.reduce((sum, r) => sum + r.assessment.actualSets, 0),
    [rows],
  );
  const totalGoal = useMemo(() => loads.reduce((sum, m) => sum + m.goal, 0), [loads]);
  const totalCredited = useMemo(
    () => loads.reduce((sum, m) => sum + Math.min(m.direct + m.indirect * 0.5, m.goal), 0),
    [loads],
  );

  const activeZones = rows.filter((r) => r.assessment.actualSets > 0).length;
  const ringRatio = rows.length ? (counts.growth + counts.high * 0.6 + counts.maintenance * 0.35) / rows.length : 0;
  const gaugeOffset = GAUGE_C * (1 - Math.min(1, ringRatio));

  const heroStatus =
    counts.overreaching > 0
      ? "overloaded"
      : counts.growth >= 5
        ? "optimal"
        : "default";

  const heroHeadline =
    activeZones === 0
      ? hardSetsOnly
        ? "В выбранной неделе нет рабочих подходов с RIR ≤ 3"
        : weekOffset < 0
          ? "На выбранной неделе подходов не было"
          : "На этой неделе подходов пока нет"
      : counts.overreaching > 0
        ? `Перегруз в ${counts.overreaching} ${counts.overreaching === 1 ? "зоне" : "зонах"} — следи за восстановлением`
        : counts.high > 0
          ? `Высокий объём в ${counts.high} ${counts.high === 1 ? "зоне" : "зонах"} — близко к MRV`
          : counts.growth >= 6
            ? `Отличный недельный объём — ${counts.growth} из ${rows.length} групп в зоне роста`
            : counts.growth > 0
              ? `${counts.growth} из ${rows.length} групп в наборе массы, ещё ${counts.maintenance} на поддержке`
              : counts.maintenance > 0
                ? `${counts.maintenance} групп на поддержке массы — добавь подходов для роста`
                : `Есть работа в ${activeZones} ${activeZones === 1 ? "группе" : "группах"}, пока ниже порога поддержки (MV)`;

  const visibleRows = useMemo(
    () => rows.filter((r) => filterMatches(r.assessment.phase, filter)),
    [rows, filter],
  );

  return (
    <div className="tel-panel">
      {/* Hero сводка в стиле ИИ-анализа */}
      <m.section
        className={`coach-hero status-${heroStatus}`}
        aria-labelledby="zones-title"
        initial={reduced ? false : { opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
      >
        <div className="coach-gauge" aria-label={`В зоне роста ${counts.growth} из ${rows.length} мышечных групп`}>
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
              transition={reduced ? { duration: 0 } : { duration: 0.65, ease: [0.22, 1, 0.36, 1] }}
            />
          </svg>
          <div className="coach-gauge-center">
            <strong>
              {counts.growth}/{rows.length}
            </strong>
            <span>в росте</span>
          </div>
        </div>

        <div className="coach-hero-copy">
          <span className="coach-status-pill">
            <Activity size={14} aria-hidden="true" />
            Недельный объём · RP / Schoenfeld
          </span>
          <h2 id="zones-title">{heroHeadline}</h2>
          <div className="coach-next-chip">
            <b>{fmt(totalCredited)} / {totalGoal}</b>
            <span>экв. подх. (сумма целей 10 мышц · прямые + 0,5 косв. · всего {fmt(totalEffective)})</span>
          </div>
          {unmarkedNote}
        </div>
      </m.section>

      {/* 4 карточки телеметрии по фазам */}
      <section className="tel-metric-grid" aria-label="Сводка фаз объёма">
        <article className="tel-metric-card is-accent">
          <span className="tel-metric-label">
            <TrendingUp size={13} aria-hidden="true" />
            Набор массы
          </span>
          <b className="tel-metric-val">
            {counts.growth} <small>из {rows.length}</small>
          </b>
          <span className="tel-metric-sub">Диапазон MEV–MAV</span>
        </article>
        <article className="tel-metric-card">
          <span className="tel-metric-label">
            <CheckCircle2 size={13} aria-hidden="true" />
            Поддержка (MV)
          </span>
          <b className="tel-metric-val">{counts.maintenance}</b>
          <span className="tel-metric-sub">Удержание текущей массы</span>
        </article>
        <article className="tel-metric-card">
          <span className="tel-metric-label">
            <Flame size={13} aria-hidden="true" />
            Мало / нет работы
          </span>
          <b className="tel-metric-val">{counts.low}</b>
          <span className="tel-metric-sub">Ниже порога MV</span>
        </article>
        <article className="tel-metric-card">
          <span className="tel-metric-label">
            <ShieldAlert size={13} aria-hidden="true" />
            Высокий / перегруз
          </span>
          <b className="tel-metric-val">{counts.high}</b>
          <span className="tel-metric-sub">Близко или выше MRV</span>
        </article>
      </section>

      {/* Фильтры */}
      <div className="mv-controls">
        <div className="tel-pill-row" role="tablist" aria-label="Фильтр по статусу мышц">
          {PHASE_FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              role="tab"
              aria-selected={filter === f.id}
              className={`tel-pill-btn${filter === f.id ? " active" : ""}`}
              onClick={() => setFilter(f.id)}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="analysis-controls">
          <label className="chip-toggle">
            <input
              type="checkbox"
              checked={hardSetsOnly}
              onChange={(e) => onHardSetsChange(e.target.checked)}
            />
            Только RIR ≤ 3
          </label>
          {hasLegacy ? (
            <label>
              Разметка
              <Select
                value={mapping}
                onChange={(v) => onMappingChange(v as "recorded" | "current")}
                options={[
                  { value: "recorded", label: "Сохранённые версии" },
                  { value: "current", label: "Пересчёт по каталогу 2" },
                ]}
              />
            </label>
          ) : null}
        </div>
      </div>

      {/* Карточки групп мышц со шкалой MV / MEV / MAV / MRV */}
      <div className="mv-list">
        {visibleRows.length === 0 ? (
          <div className="tel-card">
            <p className="mv-effect-line">В этой категории мышечных групп нет.</p>
          </div>
        ) : (
          visibleRows.map(({ load, assessment }) => {
            const b = assessment.bracket;
            const scaleMax = b.mrv + 4;
            const pct = (v: number) => `${Math.min(100, Math.max(0, (v / scaleMax) * 100))}%`;
            const isOpen = selectedMuscle === load.id;
            const musclesInZone = anatomy.filter((a) => a.zone === load.id);

            return (
              <article
                key={load.id}
                className={`mv-row-card${isOpen ? " is-open" : ""}`}
                style={{ "--mv-color": assessment.phaseColor } as React.CSSProperties}
              >
                <button
                  type="button"
                  className="mv-row-trigger"
                  aria-expanded={isOpen}
                  onClick={() => onSelectMuscle(isOpen ? null : load.id)}
                >
                  <div className="mv-row-top">
                    <div className="mv-row-title">
                      <strong>{load.short}</strong>
                      <span className="mv-phase-pill">
                        {assessment.phase === "overreaching" || assessment.phase === "high_volume" ? (
                          <AlertTriangle size={12} aria-hidden="true" />
                        ) : null}
                        {assessment.phaseLabel}
                      </span>
                    </div>
                    <div className="mv-row-nums">
                      <b>{fmt(assessment.actualSets)}</b>
                      <small>/ цель {load.goal} · опт. {b.mavLow}–{b.mavHigh}</small>
                      <ChevronDown
                        size={16}
                        aria-hidden="true"
                        style={{
                          marginLeft: 4,
                          transform: isOpen ? "rotate(180deg)" : "none",
                          transition: "transform 160ms ease",
                          color: "var(--ink-soft)",
                        }}
                      />
                    </div>
                  </div>

                  <div className="mv-scale-wrap">
                    <div className="mv-scale-track" aria-hidden="true">
                      <span
                        className="mv-scale-zone z-mv"
                        style={{ left: pct(b.mv), width: pct(b.mev - b.mv) }}
                      />
                      <span
                        className="mv-scale-zone z-mav"
                        style={{ left: pct(b.mev), width: pct(b.mavHigh - b.mev) }}
                      />
                      <span
                        className="mv-scale-zone z-over"
                        style={{ left: pct(b.mrv), width: pct(scaleMax - b.mrv) }}
                      />
                      <div
                        className="mv-scale-fill"
                        style={{ width: pct(assessment.actualSets) }}
                      />
                    </div>
                    <div className="mv-scale-ticks">
                      <span>Поддержка {b.mv}–{b.mev - 1}</span>
                      <span>Рост {b.mev}–{b.mavHigh}</span>
                      <span>Перегруз &gt;{b.mrv}</span>
                    </div>
                  </div>

                  <p className="mv-effect-line">{assessment.effectSummary}</p>
                </button>

                <AnimatePresence initial={false}>
                  {isOpen ? (
                    <m.div
                      className="mv-detail-body"
                      initial={reduced ? false : { opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={reduced ? undefined : { opacity: 0, y: -4 }}
                      transition={{ duration: 0.16 }}
                    >
                      <div className="mv-detail-chips">
                        <span className="mv-detail-chip">
                          Прямых: <b>{fmt(load.direct)}</b>
                        </span>
                        <span className="mv-detail-chip">
                          Косвенных (×0,5): <b>{fmt(load.indirect)}</b>
                        </span>
                        <span className="mv-detail-chip">
                          Стабилизация: <b>{fmt(load.stabilizing)}</b>
                        </span>
                        <span className="mv-detail-chip">
                          MV {b.mv} · MEV {b.mev} · MAV {b.mavLow}–{b.mavHigh} · MRV {b.mrv}
                        </span>
                      </div>

                      <p className="mv-detail-tip">{assessment.recommendation}</p>

                      {musclesInZone.length > 0 && (
                        <div className="mv-anatomy-list">
                          {musclesInZone.map((m) => (
                            <div key={m.id} className="mv-anatomy-row">
                              <span>{m.name}</span>
                              <small>
                                {m.direct} прям. · {m.assisting} косв. · {m.stabilizing} стаб.
                              </small>
                            </div>
                          ))}
                        </div>
                      )}
                      {hasLegacy ? (
                        <p className="tiny">У записей каталога 1 нет разметки отдельных мышц.</p>
                      ) : null}
                    </m.div>
                  ) : null}
                </AnimatePresence>
              </article>
            );
          })
        )}
      </div>

      {/* Компактная легенда ориентиров */}
      <div className="mv-legend-bar" aria-label="Обозначения зон объёма">
        <span className="mv-legend-item">
          <i className="mv-legend-dot" style={{ background: "#94a3b8" }} />
          Ниже MV — риск отката
        </span>
        <span className="mv-legend-item">
          <i className="mv-legend-dot" style={{ background: "#38bdf8" }} />
          MV — поддержка массы
        </span>
        <span className="mv-legend-item">
          <i className="mv-legend-dot" style={{ background: "#4ade80" }} />
          MEV–MAV — набор массы
        </span>
        <span className="mv-legend-item">
          <i className="mv-legend-dot" style={{ background: "#f59e0b" }} />
          К MRV — высокий объём
        </span>
        <span className="mv-legend-item">
          <i className="mv-legend-dot" style={{ background: "#ef4444" }} />
          &gt; MRV — риск перетренировки
        </span>
        <span className="mv-legend-item">
          <Info size={13} aria-hidden="true" />
          Прямой = 1 · Косвенный = 0,5 · Разминка = 0
        </span>
      </div>
    </div>
  );
}
