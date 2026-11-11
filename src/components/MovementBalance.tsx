import { useMemo } from "react";
import { PersonalRecordsCalculator } from "../domain/PersonalRecords";
import type { Workout } from "../lib/model";
export default function MovementBalance({ workouts }: { workouts: Workout[] }) {
  const r = useMemo(
    () => new PersonalRecordsCalculator(workouts).calculateRatios(),
    [workouts],
  );
  return (
    <section className="progress-card movement-balance">
      <h2>Распределение рабочих подходов</h2>
      <div>
        <p>
          Жимы / тяги
          <strong>
            {r.pushSets} / {r.pullSets}
          </strong>
        </p>
        <p>
          Верх / низ
          <strong>
            {r.upperSets} / {r.lowerSets}
          </strong>
        </p>
      </div>
      <p className="tiny">
        По упражнениям выбранной недели. Подробная нагрузка по зонам — ниже.
      </p>
    </section>
  );
}
