import type { AnatomicalMuscle, Muscle } from "../data/muscles";
export type { Muscle, AnatomicalMuscle } from "../data/muscles";
export type Equipment = "gym" | "dumbbells" | "bodyweight";
export type LegacyExercise = {
  id: string;
  name: string;
  primary: Muscle[];
  secondary: Muscle[];
  equipment: Equipment;
  tip: string;
  bodyweight?: boolean;
};
export type RecordingSpec = {
  type?: "reps" | "duration";
  loadMode:
    | "total_external"
    | "per_implement"
    | "machine_stack"
    | "bodyweight"
    | "added_bodyweight"
    | "assisted_bodyweight"
    | "legacy_unspecified";
  implementCount: 1 | 2;
  laterality: "bilateral" | "unilateral";
  repsMode: "total" | "per_side";
  e1rmEligible: boolean;
};
export type MuscleRole = {
  muscleId: AnatomicalMuscle;
  role: "primary" | "assistant" | "stabilizer";
  confidence: "high" | "moderate";
  basis: "anatomical-inference";
  sources: string[];
};
export type Exercise = LegacyExercise & {
  aliases?: string[];
  custom?: { familyId: string; declaredZones: Muscle[]; origin?: string; basedOnExerciseId?: string };
  catalogRevision: 1 | 2 | 3;
  familyId: string;
  nameEn: string;
  variant: string;
  jointActions: string[];
  recording: RecordingSpec;
  muscles: MuscleRole[];
  evidence: string[];
  limitations: string;
  provenance: {
    curator: string;
    reviewedAt: string | null;
    license: string;
    reviewStatus: "editorial" | "legacy-unreviewed" | "source-unreviewed" | "user-declared";
  };
  source?: {
    provider: "wger";
    release: string;
    importedAt: string;
    record: import("../domain/WgerExercise").WgerRecord;
  };
};
export type SetKind = "normal" | "warmup" | "dropset" | "myorep";

export type SetEntry = {
  id: string;
  weight: number;
  reps: number;
  rir: number | null;
  warmup: boolean;
  done: boolean;
  kind?: SetKind;
  assistanceKg?: number;
  durationSeconds?: number;
  distanceKm?: number;
  performedSides?: "both" | "left" | "right";
  execution?: ExecutionProfile;
};
export type WorkoutExercise = {
  exerciseId: string;
  sets: SetEntry[];
  supersetId?: string;
  /** Planned rep range for this movement. Overrides the routine-wide range. */
  repMin?: number;
  repMax?: number;
  catalogRevision?: 1 | 2 | 3;
  recordingSpecRevision?: 1 | 2 | 3;
  muscleMappingRevision?: 1 | 2 | 3;
  muscleModelRevision?: 1;
  externalDefinition?: Exercise;
  displayNameSnapshot?: string;
  equipmentNote?: string;
  performedSides?: "both" | "left" | "right";
  bodyMassKg?: number;
  progressionNote?: string;
  machineInstanceId?: string;
  machineSnapshot?: MachineInstance;
  execution?: ExecutionProfile;
};
export type Workout = {
  id: string;
  name: string;
  date: string;
  duration: number;
  notes: string;
  exercises: WorkoutExercise[];
  revision?: number;
  timeZone?: string;
  createdAt?: string;
  updatedAt?: string;
  analysisVersion?: 1 | 2;
  routineId?: string;
  restSeconds?: number;
  wearable?: WearableSummary;
};
export type WearableSummary = {
  provider: "apple-health";
  sourceName: string;
  activityType: "HKWorkoutActivityTypeTraditionalStrengthTraining" | "HKWorkoutActivityTypeFunctionalStrengthTraining";
  startedAt: string;
  endedAt: string;
  importedAt: string;
  caloriesKcal?: number;
  energyKind?: "active" | "reported";
  heartRateAverage?: number;
  heartRateMin?: number;
  heartRateMax?: number;
  heartRateSamples: number;
};
/**
 * A repeating block of weeks with one deload week. Week indexes are 0-based and
 * counted from the first saved workout of the routine, so a missed week still
 * advances the cycle instead of stretching it.
 */
export type RoutineCycle = {
  weeks: number;
  deloadWeek: number;
  setFactor: number;
  weightFactor: number;
  deloadRir: number;
};
export type Routine = {
  id: string;
  name: string;
  notes: string;
  days: number[];
  exercises: WorkoutExercise[];
  cycle?: RoutineCycle;
  restSeconds: number;
  progression: "repeat" | "double";
  repMin: number;
  repMax: number;
  incrementKg: number;
  revision: number;
  updatedAt?: string;
};
export type ProductData = {
  machines?: MachineInstance[];
  routines: Routine[];
  customExercises: Exercise[];
  favorites: string[];
  favoriteDefinitions?: Exercise[];
};
export type Settings = {
  goals: Record<Muscle, number>;
  equipment: Equipment;
  restSeconds: number;
  timeZone?: string;
  revision?: number;
};
export type MuscleLoad = {
  id: Muscle;
  name: string;
  short: string;
  direct: number;
  indirect: number;
  stabilizing: number;
  total: number;
  goal: number;
  ratio: number;
};

export type ExecutionProfile = {
  rom?: "full" | "lengthened_partial" | "shortened_partial" | "custom";
  grip?: string;
  stance?: string;
  attachment?: string;
  benchAngle?: number;
  torsoAngle?: number;
  startAngle?: number;
  endAngle?: number;
  tempo?: string;
};
export type MachineModel = {
  id: string;
  manufacturer: string;
  model: string;
  mechanism: "selectorized" | "plate_loaded" | "cable" | "lever" | "smith" | "other";
  loadSemantics: "stack_marking" | "plates_added" | "total_external";
};
export type MachineInstance = {
  id: string;
  model: MachineModel;
  gym: string;
  nickname: string;
  stationId?: string;
  aliases: string[];
  calibration?: { stackRatio?: number; pulleyRatio?: number; notes?: string };
  revision: number;
};

export type ExerciseFamily = { id: string; name: string; variantIds: string[] };
export type ExerciseVariant = { id: string; familyId: string; catalogRevision: Exercise["catalogRevision"]; definition: Exercise };
export type MuscleInvolvement = {
  exerciseVariantId: string;
  catalogRevision: Exercise["catalogRevision"];
  muscleId: AnatomicalMuscle;
  role: MuscleRole["role"];
  confidence: "high" | "moderate" | "low" | "unknown";
  evidenceLevel: "longitudinal" | "biomechanical" | "emg" | "anatomical" | "editorial";
  context?: ExecutionProfile;
  evidenceIds: string[];
  modelRevision: number;
};
