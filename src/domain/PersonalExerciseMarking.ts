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

  /** Уже размечено: есть группы мышц, роли или привязка к движению каталога — такое не переписываем молча. */
  static hasMarking(exercise: Exercise) {
    return !!(
      exercise.custom?.declaredZones?.length ||
      exercise.custom?.basedOnExerciseId ||
      exercise.primary.length ||
      exercise.muscles.length
    );
  }

  /** Делит выбранное на уже размеченное и без разметки (для предупреждения «Заменить разметку у N?»). */
  static split(exercises: Exercise[]) {
    return { marked: exercises.filter((e) => this.hasMarking(e)), unmarked: exercises.filter((e) => !this.hasMarking(e)) };
  }

  /**
   * Упражнение каталога без мышц получает свою размеченную копию (`origin: "catalog:<id>"`): история по каталожному
   * id берёт мышцы из неё, название и правило записи остаются теми же.
   */
  static copyPayload(exercise: Exercise, marking: Marking, familyId: string) {
    const equipment = ["gym", "dumbbells", "bodyweight"].includes(String(exercise.equipment)) ? exercise.equipment : "gym";
    return {
      familyId,
      name: exercise.name,
      nameEn: exercise.nameEn ?? "",
      aliases: (exercise.aliases ?? []).slice(0, 20),
      notes: "",
      equipment,
      declaredZones: [...new Set(marking.zones ?? [])],
      basedOnExerciseId: marking.basedOn && this.canBaseOn(exercise) ? marking.basedOn : "",
      origin: `catalog:${exercise.id}`,
      recording: {
        type: exercise.recording.type ?? "reps",
        loadMode: exercise.recording.loadMode,
        implementCount: exercise.recording.implementCount ?? 1,
        laterality: exercise.recording.laterality ?? "bilateral",
      },
    };
  }

  static payload(exercise: Exercise, marking: Marking) {
    const custom = exercise.custom;
    if (!custom) throw new Error("Это не личное упражнение");
    const zones = marking.zones ?? custom.declaredZones ?? [];
    const basedOnExerciseId =
      marking.basedOn && this.canBaseOn(exercise) ? marking.basedOn : (custom.basedOnExerciseId ?? "");
    const muscleRoles =
      !basedOnExerciseId && exercise.muscles.length
        ? exercise.muscles.map(({ muscleId, role }) => ({ muscleId, role }))
        : undefined;
    return {
      familyId: custom.familyId,
      name: exercise.name,
      nameEn: exercise.nameEn ?? "",
      aliases: exercise.aliases ?? [],
      notes: exercise.tip ?? "",
      equipment: exercise.equipment,
      declaredZones: [...new Set(zones)],
      basedOnExerciseId,
      ...(muscleRoles ? { muscleRoles } : {}),
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
