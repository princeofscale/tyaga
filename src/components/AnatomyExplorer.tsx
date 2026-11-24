import type { AnalysisOptions } from "../domain/TrainingAnalytics";
import { useMemo, useState } from "react";
import { m, AnimatePresence, useReducedMotion } from "motion/react";
import { BookOpen, Dumbbell, Flame } from "lucide-react";
import BodyMap from "./BodyMap";
import { AnatomyPresenter, type AnatomyPart } from "../domain/AnatomyPresenter";
import { VolumeLandmarksCalculator } from "../domain/VolumeLandmarks";
import {
  ANATOMICAL_MUSCLES,
  EXERCISES,
  MUSCLES,
  anatomicalLoad,
  fmt,
  type Muscle,
  type MuscleLoad,
  type Workout,
} from "../lib/model";
import { CHEST_HEADS, DELTOID_HEADS } from "../data/muscles";
import "../styles/progress.css";

interface HeadStat {
  id: string;
  slug: string;
  name: string;
  part: AnatomyPart | undefined;
  direct: number;
  assisting: number;
}

const HEAD_COLORS = ["#4ade80", "#38bdf8", "#f59e0b"];

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
  const reduced = useReducedMotion();
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

  const zoneLoad = loads.find((l) => l.id === zone);
  const volumeAssessment = useMemo(() => {
    const sets = zoneLoad ? zoneLoad.direct + zoneLoad.indirect * 0.5 : 0;
    return VolumeLandmarksCalculator.assessMuscleVolume(zone, sets);
  }, [zone, zoneLoad]);

  const related = useMemo(
    () => EXERCISES.filter((e) => presenter.exerciseRole(part, e) === "primary").slice(0, 5),
    [part, presenter],
  );

  const headStats: HeadStat[] | null = useMemo(() => {
    if (zone === "chest") {
      return CHEST_HEADS.map((head) => {
        const p = presenter.part(head.slug, "front");
        const act = p ? presenter.activity(p) : { direct: 0, assisting: 0, stabilizing: 0, ratio: 0 };
        return {
          id: head.id,
          slug: head.slug,
          name: head.name,
          part: p,
          direct: act.direct,
          assisting: act.assisting,
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
          part: p,
          direct: act.direct,
          assisting: act.assisting,
        };
      });
    }
    return null;
  }, [zone, presenter]);

  const maxHeadDirect = useMemo(() => {
    if (!headStats) return 1;
    return Math.max(1, ...headStats.map((h) => h.direct));
  }, [headStats]);

  const partMuscles = useMemo(
    () => anatomy.filter((m) => part.muscles.includes(m.id)),
    [anatomy, part.muscles],
  );

  return (
    <section className="anat-screen anatomy-explorer" aria-label="Карта мышц">
      <div className="tel-pill-row" role="group" aria-label="Область тела">
        {MUSCLES.map((group) => (
          <button
            key={group.id}
            type="button"
            className={`tel-pill-btn${zone === group.id ? " active" : ""}`}
            aria-pressed={zone === group.id}
            onClick={() => {
              setZone(group.id);
              setPart({
                slug: "zone-" + group.id,
                name: group.name,
                zone: group.id,
                muscles: ANATOMICAL_MUSCLES.filter((m) => m.zone === group.id).map((m) => m.id),
                wgerIds: [],
              });
            }}
          >
            {group.short}
          </button>
        ))}
      </div>

      <div className="anat-grid">
        <div className="anat-stage anatomy-canvas">
          <BodyMap
            loads={loads}
            workouts={workouts}
            options={options}
            selected={zone}
            selectedPart={part.slug.startsWith("zone-") ? undefined : part.slug}
            onSelect={setZone}
            onPartSelect={setPart}
          />
        </div>

        <div className="anat-inspector">
          <AnimatePresence mode="wait">
            <m.section
              className="anat-hero"
              key={part.slug}
              initial={reduced ? false : { opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduced ? undefined : { opacity: 0, y: -4 }}
              transition={{ duration: 0.16 }}
            >
              <div className="anat-hero-top">
                <span
                  className="mv-phase-pill"
                  style={{ "--mv-color": volumeAssessment.phaseColor } as React.CSSProperties}
                >
                  {volumeAssessment.phaseLabel} · {fmt(volumeAssessment.actualSets)} подх.
                </span>
              </div>

              <h2>{part.name}</h2>
              <p className="anat-latin">
                {ANATOMICAL_MUSCLES.find((m) => m.id === part.muscles[0])?.latin || "Musculi skeleti"}
              </p>

              <div className="anat-kpi-row">
                <div className="anat-kpi">
                  <b>{activity.direct}</b>
                  <span>Прямых</span>
                </div>
                <div className="anat-kpi">
                  <b>{activity.assisting}</b>
                  <span>Косвенных</span>
                </div>
                <div className="anat-kpi">
                  <b>{activity.stabilizing}</b>
                  <span>Стабилизация</span>
                </div>
              </div>

              {warmup.direct + warmup.assisting + warmup.stabilizing > 0 && (
                <div className="coach-next-chip">
                  <Flame size={14} aria-hidden="true" />
                  <span>
                    Разминка: <b>{warmup.direct}</b> прям. · <b>{warmup.assisting}</b> косв.
                  </span>
                </div>
              )}

              {headStats && (
                <div className="anat-heads-list">
                  {headStats.map((head, i) => {
                    const isSelected = part.slug === head.slug;
                    const color = HEAD_COLORS[i % HEAD_COLORS.length];
                    const fillPct = head.direct > 0 ? Math.max(8, Math.round((head.direct / maxHeadDirect) * 100)) : 0;
                    return (
                      <button
                        key={head.id}
                        type="button"
                        className={`anat-head-btn${isSelected ? " is-active" : ""}`}
                        onClick={() => {
                          if (head.part) setPart(head.part);
                        }}
                      >
                        <div className="anat-head-row">
                          <span className="anat-head-name">
                            <i className="mv-legend-dot" style={{ background: color }} />
                            {head.name}
                          </span>
                          <span className="anat-head-count">
                            {head.direct} прям.{head.assisting > 0 ? ` · +${head.assisting}` : ""}
                          </span>
                        </div>
                        <div className="anat-head-bar" aria-hidden="true">
                          <span style={{ width: `${fillPct}%`, background: color }} />
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}

              {partMuscles.length > 0 && (
                <div className="mv-anatomy-list">
                  {partMuscles.map((m) => (
                    <div key={m.id} className="mv-anatomy-row">
                      <span>{m.name}</span>
                      <small>{m.direct} прям.</small>
                    </div>
                  ))}
                </div>
              )}
            </m.section>
          </AnimatePresence>

          <section className="tel-card">
            <div className="tel-card-head">
              <h3>
                <Dumbbell size={16} aria-hidden="true" />
                Упражнения
              </h3>
              <button
                type="button"
                className="text-button"
                onClick={() => onLibrary(zone)}
              >
                Все упражнения
              </button>
            </div>
            {related.length > 0 ? (
              <div className="anat-ex-list">
                {related.map((e) => (
                  <button
                    key={e.id}
                    type="button"
                    className="anat-ex-btn"
                    onClick={() => onExercise(e.id)}
                  >
                    <span>
                      <b>{e.name}</b>
                      <small>
                        {e.equipment === "dumbbells"
                          ? "Гантели"
                          : e.equipment === "bodyweight"
                            ? "Вес тела"
                            : "Зал / штанга"}
                      </small>
                    </span>
                    <BookOpen size={16} aria-hidden="true" />
                  </button>
                ))}
              </div>
            ) : (
              <p className="mv-effect-line">Нет прямых упражнений в каталоге для этой области.</p>
            )}
          </section>
        </div>
      </div>
    </section>
  );
}
