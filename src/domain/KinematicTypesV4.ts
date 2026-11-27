// ============================================================================
// TYAGA v4 — BIOMECHANICAL MUSCLE AGENT & KINEMATIC SOLVER CONTRACTS (PURE TS)
// ============================================================================

import type {
  HypertrophyRegionId,
  JointZone,
} from "./BiomechanicsCatalogV3";

export const ANATOMICAL_MUSCLES_V4 = [
  "pectoralis-clavicular",
  "pectoralis-sternal",
  "pectoralis-abdominal",
  "deltoid-anterior",
  "deltoid-middle",
  "deltoid-posterior",
  "latissimus-dorsi",
  "teres-major",
  "trapezius-upper",
  "trapezius-middle",
  "trapezius-lower",
  "rhomboids",
  "serratus-anterior",
  "infraspinatus",
  "teres-minor",
  "supraspinatus",
  "biceps-brachii",
  "brachialis",
  "brachioradialis",
  "triceps-brachii",
  "quadriceps-vasti",
  "rectus-femoris",
  "gluteus-maximus",
  "gluteus-medius",
  "adductor-magnus",
  "biceps-femoris-long",
  "biceps-femoris-short",
  "semitendinosus",
  "semimembranosus",
  "gastrocnemius",
  "soleus",
  "tibialis-anterior",
  "rectus-abdominis",
  "obliques",
  "erector-spinae",
] as const;

export type AnatomicalMuscleIdV4 = (typeof ANATOMICAL_MUSCLES_V4)[number];
export const ANATOMICAL_MUSCLE_SET_V4 = new Set<string>(ANATOMICAL_MUSCLES_V4);

export type AggregatedZone10 =
  | "chest"
  | "shoulders"
  | "back"
  | "biceps"
  | "triceps"
  | "quads"
  | "glutes"
  | "hamstrings"
  | "calves"
  | "core";

export type JointActionKey =
  | "shoulder_horizontal_adduction"
  | "shoulder_flexion"
  | "shoulder_extension_sagittal"
  | "shoulder_adduction_frontal"
  | "shoulder_abduction"
  | "shoulder_horizontal_abduction"
  | "shoulder_external_rotation"
  | "scapular_retraction"
  | "scapular_elevation"
  | "elbow_flexion"
  | "elbow_extension"
  | "hip_extension"
  | "hip_abduction"
  | "knee_extension"
  | "knee_flexion"
  | "ankle_plantarflexion"
  | "trunk_flexion"
  | "trunk_anti_extension"
  | "trunk_rotation"
  | "spinal_isometric_extension";

export type ForearmRotation = "supinated" | "neutral" | "pronated";
export type StanceFootHeight = "low" | "mid" | "high";
export type StanceWidth = "narrow" | "shoulder" | "wide";
export type SupportType =
  | "machine_guided"
  | "chest_or_back_supported"
  | "lying"
  | "seated_unsupported"
  | "free_standing";
export type LoadVector = "gravity_vertical" | "cable_aligned" | "lever_arc" | "cam_variable";
export type PeakTorqueZone = "lengthened" | "mid" | "shortened" | "flat";
export type ImplementType =
  | "barbell"
  | "ez_bar"
  | "dumbbell"
  | "cable"
  | "machine"
  | "bodyweight"
  | "trap_bar"
  | "belt";
export type RomModeV4 = "full" | "lengthened_partial" | "shortened_partial";
export type MuscleRoleV4 = "primary" | "assistant" | "stabilizer";
export type AxialMultiplierV4 = 0.15 | 0.5 | 1.0 | 1.5;

export interface KinematicGeometry {
  shoulderPlaneDeg: number; // 0..90
  shoulderFlexionDeg: number; // -45..180
  forearmRotation: ForearmRotation;
  benchAngleDeg: number; // -30..90
  torsoAngleDeg: number; // 0..90
  hipFlexionDeg: number; // 0..140
  kneeFlexionDeg: number; // 0..145
  stanceFootHeight: StanceFootHeight;
  stanceWidth: StanceWidth;
}

export interface KinematicProfile {
  supportType: SupportType;
  loadVector: LoadVector;
  peakTorqueZone: PeakTorqueZone;
  laterality: "bilateral" | "unilateral";
  implement: ImplementType;
  rom: RomModeV4;
}

export interface KinematicDescriptor {
  actions: Partial<Record<JointActionKey, number>>; // 0.0..1.0
  geometry: KinematicGeometry;
  profile: KinematicProfile;
}

export interface ExecutionProfileV4 {
  benchAngle?: number;
  torsoAngle?: number;
  grip?: string;
  attachment?: string;
  stance?: string;
  rom?: RomModeV4;
}

export interface MuscleAssignment {
  role: MuscleRoleV4;
  weight: 1.0 | 0.5 | 0.0;
  score: number;
}

