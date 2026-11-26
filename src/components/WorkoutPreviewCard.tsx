import { useMemo, useState } from "react";
import { Activity, ChevronDown, Flame, ShieldCheck, Sparkles, Zap } from "lucide-react";
import { WorkoutPreview, type PreviewMuscleImpact } from "../domain/WorkoutPreview";
import { fmt, type Muscle, type Workout } from "../lib/model";

type BodyMap = ReturnType<typeof WorkoutPreview.analyze>["bodyMap"];

function toneProps(bodyMap: BodyMap, muscle: Muscle) {
  const entry = bodyMap[muscle];
  if (!entry) return { className: "wprev-zone is-idle" };
  return {
    className: `wprev-zone is-${entry.level}`,
    style: { opacity: Math.max(0.38, entry.intensity) },
  };
}

/** Минималистичный силуэт спереди и сзади с подсветкой целевых и синергистских мышц тренировки. */
function MiniBodySilhouette({ bodyMap }: { bodyMap: BodyMap }) {
  return (
    <div className="wprev-silhouettes" aria-hidden="true">
      {/* Вид спереди */}
      <svg viewBox="0 0 88 156" className="wprev-body-svg">
        {/* Голова и шея */}
        <circle cx="44" cy="14" r="9.5" className="wprev-head" />
        <rect x="39" y="23" width="10" height="7" rx="3" className="wprev-head" />
        {/* Плечи */}
        <ellipse cx="22" cy="39" rx="7.5" ry="9" {...toneProps(bodyMap, "shoulders")} />
        <ellipse cx="66" cy="39" rx="7.5" ry="9" {...toneProps(bodyMap, "shoulders")} />
        {/* Грудь */}
        <path d="M29 33 C29 31 42 31 43 34 L43 50 C36 51 29 48 29 43 Z" {...toneProps(bodyMap, "chest")} />
        <path d="M59 33 C59 31 46 31 45 34 L45 50 C52 51 59 48 59 43 Z" {...toneProps(bodyMap, "chest")} />
        {/* Пресс / корпус */}
        <rect x="33" y="52" width="22" height="26" rx="6" {...toneProps(bodyMap, "core")} />
        {/* Бицепсы + предплечья */}
        <rect x="14" y="47" width="9" height="23" rx="4.5" {...toneProps(bodyMap, "biceps")} />
        <rect x="65" y="47" width="9" height="23" rx="4.5" {...toneProps(bodyMap, "biceps")} />
        <rect x="12" y="72" width="7.5" height="20" rx="3.7" className="wprev-head" />
        <rect x="68.5" y="72" width="7.5" height="20" rx="3.7" className="wprev-head" />
        {/* Квадрицепсы */}
        <rect x="28" y="81" width="14" height="35" rx="7" {...toneProps(bodyMap, "quads")} />
        <rect x="46" y="81" width="14" height="35" rx="7" {...toneProps(bodyMap, "quads")} />
        {/* Икры спереди */}
        <rect x="30" y="119" width="10.5" height="28" rx="5" {...toneProps(bodyMap, "calves")} />
        <rect x="47.5" y="119" width="10.5" height="28" rx="5" {...toneProps(bodyMap, "calves")} />
      </svg>

      {/* Вид сзади */}
      <svg viewBox="0 0 88 156" className="wprev-body-svg">
        {/* Голова и шея */}
        <circle cx="44" cy="14" r="9.5" className="wprev-head" />
        <rect x="39" y="23" width="10" height="7" rx="3" className="wprev-head" />
        {/* Задние дельты */}
        <ellipse cx="22" cy="39" rx="7.5" ry="9" {...toneProps(bodyMap, "shoulders")} />
        <ellipse cx="66" cy="39" rx="7.5" ry="9" {...toneProps(bodyMap, "shoulders")} />
        {/* Спина (верх + широчайшие + разгибатели) */}
        <path d="M28 31 L60 31 L56 64 L32 64 Z" rx="6" {...toneProps(bodyMap, "back")} />
        {/* Трицепсы */}
        <rect x="14" y="47" width="9" height="23" rx="4.5" {...toneProps(bodyMap, "triceps")} />
        <rect x="65" y="47" width="9" height="23" rx="4.5" {...toneProps(bodyMap, "triceps")} />
        <rect x="12" y="72" width="7.5" height="20" rx="3.7" className="wprev-head" />
        <rect x="68.5" y="72" width="7.5" height="20" rx="3.7" className="wprev-head" />
        {/* Ягодицы */}
        <ellipse cx="36" cy="76" rx="9" ry="10" {...toneProps(bodyMap, "glutes")} />
        <ellipse cx="52" cy="76" rx="9" ry="10" {...toneProps(bodyMap, "glutes")} />
        {/* Бицепс бедра */}
        <rect x="28" y="86" width="14" height="30" rx="7" {...toneProps(bodyMap, "hamstrings")} />
        <rect x="46" y="86" width="14" height="30" rx="7" {...toneProps(bodyMap, "hamstrings")} />
        {/* Икры */}
        <rect x="30" y="119" width="10.5" height="28" rx="5" {...toneProps(bodyMap, "calves")} />
        <rect x="47.5" y="119" width="10.5" height="28" rx="5" {...toneProps(bodyMap, "calves")} />
      </svg>
    </div>
  );
}

