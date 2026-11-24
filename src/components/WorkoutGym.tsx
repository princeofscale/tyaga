import { ArrowRight, Check, CheckCircle2, ChevronDown, Flame, List, Plus, RotateCcw, Trash2 } from "lucide-react";
import { useId, useRef, useState, type ReactNode } from "react";
import type { WorkoutFlow, WorkoutSetPosition } from "../domain/WorkoutFlow";
import { entryName } from "../lib/model";

type Props = {
  flow: WorkoutFlow;
  selected: string | null;
  onSelect: (setId: string) => void;
  editor: (position: WorkoutSetPosition) => ReactNode;
  onAddSet: (exerciseIndex: number, warmup: boolean) => void;
  onRemoveSet: (position: WorkoutSetPosition) => void;
  onRemoveExercise: (exerciseIndex: number) => void;
  onAddExercise: () => void;
};

const setLabel = ({ set, number, count }: WorkoutSetPosition) =>
  `${set.warmup ? "Разминка" : "Рабочий"} ${number} из ${count}`;

function SetGroup({ positions, warmup, selected, onSelect }: {
  positions: WorkoutSetPosition[];
  warmup: boolean;
  selected: string;
  onSelect: Props["onSelect"];
}) {
  if (!positions.length) return null;
  return (
    <div className="gym-set-group" data-warmup={warmup} role="group" aria-label={warmup ? "Разминочные подходы" : "Рабочие подходы"}>
      <span className="gym-set-group-label" aria-hidden="true">{warmup ? "Разминка" : "Рабочие"}</span>
      <div className="gym-set-pills">
        {positions.map((position) => {
          const { set, number } = position;
          return (
            <button
              key={set.id}
              type="button"
              className="gym-set-pill"
              data-done={set.done}
              aria-pressed={selected === set.id}
              aria-label={setLabel(position) + (set.done ? ", выполнен" : "")}
              onClick={() => onSelect(set.id)}
            >
              {number}{set.done && <Check size={14} aria-hidden="true" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function WorkoutGym({ flow, selected, onSelect, editor, onAddSet, onRemoveSet, onRemoveExercise, onAddExercise }: Props) {
  const [expanded, setExpanded] = useState(false);
  const listId = useId();
  const disclosure = useRef<HTMLButtonElement>(null);
  const addWorking = useRef<HTMLButtonElement>(null);
  const current = flow.current(selected);
  if (!current) return null;

  const { exerciseIndex, entry, set } = current;
  const group = flow.groups[exerciseIndex];
  const next = flow.after(set.id);
  const canAdd = group.positions.length < 30;
  const canRemove = group.positions.length > 1;
  const selectExercise = (index: number) => {
    const position = flow.forExercise(index);
    if (!position) return;
    if (disclosure.current?.getClientRects().length) disclosure.current.focus();
    setExpanded(false);
    if (index !== exerciseIndex) onSelect(position.set.id);
  };

  return (
    <div className="workout-gym-layout">
      <nav className="gym-exercises" aria-label="Упражнения тренировки">
        <h2 className="gym-exercises-heading">Упражнения <span>{flow.groups.length}</span></h2>
        <button
          ref={disclosure}
          type="button"
          className="gym-exercises-toggle"
          aria-label="Упражнения"
          aria-expanded={expanded}
          aria-controls={listId}
          onClick={() => setExpanded((value) => !value)}
        >
          <List size={18} aria-hidden="true" />
          <span>Упражнения</span>
          <span className="gym-exercise-count" aria-hidden="true">{exerciseIndex + 1} / {flow.groups.length}</span>
          <ChevronDown size={16} className="gym-exercises-chevron" aria-hidden="true" />
        </button>
        <ol id={listId} className="gym-exercise-list" data-expanded={expanded}>
          {flow.groups.map(({ entry: exercise, positions }, index) => {
            const name = entryName(exercise);
            const count = positions.filter(({ set }) => set.done).length;
            const description = listId + "-" + index;
            return (
              <li key={exercise.exerciseId + "-" + index}>
                <button
                  type="button"
                  className="gym-exercise-button"
                  aria-label={name}
                  aria-describedby={description}
                  aria-pressed={index === exerciseIndex}
                  disabled={!positions.length}
                  onClick={() => selectExercise(index)}
                >
                  <span className="gym-exercise-order" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
                  <span className="gym-exercise-name">{name}</span>
                  <span id={description} className="sr-only">Отмечено {count} из {positions.length}</span>
                  <span className="gym-exercise-count" data-done={count > 0 && count === positions.length} aria-hidden="true">
                    {count} / {positions.length}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      <section className="workout-gym-card" aria-label="Текущий подход">
        <div className="gym-set-heading" aria-live="polite" aria-atomic="true">
          <div className="gym-set-heading-top">
            <h2>{entryName(entry)}</h2>
            <button
              type="button"
              className="gym-remove-exercise"
              aria-label={`Убрать упражнение: ${entryName(entry)}`}
              title="Убрать упражнение из тренировки"
              onClick={() => onRemoveExercise(exerciseIndex)}
            >
              <Trash2 size={16} aria-hidden="true" />
              <span>Убрать</span>
            </button>
          </div>
          <p className="gym-active-set" data-warmup={set.warmup}>
            {set.warmup && <Flame size={15} aria-hidden="true" />}
            {setLabel(current)}
            {set.done && <span className="gym-set-done"><Check size={14} aria-hidden="true" /> Выполнен</span>}
          </p>
        </div>
        <div className="gym-set-nav">
          <SetGroup positions={group.positions.filter(({ set }) => set.warmup)} warmup selected={set.id} onSelect={onSelect} />
          <SetGroup positions={group.positions.filter(({ set }) => !set.warmup)} warmup={false} selected={set.id} onSelect={onSelect} />
        </div>
        {editor(current)}
        <div className="gym-next-set" data-state={next?.wrapped ? "skipped" : next ? "next" : set.done ? "complete" : "last"}>
          {next ? (
            <>
              {next.wrapped ? <RotateCcw size={16} aria-hidden="true" /> : <ArrowRight size={17} aria-hidden="true" />}
              <div className="gym-next-copy">
                <span>{next.wrapped ? "Пропущенный подход" : "Дальше"}</span>
                <strong>{entryName(next.position.entry)}</strong>
              </div>
              <span className="gym-next-number">{setLabel(next.position)}</span>
            </>
          ) : (
            <>
              {set.done ? <CheckCircle2 size={18} aria-hidden="true" /> : <ArrowRight size={17} aria-hidden="true" />}
              <strong>{set.done ? "Все подходы отмечены" : "Последний подход"}</strong>
            </>
          )}
        </div>
        <div className="gym-set-actions" role="group" aria-label="Изменить подходы">
          <button
            ref={addWorking}
            type="button"
            className="gym-set-action"
            disabled={!canAdd}
            aria-label="Добавить рабочий подход"
            title={canAdd ? undefined : "Не больше 30 подходов в упражнении"}
            onClick={() => onAddSet(exerciseIndex, false)}
          >
            <Plus size={16} aria-hidden="true" /> Рабочий
          </button>
          <button
            type="button"
            className="gym-set-action gym-add-warmup"
            disabled={!canAdd}
            aria-label="Добавить разминочный подход"
            title={canAdd ? undefined : "Не больше 30 подходов в упражнении"}
            onClick={() => onAddSet(exerciseIndex, true)}
          >
            <Plus size={16} aria-hidden="true" /> Разминка
          </button>
          <button
            type="button"
            className="gym-set-action gym-remove-set"
            disabled={!canRemove}
            aria-label="Удалить выбранный подход"
            title={canRemove ? "Удалить выбранный подход" : "В упражнении должен остаться хотя бы один подход"}
            onClick={(event) => {
              if (event.detail === 0 && group.positions.length === 2) addWorking.current?.focus();
              onRemoveSet(current);
            }}
          >
            <Trash2 size={16} aria-hidden="true" /> Удалить
          </button>
        </div>
      </section>

      <button type="button" className="button secondary gym-add-exercise" disabled={flow.groups.length >= 30} onClick={onAddExercise}>
        <Plus size={18} aria-hidden="true" /> Добавить упражнение
      </button>
    </div>
  );
}