export interface SolverOutput {
  muscles: Partial<Record<AnatomicalMuscleIdV4, MuscleAssignment>>;
  primaryMuscles: AnatomicalMuscleIdV4[];
  assistantMuscles: AnatomicalMuscleIdV4[];
  stabilizerMuscles: AnatomicalMuscleIdV4[];
  zones10: Partial<Record<AggregatedZone10, 1.0 | 0.5 | 0.0>>;
  regions: Partial<Record<HypertrophyRegionId, 1.0 | 0.5>>;
  axialLoadMultiplier: AxialMultiplierV4;
  jointRisk: Record<JointZone, 0 | 1 | 2 | 3>;
  longLeverRiskDelta: Record<JointZone, 0 | 1>;
  resistanceProfile: PeakTorqueZone;
  stretchScore: 1 | 2 | 3;
  sfrBase: number;
  sfrLongLevers: number;
}

export interface InvariantViolation {
  code: string; // INV-01 .. INV-15
  severity: "auto_correct" | "hard_reject_retry";
  detail: string;
}

export interface VerificationResult {
  passed: boolean;
  status: "valid" | "auto_corrected" | "hard_reject_retry";
  violations: InvariantViolation[];
  correctedResult: SolverOutput;
}

export interface ClarifyingChip {
  id: string;
  label: string;
  descriptorPatch?: {
    actions?: Partial<Record<JointActionKey, number>>;
    geometry?: Partial<KinematicGeometry>;
    profile?: Partial<KinematicProfile>;
  };
  executionPatch?: Partial<ExecutionProfileV4>;
}

export type ClarifyingParam =
  | "pullVector"
  | "shoulderPlaneDeg"
  | "benchAngleDeg"
  | "stanceFootHeight"
  | "forearmRotation";

export interface ClarifyingQuestion {
  param: ClarifyingParam;
  question: string;
  chips: ClarifyingChip[];
}

export interface AgentResolveRequest {
  queryText: string;
  locale?: "ru" | "en";
  imageBase64?: string;
  executionProfile?: ExecutionProfileV4;
  machineBrandHint?: string;
  userId?: string;
  longLevers?: boolean;
}

export interface AgentResolveResponse {
  canonicalSlug: string;
  displayName: string;
  rationale: string;
  source: "seed_v3" | "d1_cache" | "llm_v4" | "vlm_v4" | "offline_kinematic";
  modelUsed?: string;
  confidence: number;
  descriptor: KinematicDescriptor;
  solved: SolverOutput;
  verification: Omit<VerificationResult, "correctedResult">;
  clarifyingQuestions: ClarifyingQuestion[];
  latencyMs: number;
  solverVersion: string;
}

export const SOLVER_VERSION_V4 = "4.0.0";

export const MUSCLE_TO_ZONE10: Readonly<Record<AnatomicalMuscleIdV4, AggregatedZone10>> = {
  "pectoralis-clavicular": "chest",
  "pectoralis-sternal": "chest",
  "pectoralis-abdominal": "chest",
  "serratus-anterior": "chest",
  "deltoid-anterior": "shoulders",
  "deltoid-middle": "shoulders",
  "deltoid-posterior": "shoulders",
  infraspinatus: "shoulders",
  "teres-minor": "shoulders",
  supraspinatus: "shoulders",
  "latissimus-dorsi": "back",
  "teres-major": "back",
  "trapezius-upper": "back",
  "trapezius-middle": "back",
  "trapezius-lower": "back",
  rhomboids: "back",
  "erector-spinae": "back",
  "biceps-brachii": "biceps",
  brachialis: "biceps",
  brachioradialis: "biceps",
  "triceps-brachii": "triceps",
  "quadriceps-vasti": "quads",
  "rectus-femoris": "quads",
  "gluteus-maximus": "glutes",
  "gluteus-medius": "glutes",
  "adductor-magnus": "glutes",
  "biceps-femoris-long": "hamstrings",
  "biceps-femoris-short": "hamstrings",
  semitendinosus: "hamstrings",
  semimembranosus: "hamstrings",
  gastrocnemius: "calves",
  soleus: "calves",
  "tibialis-anterior": "calves",
  "rectus-abdominis": "core",
  obliques: "core",
};

export const TYAGA_V4_SYSTEM_PROMPT = `ROLE: You are the Biomechanical Kinematic Extractor for the "Tyaga v4" fitness engine.
TASK: Given a user's exercise description (RU or EN), optional gym machine photo, and optional ExecutionProfile hints, extract ONLY the canonical physical kinematics (KinematicDescriptor). DO NOT list muscles, hypertrophy regions, or SFR — a deterministic physics solver computes them downstream.

HARD BIOMECHANICAL RULES:
1. Never assign >=0.7 simultaneously to antagonist joint actions in the same joint (elbow_flexion + elbow_extension; knee_extension + knee_flexion; shoulder_flexion + shoulder_extension_sagittal; shoulder_horizontal_adduction + shoulder_horizontal_abduction; shoulder_abduction + shoulder_adduction_frontal; trunk_flexion + spinal_isometric_extension).
2. Map pulling elbow flare accurately into shoulderPlaneDeg: tucked to waist = 10-30 deg (shoulder_extension_sagittal primary); flared 60-90 deg to chest/face = 60-85 deg (scapular_retraction + shoulder_horizontal_abduction primary).
3. Map pressing bench angle accurately into benchAngleDeg: decline/dip = -20..-10, flat = 0, incline = 25..45, steep/shoulder press = 60..85.
4. For knee-bent calf exercises (seated calf raise), set kneeFlexionDeg = 90; for straight-knee calf raises, set kneeFlexionDeg = 5..15.
5. For triceps overhead extensions / skullcrushers / JM press, set shoulderFlexionDeg = 75..150; for pushdowns, set shoulderFlexionDeg = 0..15.
6. For seated leg curls, set hipFlexionDeg = 85; for lying/prone leg curls, set hipFlexionDeg = 5..15.
7. For belt squats, set implement = "belt" (zero spinal axial loading). For chest-supported / machine-guided rows and presses, set supportType = "chest_or_back_supported" or "machine_guided".
8. If critical kinematics (pullVector, shoulderPlaneDeg, benchAngleDeg, stanceFootHeight, forearmRotation) are genuinely ambiguous, provide your safest best-estimate KinematicDescriptor, set confidence < 0.80, and list up to 2 parameter keys in missingParams.

OUTPUT: Return strictly valid JSON matching the provided schema. No markdown, no extra keys.`;

