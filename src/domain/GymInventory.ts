import { PlateLoadingCalculator } from "./PlateLoadingCalculator";
import { DecimalInput } from "./DecimalInput";

export type GymBarWeight = 20 | 15 | 10;
export type GymMinPlate = 1.25 | 2.5;

export interface GymInventory {
  barWeightKg: GymBarWeight;
  minPlateKg: GymMinPlate;
}

export const GYM_BAR_OPTIONS: readonly { value: GymBarWeight; label: string; short: string }[] = [
  { value: 20, label: "Олимпийский 20 кг", short: "20 кг" },
  { value: 15, label: "Женский 15 кг", short: "15 кг" },
  { value: 10, label: "Тренировочный / EZ 10 кг", short: "10 кг" },
];

export const GYM_MIN_PLATE_OPTIONS: readonly { value: GymMinPlate; label: string }[] = [
  { value: 1.25, label: "1,25 кг (шаг 2,5 кг)" },
  { value: 2.5, label: "2,5 кг (шаг 5 кг)" },
];

export const DEFAULT_GYM_INVENTORY: GymInventory = {
  barWeightKg: 20,
  minPlateKg: 1.25,
};

const STORAGE_KEY = "tyaga-gym-inventory-v1";
const ALL_PLATES = [25, 20, 15, 10, 5, 2.5, 1.25] as const;

type StorageLike = Pick<Storage, "getItem" | "setItem">;

function defaultStorage(): StorageLike | null {
  return typeof localStorage === "undefined" ? null : localStorage;
}

function normalizeBar(v: unknown): GymBarWeight {
  return v === 15 || v === 10 ? v : 20;
}

function normalizeMinPlate(v: unknown): GymMinPlate {
  return v === 2.5 ? 2.5 : 1.25;
}

/** Локальные настройки инвентаря зала: стандартный вес грифа и минимальный блин. */
export class GymInventoryStore {
  static read(storage: StorageLike | null = defaultStorage()): GymInventory {
    if (!storage) return { ...DEFAULT_GYM_INVENTORY };
    try {
      const raw = storage.getItem(STORAGE_KEY);
      if (!raw) return { ...DEFAULT_GYM_INVENTORY };
      const parsed = JSON.parse(raw) as Partial<GymInventory>;
      return {
        barWeightKg: normalizeBar(parsed?.barWeightKg),
        minPlateKg: normalizeMinPlate(parsed?.minPlateKg),
      };
    } catch {
      return { ...DEFAULT_GYM_INVENTORY };
    }
  }

  static save(next: GymInventory, storage: StorageLike | null = defaultStorage()): GymInventory {
    const clean: GymInventory = {
      barWeightKg: normalizeBar(next.barWeightKg),
      minPlateKg: normalizeMinPlate(next.minPlateKg),
    };
    try {
      storage?.setItem(STORAGE_KEY, JSON.stringify(clean));
    } catch {
      // Ignore storage quota / private mode failures
    }
    return clean;
  }

  static allowedPlateWeights(inv: GymInventory = GymInventoryStore.read()): number[] {
    return ALL_PLATES.filter((w) => w >= inv.minPlateKg);
  }

  static formatPlatesForBar(
    totalWeightKg: number,
    inv: GymInventory = GymInventoryStore.read(),
  ): string {
    if (totalWeightKg <= inv.barWeightKg) {
      return `Пустой гриф (${inv.barWeightKg} кг)`;
    }
    const calc = PlateLoadingCalculator.calculate(
      totalWeightKg,
      inv.barWeightKg,
      GymInventoryStore.allowedPlateWeights(inv),
    );
    if (!calc.plates.length) return `Пустой гриф (${inv.barWeightKg} кг)`;
    const counts = new Map<number, number>();
    for (const p of calc.plates) counts.set(p, (counts.get(p) ?? 0) + 1);
    const parts: string[] = [];
    for (const [w, n] of counts) {
      const wStr = DecimalInput.format(w);
      parts.push(n > 1 ? `${n}×${wStr}` : wStr);
    }
    const remNote = calc.remainder >= 0.5 ? ` (≈${DecimalInput.format(calc.actualLoaded)} кг)` : "";
    return `На сторону: ${parts.join(" + ")} кг${remNote}`;
  }
}
