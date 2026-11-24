import { PlateLoadingCalculator } from "./PlateLoadingCalculator";

export interface PlateSpec {
  weight: number;
  color: string;
  borderColor: string;
  textColor: string;
  width: number;
  height: number;
  name: string;
}

export const OLYMPIC_PLATES: PlateSpec[] = [
  { weight: 25, color: "#dc2626", borderColor: "#b91c1c", textColor: "#ffffff", width: 28, height: 160, name: "25 кг (Красный)" },
  { weight: 20, color: "#2563eb", borderColor: "#1d4ed8", textColor: "#ffffff", width: 26, height: 160, name: "20 кг (Синий)" },
  { weight: 15, color: "#eab308", borderColor: "#ca8a04", textColor: "#18181b", width: 22, height: 144, name: "15 кг (Жёлтый)" },
  { weight: 10, color: "#16a34a", borderColor: "#15803d", textColor: "#ffffff", width: 20, height: 128, name: "10 кг (Зелёный)" },
  { weight: 5, color: "#f3f4f6", borderColor: "#d1d5db", textColor: "#18181b", width: 17, height: 96, name: "5 кг (Белый)" },
  { weight: 2.5, color: "#1f2937", borderColor: "#374151", textColor: "#f3f4f6", width: 15, height: 80, name: "2.5 кг (Чёрный)" },
  { weight: 1.25, color: "#9ca3af", borderColor: "#6b7280", textColor: "#18181b", width: 13, height: 68, name: "1.25 кг (Хром)" },
];

export function calculatePlatesGreedy(totalWeight: number, barWeight: number): {
  plates: PlateSpec[];
  weightPerSide: number;
  actualLoaded: number;
  remainder: number;
} {
  const inventory = OLYMPIC_PLATES.slice(0, PlateLoadingCalculator.MAX_PLATE_TYPES);
  const specsByWeight = new Map<number, PlateSpec>(inventory.map((spec) => [spec.weight, spec]));
  const result = PlateLoadingCalculator.calculate(totalWeight, barWeight, [...specsByWeight.keys()]);
  return { ...result, plates: result.plates.map((weight) => specsByWeight.get(weight)!) };
}
