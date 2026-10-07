import type { Exercise, Routine, Settings, Workout } from "../lib/types";
import { normalizeSearch } from "../lib/search";
export type ImportFormat = "strong" | "hevy" | "fitnotes" | "tyaga";
export type ImportOptions = {
  dateOrder: "dmy" | "mdy";
  weightUnit: "kg" | "lb";
  distanceUnit: "km" | "m" | "mi";
  timeZone: string;
};
export type ImportedSet = {
  weight: number;
  reps: number;
  rir: number | null;
  warmup: boolean;
  done: boolean;
  durationSeconds?: number;
  distanceKm?: number;
};
export type ImportedExercise = {
  sourceName: string;
  displayName: string;
  exerciseId?: string;
  definition?: Exercise;
  type: "reps" | "duration";
  sets: ImportedSet[];
  equipmentNote?: string;
  performedSides?: "both" | "left" | "right";
  bodyMassKg?: number;
  catalogRevision?: 1 | 2 | 3;
};
export type ImportedWorkout = {
  sourceKey: string;
  nativeId?: string;
  name: string;
  date: string;
  duration: number;
  notes: string;
  timeZone: string;
  exercises: ImportedExercise[];
  routineId?: string;
  restSeconds?: number;
};
export type ImportPreview = {
  format: ImportFormat;
  workouts: ImportedWorkout[];
  exerciseNames: string[];
  setCount: number;
  warnings: string[];
  extras?: {
    routines: Routine[];
    customExercises: Exercise[];
    favorites: string[];
    settings?: Settings;
  };
};
const months = [
  "jan",
  "feb",
  "mar",
  "apr",
  "may",
  "jun",
  "jul",
  "aug",
  "sep",
  "oct",
  "nov",
  "dec",
];
function unitFactor(value: string, kind: "weight" | "distance") {
  const key = value.trim().toLowerCase();
  const factors: Record<string, number> =
    kind === "weight"
      ? {
          kg: 1,
          kgs: 1,
          kilogram: 1,
          kilograms: 1,
          кг: 1,
          lb: 0.45359237,
          lbs: 0.45359237,
          pound: 0.45359237,
          pounds: 0.45359237,
        }
      : {
          km: 1,
          kilometer: 1,
          kilometers: 1,
          kilometre: 1,
          kilometres: 1,
          км: 1,
          m: 0.001,
          meter: 0.001,
          meters: 0.001,
          metre: 0.001,
          metres: 0.001,
          м: 0.001,
          mi: 1.609344,
          mile: 1.609344,
          miles: 1.609344,
        };
  if (!Object.hasOwn(factors, key))
    throw new Error(
      `Неизвестная единица ${kind === "weight" ? "веса" : "дистанции"} «${value}»`,
    );
  return factors[key];
}
function day(value: string, order: "dmy" | "mdy") {
  const iso = value.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  const european = value.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})/);
  const english = value.match(/^(\d{1,2})\s+([a-z]{3,9})\s+(\d{4})/i);
  let y: number, m: number, d: number;
  if (iso) {
    y = +iso[1];
    m = +iso[2];
    d = +iso[3];
  } else if (european) {
    y = +european[3];
    m = order === "dmy" ? +european[2] : +european[1];
    d = order === "dmy" ? +european[1] : +european[2];
  } else if (english) {
    y = +english[3];
    m = months.indexOf(english[2].slice(0, 3).toLowerCase()) + 1;
    d = +english[1];
  } else
    throw new Error(
      `Не удалось прочитать дату «${value}». Выбери порядок дня и месяца или используй ГГГГ-ММ-ДД.`,
    );
  const result = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  if (new Date(result + "T12:00:00Z").toISOString().slice(0, 10) !== result)
    throw new Error(`Некорректная дата «${value}».`);
  return result;
}
function numeric(value: string, fallback = 0) {
  if (!value.trim()) return fallback;
  const result = Number(value.trim().replace(",", "."));
  if (!Number.isFinite(result) || result < 0)
    throw new Error(`Некорректное число «${value}».`);
  return result;
}
function seconds(value: string) {
  if (!value.trim()) return 0;
  if (/^\d+(\.\d+)?$/.test(value.trim())) return Math.round(Number(value));
  if (/^\d+:\d{2}(:\d{2})?$/.test(value.trim()))
    return value
      .trim()
      .split(":")
      .reduce((a, b) => a * 60 + Number(b), 0);
  const units = [
    ...value.matchAll(
      /(\d+(?:\.\d+)?)\s*(h(?:ours?)?|m(?:in(?:utes?)?)?|s(?:ec(?:onds?)?)?)/gi,
    ),
  ];
  if (!units.length)
    throw new Error(`Не удалось прочитать длительность «${value}».`);
  return Math.round(
    units.reduce(
      (total, m) =>
        total +
        Number(m[1]) * ({ h: 3600, m: 60, s: 1 }[m[2][0].toLowerCase()] ?? 1),
      0,
    ),
  );
}
export class CsvTable {
  parse(text: string): string[][] {
    text = text.replace(/^\uFEFF/, "");
    const first = text.split(/\r?\n/)[0];
    const separator =
      first.split(";").length > first.split(",").length ? ";" : ",";
    const rows: string[][] = [];
    let row: string[] = [],
      cell = "",
      quoted = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (c === '"') {
        if (quoted && text[i + 1] === '"') {
          cell += '"';
          i++;
        } else if (!cell || quoted) quoted = !quoted;
        else cell += c;
      } else if (c === separator && !quoted) {
        row.push(cell);
        cell = "";
      } else if ((c === "\n" || c === "\r") && !quoted) {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(cell);
        if (row.some((v) => v.trim())) rows.push(row);
        row = [];
        cell = "";
      } else cell += c;
    }
    if (quoted) throw new Error("CSV содержит незакрытые кавычки.");
    row.push(cell);
    if (row.some((v) => v.trim())) rows.push(row);
    if (rows.length < 2) throw new Error("В CSV нет записей тренировок.");
    if (rows.some((r) => r.length !== rows[0].length))
      throw new Error(
        "В строках CSV различается число столбцов. Проверь файл экспорта.",
      );
    if (rows.length > 20001)
      throw new Error("В одном файле поддерживается до 20 000 подходов.");
    return rows;
  }
}
export class WorkoutImport {
  constructor(private options: ImportOptions) {}
  parse(text: string, format: ImportFormat): ImportPreview {
    if (text.length > 10000000)
      throw new Error("Размер файла — не более 10 МБ.");
    if (format === "tyaga") return this.native(text);
    const [header, ...rows] = new CsvTable().parse(text);
    const columns = header.map((h) => normalizeSearch(h).replace(/ /g, "_"));
    const lookup = (row: string[], ...keys: string[]) => {
      for (const key of keys) {
        const i = columns.indexOf(key);
        if (i !== -1) return row[i];
      }
      return "";
    };
    const required =
      format === "hevy"
        ? ["start_time", "exercise_title"]
        : format === "strong"
          ? ["date", "exercise_name"]
          : ["date", "exercise"];
    if (required.some((k) => !columns.includes(k)))
      throw new Error(
        `Это не CSV ${format}. Не найдены столбцы ${required.join(", ")}.`,
      );
    const sessions = new Map<string, ImportedWorkout>();
    rows.forEach((row, index) => {
      try {
        const start = lookup(row, "start_time", "date"),
          date = day(start, this.options.dateOrder);
        const title =
          lookup(row, "title", "workout_name") || `Тренировка ${date}`;
        const sourceName = lookup(
          row,
          "exercise_title",
          "exercise_name",
          "exercise",
        ).trim();
        if (!sourceName || sourceName.length > 120)
          throw new Error("Проверь название упражнения (до 120 символов)");
        const key = format + "|" + start + "|" + title;
        let workout = sessions.get(key);
        if (!workout) {
          let duration = 0;
          const rawDuration = lookup(row, "duration");
          if (rawDuration) duration = seconds(rawDuration) / 60;
          else {
            const end = lookup(row, "end_time");
            if (end) {
              const diff = Date.parse(end) - Date.parse(start);
              if (Number.isFinite(diff) && diff >= 0) duration = diff / 60000;
            }
          }
          workout = {
            sourceKey: key,
            name: title.slice(0, 120),
            date,
            duration: Math.min(1440, Math.max(0, Math.round(duration))),
            notes: lookup(row, "workout_notes", "description", "notes").slice(
              0,
              2000,
            ),
            timeZone: this.options.timeZone,
            exercises: [],
          };
          sessions.set(key, workout);
        }
        const weightRaw = numeric(
          lookup(row, "weight_kg", "weight_lb", "weight_lbs", "weight"),
        );
        const unit = columns.includes("weight_kg")
          ? "kg"
          : columns.some((c) => c === "weight_lb" || c === "weight_lbs")
            ? "lb"
            : lookup(row, "weight_unit").toLowerCase() ||
              this.options.weightUnit;
        const weight =
          Math.round(weightRaw * unitFactor(unit, "weight") * 10000) / 10000;
        const reps = numeric(lookup(row, "reps")),
          duration = seconds(
            lookup(row, "duration_seconds", "time_s", "seconds", "time"),
          );
        const distance = numeric(
          lookup(
            row,
            "distance_km",
            "distance_m",
            "distance_miles",
            "distance",
          ),
        );
        const distanceUnit = columns.includes("distance_km")
          ? "km"
          : columns.includes("distance_m")
            ? "m"
            : columns.includes("distance_miles")
              ? "mi"
              : lookup(row, "distance_unit").toLowerCase() ||
                this.options.distanceUnit;
        const distanceKm = distance * unitFactor(distanceUnit, "distance");
        const type = reps > 0 ? "reps" : "duration";
        if (type === "duration" && duration === 0)
          throw new Error("У подхода нет ни повторов, ни времени");
        let exercise = workout.exercises.find(
          (e) => e.sourceName === sourceName && e.type === type,
        );
        if (!exercise) {
          exercise = { sourceName, displayName: sourceName, type, sets: [] };
          workout.exercises.push(exercise);
        }
        if (workout.exercises.length > 30 || exercise.sets.length >= 30)
          throw new Error(
            "Поддерживается до 30 упражнений и 30 подходов на упражнение в сессии",
          );
        const rpe = lookup(row, "rpe").trim(),
          setType = lookup(row, "set_type", "set_order").toLowerCase();
        const effort = rpe ? numeric(rpe) : null;
        if (effort !== null && effort > 10)
          throw new Error("RPE должен быть от 0 до 10");
        const rir = effort === null ? null : 10 - effort;
        exercise.sets.push({
          weight,
          reps: type === "duration" ? 1 : reps,
          rir,
          warmup: /warm|размин|^w$/.test(setType),
          done: true,
          ...(type === "duration"
            ? {
                durationSeconds: duration,
                ...(distance > 0
                  ? { distanceKm: Math.round(distanceKm * 10000) / 10000 }
                  : {}),
              }
            : {}),
        });
      } catch (e) {
        throw new Error(
          `Строка ${index + 2}: ${e instanceof Error ? e.message : "неверные данные"}`,
        );
      }
    });
    const workouts = [...sessions.values()];
    if (workouts.length > 2000)
      throw new Error("В одном импорте поддерживается до 2 000 тренировок.");
    return this.preview(format, workouts, [
      "Веса неизвестных вариантов сохраняются буквально. Дистанции приводятся к км, время — к секундам.",
      "RPE, если он записан, преобразуется в RIR как 10 − RPE. Если усилие не записано, RIR остаётся пустым и не попадает в фильтр ≤3 RIR.",
    ]);
  }
  private native(text: string): ImportPreview {
    let data: any;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error("Не удалось прочитать JSON.");
    }
    if (
      ![1, 2, 3].includes(data.version) ||
      !Array.isArray(data.workouts) ||
      data.workouts.length > 2000
    )
      throw new Error("Это не поддерживаемый экспорт Тяги (версии 1–3).");
    const workouts: ImportedWorkout[] = data.workouts.map((w: Workout) => ({
      sourceKey: `tyaga|${w.id}`,
      nativeId: w.id,
      name: w.name,
      date: w.date,
      duration: w.duration,
      notes: w.notes,
      timeZone: w.timeZone ?? this.options.timeZone,
      routineId: w.routineId,
      restSeconds: w.restSeconds,
      exercises: w.exercises.map((e) => ({
        sourceName: e.displayNameSnapshot ?? e.exerciseId,
        displayName: e.displayNameSnapshot ?? e.exerciseId,
        exerciseId: e.exerciseId,
        definition: e.externalDefinition,
        type: e.externalDefinition?.recording.type ?? "reps",
        sets: e.sets.map(({ id: _id, ...s }) => s),
        catalogRevision: e.catalogRevision ?? 1,
        equipmentNote: e.equipmentNote,
        performedSides: e.performedSides,
        bodyMassKg: e.bodyMassKg,
      })),
    }));
    if (
      !workouts.length &&
      !(
        data.routines?.length ||
        data.customExercises?.length ||
        data.favorites?.length ||
        data.settings
      )
    )
      throw new Error("Экспорт пуст.");
    const result = this.preview("tyaga", workouts, [
      "Существующие записи не заменяются. Версии упражнения и исходные правила веса сохраняются.",
    ]);
    result.extras = {
      routines: Array.isArray(data.routines) ? data.routines : [],
      customExercises: Array.isArray(data.customExercises)
        ? data.customExercises
        : [],
      favorites: Array.isArray(data.favorites) ? data.favorites : [],
      settings: data.settings,
    };
    return result;
  }
  private preview(
    format: ImportFormat,
    workouts: ImportedWorkout[],
    warnings: string[],
  ): ImportPreview {
    return {
      format,
      workouts,
      exerciseNames: [
        ...new Set(
          workouts.flatMap((w) => w.exercises.map((e) => e.sourceName)),
        ),
      ],
      setCount: workouts.reduce(
        (n, w) => n + w.exercises.reduce((m, e) => m + e.sets.length, 0),
        0,
      ),
      warnings,
    };
  }
}
