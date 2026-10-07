import {
  exerciseById,
  MUSCLES,
  localDate,
  validTimeZone,
  type Workout,
  type Settings,
  type WorkoutExercise,
  type Exercise,
  type Routine,
} from "../src/lib/model";
export class InputError extends Error {}
export const object = (v: unknown): Record<string, unknown> => {
  if (!v || typeof v !== "object" || Array.isArray(v))
    throw new InputError("Некорректные данные");
  return v as Record<string, unknown>;
};
export function str(v: unknown, max: number, min = 0) {
  if (typeof v !== "string" || v.length > max || v.trim().length < min)
    throw new InputError("Проверьте текстовые поля");
  return v.trim();
}
export function num(v: unknown, min: number, max: number, integer = false) {
  if (
    typeof v !== "number" ||
    !Number.isFinite(v) ||
    v < min ||
    v > max ||
    (integer && !Number.isInteger(v))
  )
    throw new InputError("Проверьте числовые поля");
  return v;
}
function bool(v: unknown) {
  if (typeof v !== "boolean") throw new InputError("Некорректное значение");
  return v;
}
export const validRevision = (v: unknown) => num(v ?? 0, 0, 2147483646, true);
function zone(v: unknown, fallback = "UTC") {
  const value = v === undefined ? fallback : str(v, 80, 1);
  if (!validTimeZone(value))
    throw new InputError(
      "Укажите часовой пояс IANA, например Europe/Amsterdam",
    );
  return value;
}
export function validWorkout(
  value: unknown,
  options: {
    now?: Date;
    timeZone?: string;
    importedExercises?: Map<string, Exercise>;
    allowIncomplete?: boolean;
  } = {},
): Workout {
  const w = object(value);
  const date = str(w.date, 10);
  const timeZone = zone(w.timeZone, options.timeZone);
  const parsedDate = new Date(date + "T12:00:00Z");
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !Number.isFinite(parsedDate.getTime()) ||
    parsedDate.toISOString().slice(0, 10) !== date
  )
    throw new InputError("Проверьте дату");
  if (date > localDate(options.now ?? new Date(), timeZone))
    throw new InputError(
      "Дата тренировки не может быть в будущем в выбранном часовом поясе",
    );
  if (
    !Array.isArray(w.exercises) ||
    !w.exercises.length ||
    w.exercises.length > 30
  )
    throw new InputError("Добавьте хотя бы одно упражнение");
  const seen = new Set<string>();
  const setIds = new Set<string>();
  const exercises: WorkoutExercise[] = w.exercises.map((value) => {
    const e = object(value);
    const exerciseId = str(e.exerciseId, 80, 1);
    const catalogRevision = num(e.catalogRevision ?? 1, 1, 3, true) as
      1 | 2 | 3;
    const exercise =
      catalogRevision === 3
        ? options.importedExercises?.get(exerciseId)
        : exerciseById(exerciseId, catalogRevision);
    if (
      !exercise ||
      exercise.catalogRevision !== catalogRevision ||
      seen.has(exerciseId)
    )
      throw new InputError("Некорректное упражнение или версия каталога");
    seen.add(exerciseId);
    if (exercise.source && !exercise.source.record.loggable)
      throw new InputError(
        "Эта служебная запись каталога не добавляется в тренировку.",
      );
    const metadata: Omit<WorkoutExercise, "sets"> = { exerciseId };
    if (e.catalogRevision !== undefined) {
      if (
        num(e.recordingSpecRevision, 1, 3, true) !== catalogRevision ||
        num(e.muscleMappingRevision, 1, 3, true) !== catalogRevision
      )
        throw new InputError("Версии упражнения не согласованы");
      metadata.catalogRevision = catalogRevision;
      metadata.recordingSpecRevision = catalogRevision;
      metadata.muscleMappingRevision = catalogRevision;
      metadata.displayNameSnapshot = str(e.displayNameSnapshot, 120, 1);
      if (metadata.displayNameSnapshot !== exercise.name)
        throw new InputError("Название не соответствует версии каталога");
      // Ignore client-provided definitions. Only the immutable database record is trusted.
      if (catalogRevision === 3) metadata.externalDefinition = exercise;
    }
    if (e.equipmentNote !== undefined)
      metadata.equipmentNote = str(e.equipmentNote, 120);
    if (e.progressionNote !== undefined)
      metadata.progressionNote = str(e.progressionNote, 500);
    if (
      catalogRevision === 2 &&
      ["machine_stack", "assisted_bodyweight"].includes(
        exercise.recording.loadMode,
      ) &&
      !metadata.equipmentNote &&
      !options.allowIncomplete
    )
      throw new InputError(
        `Укажи тренажёр для «${exercise.name}», чтобы не сравнивать разные машины`,
      );
    if (exercise.recording.laterality === "unilateral") {
      if (!["both", "left", "right"].includes(String(e.performedSides)))
        throw new InputError("Укажи выполненные стороны");
      metadata.performedSides =
        e.performedSides as WorkoutExercise["performedSides"];
    } else if (e.performedSides !== undefined)
      throw new InputError("Стороны не поддерживаются этим вариантом");
    if (e.bodyMassKg !== undefined) {
      if (
        !["bodyweight", "added_bodyweight", "assisted_bodyweight"].includes(
          exercise.recording.loadMode,
        )
      )
        throw new InputError("Масса тела не относится к этому правилу записи");
      metadata.bodyMassKg = num(e.bodyMassKg, 20, 400);
    }
    if (!Array.isArray(e.sets) || !e.sets.length || e.sets.length > 30)
      throw new InputError("Добавьте подходы");
    const sets = e.sets.map((value) => {
      const s = object(value);
      const id = str(s.id, 80, 1);
      if (setIds.has(id)) throw new InputError("Повторяющийся ID подхода");
      setIds.add(id);
      const set = {
        id,
        weight: num(s.weight, 0, 1000),
        reps:
          exercise.recording.type === "duration"
            ? 1
            : num(s.reps, 1, 200, true),
        rir: s.rir === null ? null : num(s.rir, 0, 10),
        done: bool(s.done),
        warmup: bool(s.warmup),
        ...(exercise.recording.loadMode === "assisted_bodyweight"
          ? { assistanceKg: num(s.assistanceKg, 0, 1000) }
          : {}),
        ...(exercise.recording.type === "duration"
          ? { durationSeconds: num(s.durationSeconds, 1, 86400, true) }
          : {}),
        ...(exercise.recording.type === "duration" && s.distanceKm !== undefined
          ? { distanceKm: num(s.distanceKm, 0, 1000) }
          : {}),
      };
      if (
        ["bodyweight", "assisted_bodyweight"].includes(
          exercise.recording.loadMode,
        ) &&
        set.weight !== 0
      )
        throw new InputError("Для этого варианта внешний вес не записывается");
      if (
        exercise.recording.loadMode !== "assisted_bodyweight" &&
        s.assistanceKg !== undefined
      )
        throw new InputError(
          "Помощь поддерживается только в ассистированном варианте",
        );
      return set;
    });
    return { ...metadata, sets };
  });
  if (
    !options.allowIncomplete &&
    !exercises.some((e) => e.sets.some((s) => s.done && !s.warmup))
  )
    throw new InputError("Отметьте хотя бы один выполненный рабочий подход");
  const result: Workout = {
    id: str(w.id, 80, 1),
    name: str(w.name, 120, 1),
    date,
    duration: num(w.duration, 0, 1440),
    notes: str(w.notes, 2000),
    exercises,
    revision: validRevision(w.revision),
  };
  if (w.timeZone !== undefined) result.timeZone = timeZone;
  if (w.createdAt !== undefined) {
    const stamp = str(w.createdAt, 40, 1);
    if (!Number.isFinite(Date.parse(stamp)))
      throw new InputError("Проверьте время создания");
    result.createdAt = stamp;
  }
  if (w.analysisVersion !== undefined)
    result.analysisVersion = num(w.analysisVersion, 1, 2, true) as 1 | 2;
  if (w.routineId !== undefined) result.routineId = str(w.routineId, 80, 1);
  if (w.restSeconds !== undefined)
    result.restSeconds = num(w.restSeconds, 15, 600, true);
  return result;
}
export function validRoutine(
  value: unknown,
  importedExercises: Map<string, Exercise>,
): Routine {
  const v = object(value);
  if (
    !Array.isArray(v.days) ||
    v.days.length > 7 ||
    new Set(v.days).size !== v.days.length
  )
    throw new InputError("Проверь дни программы");
  const repMin = num(v.repMin, 1, 200, true),
    repMax = num(v.repMax, repMin, 200, true);
  if (!["repeat", "double"].includes(String(v.progression)))
    throw new InputError("Проверь правило прогрессии");
  const exercises = validWorkout(
    {
      id: "routine-validation",
      name: "Программа",
      date: localDate(new Date(), "UTC"),
      duration: 0,
      notes: "",
      exercises: v.exercises,
    },
    { timeZone: "UTC", importedExercises, allowIncomplete: true },
  ).exercises;
  if (!exercises.some((e) => e.sets.some((s) => !s.warmup)))
    throw new InputError("Добавь хотя бы один рабочий подход в программу");
  return {
    id: str(v.id, 80, 1),
    name: str(v.name, 120, 1),
    notes: str(v.notes, 2000),
    days: v.days.map((d) => num(d, 0, 6, true)),
    exercises: exercises.map((e) => ({
      ...e,
      sets: e.sets.map((s) => ({ ...s, done: false })),
    })),
    restSeconds: num(v.restSeconds, 15, 600, true),
    progression: v.progression as Routine["progression"],
    repMin,
    repMax,
    incrementKg: num(v.incrementKg, 0.25, 50),
    revision: validRevision(v.revision),
  };
}
export function validSettings(value: unknown): Settings {
  const v = object(value);
  const goals = object(v.goals);
  if (!["gym", "dumbbells", "bodyweight"].includes(String(v.equipment)))
    throw new InputError("Проверьте оборудование");
  return {
    goals: Object.fromEntries(
      MUSCLES.map((m) => [m.id, num(goals[m.id], 1, 40, true)]),
    ) as Settings["goals"],
    equipment: v.equipment as Settings["equipment"],
    restSeconds: num(v.restSeconds, 15, 600, true),
    revision: validRevision(v.revision),
    ...(v.timeZone !== undefined ? { timeZone: zone(v.timeZone) } : {}),
  };
}
