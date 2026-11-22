import { useMemo, useState } from "react";
import { AnimatePresence, m, useReducedMotion } from "motion/react";
import { ChevronRight, Minus, Plus, RotateCcw, SlidersHorizontal, Trophy } from "lucide-react";
import { StrengthTotal, type BigLiftId, type StrengthTotalSummary } from "../domain/StrengthTotal";
import { fmt } from "../lib/model";

const BIG_THREE: BigLiftId[] = ["squat", "bench", "deadlift"];
const ALL_FOUR: BigLiftId[] = ["squat", "bench", "deadlift", "ohp"];

type Props = {
  summary: StrengthTotalSummary;
  bodyMassKg?: number | null;
  onOpenLift?: (progressKey: string) => void;
};

/**
 * Карточка силового тотала (Присед + Жим + Становая) с вехой прогресса
 * и интерактивным симулятором цели (±2,5 кг по базовым движениям).
 */
export default function StrengthTotalCard({ summary, bodyMassKg, onOpenLift }: Props) {
  const reduced = useReducedMotion();
  const [simulating, setSimulating] = useState(false);
  const [simValues, setSimValues] = useState<Record<"squat" | "bench" | "deadlift", number>>(() => ({
    squat: Math.round((summary.lifts.squat.e1rmKg ?? 100) / 2.5) * 2.5,
    bench: Math.round((summary.lifts.bench.e1rmKg ?? 80) / 2.5) * 2.5,
    deadlift: Math.round((summary.lifts.deadlift.e1rmKg ?? 140) / 2.5) * 2.5,
  }));

  const openSimulator = () => {
    setSimValues({
      squat: Math.round((summary.lifts.squat.e1rmKg ?? 100) / 2.5) * 2.5,
      bench: Math.round((summary.lifts.bench.e1rmKg ?? 80) / 2.5) * 2.5,
      deadlift: Math.round((summary.lifts.deadlift.e1rmKg ?? 140) / 2.5) * 2.5,
    });
    setSimulating(true);
  };

  const active = useMemo(() => {
    if (!simulating) return summary;
    const nextLifts = {
      ...summary.lifts,
      squat: { ...summary.lifts.squat, e1rmKg: simValues.squat },
      bench: { ...summary.lifts.bench, e1rmKg: simValues.bench },
      deadlift: { ...summary.lifts.deadlift, e1rmKg: simValues.deadlift },
    };
    return StrengthTotal.summarize(nextLifts, bodyMassKg);
  }, [bodyMassKg, simValues, simulating, summary]);

  const delta = simulating && summary.totalKg > 0
    ? Math.round((active.totalKg - summary.totalKg) * 10) / 10
    : null;

  const stepLift = (id: "squat" | "bench" | "deadlift", by: number) => {
    setSimValues((prev) => ({
      ...prev,
      [id]: Math.max(20, Math.min(400, Math.round((prev[id] + by) * 2) / 2)),
    }));
  };

  return (
    <section className="total-card" aria-label="Силовой тотал">
      <div className="total-card-head">
        <div className="total-hero">
          <span className="total-eyebrow">
            <Trophy size={14} aria-hidden="true" />
            {simulating ? "Симулятор тотала · Присед + Жим + Тяга" : "Тотал · Присед + Жим + Тяга"}
          </span>
          <div className="total-value-row">
            <strong className="total-number">
              {active.totalKg > 0 ? fmt(active.totalKg) : "—"}
              {active.totalKg > 0 ? <small> кг</small> : null}
            </strong>
            {active.relativeBw ? (
              <span className="total-badge">×{fmt(active.relativeBw)} веса тела</span>
            ) : null}
            {delta !== null && delta !== 0 ? (
              <span className={`total-delta${delta > 0 ? " is-up" : " is-down"}`}>
                {delta > 0 ? "+" : ""}{fmt(delta)} кг
              </span>
            ) : null}
          </div>
        </div>
        <button
          type="button"
          className={`total-sim-toggle${simulating ? " is-active" : ""}`}
          aria-pressed={simulating}
          onClick={() => (simulating ? setSimulating(false) : openSimulator())}
        >
          {simulating ? <RotateCcw size={15} aria-hidden="true" /> : <SlidersHorizontal size={15} aria-hidden="true" />}
          <span>{simulating ? "Факт" : "Прикинуть цель"}</span>
        </button>
      </div>

      {/* Прогресс до следующей вехи тотала */}
      <div className="total-milestone">
        <div className="total-milestone-meta">
          <span>Веха {active.milestone.nextKg} кг</span>
          <b>
            {active.totalKg > 0
              ? `ещё ${fmt(active.milestone.remainingKg)} кг`
              : "запиши базовые движения"}
          </b>
        </div>
        <div className="total-milestone-track" aria-hidden="true">
          <m.span
            className="total-milestone-fill"
            initial={reduced ? false : { scaleX: 0 }}
            animate={{ scaleX: active.totalKg > 0 ? active.milestone.ratio : 0 }}
            transition={{ duration: reduced ? 0 : 0.45, ease: [0.22, 1, 0.36, 1] }}
          />
        </div>
      </div>

      {/* Пропорция тройки */}
      {active.totalKg > 0 ? (
        <div className="total-split" aria-label="Доля движений в тотале">
          <div className="total-split-bar" aria-hidden="true">
            {active.shares.squat > 0 ? (
              <span className="seg-squat" style={{ flexGrow: active.shares.squat }} />
            ) : null}
            {active.shares.bench > 0 ? (
              <span className="seg-bench" style={{ flexGrow: active.shares.bench }} />
            ) : null}
            {active.shares.deadlift > 0 ? (
              <span className="seg-deadlift" style={{ flexGrow: active.shares.deadlift }} />
            ) : null}
          </div>
          <div className="total-split-legend">
            <span><i className="seg-squat" />Присед {active.shares.squat}%</span>
            <span><i className="seg-bench" />Жим {active.shares.bench}%</span>
            <span><i className="seg-deadlift" />Тяга {active.shares.deadlift}%</span>
          </div>
        </div>
      ) : null}

      <AnimatePresence mode="wait" initial={false}>
        {simulating ? (
          <m.div
            key="sim"
            className="total-sim-grid"
            initial={reduced ? false : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduced ? undefined : { opacity: 0, y: -4 }}
            transition={{ duration: 0.18 }}
          >
            {BIG_THREE.map((id) => {
              const lift = summary.lifts[id];
              const value = simValues[id as "squat" | "bench" | "deadlift"];
              return (
                <div className="total-sim-row" key={id}>
                  <div className="total-sim-head">
                    <label htmlFor={`sim-${id}`}>{lift.label}</label>
                    <b>{fmt(value)} кг</b>
                  </div>
                  <div className="total-sim-controls">
                    <button
                      type="button"
                      className="total-step-btn"
                      aria-label={`${lift.label} минус 2,5 кг`}
                      onClick={() => stepLift(id as "squat" | "bench" | "deadlift", -2.5)}
                    >
                      <Minus size={15} aria-hidden="true" />
                    </button>
                    <input
                      id={`sim-${id}`}
                      type="range"
                      min={20}
                      max={350}
                      step={2.5}
                      value={value}
                      onChange={(e) =>
                        setSimValues((prev) => ({
                          ...prev,
                          [id]: Number(e.target.value),
                        }))
                      }
                    />
                    <button
                      type="button"
                      className="total-step-btn"
                      aria-label={`${lift.label} плюс 2,5 кг`}
                      onClick={() => stepLift(id as "squat" | "bench" | "deadlift", 2.5)}
                    >
                      <Plus size={15} aria-hidden="true" />
                    </button>
                  </div>
                </div>
              );
            })}
          </m.div>
        ) : (
          <m.div
            key="facts"
            className="total-lifts-grid"
            initial={reduced ? false : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduced ? undefined : { opacity: 0, y: -4 }}
            transition={{ duration: 0.18 }}
          >
            {ALL_FOUR.map((id) => {
              const lift = summary.lifts[id];
              const clickable = !!lift.progressKey && !!onOpenLift;
              const Tag = clickable ? "button" : "div";
              return (
                <Tag
                  key={id}
                  {...(clickable
                    ? {
                        type: "button" as const,
                        onClick: () => onOpenLift!(lift.progressKey!),
                        "aria-label": `Динамика: ${lift.label}`,
                      }
                    : {})}
                  className={`total-lift-tile${clickable ? " is-link" : ""}${id === "ohp" ? " is-aux" : ""}`}
                >
                  <span className="total-lift-name">
                    {lift.short}
                    {clickable ? <ChevronRight size={14} aria-hidden="true" /> : null}
                  </span>
                  <strong>
                    {lift.e1rmKg !== null ? fmt(lift.e1rmKg) : "—"}
                    {lift.e1rmKg !== null ? <small> кг</small> : null}
                  </strong>
                  <span className="total-lift-sub">
                    {lift.bestWeightKg !== null && lift.bestReps !== null
                      ? `${fmt(lift.bestWeightKg)} × ${lift.bestReps}`
                      : "нет записей"}
                  </span>
                </Tag>
              );
            })}
          </m.div>
        )}
      </AnimatePresence>
    </section>
  );
}
