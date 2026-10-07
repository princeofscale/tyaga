import type { Exercise, Equipment, RecordingSpec } from "../src/lib/types";
import { MUSCLES } from "../src/data/muscles";
import { object, str, num, InputError } from "./validation";

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
      custom: {
        familyId,
        declaredZones: declaredZones as Exercise["primary"],
        ...(typeof v.origin === "string" ? { origin: str(v.origin, 120) } : {}),
      },
    };
    return {
      ...content,
      id: `custom:${familyId}:${await digest(JSON.stringify(content))}`,
      familyId,
      catalogRevision: 3,
      primary: [],
      secondary: [],
      variant: "Свой вариант. Правило записи выбрано владельцем.",
      jointActions: [],
      muscles: [],
      evidence: [],
      limitations:
        "Мышцы указаны пользователем для поиска. В покрытие мышечных ориентиров и расчётный 1ПМ этот вариант не входит.",
      provenance: {
        curator: "Владелец журнала",
        reviewedAt: null,
        license: "Personal metadata",
        reviewStatus: "source-unreviewed",
      },
    };
  }
}
