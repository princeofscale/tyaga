import { CATALOG_V1 } from "../data/catalog-v1";
import { CATALOG_V2 } from "../data/catalog-v2";
import type { Exercise, WorkoutExercise } from "./types";
import { ExerciseCatalog } from "../domain/ExerciseCatalog";
export { ANATOMICAL_MUSCLES, MUSCLES } from "../data/muscles";
export { EVIDENCE, evidenceById } from "../data/evidence";
export const CATALOG_REVISION = 2;
export const EXERCISES = CATALOG_V2;
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
export const exerciseCatalog = new ExerciseCatalog(CATALOG_V2, legacy);
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
    displayNameSnapshot: e.name,
    ...(e.source ? { externalDefinition: e } : {}),
    ...(e.recording.laterality === "unilateral"
      ? { performedSides: "both" as const }
      : {}),
  };
}
export function recordingLabel(we: WorkoutExercise) {
  const spec = exerciseForEntry(we)?.recording;
  if (!spec || spec.loadMode === "legacy_unspecified")
    return "кг · правило веса не указано";
  if (spec.loadMode === "bodyweight") return "без внешнего веса";
  if (spec.loadMode === "assisted_bodyweight") return "кг помощи";
  if (spec.loadMode === "added_bodyweight") return "кг дополнительного веса";
  if (spec.loadMode === "machine_stack") return "кг на тренажёре";
  if (spec.loadMode === "per_implement") return "кг одной гантели";
  return "кг общего веса";
}
export const progressKey = (we: WorkoutExercise) =>
  JSON.stringify([
    we.exerciseId,
    we.catalogRevision ?? 1,
    we.equipmentNote ?? "",
    we.performedSides ?? "both",
  ]);
export const recordedLoad = (
  we: WorkoutExercise,
  set: WorkoutExercise["sets"][number],
) =>
  exerciseForEntry(we)?.recording.loadMode === "assisted_bodyweight"
    ? (set.assistanceKg ?? 0)
    : set.weight;
