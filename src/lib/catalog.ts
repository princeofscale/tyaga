import { ExecutionIdentity } from "../domain/ExecutionIdentity";
import { CATALOG_V1 } from "../data/catalog-v1";
import { CATALOG_V2 } from "../data/catalog-v2";
import { CATALOG_V3 } from "../data/catalog-v3";
import type { Exercise, WorkoutExercise } from "./types";
import { ExerciseCatalog } from "../domain/ExerciseCatalog";
import { EXERCISE_ALIASES } from "../data/exercise-aliases";
export { ANATOMICAL_MUSCLES, MUSCLES } from "../data/muscles";
export { EVIDENCE, evidenceById } from "../data/evidence";
export const CATALOG_REVISION = 3;
// Release 3 only adds movements; release 2 stays frozen and is not rewritten.
export const EXERCISES = [...CATALOG_V2, ...CATALOG_V3].map((e) => ({
  ...e,
  aliases: EXERCISE_ALIASES[e.id] ?? [e.nameEn],
}));
const legacy: Exercise[] = CATALOG_V1.map((e) => ({
  ...e,
  catalogRevision: 1,
  familyId: e.id,
  nameEn: "",
  variant: "Вариант и правило веса не были зафиксированы в каталоге 1.",
  jointActions: [],
  recording: {
    loadMode: "legacy_unspecified",
    implementCount: 1,
    laterality: "bilateral",
    repsMode: "total",
    e1rmEligible: false,
  },
  muscles: [],
  evidence: [],
  limitations:
    "Старый каталог сохранён без исправлений. Вес одной гантели или пары, стороны и вариант нельзя восстановить догадкой.",
  provenance: {
    curator: "Tyaga v1",
    reviewedAt: null,
    license: "MIT",
    reviewStatus: "legacy-unreviewed",
  },
}));
export const exerciseCatalog = new ExerciseCatalog(EXERCISES, legacy);
export function exerciseById(id: string, revision: 1 | 2 | 3 = 2) {
  return exerciseCatalog.find(id, revision);
}
export const exerciseForEntry = (we: WorkoutExercise) =>
  exerciseCatalog.forEntry(we);
export const entryName = (we: WorkoutExercise) =>
  we.displayNameSnapshot ?? exerciseForEntry(we)?.name ?? we.exerciseId;
export function entrySpec(id: string): Omit<WorkoutExercise, "sets"> {
  const e = exerciseById(id);
  if (!e) throw new Error("Неизвестное упражнение");
  return {
    exerciseId: id,
    catalogRevision: e.catalogRevision,
    recordingSpecRevision: e.catalogRevision,
    muscleMappingRevision: e.catalogRevision,
    muscleModelRevision: 1,
    displayNameSnapshot: e.name,
    ...(e.source || e.custom ? { externalDefinition: e } : {}),
    ...(e.recording.laterality === "unilateral"
      ? { performedSides: "both" as const }
      : {}),
  };
}
export function recordingLabel(we: WorkoutExercise) {
  const spec = exerciseForEntry(we)?.recording;
  if (spec?.type === "duration") return "длительность в секундах";
  if (!spec || spec.loadMode === "legacy_unspecified")
    return "кг · правило веса не указано";
  if (spec.loadMode === "bodyweight") return "без внешнего веса";
  if (spec.loadMode === "assisted_bodyweight") return "кг помощи";
  if (spec.loadMode === "added_bodyweight") return "кг дополнительного веса";
  if (spec.loadMode === "machine_stack") return "кг на тренажёре";
  if (spec.loadMode === "per_implement") return "кг одной гантели";
  return "кг общего веса";
}
export const progressKey = (we: WorkoutExercise, set?: WorkoutExercise["sets"][number]) =>
  ExecutionIdentity.key(we, set);
export const recordedLoad = (
  we: WorkoutExercise,
  set: WorkoutExercise["sets"][number],
) =>
  exerciseForEntry(we)?.recording.loadMode === "assisted_bodyweight"
    ? (set.assistanceKg ?? 0)
    : set.weight;
