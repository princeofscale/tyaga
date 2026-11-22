import { useMemo, type ReactNode } from "react";
import { entryName, type WorkoutExercise } from "../lib/model";

type Props = {
  exercises: WorkoutExercise[];
  selected: string | null;
  onSelect: (setId: string | null) => void;
  editor: (entry: WorkoutExercise, exerciseIndex: number, setIndex: number) => ReactNode;
};

export default function WorkoutGym({ exercises, selected, onSelect, editor }: Props) {
  const groups = useMemo(() => exercises.map((entry, ei) => {
    const warmups = entry.sets.filter((set) => set.warmup).length;
    const workingSets = entry.sets.length - warmups;
    let warmup = 0;
    let working = 0;
    return {
      name: entryName(entry),
      positions: entry.sets.map((set, si) => ({
        entry, set, ei, si,
        label: set.warmup
          ? `Разминка ${++warmup} / ${warmups}`
          : `Рабочий ${++working} / ${workingSets}`,
      })),
    };
  }), [exercises]);
  const positions = groups.flatMap(({ positions }) => positions);
  if (!positions.length) return null;
  const explicit = positions.find(({ set }) => set.id === selected);
  const current = explicit ?? positions.find(({ set }) => !set.done);
  const next = positions.find(({ set }) => !set.done && set.id !== current?.set.id);

  return (
    <section className="workout-gym-card" aria-label="Текущий подход">
      <div className="gym-set-heading" aria-live="polite" aria-atomic="true">
        {current ? (
          <>
            <p>{current.label}{current.set.done ? " · отмечен" : ""}</p>
            <h2>{entryName(current.entry)}</h2>
          </>
        ) : <h2>Все подходы отмечены</h2>}
      </div>
      {current && editor(current.entry, current.ei, current.si)}
      {next && <p className="gym-next-set">Дальше: {entryName(next.entry)} · {next.label.toLowerCase()}</p>}
      <label className="gym-set-select">
        <span>Выбрать подход</span>
        <select value={explicit?.set.id ?? ""} onChange={(event) => onSelect(event.target.value || null)}>
          <option value="">Первый незавершённый</option>
          {groups.map(({ name, positions }, ei) => (
            <optgroup key={ei} label={`${ei + 1}. ${name}`}>
              {positions.map(({ set, label }) => (
                <option key={set.id} value={set.id}>{label}{set.done ? " · отмечен" : ""}</option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>
    </section>
  );
}
