import { useMemo, useState } from "react";
import { Award, ChevronRight, Minus, Plus, Sparkles, Target, TrendingUp } from "lucide-react";
import {
  StrengthForecast,
  type BiologicalSex,
  type LiftForecast,
} from "../domain/StrengthForecast";
import { BiomechanicsProfileStore } from "../domain/BiomechanicsProfile";
import type { BigLiftId } from "../domain/StrengthTotal";
import { DateText } from "../domain/DateText";
import { fmt, type Workout } from "../lib/model";

const SEX_STORAGE_KEY = "tyaga-dots-sex-v1";
const TARGETS_STORAGE_KEY = "tyaga-lift-targets-v1";
const LIFT_ORDER: readonly BigLiftId[] = ["bench", "squat", "deadlift", "ohp"];

function readSavedSex(): BiologicalSex {
  try {
    return localStorage.getItem(SEX_STORAGE_KEY) === "female" ? "female" : "male";
  } catch {
    return "male";
  }
}

function readSavedTargets(): Partial<Record<BigLiftId, number>> {
  try {
    const raw = localStorage.getItem(TARGETS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: Partial<Record<BigLiftId, number>> = {};
    for (const id of LIFT_ORDER) {
      const v = parsed?.[id];
      if (typeof v === "number" && Number.isFinite(v) && v >= 20 && v <= 500) {
        out[id] = v;
      }
    }
    return out;
  } catch {
    return {};
  }
}

function ForecastMiniChart({ lift }: { lift: LiftForecast }) {
  const history = lift.history;
  const projection = lift.projection;
  if (history.length < 2) {
    return (
      <div className="sf-chart-empty">
        Запиши минимум 2 тренировки в разные недели для линии прогноза
      </div>
    );
  }

  const W = 320;
  const H = 112;
  const padL = 34;
  const padR = 12;
  const padT = 14;
  const padB = 20;

  const allPoints = [...history, ...projection.slice(1)];
  const times = allPoints.map((p) => Date.parse(`${p.date}T12:00:00Z`));
  const minT = Math.min(...times);
  const maxT = Math.max(...times);
  const spanT = Math.max(1, maxT - minT);

  const values = allPoints.map((p) => p.e1rm).concat(lift.targetKg);
  const minV = Math.max(0, Math.min(...values) - 5);
  const maxV = Math.max(...values) + 5;
  const spanV = Math.max(1, maxV - minV);

  const sx = (date: string) =>
    padL + ((Date.parse(`${date}T12:00:00Z`) - minT) / spanT) * (W - padL - padR);
  const sy = (val: number) => padT + (1 - (val - minV) / spanV) * (H - padT - padB);

  const histPath = history
    .map((p, i) => `${i === 0 ? "M" : "L"}${sx(p.date).toFixed(1)},${sy(p.e1rm).toFixed(1)}`)
    .join(" ");

  const projPath =
    projection.length >= 2
      ? projection
          .map((p, i) => `${i === 0 ? "M" : "L"}${sx(p.date).toFixed(1)},${sy(p.e1rm).toFixed(1)}`)
          .join(" ")
      : "";

  const targetY = sy(lift.targetKg);
  const lastHist = history[history.length - 1];
  const lastProj = projection.length >= 2 ? projection[projection.length - 1] : null;

  return (
    <svg
      className="sf-mini-chart"
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={`Прогноз e1RM для «${lift.label}»: цель ${fmt(lift.targetKg)} кг`}
    >
      {/* Линия цели */}
      <line
        x1={padL}
        x2={W - padR}
        y1={targetY}
        y2={targetY}
        className="sf-target-line"
        strokeDasharray="4 4"
      />
      <text x={padL - 4} y={targetY + 3} textAnchor="end" className="sf-axis-label is-target">
        {Math.round(lift.targetKg)}
      </text>
      <text x={padL - 4} y={H - padB + 3} textAnchor="end" className="sf-axis-label">
        {Math.round(minV)}
      </text>

      {/* Историческая кривая */}
      <path d={histPath} className="sf-hist-line" fill="none" />
      {history.map((p) => (
        <circle
          key={p.date}
          cx={sx(p.date)}
          cy={sy(p.e1rm)}
          r={2.5}
          className="sf-hist-dot"
        />
      ))}

      {/* Пунктирный прогноз */}
      {projPath ? <path d={projPath} className="sf-proj-line" fill="none" strokeDasharray="5 4" /> : null}
      {lastProj ? (
        <circle cx={sx(lastProj.date)} cy={sy(lastProj.e1rm)} r={3.5} className="sf-proj-dot" />
      ) : null}

      {/* Подписи дат */}
      <text x={sx(history[0].date)} y={H - 4} textAnchor="start" className="sf-axis-label">
        {DateText.day(history[0].date)}
      </text>
      <text x={sx(lastHist.date)} y={H - 4} textAnchor="middle" className="sf-axis-label">
        сейчас
      </text>
      {lastProj ? (
        <text x={W - padR} y={H - 4} textAnchor="end" className="sf-axis-label is-target">
          {DateText.day(lastProj.date)}
        </text>
      ) : null}
    </svg>
  );
}

type Props = {
  workouts: Workout[];
  timeZone?: string;
  bodyMassKg?: number | null;
  onOpenLift?: (progressKey: string) => void;
};

/**
 * Карточка #5: индекс относительной силы DOTS / Wilks + разрядный прогресс
 * и интерактивный прогноз дат достижения целевых рекордов по базовым движениям.
 */
export default function StrengthForecastCard({
  workouts,
  timeZone,
  bodyMassKg,
  onOpenLift,
}: Props) {
  const [sex, setSex] = useState<BiologicalSex>(readSavedSex);
  const [targets, setTargets] = useState<Partial<Record<BigLiftId, number>>>(readSavedTargets);
  const [selectedLift, setSelectedLift] = useState<BigLiftId>("bench");

  const profile = useMemo(() => BiomechanicsProfileStore.read(), []);

  const report = useMemo(
    () =>
      new StrengthForecast(workouts, {
        timeZone,
        bodyMassKg,
        sex,
        longLevers: profile.longLevers,
      }).build(targets),
    [workouts, timeZone, bodyMassKg, sex, profile.longLevers, targets],
  );

  const changeSex = (next: BiologicalSex) => {
    setSex(next);
    try {
      localStorage.setItem(SEX_STORAGE_KEY, next);
    } catch {
      // ignore
    }
  };

  const stepTarget = (id: BigLiftId, delta: number) => {
    const base = report.lifts[id].targetKg;
    const nextVal = Math.max(25, Math.min(400, Math.round((base + delta) / 2.5) * 2.5));
    setTargets((prev) => {
      const updated = { ...prev, [id]: nextVal };
      try {
        localStorage.setItem(TARGETS_STORAGE_KEY, JSON.stringify(updated));
      } catch {
        // ignore
      }
      return updated;
    });
  };

  const activeLift = report.lifts[selectedLift];
  const { dots } = report;

  return (
    <section className="tel-card strength-forecast-card" aria-label="Прогноз рекордов и индекс DOTS">
      <div className="sf-head">
        <div className="sf-title-group">
          <span className="tel-eyebrow-pill">
            <Award size={14} aria-hidden="true" />
            DOTS · Прогноз рекордов
          </span>
          <h2>Разряд и сроки целей</h2>
        </div>

        <div className="sf-sex-toggle" role="group" aria-label="Шкала DOTS">
          <button
            type="button"
            className={sex === "male" ? "is-active" : ""}
            aria-pressed={sex === "male"}
            onClick={() => changeSex("male")}
          >
            М
          </button>
          <button
            type="button"
            className={sex === "female" ? "is-active" : ""}
            aria-pressed={sex === "female"}
            onClick={() => changeSex("female")}
          >
            Ж
          </button>
        </div>
      </div>

      {/* Блок DOTS / Wilks / Разряд */}
      <div className="sf-dots-box">
        {dots.dots !== null && dots.tier ? (
          <>
            <div className="sf-dots-top">
              <div className="sf-dots-numbers">
                <strong className="sf-dots-score">
                  {fmt(dots.dots)}
                  <small> DOTS</small>
                </strong>
                {dots.wilks !== null ? (
                  <span className="sf-dots-sub-pill">Wilks {fmt(dots.wilks)}</span>
                ) : null}
                {dots.longLeversBonusPct > 0 && dots.adjustedDots !== null ? (
                  <span
                    className="sf-dots-sub-pill is-biomech"
                    title="Поправка +4% на увеличенную амплитуду при длинных рычагах"
                  >
                    <Sparkles size={12} aria-hidden="true" />
                    рычаги ≈ {fmt(dots.adjustedDots)}
                  </span>
                ) : null}
              </div>
              <span className={`sf-tier-badge is-${dots.tier.id}`}>{dots.tier.label}</span>
            </div>

            <div className="sf-tier-bar-wrap">
              <div className="sf-tier-meta">
                <span>
                  {dots.tier.nextLabel
                    ? `До «${dots.tier.nextLabel}» (${dots.tier.nextDots} DOTS)`
                    : "Максимальный разряд шкалы"}
                </span>
                <b>
                  {dots.tier.dotsToNext !== null ? `ещё ${fmt(dots.tier.dotsToNext)}` : "Элита"}
                </b>
              </div>
              <div className="sf-tier-track" aria-hidden="true">
                <span
                  className="sf-tier-fill"
                  style={{ width: `${Math.max(4, Math.round(dots.tier.progress * 100))}%` }}
                />
              </div>
            </div>
          </>
        ) : (
          <div className="sf-dots-empty">
            <Award size={18} aria-hidden="true" />
            <span>
              {report.total.totalKg <= 0
                ? "Запиши присед, жим и становую — посчитаем DOTS, Wilks и разряд."
                : "Укажи вес тела во вкладке «Вес тела» для расчёта DOTS и разряда."}
            </span>
          </div>
        )}
      </div>

      {/* Выбор базового движения */}
      <div className="sf-lift-tabs" role="tablist" aria-label="Базовые движения для прогноза">
        {LIFT_ORDER.map((id) => {
          const item = report.lifts[id];
          const isSelected = id === selectedLift;
          return (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={isSelected}
              className={`sf-lift-tab${isSelected ? " is-selected" : ""}`}
              onClick={() => setSelectedLift(id)}
            >
              <span className="sf-lift-tab-name">{item.short}</span>
              <strong className="sf-lift-tab-val">
                {item.currentE1rm !== null ? `${fmt(item.currentE1rm)}` : "—"}
              </strong>
              <span className={`sf-lift-tab-eta is-${item.status}`}>
                {item.status === "achieved"
                  ? "взято"
                  : item.status === "on_track" && item.etaWeeks !== null
                    ? `~${item.etaWeeks} нед.`
                    : item.status === "plateau"
                      ? "плато"
                      : "мало данных"}
              </span>
            </button>
          );
        })}
      </div>

      {/* Детали выбранного движения + настройка цели */}
      <div className="sf-detail">
        <div className="sf-detail-top">
          <div className="sf-target-control">
            <span className="sf-target-label">
              <Target size={14} aria-hidden="true" />
              Цель · {activeLift.label}
            </span>
            <div className="sf-target-stepper">
              <button
                type="button"
                className="sf-step-btn"
                aria-label={`Уменьшить цель ${activeLift.label} на 5 кг`}
                onClick={() => stepTarget(selectedLift, -5)}
              >
                <Minus size={14} aria-hidden="true" />
              </button>
              <strong className="sf-target-kg">{fmt(activeLift.targetKg)} кг</strong>
              <button
                type="button"
                className="sf-step-btn"
                aria-label={`Увеличить цель ${activeLift.label} на 5 кг`}
                onClick={() => stepTarget(selectedLift, 5)}
              >
                <Plus size={14} aria-hidden="true" />
              </button>
            </div>
          </div>

          <div className="sf-eta-summary">
            {activeLift.status === "achieved" ? (
              <span className="sf-eta-pill is-achieved">Цель уже пробита!</span>
            ) : activeLift.status === "on_track" && activeLift.etaDate && activeLift.etaWeeks ? (
              <>
                <span className="sf-eta-pill is-track">
                  ≈ {activeLift.etaWeeks} нед. · {DateText.day(activeLift.etaDate)}
                </span>
                <span className="sf-pace-note">
                  Темп {activeLift.weeklyRateKg !== null && activeLift.weeklyRateKg > 0 ? "+" : ""}
                  {activeLift.weeklyRateKg !== null ? fmt(activeLift.weeklyRateKg) : "0"} кг/нед
                </span>
              </>
            ) : activeLift.status === "plateau" ? (
              <>
                <span className="sf-eta-pill is-plateau">Плато — темп близок к нулю</span>
                <span className="sf-pace-note">Смени волну или добавь объём/разгрузку</span>
              </>
            ) : (
              <span className="sf-eta-pill is-muted">Нужно ≥2 записей с разницей от недели</span>
            )}
          </div>
        </div>

        <ForecastMiniChart lift={activeLift} />

        <div className="sf-detail-foot">
          <span className="sf-forecast-9w">
            <TrendingUp size={14} aria-hidden="true" />
            Через 9 нед. (1 мезоцикл):{" "}
            <b>
              {activeLift.projected9WeeksKg !== null
                ? `${fmt(activeLift.projected9WeeksKg)} кг`
                : "—"}
            </b>
          </span>

          {activeLift.progressKey && onOpenLift ? (
            <button
              type="button"
              className="text-button sf-open-btn"
              onClick={() => onOpenLift(activeLift.progressKey!)}
            >
              График
              <ChevronRight size={14} aria-hidden="true" />
            </button>
          ) : null}
        </div>
      </div>
    </section>
  );
}
