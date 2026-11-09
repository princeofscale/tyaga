import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, m, useReducedMotion } from "motion/react";
import BiomechanicsPanel from "./BiomechanicsPanel";
import NumberField from "./NumberField";
import {
  Check,
  ChevronDown,
  Plus,
  Minus,
  Trash2,
  Pause,
  Play,
  Info,
  Download,
  X,
  Dumbbell,
  Target,
  Sparkles,
  Activity,
  Volume2,
  VolumeX,
  Flame,
  RotateCcw,
  TrendingUp,
  Zap,
  Link2,
  ArrowLeftRight,
  Focus,
  CheckCircle2,
} from "lucide-react";
import PlateCalculator from "./PlateCalculator";
import OneRepMaxCalculator from "./OneRepMaxCalculator";
import { WarmupModal } from "./WarmupModal";
import ExerciseSwapModal from "./ExerciseSwapModal";
import BodyMap from "./BodyMap";
import Modal from "./Modal";
import { audioHaptics } from "../lib/audioHaptics";
import type { Exercise } from "../lib/types";
import { detectExerciseEquipment } from "../domain/ExerciseAlternatives";
import {
  MUSCLES,
  exerciseForEntry,
  entryName,
  recordingLabel,
  fmt,
  lastEntry,
  localDate,
  makeSets,
  volumeSummary,
  workingSets,
  type Workout,
  type SetEntry,
  type Settings,
  type WorkoutExercise,
} from "../lib/model";
import {
  checkpointDraft,
  elapsedMs,
  sessionMs,
  restAfterSetToggle,
  type Draft,
  type PersistenceStatus,
} from "../lib/draft";
export type { Draft } from "../lib/draft";
import { WarmupPlanner } from "../domain/WarmupPlanner";
import Select from "./Select";

