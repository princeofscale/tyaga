import { AnalyticsFacts } from "./AnalyticsFacts";
import { trailingWindow } from "../lib/calendar";
import { MUSCLES } from "../data/muscles";
import type { Muscle, MuscleLoad, Workout } from "../lib/types";
import { TrainingAnalytics, type AnalysisOptions } from "./TrainingAnalytics";

export interface VolumeLandmarkBracket {
  muscle: Muscle;
  muscleName: string;
  /** Maintenance Volume — минимум для удержания массы. */
  mv: number;
  /** Minimum Effective Volume — минимум для запуска роста. */
  mev: number;
  /** Нижняя граница оптимального диапазона гипертрофии (MAV). */
  mavLow: number;
  /** Верхняя граница оптимального диапазона гипертрофии (MAV). */
  mavHigh: number;
  /** Maximum Recoverable Volume — ориентировочный порог восстановления. */
  mrv: number;
  /** Совместимость со старым API: начало продуктивного диапазона роста (MEV). */
  referenceMin: number;
  /** Совместимость со старым API: верх продуктивного диапазона роста (MAV high). */
  referenceMax: number;
}

export type VolumeStatusKind =
  | "no_sets"
  | "below_reference"
  | "within_reference"
  | "above_reference";

export type VolumePhase =
  | "no_sets"
  | "below_mv"
  | "maintenance"
  | "min_growth"
  | "optimal_growth"
  | "high_volume"
  | "overreaching";

export interface MuscleVolumeAssessment {
  muscle: Muscle;
  muscleName: string;
  actualSets: number;
  directSets: number;
  indirectSets: number;
  bracket: VolumeLandmarkBracket;
  status: VolumeStatusKind;
  statusLabel: string;
  statusColor: string;
  /** Детальная физиологическая фаза объёма (MV / MEV / MAV / MRV). */
  phase: VolumePhase;
  phaseLabel: string;
  phaseShort: string;
  phaseColor: string;
  /** Понятный прогноз эффекта при сохранении текущего объёма. */
  effectSummary: string;
  recommendation: string;
  /** Процент заполнения шкалы до MRV (может быть > 100 при превышении). */
  progressPercent: number;
}

/**
 * Недельные ориентиры объёма (рабочие подходы/нед.: прямые + 0,5 × косвенные; разминка не считается).
 * Основано на мета-анализах Schoenfeld et al., Pelland et al. (дробный учёт косвенных подходов и убывающая отдача)
 * и ориентирах RP Hypertrophy (MV / MEV / MAV / MRV по группам мышц для среднего атлета).
 */
export class VolumeLandmarksCalculator {
  static getBracket(muscle: Muscle): VolumeLandmarkBracket {
    const zone = MUSCLES.find((m) => m.id === muscle)!;
    return {
      muscle,
      muscleName: zone.name,
      mv: zone.mv,
      mev: zone.mev,
      mavLow: zone.mavLow,
      mavHigh: zone.mavHigh,
      mrv: zone.mrv,
      referenceMin: zone.mev,
      referenceMax: zone.mavHigh,
    };
  }

