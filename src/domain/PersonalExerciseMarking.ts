import type { Exercise } from "../lib/types";

export type Marking = { zones?: string[]; basedOn?: string };

/**
 * Массовая разметка «Моих»: тело запроса для `PUT /api/custom-exercises` строится из уже сохранённого упражнения,
 * так что название, правило веса и происхождение (например, «strong») остаются, а добавляются только мышцы.
 */
export class PersonalExerciseMarking {
  /** «На время» нельзя привязать к движению с повторами — только отметить группы мышц. */
  static canBaseOn(exercise: Exercise) {
    return (exercise.recording.type ?? "reps") === "reps";
  }

  static payload(exercise: Exercise, marking: Marking) {
    const custom = exercise.custom;
    if (!custom) throw new Error("Это не личное упражнение");
    const zones = marking.zones ?? custom.declaredZones ?? [];
    return {
      familyId: custom.familyId,
      name: exercise.name,
      nameEn: exercise.nameEn ?? "",
      aliases: exercise.aliases ?? [],
      notes: exercise.tip ?? "",
      equipment: exercise.equipment,
      declaredZones: [...new Set(zones)],
      basedOnExerciseId: marking.basedOn && this.canBaseOn(exercise) ? marking.basedOn : (custom.basedOnExerciseId ?? ""),
      ...(custom.origin ? { origin: custom.origin } : {}),
      recording: {
        type: exercise.recording.type ?? "reps",
        loadMode: exercise.recording.loadMode,
        implementCount: exercise.recording.implementCount ?? 1,
        laterality: exercise.recording.laterality ?? "bilateral",
      },
    };
  }
}
