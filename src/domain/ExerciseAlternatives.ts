import type { AnatomicalMuscle, Exercise } from "../lib/types";
import { EXERCISES } from "../lib/catalog";
import { MUSCLES } from "../data/muscles";
import { MuscleParticipation } from "./MuscleParticipation";

export interface ExerciseAlternative {
  exercise: Exercise;
  matchScore: number;
  reason: string;
  equipmentLabel: string;
  /** "mover" = overlaps primary anatomical mover; "zone" = fallback within coarse zone only. */
  matchKind?: "mover" | "zone";
}

export type DetectedEquipment = "barbell" | "dumbbell" | "cable" | "machine" | "bodyweight";

export function detectExerciseEquipment(e: Exercise): DetectedEquipment {
  const name = e.name.toLowerCase();
  const id = e.id.toLowerCase();
  if (
    e.recording.loadMode === "bodyweight" ||
    e.recording.loadMode === "added_bodyweight" ||
    e.equipment === "bodyweight"
  )
    return "bodyweight";
  if (e.recording.loadMode === "assisted_bodyweight") return "machine";
  if (e.recording.loadMode === "per_implement" || e.equipment === "dumbbells" || name.includes("гантел") || id.includes("db")) return "dumbbell";
  // R09-QA-03: блоки и кроссоверы тоже идут «на стеке» (machine_stack), но это отдельный снаряд — проверяем их раньше тренажёра.
  if (name.includes("блок") || name.includes("канат") || name.includes("кроссовер") || id.includes("cable") || id.includes("pulldown")) return "cable";
  if (e.recording.loadMode === "machine_stack" || name.includes("тренаж") || id.includes("machine")) return "machine";
  return "barbell";
}

const EQUIPMENT_NAMES: Record<DetectedEquipment, string> = {
  barbell: "Штанга",
  dumbbell: "Гантели",
  cable: "Блок / Кроссовер",
  machine: "Тренажёр",
  bodyweight: "Свой вес",
};

const SUBHEAD_MUSCLES: ReadonlySet<AnatomicalMuscle> = new Set([
  "pectoralis-clavicular",
  "pectoralis-sternal",
  "pectoralis-abdominal",
  "deltoid-anterior",
  "deltoid-middle",
  "deltoid-posterior",
  "gastrocnemius",
  "soleus",
]);

export class ExerciseAlternativesFinder {
  /**
   * Finds the best alternative exercises targeting the same primary muscles,
   * anatomical subheads (via MuscleParticipation, never substring guessing),
   * and movement family.
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
    const curRoles = MuscleParticipation.roles(currentExercise);
    const curAnatPrimary = new Set(
      curRoles.filter((r) => r.role === "primary").map((r) => r.muscleId),
    );
    const curHasChestPrimary = [...curAnatPrimary].some((m) => m.startsWith("pectoralis-"));
    const curAnatAssist = new Set(
      curRoles.filter((r) => r.role === "assistant").map((r) => r.muscleId),
    );

    const movers: ExerciseAlternative[] = [];
    const zoneFallbacks: ExerciseAlternative[] = [];

    for (const cand of allExercises) {
      if (cand.id === curId) continue;
      // Do not suggest exercises that have no primary muscle overlap
      const hasPrimaryOverlap = cand.primary.some((p) => curPrimary.has(p));
      if (!hasPrimaryOverlap) continue;

      let score = 0;
      const candEquip = detectExerciseEquipment(cand);
      const candRoles = MuscleParticipation.roles(cand);
      const candAnatPrimary = candRoles.filter((r) => r.role === "primary").map((r) => r.muscleId);
      const candHasChestPrimary = candAnatPrimary.some((m) => m.startsWith("pectoralis-"));
      const hasAnatPrimaryMatch =
        curAnatPrimary.size === 0 ||
        candAnatPrimary.length === 0 ||
        candAnatPrimary.some((m) => curAnatPrimary.has(m)) ||
        (curHasChestPrimary && candHasChestPrimary);

      // Same movement family (e.g., bench-press, horizontal-row, knee-flexion): strong biomechanical match
      if (cand.familyId && cand.familyId === currentExercise.familyId) {
        score += 35;
      }

      // Same joint action (e.g., horizontal abduction, hip extension, knee flexion)
      for (const action of cand.jointActions) {
        if (currentExercise.jointActions.includes(action)) {
          score += 22;
        }
      }

      // Primary zone match: 40 points per matching primary zone, +30 for matching the lead zone
      for (const p of cand.primary) {
        if (curPrimary.has(p)) score += 40;
      }
      if (currentExercise.primary[0] && cand.primary.includes(currentExercise.primary[0])) {
        score += 30;
      }

      // Exact anatomical muscle & subhead match (prevents string-guessing bugs like "верхних блоков" → upper chest)
      for (const role of candRoles) {
        if (role.role === "primary" && curAnatPrimary.has(role.muscleId)) {
          score += SUBHEAD_MUSCLES.has(role.muscleId) ? 45 : 12;
        } else if (role.role === "assistant" && curAnatAssist.has(role.muscleId)) {
          score += 5;
        }
      }

      // Secondary zone match: 10 points each
      for (const s of cand.secondary) {
        if (curSecondary.has(s)) score += 10;
        if (curPrimary.has(s)) score += 8;
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

      let equipReason: string;
      if (candEquip !== curEquip) {
        const fromEquip = EQUIPMENT_NAMES[curEquip];
        const toEquip = EQUIPMENT_NAMES[candEquip];
        equipReason = ` · ${toEquip} вместо ${fromEquip.toLowerCase()}`;
      } else {
        equipReason = ` · ${EQUIPMENT_NAMES[candEquip]}`;
      }

      const matchKind: ExerciseAlternative["matchKind"] = hasAnatPrimaryMatch ? "mover" : "zone";
      const reason =
        matchKind === "mover"
          ? `Движитель: ${primaryNames}${equipReason}`
          : `Та же зона (другой движитель): ${primaryNames}${equipReason}`;
      const equipmentLabel = EQUIPMENT_NAMES[candEquip];

      (matchKind === "mover" ? movers : zoneFallbacks).push({
        exercise: cand,
        matchScore: score,
        reason,
        equipmentLabel,
        matchKind,
      });
    }

    const pool = movers.length > 0 ? movers : zoneFallbacks;
    pool.sort((a, b) => b.matchScore - a.matchScore);
    return pool.slice(0, limit);
  }
}
