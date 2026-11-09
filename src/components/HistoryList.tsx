import { useMemo } from "react";
import { m } from "motion/react";
import { ChevronRight, Clock3, Dumbbell } from "lucide-react";
import { fmt, volumeSummary, workingSets } from "../lib/model";
import { WorkoutPresenter } from "../domain/WorkoutPresenter";
import type { Workout } from "../lib/types";

const EASE = [0.22, 1, 0.36, 1] as const;

const monthTitle = (key: string) => {
  const text = new Date(`${key}-15T12:00:00`).toLocaleDateString("ru-RU", { month: "long", year: "numeric" });
  return text.charAt(0).toUpperCase() + text.slice(1).replace(/\s?г\.?$/, "");
};

/** История тренировок: группы по месяцам, у каждой — итог и карточки с датой, мышцами и объёмом. */
export default function HistoryList({
  workouts,
  today,
  onOpen,
}: {
  workouts: Workout[];
  today: string;
  onOpen: (workout: Workout) => void;
}) {
  const groups = useMemo(() => {
    const byMonth = new Map<string, Workout[]>();
    for (const w of workouts) {
      const key = w.date.slice(0, 7);
      byMonth.set(key, [...(byMonth.get(key) ?? []), w]);
    }
    return [...byMonth.entries()].map(([key, items]) => ({
      key,
      items,
      tonnes: volumeSummary(items, "all").total / 1000,
    }));
  }, [workouts]);

  let index = 0;
  return (
    <div className="history-list">
      {groups.map((group) => (
        <section className="history-month" key={group.key} aria-label={monthTitle(group.key)}>
          <m.header
            className="history-month-head"
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.4, ease: EASE }}
          >
            <h2>{monthTitle(group.key)}</h2>
            <span>
              {group.items.length} трен. · {fmt(group.tonnes)} т
            </span>
          </m.header>
          <div className="history-cards">
            {group.items.map((w) => {
              const date = new Date(`${w.date}T12:00:00`);
              const muscles = WorkoutPresenter.topMuscles(w);
              const delay = Math.min(index++, 10) * 0.045;
              return (
                <m.button
                  type="button"
                  key={w.id}
                  className={`session-item history-card ${w.date === today ? "is-today" : ""}`}
                  onClick={() => onOpen(w)}
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  whileTap={{ scale: 0.985 }}
                  transition={{ duration: 0.45, delay, ease: EASE }}
                >
                  <span className="history-date" aria-hidden="true">
                    <b>{date.getDate()}</b>
                    <small>{date.toLocaleDateString("ru-RU", { weekday: "short" }).replace(".", "")}</small>
                  </span>
                  <span className="history-body">
                    <strong>{WorkoutPresenter.title(w)}</strong>
                    <span className="history-meta">
                      <Dumbbell size={13} aria-hidden="true" />
                      {w.exercises.length} упр. · {workingSets([w])} подх.
                    </span>
                    {muscles.length ? (
                      <span className="history-chips">
                        {muscles.map((name) => (
                          <i key={name}>{name}</i>
                        ))}
                      </span>
                    ) : null}
                  </span>
                  <span className="history-stats">
                    <b title="Только однозначно записанные свободные веса">
                      {fmt(volumeSummary([w], "all").total / 1000)}
                      <small> т</small>
                    </b>
                    <span>
                      <Clock3 size={13} aria-hidden="true" />
                      {w.duration > 0 ? `${w.duration} мин` : "—"}
                    </span>
                  </span>
                  <ChevronRight size={18} className="history-chevron" aria-hidden="true" />
                </m.button>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
