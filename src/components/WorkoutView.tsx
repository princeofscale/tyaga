import { MuscleParticipation } from "../domain/MuscleParticipation";
import { ExecutionIdentity } from "../domain/ExecutionIdentity";
import { PreviousSets } from "../domain/PreviousSets";
import { DeloadEngine, type DeloadMode } from "../domain/DeloadEngine";
import { SetCompleteness, type MissingField } from "../domain/SetCompleteness";
import { WorkoutUndo } from "../domain/WorkoutUndo";
import { WorkoutFlow, type WorkoutSetPosition } from "../domain/WorkoutFlow";
import { SetPropagation, type SetFollowers } from "../domain/SetPropagation";
import { WorkoutDiscard } from "../domain/WorkoutDiscard";
import { selectOnFocus, trimLeadingZeros } from "../lib/numberField";
import { ExerciseLibrary, PlateCalculator } from "./chunks";
import { Fragment, Suspense, memo, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, m, useReducedMotion } from "motion/react";
import {
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
  Calendar,
  Clock,
  Volume2,
  VolumeX,
  Flame,
  RotateCcw,
  TrendingUp,
  Zap,
  ArrowLeftRight,
  CheckCircle2,
} from "lucide-react";
import { PlateApplication } from "../domain/PlateApplication";
import { LaidDupPlan } from "../domain/LaidDupPlan";
import ExerciseSwapModal from "./ExerciseSwapModal";
import LiveStrip from "./LiveStrip";
import RoomBadge from "./RoomBadge";
import { useLiveRoom } from "../lib/liveRoomContext";
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
  type Workout,
  type SetEntry,
  type Settings,
  type WorkoutExercise,
} from "../lib/model";
import {
  checkpointDraft,
  elapsedMs,
  type Draft,
  type PersistenceStatus,
} from "../lib/draft";
export type { Draft } from "../lib/draft";
import { WarmupPlanner } from "../domain/WarmupPlanner";
import { BackdatedWorkout } from "../domain/BackdatedWorkout";
import { DeloadHint } from "../domain/DeloadHint";
import { ExerciseSwap } from "../domain/ExerciseSwap";
import { setsWord } from "../lib/quantity";
import type { DeloadPlanRecord } from "../domain/DeloadPlan";
import WorkoutGym from "./WorkoutGym";

