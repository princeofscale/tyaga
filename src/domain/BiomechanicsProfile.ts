import type { Exercise } from "../lib/types";

export interface BiomechanicsProfile {
  /** Длинные костные рычаги (высокий рост / длинные конечности): включает короткие подсказки по технике. */
  longLevers: boolean;
  /** Биакромиальная ширина плеч в см (опционально, 30–60 см) для расчёта оптимального хвата 1,4–1,5×. */
  biacromialCm: number | null;
}

export const DEFAULT_BIOMECHANICS_PROFILE: BiomechanicsProfile = {
  longLevers: false,
  biacromialCm: null,
};

const STORAGE_KEY = "tyaga-biomechanics-profile-v1";

type StorageLike = Pick<Storage, "getItem" | "setItem">;

function defaultStorage(): StorageLike | null {
  return typeof localStorage === "undefined" ? null : localStorage;
}

function normalizeBiacromial(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(",", "."));
  if (!Number.isFinite(n) || n < 30 || n > 60) return null;
  return Math.round(n * 10) / 10;
}

/** Локальный антропометрический профиль атлета: режим длинных рычагов и расчёт ширины хвата в жиме. */
export class BiomechanicsProfileStore {
  static read(storage: StorageLike | null = defaultStorage()): BiomechanicsProfile {
    if (!storage) return { ...DEFAULT_BIOMECHANICS_PROFILE };
    try {
      const raw = storage.getItem(STORAGE_KEY);
      if (!raw) return { ...DEFAULT_BIOMECHANICS_PROFILE };
      const parsed = JSON.parse(raw) as Partial<BiomechanicsProfile>;
      return {
        longLevers: parsed?.longLevers === true,
        biacromialCm: normalizeBiacromial(parsed?.biacromialCm),
      };
    } catch {
      return { ...DEFAULT_BIOMECHANICS_PROFILE };
    }
  }

  static save(
    next: BiomechanicsProfile,
    storage: StorageLike | null = defaultStorage(),
  ): BiomechanicsProfile {
    const clean: BiomechanicsProfile = {
      longLevers: Boolean(next.longLevers),
      biacromialCm: normalizeBiacromial(next.biacromialCm),
    };
    try {
      storage?.setItem(STORAGE_KEY, JSON.stringify(clean));
    } catch {
      // Ignore storage quota / private mode failures
    }
    return clean;
  }

  /** Оптимальная ширина хвата в жиме лёжа по Noteboom et al. (2024): 1,4–1,5× биакромиальной ширины. */
  static optimalBenchGripCm(biacromialCm: number | null): { min: number; max: number } | null {
    const clean = normalizeBiacromial(biacromialCm);
    if (clean === null) return null;
    return {
      min: Math.round(clean * 1.4),
      max: Math.round(clean * 1.5),
    };
  }

  /** Короткая 1-строчная подсказка техники для длиннорычажного атлета (null, если режим выключен). */
  static techniqueCue(
    exercise: Pick<Exercise, "id" | "familyId" | "equipment"> | undefined,
    profile: BiomechanicsProfile = BiomechanicsProfileStore.read(),
  ): string | null {
    if (!profile.longLevers || !exercise) return null;
    const { id, familyId } = exercise;

    if (id === "bench" || id === "incline-bar") {
      const grip = BiomechanicsProfileStore.optimalBenchGripCm(profile.biacromialCm);
      return grip
        ? `Хват ${grip.min}–${grip.max} см (1,4–1,5× плеч) · лопатки сведены · локти 45–60°`
        : "Хват 1,4–1,5× ширины плеч · лопатки сведены · локти 45–60°, без отбива";
    }

    if (id === "squat") {
      return "Каблук/штангетки + стойка шире, носки ~25° · колени вперёд · опускание 2–3 с";
    }

    if (id === "deadlift-bar") {
      return "Длинные рычаги: проверь стойку сумо или трэп-гриф для разгрузки поясницы";
    }

    if (id === "rdl" || id === "db-rdl" || id === "deadlift-stiff") {
      return "Эксцентрика 2–3 с и пауза 0,5 с в растяжении бицепса бедра, таз строго назад";
    }

    if (
      id === "legpress" ||
      id === "incline-db" ||
      id === "flat-db-press" ||
      id === "dip-weighted" ||
      id === "legcurl-seated" ||
      id === "legcurl-prone"
    ) {
      return "Полная амплитуда: подконтрольно 2–3 с вниз + пауза 0,5 с в глубоком растяжении";
    }

    if (familyId === "horizontal-row" || familyId === "horizontal-row-free") {
      return "Упор грудью или строгий нейтральный корпус — не перегружай поясницу перед ногами";
    }

    return null;
  }
}
