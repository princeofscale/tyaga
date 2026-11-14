import type { AnalysisOptions } from "../domain/TrainingAnalytics";
import { useMemo, useState } from "react";
import { m, AnimatePresence } from "motion/react";
import { Activity, BookOpen, Dumbbell, Flame, Info, Target, Sparkles, AlertCircle } from "lucide-react";
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
import { CHEST_HEADS, DELTOID_HEADS } from "../data/muscles";

interface HeadStat {
  id: string;
  slug: string;
  name: string;
  latin: string;
  desc: string;
  part: AnatomyPart | undefined;
  direct: number;
  assisting: number;
  stabilizing: number;
}

export default function AnatomyExplorer({
  loads,
  workouts,
  options,
  onExercise,
  onLibrary,
}: {
  loads: MuscleLoad[];
  workouts: Workout[];
  options: AnalysisOptions;
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
    () => new AnatomyPresenter(loads, workouts, { ...options, maxRir: undefined, setKind: "warmup" }),
    [loads, workouts, options],
  );
  const warmup = warmupPresenter.activity(part);

  const related = useMemo(
    () => EXERCISES.filter((e) => presenter.exerciseRole(part, e) === "primary").slice(0, 5),
    [part, presenter],
  );

  // Subhead analytics for Chest & Shoulders
  const headStats: HeadStat[] | null = useMemo(() => {
    if (zone === "chest") {
      return CHEST_HEADS.map((head) => {
        const p = presenter.part(head.slug, "front");
        const act = p ? presenter.activity(p) : { direct: 0, assisting: 0, stabilizing: 0, ratio: 0 };
        return {
          id: head.id,
          slug: head.slug,
          name: head.name,
          latin: head.latin,
          desc: head.desc,
          part: p,
          direct: act.direct,
          assisting: act.assisting,
          stabilizing: act.stabilizing,
        };
      });
    }
    if (zone === "shoulders") {
      return DELTOID_HEADS.map((head) => {
        const side = head.slug === "deltoid-posterior" ? "back" : "front";
        const p = presenter.part(head.slug, side);
        const act = p ? presenter.activity(p) : { direct: 0, assisting: 0, stabilizing: 0, ratio: 0 };
        return {
          id: head.id,
          slug: head.slug,
          name: head.name,
          latin: head.latin,
          desc: head.desc,
          part: p,
          direct: act.direct,
          assisting: act.assisting,
          stabilizing: act.stabilizing,
        };
      });
    }
    return null;
  }, [zone, presenter]);

  const totalHeadDirect = useMemo(() => {
    if (!headStats) return 0;
    return headStats.reduce((sum: number, h: HeadStat) => sum + h.direct, 0);
  }, [headStats]);

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
            Интерактивный атлас мышц. Нажмите на любой пучок дельты (передний, средний, задний) или отдел груди (верх, середина, низ) для детального анализа.
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
              <div className="selection-badge-row">
                <span className="feature-tag">
                  <Target size={14} />
                  ВЫБРАННАЯ ОБЛАСТЬ
                </span>
                {part.slug.includes("chest-") || part.slug.includes("deltoid-") ? (
                  <span className="subhead-pill-active">
                    <Sparkles size={12} />
                    Анатомический пучок
                  </span>
                ) : null}
              </div>

              <h2>{part.name}</h2>
              <p className="anatomy-latin">
                {
                  ANATOMICAL_MUSCLES.find((m) => m.id === part.muscles[0])
                    ?.latin || "Musculi skeleti"
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

              {(warmup.direct + warmup.assisting + warmup.stabilizing) > 0 && (
                <p className="anatomy-warmup">
                  <Flame size={15} />
                  Разминка: {warmup.direct} прямых, {warmup.assisting} с помощью, {warmup.stabilizing} со стабилизацией.
                </p>
              )}

              {/* Sub-head detailed breakdown cards for Chest & Shoulders */}
              {headStats && (
                <div className="heads-dashboard">
                  <div className="heads-header">
                    <h4>
                      {zone === "chest" ? "Отделы груди" : "Пучки дельтовидных мышц"}
                    </h4>
                    <span className="tiny muted">
                      {totalHeadDirect > 0 ? `${totalHeadDirect} участий пучков` : "нет подходов"}
                    </span>
                  </div>

                  {/* Volume distribution bar */}
                  {totalHeadDirect > 0 && (
                    <div className="head-balance-bar" title="Доли записей участия пучков; один подход может учитываться в нескольких пучках">
                      {headStats.map((h, i) => {
                        const pct = Math.round((h.direct / totalHeadDirect) * 100);
                        const colors = ["#cafa64", "#70d6ff", "#ff9770"];
                        return (
                          <div
                            key={h.id}
                            className="head-bar-slice"
                            style={{
                              width: `${pct}%`,
                              background: colors[i % colors.length],
                            }}
                            title={`${h.name}: ${pct}% (${h.direct} подх.)`}
                          />
                        );
                      })}
                    </div>
                  )}

                  <div className="heads-grid">
                    {headStats.map((head, i) => {
                      const isSelected = part.slug === head.slug;
                      const colors = ["#cafa64", "#70d6ff", "#ff9770"];
                      const color = colors[i % colors.length];
                      return (
                        <button
                          key={head.id}
                          type="button"
                          className={`head-card ${isSelected ? "head-card-selected" : ""}`}
                          onClick={() => {
                            if (head.part) setPart(head.part);
                          }}
                        >
                          <div className="head-card-top">
                            <span className="head-dot" style={{ background: color }} />
                            <b className="head-title">{head.name}</b>
                            <span className="head-direct-badge">
                              {head.direct} прямых
                            </span>
                          </div>
                          <p className="head-desc">{head.desc}</p>
                          <div className="head-card-footer">
                            <span className="tiny muted">
                              {head.assisting > 0 ? `+${head.assisting} ассист.` : "без ассиста"}
                            </span>
                            {isSelected && (
                              <span className="head-active-label">Активен на карте</span>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

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
                Один подход считается один раз в области, но может нагружать несколько пучков.
                Акцент на отделе груди — анатомический ориентир, а не изоляция волокон или доля нагрузки.
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
              Анатомические записи с разделением на пучки (передняя, средняя, задняя дельты, верх, середина и низ груди). Роли мышц и источники можно открыть в каждом упражнении.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