type Props = {
  focusRequest?: {exerciseId:string;setId:string;id:string}|null;
  notificationError?:string;
  draft: Draft | null;
  update: (draft: Draft) => void;
  settings: Settings;
  history: Workout[];
  readOnly?: boolean;
  saving: boolean;
  error: string;
  persistence: PersistenceStatus;
  onPick: () => void;
  onSave: () => void;
  onDiscard: () => void;
  onExport: () => void;
  onMinimize: () => void;
  /** Открыть комнату «Вместе» (полоса напарников над подходами ведёт туда). */
  onOpenTogether: () => void;
  /** Короткое уведомление (комната, поделиться). */
  onToast?: (text: string) => void;
  /** Режим действующей разгрузки (R06-REQ02): быстрые кнопки «прошлое» не возвращают вес выше разгрузочного. */
  deloadMode?: DeloadMode;
  /** Действующая разгрузка: строка и «Подставить 85 %» на свободной тренировке (R07-REQ05). */
  deloadPlan?: DeloadPlanRecord | null;
};
const GYM_MODE_KEY = "tyaga_workout_view_mode";
const gymSelectionKey = (workoutId: string) => `${GYM_MODE_KEY}:set:${workoutId}`;
const savedGymMode = () => {
  try { return localStorage.getItem(GYM_MODE_KEY) === "gym"; }
  catch { return false; }
};
const clock = (seconds: number) => {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  if (h > 0) {
    return `${h}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
};
const setCheckFeedback = {
  idle: { pathLength: 1 },
  complete: { pathLength: [0, 1] },
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
/** Узкая ячейка переносит «100 × 8» на две строки перед «×», а не обрезает многоточием. */
const wrapSafe = (label: string) => label.replace(" × ", " ×\u00a0");

const WorkoutAutoDuration = memo(function WorkoutAutoDuration({
  draft,
  manualClock,
  retro,
  estimatedMinutes,
}: {
  draft: Draft;
  manualClock: boolean;
  retro: boolean;
  estimatedMinutes: number;
}) {
  const running = !manualClock && !retro && draft.clock.runningSince !== null;
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!running) return;
    const sync = () => setNow(Date.now());
    const id = setInterval(sync, 1000);
    const onVis = () => {
      if (document.visibilityState === "visible") sync();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [running]);

  const elapsedSec = Math.floor(elapsedMs(draft, now) / 1000);
  const autoMin = Math.max(0, Math.round(elapsedSec / 60));
  const isHistoricalEdit = draft.editing;
  const displayMin = isHistoricalEdit
    ? draft.workout.duration
    : retro || manualClock
      ? estimatedMinutes
      : autoMin;
  const detail = isHistoricalEdit
    ? "Из сохранённой записи"
    : retro || manualClock
      ? "Расчёт по подходам"
      : draft.clock.runningSince === null
        ? `На паузе · ${clock(elapsedSec)}`
        : `Идёт таймер · ${clock(elapsedSec)}`;

  return (
    <div className="workout-auto-duration" role="status" aria-live="off">
      <div className="workout-auto-duration-head">
        <span className="workout-auto-duration-label">
          <Clock size={14} aria-hidden="true" />
          Длительность
        </span>
        <span className="workout-auto-pill">Авто</span>
      </div>
      <div className="workout-auto-duration-val">
        <strong>{displayMin}</strong>
        <span>мин</span>
        <small>{detail}</small>
      </div>
    </div>
  );
});

/** Изолированный живой таймер тренировки в шапке — тикает сам, не перерисовывая список упражнений. */
const WorkoutLiveClock = memo(function WorkoutLiveClock({
  draft,
  manualClock,
  saving,
  onTogglePause,
}: {
  draft: Draft;
  manualClock: boolean;
  saving: boolean;
  onTogglePause: () => void;
}) {
  const running = !manualClock && draft.clock.runningSince !== null;
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!running) return;
    const sync = () => setNow(Date.now());
    const id = setInterval(sync, 1000);
    const onVis = () => {
      if (document.visibilityState === "visible") sync();
    };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", sync);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", sync);
    };
  }, [running]);

  const valueText = manualClock
    ? `${draft.workout.duration} мин`
    : clock(Math.floor(elapsedMs(draft, now) / 1000));
  const labelText = manualClock
    ? "Длительность"
    : draft.clock.runningSince === null
      ? "Счётчик · пауза"
      : "Счётчик";

  const content = (
    <>
      <b>
        <span
          aria-hidden="true"
          className={`live-rec-dot ${running ? "recording" : "paused"}`}
        />
        {valueText}
        {!draft.editing && !manualClock ? (
          <span className="clock-action-icon" aria-hidden="true">
            {running ? <Pause size={12} /> : <Play size={12} />}
          </span>
        ) : null}
      </b>
      <span className="hud-label">{labelText}</span>
    </>
  );

  if (draft.editing || manualClock) {
    return <span className="live-clock-badge">{content}</span>;
  }

  return (
    <button
      type="button"
      className="live-clock-badge is-interactive"
      disabled={saving}
      aria-label={
        running
          ? "Пауза таймера тренировки"
          : "Возобновить таймер тренировки"
      }
      title={running ? "Нажми, чтобы поставить на паузу" : "Нажми, чтобы продолжить таймер"}
      onClick={onTogglePause}
    >
      {content}
    </button>
  );
});

/** Изолированный таймер отдыха внизу экрана — тикает только пока идёт отдых. */
const WorkoutRestBar = memo(function WorkoutRestBar({
  draft,
  restSeconds,
  soundEnabled,
  reducedMotion,
  onShift,
  onTogglePause,
  onSkip,
  onAnnounce,
}: {
  draft: Draft;
  restSeconds: number;
  soundEnabled: boolean;
  reducedMotion: boolean | null;
  onShift: (seconds: number) => void;
  onTogglePause: (remaining: number) => void;
  onSkip: () => void;
  onAnnounce: (text: string) => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  const announcedTimer = useRef<number | null>(null);
  const lastTickSecond = useRef<number | null>(null);
  const activeCountdown = draft.pausedRest === null && draft.restUntil !== null;

  useEffect(() => {
    if (!activeCountdown) return;
    const sync = () => setNow(Date.now());
    sync();
    const id = setInterval(sync, 500);
    const onVis = () => {
      if (document.visibilityState === "visible") sync();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [activeCountdown, draft.restUntil]);

  const remaining =
    draft.pausedRest ??
    (draft.restUntil
      ? Math.max(0, Math.ceil((draft.restUntil - now) / 1000))
      : 0);

  useEffect(() => {
    if (
      draft.restUntil &&
      draft.pausedRest === null &&
      draft.restUntil <= now &&
      announcedTimer.current !== draft.restUntil
    ) {
      announcedTimer.current = draft.restUntil;
      onAnnounce("Отдых завершён");
      if (soundEnabled) audioHaptics.playTimerAlert();
    } else if (remaining > 0) {
      onAnnounce("");
      if (remaining <= 3 && soundEnabled && lastTickSecond.current !== remaining) {
        lastTickSecond.current = remaining;
        audioHaptics.playCountdownTick();
      }
    }
  }, [draft.restUntil, draft.pausedRest, now, remaining, soundEnabled, onAnnounce]);

  if (!(remaining > 0 || draft.pausedRest !== null)) return null;

  return (
    <m.section
      className="rest-bar"
      aria-label="Таймер отдыха"
      data-paused={draft.pausedRest !== null}
      initial={reducedMotion ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: reducedMotion ? 0 : 0.16, ease: "easeOut" }}
    >
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
        <button type="button" aria-label="Минус 15 секунд" onClick={() => onShift(-15)}>
          −15
        </button>
        <button
          type="button"
          className="timer-plus"
          aria-label="Плюс 15 секунд"
          onClick={() => onShift(15)}
        >
          +15
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label={
            draft.pausedRest !== null
              ? "Продолжить таймер"
              : "Приостановить таймер"
          }
          onClick={() => onTogglePause(remaining)}
        >
          {draft.pausedRest !== null ? <Play size={20} /> : <Pause size={20} />}
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label="Пропустить отдых"
          onClick={onSkip}
        >
          <X size={20} />
        </button>
      </div>
    </m.section>
  );
});

export default function WorkoutView({
  focusRequest, notificationError, readOnly = false,
  draft,
  update,
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
  onOpenTogether,
  onToast,
  deloadMode,
  deloadPlan,
}: Props) {
  const [undoError,setUndoError] = useState("");
  const reducedMotion = useReducedMotion();
  const [announcement, setAnnouncement] = useState("");
  const [rirHelp, setRirHelp] = useState(false);
  const [entryPanel, setEntryPanel] = useState(false);
  const [needs, setNeeds] = useState<{ setId: string; field: MissingField } | null>(null);
  const [plateCalcTarget, setPlateCalcTarget] = useState<{ weight: number; ei: number } | null>(null);
  const [swapTarget, setSwapTarget] = useState<{ ei: number; exercise: Exercise } | null>(null);
  const [activeSetKey, setActiveSetKey] = useState<string | null>(null);
  const workoutId = draft?.workout.id;
  const [preferGym, setPreferGym] = useState(savedGymMode);
  const [gymSelection, setGymSelection] = useState<{ workoutId: string; setId: string | null } | null>(null);
  // View state belongs to this tab, not to the shared workout draft.
  const restoredGymSet = useMemo(() => {
    if (!workoutId) return null;
    try { return sessionStorage.getItem(gymSelectionKey(workoutId)); }
    catch { return null; }
  }, [workoutId]);
  const gymSetId = gymSelection && gymSelection.workoutId === workoutId ? gymSelection.setId : restoredGymSet;
  const selectGymSet = useCallback((setId: string | null) => {
    if (!workoutId) return;
    setGymSelection({ workoutId, setId });
    try {
      if (setId) sessionStorage.setItem(gymSelectionKey(workoutId), setId);
      else sessionStorage.removeItem(gymSelectionKey(workoutId));
    } catch { /* The in-memory choice still works if storage is blocked. */ }
  }, [workoutId]);
  const gymMode = preferGym && !draft?.editing;
  const gymToggleRef = useRef<HTMLButtonElement>(null);
  const focusGymToggle = useRef(false);
  const consumedFocus = useRef<string | null>(null);
  const lastGymMark = useRef<HTMLButtonElement | null>(null);
  const hintPrefix = useId();
  const entryPanelId = hintPrefix + "-entry";
  useLayoutEffect(() => {
    if (!focusGymToggle.current) return;
    focusGymToggle.current = false;
    gymToggleRef.current?.focus({ preventScroll: true });
  }, [gymMode]);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  useEffect(() => {
    if (!readOnly) return;
    setPlateCalcTarget(null);
    setSwapTarget(null);
    setShowCancelConfirm(false);
  }, [readOnly]);
  // R09-REQ01: правка сохранённой тренировки — не тренировка в комнате: ни шапки комнаты, ни строк напарников.
  const { room: liveRoom } = useLiveRoom();
  const room = draft?.editing ? null : liveRoom;
  const nameBox = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const box = nameBox.current;
    if (!box) return;
    const fit = () => {
      box.style.height = "auto";
      box.style.height = `${box.scrollHeight + (box.offsetHeight - box.clientHeight)}px`;
    };
    fit();
    // Раскладка может устояться после первого замера (поворот, шрифт): меряем ещё раз в следующем кадре.
    const frame = requestAnimationFrame(fit);
    // Поворот экрана и смена ширины меняют число строк — высоту пересчитываем.
    window.addEventListener("resize", fit);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", fit);
    };
  }, [room, draft?.workout.name]);
  const screenRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLElement>(null);
  const pinRef = useRef<HTMLDivElement>(null);
  const dockRef = useRef<HTMLDivElement>(null);
  // Кто пойдёт за правкой поля: определяется один раз, когда поле получило фокус, а не после каждой цифры.
  const followersRef = useRef<SetFollowers | null>(null);
  // Каталог упражнений — отдельный файл. Докачиваем его, пока связь есть: «Добавить упражнение» в подвале без сети должно открыться.
  useEffect(() => {
    ExerciseLibrary.preload();
  }, []);
  const [soundEnabled, setSoundEnabled] = useState(() => !audioHaptics.isMuted());

  useEffect(() => {
    audioHaptics.setMuted(!soundEnabled);
  }, [soundEnabled]);

  // Причина отказа при сохранении лежит над подходами. Человек в этот момент внизу страницы, поэтому показываем её сами.
  // Зависимость от saving перезапускает эффект на каждую попытку, даже если текст ошибки не изменился.
  const errorRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (!error || saving) return;
    errorRef.current?.scrollIntoView({ block: "center", behavior: reducedMotion ? "auto" : "smooth" });
  }, [error, saving, reducedMotion]);

  useEffect(() => {
    if (!focusRequest || consumedFocus.current === focusRequest.id) return;
    if (readOnly || !workoutId) {
      consumedFocus.current = focusRequest.id;
      return;
    }
    if (gymMode) {
      consumedFocus.current = focusRequest.id;
      selectGymSet(focusRequest.setId);
      return;
    }
    // Only an explicit rest-notification action focuses an input in the full list.
    const timer = window.setTimeout(() => {
      consumedFocus.current = focusRequest.id;
      const row = screenRef.current?.querySelector<HTMLElement>(
        `.set-row[data-exercise-id="${CSS.escape(focusRequest.exerciseId)}"][data-set-id="${CSS.escape(focusRequest.setId)}"]`,
      );
      row?.querySelector<HTMLInputElement>('input[type="number"]')?.focus();
      row?.scrollIntoView({ block: "center", behavior: "instant" });
    }, 100);
    return () => window.clearTimeout(timer);
  }, [focusRequest, gymMode, readOnly, selectGymSet, workoutId]);
  const restSeconds = draft?.workout.restSeconds ?? settings.restSeconds;
  const exercises = draft?.workout.exercises;
  const flow = useMemo(() => new WorkoutFlow(exercises ?? []), [exercises]);
  const previous = useMemo(
    () =>
      new Map(
        (exercises ?? []).flatMap((e)=>[e,...ExecutionIdentity.split(e)]).map((e) => {
          const find = (pool: Workout[]) => lastEntry(pool, e, workoutId, draft?.workout.date, {timeZone:settings.timeZone});
          // QA-R06-13: в обычной тренировке «прошлое» — последняя НЕразгрузочная запись; только разгрузочные — берём их.
          const last = DeloadEngine.isDeloadName(draft?.workout.name ?? "") ? find(history) : (find(DeloadEngine.regular(history)) ?? find(history));
          const sets = last?.sets.filter((s) => s.done) ?? [];
          return [
            ExecutionIdentity.key(e),
            {
              working: sets.filter((s) => !s.warmup),
              warmup: sets.filter((s) => s.warmup),
            },
          ];
        }),
      ),
    [history, exercises, workoutId, draft?.workout.date, draft?.workout.name, settings.timeZone],
  );
  // QA-R06-02: в разгрузочной тренировке «прошлое» масштабируется от последнего НЕразгрузочного результата упражнения:
  // иначе вторая разгрузочная тренировка недели берёт уже сниженный вес и снижает его второй раз (95 → 80 → 67,5).
  const inDeload = !!draft && DeloadEngine.isDeloadName(draft.workout.name);
  const deloadBase = useMemo(() => {
    if (!inDeload) return new Map<string, { working: SetEntry[]; warmup: SetEntry[] }>();
    const regular = DeloadEngine.regular(history);
    return new Map(
      (exercises ?? []).flatMap((e) => [e, ...ExecutionIdentity.split(e)]).map((e) => {
        const sets = lastEntry(regular, e, workoutId, draft?.workout.date, { timeZone: settings.timeZone })?.sets.filter((x) => x.done) ?? [];
        return [ExecutionIdentity.key(e), { working: sets.filter((x) => !x.warmup), warmup: sets.filter((x) => x.warmup) }] as const;
      }),
    );
  }, [inDeload, history, exercises, workoutId, draft?.workout.date, settings.timeZone]);
  const hasDraft = !!draft;
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const updateRef = useRef(update);
  updateRef.current = update;
  const [toastPaused, setToastPaused] = useState(false);
  const removalCount = draft?.removals?.length ?? 0;
  const latestRemoval = draft?.removals?.at(-1);
  const removalKey = latestRemoval
    ? `${removalCount}:${latestRemoval.kind}:${latestRemoval.kind === "set" ? latestRemoval.set.id : latestRemoval.exercise.exerciseId}`
    : "";

  useEffect(() => {
    if (!removalCount || toastPaused) return;
    const id = setTimeout(() => {
      const current = draftRef.current;
      if (current?.removals?.length) {
        updateRef.current({ ...current, removals: [] });
      }
    }, 3000);
    return () => clearTimeout(id);
  }, [removalCount, removalKey, toastPaused]);

  useLayoutEffect(() => {
    const screen = screenRef.current;
    const bar = barRef.current;
    const pin = pinRef.current;
    const dock = dockRef.current;
    if (!screen || !bar || !pin || !dock) return;

    const measure = () => {
      bar.style.setProperty("--bar-collapse", `${pin.offsetTop}px`);
      screen.style.setProperty("--workout-header-space", `${pin.offsetHeight + 12}px`);
      screen.style.setProperty("--workout-dock-space", `${dock.offsetHeight + 12}px`);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(bar);
    observer.observe(pin);
    observer.observe(dock);
    return () => observer.disconnect();
  }, [hasDraft]);
  if (!draft)
    return (
      <div className="empty-state">
        <div className="empty-icon">
          <Play size={30} />
        </div>
        <h2>Нет активной тренировки</h2>
        <button className="button primary" onClick={onPick}>
          <Plus size={18} />
          Начать тренировку
        </button>
      </div>
    );
  const w = draft.workout;
  // R06-REQ02: в разгрузочной тренировке «прошлые» числа подставляются с разгрузочным весом, а не с полным.
  const deloadNow: DeloadMode | undefined = DeloadEngine.isDeloadName(w.name) ? (deloadMode ?? "volume") : undefined;
  // `set` — когда «прошлое» искали по ключу подхода (контекст выполнения на уровне подхода): база ищется по тому же ключу (QA-R06-12).
  const deloaded = (entry: WorkoutExercise, previous: SetEntry | undefined, index: number, warmup = false, set?: SetEntry): SetEntry | undefined => {
    if (!previous || !deloadNow) return previous;
    const base = deloadBase.get(ExecutionIdentity.key(entry, set));
    const source = PreviousSets.pick(warmup ? (base?.warmup ?? []) : (base?.working ?? []), index);
    // Нет неразгрузочной базы: «прошлое» уже из разгрузки — второй раз вес не снижаем.
    if (!source) return previous;
    return { ...source, weight: DeloadEngine.scaleLoad(source.weight, exerciseForEntry(entry)?.recording.loadMode, deloadNow) };
  };
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

  /** `propagate` — правка вес/повторы/RIR (набор, шаги, быстрый RIR, «прошлый результат»): ещё не тронутые строки ниже берут то же число. Кого считать нетронутым, решает снимок на начало правки (`followersRef`), см. SetPropagation. */
  const changeSet = (ei: number, si: number, patch: Partial<SetEntry>, propagate = false) => {
    if (patch.done && soundEnabled) {
      audioHaptics.playSetDone();
    }

    const targetEx = w.exercises[ei];
    const next = patch.done ? flow.after(targetEx.sets[si].id)?.position : undefined;
    const isSupersetTransition =
      patch.done &&
      targetEx?.supersetId &&
      w.exercises[ei + 1]?.supersetId === targetEx.supersetId;
    const effectiveRest = isSupersetTransition ? 15 : restSeconds;

    const shouldAutoResume =
      !draft.editing &&
      !draft.manualDuration &&
      draft.restored === true &&
      draft.clock.runningSince === null;

    update({
      ...draft,
      ...(shouldAutoResume
        ? {
            restored: false,
            clock: { ...draft.clock, runningSince: Date.now() },
          }
        : {}),
      workout: {
        ...w,
        exercises: w.exercises.map((e, i) =>
          i === ei
            ? {
                ...e,
                sets: propagate
                  ? SetPropagation.apply(e.sets, si, patch, followersRef.current)
                  : e.sets.map((s, j) => (j === si ? { ...s, ...patch } : s)),
              }
            : e,
        ),
      },
      ...(patch.done
        ? {
            restFocus: next ? { exerciseId: next.entry.exerciseId, setId: next.set.id } : undefined,
            restUntil: Date.now() + effectiveRest * 1000,
            pausedRest: null,
          }
        : {}),
    });
    return next;
  };

  const addSet = (ei: number, warmup: boolean) => {
    const entry = w.exercises[ei];
    if (entry.sets.length >= 30) return;
    const spec = exerciseForEntry(entry)!.recording;
    const last = entry.sets.filter((set) => set.warmup === warmup).at(-1);
    const timed = spec.type === "duration";
    const next: SetEntry = {
      ...makeSets(1, last?.weight ?? 0, timed ? 1 : last?.reps ?? 0, last?.rir ?? null)[0],
      warmup,
      ...(warmup ? { kind: "warmup" } : {}),
      ...(timed ? { rir: null, durationSeconds: last?.durationSeconds ?? 30 } : {}),
      ...(spec.loadMode === "assisted_bodyweight" ? { assistanceKg: last?.assistanceKg ?? 0 } : {}),
    };
    const sets = [...entry.sets];
    const firstWorking = warmup ? sets.findIndex((set) => !set.warmup) : -1;
    sets.splice(firstWorking < 0 ? sets.length : firstWorking, 0, next);
    patchExercise(ei, { sets });
    if (gymMode) selectGymSet(next.id);
  };

  const removeGymSet = ({ exerciseIndex, setIndex }: WorkoutSetPosition) => {
    const next = WorkoutUndo.set(draft, exerciseIndex, setIndex);
    if (next === draft) return;
    const sets = next.workout.exercises[exerciseIndex].sets;
    update(next);
    selectGymSet(sets[Math.min(setIndex, sets.length - 1)].id);
  };

  const removeGymExercise = (exerciseIndex: number) => {
    const next = WorkoutUndo.exercise(draft, exerciseIndex);
    if (next === draft) return;
    const remaining = next.workout.exercises;
    const nextEntry = remaining[Math.min(exerciseIndex, remaining.length - 1)];
    update(next);
    selectGymSet(nextEntry?.sets[0]?.id ?? null);
  };

  const bumpWeight = (ei: number, si: number, delta: number) => {
    const s = w.exercises[ei].sets[si];
    const spec = exerciseForEntry(w.exercises[ei])!.recording;
    if (spec.loadMode === "assisted_bodyweight") {
      const cur = s.assistanceKg ?? 0;
      const next = Math.max(0, Math.round((cur + delta) * 10) / 10);
      changeSet(ei, si, { assistanceKg: next }, true);
    } else {
      const cur = s.weight;
      const next = Math.max(0, Math.round((cur + delta) * 10) / 10);
      changeSet(ei, si, { weight: next }, true);
    }
  };

  // R07-REQ04: у записи задним числом длительность задана, а не считается от «сейчас».
  const zone = w.timeZone ?? settings.timeZone;
  const retroLabel = draft.editing ? null : BackdatedWorkout.label(draft, settings.timeZone);
  const deloadLine =
    !draft.editing && !DeloadEngine.isDeloadName(w.name) ? DeloadHint.line(deloadPlan, localDate(new Date(), zone)) : null;
  const applyDeload = () => {
    if (!deloadPlan) return;
    const regular = DeloadEngine.regular(history);
    const result = DeloadHint.apply(
      w,
      deloadPlan.mode,
      (entry) => lastEntry(regular, entry, workoutId, w.date, { timeZone: settings.timeZone })?.sets.filter((s) => s.done && !s.warmup),
    );
    if (result.changed) setWorkout(result.workout);
    const skipped = result.skipped ? ` Тренажёры и вес тела пропущены: ${result.skipped} упр.` : "";
    onToast?.(
      result.changed
        ? `Подставлено ${DeloadHint.percent(deloadPlan.mode)} % от последней обычной тренировки: ${result.exercises} упр.${skipped}`
        : `Подставлять нечего: веса уже разгрузочные или нет прошлой обычной тренировки с этими упражнениями.${skipped}`,
    );
  };
  const manualClock = BackdatedWorkout.manualDuration(draft, settings.timeZone);
  const toggleSessionClock = () =>
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
    );
  // Дату позже сегодняшней не принимаем (max у поля это и обещает, но вручную вводится любая).
  const dateField = (panel = false) => (
    <label>
      Дата
      <input
        type="date"
        disabled={saving}
        aria-label={panel ? "Дата записи" : undefined}
        max={localDate(new Date(), zone)}
        value={w.date}
        onChange={(e) => {
          if (e.target.value > localDate(new Date(), zone)) return;
          setWorkout({ ...w, date: e.target.value });
        }}
      />
    </label>
  );
  const estimatedMinutes = (() => {
    const sets = w.exercises.flatMap((e) => e.sets);
    const done = sets.filter((s) => s.done);
    const sample = done.length > 0 ? done : sets;
    const work = sample.filter((s) => !s.warmup).length;
    const warm = sample.filter((s) => s.warmup).length;
    return Math.max(10, Math.round(work * 3 + warm * 1.5));
  })();
  const durationField = (panel = false) => (
    <WorkoutAutoDuration
      draft={draft}
      manualClock={manualClock}
      retro={panel || BackdatedWorkout.isBackdated(draft, settings.timeZone)}
      estimatedMinutes={estimatedMinutes}
    />
  );
  const summary = volumeSummary([w]);
  const { workingDone: doneWorking, workingTotal: totalWorking } = flow;
  /** Общие свойства числовых полей строки: выбрать подход и выделить число при касании. */
  const fieldProps = (ei: number, si: number) => ({
    onFocus: (e: React.FocusEvent<HTMLInputElement>) => {
      lastGymMark.current = null;
      selectOnFocus.onFocus(e);
      followersRef.current = SetPropagation.followers(w.exercises[ei].sets, si);
      setActiveSetKey(w.exercises[ei].sets[si].id);
    },
    onMouseUp: selectOnFocus.onMouseUp,
    onBlur: (e: React.FocusEvent<HTMLInputElement>) => {
      selectOnFocus.onBlur(e);
      followersRef.current = null;
    },
    onClick: (e: React.MouseEvent) => e.stopPropagation(),
  });
  const nameForSet = (entry: WorkoutExercise, si: number) => `${entryName(entry)}, подход ${si + 1}`;
  const renderSet = (entry: WorkoutExercise, ei: number, si: number, gym = false, kindIndex = 0, quickControls?: ReactNode) => {
    const set = entry.sets[si];
    const exercise = exerciseForEntry(entry)!;
    const spec = exercise.recording;
    const timed = spec.type === "duration";
    const assistance = spec.loadMode === "assisted_bodyweight";
    const noLoad = spec.loadMode === "bodyweight";
    const perSide = !timed && spec.repsMode === "per_side";
    const name = nameForSet(entry, si);
    const comparable = previous.get(ExecutionIdentity.key(entry, set));
    const comparableIndex = ExecutionIdentity.setIndex(entry, set);
    const last = (set.warmup ? comparable?.warmup : comparable?.working)?.[comparableIndex];
    const lastText = previousLabel(entry, last);
    const fromLast = deloaded(entry, last, comparableIndex, set.warmup, set);
    const isActive = !gym && activeSetKey === set.id;
    const isLaidTopSet = !gym && !set.warmup && kindIndex === 0 && LaidDupPlan.hasPlanWeight(entry);
    const missing = needs?.setId === set.id && SetCompleteness.missing(exercise, set) === needs.field
      ? needs.field
      : null;
    const hintId = `${hintPrefix}-${ei}-${si}`;
    const invalid = (field: MissingField) => ({
      "aria-invalid": missing === field || undefined,
      "aria-describedby": missing === field ? hintId : undefined,
      "data-set-field": field,
    });
    const field = (label: string, input: ReactNode) => gym ? <label><span>{label}</span>{input}</label> : input;
    const loadLabel = assistance ? "Помощь, кг" : spec.loadMode === "per_implement"
      ? "На гантель, кг" : spec.loadMode === "added_bodyweight"
        ? "Доп. вес, кг" : spec.loadMode === "machine_stack" ? "Стек, кг" : "Вес, кг";
    const plannedRange = entry.repMin !== undefined && entry.repMax !== undefined
      ? entry.repMin === entry.repMax ? String(entry.repMin) : `${entry.repMin}–${entry.repMax}`
      : "—";
    const fields = (
      <>
        {noLoad ? (gym ? null : <span className="no-load-value" aria-label="Без внешнего веса">—</span>) : field(loadLabel, (
          <input
            aria-label={`${name}, ${assistance ? "помощь" : "вес"}`}
            title={recordingLabel(entry)}
            type="number"
            min="0"
            max="1000"
            step="0.5"
            inputMode="decimal"
            value={assistance ? (set.assistanceKg ?? 0) : set.weight || ""}
            placeholder={last ? `${last.weight}` : "0"}
            {...invalid("weight")}
            {...fieldProps(ei, si)}
            onChange={(event) => {
              const value = Number(trimLeadingZeros(event.target));
              changeSet(ei, si, assistance ? { assistanceKg: value, weight: 0 } : { weight: value }, true);
            }}
          />
        ))}
        {field(timed ? "Секунды" : perSide ? "Повторы на сторону" : "Повторы", (
          <input
            aria-label={`${name}, ${timed ? "секунды" : "повторы"}${perSide ? " на сторону" : ""}`}
            type="number"
            min="1"
            max={timed ? "86400" : "200"}
            inputMode="numeric"
            value={timed ? (set.durationSeconds ?? 30) : set.reps || ""}
            placeholder={last ? `${last.reps}` : timed ? "30" : plannedRange}
            {...invalid("reps")}
            {...fieldProps(ei, si)}
            onChange={(event) => {
              const value = Number(trimLeadingZeros(event.target));
              changeSet(ei, si, timed ? { durationSeconds: value, reps: 1 } : { reps: value }, true);
            }}
          />
        ))}
        {field(timed ? "Дистанция, км" : "RIR", (
          <input
            aria-label={`${name}, ${timed ? "дистанция, км" : "RIR"}`}
            type="number"
            min="0"
            max={timed ? "1000" : "10"}
            step={timed ? "0.01" : "0.5"}
            inputMode="decimal"
            value={timed ? (set.distanceKm ?? "") : (set.rir ?? "")}
            placeholder="—"
            {...fieldProps(ei, si)}
            onChange={(event) => changeSet(ei, si, timed
              ? { distanceKm: event.target.value === "" ? undefined : Number(event.target.value) }
              : { rir: event.target.value === "" ? null : Number(trimLeadingZeros(event.target)) }, true)}
          />
        ))}
      </>
    );
    const toggleLabel = set.done ? "Снять отметку" : "Отметить выполненным";
    return (
      <div key={gym ? undefined : set.id} className={gym ? "gym-set-editor" : "set-row-wrapper"}>
        <div
          data-exercise-id={entry.exerciseId}
          data-set-id={set.id}
          className={gym ? "gym-set-row" : `set-row ${set.done ? "done" : ""} ${isActive ? "row-active" : ""}${isLaidTopSet ? " laid-top-set" : ""}`}
          onClick={gym ? undefined : () => setActiveSetKey(isActive ? null : set.id)}
        >
          {!gym && (
            <button
              type="button"
              className={`set-kind ${set.kind || (set.warmup ? "warmup" : "normal")}`}
              title="Тип подхода (обычный, разминка, дропсет, мио-повторы)"
              aria-label={`Подход ${si + 1}: ${set.kind || (set.warmup ? "разминочный" : "рабочий")}. Нажми для переключения`}
              onClick={(event) => { event.stopPropagation(); changeSet(ei, si, cycleSetKind(set)); }}
            >
              {set.kind === "dropset" ? "D" : set.kind === "myorep" ? "M" : set.warmup ? "Р" : kindIndex + 1}
            </button>
          )}
          {(!gym || last) && <button
            type="button"
            className="set-previous"
            disabled={!fromLast}
            aria-label={last
              ? `Подставить прошлый результат: ${lastText}${deloadNow ? ` (в разгрузку — ${previousLabel(entry, fromLast)})` : ""}`
              : "Прошлого результата нет"}
            onClick={(event) => {
              event.stopPropagation();
              if (fromLast) changeSet(ei, si, PreviousSets.patch(fromLast, { timed, assistance }), true);
            }}
          >
            {gym ? `Прошлый: ${lastText}` : wrapSafe(lastText)}
          </button>}
          {gym ? <div className="gym-set-fields">{fields}</div> : fields}
          <button
            type="button"
            className={gym ? `button ${set.done ? "secondary" : "primary"} gym-set-check` : "set-check"}
            aria-label={`${toggleLabel}: ${name}`}
            aria-pressed={set.done}
            onClick={(event) => {
              event.stopPropagation();
              if (gym && event.detail > 1 && lastGymMark.current === event.currentTarget) return;
              if (!set.done) {
                const field = SetCompleteness.missing(exercise, set);
                if (field) {
                  setNeeds({ setId: set.id, field });
                  event.currentTarget.closest(".set-row, .gym-set-row")
                    ?.querySelector<HTMLInputElement>(`[data-set-field="${field}"]`)?.focus();
                  return;
                }
              }
              if (gym) lastGymMark.current = event.currentTarget;
              setNeeds(null);
              const next = changeSet(ei, si, { done: !set.done });
              if (!set.done && (gym || gymSetId === set.id)) selectGymSet(next?.set.id ?? set.id);
            }}
          >
            <svg className="set-check-feedback" aria-hidden="true" width="22" height="22" viewBox="0 0 24 24"
              fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <m.path
                d="M4 12l5 5L20 6"
                initial={false}
                variants={setCheckFeedback}
                animate={set.done && !reducedMotion ? "complete" : "idle"}
                transition={{ duration: reducedMotion ? 0 : 0.2, ease: "easeOut" }}
              />
            </svg>
            {gym && toggleLabel}
          </button>
        </div>
        {missing && <p id={hintId} className="set-hint" role="alert">{SetCompleteness.message(missing)}</p>}
        {isActive ? quickControls : null}
      </div>
    );
  };
  const lastRemoval = draft.removals?.at(-1);
  // Один вопрос, и только когда есть что терять: пустую тренировку закрываем сразу.
  const requestDiscard = () => {
    if (WorkoutDiscard.needsConfirmation(draft)) setShowCancelConfirm(true);
    else onDiscard();
  };
  const shiftRest = (seconds: number) =>
    update(
      draft.pausedRest !== null
        ? { ...draft, pausedRest: Math.max(0, draft.pausedRest + seconds) }
        : {
            ...draft,
            restUntil: Math.max(Date.now(), draft.restUntil ?? 0) + seconds * 1000,
          },
    );
  const modeSwitch = (
    <button
      ref={gymToggleRef}
      type="button"
      className="button secondary gym-mode-toggle"
      onClick={() => {
        focusGymToggle.current = true;
        setPreferGym(!gymMode);
        try { localStorage.setItem(GYM_MODE_KEY, gymMode ? "list" : "gym"); }
        catch { /* Keep the in-session choice if storage is unavailable. */ }
      }}
    >
      {gymMode ? "Весь список" : "Режим «В зале»"}
    </button>
  );
  return (
    <div className={`workout-screen workout-athletic workout-steel${gymMode ? " is-gym-mode" : ""}`} ref={screenRef} inert={readOnly}>
      <header className="workout-bar" ref={barRef}>
        <div className="workout-headline">
          <div className="workout-bar-title">
            <h1 className="workout-session-label">
              {draft.editing ? "Редактирование тренировки" : "Активная тренировка"}
            </h1>
            <label className="sr-only" htmlFor={`${hintPrefix}-name`}>Название тренировки</label>
            {room ? (
              <textarea
                id={`${hintPrefix}-name`}
                ref={nameBox}
                rows={1}
                className="workout-name-wrap"
                value={w.name}
                maxLength={120}
                disabled={saving}
                onChange={(e) => setWorkout({ ...w, name: e.target.value.replace(/\n/g, " ") })}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.nativeEvent.isComposing) e.preventDefault();
                }}
              />
            ) : (
              <div className="workout-name-field">
                <span className="workout-name-copy" aria-hidden="true">{w.name || "Название тренировки"}</span>
                <input
                  id={`${hintPrefix}-name`}
                  type="text"
                  value={w.name}
                  maxLength={120}
                  disabled={saving}
                  onChange={(e) => setWorkout({ ...w, name: e.target.value })}
                />
              </div>
            )}
            {room ? <RoomBadge onToast={onToast ?? (() => {})} /> : null}
          </div>
          <div className="workout-head-buttons-cluster">
            <button
              type="button"
              className="icon-button workout-minimize-btn"
              aria-label="Свернуть тренировку"
              onClick={onMinimize}
            >
              <ChevronDown size={22} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="icon-button sound-toggle-btn"
              aria-label={soundEnabled ? "Выключить звук" : "Включить звук"}
              aria-pressed={soundEnabled}
              title={soundEnabled ? "Звук включён" : "Звук выключен"}
              onClick={() => setSoundEnabled((v) => !v)}
            >
              {soundEnabled ? <Volume2 size={19} aria-hidden="true" /> : <VolumeX size={19} aria-hidden="true" />}
            </button>
            {!retroLabel && (
              <button
                type="button"
                className="icon-button workout-entry-toggle"
                aria-label="Дата, длительность и заметки"
                title="Дата, длительность и заметки"
                aria-expanded={entryPanel}
                aria-controls={entryPanelId}
                onClick={() => setEntryPanel((open) => !open)}
              >
                <Calendar size={18} aria-hidden="true" />
              </button>
            )}
            <button
              type="button"
              className="button secondary cancel-workout-btn"
              title="Отменить тренировку без сохранения"
              onClick={requestDiscard}
            >
              <X size={15} aria-hidden="true" />
              <span>Отмена</span>
            </button>
          </div>
        </div>
        {deloadLine ? (
          <div className="deload-hint" role="status">
            <span>{deloadLine}</span>
            <button type="button" className="button secondary" disabled={saving} onClick={applyDeload}>
              Подставить {deloadPlan ? DeloadHint.percent(deloadPlan.mode) : 85} %
            </button>
          </div>
        ) : null}
        {(retroLabel || entryPanel) && (
          <div className="retro-date">
            {retroLabel && (
              <button
                type="button"
                className="retro-chip"
                aria-expanded={entryPanel}
                aria-controls={entryPanelId}
                onClick={() => setEntryPanel((open) => !open)}
              >
                <Calendar size={15} aria-hidden="true" />
                {retroLabel}
              </button>
            )}
            {entryPanel && (
              <div className="retro-panel workout-entry-panel" id={entryPanelId} role="group" aria-label="Дата и длительность записи">
                {dateField(!!retroLabel)}
                {durationField(!!retroLabel)}
                <div className="workout-entry-notes">
                  <label htmlFor={entryPanelId + "-notes"}>Заметки</label>
                  <textarea
                    id={entryPanelId + "-notes"}
                    rows={2}
                    value={w.notes}
                    disabled={saving}
                    maxLength={2000}
                    onChange={(e) => setWorkout({ ...w, notes: e.target.value })}
                  />
                </div>
              </div>
            )}
          </div>
        )}
        {draft.editing ? null : <LiveStrip onOpen={onOpenTogether} />}
        <div className="workout-command-strip" ref={pinRef}>
          <div className="workout-live-hud">
            <WorkoutLiveClock
              draft={draft}
              manualClock={manualClock}
              saving={saving}
              onTogglePause={toggleSessionClock}
            />
            <span className="hud-metric hud-working">
              <b aria-live="polite" aria-atomic="true">{doneWorking}<small> / {totalWorking}</small></b>
              <span className="hud-label">Рабочие подходы</span>
            </span>
            <span className="hud-metric hud-tonnage-inline">
              <b>{fmt(summary.total)}<small> кг</small></b>
              <span className="hud-label">Тоннаж</span>
            </span>
          </div>
          <button
            type="button"
            className="button primary finish-button"
            aria-label={draft.editing ? "Сохранить изменения" : "Завершить тренировку"}
            onClick={onSave}
            disabled={saving || readOnly || doneWorking === 0}
          >
            {saving ? "…" : draft.editing ? "Сохранить" : "Завершить"}
          </button>
          {gymMode && modeSwitch}
          <div className="workout-session-progress" aria-hidden="true">
            <m.div
              className="workout-session-progress-fill"
              initial={false}
              animate={{ scaleX: totalWorking ? doneWorking / totalWorking : 0 }}
              transition={{ duration: reducedMotion ? 0 : 0.24, ease: "easeOut" }}
            />
          </div>
        </div>
      </header>
      {notificationError && <p className="inline-error" role="alert">{notificationError}. Таймер на экране продолжает работать.</p>}
      {error ? (
        <p className="inline-error" role="alert" ref={errorRef}>
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
      {undoError && <p className="form-error" role="alert">{undoError}</p>}
      <fieldset
        key={readOnly ? "read-only" : "editable"}
        className="workout-main"
        disabled={saving || readOnly}
        aria-label="Поля тренировки"
        onClickCapture={(event) => {
          if (gymMode && event.target instanceof Element && !event.target.closest(".gym-set-check")) {
            lastGymMark.current = null;
          }
        }}
        onKeyDown={(event) => {
          if (readOnly || event.nativeEvent.isComposing) return;
          if (gymMode && event.repeat && (event.key === "Enter" || event.key === " ")) {
            event.preventDefault();
            return;
          }
          if (event.key !== "Enter" || !(event.target instanceof HTMLInputElement) || event.target.type !== "number") return;
          const container = gymMode ? event.target.closest(".gym-set-fields") : event.currentTarget;
          if (!container) return;
          event.preventDefault();
          const inputs = Array.from(container.querySelectorAll<HTMLInputElement>('input[type="number"]:not(:disabled)'))
            .filter((input) => input.getClientRects().length > 0);
          const next = inputs[inputs.indexOf(event.target) + 1];
          next?.focus();
          next?.select();
        }}
      >
        {!gymMode && !draft.editing && w.exercises.length > 0 ? (
          <div className="workout-mode-row">
            {modeSwitch}
          </div>
        ) : null}
        {!w.exercises.length ? (
          <p className="workout-empty-clean">
            Добавь первое упражнение
          </p>
        ) : null}
        {gymMode ? (
          <WorkoutGym
            flow={flow}
            selected={gymSetId}
            onSelect={selectGymSet}
            editor={({ entry, exerciseIndex, setIndex }) => renderSet(entry, exerciseIndex, setIndex, true)}
            onAddSet={addSet}
            onRemoveSet={removeGymSet}
            onRemoveExercise={removeGymExercise}
            onAddExercise={onPick}
          />
        ) : w.exercises.map((we, ei) => {
          const exercise = exerciseForEntry(we)!;
          const spec = exercise.recording;
          const timed = spec.type === "duration";
          const assistance = spec.loadMode === "assisted_bodyweight";
          const noLoad = spec.loadMode === "bodyweight";
          const before = ExecutionIdentity.split(we).length===1 ? previous.get(ExecutionIdentity.key(we)) : undefined;
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
          const label = MuscleParticipation.primaryLabel(exercise);
          const headBadges = label ? [{ text: label, kind: "head-explicit" }] : [];
          const allSetsDone = we.sets.length > 0 && we.sets.every((s) => s.done);
          const completedSets = we.sets.filter((set) => set.done).length;
          const quickSetIndex = we.sets.findIndex((set) => activeSetKey === set.id);
          const quickSet = we.sets[quickSetIndex];

          const isBarbell = !timed && !noLoad && detectExerciseEquipment(exercise) === "barbell";
          const quickControls = !noLoad ? (
            <div className={`set-quick-controls-dock ${timed ? "is-timed" : ""}`}>
              <div className="quick-controls-heading">
                <span>
                  Быстрая правка · подход
                  {quickSet ? ` ${quickSetIndex + 1}` : ": выбери строку"}
                </span>
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
                          if (quickSet) changeSet(ei, quickSetIndex, { rir: quickSet.rir === r ? null : r }, true);
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

          const canWarmup = !we.sets.some((s) => s.warmup) && new WarmupPlanner(we).create().length > 0;
          let working = 0;
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

              <div className="exercise-card-head">
               <span className="exercise-order" aria-hidden="true">{String(ei + 1).padStart(2, "0")}</span>
               <div className="exercise-head-left">
                  <div className="title-with-badges">
                    <h3>{entryName(we)}</h3>
                    {headBadges.map((b) => (
                      <span key={b.text} className={`head-indicator-badge ${b.kind}`}>
                        {b.text}
                      </span>
                    ))}
                  </div>
                 <div className="exercise-header-meta">
                   <p>
                     {exercise.primary
                       .map((id) => MUSCLES.find((m) => m.id === id)!.short)
                       .join(" · ")}
                     {!timed && plannedRange
                       ? ` · ${we.sets.filter((s) => !s.warmup).length} × ${plannedRange} по плану`
                       : null}
                   </p>
                   <span className={`exercise-set-status ${allSetsDone ? "complete" : ""}`}>
                     {allSetsDone ? <CheckCircle2 size={13} aria-hidden="true" /> : null}
                     {completedSets} / {we.sets.length} {setsWord(we.sets.length)}
                   </span>
                 </div>
                </div>
                <div className="exercise-card-actions">
                  {isBarbell && (
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={`Блины: ${entryName(we)}`}
                      title="Калькулятор блинов"
                      onClick={() => {
                        setPlateCalcTarget({ weight: PlateApplication.openWeight(we.sets), ei });
                      }}
                    >
                      <Dumbbell size={16} aria-hidden="true" />
                    </button>
                  )}
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={`Заменить ${entryName(we)}`}
                    title="Заменить упражнение"
                    onClick={() => setSwapTarget({ ei, exercise })}
                  >
                    <ArrowLeftRight size={16} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className={`icon-button${we.supersetId ? " active" : ""}`}
                    aria-label={we.supersetId ? `Убрать ${entryName(we)} из суперсета` : `Суперсет: ${entryName(we)}`}
                    aria-pressed={!!we.supersetId}
                    title={we.supersetId ? "Убрать из суперсета" : "Суперсет"}
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
                    <Zap size={16} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="icon-button exercise-delete-btn"
                    aria-label={`Убрать ${entryName(we)}`}
                    title="Убрать упражнение"
                    onClick={() =>
                      update(WorkoutUndo.exercise(draft, ei))
                    }
                  >
                    <Trash2 size={16} aria-hidden="true" />
                  </button>
                </div>
              </div>

              {hint ? (
                <p
                  className={`recording-hint ${exercise.catalogRevision === 1 ? "legacy-hint" : ""}`}
                >
                  <Info size={14} aria-hidden="true" />
                  {hint}
                </p>
              ) : null}

              {we.progressionNote && !we.progressionNote.includes("правило программы") ? (
                <div className={`progression-banner${LaidDupPlan.hasPlanWeight(we) ? " laid-plan-banner" : ""}`}>
                  <TrendingUp size={15} className="text-accent" aria-hidden="true" />
                  <span>{we.progressionNote}</span>
                </div>
              ) : null}
              {!LaidDupPlan.hasPlanWeight(we) && before?.working && before.working.length > 0 && (
                <div className="exercise-autofill-bar">
                  <button
                    type="button"
                    className="autofill-pill-btn repeat"
                    title={
                      deloadNow
                        ? `Заполнить рабочие подходы повторениями с прошлой тренировки. Вес разгрузочный: прошлый ${previousLabel(we, before.working[0])} → ${previousLabel(we, deloaded(we, before.working[0], 0))}`
                        : "Заполнить рабочие подходы весами и повторениями с прошлой тренировки"
                    }
                    onClick={() => {
                      const newSets = we.sets.map((s) => {
                        if (s.warmup) return s;
                        const setIndex = ExecutionIdentity.setIndex(we, s);
                        const prevW = deloaded(we, PreviousSets.pick(before.working, setIndex), setIndex);
                        return prevW ? { ...s, ...PreviousSets.patch(prevW, { timed, assistance }) } : s;
                      });
                      patchExercise(ei, { sets: newSets });
                    }}
                  >
                    <RotateCcw size={13} />
                    <span>Повторить прошлые: {previousLabel(we, deloaded(we, before.working[0], 0))}{deloadNow ? " · разгрузка" : ""}</span>
                  </button>

                  {!noLoad && !assistance && !timed && !deloadNow && (
                    <button
                      type="button"
                      className="autofill-pill-btn progress"
                      title="Добавить +2.5 кг к рабочим подходам с прошлой тренировки (прогрессивная перегрузка)"
                      onClick={() => {
                        const newSets = we.sets.map((s) => {
                          if (s.warmup) return s;
                          const idx = ExecutionIdentity.setIndex(we, s);
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
                  <span className="set-check-heading">Готово</span>
                </div>
                {rirHelp && !timed && (
                  <div className="rir-inline-note" onClick={(e) => e.stopPropagation()}>
                    <span>RIR — запас повторений до отказа (0 = отказ, 1–2 = тяжело, 3+ = с запасом).</span>
                    <button
                      type="button"
                      className="icon-button"
                      onClick={() => setRirHelp(false)}
                      aria-label="Закрыть подсказку RIR"
                    >
                      <X size={15} aria-hidden="true" />
                    </button>
                  </div>
                )}
                {we.sets.map((s, si) => renderSet(we, ei, si, false, s.warmup ? 0 : working++, quickControls))}
              </div>
              <div className="set-actions">
                <button
                  className="add-set"
                  disabled={we.sets.length >= 30}
                  onClick={() => addSet(ei, false)}
                >
                  <Plus size={16} />
                  Подход
                </button>
                {canWarmup ? (
                  <button
                    type="button"
                    className="add-set warmup-add"
                    aria-label="Добавить 3 разминочных"
                    title="Три разминочных подхода: 40 / 60 / 80% рабочего веса — проверь и поправь"
                    onClick={() =>
                      patchExercise(ei, {
                        sets: [...new WarmupPlanner(we).create(), ...we.sets],
                      })
                    }
                  >
                    <Flame size={15} />
                    Разминка
                  </button>
                ) : null}
                <button
                  className="add-set remove-last"
                  disabled={we.sets.length <= 1}
                  aria-label="Убрать последний подход"
                  onClick={() => update(WorkoutUndo.set(draft,ei))}
                >
                  <Minus size={16} />
                </button>
              </div>
            </article>
            {we.supersetId && w.exercises[ei + 1]?.supersetId === we.supersetId && (
              <div className="superset-connector-strip">
                <div className="connector-line" />
                <span className="connector-tag">
                  <Zap size={12} className="text-accent" aria-hidden="true" />
                  Суперсет · без отдыха
                </span>
                <div className="connector-line" />
              </div>
            )}
          </Fragment>
        );
        })}
        {(!gymMode || !flow.positions.length) && (
          <button
            type="button"
            className="button secondary full-width"
            disabled={w.exercises.length >= 30}
            onClick={onPick}
          >
            <Plus size={18} aria-hidden="true" />
            Добавить упражнение
          </button>
        )}
      </fieldset>
      {/* Одна нижняя стопка: «Отменить удаление» и таймер отдыха идут друг под другом в одном липком блоке, поэтому не могут перекрыть друг друга. */}
      <div className="workout-dock" ref={dockRef}>
      <div className="workout-toast-region" role="region" aria-label="Уведомления тренировки">
      <AnimatePresence initial={false}>
        {lastRemoval ? (
          <m.div
            className={`workout-undo${toastPaused ? " is-paused" : ""}`}
            key={removalKey}
            initial={reducedMotion ? false : { opacity: 0, y: 12, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reducedMotion ? undefined : { opacity: 0, y: 10, scale: 0.97 }}
            transition={{ type: "spring", stiffness: 460, damping: 34 }}
            role="status"
            onMouseEnter={() => setToastPaused(true)}
            onMouseLeave={() => setToastPaused(false)}
            onFocusCapture={() => setToastPaused(true)}
            onBlurCapture={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
                setToastPaused(false);
              }
            }}
          >
            <span className="workout-undo-icon" aria-hidden="true">
              <Trash2 size={16} />
            </span>
            <div className="workout-undo-copy">
              <strong className="workout-undo-title">
                {lastRemoval.kind === "set" ? "Подход удалён" : "Упражнение убрано"}
              </strong>
              <span className="workout-undo-sub">
                {draft.removals!.length > 1
                  ? `В очереди ещё ${draft.removals!.length - 1} · можно вернуть`
                  : "Исчезнет через 3 с · можно вернуть"}
              </span>
            </div>
            <div className="workout-undo-actions">
              <button
                type="button"
                className="workout-undo-btn"
                aria-label="Отменить удаление"
                onClick={() => {
                  try {
                    setToastPaused(false);
                    update(WorkoutUndo.restore(draft));
                    setUndoError("");
                  } catch (e) {
                    setUndoError((e as Error).message);
                  }
                }}
              >
                <RotateCcw size={15} aria-hidden="true" />
                <span>Вернуть</span>
              </button>
              <button
                type="button"
                className="workout-undo-close"
                aria-label="Скрыть уведомление"
                onClick={() => {
                  setToastPaused(false);
                  update({ ...draft, removals: [] });
                }}
              >
                <X size={15} aria-hidden="true" />
              </button>
            </div>
            <span className="workout-undo-timer" aria-hidden="true" />
          </m.div>
        ) : null}
      </AnimatePresence>
      </div>
      {/* A skipped or expired rest must stop covering the controls immediately. */}
      <WorkoutRestBar
        draft={draft}
        restSeconds={restSeconds}
        soundEnabled={soundEnabled}
        reducedMotion={reducedMotion}
        onShift={shiftRest}
        onTogglePause={(rem) =>
          update(
            draft.pausedRest !== null
              ? {
                  ...draft,
                  restUntil: Date.now() + draft.pausedRest * 1000,
                  pausedRest: null,
                }
              : { ...draft, pausedRest: rem, restUntil: null },
          )
        }
        onSkip={() => update({ ...draft, restUntil: null, pausedRest: null })}
        onAnnounce={setAnnouncement}
      />
      </div>
      <span className="sr-only" role="status" aria-live="polite">
        {announcement}
      </span>

      {!readOnly && plateCalcTarget && (
        <Modal title="Калькулятор блинов" onClose={() => setPlateCalcTarget(null)} wide>
          <Suspense fallback={<div className="empty">Загружаем…</div>}>
            <PlateCalculator
              initialWeight={plateCalcTarget.weight}
              onClose={() => setPlateCalcTarget(null)}
              applyScope={PlateApplication.scope(w.exercises[plateCalcTarget.ei]?.sets ?? [], plateCalcTarget.weight)}
              onApplyWeight={(appliedWeight) => {
                const targetEi = plateCalcTarget.ei;
                setWorkout({
                  ...w,
                  exercises: w.exercises.map((e, i) =>
                    i === targetEi ? { ...e, sets: PlateApplication.apply(e.sets, plateCalcTarget.weight, appliedWeight) } : e,
                  ),
                });
              }}
            />
          </Suspense>
        </Modal>
      )}

      {!readOnly && swapTarget && (
        <ExerciseSwapModal
          currentExercise={swapTarget.exercise}
          onClose={() => setSwapTarget(null)}
          onSwap={(newEx) => {
            const targetEi = swapTarget.ei;
            const target = w.exercises[targetEi];
            const oldSpec = exerciseForEntry(target)?.recording;
            const renamed: WorkoutExercise = {
              ...target,
              exerciseId: newEx.id,
              displayNameSnapshot: newEx.name,
              catalogRevision: newEx.catalogRevision,
              recordingSpecRevision: newEx.catalogRevision,
              muscleMappingRevision: newEx.catalogRevision,
              ...(newEx.source || newEx.custom ? { externalDefinition: newEx } : {}),
            };
            // R08-REQ01: при другом правиле веса числа и ✓ старого упражнения не переходят; берём «Прошлое» нового.
            const find = (pool: Workout[]) => lastEntry(pool, { ...renamed, sets: [] }, workoutId, w.date, { timeZone: settings.timeZone });
            const last = DeloadEngine.isDeloadName(w.name) ? find(history) : (find(DeloadEngine.regular(history)) ?? find(history));
            const previousWorking = last?.sets.filter((s) => s.done && !s.warmup) ?? [];
            const swapped = ExerciseSwap.sets(target.sets, oldSpec?.loadMode, oldSpec?.type, newEx, previousWorking);
            setWorkout({
              ...w,
              exercises: w.exercises.map((e, i) =>
                i === targetEi ? { ...ExerciseSwap.entry(renamed, swapped.carried), sets: swapped.sets } : e,
              ),
            });
            if (!swapped.carried) onToast?.("Заменено: вес и отметки не перенесены — другое упражнение");
            setSwapTarget(null);
          }}
        />
      )}

      {!readOnly && showCancelConfirm && (
        <Modal
          title={draft.editing ? "Отменить изменения?" : "Отменить тренировку?"}
          onClose={() => setShowCancelConfirm(false)}
        >
          <div className="cancel-workout-dialog">
            <div className="cancel-warning-badge">
              <Trash2 size={28} className="text-danger" />
            </div>
            <p className="cancel-dialog-text">
              {draft.editing
                ? "Сохранённая тренировка останется в истории. Изменения в черновике будут потеряны."
                : "Выполненные подходы не попадут в историю. Черновик удалится с этого устройства."}
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
                {draft.editing ? "Да, отменить изменения" : "Да, отменить тренировку"}
              </button>
              <button
                type="button"
                className="button secondary full-width"
                onClick={() => setShowCancelConfirm(false)}
              >
                Продолжить
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