function phaseTone(phase: PreviewMuscleImpact["phaseAfter"]): string {
  if (phase === "optimal_growth" || phase === "min_growth") return "is-growth";
  if (phase === "overreaching") return "is-over";
  if (phase === "high_volume") return "is-high";
  return "is-base";
}

export default function WorkoutPreviewCard({
  planned,
  history,
  today,
  timeZone,
  bodyMassKg,
}: {
  planned: Workout;
  history: Workout[];
  today: string;
  timeZone?: string;
  bodyMassKg?: number | null;
}) {
  const [showAllMuscles, setShowAllMuscles] = useState(false);

  const analysis = useMemo(
    () => WorkoutPreview.analyze(planned, history, today, timeZone, { bodyMassKg }),
    [planned, history, today, timeZone, bodyMassKg],
  );

  if (analysis.muscles.length === 0) return null;

  const visibleMuscles = showAllMuscles ? analysis.muscles : analysis.muscles.slice(0, 4);
  const hiddenCount = analysis.muscles.length - visibleMuscles.length;

  return (
    <div className="wprev-card" aria-label="Превью тренировки: мышцы и недельный объём">
      <div className="wprev-top">
        <MiniBodySilhouette bodyMap={analysis.bodyMap} />
        <div className="wprev-summary">
          <div className="wprev-eyebrow">
            <Sparkles size={13} aria-hidden="true" />
            <span>Превью нагрузки</span>
          </div>
          <div className="wprev-chips">
            <span className={`wprev-chip tier-${analysis.axialTier}`}>
              <Activity size={13} aria-hidden="true" />
              Осевая {analysis.axialBeforePct}% → {analysis.axialAfterPct}%
            </span>
            {analysis.estimatedTonnageKg >= 400 ? (
              <span className="wprev-chip">
                <Zap size={13} aria-hidden="true" />
                ~{fmt(Math.round(analysis.estimatedTonnageKg / 100) / 10)} т
                {analysis.tonnageComparison ? ` · ${analysis.tonnageComparison}` : ""}
              </span>
            ) : (
              <span className="wprev-chip">
                <Flame size={13} aria-hidden="true" />
                ~{analysis.estKcal} ккал · база {analysis.compoundSharePct}%
              </span>
            )}
            <span
              className={`wprev-chip${analysis.lowestTargetReadiness ? " is-caution" : " is-ready"}`}
            >
              <ShieldCheck size={13} aria-hidden="true" />
              {analysis.lowestTargetReadiness
                ? `${analysis.lowestTargetReadiness.name} ${analysis.lowestTargetReadiness.pct}%`
                : `Целевые свежие · ${analysis.avgTargetReadinessPct}%`}
            </span>
          </div>
          <p className="wprev-sub">
            {analysis.axialTierLabel} · ~{analysis.estKcal} ккал · база {analysis.compoundSharePct}%
          </p>
        </div>
      </div>

      <div className="wprev-muscles" role="list" aria-label="Вклад в недельный объём по мышцам">
        {visibleMuscles.map((m) => {
          const scaleMax = Math.max(m.mrv, m.afterSets, 12);
          const beforePct = Math.min(100, (m.beforeSets / scaleMax) * 100);
          const addedPct = Math.min(100 - beforePct, (m.addedSets / scaleMax) * 100);
          const mevPct = Math.min(96, (m.mev / scaleMax) * 100);
          return (
            <div key={m.muscle} className="wprev-muscle-row" role="listitem">
              <div className="wprev-muscle-head">
                <span className="wprev-muscle-name">
                  <b>{m.name}</b>
                  {m.role === "secondary" ? <small>помощь</small> : null}
                  {m.readinessPct < 75 ? (
                    <small className="is-tired">{m.readinessPct}%</small>
                  ) : null}
                </span>
                <span className="wprev-muscle-nums">
                  <em className="wprev-added">+{fmt(m.addedSets)}</em>
                  <span>
                    {fmt(m.beforeSets)} → <b>{fmt(m.afterSets)}</b>/{m.mavHigh}
                  </span>
                  <span className={`wprev-phase ${phaseTone(m.phaseAfter)}`}>
                    {m.phaseLabelAfter}
                  </span>
                </span>
              </div>
              <div className="wprev-bar-track" aria-hidden="true">
                <span className="wprev-bar-before" style={{ width: `${beforePct}%` }} />
                <span
                  className={`wprev-bar-added ${phaseTone(m.phaseAfter)}`}
                  style={{ left: `${beforePct}%`, width: `${addedPct}%` }}
                />
                <span
                  className="wprev-bar-mev"
                  style={{ left: `${mevPct}%` }}
                  title={`MEV ${m.mev} подх./нед`}
                />
              </div>
            </div>
          );
        })}
      </div>

      {hiddenCount > 0 || showAllMuscles ? (
        <button
          type="button"
          className="text-button wprev-toggle"
          aria-expanded={showAllMuscles}
          onClick={() => setShowAllMuscles((v) => !v)}
        >
          <span>{showAllMuscles ? "Свернуть мышцы" : `Ещё ${hiddenCount} мышц в работе`}</span>
          <ChevronDown
            size={15}
            aria-hidden="true"
            style={{
              transform: showAllMuscles ? "rotate(180deg)" : undefined,
              transition: "transform 160ms ease",
            }}
          />
        </button>
      ) : null}
    </div>
  );
}