type Props = {
  draft: Draft | null;
  update: (draft: Draft) => void;
  settings: Settings;
  history: Workout[];
  saving: boolean;
  error: string;
  persistence: PersistenceStatus;
  onPick: () => void;
  onSave: () => void;
  onDiscard: () => void;
  onExport: () => void;
  onMinimize: () => void;
};
const clock = (seconds: number) =>
  `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
const setCheckFeedback = {
  idle: { scale: 1 },
  complete: { scale: [0.82, 1.1, 1] },
};
/** "80 × 8" for the set at the same position (working or warm-up) last time. */
function previousLabel(entry: WorkoutExercise, previous?: SetEntry) {
  if (!previous) return "—";
  const spec = exerciseForEntry(entry)!.recording;
  if (spec.type === "duration") return `${previous.durationSeconds ?? 0} с`;
  if (spec.loadMode === "bodyweight") return `× ${previous.reps}`;
  if (spec.loadMode === "assisted_bodyweight")
    return `${fmt(previous.assistanceKg ?? 0)} × ${previous.reps}`;
  return `${fmt(previous.weight)} × ${previous.reps}`;
}
const playTimerChime = () => {
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof window.AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;

    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = "sine";
    osc1.frequency.setValueAtTime(880, now);
    osc1.frequency.exponentialRampToValueAtTime(1320, now + 0.15);
    gain1.gain.setValueAtTime(0.25, now);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.35);

    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = "sine";
    osc2.frequency.setValueAtTime(1760, now + 0.18);
    gain2.gain.setValueAtTime(0.2, now + 0.18);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(now + 0.18);
    osc2.stop(now + 0.5);
  } catch {
    // AudioContext blocked
  }
  try {
    if (navigator.vibrate) {
      navigator.vibrate([120, 80, 180]);
    }
  } catch {
    // vibrate ignored
  }
};

const playSetDoneChime = () => {
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof window.AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(587.33, now); // D5
    osc.frequency.exponentialRampToValueAtTime(880, now + 0.08); // A5
    gain.gain.setValueAtTime(0.2, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.22);
  } catch {
    // AudioContext blocked
  }
  try {
    if (navigator.vibrate) {
      navigator.vibrate([35, 25, 45]);
    }
  } catch {
    // vibrate ignored
  }
};

function getExerciseHeadBadges(exerciseId: string, exerciseName: string) {
  const id = exerciseId.toLowerCase();
  const name = exerciseName.toLowerCase();
  const badges: { text: string; kind: string }[] = [];

  // Chest Heads
  if (id.includes("incline") || name.includes("наклон") || id.includes("pullover")) {
    badges.push({ text: "Верх груди", kind: "head-upper" });
  } else if (id.includes("decline") || id.includes("dip") || id.includes("high-cable-fly") || name.includes("брусь") || name.includes("сверху")) {
    badges.push({ text: "Низ груди", kind: "head-lower" });
  } else if (id.includes("bench") || id.includes("fly") || id.includes("pushup") || name.includes("жим лежа") || name.includes("разведение") || name.includes("грудь")) {
    badges.push({ text: "Середина груди", kind: "head-mid" });
  }

  // Shoulder Heads
  if (id.includes("ohp") || id.includes("shoulder-press") || name.includes("армейский") || name.includes("жим стоя") || name.includes("жим сидя") || name.includes("передняя")) {
    badges.push({ text: "Передняя дельта", kind: "head-ant" });
    badges.push({ text: "Средняя дельта", kind: "head-mid-delt" });
  } else if (id.includes("lateral") || name.includes("махи в стороны") || name.includes("боковые")) {
    badges.push({ text: "Средняя дельта", kind: "head-mid-delt" });
  } else if (id.includes("rear-delt") || id.includes("facepull") || name.includes("задн") || name.includes("фейспул")) {
    badges.push({ text: "Задняя дельта", kind: "head-post" });
  }

  // Back & Lower Body Focal Zones
  if (id.includes("pulldown") || id.includes("pullup") || name.includes("подтягивания") || name.includes("верхнего блока") || name.includes("тяга штанги в наклоне")) {
    badges.push({ text: "Широчайшие", kind: "head-lats" });
  } else if (id.includes("squat") || id.includes("legpress") || name.includes("присед") || name.includes("жим ногами") || name.includes("квадрицепс")) {
    badges.push({ text: "Квадрицепс", kind: "head-quads" });
  } else if (id.includes("deadlift") || id.includes("rdl") || (name.includes("тяга") && (name.includes("становая") || name.includes("румынская")))) {
    badges.push({ text: "Задняя цепь", kind: "head-chain" });
  }

  return badges;
}

export default function WorkoutView({
  draft,
  update: commitDraft,
  settings,
  history,
  saving,
  error,
  persistence,
  onPick,
  onSave,
  onDiscard,
  onExport,
  onMinimize,
}: Props) {
  const reducedMotion = useReducedMotion();
  const [now, setNow] = useState(Date.now());
  const [announcement, setAnnouncement] = useState("");
  const [rirHelp, setRirHelp] = useState(false);
  const [toolModal, setToolModal] = useState<"warmup" | "orm" | null>(null);
  const [plateCalcTarget, setPlateCalcTarget] = useState<{ weight: number; ei: number } | null>(null);
  const [oneRepMaxTarget, setOneRepMaxTarget] = useState<{ weight: number; reps: number } | null>(null);
  const [swapTarget, setSwapTarget] = useState<{ ei: number; exercise: Exercise } | null>(null);
  const [expandedAnatomy, setExpandedAnatomy] = useState<string | null>(null);
  const [activeSetKey, setActiveSetKey] = useState<string | null>(null);
  const [focusMode, setFocusMode] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [expandedExercises, setExpandedExercises] = useState<Record<number, boolean>>({});
  const [soundEnabled, setSoundEnabled] = useState(() => !audioHaptics.isMuted());

  useEffect(() => {
    audioHaptics.setMuted(!soundEnabled);
  }, [soundEnabled]);

  const restSeconds = draft?.workout.restSeconds ?? settings.restSeconds;
  const announcedTimer = useRef<number | null>(null);
  const lastTickSecond = useRef<number | null>(null);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const remaining =
    draft?.pausedRest ??
    (draft?.restUntil
      ? Math.max(0, Math.ceil((draft.restUntil - now) / 1000))
      : 0);
  useEffect(() => {
    if (
      draft?.restUntil &&
      draft.pausedRest === null &&
      draft.restUntil <= now &&
      announcedTimer.current !== draft.restUntil
    ) {
      announcedTimer.current = draft.restUntil;
      setAnnouncement("Отдых завершён");
      if (soundEnabled) {
        audioHaptics.playTimerAlert();
      }
    } else if (remaining > 0) {
      setAnnouncement("");
      if (remaining <= 3 && soundEnabled && lastTickSecond.current !== remaining) {
        lastTickSecond.current = remaining;
        audioHaptics.playCountdownTick();
      }
    }
  }, [draft?.restUntil, draft?.pausedRest, now, remaining, soundEnabled]);
  const exercises = draft?.workout.exercises;
  const workoutId = draft?.workout.id;
  const previous = useMemo(
    () =>
      new Map(
        (exercises ?? []).map((e) => {
          const sets = lastEntry(history, e, workoutId)?.sets.filter((s) => s.done) ?? [];
          return [
            e.exerciseId,
            {
              working: sets.filter((s) => !s.warmup),
              warmup: sets.filter((s) => s.warmup),
            },
          ];
        }),
      ),
    [history, exercises, workoutId],
  );
  if (!draft)
    return (
      <div className="empty-state">
        <div className="empty-icon">
          <Play size={30} />
        </div>
        <h2>Время сделать первый подход</h2>
        <p>Выбери упражнения и записывай вес, повторы и запас повторений.</p>
        <button className="button primary" onClick={onPick}>
          <Plus size={18} />
          Начать тренировку
        </button>
      </div>
    );
  const w = draft.workout;
  const update = (next: Draft) => commitDraft({ ...next, activityAt: Date.now() });
  const setWorkout = (workout: Workout) => update({ ...draft, workout });
  const patchExercise = (ei: number, patch: Partial<WorkoutExercise>) =>
    setWorkout({
      ...w,
      exercises: w.exercises.map((e, i) => (i === ei ? { ...e, ...patch } : e)),
    });

  const cycleSetKind = (s: SetEntry): { kind: "normal" | "warmup" | "dropset" | "myorep"; warmup: boolean } => {
    const cur = s.kind || (s.warmup ? "warmup" : "normal");
    if (cur === "normal") return { kind: "warmup", warmup: true };
    if (cur === "warmup") return { kind: "dropset", warmup: false };
    if (cur === "dropset") return { kind: "myorep", warmup: false };
    return { kind: "normal", warmup: false };
  };

  const changeSet = (ei: number, si: number, patch: Partial<SetEntry>) => {
    if (patch.done && soundEnabled) {
      audioHaptics.playSetDone();
    }

    const targetEx = w.exercises[ei];
    const isSupersetTransition =
      patch.done &&
      targetEx?.supersetId &&
      w.exercises[ei + 1]?.supersetId === targetEx.supersetId;
    const effectiveRest = isSupersetTransition ? 15 : restSeconds;

    update({
      ...draft,
      workout: {
        ...w,
        exercises: w.exercises.map((e, i) =>
          i === ei
            ? {
                ...e,
                sets: e.sets.map((s, j) => (j === si ? { ...s, ...patch } : s)),
              }
            : e,
        ),
      },
      ...(patch.done === undefined
        ? {}
        : (restAfterSetToggle(draft, targetEx?.sets[si]?.id ?? "", patch.done, effectiveRest) ?? {})),
    });
  };

  const bumpWeight = (ei: number, si: number, delta: number) => {
    const s = w.exercises[ei].sets[si];
    const spec = exerciseForEntry(w.exercises[ei])!.recording;
    if (spec.loadMode === "assisted_bodyweight") {
      const cur = s.assistanceKg ?? 0;
      const next = Math.max(0, Math.round((cur + delta) * 10) / 10);
      changeSet(ei, si, { assistanceKg: next });
    } else {
      const cur = s.weight;
      const next = Math.max(0, Math.round((cur + delta) * 10) / 10);
      changeSet(ei, si, { weight: next });
    }
  };

  // Стартовые значения для калькуляторов: последний выполненный рабочий подход, иначе первый с весом.
  const toolDefaults = (() => {
    const working = w.exercises.flatMap((e) => e.sets.filter((x) => !x.warmup && x.weight > 0));
    const pick = [...working].reverse().find((x) => x.done) ?? working[0];
    return { weight: pick?.weight ?? 80, reps: pick?.reps ?? 6 };
  })();
  const elapsed = draft.manualDuration
    ? w.duration
    : Math.floor(sessionMs(draft, now) / 60000);
  const summary = volumeSummary([w]);
  const warmupSummary = volumeSummary([w], "warmup");
  const warmupCount = w.exercises.reduce(
    (n, e) => n + e.sets.filter((s) => s.done && s.warmup).length,
    0,
  );
  const doneWorking = workingSets([w]);
  const totalWorking = w.exercises.reduce(
    (count, exercise) => count + exercise.sets.filter((set) => !set.warmup).length,
    0,
  );
  const resting = remaining > 0 || draft.pausedRest !== null;
  const shiftRest = (seconds: number) =>
    update(
      draft.pausedRest !== null
        ? { ...draft, pausedRest: Math.max(0, draft.pausedRest + seconds) }
        : {
            ...draft,
            restUntil: Math.max(Date.now(), draft.restUntil ?? 0) + seconds * 1000,
          },
    );
  return (
    <div className="workout-screen workout-athletic">
      <header className="workout-bar">
        <button
          className="icon-button workout-minimize-btn"
          aria-label="Свернуть тренировку"
          onClick={onMinimize}
        >
          <ChevronDown size={24} />
        </button>
        <div className="workout-bar-title">
          <span className="workout-session-label" aria-hidden="true">
            {draft.editing ? "Редактирование тренировки" : "Активная тренировка"}
          </span>
          <input
            aria-label="Название тренировки"
            value={w.name}
            maxLength={120}
            disabled={saving}
            onChange={(e) => setWorkout({ ...w, name: e.target.value })}
          />
        </div>
        <button
          type="button"
          className={`icon-button focus-toggle-btn ${focusMode ? "active" : ""}`}
          aria-label={focusMode ? "Выключить режим фокуса" : "Включить режим фокуса"}
          aria-pressed={focusMode}
          title={focusMode ? "Режим фокуса: активен (завершённые свёрнуты)" : "Режим фокуса (сворачивать завершённые)"}
          onClick={() => setFocusMode((v) => !v)}
        >
          <Focus size={18} />
        </button>
        <button
          type="button"
          className="icon-button sound-toggle-btn"
          aria-label={soundEnabled ? "Выключить звук" : "Включить звук"}
          aria-pressed={soundEnabled}
          title={soundEnabled ? "Звуковые сигналы включены" : "Звуковые сигналы выключены"}
          onClick={() => setSoundEnabled((v) => !v)}
        >
          {soundEnabled ? <Volume2 size={20} /> : <VolumeX size={20} />}
        </button>
        <div className="workout-head-buttons-cluster">
          <button
            type="button"
            className="button secondary cancel-workout-btn"
            title="Завершить тренировку без сохранения"
            onClick={() => setShowCancelConfirm(true)}
          >
            <X size={15} />
            <span>Отмена</span>
          </button>
          <button
            className="button primary finish-button"
            aria-label={draft.editing ? "Сохранить изменения" : "Завершить тренировку"}
            onClick={onSave}
            disabled={
              saving ||
              !w.exercises.some((e) => e.sets.some((s) => s.done && !s.warmup))
            }
          >
            {saving ? "…" : draft.editing ? "Сохранить" : "Завершить"}
          </button>
        </div>
        <div className="workout-live-hud">
          <span className="live-clock-badge">
            <b>
              <span
                aria-hidden="true"
                className={`live-rec-dot ${draft.clock.runningSince !== null && !draft.manualDuration ? "recording" : "paused"}`}
              />
              {draft.manualDuration
                ? `${w.duration} мин`
                : clock(Math.floor(elapsedMs(draft, now) / 1000))}
            </b>
            <span className="hud-label">
              {draft.manualDuration
                ? "Длительность"
                : draft.clock.runningSince === null
                  ? "Счётчик · пауза"
                  : "Счётчик"}
            </span>
          </span>
          <span className="hud-metric">
            <b>{doneWorking}<small> / {totalWorking}</small></b>
            <span className="hud-label">Рабочие подходы</span>
          </span>
          <span className="hud-metric hud-tonnage">
            <b>{fmt(summary.total)}<small> кг</small></b>
            <span className="hud-label">Рабочий тоннаж</span>
          </span>
        </div>
        <div className="workout-session-progress" aria-hidden="true">
          <span style={{ transform: `scaleX(${totalWorking ? doneWorking / totalWorking : 0})` }} />
        </div>
      </header>
      {error ? (
        <p className="inline-error" role="alert">
          {error}
        </p>
      ) : null}
      {persistence === "failed" ? (
        <div className="inline-error" role="alert">
          Черновик сейчас только в открытой форме: не удалось сохранить его на
          устройстве. Не закрывай журнал до завершения тренировки.
          <button className="text-button" onClick={onExport}>
            <Download size={15} />
            Скачать черновик
          </button>
        </div>
      ) : null}
      <div className="workout-tools" role="group" aria-label="Инструменты тренировки">
        <button type="button" onClick={() => setToolModal("warmup")}>
          <Flame size={16} aria-hidden="true" />
          <span>
            <b>Разминочная лесенка</b>
            <small>Подводящие подходы к рабочему весу</small>
          </span>
        </button>
        <button type="button" onClick={() => setToolModal("orm")}>
          <Target size={16} aria-hidden="true" />
          <span>
            <b>Проверить 1ПМ</b>
            <small>Максимум и проценты по подходу</small>
          </span>
        </button>
      </div>
      <fieldset
        className="workout-main"
        disabled={saving}
        aria-label="Поля тренировки"
      >
        {!w.exercises.length ? (
          <p className="workout-empty">
            Добавь первое упражнение — веса подставим из прошлой тренировки.
          </p>
        ) : null}
        {w.exercises.map((we, ei) => {
          const exercise = exerciseForEntry(we)!;
          const spec = exercise.recording;
          const timed = spec.type === "duration";
          const assistance = spec.loadMode === "assisted_bodyweight";
          const noLoad = spec.loadMode === "bodyweight";
          const before = previous.get(we.exerciseId);
          const heading =
            spec.loadMode === "per_implement"
              ? "кг / гант."
              : assistance
                ? "Помощь"
                : spec.loadMode === "added_bodyweight"
                  ? "Доп. кг"
                  : spec.loadMode === "machine_stack"
                    ? "Стек"
                    : noLoad
                      ? "Вес"
                      : "кг";
          // Only unusual recording rules need words; plain barbell kg do not.
          const hint = exercise.source
            ? `${timed ? "Длительность в секундах. " : ""}Непроверенная запись базы: тоннаж, 1ПМ и покрытие мышц не считаются.`
            : exercise.catalogRevision === 1
              ? "Старая запись: правило веса неизвестно. Вес сохранится как введён; тоннаж и 1ПМ не считаются."
              : [
                  spec.loadMode === "per_implement" ? "Вес одной гантели." : "",
                  spec.implementCount === 2 ? "В работе две гантели / два блока." : "",
                  spec.repsMode === "per_side" ? "Повторы на сторону." : "",
                ]
                  .join(" ")
                  .trim();
          const plannedRange =
            we.repMin !== undefined && we.repMax !== undefined
              ? we.repMin === we.repMax
                ? String(we.repMin)
                : `${we.repMin}–${we.repMax}`
              : null;
          const headBadges = getExerciseHeadBadges(we.exerciseId, entryName(we));
          const allSetsDone = we.sets.length > 0 && we.sets.every((s) => s.done);
          const completedSets = we.sets.filter((set) => set.done).length;
          const quickSetIndex = we.sets.findIndex((_, si) => activeSetKey === `${ei}-${si}`);
          const quickSet = we.sets[quickSetIndex];
          const isCollapsedInFocus = focusMode && allSetsDone && !expandedExercises[ei];

          if (isCollapsedInFocus) {
            const topSet = we.sets.filter((s) => !s.warmup && s.weight > 0).sort((a, b) => b.weight - a.weight)[0];
            return (
              <Fragment key={`${we.exerciseId}-${ei}`}>
                <article className="exercise-card collapsed-focus-card">
                  <button
                    type="button"
                    className="collapsed-focus-row"
                    onClick={() => setExpandedExercises((prev) => ({ ...prev, [ei]: true }))}
                  >
                    <div className="collapsed-info-left">
                      <CheckCircle2 size={18} className="text-accent" />
                      <div className="collapsed-name-wrap">
                        <span className="collapsed-title">{entryName(we)}</span>
                        <span className="tiny muted">
                          {we.sets.length} подх. {topSet ? `· топ: ${topSet.weight} кг × ${topSet.reps}` : ""}
                        </span>
                      </div>
                    </div>
                    <span className="collapsed-toggle-action">Развернуть</span>
                  </button>
                </article>
                {we.supersetId && w.exercises[ei + 1]?.supersetId === we.supersetId && (
                  <div className="superset-connector-strip">
                    <div className="connector-line" />
                    <span className="connector-tag">
                      <Zap size={12} className="text-accent" />
                      Без отдыха переходи к следующему упражнению
                    </span>
                    <div className="connector-line" />
                  </div>
                )}
              </Fragment>
            );
          }

          const isBarbell = !timed && !noLoad && detectExerciseEquipment(exercise) === "barbell";
          const quickControls = !noLoad ? (
            <div className={`set-quick-controls-dock ${timed ? "is-timed" : ""}`}>
              <div className="quick-controls-heading">
                <span>Быстрая правка</span>
                <span>{quickSet ? `Подход ${quickSetIndex + 1}` : "Выбери подход"}</span>
              </div>
              <div className="set-quick-steppers-bar" onClick={(e) => e.stopPropagation()}>
                <div className="stepper-weights-group">
                  <span className="steppers-label">Вес:</span>
                  {[-5, -2.5, -1.25, 1.25, 2.5, 5].map((delta) => (
                    <button
                      key={delta}
                      type="button"
                      className="stepper-btn"
                      disabled={!quickSet}
                      onClick={() => {
                        if (quickSet) bumpWeight(ei, quickSetIndex, delta);
                      }}
                    >
                      {delta < 0 ? `−${Math.abs(delta)}` : `+${delta}`}
                    </button>
                  ))}
                </div>
                {!timed && (
                  <div className="rir-quick-group">
                    <span className="steppers-label">RIR:</span>
                    {[0, 1, 2, 3, 4].map((r) => (
                      <button
                        key={r}
                        type="button"
                        className={`rir-quick-btn ${quickSet?.rir === r ? "active" : ""}`}
                        aria-pressed={quickSet?.rir === r}
                        disabled={!quickSet}
                        onClick={() => {
                          if (quickSet) changeSet(ei, quickSetIndex, { rir: quickSet.rir === r ? null : r });
                        }}
                      >
                        {r}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : null;

          let working = 0;
          let warm = 0;
          return (
            <Fragment key={`${we.exerciseId}-${ei}`}>
              <article
                className={`exercise-card ${allSetsDone ? "exercise-completed" : ""} ${we.supersetId ? "in-superset" : ""}`}
              >
              {we.supersetId && (
                <div className="superset-card-badge">
                  <Zap size={12} className="text-accent" />
                  <span>СУПЕРСЕТ</span>
                </div>
              )}

              {/* Title & Delete Header (Always clean and uncrowded) */}
              <div className="exercise-card-head">
                <div className="exercise-head-left">
                  <div className="exercise-header-meta">
                    <span className="exercise-order" aria-hidden="true">
                      Упражнение {String(ei + 1).padStart(2, "0")}
                    </span>
                    <span className={`exercise-set-status ${allSetsDone ? "complete" : ""}`}>
                      {allSetsDone ? <CheckCircle2 size={13} aria-hidden="true" /> : null}
                      {completedSets} / {we.sets.length} подходов
                    </span>
                  </div>
                  <div className="title-with-badges">
                    <h3>{entryName(we)}</h3>
                    {headBadges.map((b) => (
                      <span key={b.text} className={`head-indicator-badge ${b.kind}`}>
                        {b.text}
                      </span>
                    ))}
                  </div>
                  <p>
                    {exercise.primary
                      .map((id) => MUSCLES.find((m) => m.id === id)!.short)
                      .join(" · ")}
                    {!timed && plannedRange
                      ? ` · ${we.sets.filter((s) => !s.warmup).length} × ${plannedRange} по плану`
                      : null}
                  </p>
                </div>
                <button
                  type="button"
                  className="icon-button exercise-delete-btn"
                  aria-label={`Убрать ${entryName(we)}`}
                  title="Убрать упражнение"
                  onClick={() =>
                    setWorkout({
                      ...w,
                      exercises: w.exercises.filter((_, i) => i !== ei),
                    })
                  }
                >
                  <Trash2 size={16} />
                </button>
              </div>

              {/* Dedicated Compact Toolbar Pills Row (Always inside card, never overflows) */}
              <div className="exercise-toolbar-pills">
                <button
                  type="button"
                  className="quick-calc-btn"
                  title="Заменить упражнение на аналогичное"
                  onClick={() => setSwapTarget({ ei, exercise })}
                >
                  <ArrowLeftRight size={13} />
                  <span>Заменить</span>
                </button>
                <button
                  type="button"
                  className={`quick-calc-btn superset-toggle-btn ${we.supersetId ? "active" : ""}`}
                  title={
                    we.supersetId
                      ? "Убрать из суперсета"
                      : "Объединить в суперсет с соседним упражнением"
                  }
                  onClick={() => {
                    if (we.supersetId) {
                      patchExercise(ei, { supersetId: undefined });
                    } else {
                      const prevSS = w.exercises[ei - 1]?.supersetId;
                      const targetSS = prevSS || `ss-${ei + 1}`;
                      patchExercise(ei, { supersetId: targetSS });
                      if (!prevSS && ei > 0) {
                        patchExercise(ei - 1, { supersetId: targetSS });
                      }
                    }
                  }}
                >
                  <Zap size={13} />
                  <span>{we.supersetId ? "В суперсете" : "Суперсет"}</span>
                </button>
                <button
                  type="button"
                  className={`quick-calc-btn ${expandedAnatomy === we.exerciseId ? "active" : ""}`}
                  title="Анатомический фокус упражнения"
                  onClick={() =>
                    setExpandedAnatomy((curr) =>
                      curr === we.exerciseId ? null : we.exerciseId,
                    )
                  }
                >
                  <Activity size={13} />
                  <span>Анатомия</span>
                </button>
                {isBarbell && (
                  <button
                    type="button"
                    className="quick-calc-btn"
                    title="Калькулятор блинов на штангу"
                    onClick={() => {
                      const firstSetWeight = we.sets.find((s) => s.weight > 0)?.weight ?? 60;
                      setPlateCalcTarget({ weight: firstSetWeight, ei });
                    }}
                  >
                    <Dumbbell size={13} />
                    <span>Блины</span>
                  </button>
                )}
                {!timed && !noLoad && (
                  <button
                    type="button"
                    className="quick-calc-btn"
                    title="Калькулятор 1ПМ"
                    onClick={() => {
                      const firstWorking = we.sets.find((s) => !s.warmup && s.weight > 0);
                      setOneRepMaxTarget({
                        weight: firstWorking?.weight ?? 60,
                        reps: firstWorking?.reps ?? 8,
                      });
                    }}
                  >
                    <Target size={13} />
                    <span>1ПМ</span>
                  </button>
                )}
              </div>

              <AnimatePresence initial={false}>
                {expandedAnatomy === we.exerciseId ? (
                  <BiomechanicsPanel
                    key="bio"
                    exercise={exercise}
                    name={entryName(we)}
                    badges={headBadges}
                    onClose={() => setExpandedAnatomy(null)}
                  />
                ) : null}
              </AnimatePresence>

              {hint ? (
                <p
                  className={`recording-hint ${exercise.catalogRevision === 1 ? "legacy-hint" : ""}`}
                >
                  <Info size={14} />
                  {hint}
                </p>
              ) : null}

              {we.progressionNote && !we.progressionNote.includes("правило программы") ? (
                <div className="progression-banner">
                  <TrendingUp size={15} className="text-accent" />
                  <span>{we.progressionNote}</span>
                </div>
              ) : null}
              {spec.laterality === "unilateral" ? (
                <label className="recording-field">
                  Выполненные стороны
                  <Select
                    aria-label="Выполненные стороны"
                    value={we.performedSides ?? "both"}
                    onChange={(v) =>
                      patchExercise(ei, {
                        performedSides: v as WorkoutExercise["performedSides"],
                      })
                    }
                    options={[
                      { value: "both", label: "Обе — один парный подход" },
                      { value: "left", label: "Только левая" },
                      { value: "right", label: "Только правая" },
                    ]}
                  />
                </label>
              ) : null}
              {["machine_stack", "assisted_bodyweight"].includes(
                spec.loadMode,
              ) ? (
                <label className="recording-field">
                  Тренажёр / блок
                  <input
                    aria-label="Тренажёр / блок"
                    maxLength={120}
                    value={we.equipmentNote ?? ""}
                    placeholder="Например: верхний блок у окна"
                    onChange={(e) =>
                      patchExercise(ei, { equipmentNote: e.target.value })
                    }
                    required
                  />
                  <small className="tiny">
                    Нужно для сохранения: вес сравнивается только на этой
                    машине.
                  </small>
                </label>
              ) : null}
              {exercise.bodyweight && exercise.catalogRevision === 2 ? (
                <details className="recording-extra">
                  <summary>Записать массу тела (по желанию)</summary>
                  <label>
                    Масса тела, кг
                    <input
                      type="number"
                      min="20"
                      max="400"
                      step="0.1"
                      value={we.bodyMassKg ?? ""}
                      onChange={(e) =>
                        patchExercise(ei, {
                          bodyMassKg:
                            e.target.value === ""
                              ? undefined
                              : Number(e.target.value),
                        })
                      }
                    />
                  </label>
                  <p className="tiny">
                    Хранится как контекст; не превращается в нагрузку мышцы или
                    расчётный 1ПМ.
                  </p>
                </details>
              ) : null}
              {before?.working && before.working.length > 0 && (
                <div className="exercise-autofill-bar">
                  <button
                    type="button"
                    className="autofill-pill-btn repeat"
                    title="Заполнить рабочие подходы весами и повторениями с прошлой тренировки"
                    onClick={() => {
                      const newSets = we.sets.map((s, idx) => {
                        if (s.warmup) return s;
                        const prevW = before.working[idx] || before.working[before.working.length - 1];
                        if (!prevW) return s;
                        return {
                          ...s,
                          weight: prevW.weight,
                          reps: prevW.reps,
                          ...(timed ? { durationSeconds: prevW.durationSeconds } : {}),
                          ...(assistance ? { assistanceKg: prevW.assistanceKg } : {}),
                        };
                      });
                      patchExercise(ei, { sets: newSets });
                    }}
                  >
                    <RotateCcw size={13} />
                    <span>Повторить прошлые: {before.working[0]?.weight} кг × {before.working[0]?.reps}</span>
                  </button>

                  {!noLoad && (
                    <button
                      type="button"
                      className="autofill-pill-btn progress"
                      title="Добавить +2.5 кг к рабочим подходам с прошлой тренировки (прогрессивная перегрузка)"
                      onClick={() => {
                        const newSets = we.sets.map((s, idx) => {
                          if (s.warmup) return s;
                          const prevW = before.working[idx] || before.working[before.working.length - 1];
                          if (!prevW) return s;
                          return {
                            ...s,
                            weight: Math.round((prevW.weight + 2.5) * 10) / 10,
                            reps: prevW.reps,
                          };
                        });
                        patchExercise(ei, { sets: newSets });
                      }}
                    >
                      <TrendingUp size={13} />
                      <span>+2.5 кг</span>
                    </button>
                  )}
                </div>
              )}
              <div className="sets-table set-table">
                <div className="sets-header">
                  <span>#</span>
                  <span>Прошлый</span>
                  <span>{heading}</span>
                  <span>
                    {timed
                      ? "Сек"
                      : spec.repsMode === "per_side"
                        ? "Повт / ст."
                        : "Повт"}
                  </span>
                  {timed ? (
                    <span>Км</span>
                  ) : (
                    <button
                      className="rir-help"
                      aria-expanded={rirHelp}
                      aria-label="RIR: что это"
                      onClick={() => setRirHelp((v) => !v)}
                    >
                      RIR
                    </button>
                  )}
                  <span className="sr-only">Готово</span>
                </div>
                {rirHelp && !timed && (
                  <div className="rir-explainer-popover" onClick={(e) => e.stopPropagation()}>
                    <div className="rir-popover-header">
                      <div className="rir-popover-title">
                        <Sparkles size={16} className="text-accent" />
                        <b>RIR (Reps in Reserve) — Запас повторений</b>
                      </div>
                      <button
                        type="button"
                        className="icon-button close-rir"
                        onClick={() => setRirHelp(false)}
                        aria-label="Закрыть"
                      >
                        <X size={15} />
                      </button>
                    </div>
                    <p className="rir-popover-desc">
                      Сколько чистых повторений с правильной техникой ты мог бы ещё выполнить до полного отказа.
                    </p>
                    <div className="rir-levels-grid">
                      <div className="rir-level-chip rir-0">
                        <b className="rir-code">0</b>
                        <span className="rir-meaning">Отказ (предел сил)</span>
                      </div>
                      <div className="rir-level-chip rir-1">
                        <b className="rir-code">1–2</b>
                        <span className="rir-meaning">Идеально для гипертрофии</span>
                      </div>
                      <div className="rir-level-chip rir-3">
                        <b className="rir-code">3</b>
                        <span className="rir-meaning">Умеренная нагрузка</span>
                      </div>
                      <div className="rir-level-chip rir-4">
                        <b className="rir-code">4+</b>
                        <span className="rir-meaning">Разминка / лёгкий запас</span>
                      </div>
                    </div>
                    <div className="rir-popover-footer">
                      <span className="tiny muted">
                        Не обязателен для записи. Фильтр «тяжёлых» рабочих подходов в прогрессе использует <b>RIR ≤ 3</b>.
                      </span>
                      <button
                        type="button"
                        className="button secondary rir-ok-btn"
                        onClick={() => setRirHelp(false)}
                      >
                        Понятно
                      </button>
                    </div>
                  </div>
                )}
                {we.sets.map((s, si) => {
                  const index = s.warmup ? warm++ : working++;
                  const last = s.warmup
                    ? before?.warmup[index]
                    : before?.working[index];
                  const lastText = previousLabel(we, last);
                  const isRowActive = activeSetKey === `${ei}-${si}`;
                  return (
                    <div key={s.id} className="set-row-wrapper">
                      <div
                        className={`set-row ${s.done ? "done" : ""} ${isRowActive ? "row-active" : ""}`}
                        onClick={() => setActiveSetKey(isRowActive ? null : `${ei}-${si}`)}
                      >
                        <button
                          type="button"
                          className={`set-kind ${s.kind || (s.warmup ? "warmup" : "normal")}`}
                          title="Тип подхода (обычный, разминка, дропсет, мио-повторы)"
                          aria-label={`Подход ${si + 1}: ${s.kind || (s.warmup ? "разминочный" : "рабочий")}. Нажми для переключения`}
                          onClick={(e) => {
                            e.stopPropagation();
                            changeSet(ei, si, cycleSetKind(s));
                          }}
                        >
                          {s.kind === "dropset"
                            ? "D"
                            : s.kind === "myorep"
                              ? "M"
                              : s.warmup
                                ? "Р"
                                : index + 1}
                        </button>
                        <button
                          type="button"
                          className="set-previous"
                          disabled={!last}
                          aria-label={
                            last
                              ? `Подставить прошлый результат: ${lastText}`
                              : "Прошлого результата нет"
                          }
                          onClick={(e) => {
                            e.stopPropagation();
                            last &&
                              changeSet(ei, si, {
                                weight: last.weight,
                                reps: last.reps,
                                ...(timed ? { durationSeconds: last.durationSeconds } : {}),
                                ...(assistance ? { assistanceKg: last.assistanceKg } : {}),
                              });
                          }}
                        >
                          {lastText}
                        </button>
                        {noLoad ? (
                          <span
                            className="no-load-value"
                            aria-label="Без внешнего веса"
                          >
                            —
                          </span>
                        ) : (
                          <NumberField
                            aria-label={`${entryName(we)}, подход ${si + 1}, ${assistance ? "помощь" : "вес"}`}
                            title={recordingLabel(we)}
                            blankZero
                            value={assistance ? (s.assistanceKg ?? 0) : s.weight}
                            placeholder={last ? `${last.weight}` : "0"}
                            onFocus={() => setActiveSetKey(`${ei}-${si}`)}
                            onClick={(e) => e.stopPropagation()}
                            onValue={(v) =>
                              changeSet(
                                ei,
                                si,
                                assistance
                                  ? { assistanceKg: Math.min(1000, v ?? 0), weight: 0 }
                                  : { weight: Math.min(1000, v ?? 0) },
                              )
                            }
                          />
                        )}
                        <NumberField
                          aria-label={`${entryName(we)}, подход ${si + 1}, ${timed ? "секунды" : "повторы"}${!timed && spec.repsMode === "per_side" ? " на сторону" : ""}`}
                          decimal={false}
                          blankZero
                          value={timed ? (s.durationSeconds ?? 30) : s.reps}
                          placeholder={last ? `${last.reps}` : timed ? "30" : "10"}
                          onFocus={() => setActiveSetKey(`${ei}-${si}`)}
                          onClick={(e) => e.stopPropagation()}
                          onValue={(v) => {
                            const n = Math.min(timed ? 86400 : 200, v ?? 0);
                            changeSet(
                              ei,
                              si,
                              timed ? { durationSeconds: n, reps: 1 } : { reps: n },
                            );
                          }}
                        />
                        <NumberField
                          aria-label={`${entryName(we)}, подход ${si + 1}, ${timed ? "дистанция, км" : "RIR"}`}
                          value={timed ? s.distanceKm : s.rir}
                          placeholder="—"
                          onFocus={() => setActiveSetKey(`${ei}-${si}`)}
                          onClick={(e) => e.stopPropagation()}
                          onValue={(v) =>
                            changeSet(
                              ei,
                              si,
                              timed
                                ? { distanceKm: v === null ? undefined : Math.min(1000, v) }
                                : { rir: v === null ? null : Math.min(10, v) },
                            )
                          }
                        />
                        <button
                          type="button"
                          className="set-check"
                          aria-label={`${s.done ? "Снять отметку" : "Отметить выполненным"}: ${entryName(we)}, подход ${si + 1}`}
                          aria-pressed={s.done}
                          onClick={(e) => {
                            e.stopPropagation();
                            changeSet(ei, si, { done: !s.done });
                          }}
                        >
                          <m.span
                            className="set-check-feedback"
                            aria-hidden="true"
                            initial={false}
                            variants={setCheckFeedback}
                            animate={s.done && !reducedMotion ? "complete" : "idle"}
                            transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
                          >
                            <Check size={22} strokeWidth={3} />
                          </m.span>
                        </button>
                      </div>
                      {isRowActive ? quickControls : null}
                    </div>
                  );
                })}
                {!quickSet ? quickControls : null}
              </div>
              <div className="set-actions">
                <button
                  className="add-set"
                  disabled={we.sets.length >= 30}
                  onClick={() => {
                    const last = we.sets.at(-1)!;
                    const next = makeSets(1, last.weight, last.reps).map(
                      (s) => ({
                        ...s,
                        ...(timed
                          ? {
                              reps: 1,
                              rir: null,
                              durationSeconds: last.durationSeconds ?? 30,
                            }
                          : {}),
                        ...(assistance
                          ? { assistanceKg: last.assistanceKg ?? 0 }
                          : {}),
                      }),
                    );
                    patchExercise(ei, { sets: [...we.sets, ...next] });
                  }}
                >
                  <Plus size={16} />
                  Подход
                </button>
                <button
                  className="add-set remove-last"
                  disabled={we.sets.length <= 1}
                  aria-label="Убрать последний подход"
                  onClick={() => patchExercise(ei, { sets: we.sets.slice(0, -1) })}
                >
                  <Minus size={16} />
                </button>
              </div>
              {!we.sets.some((s) => s.warmup) &&
              new WarmupPlanner(we).create().length > 0 ? (
                <div className="warmup-scaffold">
                  <button
                    className="text-button"
                    onClick={() =>
                      patchExercise(ei, {
                        sets: [...new WarmupPlanner(we).create(), ...we.sets],
                      })
                    }
                  >
                    <Plus size={15} />
                    Добавить 3 разминочных
                  </button>
                  <p className="tiny">40 / 60 / 80% рабочего веса — проверь и поправь.</p>
                </div>
              ) : null}
            </article>
            {we.supersetId && w.exercises[ei + 1]?.supersetId === we.supersetId && (
              <div className="superset-connector-strip">
                <div className="connector-line" />
                <span className="connector-tag">
                  <Zap size={12} className="text-accent" />
                  Без отдыха переходи к следующему упражнению
                </span>
                <div className="connector-line" />
              </div>
            )}
          </Fragment>
        );
        })}
        <button
          className="button secondary full-width"
          disabled={w.exercises.length >= 30}
          onClick={onPick}
        >
          <Plus size={18} />
          Добавить упражнение
        </button>
        <details className="workout-details panel" open={draft.editing}>
          <summary>Детали тренировки</summary>
          <label>
            Дата
            <input
              type="date"
              max={localDate(new Date(), w.timeZone ?? settings.timeZone)}
              value={w.date}
              onChange={(e) => setWorkout({ ...w, date: e.target.value })}
            />
          </label>
          <div className="duration-controls">
            <label>
              Длительность, минуты
              <NumberField
                aria-label="Длительность тренировки, минуты"
                disabled={saving}
                decimal={false}
                value={elapsed}
                onValue={(v) =>
                  update({
                    ...checkpointDraft(draft, Date.now(), true),
                    manualDuration: true,
                    workout: { ...w, duration: Math.min(1440, v ?? 0) },
                  })
                }
              />
            </label>
            {!draft.editing ? (
              <button
                className="icon-button"
                disabled={saving}
                aria-label={
                  draft.clock.runningSince === null
                    ? "Продолжить счётчик тренировки"
                    : "Приостановить счётчик тренировки"
                }
                onClick={() =>
                  update(
                    draft.clock.runningSince === null
                      ? {
                          ...draft,
                          manualDuration: false,
                          restored: false,
                          clock: {
                            elapsedMs: draft.manualDuration
                              ? w.duration * 60000
                              : draft.clock.elapsedMs,
                            runningSince: Date.now(),
                          },
                        }
                      : checkpointDraft(draft, Date.now(), true),
                  )
                }
              >
                {draft.clock.runningSince === null ? (
                  <Play size={18} />
                ) : (
                  <Pause size={18} />
                )}
              </button>
            ) : null}
          </div>
          {draft.restored ? (
            <p className="tiny">
              Черновик восстановлен, счётчик на паузе — продолжи его кнопкой выше.
            </p>
          ) : null}
          <label className="notes-label">
            Заметки
            <textarea
              rows={3}
              placeholder="Как самочувствие? Что стоит помнить в следующий раз?"
              value={w.notes}
              maxLength={2000}
              onChange={(e) => setWorkout({ ...w, notes: e.target.value })}
            />
          </label>
          <div className="session-summary-stats">
            <span>
              Упражнения<b>{w.exercises.length}</b>
            </span>
            <span>
              Рабочие подходы<b>{doneWorking}</b>
            </span>
            <span>
              Рабочий тоннаж<b>{fmt(summary.total)} кг</b>
            </span>
            <span>
              Разминка<b>{warmupCount} подх. · {fmt(warmupSummary.total)} кг</b>
            </span>
          </div>
          {summary.omittedSets ? (
            <p className="tiny">
              {summary.omittedSets} подх. с массой тела, тренажёрами или
              неизвестным правилом веса не входят во внешний объём.
            </p>
          ) : null}
          <p className="tiny draft-note">
            {persistence === "saved"
              ? "Черновик сохранён на этом устройстве."
              : persistence === "pending"
                ? "Сохраняем черновик…"
                : "Локальное сохранение недоступно."}
          </p>
          <button
            className="text-button danger-text discard"
            disabled={saving}
            onClick={onDiscard}
          >
            {draft.editing ? "Отменить изменения" : "Отменить тренировку"}
          </button>
        </details>
      </fieldset>
      {resting ? (
        <section className="rest-bar" aria-label="Таймер отдыха">
          <div className="rest-progress">
            <span
              style={{
                transform: `scaleX(${Math.min(1, remaining / Math.max(restSeconds, remaining, 1))})`,
              }}
            />
          </div>
          <div className="rest-body">
            <div className="rest-copy">
              <span>{draft.pausedRest !== null ? "Отдых на паузе" : "Отдых"}</span>
              <span className="rest-digits active" aria-live="off">
                {clock(remaining)}
              </span>
            </div>
            <button aria-label="Минус 15 секунд" onClick={() => shiftRest(-15)}>
              −15
            </button>
            <button
              className="timer-plus"
              aria-label="Плюс 15 секунд"
              onClick={() => shiftRest(15)}
            >
              +15
            </button>
            <button
              className="icon-button"
              aria-label={
                draft.pausedRest !== null
                  ? "Продолжить таймер"
                  : "Приостановить таймер"
              }
              onClick={() =>
                update(
                  draft.pausedRest !== null
                    ? {
                        ...draft,
                        restUntil: Date.now() + draft.pausedRest * 1000,
                        pausedRest: null,
                      }
                    : { ...draft, pausedRest: remaining, restUntil: null },
                )
              }
            >
              {draft.pausedRest !== null ? <Play size={20} /> : <Pause size={20} />}
            </button>
            <button
              className="icon-button"
              aria-label="Пропустить отдых"
              onClick={() =>
                update({ ...draft, restUntil: null, pausedRest: null })
              }
            >
              <X size={20} />
            </button>
          </div>
        </section>
      ) : null}
      <span className="sr-only" role="status" aria-live="polite">
        {announcement}
      </span>

      {plateCalcTarget && (
        <Modal title="Калькулятор блинов" onClose={() => setPlateCalcTarget(null)} wide>
          <PlateCalculator
            initialWeight={plateCalcTarget.weight}
            onClose={() => setPlateCalcTarget(null)}
            onApplyWeight={(appliedWeight) => {
              const targetEi = plateCalcTarget.ei;
              setWorkout({
                ...w,
                exercises: w.exercises.map((e, i) =>
                  i === targetEi
                    ? {
                        ...e,
                        sets: e.sets.map((s) => (!s.done ? { ...s, weight: appliedWeight } : s)),
                      }
                    : e,
                ),
              });
            }}
          />
        </Modal>
      )}

      {oneRepMaxTarget && (
        <Modal title="Калькулятор 1ПМ" onClose={() => setOneRepMaxTarget(null)} wide>
          <OneRepMaxCalculator
            initialWeight={oneRepMaxTarget.weight}
            initialReps={oneRepMaxTarget.reps}
            onClose={() => setOneRepMaxTarget(null)}
          />
        </Modal>
      )}

      {toolModal === "warmup" ? (
        <Modal title="Разминочная лесенка" onClose={() => setToolModal(null)} wide>
          <WarmupModal
            defaultWeight={toolDefaults.weight}
            defaultReps={toolDefaults.reps}
            onClose={() => setToolModal(null)}
          />
        </Modal>
      ) : null}
      {toolModal === "orm" ? (
        <Modal title="Калькулятор 1ПМ" onClose={() => setToolModal(null)} wide>
          <OneRepMaxCalculator
            initialWeight={toolDefaults.weight}
            initialReps={toolDefaults.reps}
            onClose={() => setToolModal(null)}
          />
        </Modal>
      ) : null}

      {swapTarget && (
        <ExerciseSwapModal
          currentExercise={swapTarget.exercise}
          onClose={() => setSwapTarget(null)}
          onSwap={(newEx) => {
            const targetEi = swapTarget.ei;
            setWorkout({
              ...w,
              exercises: w.exercises.map((e, i) =>
                i === targetEi
                  ? {
                      ...e,
                      exerciseId: newEx.id,
                      displayNameSnapshot: newEx.name,
                      catalogRevision: newEx.catalogRevision,
                      recordingSpecRevision: newEx.catalogRevision,
                      muscleMappingRevision: newEx.catalogRevision,
                      ...(newEx.source || newEx.custom ? { externalDefinition: newEx } : {}),
                    }
                  : e,
              ),
            });
            setSwapTarget(null);
          }}
        />
      )}

      {showCancelConfirm && (
        <Modal title="Завершить без сохранения?" onClose={() => setShowCancelConfirm(false)}>
          <div className="cancel-workout-dialog">
            <div className="cancel-warning-badge">
              <Trash2 size={28} className="text-danger" />
            </div>
            <h3 className="cancel-dialog-title">Отменить тренировку?</h3>
            <p className="cancel-dialog-text">
              Черновик тренировки будет закрыт и удалён с устройства без сохранения в историю.
            </p>
            <div className="cancel-dialog-buttons">
              <button
                type="button"
                className="button danger-btn full-width"
                onClick={() => {
                  setShowCancelConfirm(false);
                  onDiscard();
                }}
              >
                Да, отменить без сохранения
              </button>
              <button
                type="button"
                className="button secondary full-width"
                onClick={() => setShowCancelConfirm(false)}
              >
                Продолжить тренировку
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
