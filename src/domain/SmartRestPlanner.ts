import type { Exercise, SetEntry } from "../lib/types";
import { DeloadEngine } from "./DeloadEngine";

export type RestTier = "heavy_axial" | "compound" | "machine_compound" | "isolation";

const ISOLATION_FAMILIES = new Set([
  "anti-extension",
  "chest-fly",
  "elbow-extension",
  "elbow-flexion",
  "face-pull",
  "knee-extension",
  "knee-flexion",
  "leg-raise",
  "plantarflexion",
  "pullover",
  "reverse-fly",
  "rotation",
  "shoulder-abduction",
  "shrug",
  "trunk-flexion",
]);

export interface RestRecommendation {
  seconds: number;
  tier: RestTier;
  label: string;
}

/**
 * ООП-планировщик умного отдыха между подходами.
 * Подбирает длительность паузы по биомеханическому классу упражнения, диапазону повторений и фазе разгрузки.
 */
export class SmartRestPlanner {
  private readonly fallbackSeconds: number;
  private readonly inDeload: boolean;

  constructor(options: { fallbackSeconds?: number; inDeload?: boolean } = {}) {
    this.fallbackSeconds = Math.max(30, Math.min(600, Math.round(options.fallbackSeconds ?? 120)));
    this.inDeload = options.inDeload === true;
  }

  /** Классифицирует упражнение по требуемому времени восстановления ЦНС и АТФ-КФ. */
  classify(exercise: Exercise | undefined): RestTier {
    if (!exercise) return "compound";
    if (ISOLATION_FAMILIES.has(exercise.familyId)) return "isolation";
    const axial = DeloadEngine.axialLoadMultiplier(exercise);
    if (axial >= 1.5) return "heavy_axial";
    if (axial >= 1.0) return "compound";
    if (axial >= 0.5) return "machine_compound";
    return "isolation";
  }

  /** Вычисляет рекомендуемый отдых в секундах для конкретного подхода. */
  recommend(exercise: Exercise | undefined, set?: Pick<SetEntry, "reps" | "warmup">): RestRecommendation {
    if (set?.warmup) {
      return { seconds: 60, tier: "isolation", label: "Разминка · 1:00" };
    }
    if (!exercise) {
      return {
        seconds: this.fallbackSeconds,
        tier: "compound",
        label: `Отдых · ${SmartRestPlanner.formatShort(this.fallbackSeconds)}`,
      };
    }

    const tier = this.classify(exercise);
    const reps = set?.reps ?? 8;
    const isStrengthSet = reps >= 1 && reps <= 5;

    let seconds: number;
    let tierName: string;
    switch (tier) {
      case "heavy_axial":
        seconds = this.inDeload ? 120 : isStrengthSet ? 210 : 180;
        tierName = "База";
        break;
      case "compound":
        seconds = this.inDeload ? 90 : isStrengthSet ? 150 : 120;
        tierName = "Многосуставное";
        break;
      case "machine_compound":
        seconds = this.inDeload ? 75 : 90;
        tierName = "Подсобка";
        break;
      case "isolation":
      default:
        seconds = this.inDeload ? 60 : 75;
        tierName = "Изоляция";
        break;
    }

    return {
      seconds,
      tier,
      label: `${tierName} · ${SmartRestPlanner.formatShort(seconds)}`,
    };
  }

  static formatShort(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${String(s).padStart(2, "0")}`;
  }
}
