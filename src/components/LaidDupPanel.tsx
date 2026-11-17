import { useEffect, useMemo, useRef } from "react";
import { CalendarDays } from "lucide-react";
import { LaidDupPlan, LAID_WEEKS } from "../domain/LaidDupPlan";
import { DAY_NAMES } from "../domain/TrainingProgram";
import { dateLabel } from "../lib/calendar";
import { entryName } from "../lib/model";
import type { Routine, Workout } from "../lib/types";
import Modal from "./Modal";

type StatusState = ReturnType<typeof LaidDupPlan.dayStatus>;
const statusText = (s: StatusState) =>
  s.state === "done" ? `Сделана ${dateLabel(s.date!)}` : s.state === "missed" ? "Пропущена" : s.state === "ended" ? "Цикл закончен" : "Впереди";

/** Отметка дня: цвет и текст вместе, чтобы не полагаться на один цвет. */
export function LaidStatus({ status }: { status: StatusState }) {
  return <span className={`laid-status ${status.state}`}>{statusText(status)}</span>;
}

type CardProps = {
  cycle: Routine[];
  workouts: Workout[];
  today: string;
  busy: boolean;
  onSchedule: () => void;
  onUpdate: () => void;
  /** Подсказка «Можно обновить максимум»: пересчитать план с текущей недели. */
  onRecalc: () => void;
};

/** Карточка программы Лейда на экране «Программы»: неделя, волна, дни недели, подсказка про максимум. */
export function LaidDupCard({ cycle, workouts, today, busy, onSchedule, onUpdate, onRecalc }: CardProps) {
  const first = cycle[0].periodization!;
  const position = LaidDupPlan.position(LaidDupPlan.weekOf(first.startMonday, today));
  const suggestion = useMemo(() => LaidDupPlan.suggestion(first, workouts, today), [first, workouts, today]);
  return (
    <section className="laid-card panel" aria-label="Программа Дэвида Лейда">
      <div className="laid-card-head">
        <div>
          <span className="eyebrow">ПРОГРАММА ЛЕЙДА</span>
          <h3>Дэвид Лейд · DUP</h3>
        </div>
      </div>
      <p className="laid-week" aria-live="polite">
        {position.beforeStart ? `Старт ${dateLabel(first.startMonday)} · неделя 1 из ${LAID_WEEKS} · волна 1` : LaidDupPlan.weekLabel(position)}
      </p>
      <ul className="laid-days">
        {cycle.map((r) => {
          const p = r.periodization!;
          const status = LaidDupPlan.dayStatus(r, workouts, position.week, today);
          return (
            <li key={r.id}>
              <b>{LaidDupPlan.SHORT[p.day]}</b>
              <span className="laid-day-name">{r.days.length ? r.days.map((d) => DAY_NAMES[d]).join(" · ") : "любой день"}</span>
              <LaidStatus status={status} />
            </li>
          );
        })}
      </ul>
      {suggestion.length ? (
        <div className="laid-suggest" role="status">
          <p>
            <b>Можно обновить максимум:</b>{" "}
            {suggestion.map((s) => `${LaidDupPlan.LIFT_LABEL[s.lift]} ${LaidDupPlan.kg(s.from)} → ${LaidDupPlan.kg(s.to)} кг`).join("; ")}.
          </p>
          <button type="button" className="button secondary" disabled={busy} onClick={onRecalc}>
            Пересчитать с недели {position.beforeStart ? 1 : position.week + 1}
          </button>
          <p className="tiny laid-window">Оценка — по подходам {LaidDupPlan.windowText(LaidDupPlan.SUGGEST_DAYS)}.</p>
        </div>
      ) : null}
      <div className="laid-actions">
        <button type="button" className="button primary" onClick={onSchedule}>
          <CalendarDays size={16} />
          Расписание на 9 недель
        </button>
        <button type="button" className="button secondary" onClick={onUpdate}>
          {position.finished ? "Начать новый цикл" : "Обновить максимумы"}
        </button>
      </div>
      <p className="tiny">{LaidDupPlan.NOTICE}</p>
    </section>
  );
}

type ScheduleProps = {
  cycle: Routine[];
  workouts: Workout[];
  today: string;
  busy: boolean;
  onClose: () => void;
  onUpdate: () => void;
  onRecalc: () => void;
};

const EXPLAIN = [
  "Тяжёлые и объёмные дни чередуются внутри недели и от недели к неделе.",
  "Каждый день начинается с одного тяжёлого подхода на 1, 3 или 5 повторений, затем идут четыре рабочих подхода.",
  "Каждые три недели начинается новая волна: веса чуть выше.",
  "Вспомогательные упражнения — с запасом в 1–2 повторения.",
  "По данным мета-анализа 2022 года, такая периодизация чуть лучше для максимальной силы у тренированных; для роста мышц при равном объёме — не лучше.",
];

