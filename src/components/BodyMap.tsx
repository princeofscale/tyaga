import { useMemo, useState } from "react";
import { m } from "motion/react";
import { RotateCw } from "lucide-react";
import atlas from "../assets/anatomy/muscle-map.json";
import {
  AnatomyPresenter,
  loadColor,
  type AnatomyPart,
} from "../domain/AnatomyPresenter";
import type { Exercise, Muscle, MuscleLoad, Workout } from "../lib/model";
export { loadColor };
const EMPTY_WORKOUTS: Workout[] = [];
const DEFAULT_OPTIONS = {};

export default function BodyMap({
  loads,
  selected,
  onSelect,
  workouts = EMPTY_WORKOUTS,
  options = DEFAULT_OPTIONS,
  exercise,
  onPartSelect,
  selectedPart,
  compact = false,
}: {
  loads: MuscleLoad[];
  selected: Muscle | null;
  onSelect: (muscle: Muscle) => void;
  workouts?: Workout[];
  options?: { mapping?: "recorded" | "current"; maxRir?: number };
  exercise?: Exercise;
  onPartSelect?: (part: AnatomyPart) => void;
  selectedPart?: string;
  compact?: boolean;
}) {
  const [side, setSide] = useState<"both" | "front" | "back">("both");
  const [hovered, setHovered] = useState<AnatomyPart | null>(null);
  const presenter = useMemo(
    () => new AnatomyPresenter(loads, workouts, options),
    [loads, workouts, options],
  );
  return (
    <div className={`body-map anatomical-map ${compact ? "compact-map" : ""}`}>
      {!compact ? (
        <div className="map-toolbar">
          <div className="map-view-control" aria-label="Вид карты мышц">
            {(["both", "front", "back"] as const).map((v) => (
              <button
                key={v}
                aria-pressed={side === v}
                className={side === v ? "active" : ""}
                onClick={() => setSide(v)}
              >
                {v === "both"
                  ? "Оба вида"
                  : v === "front"
                    ? "Спереди"
                    : "Сзади"}
              </button>
            ))}
          </div>
          <RotateCw size={15} aria-hidden="true" />
        </div>
      ) : null}
      <div className={`body-figures ${side !== "both" ? "single" : ""}`}>
        {(["front", "back"] as const)
          .filter((v) => side === "both" || side === v)
          .map((view) => (
            <m.div
              className="body-figure"
              key={view}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.25 }}
            >
              <svg
                viewBox={atlas[view].viewBox}
                role="group"
                aria-label={
                  view === "front" ? "Карта мышц спереди" : "Карта мышц сзади"
                }
              >
                <path
                  d={atlas[view].outline}
                  fill="#202526"
                  stroke="#4b5554"
                  strokeWidth="3"
                />
                {atlas[view].parts.map((data) => {
                  const part = presenter.part(data.slug, view);
                  const activity = part ? presenter.activity(part) : null;
                  const role =
                    part && exercise
                      ? presenter.exerciseRole(part, exercise)
                      : undefined;
                  const active =
                    part &&
                    (selectedPart
                      ? part.slug === selectedPart
                      : selected === part.zone);
                  const clickable = !!part && !compact;
                  const fill = exercise
                    ? role === "primary"
                      ? "#cafa64"
                      : role === "assistant"
                        ? "#b6a1e8"
                        : role === "stabilizer"
                          ? "#dfb385"
                          : "#303637"
                    : activity
                      ? loadColor(activity.ratio)
                      : data.slug === "head"
                        ? "#434b4c"
                        : "#2c3233";
                  const paths = Object.values(data.path).flat();
                  const choose = () => {
                    if (!part) return;
                    onSelect(part.zone);
                    onPartSelect?.(part);
                  };
                  return (
                    <g
                      key={data.slug}
                      className={`atlas-muscle ${active ? "selected" : ""} ${clickable ? "clickable" : ""}`}
                      fill={fill}
                      stroke={active ? "#f0ffd9" : "#172021"}
                      strokeWidth={active ? 5 : 2.2}
                      role={clickable ? "button" : undefined}
                      tabIndex={clickable ? 0 : undefined}
                      aria-label={
                        clickable
                          ? `${part!.name}: ${activity?.direct ?? 0} прямых подходов`
                          : undefined
                      }
                      aria-pressed={clickable ? !!active : undefined}
                      onClick={clickable ? choose : undefined}
                      onKeyDown={
                        clickable
                          ? (e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                choose();
                              }
                            }
                          : undefined
                      }
                      onMouseEnter={() => setHovered(part ?? null)}
                      onMouseLeave={() => setHovered(null)}
                      onFocus={() => setHovered(part ?? null)}
                      onBlur={() => setHovered(null)}
                    >
                      {paths.map((d, i) => (
                        <path d={d} key={i} />
                      ))}
                      {part ? (
                        <title>
                          {part.name}
                          {exercise
                            ? role
                              ? " · " +
                                {
                                  primary: "движитель",
                                  assistant: "помощь",
                                  stabilizer: "стабилизация",
                                }[role]
                              : ""
                            : ` · ${activity?.direct ?? 0} прямых подходов`}
                        </title>
                      ) : null}
                    </g>
                  );
                })}
              </svg>
              <span>{view === "front" ? "СПЕРЕДИ" : "СЗАДИ"}</span>
            </m.div>
          ))}
      </div>
      {!compact ? (
        <div className="atlas-hover" aria-live="polite">
          {hovered ? (
            <>
              <b>{hovered.name}</b>
              <span>
                {exercise
                  ? "Роль в выбранном упражнении"
                  : `${presenter.activity(hovered).direct} прямых · ${presenter.activity(hovered).assisting} помощь · ${presenter.activity(hovered).stabilizing} стабилизация`}
              </span>
            </>
          ) : (
            <>
              <b>Выбери мышцу на карте</b>
              <span>Нажатием, клавишей Tab или Enter</span>
            </>
          )}
        </div>
      ) : null}
      <div className="map-legend">
        {(exercise
          ? [
              ["#cafa64", "Движители"],
              ["#b6a1e8", "Помощь"],
              ["#dfb385", "Стабилизация"],
            ]
          : [
              ["#363c3d", "Нет прямой работы"],
              ["#9dbd68", "Ниже ориентира"],
              ["#cafa64", "Ориентир"],
              ["#e3b279", "Выше ориентира"],
            ]
        ).map(([color, label]) => (
          <span key={label}>
            <i style={{ background: color }} />
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}
