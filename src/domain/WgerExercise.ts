import type { Exercise, Muscle } from "../lib/types";

export interface WgerAttribution {
  scope: string;
  title: string;
  authors: string[];
  license: string;
  licenseUrl: string;
  sourceUrl: string;
  authorUrl?: string | null;
  derivativeSourceUrl?: string | null;
}
export interface WgerRecord {
  id: string;
  sourceId: number;
  uuid: string;
  contentHash: string;
  name: string;
  nameEn: string;
  language: "ru" | "en";
  instructions: string;
  category: string;
  equipment: { id: number; name: string }[];
  muscles: { id: number; name: string; role: string }[];
  secondaryMuscles: { id: number; name: string; role: string }[];
  aliases: string[];
  variationGroup: string | null;
  sourceUpdatedAt: string;
  attributions: WgerAttribution[];
  adaptation: string;
  loggable: boolean;
  recordType?: "reps" | "duration";
  localization?: {
    version: string;
    sourceLanguage: string;
    sourceName: string;
    sourceInstructions: string;
    names: string;
    instructions: string;
    scientificReview: boolean;
  };
}
export interface WgerSnapshot {
  provider: string;
  release: string;
  fetchedAt: string;
  sourceUrl: string;
  upstreamCount: number;
  count: number;
  omittedCount: number;
  exercises: WgerRecord[];
}
export const WGER_ZONES: Record<number, Muscle> = {
  1: "biceps",
  2: "shoulders",
  3: "chest",
  4: "chest",
  5: "triceps",
  6: "core",
  7: "calves",
  8: "glutes",
  9: "back",
  10: "quads",
  11: "hamstrings",
  12: "back",
  13: "biceps",
  14: "core",
  15: "calves",
};
export class WgerExerciseAdapter {
  constructor(
    private release: string,
    private importedAt: string,
  ) {}
  toExercise(row: WgerRecord): Exercise {
    const equipmentIds = row.equipment.map((e) => e.id);
    return {
      id: row.id,
      name: row.name,
      nameEn: row.nameEn,
      aliases: row.aliases,
      catalogRevision: 3,
      familyId: row.variationGroup ?? row.id,
      primary: [],
      secondary: [],
      equipment:
        equipmentIds.includes(3) &&
        equipmentIds.every((id) => [3, 8, 9, 4].includes(id))
          ? "dumbbells"
          : equipmentIds.length &&
              equipmentIds.every((id) => [7, 4].includes(id))
            ? "bodyweight"
            : "gym",
      tip: row.instructions,
      variant:
        "Вариант и роли мышц приведены по каталогу wger. Правило записи веса задаётся вами и сохраняется без пересчёта.",
      jointActions: [],
      recording: {
        ...(row.recordType ? { type: row.recordType } : {}),
        loadMode: "legacy_unspecified",
        implementCount: 1,
        laterality: "bilateral",
        repsMode: "total",
        e1rmEligible: false,
      },
      muscles: [],
      evidence: [],
      limitations:
        "Разметка wger не прошла редакционную проверку Тяги. Подходы сохраняются в журнале; в покрытие мышечных ориентиров, тоннаж и расчётный 1ПМ они не включаются.",
      provenance: {
        curator: "wger community",
        reviewedAt: null,
        license: "See per-record attribution",
        reviewStatus: "source-unreviewed",
      },
      source: {
        provider: "wger",
        release: this.release,
        importedAt: this.importedAt,
        record: row,
      },
    };
  }
}
