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
  catalogRevision: 1 | 2;
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
    reviewStatus: "editorial" | "legacy-unreviewed";
  };
};
export type SetEntry = {
  id: string;
  weight: number;
  reps: number;
  rir: number;
  warmup: boolean;
  done: boolean;
  assistanceKg?: number;
};
export type WorkoutExercise = {
  exerciseId: string;
  sets: SetEntry[];
  catalogRevision?: 1 | 2;
  recordingSpecRevision?: 1 | 2;
  muscleMappingRevision?: 1 | 2;
  displayNameSnapshot?: string;
  equipmentNote?: string;
  performedSides?: "both" | "left" | "right";
  bodyMassKg?: number;
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
