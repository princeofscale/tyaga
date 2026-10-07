import { useMemo, useState } from "react";
import { m, AnimatePresence } from "motion/react";
import { Activity, BookOpen, Dumbbell, Flame, Info, Target } from "lucide-react";
import BodyMap from "./BodyMap";
import { AnatomyPresenter, type AnatomyPart } from "../domain/AnatomyPresenter";
import {
  ANATOMICAL_MUSCLES,
  EXERCISES,
  MUSCLES,
  anatomicalLoad,
  type Muscle,
  type MuscleLoad,
  type Workout,
} from "../lib/model";

export default function AnatomyExplorer({
  loads,
  workouts,
  options,
  onExercise,
  onLibrary,
}: {
  loads: MuscleLoad[];
  workouts: Workout[];
  options: { mapping?: "recorded" | "current"; maxRir?: number };
  onExercise: (id: string) => void;
  onLibrary: (zone: Muscle) => void;
}) {
  const [zone, setZone] = useState<Muscle>("chest");
  const [part, setPart] = useState<AnatomyPart>({
    slug: "chest",
    name: "Грудные",
    zone: "chest",
    muscles: ["pectoralis-major"],
    wgerIds: [4],
  });
  const presenter = useMemo(
    () => new AnatomyPresenter(loads, workouts, options),
    [loads, workouts, options],
  );
  const anatomy = useMemo(
    () => anatomicalLoad(workouts, options),
    [workouts, options],
  );
  const activity = presenter.activity(part);
  const warmupPresenter = useMemo(
    () => new AnatomyPresenter(loads, workouts, { mapping: options.mapping, setKind: "warmup" }),
    [loads, workouts, options.mapping],
  );
  const warmup = warmupPresenter.activity(part);
  const related = EXERCISES.filter((e) =>
    e.muscles.some(
      (m) => part.muscles.includes(m.muscleId) && m.role === "primary",
    ),
  ).slice(0, 4);
  return (
    <section className="anatomy-explorer">
      <div className="anatomy-zone-nav" aria-label="Область тела">
        {MUSCLES.map((group) => (
          <button
            key={group.id}
            className={zone === group.id ? "active" : ""}
            aria-pressed={zone === group.id}
            onClick={() => {
              setZone(group.id);
              setPart({
                slug: "zone-" + group.id,
                name: group.name,
                zone: group.id,
                muscles: ANATOMICAL_MUSCLES.filter(
                  (m) => m.zone === group.id,
                ).map((m) => m.id),
                wgerIds: [],
              });
            }}
          >
            {group.short}
          </button>
        ))}
      </div>
      <div className="anatomy-lab">
        <div className="anatomy-canvas panel">
          <div className="anatomy-canvas-header">
            <span>
              <Activity size={16} />
              КАРТА ПРЯМОЙ РАБОТЫ
            </span>
            <b>СПЕРЕДИ / СЗАДИ</b>
          </div>
          <BodyMap
            loads={loads}
            workouts={workouts}
            options={options}
            selected={zone}
            selectedPart={part.slug.startsWith("zone-") ? undefined : part.slug}
            onSelect={setZone}
            onPartSelect={setPart}
          />
          <p className="atlas-caption">
            Условный атлас групп мышц. Цвет сравнивает записанные прямые подходы
            с ориентиром зоны; форма рисунка не показывает силу или степень
            активации.
          </p>
        </div>
        <div className="anatomy-inspector">
          <AnimatePresence mode="wait">
            <m.section
              className="panel anatomy-selection"
              key={part.slug}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.18 }}
            >
              <span className="feature-tag">
                <Target size={14} />
                ВЫБРАННАЯ ОБЛАСТЬ
              </span>
              <h2>{part.name}</h2>
              <p className="anatomy-latin">
                {
                  ANATOMICAL_MUSCLES.find((m) => m.id === part.muscles[0])
                    ?.latin
                }
              </p>
              <div className="anatomy-metrics">
                <div>
                  <b>{activity.direct}</b>
                  <span>прямых</span>
                </div>
                <div>
                  <b>{activity.assisting}</b>
                  <span>с помощью</span>
                </div>
                <div>
                  <b>{activity.stabilizing}</b>
                  <span>стабилизация</span>
                </div>
              </div>
              {(warmup.direct + warmup.assisting + warmup.stabilizing) > 0 && <p className="anatomy-warmup">
                <Flame size={15} />
                Разминка: {warmup.direct} прямых, {warmup.assisting} с помощью, {warmup.stabilizing} со стабилизацией.
              </p>}
              <div className="anatomy-muscle-rows">
                {anatomy
                  .filter((m) => part.muscles.includes(m.id))
                  .map((m) => (
                    <div key={m.id}>
                      <div>
                        <b>{m.name}</b>
                        <small>{m.latin}</small>
                      </div>
                      <span>
                        {m.direct}
                        <small>прямых</small>
                      </span>
                    </div>
                  ))}
              </div>
              <p className="tiny">
                Один подход считается один раз в области. Роли отдельных мышц
                приведены в упражнениях.
              </p>
            </m.section>
          </AnimatePresence>
          <section className="panel anatomy-recommendations">
            <div className="panel-header">
              <h3>
                <Dumbbell size={17} />
                Упражнения для области
              </h3>
            </div>
            {related.map((e) => (
              <button key={e.id} onClick={() => onExercise(e.id)}>
                <span>
                  {e.name}
                  <small>
                    {e.equipment === "dumbbells"
                      ? "Гантели"
                      : e.equipment === "bodyweight"
                        ? "Вес тела"
                        : "Оборудование зала"}
                  </small>
                </span>
                <BookOpen size={17} />
              </button>
            ))}
            {!related.length ? (
              <p className="tiny">
                В проверяемом каталоге пока нет прямого упражнения для этой
                области.
              </p>
            ) : null}
            <button
              className="button secondary full-width"
              onClick={() => onLibrary(zone)}
            >
              Открыть библиотеку
            </button>
          </section>
          <div className="anatomy-context">
            <Info size={18} />
            <p>
              32 анатомические записи, сгруппированные на рисунке. Роли мышц и
              источники можно открыть в каждом упражнении.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
