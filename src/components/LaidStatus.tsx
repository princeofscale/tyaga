import { LaidDupPlan } from "../domain/LaidDupPlan";
import { dateLabel } from "../lib/calendar";
import type { Routine, Workout } from "../lib/types";

type StatusState = ReturnType<typeof LaidDupPlan.dayStatus>;

const statusText = (s: StatusState) =>
  s.state === "done"
    ? `Сделана ${dateLabel(s.date!)}`
    : s.state === "missed"
      ? "Пропущена"
      : s.state === "ended"
        ? "Цикл закончен"
        : "Впереди";

/** Отметка дня: цвет и текст вместе, чтобы не полагаться на один цвет. */
export function LaidStatus({ status }: { status: StatusState }) {
  return <span className={`laid-status ${status.state}`}>{statusText(status)}</span>;
}

/** Строка программы Лейда на её карточке в «Сохранённых программах»: неделя, план дня, отметка. */
export function LaidRoutineLine({
  routine,
  workouts,
  today,
}: {
  routine: Routine;
  workouts: Workout[];
  today: string;
}) {
  const plan = LaidDupPlan.planFor(routine, today, { workouts });
  if (!plan) return null;
  const p = routine.periodization!;
  const totalWeeks = LaidDupPlan.totalWeeks(p);
  const status = LaidDupPlan.dayStatus(routine, workouts, plan.position.week, today);
  return (
    <div className="laid-routine-line">
      <p>
        {plan.position.beforeStart
          ? `Старт ${dateLabel(p.startMonday)}`
          : LaidDupPlan.weekLabel(plan.position, { isDeload: plan.isDeload, totalWeeks })}
        {" · "}
        <LaidStatus status={status} />
      </p>
      <p className="laid-plan-line">{LaidDupPlan.line(plan)}</p>
    </div>
  );
}