/** «Расписание на 9 недель»: максимумы, подсказка, таблица недель × дней карточками, состав дней с пометкой «добавлено». */
export function LaidDupSchedule({ cycle, workouts, today, busy, onClose, onUpdate, onRecalc }: ScheduleProps) {
  const first = cycle[0].periodization!;
  const position = LaidDupPlan.position(LaidDupPlan.weekOf(first.startMonday, today));
  const estimates = useMemo(() => LaidDupPlan.estimates(workouts, today), [workouts, today]);
  const suggestion = useMemo(() => LaidDupPlan.suggestion(first, workouts, today), [first, workouts, today]);
  const current = useRef<HTMLElement | null>(null);
  useEffect(() => {
    current.current?.scrollIntoView?.({ block: "start" });
  }, []);
  const lifts = ["squat", "bench", "deadlift", "ohp"] as const;
  return (
    <Modal title="Расписание на 9 недель" wide onClose={onClose}>
      <div className="laid-schedule">
        <p className="laid-week">
          {position.beforeStart ? `Старт ${dateLabel(first.startMonday)} · неделя 1 из ${LAID_WEEKS} · волна 1` : LaidDupPlan.weekLabel(position)}
        </p>
        {position.finished ? (
          <div className="laid-suggest" role="status">
            <p>Цикл закончен — обнови максимумы и начни новый.</p>
            <button type="button" className="button primary" onClick={onUpdate}>
              Начать новый цикл
            </button>
          </div>
        ) : null}
        <ul className="laid-maxes" aria-label="Максимумы">
          {lifts.map((lift) => (
            <li key={lift}>
              <b>{LaidDupPlan.LIFT_LABEL[lift]}</b>
              <span>{LaidDupPlan.kg(first.maxes[lift])} кг</span>
              <small>{estimates[lift] !== null ? `по истории ≈ ${LaidDupPlan.kg(estimates[lift]!)} кг` : "истории нет"}</small>
            </li>
          ))}
        </ul>
        <p className="tiny laid-window">«По истории» — лучшая оценка 1ПМ (Эпли) по подходам {LaidDupPlan.windowText(LaidDupPlan.ESTIMATE_DAYS)}.</p>
        {suggestion.length ? (
          <div className="laid-suggest" role="status">
            <p>
              <b>Можно обновить максимум:</b>{" "}
              {suggestion.map((s) => `${LaidDupPlan.LIFT_LABEL[s.lift]} ${LaidDupPlan.kg(s.from)} → ${LaidDupPlan.kg(s.to)} кг`).join("; ")}.
            </p>
            <button type="button" className="button secondary" disabled={busy} onClick={onRecalc}>
              Пересчитать с недели {position.beforeStart ? 1 : position.week + 1}
            </button>
            <p className="tiny laid-window">Оценка — по подходам {LaidDupPlan.windowText(LaidDupPlan.SUGGEST_DAYS)}.</p>
          </div>
        ) : null}
        <p className="laid-explain">{EXPLAIN.join(" ")}</p>
        <p className="tiny">
          {LaidDupPlan.NOTICE}
          {first.light ? " Включён облегчённый режим: вместо одного повторения — три, не по оригиналу." : ""}
        </p>

        <ol className="laid-weeks">
          {Array.from({ length: LAID_WEEKS }, (_, week) => {
            const isCurrent = !position.beforeStart && !position.finished ? week === position.week : position.finished ? week === LAID_WEEKS - 1 : week === 0;
            const wave = Math.floor(week / 3) + 1;
            const maxes = LaidDupPlan.maxesFor(first, week);
            return (
              <li
                key={week}
                className={`laid-week-card${isCurrent ? " current" : ""}`}
                aria-current={isCurrent && !position.beforeStart ? "step" : undefined}
                ref={(node) => {
                  if (isCurrent) current.current = node;
                }}
              >
                <h4>
                  Неделя {week + 1} · волна {wave}
                  {isCurrent && !position.beforeStart ? <span className="laid-now">сейчас</span> : null}
                </h4>
                <ul>
                  {cycle.map((r) => {
                    const p = r.periodization!;
                    const plan = LaidDupPlan.day(p.day, week, maxes, { light: p.light });
                    return (
                      <li key={r.id}>
                        <b>{LaidDupPlan.SHORT[p.day]}</b>
                        <LaidStatus status={LaidDupPlan.dayStatus(r, workouts, week, today)} />
                        <span className="laid-plan-line">{LaidDupPlan.line(plan)}</span>
                      </li>
                    );
                  })}
                </ul>
              </li>
            );
          })}
        </ol>

        <details className="laid-composition">
          <summary>Состав дней: оригинал и добавленное</summary>
          {cycle.map((r) => {
            const day = r.periodization!.day;
            return (
              <div key={r.id} className="laid-comp-day">
                <h4>
                  {LaidDupPlan.SHORT[day]} <small>({LaidDupPlan.ORIGINAL[day]})</small>
                </h4>
                <ul>
                  {r.exercises.map((e) => (
                    <li key={e.exerciseId}>
                      <span>{entryName(e)}</span>
                      <span className={`laid-origin ${LaidDupPlan.isAdded(day, e.exerciseId) ? "added" : "original"}`}>
                        {LaidDupPlan.isAdded(day, e.exerciseId) ? "добавлено" : "оригинал"}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </details>
        <div className="laid-actions">
          <button type="button" className="button secondary" onClick={onUpdate}>
            {position.finished ? "Начать новый цикл" : "Обновить максимумы"}
          </button>
          <button type="button" className="button primary" onClick={onClose}>
            Закрыть
          </button>
        </div>
      </div>
    </Modal>
  );
}

/** Строка программы Лейда на её карточке в «Сохранённых программах»: неделя, план дня, отметка. */
export function LaidRoutineLine({ routine, workouts, today }: { routine: Routine; workouts: Workout[]; today: string }) {
  const plan = LaidDupPlan.planFor(routine, today);
  if (!plan) return null;
  const status = LaidDupPlan.dayStatus(routine, workouts, plan.position.week, today);
  return (
    <div className="laid-routine-line">
      <p>
        {plan.position.beforeStart ? `Старт ${dateLabel(routine.periodization!.startMonday)}` : LaidDupPlan.weekLabel(plan.position)}
        {" · "}
        <LaidStatus status={status} />
      </p>
      <p className="laid-plan-line">{LaidDupPlan.line(plan)}</p>
    </div>
  );
}