  static assessMuscleVolume(muscle: Muscle, actualSets: number): MuscleVolumeAssessment {
    if (!Number.isFinite(actualSets) || actualSets < 0)
      throw new RangeError("Число подходов должно быть конечным и неотрицательным");

    const bracket = this.getBracket(muscle);
    const scaleMax = bracket.mrv + 4;
    const base = {
      muscle,
      muscleName: bracket.muscleName,
      actualSets,
      directSets: actualSets,
      indirectSets: 0,
      bracket,
      progressPercent: (actualSets / scaleMax) * 100,
    };

    if (actualSets === 0) {
      return {
        ...base,
        status: "no_sets",
        statusLabel: "Нет нагрузки",
        statusColor: "#7e8b91",
        phase: "no_sets",
        phaseLabel: "Нет нагрузки",
        phaseShort: "Пусто",
        phaseColor: "#7e8b91",
        effectSummary: "Нет стимула за неделю; при паузе дольше 2–3 недель начнётся детренировка.",
        recommendation: `Для удержания массы нужно от ${bracket.mv} подх./нед., для роста — от ${bracket.mev} подх./нед.`,
      };
    }

    if (actualSets < bracket.mv) {
      return {
        ...base,
        status: "below_reference",
        statusLabel: "Ниже поддержки",
        statusColor: "#94a3b8",
        phase: "below_mv",
        phaseLabel: "Ниже поддержки (< MV)",
        phaseShort: "< MV",
        phaseColor: "#94a3b8",
        effectSummary: "Объёма меньше порога удержания — при таком темпе возможен постепенный откат.",
        recommendation: `Добавь хотя бы до ${bracket.mv} трудных подходов для удержания массы или до ${bracket.mev} — чтобы запустить рост.`,
      };
    }

    if (actualSets < bracket.mev) {
      return {
        ...base,
        status: "below_reference",
        statusLabel: "Поддержка массы",
        statusColor: "#38bdf8",
        phase: "maintenance",
        phaseLabel: "Поддержка массы (MV)",
        phaseShort: "Поддержка",
        phaseColor: "#38bdf8",
        effectSummary: "Удержание текущей мышечной массы и силы без заметной гипертрофии.",
        recommendation: `Отлично для разгрузки или занятой недели. Чтобы мышца росла, подними объём до ${bracket.mev}–${bracket.mavLow} подх./нед. (рост возможен и ниже у новичков).`,
      };
    }

    if (actualSets < bracket.mavLow) {
      return {
        ...base,
        status: "within_reference",
        statusLabel: "Начальный рост",
        statusColor: "#22c55e",
        phase: "min_growth",
        phaseLabel: "Начальный рост (MEV)",
        phaseShort: "Старт роста",
        phaseColor: "#22c55e",
        effectSummary: "Минимально эффективный объём — запускает набор мышечной массы при хорошем качестве подходов (RIR 0–3).",
        recommendation: `Хорошая стартовая точка цикла. Если веса и повторы растут — оставайся здесь; если прогресс встал, добавь до ${bracket.mavLow}–${bracket.mavHigh} подх./нед.`,
      };
    }

    if (actualSets <= bracket.mavHigh) {
      return {
        ...base,
        status: "within_reference",
        statusLabel: "Набор массы",
        statusColor: "#4ade80",
        phase: "optimal_growth",
        phaseLabel: "Набор массы (MAV)",
        phaseShort: "Набор массы",
        phaseColor: "#4ade80",
        effectSummary: "Оптимальная зона гипертрофии — максимальная отдача на единицу усталости.",
        recommendation: "Держи этот диапазон, пока веса или повторения растут и восстановление в норме. Подходы должны быть близки к отказу (RIR 0–3).",
      };
    }

    if (actualSets <= bracket.mrv) {
      return {
        ...base,
        status: "above_reference",
        statusLabel: "Высокий объём",
        statusColor: "#f59e0b",
        phase: "high_volume",
        phaseLabel: "Предельный объём (к MRV)",
        phaseShort: "Высокий объём",
        phaseColor: "#f59e0b",
        effectSummary: "Рост возможен, но отдача падает, а локальная и системная усталость быстро накапливаются.",
        recommendation: `Оправдано в пиковую неделю перед разгрузкой. Следи за сном, суставами и рабочими весами — при спаде сразу сбавляй объём.`,
      };
    }

    return {
      ...base,
      status: "above_reference",
      statusLabel: "Риск перетренировки",
      statusColor: "#ef4444",
      phase: "overreaching",
      phaseLabel: "Риск перетренировки (> MRV)",
      phaseShort: "Перегруз",
      phaseColor: "#ef4444",
      effectSummary: "Выше среднего предела восстановления — риск перетренировки, падения силы и перегрузки связок.",
      recommendation: `Снизь объём до ${bracket.mavLow}–${bracket.mavHigh} подх./нед. или сделай разгрузочную неделю (~${bracket.mv} подх.). Само число подходов не определяет перетренированность, но при таком объёме восстановление обычно не успевает.`,
    };
  }

  static assessWeeklyLoads(loads: MuscleLoad[]): MuscleVolumeAssessment[] {
    return loads.map((load) => ({
      ...this.assessMuscleVolume(load.id, load.direct + load.indirect * 0.5),
      directSets: load.direct,
      indirectSets: load.indirect,
    }));
  }

  /** Always seven calendar dates ending today, independent of the atlas week/filter. */
  static assessWeek(workouts: Workout[], endDate: string, options: Pick<AnalysisOptions, "mapping" | "timeZone" | "now"> = {}) {
    const startDate = trailingWindow(endDate, 7).from;
    const selected = new AnalyticsFacts(workouts, { ...options, from: startDate, through: endDate }).workouts();
    const loads = new TrainingAnalytics(selected, options).zoneLoad();
    const hardLoads = new TrainingAnalytics(selected, { ...options, maxRir: 3 }).zoneLoad();
    const sets = selected.flatMap((w) => w.exercises.flatMap((e) => e.sets))
      .filter((s) => s.done && !s.warmup);
    return {
      startDate,
      endDate,
      workingSets: sets.length,
      unknownRirSets: sets.filter((s) => s.rir === null).length,
      assessments: this.assessWeeklyLoads(loads).map((row, i) => ({
        ...row,
        knownHardSets: hardLoads[i].direct + hardLoads[i].indirect * 0.5,
      })),
    };
  }
}
