/**
 * VolumeLandmarks
 *
 * OOP Domain Service implementing evidence-based Hypertrophy Volume Landmarks
 * developed by Dr. Mike Israetel (Renaissance Periodization).
 *
 * Concepts:
 * - MV (Maintenance Volume): Minimum work to preserve muscle mass.
 * - MEV (Minimum Effective Volume): Threshold to initiate muscle growth.
 * - MAV (Maximum Adaptive Volume): Sweet spot for maximum hypertrophy progress.
 * - MRV (Maximum Recoverable Volume): Ceiling beyond which overreaching occurs.
 */

import type { Muscle, MuscleLoad } from "../lib/types";

export interface VolumeLandmarkBracket {
  muscle: Muscle;
  muscleName: string;
  mv: number;
  mev: number;
  mavMin: number;
  mavMax: number;
  mrv: number;
  notes: string;
}

export type VolumeStatusKind =
  | "below_mv"
  | "maintenance"
  | "growth_mev"
  | "optimal_mav"
  | "near_mrv"
  | "overreaching";

export interface MuscleVolumeAssessment {
  muscle: Muscle;
  muscleName: string;
  actualSets: number;
  bracket: VolumeLandmarkBracket;
  status: VolumeStatusKind;
  statusLabel: string;
  statusColor: string;
  recommendation: string;
  progressPercent: number; // 0 to 100+ % relative to MAV
}

export const RP_VOLUME_LANDMARKS: Record<Muscle, VolumeLandmarkBracket> = {
  chest: {
    muscle: "chest",
    muscleName: "Грудь",
    mv: 8,
    mev: 10,
    mavMin: 12,
    mavMax: 20,
    mrv: 22,
    notes: "Отлично откликается на растянутую позицию (разводки, гантели)",
  },
  back: {
    muscle: "back",
    muscleName: "Спина",
    mv: 8,
    mev: 10,
    mavMin: 14,
    mavMax: 22,
    mrv: 25,
    notes: "Широчайшие и верх спины быстро восстанавливаются при вариации хватов",
  },
  shoulders: {
    muscle: "shoulders",
    muscleName: "Плечи",
    mv: 6,
    mev: 8,
    mavMin: 16,
    mavMax: 22,
    mrv: 26,
    notes: "Средняя и задняя дельты требуют высокого объёма (махи, фейспулы)",
  },
  biceps: {
    muscle: "biceps",
    muscleName: "Сгибатели рук (бицепс)",
    mv: 4,
    mev: 6,
    mavMin: 10,
    mavMax: 16,
    mrv: 20,
    notes: "Получает косвенную нагрузку во всех тяговых движениях",
  },
  triceps: {
    muscle: "triceps",
    muscleName: "Трицепс",
    mv: 4,
    mev: 6,
    mavMin: 10,
    mavMax: 16,
    mrv: 18,
    notes: "Важно изолировать длинную головку разгибаниями из-за головы",
  },
  quads: {
    muscle: "quads",
    muscleName: "Квадрицепс",
    mv: 6,
    mev: 8,
    mavMin: 12,
    mavMax: 18,
    mrv: 20,
    notes: "Тяжёлые приседы и жимы ногами создают высокий системный стресс",
  },
  hamstrings: {
    muscle: "hamstrings",
    muscleName: "Задняя поверхность бедра",
    mv: 4,
    mev: 6,
    mavMin: 10,
    mavMax: 16,
    mrv: 20,
    notes: "Требует комбинации сгибаний голени (сидя/лёжа) и сгибаний таза (РДЛ)",
  },
  glutes: {
    muscle: "glutes",
    muscleName: "Ягодицы",
    mv: 2,
    mev: 4,
    mavMin: 8,
    mavMax: 16,
    mrv: 20,
    notes: "Выпады, ягодичный мост и глубокие приседания",
  },
  calves: {
    muscle: "calves",
    muscleName: "Мышцы голени (икры)",
    mv: 6,
    mev: 8,
    mavMin: 12,
    mavMax: 16,
    mrv: 20,
    notes: "Камбаловидная (сидя) и икроножная (стоя с выпрямленным коленом)",
  },
  core: {
    muscle: "core",
    muscleName: "Мышцы живота (пресс)",
    mv: 0,
    mev: 4,
    mavMin: 8,
    mavMax: 16,
    mrv: 20,
    notes: "Получает статическую стабилизацию в приседе и становой",
  },
};

