import ProgressChart from "./ProgressChart";
import { quantity } from "../lib/quantity";
import type { StrengthPoint } from "../domain/ProgressSeries";
export type { StrengthPoint } from "../domain/ProgressSeries";
export default function InteractiveStrengthChart({
  points,
  unit = "кг",
  isDuration = false,
  exerciseName = "",
}: {
  points: StrengthPoint[];
  unit?: string;
  isDuration?: boolean;
  exerciseName?: string;
}) {
  return (
    <ProgressChart
      label={`Динамика: ${exerciseName}`}
      unit={unit}
      points={points.map((p) => ({
        id: p.id,
        date: p.date,
        value: p.max,
        detail: isDuration
          ? "Время лучшего подхода"
          : `${quantity(p.reps, "повторение", "повторения", "повторений")} · ${quantity(p.sets.length, "рабочий подход", "рабочих подхода", "рабочих подходов")}`,
      }))}
    />
  );
}
