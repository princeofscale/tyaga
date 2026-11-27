import { MuscleParticipation } from "../domain/MuscleParticipation";
import { ExecutionIdentity } from "../domain/ExecutionIdentity";
import { PreviousSets } from "../domain/PreviousSets";
import { DELOAD_PRESETS, DeloadEngine, type DeloadMode } from "../domain/DeloadEngine";
import { SetCompleteness, type MissingField } from "../domain/SetCompleteness";
import { WorkoutUndo } from "../domain/WorkoutUndo";
import { WorkoutFlow, type WorkoutSetPosition } from "../domain/WorkoutFlow";
import { SetPropagation, type SetFollowers } from "../domain/SetPropagation";
import { WorkoutDiscard } from "../domain/WorkoutDiscard";
import { selectOnFocus, trimLeadingZeros } from "../lib/numberField";
import { ExerciseLibrary, PlateCalculator } from "./chunks";
import { Fragment, Suspense, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { m, useReducedMotion } from "motion/react";
import {
  Plus,
  Minus,
  Trash2,
  Play,
  Info,
  Download,
  X,
  Dumbbell,
  Flame,
  RotateCcw,
  TrendingUp,
  Zap,
  ArrowLeftRight,
  CheckCircle2,
  Trophy,
  ShieldAlert,
} from "lucide-react";
import { BiomechanicsProfileStore } from "../domain/BiomechanicsProfile";
import { GymInventoryStore } from "../domain/GymInventory";
import { IntraSessionAutoregulator } from "../domain/IntraSessionAutoregulator";
import {
  JointGuardEngine,
  JointPainStore,
  OPTIONAL_WARMUP_PROTOCOLS,
  STANDARD_GYM_INVENTORY_ADAPTER,
} from "../domain/JointGuardEngine";
import { LivePrDetector } from "../domain/LivePrDetector";
import { ProgressionEngine, equipmentStepKg, toProgressionInventory } from "../domain/ProgressionEngine";
import { SmartRestPlanner } from "../domain/SmartRestPlanner";
import { PlateApplication } from "../domain/PlateApplication";
import { LaidDupPlan } from "../domain/LaidDupPlan";
import ExerciseSwapModal from "./ExerciseSwapModal";
import { useLiveRoom } from "../lib/liveRoomContext";
import Modal from "./Modal";
import { audioHaptics } from "../lib/audioHaptics";
import type { Exercise, Routine } from "../lib/types";
import { detectExerciseEquipment } from "../domain/ExerciseAlternatives";
import {
  MUSCLES,
  exerciseById,
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
  type Draft,
  type PersistenceStatus,
} from "../lib/draft";
export type { Draft } from "../lib/draft";
import { WarmupPlanner } from "../domain/WarmupPlanner";
import { BackdatedWorkout } from "../domain/BackdatedWorkout";
import { DeloadHint } from "../domain/DeloadHint";
import { ExerciseSwap } from "../domain/ExerciseSwap";
import { ExerciseAvoidStore, type AvoidReason, type SwapScope } from "../domain/SubstitutionPolicy";
import { useWakeLock } from "../hooks/useWakeLock";
import { setsWord } from "../lib/quantity";
import type { DeloadPlanRecord } from "../domain/DeloadPlan";
import LaidExerciseGuidanceBar from "./LaidExerciseGuidanceBar";
import WorkoutGym from "./WorkoutGym";
import WorkoutPhaseBanner from "./WorkoutPhaseBanner";
import { WorkoutAutoDuration } from "./workout/WorkoutLiveClock";
import { WorkoutHeader } from "./workout/WorkoutHeader";
import { WorkoutUndoDock } from "./workout/WorkoutUndoDock";

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
  /** ID текущего аккаунта (для списка «Не предлагать» при заменах). */
  accountId?: string;
  /** Применить замену упражнения к программе/циклу, когда выбран scope `block` / `program` / `avoid`. */
  onSwapInProgram?: (routineId: string, oldExerciseId: string, newExercise: Exercise, scope: SwapScope, avoidReason?: AvoidReason) => void;
  /** Режим действующей разгрузки (R06-REQ02): быстрые кнопки «прошлое» не возвращают вес выше разгрузочного. */
  deloadMode?: DeloadMode;
  /** Действующая разгрузка: строка и «Подставить 85 %» на свободной тренировке (R07-REQ05). */
  deloadPlan?: DeloadPlanRecord | null;
  /** Сохранённые программы: нужны для контекста DUP Лейда (неделя, целевой RIR, отдых по упражнениям) и цикла разгрузки. */
  routines?: Routine[];
};
const GYM_MODE_KEY = "tyaga_workout_view_mode";
const gymSelectionKey = (workoutId: string) => `${GYM_MODE_KEY}:set:${workoutId}`;
const savedGymMode = () => {
  try { return localStorage.getItem(GYM_MODE_KEY) === "gym"; }
  catch { return false; }
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
  accountId = "local",
  onSwapInProgram,
  deloadMode,
  deloadPlan,
  routines,
}: Props) {
  const [keepAwake, setKeepAwake] = useState(() => {
    try {
      return localStorage.getItem("tyaga-wake-lock") === "1";
    } catch {
      return false;
    }
  });
  const wakeLock = useWakeLock(keepAwake && !readOnly && !!draft);
  const avoidStore = useMemo(() => new ExerciseAvoidStore(accountId), [accountId]);
  const [avoidedIds, setAvoidedIds] = useState<Set<string>>(() => avoidStore.ids());
  useEffect(() => {
    setAvoidedIds(avoidStore.ids());
  }, [avoidStore]);
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
  const [readinessChoice, setReadinessChoice] = useState<{
    workoutId: string;
    level: "normal" | "worse" | "hard";
  } | null>(null);
  const readiness = readinessChoice && readinessChoice.workoutId === workoutId ? readinessChoice.level : null;
  const [readinessApplied, setReadinessApplied] = useState<{
    workoutId: string;
    level: "worse" | "hard";
  } | null>(null);
  const appliedReadiness = readinessApplied && readinessApplied.workoutId === workoutId ? readinessApplied.level : null;
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
  const [dismissedAutoreg, setDismissedAutoreg] = useState<Record<string, boolean>>({});
  const [detrainingAppliedFor, setDetrainingAppliedFor] = useState<string | null>(null);
  const [detrainingDismissedFor, setDetrainingDismissedFor] = useState<string | null>(null);
  const [smartRestMeta, setSmartRestMeta] = useState<{ seconds: number; label: string } | null>(null);
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
  const prDetector = useMemo(
    () => new LivePrDetector(history, workoutId),
    [history, workoutId],
  );
  const detrainingPlan = useMemo(() => {
    if (!draft || draft.editing || !history.length) return null;
    const todayIso = draft.workout.date;
    const lastDate = history
      .filter((item) => item.id !== draft.workout.id && item.date < todayIso && item.exercises.some((e) => e.sets.some((s) => s.done && !s.warmup)))
      .map((item) => item.date)
      .sort()
      .at(-1);
    if (!lastDate) return null;
    const gapDays = Math.round(
      (Date.parse(`${todayIso}T12:00:00Z`) - Date.parse(`${lastDate}T12:00:00Z`)) / 86_400_000,
    );
    const plan = ProgressionEngine.evaluateDetraining(gapDays);
    return plan.active ? plan : null;
  }, [draft, history]);
  const activeRoutine = useMemo(
    () => (draft?.workout.routineId && routines ? routines.find((r) => r.id === draft.workout.routineId) : undefined),
    [draft?.workout.routineId, routines],
  );
  const activeLaidCycle = useMemo(
    () => (activeRoutine && routines ? LaidDupPlan.cycleOf(routines, activeRoutine) : []),
    [activeRoutine, routines],
  );
  const activeLaidPeriodization = useMemo(
    () => (activeRoutine ? LaidDupPlan.periodizationOf(activeRoutine) : undefined),
    [activeRoutine],
  );
  const activeLaidPlan = useMemo(
    () =>
      activeRoutine && draft
        ? LaidDupPlan.planFor(activeRoutine, draft.workout.programDate ?? draft.workout.date, {
            workouts: history,
            cycle: activeLaidCycle,
          })
        : null,
    [activeRoutine, draft, history, activeLaidCycle],
  );
  // QA-R06-02 + периодическая/вставленная разгрузка: «прошлое» масштабируется от последнего
  // НЕразгрузочного результата упражнения, включая тренажёры (machine_stack), а не предлагает полный прошлый вес.
  const isPeriodicDeload = !!draft && (/Разгрузочная неделя/i.test(draft.workout.notes) || !!activeLaidPlan?.isDeload);
  const inDeload = !!draft && (DeloadEngine.isDeloadName(draft.workout.name) || isPeriodicDeload);
  const activeLaidGuide = useMemo(
    () =>
      activeLaidPlan
        ? LaidDupPlan.weekGuide(activeLaidPlan.position, {
            light: activeLaidPeriodization?.light,
            deload: inDeload,
            totalWeeks: LaidDupPlan.totalWeeks(activeLaidPeriodization),
          })
        : null,
    [activeLaidPlan, activeLaidPeriodization, inDeload],
  );
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
  // R06-REQ02 + периодическая разгрузка: в разгрузочной тренировке «прошлые» числа подставляются с разгрузочным весом и RIR, а не с полным.
  const deloadNow: DeloadMode | undefined = DeloadEngine.isDeloadName(w.name)
    ? (deloadMode ?? "volume")
    : isPeriodicDeload
      ? "recovery"
      : undefined;
  const periodicFactor = isPeriodicDeload && !DeloadEngine.isDeloadName(w.name)
    ? (activeRoutine?.cycle?.weightFactor ?? 0.7)
    : null;
  const periodicDeloadRir = isPeriodicDeload && !DeloadEngine.isDeloadName(w.name)
    ? (activeRoutine?.cycle?.deloadRir ?? 4)
    : null;
  // `set` — когда «прошлое» искали по ключу подхода (контекст выполнения на уровне подхода): база ищется по тому же ключу (QA-R06-12).
  const deloaded = (entry: WorkoutExercise, previous: SetEntry | undefined, index: number, warmup = false, set?: SetEntry): SetEntry | undefined => {
    if (!previous || !deloadNow) return previous;
    const base = deloadBase.get(ExecutionIdentity.key(entry, set));
    const source = PreviousSets.pick(warmup ? (base?.warmup ?? []) : (base?.working ?? []), index);
    // Нет неразгрузочной базы: «прошлое» уже из разгрузки — второй раз вес не снижаем.
    if (!source) return previous;
    const loadMode = exerciseForEntry(entry)?.recording.loadMode;
    const weight =
      periodicFactor !== null
        ? DeloadEngine.isScalable(loadMode)
          ? Math.min(source.weight, Math.max(0, Math.round((source.weight * periodicFactor) / 2.5) * 2.5))
          : source.weight
        : DeloadEngine.scaleLoad(source.weight, loadMode, deloadNow);
    const rir = warmup
      ? source.rir
      : periodicDeloadRir !== null
        ? periodicDeloadRir
        : DELOAD_PRESETS[deloadNow].targetRir;
    return { ...source, weight, rir };
  };
  const applyDetrainingAdjustment = () => {
    if (!detrainingPlan || detrainingAppliedFor === w.id) return;
    const inv = toProgressionInventory(GymInventoryStore.read());
    const nextExercises = w.exercises.map((entry) => {
      const def = exerciseForEntry(entry);
      const loadMode = def?.recording.loadMode ?? "total_external";
      const timedEx = def?.recording.type === "duration";
      const scalable = !timedEx && DeloadEngine.isScalable(loadMode);
      const workingSetsList = entry.sets.filter((s) => !s.warmup);
      const sampleWeight = workingSetsList.find((s) => s.weight > 0)?.weight ?? 0;
      const adjusted = ProgressionEngine.applyDetrainingToPlan(
        sampleWeight,
        workingSetsList.length,
        detrainingPlan.gapDays,
        loadMode,
        inv,
      );
      let keptWorking = 0;
      const nextSets = entry.sets.flatMap((s) => {
        if (s.warmup) return [s];
        if (s.done) {
          keptWorking++;
          return [s];
        }
        if (keptWorking >= adjusted.setsCount) return [];
        keptWorking++;
        const nextW =
          scalable && s.weight > 0
            ? ProgressionEngine.applyDetrainingToPlan(
                s.weight,
                workingSetsList.length,
                detrainingPlan.gapDays,
                loadMode,
                inv,
              ).weightKg
            : s.weight;
        return [
          {
            ...s,
            weight: nextW,
            ...(!timedEx && detrainingPlan.rirFloor !== null && (s.rir === null || s.rir < detrainingPlan.rirFloor)
              ? { rir: detrainingPlan.rirFloor }
              : {}),
          },
        ];
      });
      return { ...entry, sets: nextSets };
    });
    setWorkout({ ...w, exercises: nextExercises });
    setDetrainingAppliedFor(w.id);
    onToast?.(
      `Применён мягкий вход после паузы ${detrainingPlan.gapDays} дн. (${Math.round(detrainingPlan.weightMultiplier * 100)} % веса, ${Math.round(detrainingPlan.volumeMultiplier * 100)} % объёма).`,
    );
  };

  const renderDdpGoalLine = (
    entry: WorkoutExercise,
    exercise: Exercise,
    before: { working: SetEntry[]; warmup: SetEntry[] } | undefined,
    isLaidTopLift: boolean,
  ) => {
    const spec = exercise.recording;
    if (
      inDeload ||
      isLaidTopLift ||
      spec.type === "duration" ||
      spec.loadMode === "bodyweight" ||
      !before?.working?.length ||
      entry.repMin === undefined ||
      entry.repMax === undefined
    ) {
      return null;
    }
    const inv = toProgressionInventory(GymInventoryStore.read());
    const recs = ProgressionEngine.recommendDdpSets({
      previousSets: before.working.map((s) => ({
        weight: s.weight,
        reps: s.reps,
        rir: s.rir,
      })),
      repMin: entry.repMin,
      repMax: entry.repMax,
      loadMode: spec.loadMode,
      inventory: inv,
    });
    const firstRec = recs[0];
    if (!firstRec || firstRec.recommendedWeight <= 0) return null;
    const prevFirstWeight = before.working[0]?.weight ?? 0;
    const delta = Math.round((firstRec.recommendedWeight - prevFirstWeight) * 100) / 100;
    return (
      <div className="ddp-goal-line">
        <span>
          Цель DDP: <strong>{fmt(firstRec.recommendedWeight)} кг × {firstRec.recommendedReps}</strong> (RIR 1–2)
        </span>
        {firstRec.action === "increase_weight" && delta > 0 ? (
          <span className="ddp-upgrade-badge">+{fmt(delta)} кг</span>
        ) : firstRec.action === "hold_improve_rir" ? (
          <span className="ddp-hold-badge">Удержать до RIR 1–2</span>
        ) : null}
      </div>
    );
  };

  const renderIntraAutoregBar = (
    entry: WorkoutExercise,
    ei: number,
    exercise: Exercise,
    before: { working: SetEntry[]; warmup: SetEntry[] } | undefined,
    isLaidTopLift: boolean,
  ) => {
    const spec = exercise.recording;
    if (spec.type === "duration" || spec.loadMode === "bodyweight") return null;
    const workingSetsAll = entry.sets.filter((s) => !s.warmup);
    const firstDone = workingSetsAll.find((s) => s.done && s.reps > 0);
    const remainingUndone = workingSetsAll.filter((s) => !s.done);
    if (!firstDone || remainingUndone.length === 0) return null;
    const autoregKey = `${w.id}:${ei}:${firstDone.id}:${firstDone.reps}:${firstDone.rir ?? "n"}`;
    if (dismissedAutoreg[autoregKey]) return null;

    const targetReps =
      isLaidTopLift && activeLaidPlan
        ? activeLaidPlan.heavy.reps
        : (entry.repMax ?? entry.repMin ?? before?.working?.[0]?.reps ?? 0);
    if (targetReps <= 0) return null;
    const plannedWeight = remainingUndone[0].weight || firstDone.weight;
    const inv = toProgressionInventory(GymInventoryStore.read());
    const adj = IntraSessionAutoregulator.evaluate({
      exerciseId: entry.exerciseId,
      isCompoundAxial: DeloadEngine.axialLoadMultiplier(exercise) >= 1.0,
      loadMode: spec.loadMode,
      plannedWeight,
      targetReps,
      targetRIR: 2,
      actualReps: firstDone.reps,
      actualRIR: firstDone.rir,
      remainingSetsCount: remainingUndone.length,
      inventory: inv,
    });
    if (!adj.shouldNotify || (inDeload && adj.status === "high_performance")) {
      return null;
    }
    return (
      <div className={`intra-autoreg-bar status-${adj.status}`} role="status">
        <span>{adj.messageShort}</span>
        <div className="intra-autoreg-actions">
          <button
            type="button"
            className="button secondary intra-autoreg-apply"
            onClick={() => {
              let nextSets = entry.sets.map((s) =>
                s.warmup || s.done
                  ? s
                  : {
                      ...s,
                      weight: adj.adjustedWeight,
                      ...(adj.repCap !== null && s.reps > adj.repCap
                        ? { reps: adj.repCap }
                        : {}),
                    },
              );
              if (adj.dropLastSet) {
                for (let idx = nextSets.length - 1; idx >= 0; idx--) {
                  if (!nextSets[idx].warmup && !nextSets[idx].done) {
                    nextSets = nextSets.filter((_, j) => j !== idx);
                    break;
                  }
                }
              }
              patchExercise(ei, { sets: nextSets });
              setDismissedAutoreg((prev) => ({ ...prev, [autoregKey]: true }));
              onToast?.(`Применено: ${adj.adjustedWeight} кг${adj.dropLastSet ? " · −1 подход" : ""}.`);
            }}
          >
            Применить
          </button>
          <button
            type="button"
            className="icon-button intra-autoreg-dismiss"
            aria-label="Скрыть подсказку"
            onClick={() =>
              setDismissedAutoreg((prev) => ({ ...prev, [autoregKey]: true }))
            }
          >
            <X size={14} aria-hidden="true" />
          </button>
        </div>
      </div>
    );
  };

  const applyReadinessAdjustment = (level: "worse" | "hard") => {
    if (appliedReadiness) return;
    const inv = toProgressionInventory(GymInventoryStore.read());
    const targetRir = level === "worse" ? 2 : 3;
    let adjustedSets = 0;
    let trimmedSets = 0;
    const nextExercises = w.exercises.map((entry) => {
      const def = exerciseForEntry(entry);
      const loadMode = def?.recording.loadMode ?? "total_external";
      const timedEx = def?.recording.type === "duration";
      const scalable = !timedEx && DeloadEngine.isScalable(loadMode);
      const isCompoundAxial = DeloadEngine.axialLoadMultiplier(def) >= 1.0;
      const workingCount = entry.sets.filter((s) => !s.warmup).length;

      let sets = entry.sets.map((s) => {
        if (s.done || s.warmup) return s;
        const adj = IntraSessionAutoregulator.preSessionAdjustment({
          status: level,
          isCompoundAxial,
          plannedWeight: s.weight,
          plannedSetsCount: workingCount,
          loadMode,
          inventory: inv,
        });
        const nextWeight = scalable && s.weight > 0 ? adj.adjustedWeight : s.weight;
        if (nextWeight !== s.weight) adjustedSets++;
        return {
          ...s,
          weight: Math.round(nextWeight * 100) / 100,
          ...(!timedEx && (s.rir === null || s.rir < targetRir) ? { rir: targetRir } : {}),
        };
      });
      if (level === "hard") {
        const plan = IntraSessionAutoregulator.preSessionAdjustment({
          status: "hard",
          isCompoundAxial,
          plannedWeight: 0,
          plannedSetsCount: workingCount,
          loadMode,
          inventory: inv,
        });
        const toRemove = Math.max(0, workingCount - plan.targetSetsCount);
        for (let k = 0; k < toRemove; k++) {
          let lastUndoneIdx = -1;
          for (let i = sets.length - 1; i >= 0; i--) {
            if (!sets[i].warmup && !sets[i].done) {
              lastUndoneIdx = i;
              break;
            }
          }
          if (lastUndoneIdx !== -1) {
            sets = sets.filter((_, i) => i !== lastUndoneIdx);
            trimmedSets++;
          }
        }
      }
      return { ...entry, sets };
    });
    setWorkout({ ...w, exercises: nextExercises });
    setReadinessApplied({ workoutId: w.id, level });
    onToast?.(
      level === "worse"
        ? `Смягчили оставшиеся подходы (база −5 %, подсобка −2,5 %, RIR ${targetRir}${adjustedSets ? `, подходов: ${adjustedSets}` : ""}).`
        : `Включён щадящий режим (база −10 %, подсобка −5 %, RIR ${targetRir}${trimmedSets ? `, убрано подходов: ${trimmedSets}` : ""}).`,
    );
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
    const targetSet = targetEx.sets[si];
    const next = patch.done ? flow.after(targetSet.id)?.position : undefined;
    const isSupersetTransition =
      patch.done &&
      targetEx?.supersetId &&
      w.exercises[ei + 1]?.supersetId === targetEx.supersetId;
    const workingIdx = targetEx.sets.slice(0, si).filter((s) => !s.warmup).length;
    const laidRest =
      activeLaidPlan && activeLaidPeriodization && !targetSet.warmup
        ? LaidDupPlan.restSecondsForSet(activeLaidPeriodization.day, targetEx.exerciseId, activeLaidPlan, {
            isTopSet: workingIdx === 0,
            reps: targetSet.reps || undefined,
            substitutions: activeLaidPeriodization.substitutions,
            deload: inDeload,
          })
        : null;
    const smartRest = new SmartRestPlanner({
      fallbackSeconds: restSeconds,
      inDeload,
    }).recommend(exerciseForEntry(targetEx), targetSet);
    const effectiveRest = isSupersetTransition ? 15 : (laidRest ?? smartRest.seconds);
    if (patch.done) {
      setSmartRestMeta({
        seconds: effectiveRest,
        label: isSupersetTransition
          ? "Суперсет · 0:15"
          : laidRest !== null
            ? `План DUP · ${SmartRestPlanner.formatShort(laidRest)}`
            : smartRest.label,
      });
    }

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
    !draft.editing && !inDeload ? DeloadHint.line(deloadPlan, localDate(new Date(), zone)) : null;
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
    const shownPrevText = deloadNow && fromLast ? previousLabel(entry, fromLast) : lastText;
    const isActive = !gym && activeSetKey === set.id;
    const isLaidTopSet = !gym && !set.warmup && kindIndex === 0 && LaidDupPlan.hasPlanWeight(entry);
    const laidGuidance =
      activeLaidPlan && activeLaidPeriodization
        ? LaidDupPlan.exerciseGuidance(
            activeLaidPeriodization.day,
            entry.exerciseId,
            activeLaidPlan,
            activeLaidPeriodization.substitutions,
            { deload: inDeload },
          )
        : null;
    const rirPlaceholder = set.warmup
      ? "—"
      : inDeload
        ? String(periodicDeloadRir ?? (deloadNow ? DELOAD_PRESETS[deloadNow].targetRir : 4))
        : laidGuidance
          ? laidGuidance.role === "lift" && activeLaidPlan?.prescriptionMode === "percent_1rm"
            ? kindIndex === 0
              ? activeLaidPlan.position.wave === 3
                ? "1"
                : "1–2"
              : "2–3"
            : laidGuidance.rirPlaceholder
          : "—";
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
            placeholder={fromLast ? `${fromLast.weight}` : last ? `${last.weight}` : "0"}
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
            placeholder={timed ? "—" : rirPlaceholder}
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
          data-testid={gym ? undefined : "set-row"}
          tabIndex={gym ? undefined : 0}
          aria-expanded={gym ? undefined : isActive}
          className={gym ? "gym-set-row" : `set-row ${set.done ? "done" : ""} ${isActive ? "row-active" : ""}${isLaidTopSet ? " laid-top-set" : ""}`}
          onClick={gym ? undefined : () => setActiveSetKey(isActive ? null : set.id)}
          onKeyDown={gym ? undefined : (event) => {
            if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) {
              event.preventDefault();
              setActiveSetKey(isActive ? null : set.id);
            }
          }}
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
            {gym ? `Прошлый: ${shownPrevText}` : wrapSafe(shownPrevText)}
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
        {(() => {
          const prHit = prDetector.checkSet(entry, set);
          if (!prHit) return null;
          return (
            <div
              className="live-pr-badge"
              role="status"
              title={`Прежний рекорд e1RM: ${fmt(prHit.previousBest)} кг (+${fmt(prHit.deltaKg)} кг)`}
            >
              <Trophy size={12} aria-hidden="true" />
              <span>PR · e1RM {fmt(prHit.e1rm)} кг (+{fmt(prHit.deltaKg)})</span>
            </div>
          );
        })()}
        {gym && !noLoad ? (() => {
          const inv = toProgressionInventory(GymInventoryStore.read());
          const step = equipmentStepKg(set.weight || inv.barbellWeightKg, spec.loadMode, inv);
          return (
            <div className="gym-thumb-controls" aria-label="Быстрая правка одной рукой">
              <div className="gym-thumb-weights">
                {[-step * 2, -step, step, step * 2].map((delta) => (
                  <button
                    key={delta}
                    type="button"
                    className="gym-thumb-btn"
                    onClick={() => bumpWeight(ei, si, delta)}
                  >
                    {delta < 0 ? `−${fmt(Math.abs(delta))}` : `+${fmt(delta)}`}
                  </button>
                ))}
              </div>
              {!timed ? (
                <div className="gym-thumb-rir">
                  <span className="gym-thumb-label">RIR</span>
                  {[0, 1, 2, 3, 4].map((r) => (
                    <button
                      key={r}
                      type="button"
                      className={`gym-thumb-rir-btn${set.rir === r ? " active" : ""}`}
                      aria-pressed={set.rir === r}
                      onClick={() => changeSet(ei, si, { rir: set.rir === r ? null : r }, true)}
                    >
                      {r}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          );
        })() : null}
        {missing && <p id={hintId} className="set-hint" role="alert">{SetCompleteness.message(missing)}</p>}
        {isActive ? quickControls : null}
      </div>
    );
  };
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
      <WorkoutHeader
        barRef={barRef}
        pinRef={pinRef}
        nameBox={nameBox}
        hintPrefix={hintPrefix}
        entryPanelId={entryPanelId}
        draft={draft}
        workout={w}
        room={!!room}
        readOnly={readOnly}
        saving={saving}
        gymMode={gymMode}
        workoutId={workoutId}
        manualClock={manualClock}
        soundEnabled={soundEnabled}
        onToggleSound={() => setSoundEnabled((v) => !v)}
        wakeLockSupported={wakeLock.supported}
        keepAwake={keepAwake}
        onToggleWakeLock={() =>
          setKeepAwake((v) => {
            const next = !v;
            try {
              localStorage.setItem("tyaga-wake-lock", next ? "1" : "0");
            } catch {
              /* ignore */
            }
            return next;
          })
        }
        retroLabel={retroLabel}
        entryPanel={entryPanel}
        onToggleEntryPanel={() => setEntryPanel((open) => !open)}
        readiness={readiness}
        appliedReadiness={appliedReadiness}
        onSelectReadiness={(level) => {
          if (!workoutId) return;
          setReadinessChoice((cur) =>
            cur && cur.workoutId === workoutId && cur.level === level
              ? null
              : { workoutId, level },
          );
        }}
        onApplyReadiness={applyReadinessAdjustment}
        deloadLine={deloadLine}
        deloadPlan={deloadPlan}
        onApplyDeload={applyDeload}
        doneWorking={doneWorking}
        totalWorking={totalWorking}
        totalTonnage={summary.total}
        reducedMotion={reducedMotion}
        modeSwitch={modeSwitch}
        dateField={dateField}
        durationField={durationField}
        onChangeWorkout={setWorkout}
        onToggleClock={toggleSessionClock}
        onMinimize={onMinimize}
        onRequestDiscard={requestDiscard}
        onSave={onSave}
        onOpenTogether={onOpenTogether}
        onToast={onToast}
      />
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
        {!draft.editing ? (
          <WorkoutPhaseBanner
            laidGuide={activeLaidGuide}
            inDeload={inDeload}
            periodicDeloadRir={periodicDeloadRir}
            deloadNow={deloadNow}
          />
        ) : null}
        {!draft.editing && !inDeload && detrainingPlan && detrainingAppliedFor !== w.id && detrainingDismissedFor !== w.id ? (
          <div className="intra-autoreg-bar status-fatigued detraining-banner" role="status">
            <span>
              Перерыв {detrainingPlan.gapDays} дн. — мягкий вход: {Math.round(detrainingPlan.weightMultiplier * 100)} % веса,{" "}
              {Math.round(detrainingPlan.volumeMultiplier * 100)} % объёма (RIR {detrainingPlan.rirFloor}+)
            </span>
            <div className="intra-autoreg-actions">
              <button
                type="button"
                className="button secondary intra-autoreg-apply"
                onClick={applyDetrainingAdjustment}
              >
                Применить
              </button>
              <button
                type="button"
                className="icon-button intra-autoreg-dismiss"
                aria-label="Скрыть мягкий вход"
                onClick={() => setDetrainingDismissedFor(w.id)}
              >
                <X size={14} aria-hidden="true" />
              </button>
            </div>
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
            headerExtra={({ entry, exerciseIndex }) => {
              const exDef = exerciseForEntry(entry);
              const isLaidTopLift = !!activeLaidPlan && entry.exerciseId === activeLaidPlan.liftExerciseId;
              const gymGuidance =
                activeLaidPlan && activeLaidPeriodization
                  ? LaidDupPlan.exerciseGuidance(
                      activeLaidPeriodization.day,
                      entry.exerciseId,
                      activeLaidPlan,
                      activeLaidPeriodization.substitutions,
                      { deload: inDeload },
                    )
                  : null;
              const gymBefore =
                ExecutionIdentity.split(entry).length === 1
                  ? previous.get(ExecutionIdentity.key(entry))
                  : undefined;
              const gymAuxProg =
                activeLaidPlan && !inDeload && !isLaidTopLift && gymBefore?.working?.length
                  ? LaidDupPlan.auxProgressionHint(entry, gymBefore.working)
                  : null;
              const gymTopWeight =
                isLaidTopLift && exDef?.recording.loadMode === "total_external"
                  ? (entry.sets.find((s) => !s.warmup && s.weight > 0)?.weight ?? null)
                  : null;
              const gymWorkSets = entry.sets.filter((s) => !s.warmup);
              const gymTargetReps =
                isLaidTopLift && activeLaidPlan
                  ? `1×${activeLaidPlan.heavy.reps} + ${activeLaidPlan.work.sets}×${activeLaidPlan.work.reps}`
                  : entry.repMin !== undefined && entry.repMax !== undefined
                    ? `${gymWorkSets.length} × ${entry.repMin === entry.repMax ? entry.repMin : `${entry.repMin}–${entry.repMax}`}`
                    : null;
              const gymPrevFirst = gymBefore?.working?.[0];
              const gymWeightHint: { label: string; source: "plan" | "history" | "deload" | "none" } | null =
                isLaidTopLift && activeLaidPlan && activeLaidPlan.prescriptionMode === "percent_1rm"
                  ? {
                      label: `План: ${LaidDupPlan.kg(activeLaidPlan.heavy.weightKg)} / ${LaidDupPlan.kg(activeLaidPlan.work.weightKg)} кг`,
                      source: inDeload ? "deload" : "plan",
                    }
                  : exDef?.recording.loadMode === "bodyweight" || exDef?.recording.type === "duration"
                    ? null
                    : gymPrevFirst && gymPrevFirst.weight > 0
                      ? {
                          label: inDeload
                            ? `Разгрузка: ${LaidDupPlan.kg(Math.round(gymPrevFirst.weight * 0.65 * 2) / 2)} кг`
                            : `Прошлый: ${LaidDupPlan.kg(gymPrevFirst.weight)} кг`,
                          source: inDeload ? "deload" : "history",
                        }
                      : { label: "Вес: подбери по RIR", source: "none" };
              const gymWarmups = !entry.sets.some((s) => s.warmup)
                ? isLaidTopLift && !inDeload
                  ? new WarmupPlanner(entry).createForTopSet(GymInventoryStore.read().barWeightKg)
                  : new WarmupPlanner(entry).create()
                : [];
              const gymCue = exDef ? BiomechanicsProfileStore.techniqueCue(exDef) : null;
              const gymDdpLine = exDef ? renderDdpGoalLine(entry, exDef, gymBefore, isLaidTopLift) : null;
              const gymAutoregBar = exDef ? renderIntraAutoregBar(entry, exerciseIndex, exDef, gymBefore, isLaidTopLift) : null;
              if (!gymGuidance && !entry.progressionNote && !gymWarmups.length && !gymCue && !gymDdpLine && !gymAutoregBar) return null;
              return (
                <div className="gym-guidance-stack">
                  {gymCue ? <p className="lever-cue">{gymCue}</p> : null}
                  {gymDdpLine}
                  {gymAutoregBar}
                  {gymGuidance ? (
                    <LaidExerciseGuidanceBar
                      guidance={gymGuidance}
                      hasProgressionNote={!!entry.progressionNote}
                      targetSetsReps={gymTargetReps}
                      weightHint={gymWeightHint}
                      auxProgression={gymAuxProg}
                      topSetPlateWeightKg={gymTopWeight}
                      onApplyAuxWeight={(nextKg) => {
                        const targetMin = entry.repMin ?? entry.sets.find((s) => !s.warmup)?.reps ?? 10;
                        patchExercise(exerciseIndex, {
                          sets: entry.sets.map((s) =>
                            s.warmup || s.done ? s : { ...s, weight: nextKg, reps: targetMin },
                          ),
                        });
                      }}
                    />
                  ) : null}
                  {entry.progressionNote && !entry.progressionNote.includes("правило программы") ? (
                    <div className={`progression-banner${LaidDupPlan.hasPlanWeight(entry) ? " laid-plan-banner" : ""}`}>
                      <TrendingUp size={15} className="text-accent" aria-hidden="true" />
                      <span>{entry.progressionNote}</span>
                    </div>
                  ) : null}
                  {gymWarmups.length > 0 ? (
                    <button
                      type="button"
                      className="button secondary gym-smart-warmup-btn"
                      onClick={() => {
                        patchExercise(exerciseIndex, { sets: [...gymWarmups, ...entry.sets] });
                        selectGymSet(gymWarmups[0].id);
                      }}
                    >
                      <Flame size={15} aria-hidden="true" />
                      <span>
                        {isLaidTopLift && !inDeload
                          ? `Лесенка разминки под топ-сет (${gymWarmups.length} подх.)`
                          : `Добавить разминку (${gymWarmups.length} подх.)`}
                      </span>
                    </button>
                  ) : null}
                </div>
              );
            }}
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

          const isLaidTopLift = !!activeLaidPlan && we.exerciseId === activeLaidPlan.liftExerciseId;
          const canWarmup =
            !we.sets.some((s) => s.warmup) &&
            (isLaidTopLift && !inDeload
              ? new WarmupPlanner(we).createForTopSet(GymInventoryStore.read().barWeightKg).length > 0
              : new WarmupPlanner(we).create().length > 0);
          const topSetPlateWeightKg =
            isLaidTopLift && spec.loadMode === "total_external"
              ? (we.sets.find((s) => !s.warmup && s.weight > 0)?.weight ?? null)
              : null;
          const cardGuidance =
            activeLaidPlan && activeLaidPeriodization
              ? LaidDupPlan.exerciseGuidance(
                  activeLaidPeriodization.day,
                  we.exerciseId,
                  activeLaidPlan,
                  activeLaidPeriodization.substitutions,
                  { deload: inDeload },
                )
              : null;
          const auxProgression =
            activeLaidPlan &&
            !inDeload &&
            we.exerciseId !== activeLaidPlan.liftExerciseId &&
            before?.working?.length
              ? LaidDupPlan.auxProgressionHint(we, before.working)
              : null;
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
                        const pairPrev = !prevSS && ei > 0;
                        setWorkout({
                          ...w,
                          exercises: w.exercises.map((item, idx) =>
                            idx === ei || (pairPrev && idx === ei - 1)
                              ? { ...item, supersetId: targetSS }
                              : item,
                          ),
                        });
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

              {(() => {
                const cue = BiomechanicsProfileStore.techniqueCue(exercise);
                return cue ? <p className="lever-cue">{cue}</p> : null;
              })()}

              {(() => {
                const painLogs = JointPainStore.read();
                if (!painLogs.length) return null;
                const jg = new JointGuardEngine();
                const longLevers = BiomechanicsProfileStore.read().longLevers;
                const nowMs = Date.now();
                const safety = jg.evaluateExerciseSafety(we.exerciseId, painLogs, longLevers, nowMs);
                if (safety.action === "allow") return null;
                const sourceWeight =
                  we.sets.find((s) => !s.warmup && s.weight > 0)?.weight ??
                  before?.working?.[0]?.weight ??
                  0;
                const swaps =
                  safety.action === "swap_recommended" || safety.action === "block_swap_required"
                    ? jg.recommendSwap(
                        we.exerciseId,
                        sourceWeight,
                        painLogs,
                        longLevers,
                        nowMs,
                        STANDARD_GYM_INVENTORY_ADAPTER,
                        2,
                      )
                    : [];
                const warmup = safety.optionalWarmupProtocol
                  ? OPTIONAL_WARMUP_PROTOCOLS[safety.optionalWarmupProtocol]
                  : null;
                return (
                  <div className={`wv-jg-banner is-${safety.action}`} role="status">
                    <div className="wv-jg-top">
                      <ShieldAlert size={15} aria-hidden="true" />
                      <strong>
                        {safety.action === "block_swap_required"
                          ? "Защита суставов: нужна безопасная замена"
                          : safety.action === "swap_recommended"
                            ? "Защита суставов: лучше заменить движение"
                            : `Защита суставов: ×${Math.round(safety.loadMultiplier * 100)}% веса · темп ${safety.tempoPrescription ?? "3-1-1-0"} · RIR ${safety.targetRirFloor ?? 2}+`}
                      </strong>
                    </div>
                    {warmup ? (
                      <span className="wv-jg-warmup">
                        Разминка: {warmup.title} ({warmup.prescription})
                      </span>
                    ) : null}
                    {!readOnly && swaps.length > 0 ? (
                      <div className="wv-jg-swaps">
                        {swaps.map((sw) => {
                          const targetEx = exerciseById(sw.targetExerciseId);
                          if (!targetEx) return null;
                          return (
                            <button
                              key={sw.targetExerciseId}
                              type="button"
                              className="wv-jg-swap-btn"
                              onClick={() => {
                                const oldSpec = exerciseForEntry(we)?.recording;
                                const swapped = ExerciseSwap.sets(
                                  we.sets,
                                  oldSpec?.loadMode,
                                  oldSpec?.type,
                                  targetEx,
                                  [],
                                );
                                const nextSets = swapped.sets.map((s) =>
                                  !s.done && !s.warmup && sw.estimatedWorkingWeightKg > 0
                                    ? { ...s, weight: sw.estimatedWorkingWeightKg }
                                    : s,
                                );
                                const renamed: WorkoutExercise = {
                                  ...we,
                                  exerciseId: targetEx.id,
                                  displayNameSnapshot: targetEx.name,
                                };
                                setWorkout({
                                  ...w,
                                  exercises: w.exercises.map((item, idx) =>
                                    idx === ei
                                      ? { ...ExerciseSwap.entry(renamed, swapped.carried), sets: nextSets }
                                      : item,
                                  ),
                                });
                              }}
                            >
                              Заменить → {targetEx.name}
                              {sw.estimatedWorkingWeightKg > 0 ? ` (${fmt(sw.estimatedWorkingWeightKg)} кг)` : ""}
                            </button>
                          );
                        })}
                      </div>
                    ) : null}
                  </div>
                );
              })()}

              {renderDdpGoalLine(we, exercise, before, isLaidTopLift)}
              {renderIntraAutoregBar(we, ei, exercise, before, isLaidTopLift)}

              {cardGuidance ? (
                <LaidExerciseGuidanceBar
                  guidance={cardGuidance}
                  hasProgressionNote={!!we.progressionNote}
                  targetSetsReps={
                    isLaidTopLift && activeLaidPlan
                      ? `1×${activeLaidPlan.heavy.reps} + ${activeLaidPlan.work.sets}×${activeLaidPlan.work.reps}`
                      : !timed && plannedRange
                        ? `${we.sets.filter((s) => !s.warmup).length} × ${plannedRange}`
                        : null
                  }
                  weightHint={
                    isLaidTopLift && activeLaidPlan && activeLaidPlan.prescriptionMode === "percent_1rm"
                      ? {
                          label: `План: ${LaidDupPlan.kg(activeLaidPlan.heavy.weightKg)} / ${LaidDupPlan.kg(activeLaidPlan.work.weightKg)} кг`,
                          source: inDeload ? "deload" : "plan",
                        }
                      : noLoad || timed
                        ? null
                        : before?.working?.[0] && before.working[0].weight > 0
                          ? {
                              label: inDeload
                                ? `Разгрузка: ${LaidDupPlan.kg(Math.round(before.working[0].weight * 0.65 * 2) / 2)} кг`
                                : `Прошлый: ${LaidDupPlan.kg(before.working[0].weight)} кг`,
                              source: inDeload ? "deload" : "history",
                            }
                          : { label: "Вес: подбери по RIR", source: "none" }
                  }
                  auxProgression={auxProgression}
                  topSetPlateWeightKg={topSetPlateWeightKg}
                  onApplyAuxWeight={(nextKg) => {
                    const targetMin = we.repMin ?? we.sets.find((s) => !s.warmup)?.reps ?? 10;
                    patchExercise(ei, {
                      sets: we.sets.map((s) =>
                        s.warmup || s.done ? s : { ...s, weight: nextKg, reps: targetMin },
                      ),
                    });
                  }}
                />
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
                    aria-label={isLaidTopLift && !inDeload ? "Добавить лесенку разминки под топ-сет" : "Добавить 3 разминочных"}
                    title={
                      isLaidTopLift && !inDeload
                        ? "Прогрессивная разминка под тяжёлый топ-сет (гриф → 50 % → 70 % → 82 % → 90 %)"
                        : "Три разминочных подхода: 40 / 60 / 80% рабочего веса — проверь и поправь"
                    }
                    onClick={() =>
                      patchExercise(ei, {
                        sets: [
                          ...(isLaidTopLift && !inDeload
                            ? new WarmupPlanner(we).createForTopSet(GymInventoryStore.read().barWeightKg)
                            : new WarmupPlanner(we).create()),
                          ...we.sets,
                        ],
                      })
                    }
                  >
                    <Flame size={15} />
                    {isLaidTopLift && !inDeload ? "Разминка DUP" : "Разминка"}
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
      <WorkoutUndoDock
        dockRef={dockRef}
        draft={draft}
        removalKey={removalKey}
        restSeconds={smartRestMeta?.seconds ?? restSeconds}
        restLabel={smartRestMeta?.label}
        soundEnabled={soundEnabled}
        reducedMotion={reducedMotion}
        toastPaused={toastPaused}
        setToastPaused={setToastPaused}
        onUpdate={update}
        onUndoError={setUndoError}
        onShiftRest={shiftRest}
        onAnnounce={setAnnouncement}
      />
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
          workouts={history}
          today={w.date}
          avoidedIds={avoidedIds}
          excludeIds={w.exercises.filter((_, i) => i !== swapTarget.ei).map((e) => e.exerciseId)}
          showScopePicker
          defaultScope="today"
          onClose={() => setSwapTarget(null)}
          onSwap={() => {}}
          onSwapWithScope={(newEx, scope, avoidReason) => {
            const targetEi = swapTarget.ei;
            const target = w.exercises[targetEi];
            const oldExerciseId = target.exerciseId;
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
            // Если правило веса совпало, но пользователь ещё не вводил вес (все рабочие подходы с 0 кг и не отмечены),
            // подставляем знакомый рабочий вес нового тренажёра/упражнения из истории.
            const unstarted =
              swapped.carried &&
              previousWorking.length > 0 &&
              target.sets.every((s) => s.warmup || (!s.done && s.weight === 0));
            const finalSets = unstarted
              ? target.sets.map((s) => {
                  if (s.warmup) return s;
                  const idx = ExecutionIdentity.setIndex(target, s);
                  const prior = PreviousSets.pick(previousWorking, idx);
                  return prior
                    ? {
                        ...s,
                        ...PreviousSets.patch(prior, {
                          timed: newEx.recording.type === "duration",
                          assistance: newEx.recording.loadMode === "assisted_bodyweight",
                        }),
                      }
                    : s;
                })
              : swapped.sets;
            setWorkout({
              ...w,
              exercises: w.exercises.map((e, i) =>
                i === targetEi ? { ...ExerciseSwap.entry(renamed, swapped.carried), sets: finalSets } : e,
              ),
            });
            if (scope === "avoid") {
              avoidStore.add(oldExerciseId, avoidReason ?? "pain");
              setAvoidedIds(avoidStore.ids());
            }
            if ((scope === "block" || scope === "program" || scope === "avoid") && w.routineId && onSwapInProgram) {
              onSwapInProgram(w.routineId, oldExerciseId, newEx, scope, avoidReason);
            } else if (!swapped.carried) {
              onToast?.(
                scope === "avoid"
                  ? "Заменено и скрыто из рекомендаций (до пересмотра)"
                  : "Заменено: вес и отметки не перенесены — другое упражнение",
              );
            } else if (scope === "avoid") {
              onToast?.("Заменено: прежнее упражнение скрыто из рекомендаций");
            }
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
