import { DELOAD_PRESETS, type DeloadMode } from "../domain/DeloadEngine";
import type { LaidWeekGuide } from "../domain/LaidDupPlan";

type Props = {
  laidGuide: LaidWeekGuide | null;
  inDeload: boolean;
  periodicDeloadRir: number | null;
  deloadNow?: DeloadMode;
};

/** Баннер текущей недели / фазы / разгрузки в верхней части активной тренировки. */
export default function WorkoutPhaseBanner({
  laidGuide,
  inDeload,
  periodicDeloadRir,
  deloadNow,
}: Props) {
  if (laidGuide) {
    return (
      <section
        className={`workout-phase-banner${inDeload || laidGuide.isDeloadWindow ? " is-deload" : ""}`}
        aria-label="Фаза и суть недели"
      >
        <div className="workout-phase-head">
          <span className="workout-phase-pill">
            Неделя {laidGuide.weekNumber} из {laidGuide.totalWeeks} · {laidGuide.badge}
          </span>
          <strong>{laidGuide.focusTitle}</strong>
        </div>
        <p className="workout-phase-summary">{laidGuide.summary}</p>
        <div className="workout-phase-chips">
          <span>{laidGuide.baseRir}</span>
          <span>{laidGuide.auxRir}</span>
          <span>{laidGuide.restSummary}</span>
        </div>
      </section>
    );
  }
  if (!inDeload) return null;
  return (
    <section className="workout-phase-banner is-deload" aria-label="Разгрузочная неделя">
      <div className="workout-phase-head">
        <span className="workout-phase-pill">Разгрузочная неделя</span>
        <strong>Снижаем веса и подходы — работаем с большим запасом</strong>
      </div>
      <p className="workout-phase-summary">
        Веса (включая тренажёры) снижены относительно обычной недели, подходы сокращены, целевой запас RIR{" "}
        {periodicDeloadRir ?? (deloadNow ? DELOAD_PRESETS[deloadNow].targetRir : "3–4")} — без отказа.
      </p>
    </section>
  );
}
