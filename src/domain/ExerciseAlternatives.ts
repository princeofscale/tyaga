import type { Exercise } from "../lib/types";
import { EXERCISES } from "../lib/catalog";
import { MUSCLES } from "../data/muscles";

export interface ExerciseAlternative {
  exercise: Exercise;
  matchScore: number;
  reason: string;
  equipmentLabel: string;
}

export type DetectedEquipment = "barbell" | "dumbbell" | "cable" | "machine" | "bodyweight";

export function detectExerciseEquipment(e: Exercise): DetectedEquipment {
  const name = e.name.toLowerCase();
  const id = e.id.toLowerCase();
  if (e.recording.loadMode === "bodyweight" || e.equipment === "bodyweight") return "bodyweight";
  if (e.recording.loadMode === "per_implement" || e.equipment === "dumbbells" || name.includes("гантел") || id.includes("db")) return "dumbbell";
  if (e.recording.loadMode === "machine_stack" || name.includes("тренаж") || id.includes("machine")) return "machine";
  if (name.includes("блок") || name.includes("канат") || name.includes("кроссовер") || id.includes("cable") || id.includes("pulldown")) return "cable";
  return "barbell";
}

const EQUIPMENT_NAMES: Record<DetectedEquipment, string> = {
  barbell: "Штанга",
  dumbbell: "Гантели",
  cable: "Блок / Кроссовер",
  machine: "Тренажёр",
  bodyweight: "Свой вес",
};

export class ExerciseAlternativesFinder {
  /**
   * Finds the best alternative exercises targeting the same primary muscle groups.
   */
  public static findAlternatives(
    currentExercise: Exercise,
    allExercises: Exercise[] = EXERCISES,
    limit = 6,
  ): ExerciseAlternative[] {
    const curId = currentExercise.id;
    const curPrimary = new Set(currentExercise.primary);
    const curSecondary = new Set(currentExercise.secondary);
    const curEquip = detectExerciseEquipment(currentExercise);
    const curName = currentExercise.name.toLowerCase();

    const isUpperChest = curName.includes("наклон") || curName.includes("верх") || curId.includes("incline");
    const isLowerChest = curName.includes("сверху") || curName.includes("низ") || curId.includes("decline") || curId.includes("dip");
    const isRearDelt = curName.includes("задн") || curId.includes("rear");
    const isSideDelt = curName.includes("средн") || curName.includes("махи") || curId.includes("lateral");

    const scored: ExerciseAlternative[] = [];

    for (const cand of allExercises) {
      if (cand.id === curId) continue;
      // Do not suggest exercises that have no primary muscle overlap
      const hasPrimaryOverlap = cand.primary.some((p) => curPrimary.has(p));
      if (!hasPrimaryOverlap) continue;

      let score = 0;
      const candName = cand.name.toLowerCase();
      const candId = cand.id.toLowerCase();
      const candEquip = detectExerciseEquipment(cand);

      // Primary muscle match: 40 points per matching primary muscle
      for (const p of cand.primary) {
        if (curPrimary.has(p)) score += 40;
      }

      // Secondary muscle match: 10 points each
      for (const s of cand.secondary) {
        if (curSecondary.has(s)) score += 10;
        if (curPrimary.has(s)) score += 8;
      }

      // Sub-head anatomical synergy
      if (isUpperChest && (candName.includes("наклон") || candName.includes("верх") || candId.includes("incline"))) {
        score += 35;
      }
      if (isLowerChest && (candName.includes("сверху") || candName.includes("низ") || candName.includes("брусь") || candId.includes("decline") || candId.includes("dip"))) {
        score += 35;
      }
      if (isRearDelt && (candName.includes("задн") || candId.includes("rear"))) {
        score += 35;
      }
      if (isSideDelt && (candName.includes("средн") || candName.includes("махи") || candId.includes("lateral"))) {
        score += 35;
      }

      // Equipment variety bonus: if gym equipment differs, give a small boost
      // so lifter has options if one machine or barbell rack is occupied
      if (candEquip !== curEquip) {
        score += 15;
      }

      // Formulate reason
      const primaryNames = cand.primary
        .map((p) => MUSCLES.find((m) => m.id === p)?.short || p)
        .join(", ");
      
      let equipReason = "";
      if (candEquip !== curEquip) {
        const fromEquip = EQUIPMENT_NAMES[curEquip];
        const toEquip = EQUIPMENT_NAMES[candEquip];
        equipReason = ` · ${toEquip} вместо ${fromEquip.toLowerCase()}`;
      } else {
        equipReason = ` · ${EQUIPMENT_NAMES[candEquip]}`;
      }

      const reason = `Фокус: ${primaryNames}${equipReason}`;
      const equipmentLabel = EQUIPMENT_NAMES[candEquip];

      scored.push({
        exercise: cand,
        matchScore: score,
        reason,
        equipmentLabel,
      });
    }

    scored.sort((a, b) => b.matchScore - a.matchScore);
    return scored.slice(0, limit);
  }
}