export class VolumeLandmarksCalculator {
  public static getBracket(muscle: Muscle): VolumeLandmarkBracket {
    return RP_VOLUME_LANDMARKS[muscle] || RP_VOLUME_LANDMARKS.chest;
  }

  public static assessMuscleVolume(muscle: Muscle, actualSets: number): MuscleVolumeAssessment {
    const bracket = this.getBracket(muscle);

    if (actualSets < bracket.mv) {
      return {
        muscle,
        muscleName: bracket.muscleName,
        actualSets,
        bracket,
        status: "below_mv",
        statusLabel: "Ниже объёма сохранения (MV)",
        statusColor: "#7e8b91",
        recommendation: `Объёма недостаточно даже для сохранения мышечной массы. Добавь хотя бы ${bracket.mv - actualSets} подх.`,
        progressPercent: Math.round((actualSets / bracket.mavMin) * 50),
      };
    } else if (actualSets < bracket.mev) {
      return {
        muscle,
        muscleName: bracket.muscleName,
        actualSets,
        bracket,
        status: "maintenance",
        statusLabel: "Поддержание мышц (MV)",
        statusColor: "#58c0ff",
        recommendation: `Мышцы сохраняются, но стимул для роста слаб. Для запуска гипертрофии нужно ещё ${bracket.mev - actualSets} подх.`,
        progressPercent: Math.round(50 + ((actualSets - bracket.mv) / (bracket.mev - bracket.mv)) * 25),
      };
    } else if (actualSets < bracket.mavMin) {
      return {
        muscle,
        muscleName: bracket.muscleName,
        actualSets,
        bracket,
        status: "growth_mev",
        statusLabel: "Минимальный рост (MEV)",
        statusColor: "#a3e635",
        recommendation: `Рост запущен! Можно постепенно повысить объём на ${bracket.mavMin - actualSets} подх. до золотой зоны MAV.`,
        progressPercent: Math.round(75 + ((actualSets - bracket.mev) / (bracket.mavMin - bracket.mev)) * 15),
      };
    } else if (actualSets <= bracket.mavMax) {
      return {
        muscle,
        muscleName: bracket.muscleName,
        actualSets,
        bracket,
        status: "optimal_mav",
        statusLabel: "Максимальный рост (MAV) ⚡",
        statusColor: "#cafa64",
        recommendation: "Золотая середина максимальной гипертрофии по доктору Израэтелю. Отличная прогрессия!",
        progressPercent: 100,
      };
    } else if (actualSets <= bracket.mrv) {
      return {
        muscle,
        muscleName: bracket.muscleName,
        actualSets,
        bracket,
        status: "near_mrv",
        statusLabel: "На пределе восстановления (MRV) ⚠️",
        statusColor: "#f59e0b",
        recommendation: `Очень высокий объём. Допустимо только на пиковой неделе мезоцикла перед разгрузкой.`,
        progressPercent: 110,
      };
    } else {
      return {
        muscle,
        muscleName: bracket.muscleName,
        actualSets,
        bracket,
        status: "overreaching",
        statusLabel: "Превышение предела (Перетрен) 🛑",
        statusColor: "#ef4444",
        recommendation: `Превышен MRV на ${actualSets - bracket.mrv} подходов. Системное утомление опережает рост мышц, снизь объём!`,
        progressPercent: 125,
      };
    }
  }

  public static assessWeeklyLoads(loads: MuscleLoad[]): MuscleVolumeAssessment[] {
    return loads.map((l) => this.assessMuscleVolume(l.id, l.direct));
  }
}
