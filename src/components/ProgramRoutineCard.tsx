import { Copy, Pencil, Play, Trash2 } from "lucide-react";
import { m, useReducedMotion } from "motion/react";
import { LaidDupPlan } from "../domain/LaidDupPlan";
import { PlanLine } from "../domain/PlanLine";
import { DAY_NAMES, TrainingProgram, weightSourceSummary } from "../domain/TrainingProgram";
import { entryName, exerciseForEntry, fmt } from "../lib/model";
import { quantity } from "../lib/quantity";
import type { Routine, Workout } from "../lib/types";
import { LaidRoutineLine } from "./LaidDupPanel";

type Props = {
  routine: Routine;
  workouts: Workout[];
  timeZone: string;
  today: string;
  deload: boolean;
  onStart: () => void;
  onEdit: () => void;
  onCopy: () => void;
  onDelete: () => void;
};

export default function ProgramRoutineCard({ routine, workouts, timeZone, today, deload, onStart, onEdit, onCopy, onDelete }: Props) {
  const reduceMotion = useReducedMotion();
  const program = new TrainingProgram(routine);
  const periodization = LaidDupPlan.periodizationOf(routine);
  const laidLift = periodization && LaidDupPlan.liftExerciseId(LaidDupPlan.LIFT_OF[periodization.day], periodization.substitutions);
  const days = routine.days.length ? routine.days.map((day) => DAY_NAMES[day]).join(" · ") : "Без расписания";
  const remaining = routine.exercises.length - 4;
  return (
    <m.article
      className="routine-card"
      layout={reduceMotion ? false : "position"}
      transition={{ layout: { type: "spring", stiffness: 420, damping: 38 } }}
    >
      <header className="routine-card-top">
        <div>
          <p className="routine-days">{days}</p>
          <h3>{routine.name}</h3>
        </div>
        <button type="button" className="icon-button" aria-label={`Редактировать программу ${routine.name}`} onClick={onEdit}>
          <Pencil size={17} aria-hidden="true" />
        </button>
      </header>
      <p className="routine-summary">
        {quantity(routine.exercises.length, "упражнение", "упражнения", "упражнений")}
        {" · "}{quantity(program.workingSets, "рабочий подход", "рабочих подхода", "рабочих подходов")}
      </p>
      {periodization ? <LaidRoutineLine routine={routine} workouts={workouts} today={today} /> : null}
      {deload ? <p className="routine-deload">Разгрузочная неделя · половина подходов, 70% веса</p> : null}
      {routine.exercises.length ? (
        <ul className="routine-exercise-names" role="list" aria-label="Упражнения программы">
          {routine.exercises.slice(0, 4).map((entry, index) => (
            <li key={`${entry.exerciseId}:${index}`}>
              <span>{entryName(entry)}</span>
              {entry.exerciseId !== laidLift && exerciseForEntry(entry)?.recording.type !== "duration" ? <b>{PlanLine.sets(entry)}</b> : null}
            </li>
          ))}
          {remaining > 0 ? <li className="routine-extra">Ещё {quantity(remaining, "упражнение", "упражнения", "упражнений")}</li> : null}
        </ul>
      ) : null}
      <small className="routine-weight-notes">
        {routine.progression === "double" ? `${routine.repMin}–${routine.repMax} повт. · шаг ${fmt(routine.incrementKg)} кг · ` : null}
        {weightSourceSummary(program.weightSources(workouts, timeZone, today))}
      </small>
      <footer className="routine-card-actions">
        <m.button type="button" className="button secondary routine-start" whileTap={reduceMotion ? undefined : { scale: 0.98 }} onClick={onStart}>
          <Play size={16} fill="currentColor" aria-hidden="true" />
          Начать
        </m.button>
        <button type="button" className="icon-button" aria-label={`Копировать программу ${routine.name}`} onClick={onCopy}>
          <Copy size={16} aria-hidden="true" />
        </button>
        <button type="button" className="icon-button routine-delete" aria-label={`Удалить программу ${routine.name}`} onClick={onDelete}>
          <Trash2 size={16} aria-hidden="true" />
        </button>
      </footer>
    </m.article>
  );
}