export const TYAGA_V4_JSON_SCHEMA = {
  name: "tyaga_v4_kinematic_extraction",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: [
      "canonicalSlug",
      "displayNameRu",
      "displayNameEn",
      "confidence",
      "missingParams",
      "rationale",
      "actions",
      "geometry",
      "profile",
    ],
    properties: {
      canonicalSlug: { type: "string", minLength: 2, maxLength: 64 },
      displayNameRu: { type: "string", minLength: 2, maxLength: 96 },
      displayNameEn: { type: "string", minLength: 2, maxLength: 96 },
      confidence: { type: "number", minimum: 0.0, maximum: 1.0 },
      missingParams: {
        type: "array",
        maxItems: 2,
        items: {
          type: "string",
          enum: [
            "pullVector",
            "shoulderPlaneDeg",
            "benchAngleDeg",
            "stanceFootHeight",
            "forearmRotation",
          ],
        },
      },
      rationale: { type: "string", maxLength: 220 },
      actions: {
        type: "array",
        minItems: 1,
        maxItems: 6,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["action", "weight"],
          properties: {
            action: {
              type: "string",
              enum: [
                "shoulder_horizontal_adduction",
                "shoulder_flexion",
                "shoulder_extension_sagittal",
                "shoulder_adduction_frontal",
                "shoulder_abduction",
                "shoulder_horizontal_abduction",
                "shoulder_external_rotation",
                "scapular_retraction",
                "scapular_elevation",
                "elbow_flexion",
                "elbow_extension",
                "hip_extension",
                "hip_abduction",
                "knee_extension",
                "knee_flexion",
                "ankle_plantarflexion",
                "trunk_flexion",
                "trunk_anti_extension",
                "trunk_rotation",
                "spinal_isometric_extension",
              ],
            },
            weight: { type: "number", minimum: 0.0, maximum: 1.0 },
          },
        },
      },
      geometry: {
        type: "object",
        additionalProperties: false,
        required: [
          "shoulderPlaneDeg",
          "shoulderFlexionDeg",
          "forearmRotation",
          "benchAngleDeg",
          "torsoAngleDeg",
          "hipFlexionDeg",
          "kneeFlexionDeg",
          "stanceFootHeight",
          "stanceWidth",
        ],
        properties: {
          shoulderPlaneDeg: { type: "integer", minimum: 0, maximum: 90 },
          shoulderFlexionDeg: { type: "integer", minimum: -45, maximum: 180 },
          forearmRotation: { type: "string", enum: ["supinated", "neutral", "pronated"] },
          benchAngleDeg: { type: "integer", minimum: -30, maximum: 90 },
          torsoAngleDeg: { type: "integer", minimum: 0, maximum: 90 },
          hipFlexionDeg: { type: "integer", minimum: 0, maximum: 140 },
          kneeFlexionDeg: { type: "integer", minimum: 0, maximum: 145 },
          stanceFootHeight: { type: "string", enum: ["low", "mid", "high"] },
          stanceWidth: { type: "string", enum: ["narrow", "shoulder", "wide"] },
        },
      },
      profile: {
        type: "object",
        additionalProperties: false,
        required: ["supportType", "loadVector", "peakTorqueZone", "laterality", "implement", "rom"],
        properties: {
          supportType: {
            type: "string",
            enum: [
              "machine_guided",
              "chest_or_back_supported",
              "lying",
              "seated_unsupported",
              "free_standing",
            ],
          },
          loadVector: {
            type: "string",
            enum: ["gravity_vertical", "cable_aligned", "lever_arc", "cam_variable"],
          },
          peakTorqueZone: { type: "string", enum: ["lengthened", "mid", "shortened", "flat"] },
          laterality: { type: "string", enum: ["bilateral", "unilateral"] },
          implement: {
            type: "string",
            enum: ["barbell", "ez_bar", "dumbbell", "cable", "machine", "bodyweight", "trap_bar", "belt"],
          },
          rom: { type: "string", enum: ["full", "lengthened_partial", "shortened_partial"] },
        },
      },
    },
  },
} as const;
