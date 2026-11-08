import { useMemo, useState } from "react";
import { m } from "motion/react";
import { RotateCw, Layers } from "lucide-react";
import atlas from "../assets/anatomy/muscle-map.json";
import {
  AnatomyPresenter,
  loadColor,
  type AnatomyPart,
} from "../domain/AnatomyPresenter";
import { CHEST_HEADS, DELTOID_HEADS } from "../data/muscles";
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
  const [showSubheads, setShowSubheads] = useState(true);
  const presenter = useMemo(
    () => new AnatomyPresenter(loads, workouts, options),
    [loads, workouts, options],
  );

  const getPartFill = (p: AnatomyPart | undefined, fallback: string) => {
    if (!p) return fallback;
    if (exercise) {
      const r = presenter.exerciseRole(p, exercise);
      return r === "primary"
        ? "#cafa64"
        : r === "assistant"
          ? "#b6a1e8"
          : r === "stabilizer"
            ? "#dfb385"
            : "#303637";
    }
    const act = presenter.activity(p);
    return act ? loadColor(act.ratio) : "#2c3233";
  };

  const partUpperChest = useMemo(() => presenter.part("chest-upper", "front"), [presenter]);
  const partMidChest = useMemo(() => presenter.part("chest-mid", "front"), [presenter]);
  const partLowerChest = useMemo(() => presenter.part("chest-lower", "front"), [presenter]);

  const partAntDelt = useMemo(() => presenter.part("deltoid-anterior", "front"), [presenter]);
  const partMidDeltFront = useMemo(() => presenter.part("deltoid-middle", "front"), [presenter]);

  const partPostDelt = useMemo(() => presenter.part("deltoid-posterior", "back"), [presenter]);
  const partMidDeltBack = useMemo(() => presenter.part("deltoid-middle", "back"), [presenter]);

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
          <button
            type="button"
            className={`map-subhead-toggle ${showSubheads ? "active" : ""}`}
            onClick={() => setShowSubheads((v) => !v)}
            title="Переключить детальные пучки мышц (дельты и грудь)"
            aria-pressed={showSubheads}
          >
            <Layers size={14} />
            <span>Пучки</span>
          </button>
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
                <defs>
                  {/* Front Chest Clips */}
                  <clipPath id="clip-front-chest-upper">
                    <polygon points="220,300 500,300 500,358 362,352 220,358" />
                  </clipPath>
                  <clipPath id="clip-front-chest-mid">
                    <polygon points="220,358 362,352 500,358 500,398 362,402 220,398" />
                  </clipPath>
                  <clipPath id="clip-front-chest-lower">
                    <polygon points="220,398 362,402 500,398 500,460 220,460" />
                  </clipPath>

                  {/* Front Deltoid Clips */}
                  <clipPath id="clip-front-delt-ant-left">
                    <polygon points="244,280 290,280 290,410 236,410" />
                  </clipPath>
                  <clipPath id="clip-front-delt-mid-left">
                    <polygon points="180,280 244,280 236,410 180,410" />
                  </clipPath>
                  <clipPath id="clip-front-delt-ant-right">
                    <polygon points="440,280 488,280 496,410 440,410" />
                  </clipPath>
                  <clipPath id="clip-front-delt-mid-right">
                    <polygon points="488,280 560,280 560,410 496,410" />
                  </clipPath>

                  {/* Back Deltoid Clips */}
                  <clipPath id="clip-back-delt-post-left">
                    <polygon points="948,290 995,290 995,410 940,410" />
                  </clipPath>
                  <clipPath id="clip-back-delt-mid-left">
                    <polygon points="900,290 948,290 940,410 900,410" />
                  </clipPath>
                  <clipPath id="clip-back-delt-post-right">
                    <polygon points="1170,290 1218,290 1226,410 1170,410" />
                  </clipPath>
                  <clipPath id="clip-back-delt-mid-right">
                    <polygon points="1218,290 1270,290 1270,410 1226,410" />
                  </clipPath>
                </defs>

                <path
                  d={atlas[view].outline}
                  fill="#1b2021"
                  stroke="#374140"
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
                      ? part.slug === selectedPart ||
                        (selectedPart.startsWith("chest-") && data.slug === "chest") ||
                        (selectedPart.startsWith("deltoid-") && data.slug === "deltoids")
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

                  const isChest = view === "front" && data.slug === "chest";
                  const isFrontDelt = view === "front" && data.slug === "deltoids";
                  const isBackDelt = view === "back" && data.slug === "deltoids";

                  return (
                    <g
                      key={data.slug}
                      className={`atlas-muscle ${active ? "selected" : ""} ${clickable ? "clickable" : ""}`}
                      fill={fill}
                      stroke={active ? "#f0ffd9" : "#172021"}
                      strokeWidth={active ? 4.5 : 2.2}
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
                      {/* Detailed chest subdivisions */}
                      {isChest && showSubheads ? (
                        <g className="subdivided-chest">
                          {/* Upper Chest (Ключичная часть) */}
                          <g
                            clipPath="url(#clip-front-chest-upper)"
                            fill={getPartFill(partUpperChest, fill)}
                            className={`muscle-subhead ${selectedPart === "chest-upper" ? "subhead-selected" : ""}`}
                            onMouseEnter={(e) => {
                              e.stopPropagation();
                              if (partUpperChest) setHovered(partUpperChest);
                            }}
                            onClick={(e) => {
                              if (!clickable || !partUpperChest) return;
                              e.stopPropagation();
                              onSelect(partUpperChest.zone);
                              onPartSelect?.(partUpperChest);
                            }}
                          >
                            {paths.map((d, i) => (
                              <path d={d} key={`cu-${i}`} />
                            ))}
                          </g>

                          {/* Mid Chest (Грудинная часть) */}
                          <g
                            clipPath="url(#clip-front-chest-mid)"
                            fill={getPartFill(partMidChest, fill)}
                            className={`muscle-subhead ${selectedPart === "chest-mid" ? "subhead-selected" : ""}`}
                            onMouseEnter={(e) => {
                              e.stopPropagation();
                              if (partMidChest) setHovered(partMidChest);
                            }}
                            onClick={(e) => {
                              if (!clickable || !partMidChest) return;
                              e.stopPropagation();
                              onSelect(partMidChest.zone);
                              onPartSelect?.(partMidChest);
                            }}
                          >
                            {paths.map((d, i) => (
                              <path d={d} key={`cm-${i}`} />
                            ))}
                          </g>

                          {/* Lower Chest (Брюшная часть) */}
                          <g
                            clipPath="url(#clip-front-chest-lower)"
                            fill={getPartFill(partLowerChest, fill)}
                            className={`muscle-subhead ${selectedPart === "chest-lower" ? "subhead-selected" : ""}`}
                            onMouseEnter={(e) => {
                              e.stopPropagation();
                              if (partLowerChest) setHovered(partLowerChest);
                            }}
                            onClick={(e) => {
                              if (!clickable || !partLowerChest) return;
                              e.stopPropagation();
                              onSelect(partLowerChest.zone);
                              onPartSelect?.(partLowerChest);
                            }}
                          >
                            {paths.map((d, i) => (
                              <path d={d} key={`cl-${i}`} />
                            ))}
                          </g>

                          {/* Dividing lines */}
                          <path
                            d="M 252 358 Q 306 355 362 352 Q 418 355 472 358"
                            fill="none"
                            stroke="#172021"
                            strokeWidth="2.5"
                            strokeLinecap="round"
                            pointerEvents="none"
                          />
                          <path
                            d="M 255 398 Q 308 400 362 402 Q 416 400 469 398"
                            fill="none"
                            stroke="#172021"
                            strokeWidth="2.5"
                            strokeLinecap="round"
                            pointerEvents="none"
                          />
                        </g>
                      ) : isFrontDelt && showSubheads ? (
                        <g className="subdivided-front-delts">
                          {/* Anterior Deltoids (Left & Right) */}
                          <g
                            clipPath="url(#clip-front-delt-ant-left)"
                            fill={getPartFill(partAntDelt, fill)}
                            className={`muscle-subhead ${selectedPart === "deltoid-anterior" ? "subhead-selected" : ""}`}
                            onMouseEnter={(e) => {
                              e.stopPropagation();
                              if (partAntDelt) setHovered(partAntDelt);
                            }}
                            onClick={(e) => {
                              if (!clickable || !partAntDelt) return;
                              e.stopPropagation();
                              onSelect(partAntDelt.zone);
                              onPartSelect?.(partAntDelt);
                            }}
                          >
                            {paths.map((d, i) => (
                              <path d={d} key={`dal-${i}`} />
                            ))}
                          </g>
                          <g
                            clipPath="url(#clip-front-delt-ant-right)"
                            fill={getPartFill(partAntDelt, fill)}
                            className={`muscle-subhead ${selectedPart === "deltoid-anterior" ? "subhead-selected" : ""}`}
                            onMouseEnter={(e) => {
                              e.stopPropagation();
                              if (partAntDelt) setHovered(partAntDelt);
                            }}
                            onClick={(e) => {
                              if (!clickable || !partAntDelt) return;
                              e.stopPropagation();
                              onSelect(partAntDelt.zone);
                              onPartSelect?.(partAntDelt);
                            }}
                          >
                            {paths.map((d, i) => (
                              <path d={d} key={`dar-${i}`} />
                            ))}
                          </g>

                          {/* Middle Deltoids Front (Left & Right) */}
                          <g
                            clipPath="url(#clip-front-delt-mid-left)"
                            fill={getPartFill(partMidDeltFront, fill)}
                            className={`muscle-subhead ${selectedPart === "deltoid-middle" ? "subhead-selected" : ""}`}
                            onMouseEnter={(e) => {
                              e.stopPropagation();
                              if (partMidDeltFront) setHovered(partMidDeltFront);
                            }}
                            onClick={(e) => {
                              if (!clickable || !partMidDeltFront) return;
                              e.stopPropagation();
                              onSelect(partMidDeltFront.zone);
                              onPartSelect?.(partMidDeltFront);
                            }}
                          >
                            {paths.map((d, i) => (
                              <path d={d} key={`dml-${i}`} />
                            ))}
                          </g>
                          <g
                            clipPath="url(#clip-front-delt-mid-right)"
                            fill={getPartFill(partMidDeltFront, fill)}
                            className={`muscle-subhead ${selectedPart === "deltoid-middle" ? "subhead-selected" : ""}`}
                            onMouseEnter={(e) => {
                              e.stopPropagation();
                              if (partMidDeltFront) setHovered(partMidDeltFront);
                            }}
                            onClick={(e) => {
                              if (!clickable || !partMidDeltFront) return;
                              e.stopPropagation();
                              onSelect(partMidDeltFront.zone);
                              onPartSelect?.(partMidDeltFront);
                            }}
                          >
                            {paths.map((d, i) => (
                              <path d={d} key={`dmr-${i}`} />
                            ))}
                          </g>

                          {/* Deltoid dividing grooves */}
                          <path
                            d="M 244 310 L 236 385"
                            fill="none"
                            stroke="#172021"
                            strokeWidth="2.2"
                            strokeLinecap="round"
                            pointerEvents="none"
                          />
                          <path
                            d="M 488 310 L 496 385"
                            fill="none"
                            stroke="#172021"
                            strokeWidth="2.2"
                            strokeLinecap="round"
                            pointerEvents="none"
                          />
                        </g>
                      ) : isBackDelt && showSubheads ? (
                        <g className="subdivided-back-delts">
                          {/* Posterior Deltoids (Left & Right) */}
                          <g
                            clipPath="url(#clip-back-delt-post-left)"
                            fill={getPartFill(partPostDelt, fill)}
                            className={`muscle-subhead ${selectedPart === "deltoid-posterior" ? "subhead-selected" : ""}`}
                            onMouseEnter={(e) => {
                              e.stopPropagation();
                              if (partPostDelt) setHovered(partPostDelt);
                            }}
                            onClick={(e) => {
                              if (!clickable || !partPostDelt) return;
                              e.stopPropagation();
                              onSelect(partPostDelt.zone);
                              onPartSelect?.(partPostDelt);
                            }}
                          >
                            {paths.map((d, i) => (
                              <path d={d} key={`dpl-${i}`} />
                            ))}
                          </g>
                          <g
                            clipPath="url(#clip-back-delt-post-right)"
                            fill={getPartFill(partPostDelt, fill)}
                            className={`muscle-subhead ${selectedPart === "deltoid-posterior" ? "subhead-selected" : ""}`}
                            onMouseEnter={(e) => {
                              e.stopPropagation();
                              if (partPostDelt) setHovered(partPostDelt);
                            }}
                            onClick={(e) => {
                              if (!clickable || !partPostDelt) return;
                              e.stopPropagation();
                              onSelect(partPostDelt.zone);
                              onPartSelect?.(partPostDelt);
                            }}
                          >
                            {paths.map((d, i) => (
                              <path d={d} key={`dpr-${i}`} />
                            ))}
                          </g>

                          {/* Middle Deltoids Back (Left & Right) */}
                          <g
                            clipPath="url(#clip-back-delt-mid-left)"
                            fill={getPartFill(partMidDeltBack, fill)}
                            className={`muscle-subhead ${selectedPart === "deltoid-middle" ? "subhead-selected" : ""}`}
                            onMouseEnter={(e) => {
                              e.stopPropagation();
                              if (partMidDeltBack) setHovered(partMidDeltBack);
                            }}
                            onClick={(e) => {
                              if (!clickable || !partMidDeltBack) return;
                              e.stopPropagation();
                              onSelect(partMidDeltBack.zone);
                              onPartSelect?.(partMidDeltBack);
                            }}
                          >
                            {paths.map((d, i) => (
                              <path d={d} key={`dbml-${i}`} />
                            ))}
                          </g>
                          <g
                            clipPath="url(#clip-back-delt-mid-right)"
                            fill={getPartFill(partMidDeltBack, fill)}
                            className={`muscle-subhead ${selectedPart === "deltoid-middle" ? "subhead-selected" : ""}`}
                            onMouseEnter={(e) => {
                              e.stopPropagation();
                              if (partMidDeltBack) setHovered(partMidDeltBack);
                            }}
                            onClick={(e) => {
                              if (!clickable || !partMidDeltBack) return;
                              e.stopPropagation();
                              onSelect(partMidDeltBack.zone);
                              onPartSelect?.(partMidDeltBack);
                            }}
                          >
                            {paths.map((d, i) => (
                              <path d={d} key={`dbmr-${i}`} />
                            ))}
                          </g>

                          {/* Deltoid dividing grooves */}
                          <path
                            d="M 948 318 L 940 385"
                            fill="none"
                            stroke="#172021"
                            strokeWidth="2.2"
                            strokeLinecap="round"
                            pointerEvents="none"
                          />
                          <path
                            d="M 1218 318 L 1226 385"
                            fill="none"
                            stroke="#172021"
                            strokeWidth="2.2"
                            strokeLinecap="round"
                            pointerEvents="none"
                          />
                        </g>
                      ) : (
                        paths.map((d, i) => <path d={d} key={i} />)
                      )}

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

      {/* Quick Head Badges if Chest or Shoulders is Selected */}
      {!compact && (selected === "chest" || selected === "shoulders") && (
        <div className="subhead-chips" role="group" aria-label="Пучки выбранной группы">
          <span className="subhead-chips-label">
            {selected === "chest" ? "Отделы груди:" : "Пучки дельт:"}
          </span>
          <div className="subhead-chips-list">
            <button
              type="button"
              className={`subhead-chip ${!selectedPart || selectedPart === "chest" || selectedPart === "deltoids" ? "active" : ""}`}
              onClick={() => {
                if (selected === "chest") {
                  const p = presenter.part("chest", "front");
                  if (p) onPartSelect?.(p);
                } else {
                  const p = presenter.part("deltoids", "front");
                  if (p) onPartSelect?.(p);
                }
              }}
            >
              Вся группа
            </button>
            {(selected === "chest" ? CHEST_HEADS : DELTOID_HEADS).map((head) => {
              const headPart = presenter.part(head.slug, selected === "chest" ? "front" : (head.slug === "deltoid-posterior" ? "back" : "front"));
              const headAct = headPart ? presenter.activity(headPart) : null;
              const isChipActive = selectedPart === head.slug;
              return (
                <button
                  type="button"
                  key={head.id}
                  className={`subhead-chip ${isChipActive ? "active" : ""}`}
                  onClick={() => {
                    if (headPart) {
                      onSelect(headPart.zone);
                      onPartSelect?.(headPart);
                    }
                  }}
                >
                  <span className="chip-name">{head.name}</span>
                  {headAct && (
                    <span className="chip-count">{headAct.direct}</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

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
              <span>Нажатием на пучок или группу мышц</span>
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
