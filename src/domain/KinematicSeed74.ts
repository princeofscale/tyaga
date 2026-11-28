import { makeDescriptor } from "./KinematicMuscleSolver";
import type { KinematicDescriptor } from "./KinematicTypesV4";

/**
 * Декларативные физические дескрипторы (KinematicDescriptor) для всех 74 базовых упражнений каталога «Тяги».
 * Обеспечивают:
 * 1) Tier 0 оффлайн-разметку и мгновенный (<0.1 мс) пересчёт при изменении ExecutionProfile;
 * 2) CI/CD регрессию TC10 против эталонных профилей BiomechanicsCatalogV3.
 */
export const SEED_KINEMATICS_74: Readonly<Record<string, KinematicDescriptor>> = {
  // === ГРУДЬ (10) ===
  bench: makeDescriptor(
    { shoulder_horizontal_adduction: 1.0, elbow_extension: 0.6 },
    { benchAngleDeg: 0, shoulderPlaneDeg: 50, forearmRotation: "pronated" },
    { supportType: "lying", loadVector: "gravity_vertical", peakTorqueZone: "lengthened", implement: "barbell" },
  ),
  "incline-bar": makeDescriptor(
    { shoulder_horizontal_adduction: 1.0, elbow_extension: 0.6 },
    { benchAngleDeg: 30, shoulderPlaneDeg: 50, forearmRotation: "pronated" },
    { supportType: "lying", loadVector: "gravity_vertical", peakTorqueZone: "lengthened", implement: "barbell" },
  ),
  "flat-db-press": makeDescriptor(
    { shoulder_horizontal_adduction: 1.0, elbow_extension: 0.6 },
    { benchAngleDeg: 0, shoulderPlaneDeg: 45, forearmRotation: "neutral" },
    { supportType: "lying", loadVector: "gravity_vertical", peakTorqueZone: "lengthened", implement: "dumbbell" },
  ),
  "incline-db": makeDescriptor(
    { shoulder_horizontal_adduction: 1.0, elbow_extension: 0.6 },
    { benchAngleDeg: 30, shoulderPlaneDeg: 45, forearmRotation: "neutral" },
    { supportType: "lying", loadVector: "gravity_vertical", peakTorqueZone: "lengthened", implement: "dumbbell" },
  ),
  "dip-weighted": makeDescriptor(
    { shoulder_horizontal_adduction: 1.0, elbow_extension: 0.65 },
    { benchAngleDeg: -15, shoulderPlaneDeg: 40, torsoAngleDeg: 65, forearmRotation: "neutral" },
    { supportType: "free_standing", loadVector: "gravity_vertical", peakTorqueZone: "lengthened", implement: "bodyweight" },
  ),
  pushup: makeDescriptor(
    { shoulder_horizontal_adduction: 0.95, elbow_extension: 0.6 },
    { benchAngleDeg: 0, shoulderPlaneDeg: 45, torsoAngleDeg: 10, forearmRotation: "pronated" },
    { supportType: "lying", loadVector: "gravity_vertical", peakTorqueZone: "lengthened", implement: "bodyweight" },
  ),
  fly: makeDescriptor(
    { shoulder_horizontal_adduction: 1.0 },
    { benchAngleDeg: 0, shoulderPlaneDeg: 75, forearmRotation: "neutral" },
    { supportType: "seated_unsupported", loadVector: "cable_aligned", peakTorqueZone: "lengthened", implement: "cable" },
  ),
  "high-cable-fly": makeDescriptor(
    { shoulder_horizontal_adduction: 1.0 },
    { benchAngleDeg: -15, shoulderPlaneDeg: 60, forearmRotation: "neutral" },
    { supportType: "seated_unsupported", loadVector: "cable_aligned", peakTorqueZone: "mid", implement: "cable" },
  ),
  "pec-deck-fly": makeDescriptor(
    { shoulder_horizontal_adduction: 1.0 },
    { benchAngleDeg: 0, shoulderPlaneDeg: 75, forearmRotation: "neutral" },
    { supportType: "machine_guided", loadVector: "cam_variable", peakTorqueZone: "flat", implement: "machine" },
  ),
  "fly-db-flat": makeDescriptor(
    { shoulder_horizontal_adduction: 1.0 },
    { benchAngleDeg: -10, shoulderPlaneDeg: 75, forearmRotation: "neutral" },
    { supportType: "lying", loadVector: "gravity_vertical", peakTorqueZone: "lengthened", implement: "dumbbell" },
  ),

  // === СПИНА (16) ===
  "lat-pulldown": makeDescriptor(
    { shoulder_adduction_frontal: 1.0, scapular_retraction: 0.55, elbow_flexion: 0.55 },
    { shoulderPlaneDeg: 35, forearmRotation: "pronated", torsoAngleDeg: 80 },
    { supportType: "chest_or_back_supported", loadVector: "cable_aligned", peakTorqueZone: "lengthened", implement: "cable" },
  ),
  "pulldown-reverse": makeDescriptor(
    { shoulder_extension_sagittal: 1.0, elbow_flexion: 0.6 },
    { shoulderPlaneDeg: 15, forearmRotation: "supinated", torsoAngleDeg: 80 },
    { supportType: "chest_or_back_supported", loadVector: "cable_aligned", peakTorqueZone: "lengthened", implement: "cable" },
  ),
  pullup: makeDescriptor(
    { shoulder_adduction_frontal: 1.0, scapular_retraction: 0.55, elbow_flexion: 0.6 },
    { shoulderPlaneDeg: 35, forearmRotation: "pronated", torsoAngleDeg: 85 },
    { supportType: "free_standing", loadVector: "gravity_vertical", peakTorqueZone: "lengthened", implement: "bodyweight" },
  ),
  "pullup-weighted": makeDescriptor(
    { shoulder_adduction_frontal: 1.0, scapular_retraction: 0.55, elbow_flexion: 0.6 },
    { shoulderPlaneDeg: 35, forearmRotation: "pronated", torsoAngleDeg: 85 },
    { supportType: "free_standing", loadVector: "gravity_vertical", peakTorqueZone: "lengthened", implement: "bodyweight" },
  ),
  "pullup-assisted": makeDescriptor(
    { shoulder_adduction_frontal: 1.0, scapular_retraction: 0.55, elbow_flexion: 0.55 },
    { shoulderPlaneDeg: 35, forearmRotation: "pronated", torsoAngleDeg: 85 },
    { supportType: "machine_guided", loadVector: "cable_aligned", peakTorqueZone: "lengthened", implement: "machine" },
  ),
  row: makeDescriptor(
    { scapular_retraction: 1.0, shoulder_horizontal_abduction: 0.65, shoulder_extension_sagittal: 0.6, elbow_flexion: 0.55 },
    { shoulderPlaneDeg: 55, forearmRotation: "pronated", torsoAngleDeg: 85 },
    { supportType: "seated_unsupported", loadVector: "cable_aligned", peakTorqueZone: "mid", implement: "cable" },
  ),
  "row-v-grip": makeDescriptor(
    { shoulder_extension_sagittal: 1.0, scapular_retraction: 0.7, elbow_flexion: 0.55 },
    { shoulderPlaneDeg: 15, forearmRotation: "neutral", torsoAngleDeg: 85 },
    { supportType: "seated_unsupported", loadVector: "cable_aligned", peakTorqueZone: "mid", implement: "cable" },
  ),
  "row-single-cable": makeDescriptor(
    { shoulder_extension_sagittal: 1.0, scapular_retraction: 0.65, elbow_flexion: 0.5 },
    { shoulderPlaneDeg: 15, forearmRotation: "neutral", torsoAngleDeg: 85 },
    { supportType: "chest_or_back_supported", loadVector: "cable_aligned", peakTorqueZone: "lengthened", laterality: "unilateral", implement: "cable" },
  ),
  "db-row": makeDescriptor(
    { shoulder_extension_sagittal: 1.0, scapular_retraction: 0.7, shoulder_horizontal_abduction: 0.55, elbow_flexion: 0.5 },
    { shoulderPlaneDeg: 25, forearmRotation: "neutral", torsoAngleDeg: 35 },
    { supportType: "seated_unsupported", loadVector: "gravity_vertical", peakTorqueZone: "lengthened", laterality: "unilateral", implement: "dumbbell" },
  ),
  "row-bent-bar": makeDescriptor(
    { scapular_retraction: 1.0, shoulder_horizontal_abduction: 0.65, shoulder_extension_sagittal: 0.6, elbow_flexion: 0.5, spinal_isometric_extension: 0.6 },
    { shoulderPlaneDeg: 55, forearmRotation: "pronated", torsoAngleDeg: 25 },
    { supportType: "free_standing", loadVector: "gravity_vertical", peakTorqueZone: "shortened", implement: "barbell" },
  ),
  "row-yates": makeDescriptor(
    { scapular_retraction: 1.0, shoulder_extension_sagittal: 0.65, elbow_flexion: 0.6, spinal_isometric_extension: 0.5 },
    { shoulderPlaneDeg: 45, forearmRotation: "supinated", torsoAngleDeg: 45 },
    { supportType: "free_standing", loadVector: "gravity_vertical", peakTorqueZone: "shortened", implement: "barbell" },
  ),
  "row-chest-supported": makeDescriptor(
    { scapular_retraction: 1.0, shoulder_horizontal_abduction: 0.65, shoulder_extension_sagittal: 0.6, elbow_flexion: 0.5 },
    { shoulderPlaneDeg: 55, forearmRotation: "neutral", torsoAngleDeg: 45 },
    { supportType: "chest_or_back_supported", loadVector: "lever_arc", peakTorqueZone: "mid", implement: "machine" },
  ),
  "pullover-cable": makeDescriptor(
    { shoulder_extension_sagittal: 1.0 },
    { shoulderPlaneDeg: 10, shoulderFlexionDeg: 145, forearmRotation: "pronated", torsoAngleDeg: 65 },
    { supportType: "seated_unsupported", loadVector: "cable_aligned", peakTorqueZone: "lengthened", implement: "cable" },
  ),
  "shrug-bar": makeDescriptor(
    { scapular_elevation: 1.0 },
    { torsoAngleDeg: 90, forearmRotation: "pronated" },
    { supportType: "free_standing", loadVector: "gravity_vertical", peakTorqueZone: "shortened", implement: "barbell" },
  ),
  "shrug-db-incline": makeDescriptor(
    { scapular_elevation: 1.0 },
    { torsoAngleDeg: 80, forearmRotation: "neutral" },
    { supportType: "chest_or_back_supported", loadVector: "gravity_vertical", peakTorqueZone: "mid", implement: "dumbbell" },
  ),
  "back-extension": makeDescriptor(
    { spinal_isometric_extension: 1.0, hip_extension: 0.7 },
    { torsoAngleDeg: 45, hipFlexionDeg: 80 },
    { supportType: "free_standing", loadVector: "gravity_vertical", peakTorqueZone: "lengthened", implement: "bodyweight" },
  ),

  // === ПЛЕЧИ (8) ===
  "ohp-bar": makeDescriptor(
    { shoulder_flexion: 1.0, shoulder_abduction: 0.55, elbow_extension: 0.6 },
    { benchAngleDeg: 85, shoulderPlaneDeg: 45, forearmRotation: "pronated", torsoAngleDeg: 90 },
    { supportType: "free_standing", loadVector: "gravity_vertical", peakTorqueZone: "lengthened", implement: "barbell" },
  ),
  ohp: makeDescriptor(
    { shoulder_flexion: 1.0, shoulder_abduction: 0.55, elbow_extension: 0.6 },
    { benchAngleDeg: 80, shoulderPlaneDeg: 45, forearmRotation: "neutral", torsoAngleDeg: 85 },
    { supportType: "seated_unsupported", loadVector: "gravity_vertical", peakTorqueZone: "lengthened", implement: "dumbbell" },
  ),
  "push-press": makeDescriptor(
    { shoulder_flexion: 1.0, shoulder_abduction: 0.55, elbow_extension: 0.5, knee_extension: 0.55, hip_extension: 0.4 },
    { benchAngleDeg: 85, shoulderPlaneDeg: 45, forearmRotation: "pronated", torsoAngleDeg: 90 },
    { supportType: "free_standing", loadVector: "gravity_vertical", peakTorqueZone: "mid", implement: "barbell" },
  ),
  "shoulder-press-machine": makeDescriptor(
    { shoulder_flexion: 1.0, shoulder_abduction: 0.55, elbow_extension: 0.6 },
    { benchAngleDeg: 80, shoulderPlaneDeg: 45, forearmRotation: "neutral", torsoAngleDeg: 85 },
    { supportType: "machine_guided", loadVector: "lever_arc", peakTorqueZone: "lengthened", implement: "machine" },
  ),
  lateral: makeDescriptor(
    { shoulder_abduction: 1.0 },
    { shoulderPlaneDeg: 75, forearmRotation: "pronated", torsoAngleDeg: 85 },
    { supportType: "free_standing", loadVector: "gravity_vertical", peakTorqueZone: "shortened", implement: "dumbbell" },
  ),
  "lateral-cable-single": makeDescriptor(
    { shoulder_abduction: 1.0 },
    { shoulderPlaneDeg: 75, forearmRotation: "neutral", torsoAngleDeg: 85 },
    { supportType: "seated_unsupported", loadVector: "cable_aligned", peakTorqueZone: "lengthened", laterality: "unilateral", implement: "cable" },
  ),
  "facepull-er": makeDescriptor(
    { shoulder_horizontal_abduction: 0.9, shoulder_external_rotation: 1.0, scapular_retraction: 0.6 },
    { shoulderPlaneDeg: 80, forearmRotation: "neutral", torsoAngleDeg: 85 },
    { supportType: "seated_unsupported", loadVector: "cable_aligned", peakTorqueZone: "shortened", implement: "cable" },
  ),
  "rear-delt-fly": makeDescriptor(
    { shoulder_horizontal_abduction: 1.0, scapular_retraction: 0.6 },
    { shoulderPlaneDeg: 80, forearmRotation: "neutral", torsoAngleDeg: 85 },
    { supportType: "machine_guided", loadVector: "cam_variable", peakTorqueZone: "flat", implement: "machine" },
  ),

  // === БИЦЕПС / СГИБАТЕЛИ (7) ===
  curl: makeDescriptor(
    { elbow_flexion: 1.0 },
    { shoulderFlexionDeg: 5, forearmRotation: "supinated" },
    { supportType: "seated_unsupported", loadVector: "gravity_vertical", peakTorqueZone: "mid", implement: "dumbbell" },
  ),
  "curl-bar": makeDescriptor(
    { elbow_flexion: 1.0 },
    { shoulderFlexionDeg: 5, forearmRotation: "supinated" },
    { supportType: "free_standing", loadVector: "gravity_vertical", peakTorqueZone: "mid", implement: "barbell" },
  ),
  "curl-preacher-ez": makeDescriptor(
    { elbow_flexion: 1.0 },
    { shoulderFlexionDeg: 45, forearmRotation: "supinated" },
    { supportType: "chest_or_back_supported", loadVector: "gravity_vertical", peakTorqueZone: "lengthened", implement: "ez_bar" },
  ),
  "curl-incline-db": makeDescriptor(
    { elbow_flexion: 1.0 },
    { shoulderFlexionDeg: -30, benchAngleDeg: 45, forearmRotation: "supinated" },
    { supportType: "chest_or_back_supported", loadVector: "gravity_vertical", peakTorqueZone: "lengthened", implement: "dumbbell" },
  ),
  "curl-reverse-ez": makeDescriptor(
    { elbow_flexion: 1.0 },
    { shoulderFlexionDeg: 5, forearmRotation: "pronated" },
    { supportType: "seated_unsupported", loadVector: "gravity_vertical", peakTorqueZone: "mid", implement: "ez_bar" },
  ),
  hammer: makeDescriptor(
    { elbow_flexion: 1.0 },
    { shoulderFlexionDeg: 5, forearmRotation: "neutral" },
    { supportType: "free_standing", loadVector: "gravity_vertical", peakTorqueZone: "mid", implement: "dumbbell" },
  ),
  "hammer-seated": makeDescriptor(
    { elbow_flexion: 1.0 },
    { shoulderFlexionDeg: 5, forearmRotation: "neutral" },
    { supportType: "chest_or_back_supported", loadVector: "gravity_vertical", peakTorqueZone: "mid", implement: "dumbbell" },
  ),

  // === ТРИЦЕПС (5) ===
  "triceps-push": makeDescriptor(
    { elbow_extension: 1.0 },
    { shoulderFlexionDeg: 5, forearmRotation: "neutral" },
    { supportType: "seated_unsupported", loadVector: "cable_aligned", peakTorqueZone: "mid", implement: "cable" },
  ),
  "extension-v-pushdown": makeDescriptor(
    { elbow_extension: 1.0 },
    { shoulderFlexionDeg: 5, forearmRotation: "pronated" },
    { supportType: "seated_unsupported", loadVector: "cable_aligned", peakTorqueZone: "mid", implement: "cable" },
  ),
  "triceps-db": makeDescriptor(
    { elbow_extension: 1.0 },
    { shoulderFlexionDeg: 150, forearmRotation: "neutral" },
    { supportType: "seated_unsupported", loadVector: "gravity_vertical", peakTorqueZone: "lengthened", implement: "dumbbell" },
  ),
  "extension-overhead-cable": makeDescriptor(
    { elbow_extension: 1.0 },
    { shoulderFlexionDeg: 145, forearmRotation: "neutral" },
    { supportType: "seated_unsupported", loadVector: "cable_aligned", peakTorqueZone: "lengthened", implement: "cable" },
  ),
  "skullcrusher-ez": makeDescriptor(
    { elbow_extension: 1.0 },
    { shoulderFlexionDeg: 100, benchAngleDeg: 15, forearmRotation: "pronated" },
    { supportType: "lying", loadVector: "gravity_vertical", peakTorqueZone: "lengthened", implement: "ez_bar" },
  ),

  // === КВАДРИЦЕПС / ПРИСЕДЫ (9) ===
  squat: makeDescriptor(
    { knee_extension: 1.0, hip_extension: 0.9, spinal_isometric_extension: 0.6 },
    { torsoAngleDeg: 55, hipFlexionDeg: 115, kneeFlexionDeg: 120 },
    { supportType: "free_standing", loadVector: "gravity_vertical", peakTorqueZone: "lengthened", implement: "barbell" },
  ),
  "hack-squat": makeDescriptor(
    { knee_extension: 1.0, hip_extension: 0.85 },
    { torsoAngleDeg: 55, hipFlexionDeg: 110, kneeFlexionDeg: 125 },
    { supportType: "machine_guided", loadVector: "gravity_vertical", peakTorqueZone: "lengthened", implement: "machine" },
  ),
  legpress: makeDescriptor(
    { knee_extension: 1.0, hip_extension: 0.85 },
    { torsoAngleDeg: 45, hipFlexionDeg: 115, kneeFlexionDeg: 110 },
    { supportType: "machine_guided", loadVector: "lever_arc", peakTorqueZone: "lengthened", implement: "machine" },
  ),
  goblet: makeDescriptor(
    { knee_extension: 1.0, hip_extension: 0.85 },
    { torsoAngleDeg: 70, hipFlexionDeg: 115, kneeFlexionDeg: 115 },
    { supportType: "free_standing", loadVector: "gravity_vertical", peakTorqueZone: "lengthened", implement: "dumbbell" },
  ),
  "body-squat": makeDescriptor(
    { knee_extension: 0.95, hip_extension: 0.85 },
    { torsoAngleDeg: 70, hipFlexionDeg: 110, kneeFlexionDeg: 110 },
    { supportType: "free_standing", loadVector: "gravity_vertical", peakTorqueZone: "mid", implement: "bodyweight" },
  ),
  "lunge-bar": makeDescriptor(
    { knee_extension: 1.0, hip_extension: 0.95 },
    { torsoAngleDeg: 75, hipFlexionDeg: 100, kneeFlexionDeg: 110 },
    { supportType: "free_standing", loadVector: "gravity_vertical", peakTorqueZone: "lengthened", laterality: "unilateral", implement: "barbell" },
  ),
  "lunge-reverse": makeDescriptor(
    { knee_extension: 1.0, hip_extension: 0.95 },
    { torsoAngleDeg: 75, hipFlexionDeg: 100, kneeFlexionDeg: 110 },
    { supportType: "free_standing", loadVector: "gravity_vertical", peakTorqueZone: "lengthened", laterality: "unilateral", implement: "dumbbell" },
  ),
  "bulgarian-split-squat": makeDescriptor(
    { knee_extension: 1.0, hip_extension: 0.95 },
    { torsoAngleDeg: 70, hipFlexionDeg: 115, kneeFlexionDeg: 120 },
    { supportType: "free_standing", loadVector: "gravity_vertical", peakTorqueZone: "lengthened", laterality: "unilateral", implement: "dumbbell" },
  ),
  "leg-extension": makeDescriptor(
    { knee_extension: 1.0 },
    { hipFlexionDeg: 85, kneeFlexionDeg: 95 },
    { supportType: "machine_guided", loadVector: "cam_variable", peakTorqueZone: "shortened", implement: "machine" },
  ),

  // === ЗАДНЯЯ ЦЕПЬ / ЯГОДИЦЫ (9) ===
  "deadlift-bar": makeDescriptor(
    { hip_extension: 1.0, spinal_isometric_extension: 1.0, scapular_retraction: 0.55 },
    { torsoAngleDeg: 35, hipFlexionDeg: 105, kneeFlexionDeg: 55 },
    { supportType: "free_standing", loadVector: "gravity_vertical", peakTorqueZone: "mid", implement: "barbell" },
  ),
  "trap-bar-deadlift": makeDescriptor(
    { hip_extension: 1.0, knee_extension: 0.6, spinal_isometric_extension: 0.6 },
    { torsoAngleDeg: 50, hipFlexionDeg: 100, kneeFlexionDeg: 75 },
    { supportType: "free_standing", loadVector: "gravity_vertical", peakTorqueZone: "mid", implement: "trap_bar" },
  ),
  "deadlift-stiff": makeDescriptor(
    { hip_extension: 1.0, spinal_isometric_extension: 0.6 },
    { torsoAngleDeg: 20, hipFlexionDeg: 110, kneeFlexionDeg: 15 },
    { supportType: "free_standing", loadVector: "gravity_vertical", peakTorqueZone: "lengthened", implement: "barbell" },
  ),
  rdl: makeDescriptor(
    { hip_extension: 1.0, spinal_isometric_extension: 0.6 },
    { torsoAngleDeg: 25, hipFlexionDeg: 105, kneeFlexionDeg: 20 },
    { supportType: "free_standing", loadVector: "gravity_vertical", peakTorqueZone: "lengthened", implement: "barbell" },
  ),
  "db-rdl": makeDescriptor(
    { hip_extension: 1.0 },
    { torsoAngleDeg: 25, hipFlexionDeg: 105, kneeFlexionDeg: 20 },
    { supportType: "free_standing", loadVector: "gravity_vertical", peakTorqueZone: "lengthened", implement: "dumbbell" },
  ),
  "legcurl-seated": makeDescriptor(
    { knee_flexion: 1.0 },
    { hipFlexionDeg: 85, kneeFlexionDeg: 100 },
    { supportType: "machine_guided", loadVector: "cam_variable", peakTorqueZone: "lengthened", implement: "machine" },
  ),
  "legcurl-prone": makeDescriptor(
    { knee_flexion: 1.0 },
    { hipFlexionDeg: 10, kneeFlexionDeg: 105 },
    { supportType: "machine_guided", loadVector: "cam_variable", peakTorqueZone: "shortened", implement: "machine" },
  ),
  "barbell-hip-thrust": makeDescriptor(
    { hip_extension: 1.0 },
    { hipFlexionDeg: 65, kneeFlexionDeg: 90, torsoAngleDeg: 15 },
    { supportType: "lying", loadVector: "gravity_vertical", peakTorqueZone: "shortened", implement: "barbell" },
  ),
  "glute-bridge": makeDescriptor(
    { hip_extension: 1.0 },
    { hipFlexionDeg: 55, kneeFlexionDeg: 95, torsoAngleDeg: 10 },
    { supportType: "lying", loadVector: "gravity_vertical", peakTorqueZone: "shortened", implement: "bodyweight" },
  ),

  // === ИКРЫ (4) ===
  "calf-standing": makeDescriptor(
    { ankle_plantarflexion: 1.0 },
    { kneeFlexionDeg: 5, torsoAngleDeg: 90 },
    { supportType: "free_standing", loadVector: "gravity_vertical", peakTorqueZone: "lengthened", implement: "bodyweight" },
  ),
  "calf-standing-machine": makeDescriptor(
    { ankle_plantarflexion: 1.0 },
    { kneeFlexionDeg: 5, torsoAngleDeg: 90 },
    { supportType: "machine_guided", loadVector: "gravity_vertical", peakTorqueZone: "lengthened", implement: "machine" },
  ),
  "calf-legpress": makeDescriptor(
    { ankle_plantarflexion: 1.0 },
    { kneeFlexionDeg: 10, torsoAngleDeg: 45 },
    { supportType: "chest_or_back_supported", loadVector: "lever_arc", peakTorqueZone: "lengthened", implement: "machine" },
  ),
  "calf-seated": makeDescriptor(
    { ankle_plantarflexion: 1.0 },
    { kneeFlexionDeg: 90, torsoAngleDeg: 90 },
    { supportType: "machine_guided", loadVector: "lever_arc", peakTorqueZone: "lengthened", implement: "machine" },
  ),

  // === КОР (6) ===
  crunch: makeDescriptor(
    { trunk_flexion: 1.0 },
    { hipFlexionDeg: 60 },
    { supportType: "lying", loadVector: "gravity_vertical", peakTorqueZone: "shortened", implement: "bodyweight" },
  ),
  "crunch-incline-plate": makeDescriptor(
    { trunk_flexion: 1.0 },
    { benchAngleDeg: -20, hipFlexionDeg: 60 },
    { supportType: "lying", loadVector: "gravity_vertical", peakTorqueZone: "lengthened", implement: "barbell" },
  ),
  "cable-crunch": makeDescriptor(
    { trunk_flexion: 1.0 },
    { hipFlexionDeg: 80 },
    { supportType: "seated_unsupported", loadVector: "cable_aligned", peakTorqueZone: "lengthened", implement: "cable" },
  ),
  "hanging-leg-raise": makeDescriptor(
    { trunk_flexion: 1.0 },
    { hipFlexionDeg: 110, torsoAngleDeg: 90 },
    { supportType: "free_standing", loadVector: "gravity_vertical", peakTorqueZone: "lengthened", implement: "bodyweight" },
  ),
  "ab-roller": makeDescriptor(
    { trunk_anti_extension: 1.0, shoulder_extension_sagittal: 0.5 },
    { torsoAngleDeg: 15, shoulderFlexionDeg: 140 },
    { supportType: "free_standing", loadVector: "gravity_vertical", peakTorqueZone: "lengthened", implement: "bodyweight" },
  ),
  "woodchopper-cable": makeDescriptor(
    { trunk_rotation: 1.0 },
    { torsoAngleDeg: 85 },
    { supportType: "seated_unsupported", loadVector: "cable_aligned", peakTorqueZone: "flat", laterality: "unilateral", implement: "cable" },
  ),
};
