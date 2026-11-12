import { MUSCLES } from "../data/muscles";
import { addCalendarDays } from "../lib/calendar";
import type { Muscle, MuscleLoad, Workout } from "../lib/types";
import { TrainingAnalytics, type AnalysisOptions } from "./TrainingAnalytics";

export interface VolumeLandmarkBracket {
  muscle: Muscle;
  muscleName: string;
  referenceMin: number;
  referenceMax: number;
}

export type VolumeStatusKind =
  | "no_sets"
  | "below_reference"
  | "within_reference"
  | "above_reference";

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
  recommendation: string;
  progressPercent: number;
}

/**
 * A population-level weekly reference, not individual MV/MEV/MAV/MRV thresholds.
 * ACSM (2026): ~10 weekly sets for hypertrophy; IUSCA (2021): individualize volume.
 * Pelland et al. (2026): fractional indirect sets and diminishing returns.
 * These sources do not validate distinct exact thresholds for each display zone.
 */
export class VolumeLandmarksCalculator {
  static getBracket(muscle: Muscle): VolumeLandmarkBracket {
    const zone = MUSCLES.find((m) => m.id === muscle)!;
    return { muscle, muscleName: zone.name, referenceMin: 10, referenceMax: 20 };
  }

  static assessMuscleVolume(muscle: Muscle, actualSets: number): MuscleVolumeAssessment {
    if (!Number.isFinite(actualSets) || actualSets < 0)
      throw new RangeError("Число подходов должно быть конечным и неотрицательным");
    const bracket = this.getBracket(muscle);
    const base = {
      muscle,
      muscleName: bracket.muscleName,
      actualSets,
      directSets: actualSets,
      indirectSets: 0,
      bracket,
      progressPercent: actualSets / bracket.referenceMax * 100,
    };
    if (actualSets === 0) return {
      ...base,
      status: "no_sets",
      statusLabel: "Нет записанной работы",
      statusColor: "#7e8b91",
      recommendation: "В журнале нет рабочих подходов для этой зоны за период. Это не доказывает потерю мышц или отсутствие другой нагрузки.",
    };
    if (actualSets < bracket.referenceMin) return {
      ...base,
      status: "below_reference",
      statusLabel: "Ниже общего ориентира",
      statusColor: "#58c0ff",
      recommendation: "Рост возможен и при меньшем объёме. Если несколько недель нет прогресса в весе или повторах, а восстановление хорошее, попробуй добавить 1–2 трудных подхода в неделю.",
    };
    if (actualSets <= bracket.referenceMax) return {
      ...base,
      status: "within_reference",
      statusLabel: "В общем диапазоне",
      statusColor: "#cafa64",
      recommendation: "Типичный ориентир для гипертрофии при достаточно трудных подходах. Если вес или повторы растут, повышать объём необязательно. Это не гарантия максимального роста.",
    };
    return {
      ...base,
      status: "above_reference",
      statusLabel: "Выше общего диапазона",
      statusColor: "#f59e0b",
      recommendation: "Отдача от дополнительных подходов обычно уменьшается. Проверь прогресс, сон и усталость; при ухудшении результатов сократи объём. Само число подходов не определяет перетренированность.",
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
  static assessWeek(workouts: Workout[], endDate: string, options: Pick<AnalysisOptions, "mapping"> = {}) {
    const startDate = addCalendarDays(endDate, -6);
    const selected = workouts.filter((w) => w.date >= startDate && w.date <= endDate);
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
