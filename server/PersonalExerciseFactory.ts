import type { Exercise, Equipment, MuscleRole, RecordingSpec } from "../src/lib/types";
import { ANATOMICAL_MUSCLES, MUSCLES } from "../src/data/muscles";
import { object, str, num, InputError } from "./validation";
import { exerciseById } from "../src/lib/catalog";

export async function digest(text: string) {
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return [...new Uint8Array(hash)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 24);
}
const anatomy = new Map<string, (typeof ANATOMICAL_MUSCLES)[number]>(ANATOMICAL_MUSCLES.map((m) => [m.id, m]));

function readMuscleRoles(input: unknown): MuscleRole[] {
  if (input === undefined) return [];
  if (!Array.isArray(input) || input.length > anatomy.size) throw new InputError("Проверь разметку мышц");
  const seen = new Set<string>();
  const roles = input.map((item): MuscleRole => {
    const { muscleId, role } = object(item);
    const muscle = typeof muscleId === "string" ? anatomy.get(muscleId) : undefined;
    if (!muscle || seen.has(muscle.id) || (role !== "primary" && role !== "assistant" && role !== "stabilizer")) {
      throw new InputError("Проверь разметку мышц");
    }
    seen.add(muscle.id);
    return { muscleId: muscle.id, role, confidence: "moderate", basis: "anatomical-inference", sources: [] };
  });
  if (roles.length && !roles.some((m) => m.role === "primary")) throw new InputError("В разметке нет основных мышц");
  return roles.sort((a, b) => a.muscleId.localeCompare(b.muscleId, "en"));
}

export class PersonalExerciseFactory {
  async create(value: unknown): Promise<Exercise> {
    const v = object(value),
      recording = object(v.recording);
    const familyId = str(v.familyId, 36, 1);
    if (!/^[a-zA-Z0-9-]+$/.test(familyId))
      throw new InputError("Проверь идентификатор упражнения");
    const name = str(v.name, 120, 1);
    if (!["gym", "dumbbells", "bodyweight"].includes(String(v.equipment)))
      throw new InputError("Проверь оборудование");
    if (!Array.isArray(v.aliases) || v.aliases.length > 20)
      throw new InputError("Не больше 20 алиасов");
    const aliases = [...new Set(v.aliases.map((a) => str(a, 120, 1)))];
    if (!aliases.length) aliases.push(name);
    const loadMode = String(recording.loadMode) as RecordingSpec["loadMode"];
    if (
      ![
        "total_external",
        "per_implement",
        "machine_stack",
        "bodyweight",
        "added_bodyweight",
        "assisted_bodyweight",
        "legacy_unspecified",
      ].includes(loadMode)
    )
      throw new InputError("Проверь правило веса");
    if (
      !["reps", "duration"].includes(String(recording.type)) ||
      !["bilateral", "unilateral"].includes(String(recording.laterality))
    )
      throw new InputError("Проверь правило записи");
    const laterality = recording.laterality as RecordingSpec["laterality"];
    const declaredZones = Array.isArray(v.declaredZones)
      ? [...new Set(v.declaredZones.map((z) => str(z, 30, 1)))]
      : [];
    if (declaredZones.some((z) => !MUSCLES.some((m) => m.id === z)))
      throw new InputError("Проверь группы мышц");
    const basedOn = typeof v.basedOnExerciseId === "string" && v.basedOnExerciseId
      ? exerciseById(str(v.basedOnExerciseId, 80, 1), 2) : undefined;
    if (v.basedOnExerciseId && (!basedOn || basedOn.provenance.reviewStatus !== "editorial"))
      throw new InputError("Выбери проверенный базовый вариант движения");
    if (basedOn && recording.type === "duration") throw new InputError("Базовое движение с повторами не подходит для записи времени");
    const personalRoles = readMuscleRoles(v.muscleRoles);
    if (basedOn && personalRoles.length) throw new InputError("Выбери один источник разметки мышц");
    const zonesFor = (role: MuscleRole["role"]) => [...new Set(
      personalRoles.filter((m) => m.role === role).map((m) => anatomy.get(m.muscleId)!.zone),
    )];
    const primary = basedOn?.primary ?? zonesFor("primary");
    const secondary = basedOn?.secondary ?? zonesFor("assistant").filter((zone) => !primary.includes(zone));
    const content = {
      name,
      nameEn: typeof v.nameEn === "string" ? str(v.nameEn, 120) : "",
      aliases,
      tip: str(v.notes, 6000),
      equipment: v.equipment as Equipment,
      recording: {
        type: recording.type as "reps" | "duration",
        loadMode,
        implementCount: num(recording.implementCount, 1, 2, true) as 1 | 2,
        laterality,
        repsMode:
          laterality === "unilateral"
            ? ("per_side" as const)
            : ("total" as const),
        e1rmEligible: false,
      },
      ...(personalRoles.length ? { muscles: personalRoles } : {}),
      custom: {
        familyId,
        declaredZones: declaredZones as Exercise["primary"],
        ...(basedOn ? { basedOnExerciseId: basedOn.id } : {}),
        ...(typeof v.origin === "string" ? { origin: str(v.origin, 120) } : {}),
      },
    };
    return {
      ...content,
      id: `custom:${familyId}:${await digest(JSON.stringify(content))}`,
      familyId,
      catalogRevision: 3,
      primary,
      secondary,
      variant: basedOn ? `Свой вариант на основе «${basedOn.name}». Соответствие движения выбрано владельцем.` : "Свой вариант. Правило записи выбрано владельцем.",
      jointActions: basedOn?.jointActions ?? [],
      muscles: basedOn?.muscles ?? personalRoles,
      evidence: basedOn?.evidence ?? [],
      limitations: basedOn
        ? "Роли мышц взяты из выбранного тобой базового движения. Устройство тренажёра и техника могут отличаться: это пользовательская разметка, не отдельная экспертная проверка. Подходы участвуют в карте; расчётный 1ПМ отключён."
        : personalRoles.length
          ? "Роли из биомеханической модели сохранены владельцем. Это пользовательская оценка, не экспертная проверка и не измерение нагрузки. Расчётный 1ПМ отключён."
          : "Мышцы указаны пользователем для поиска. В покрытие мышечных ориентиров и расчётный 1ПМ этот вариант не входит.",
      provenance: {
        curator: "Владелец журнала",
        reviewedAt: null,
        license: "Personal metadata",
        reviewStatus: basedOn || personalRoles.length ? "user-declared" : "source-unreviewed",
      },
    };
  }
}
