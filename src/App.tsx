import MachineManager from "./components/MachineManager";
import { zoneCreditNote } from "./lib/zoneCredit";
import { quantity } from "./lib/quantity";
import { StrengthExercises } from "./domain/StrengthExercises";
import { ExecutionIdentity } from "./domain/ExecutionIdentity";
import { useRestNotifications } from "./hooks/useRestNotifications";
import RestNotificationSettings from "./components/RestNotificationSettings";
import { JournalBackup } from "./domain/JournalBackup";
import { ImportUndo, type ImportRecord } from "./domain/ImportUndo";
import { ImportUndoMessage } from "./domain/ImportUndoMessage";
import { offlineSnapshot } from "./lib/offlineSnapshot";
import { importService } from "./services/ImportService";
import { VolumeLabel } from "./domain/VolumeLabel";
import { ImportOrigin } from "./domain/ImportOrigin";
import { applyTheme, getCurrentTheme } from "./lib/theme";
import { BodyweightProvider, useBodyweight } from "./state/BodyweightContext";
import { BodyMass } from "./domain/BodyMass";
import type { TrainingMeetup } from "./domain/TrainingMeetups";
import { friendsApi } from "./services/FriendsApi";
import { LiveBroadcastPolicy, LiveStateBuilder } from "./domain/LiveSession";
import { WorkoutConflict } from "./domain/WorkoutConflict";
import { LiveFinished } from "./lib/liveFinished";
import { takeRoomInvite } from "./lib/invite";
import { useLiveBroadcast } from "./lib/useLiveBroadcast";
import { useLiveRoom } from "./components/LiveRoomProvider";
import ProgressOverview from "./components/ProgressOverview";
import MovementBalance from "./components/MovementBalance";
import ToolsHub from "./components/ToolsHub";
import {
  useCallback,
  Suspense,
  useEffect,
  useMemo,
  useState,
  useRef,
} from "react";
import {
  BarChart3,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Download,
  Dumbbell,
  History,
  House,
  Info,
  TriangleAlert,
  Play,
  Search,
  Settings2,
  Sparkles,
  Target,
  Trash2,
  TrendingUp,
  X,
  Scale,
  BatteryCharging,
  Flame,
  Smartphone,
  Zap,
  Users,
  Plus,
} from "lucide-react";
import {
  DEFAULT_SETTINGS,
  EXERCISES,
  MUSCLES,
  balanceScore,
  buildBalancePlan,
  demoWorkouts,
  estimatedOneRepMax,
  exerciseById,
  exerciseForEntry,
  entryName,
  entrySpec,
  recordingLabel,
  recordingNote,
  recordingSentence,
  recordedLoad,
  progressKey,
  fmt,
  localDate,
  browserTimeZone,
  addCalendarDays,
  makeExerciseEntry,
  makeWorkout,
  repeatWorkout,
  muscleLoad,
  anatomicalLoad,
  legacyMuscleLoad,
  volume,
  volumeSummary,
  weekStart,
  workingSets,
  type Equipment,
  type Muscle,
  type Settings,
  type Workout,
  type WorkoutExercise,
  type ProductData,
  type Routine,
  type Exercise,
  exerciseCatalog,
} from "./lib/model";
import { VolumeChart, Sparkline } from "./components/Charts";
import Modal from "./components/Modal";
import Select from "./components/Select";
import WorkoutView from "./components/WorkoutView";
import HistoryList from "./components/HistoryList";
import { MuscleCoverage } from "./domain/MuscleCoverage";
import { DateText } from "./domain/DateText";
import TrainingPlate from "./components/TrainingPlate";
import { AnimatePresence, m } from "motion/react";
import {
  AnatomyExplorer,
  ExerciseLibrary,
  ProgramsScreen,
  FriendsScreen,
  PersonalExerciseEditor,
  HistoryImporter,
  AppleHealthPanel,
  PoseAnalysisPanel,
} from "./components/chunks";
import PlateCalculator from "./components/PlateCalculator";
import OneRepMaxCalculator from "./components/OneRepMaxCalculator";
import { BodyweightModal } from "./components/BodyweightModal";
import { DeloadModal } from "./components/DeloadModal";
import { WarmupModal } from "./components/WarmupModal";
import { IosInstallPrompt } from "./components/IosInstallPrompt";
import { VolumeLandmarksModal } from "./components/VolumeLandmarksModal";
import StatsAnalytics from "./components/StatsAnalytics";
import InteractiveStrengthChart from "./components/InteractiveStrengthChart";
import ExerciseInfo from "./components/ExerciseInfo";
import WeeklyActivityBar from "./components/WeeklyActivityBar";
import {
  readDraft,
  persistDraft,
  checkpointDraft,
  elapsedMs,
  newDraft,
  type Draft,
  type PersistenceStatus,
  DRAFT_KEY,
} from "./lib/draft";
import { WorkoutSession } from "./domain/WorkoutSession";
import { api, ApiError } from "./services/ApiClient";
import { PendingWorkouts } from "./domain/PendingWorkouts";
import { TimeZoneField } from "./components/TimeZoneField";
import { DeloadPlan, type DeloadPlanRecord } from "./domain/DeloadPlan";
import { DeloadEngine } from "./domain/DeloadEngine";
import { PlanLine } from "./domain/PlanLine";
import { BackdatedWorkout } from "./domain/BackdatedWorkout";
import { DeloadHint } from "./domain/DeloadHint";
import { usePendingWorkouts } from "./hooks/usePendingWorkouts";
import { productService } from "./services/ProductService";
import { TrainingProgram, nextScheduled } from "./domain/TrainingProgram";
import { useTrainingTools } from "./lib/webmcp";
import { AccountProfileForm } from "./components/AccountProfileForm";
import type { AccountProfile } from "./lib/account";
import SessionInsights from "./components/SessionInsights";
import { saveFile } from "./lib/saveFile";
import { ProgressSeries } from "./domain/ProgressSeries";
import "./styles/progress.css";
import type { Release } from "./device/appUpdate";

type ProductView =
  "overview" | "workout" | "history" | "library" | "progress" | "programs" | "friends";
const NAV = [
  { id: "overview", label: "Сегодня", icon: House },
  { id: "programs", label: "Программы", icon: CalendarDays },
  { id: "friends", label: "Друзья", icon: Users },
  { id: "history", label: "История", icon: History },
  { id: "progress", label: "Прогресс", icon: BarChart3 },
  { id: "library", label: "Упражнения", icon: Dumbbell },
] as const;
const EQ_OPTIONS = [
  { value: "gym", label: "Весь зал" },
  { value: "dumbbells", label: "Гантели" },
  { value: "bodyweight", label: "Без оборудования" },
];
const SIDES: Record<string, string> = { both: "обе стороны", left: "левая", right: "правая" };
const dateLabel = (date: string, long = false) =>
  new Date(date + "T12:00:00").toLocaleDateString("ru-RU", {
    day: "numeric",
    month: long ? "long" : "short",
  });
type AppProps = { account: AccountProfile; onAccountChange: (p: AccountProfile) => void; onLogout: () => void };
export default function App(props:AppProps) {return <BodyweightProvider accountId={props.account.id} timeZone={props.account.timeZone}><JournalApp {...props}/></BodyweightProvider>;}

function JournalApp({ account, onAccountChange, onLogout }: AppProps) {
  const weights=useBodyweight();
  const draftKey = `tyaga-draft-account:${account.id}`;
  const live = useLiveRoom();
  // Ссылка в комнату (?r=) прочитана при загрузке страницы; здесь её только предъявляем и спрашиваем согласие.
  const [roomInvite, setRoomInvite] = useState<string | null>(() => takeRoomInvite());
  const [view, setView] = useState<ProductView>(() => (roomInvite || new URLSearchParams(location.search).has("friend") ? "friends" : "overview"));
  const [product, setProduct] = useState<ProductData>({
    routines: [],
    customExercises: [],
    favorites: [],
  });
  const [personalEditor, setPersonalEditor] = useState<Exercise | undefined>();
  const [initialRoutine, setInitialRoutine] = useState<Routine | null>(null);
  const pendingFavorites = useRef(new Set<string>());
  const [importBusy, setImportBusy] = useState(false);
  /** Журнал с сервера. На экране он слит с очередью отправки (см. `workouts` ниже). */
  const [stored, setWorkouts] = useState<Workout[]>([]);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [demo, setDemo] = useState(false);
  /** Открыто без связи: на экране копия последнего ответа сервера. */
  const [offlineData, setOfflineData] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(() => readDraft(draftKey));
  useLiveBroadcast(draft, draftKey);
  const [persistence, setPersistence] = useState<PersistenceStatus>("pending");
  const [legacyDraft, setLegacyDraft] = useState(() => readDraft(DRAFT_KEY));
  const [conflict, setConflict] = useState<{ current: Workout | null } | null>(
    null,
  );
  const [mapping, setMapping] = useState<"recorded" | "current">("recorded");
  const [hardSetsOnly, setHardSetsOnly] = useState(false);
  const [progressTab, setProgressTab] = useState<"balance" | "analytics" | "strength" | "anatomy" | "bodyweight">("analytics");
  // Отказ («сначала заверши черновик») не должен выглядеть как успех: у уведомления два тона.
  const [notice, setNotice] = useState<{ text: string; tone: "ok" | "warn" }>({ text: "", tone: "ok" });
  const toast = notice.text;
  const setToast = (text: string) => setNotice({ text, tone: "ok" });
  const warn = (text: string) => setNotice({ text, tone: "warn" });
  const [modal, setModal] = useState<
    | "machines"
    | "technique"
    | "tools"
    | "backup"
    | "rest_notifications"
    | "picker"
    | "settings"
    | "method"
    | "personal"
    | "import"
    | "profile"
    | "plate"
    | "orm"
    | "bodyweight"
    | "deload"
    | "warmup"
    | "ios_install"
    | "restore"
    | "rp_volume"
    | null
  >(null);
  const [detail, setDetail] = useState<Workout | null>(null);
  const [justSaved, setJustSaved] = useState<Workout | null>(null);
  const pending = usePendingWorkouts(
    account.id,
    (saved) => setWorkouts((ws) => [saved, ...ws.filter((w) => w.id !== saved.id)].sort((a, b) => b.date.localeCompare(a.date))),
    (text) => setNotice({ text, tone: "ok" }),
  );
  const pendingError = pending.items.find((i) => i.error)?.error ?? "";
  /** Завершённые без связи тренировки лежат в истории сразу, с меткой «Ждёт отправки». */
  const workouts = useMemo(
    () => PendingWorkouts.merge(stored, pending.items),
    [stored, pending.items],
  );
  const [deleteId, setDeleteId] = useState<string | null>(null);
  // Каталог упражнений — отдельный файл: докачиваем его, пока есть связь, чтобы «Добавить упражнение» открылось и без неё.
  useEffect(() => {
    const idle = (window as { requestIdleCallback?: (f: () => void, o?: { timeout: number }) => void }).requestIdleCallback;
    const warm = () => {
      ExerciseLibrary.preload();
      ProgramsScreen.preload();
    };
    if (idle) idle.call(window, warm, { timeout: 2000 });
    else setTimeout(warm, 1500);
  }, []);
  const importUndo = useMemo(
    () =>
      new ImportUndo(
        typeof localStorage === "undefined" ? null : localStorage,
        account.id,
      ),
    [account.id],
  );
  const [lastImport, setLastImport] = useState<ImportRecord | null>(() =>
    importUndo.read(),
  );
  const [lastImportRun, setLastImportRun] = useState<{ runId: string; at: string; total: number; activeCount: number } | null>(null);
  const [pendingImport, setPendingImport] = useState<{ runId: string; total: number } | null>(null);
  const [undoAsk, setUndoAsk] = useState(false);
  // Последняя операция, которая ничего не добавила: баннер отмены остаётся у прежнего импорта и говорит об этом.
  const [lastNoop, setLastNoop] = useState<{ at: string; kind: "import" | "restore" } | null>(null);
  const [muscleFilter, setMuscleFilter] = useState<Muscle | "all">("all");
  const [startMarking, setStartMarking] = useState(false);
  const [selectedMuscle, setSelectedMuscle] = useState<Muscle | null>(null);
  const [weekOffset, setWeekOffset] = useState(0);
  const [minutes, setMinutes] = useState(40);
  const [planEquipment, setPlanEquipment] = useState<Equipment>("gym");
  const [excluded, setExcluded] = useState<Muscle[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [progressPick, setProgressExercise] = useState<string | null>(null);
  const [settingsDraft, setSettingsDraft] =
    useState<Settings>(DEFAULT_SETTINGS);
  const [exerciseDetail, setExerciseDetail] = useState<string | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setLoadError("");
    try {
      const [data, productData] = await Promise.all([
        api<{ workouts: Workout[]; settings: Settings }>(
          "/api/data",
          "GET",
          undefined,
          signal,
        ),
        productService.read(signal),
      ]);
      if (signal?.aborted) return;
      exerciseCatalog.register([
        ...productData.customExercises,
        ...(productData.favoriteDefinitions ?? []),
        ...data.workouts.flatMap(w => w.exercises.flatMap(e => e.externalDefinition ? [e.externalDefinition] : [])),
      ]);
      setProduct(productData);
      setWorkouts(data.workouts);
      // The server receipt is authoritative. LocalStorage never grants permission
      // to delete a workout, and a lost import response still leaves a banner.
      importService.runs().then((result) => {
        setLastImportRun(result.runs[0] ?? null);
        setPendingImport(result.pending?.[0] ? { runId: result.pending[0].runId, total: result.pending[0].total } : null);
      }).catch(() => { setLastImportRun(null); setPendingImport(null); });
      setSettings({
        ...data.settings,
        timeZone: data.settings.timeZone ?? browserTimeZone(),
      });
      setPlanEquipment(data.settings.equipment);
      setDemo(false);
      setOfflineData(false);
      offlineSnapshot.saveData(account.id, {
        workouts: data.workouts,
        settings: { ...data.settings, timeZone: data.settings.timeZone ?? browserTimeZone() },
        product: productData,
      });
    } catch (e) {
      if (e instanceof Error && e.name !== "AbortError") {
        // Нет связи (не отказ сервера): показываем копию последнего ответа вместо пустого экрана.
        const copy = e instanceof ApiError || signal?.aborted ? null : offlineSnapshot.data(account.id);
        if (copy) {
          exerciseCatalog.register([
            ...copy.product.customExercises,
            ...(copy.product.favoriteDefinitions ?? []),
            ...copy.workouts.flatMap((w) => w.exercises.flatMap((x) => (x.externalDefinition ? [x.externalDefinition] : []))),
          ]);
          setProduct(copy.product);
          setWorkouts(copy.workouts);
          setSettings(copy.settings);
          setPlanEquipment(copy.settings.equipment);
          setDemo(false);
          setOfflineData(true);
        } else setLoadError(e.message);
      }
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [account.id]);
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);
  // Связь вернулась: берём свежие данные, баннер «Нет связи» уходит сам.
  useEffect(() => {
    if (!offlineData) return;
    const back = () => void load();
    window.addEventListener("online", back);
    return () => window.removeEventListener("online", back);
  }, [offlineData, load]);
  // Загрузка прошла: связь есть, отправляем то, что завершили без неё.
  const flushPending = pending.flush;
  useEffect(() => {
    if (!loading && !offlineData && !demo) void flushPending();
  }, [loading, offlineData, demo, flushPending]);
  // Копия для запуска без связи следует за журналом: сохранили, удалили, правили программу.
  useEffect(() => {
    if (loading || demo || offlineData) return;
    offlineSnapshot.saveData(account.id, { workouts: stored, settings, product });
  }, [loading, demo, offlineData, stored, settings, product, account.id]);
  const [update, setUpdate] = useState<Release | null>(null);
  const [updateProgress, setUpdateProgress] = useState<number | null>(null);
  useEffect(() => {
    // Android: look for a newer APK on launch and when the app comes back.
    if (import.meta.env.MODE !== "device") return;
    let checkedAt = 0;
    const check = () => {
      if (document.visibilityState !== "visible" || Date.now() - checkedAt < 3600000) return;
      void import("./device/appUpdate")
        .then((m) => m.findUpdate())
        .then((release) => {
          // Stamp only a finished check: opening the app without network must not
          // hide a real update for the next hour.
          checkedAt = Date.now();
          if (release) setUpdate(release);
        })
        .catch(() => {});
    };
    check();
    document.addEventListener("visibilitychange", check);
    return () => document.removeEventListener("visibilitychange", check);
  }, []);
  const installUpdate = () => {
    if (import.meta.env.MODE !== "device") return;
    setUpdateProgress(0);
    void import("./device/appUpdate")
      .then((m) => m.installUpdate(setUpdateProgress))
      .finally(() => setUpdateProgress(null));
  };
  useEffect(() => {
    // The Android app pulled changes made on another device.
    const reload = () => void load();
    window.addEventListener("tyaga:synced", reload);
    return () => window.removeEventListener("tyaga:synced", reload);
  }, [load]);
  useEffect(() => {
    try {
      setPersistence(persistDraft(localStorage, draft, draftKey));
    } catch {
      setPersistence("failed");
    }
  }, [draft, draftKey]);
  const hasDraft = !!draft;
  useEffect(() => {
    if (!hasDraft) return;
    const checkpoint = () => setDraft((d) => (d ? checkpointDraft(d) : d));
    const pause = () => {
      if (document.visibilityState === "hidden")
        setDraft((d) => (d ? checkpointDraft(d, Date.now(), true) : d));
    };
    const id = setInterval(checkpoint, 15000);
    document.addEventListener("visibilitychange", pause);
    window.addEventListener("pagehide", pause);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", pause);
      window.removeEventListener("pagehide", pause);
    };
  }, [hasDraft]);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(""), 4500);
    return () => clearTimeout(id);
  }, [toast]);
  const demoData = useMemo(
    () => demoWorkouts(new Date(), settings.timeZone),
    [settings.timeZone],
  );
  const displayed = demo ? demoData : workouts;
  const anchor = useMemo(
    () =>
      addCalendarDays(weekStart(new Date(), settings.timeZone), weekOffset * 7),
    [weekOffset, settings.timeZone],
  );
  const weekEnd = useMemo(() => addCalendarDays(anchor, 6), [anchor]);
  const weekWorkouts = useMemo(
    () => displayed.filter((w) => w.date >= anchor && w.date <= weekEnd),
    [displayed, anchor, weekEnd],
  );
  const currentWeek = useMemo(
    () =>
      displayed.filter(
        (w) =>
          w.date >= weekStart(new Date(), settings.timeZone) &&
          w.date <= localDate(new Date(), settings.timeZone),
      ),
    [displayed, settings.timeZone],
  );
  const analysisOptions = useMemo(
    () => ({ mapping, timeZone: settings.timeZone, ...(hardSetsOnly ? { maxRir: 3 } : {}) }),
    [mapping, hardSetsOnly, settings.timeZone],
  );
  // Актуальные версии «Моих» нужны каталогу до расчёта: разметка действует и на старые тренировки.
  const familyKey = useMemo(
    () => `${exerciseCatalog.adoptFamilies(product.customExercises)}:${product.customExercises.map((e) => e.id).join("|")}`,
    [product.customExercises],
  );
  const loads = useMemo(
    () => muscleLoad(weekWorkouts, settings, analysisOptions),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [weekWorkouts, settings, analysisOptions, familyKey],
  );
  const anatomy = useMemo(
    () => anatomicalLoad(weekWorkouts, analysisOptions),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [weekWorkouts, analysisOptions, familyKey],
  );
  // Все упражнения каталога без мышц, что есть в журнале: «Разметить» ведёт и к ним.
  const catalogGaps = useMemo(
    () => MuscleCoverage.catalogGaps(displayed, { timeZone: settings.timeZone }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [displayed, settings.timeZone, familyKey],
  );
  const coverage = useMemo(
    () => MuscleCoverage.report(weekWorkouts, { timeZone: settings.timeZone, ...(hardSetsOnly ? { maxRir: 3 } : {}) }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [weekWorkouts, settings.timeZone, hardSetsOnly, familyKey],
  );
  const hasLegacy = weekWorkouts.some((w) =>
    w.exercises.some((e) => (e.catalogRevision ?? 1) === 1),
  );
  const currentLoads = useMemo(
    () => muscleLoad(currentWeek, settings, { mapping }),
    [currentWeek, settings, mapping],
  );
  const realLoads = useMemo(
    () =>
      muscleLoad(
        workouts.filter(
          (w) =>
            w.date >= weekStart(new Date(), settings.timeZone) &&
            w.date <= localDate(new Date(), settings.timeZone),
        ),
        settings,
        { mapping },
      ),
    [workouts, settings, mapping],
  );
  const plan = useMemo(
    () =>
      buildBalancePlan(
        currentLoads,
        minutes,
        planEquipment,
        excluded,
        settings.restSeconds,
      ),
    [currentLoads, minutes, planEquipment, excluded, settings.restSeconds],
  );
  const today = localDate(new Date(), settings.timeZone);
  // R04-REQ02: «Применить разгрузку» — пометка на устройстве на неделю; программы не переписываются.
  const deloadStore = useMemo(() => new DeloadPlan(undefined, account.id), [account.id]);
  const [deload, setDeload] = useState<DeloadPlanRecord | null>(null);
  useEffect(() => setDeload(deloadStore.read(today)), [deloadStore, today]);
  /** Тренировка из программы: с действующей разгрузкой — с уменьшенным весом и числом подходов. */
  const programWorkout = (r: Routine) => {
    const program = new TrainingProgram(r);
    const tz = settings.timeZone ?? browserTimeZone();
    // QA-R06-02: при разгрузке вес программы берётся из неразгрузочных тренировок, а не из прошлой разгрузочной.
    const base = deload ? DeloadEngine.regular(workouts) : workouts;
    return DeloadPlan.workout(program.start(base, tz), deload, program.isDeload(workouts, today));
  };
  const nextProgramDay = useMemo(() => nextScheduled(product.routines, today), [product.routines, today]);
  const todayRoutine = product.routines.find((r) =>
    new TrainingProgram(r).scheduled(today),
  );
  // Preview only; starting builds a fresh workout so ids never repeat.
  const todayPlan = useMemo(
    () =>
      todayRoutine
        ? DeloadPlan.workout(
            new TrainingProgram(todayRoutine).start(deload ? DeloadEngine.regular(workouts) : workouts, settings.timeZone ?? browserTimeZone()),
            deload,
            new TrainingProgram(todayRoutine).isDeload(workouts, today),
          )
        : null,
    [todayRoutine, workouts, settings.timeZone, deload, today],
  );
  const todaySources = useMemo(
    () =>
      todayRoutine
        ? new TrainingProgram(todayRoutine).weightSources(
            workouts,
            settings.timeZone ?? browserTimeZone(),
            today,
          )
        : [],
    [todayRoutine, workouts, settings.timeZone, today],
  );
  const weekDone = currentLoads.reduce((n, m) => n + Math.min(m.total, m.goal), 0);
  const weekGoal = currentLoads.reduce((n, m) => n + m.goal, 0);
  const weekNote = zoneCreditNote(weekDone, workingSets(currentWeek));
  const zonesNote = zoneCreditNote(
    loads.reduce((n, m) => n + Math.min(m.total, m.goal), 0),
    workingSets(weekWorkouts),
  );
  const currentLagging = [...currentLoads]
    .sort((a, b) => a.ratio - b.ratio)
    .filter((m) => m.ratio < 0.8);
  const lagging = currentLagging.filter((m) => m.ratio < 0.5).slice(0, 3);
  const monthWorkouts = displayed.filter((w) => {
    const today = localDate(new Date(), settings.timeZone);
    return w.date >= addCalendarDays(today, -27) && w.date <= today;
  });
  const go = (v: ProductView) => {
    setView(v);
    window.scrollTo({ top: 0, behavior: "instant" });
  };
  const unmarkedNote = coverage.sets ? (
    <p className="zones-unmarked" role="status">
      <b>
        Не учтено: {quantity(coverage.exercises, "упражнение", "упражнения", "упражнений")},{" "}
        {quantity(coverage.sets, "подход", "подхода", "подходов")}
      </b>{" "}
      — у них нет разметки мышц, поэтому группы ниже занижены
      {coverage.items.length ? ` (${coverage.items.slice(0, 3).map((i) => i.name).join(", ")}${coverage.items.length > 3 ? "…" : ""})` : ""}.
      <button
        type="button"
        className="text-button"
        onClick={() => {
          setMuscleFilter("all");
          setStartMarking(true);
          go("library");
        }}
      >
        Разметить
      </button>
    </p>
  ) : null;
  useEffect(() => {
    if (view !== "library") setStartMarking(false);
  }, [view]);
  const markExercises = (saved: Exercise[]) => {
    exerciseCatalog.register(saved);
    setProduct((p) => {
      const families = new Set(saved.map((e) => e.custom?.familyId));
      const oldIds = p.customExercises.filter((e) => families.has(e.custom?.familyId)).map((e) => e.id);
      const favored = new Set(p.favorites.filter((id) => oldIds.includes(id)));
      const nextFavorite = saved.filter((e) => p.customExercises.some((o) => o.custom?.familyId === e.custom?.familyId && favored.has(o.id))).map((e) => e.id);
      return {
        ...p,
        customExercises: [...saved, ...p.customExercises.filter((e) => !oldIds.includes(e.id))],
        favorites: [...p.favorites.filter((id) => !oldIds.includes(id)), ...nextFavorite],
      };
    });
  };
  // Android's back button (and the browser's) closes the top layer first;
  // from Today with nothing open it leaves the app.
  const layered =
    view !== "overview" ||
    !!(modal || detail || exerciseDetail || deleteId || (conflict && draft));
  const backEntry = useRef(false);
  const [backPops, setBackPops] = useState(0);
  useEffect(() => {
    if (!layered || backEntry.current) return;
    history.pushState({ tyagaBack: true }, "");
    backEntry.current = true;
  }, [layered, backPops]);
  const closeTop = useRef(() => {});
  closeTop.current = () => {
    if (conflict && draft) setConflict(null);
    else if (exerciseDetail) setExerciseDetail(null);
    else if (deleteId) setDeleteId(null);
    else if (detail) setDetail(null);
    else if (modal && !((modal === "import" || modal === "restore") && importBusy)) setModal(null);
    else if (view !== "overview") go("overview");
  };
  useEffect(() => {
    const onPop = () => {
      backEntry.current = false;
      closeTop.current();
      setBackPops((n) => n + 1);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const restNotification=useRestNotifications(account.id,draft,setDraft,()=>go("workout"),view==="workout");
  const start = (ids: string[] = [], name?: string, template?: Workout, retro = false) => {
    if (draft) {
      go("workout");
      warn("У тебя уже есть черновик. Продолжи или отмени его.");
      setModal(null);
      return;
    }
    const workout = template ?? makeWorkout(ids, DeloadEngine.regular(workouts), settings.timeZone, true);
    workout.exercises = BodyMass.workout(workout, weights.massAt(workout.date,account.bodyMassKg)).exercises;
    if (name) workout.name = name;
    setDraft({ ...newDraft(workout), ...(retro ? { retro: true } : {}) });
    setConflict(null);
    setDemo(false);
    setSaveError("");
    setModal(null);
    go("workout");
  };
  const addExercise = (id: string) => {
    if (!draft) {
      start([id]);
      return;
    }
    if (
      draft.workout.exercises.some((e) => e.exerciseId === id) ||
      draft.workout.exercises.length >= 30
    )
      return;
    setDraft((d) =>
      d
        ? {
            ...d,
            workout: new WorkoutSession(d.workout).add(
              BodyMass.entry(makeExerciseEntry(id, DeloadEngine.isDeloadName(d.workout.name) ? workouts : DeloadEngine.regular(workouts), d.workout.date, settings.timeZone, true), weights.massAt(d.workout.date, account.bodyMassKg)),
            ),
          }
        : null,
    );
  };
  const favoriteExercise = async (id: string) => {
    if (pendingFavorites.current.has(id)) return;
    pendingFavorites.current.add(id);
    const add = !product.favorites.includes(id);
    setProduct((p) => ({
      ...p,
      favorites: add
        ? [...p.favorites, id]
        : p.favorites.filter((x) => x !== id),
    }));
    try {
      await productService.favorite(id, add);
    } catch (e) {
      setProduct((p) => ({
        ...p,
        favorites: add
          ? p.favorites.filter((x) => x !== id)
          : [...p.favorites, id],
      }));
      setToast(
        e instanceof Error ? e.message : "Не удалось обновить избранное",
      );
    } finally {
      pendingFavorites.current.delete(id);
    }
  };
  const saveRoutine = async (routine: Routine) => {
    const result = await productService.saveRoutine(routine);
    setProduct((p) => ({
      ...p,
      routines: [
        result.routine,
        ...p.routines.filter((r) => r.id !== result.routine.id),
      ],
    }));
    setToast("Программа сохранена");
    return result.routine;
  };
  const deleteRoutine = async (routine: Routine) => {
    await productService.deleteRoutine(routine);
    setProduct((p) => ({
      ...p,
      routines: p.routines.filter((r) => r.id !== routine.id),
    }));
    setToast("Программа удалена");
  };
  const createPersonal = () => {
    setPersonalEditor(undefined);
    setModal("personal");
  };
  const editPersonal = (exercise: Exercise) => {
    setPersonalEditor(exercise);
    setModal("personal");
  };
  const openPicker = () => {
    if (!draft) start();
    setMuscleFilter("all");
    setModal("picker");
  };
  const startMeetup = (meetup:TrainingMeetup) => {
    if(draft){go("workout");warn("Сначала заверши или отмени текущую тренировку.");return;}
    const workout=makeWorkout([],workouts,settings.timeZone,true);workout.name=meetup.name;
    const gym=meetup.participants.find(p=>p.id===account.id)?.gym ?? (meetup.hostId===account.id?meetup.gym:"");
    setDraft({...newDraft(workout),meetupId:meetup.id,meetupGym:gym});go("workout");
    void friendsApi.request("/api/friends/status","PUT",{inGym:true,gym,focus:meetup.name}).catch(()=>setToast("Тренировка начата. Статус зала не обновился — проверь связь."));
  };
  // Новая тренировка без выполненных подходов закрывается сразу, с подходами спрашивает WorkoutView один раз.
  const discardDraft = () => {
    setDraft(null);
    setConflict(null);
    setSaveError("");
    setModal(null);
    go("overview");
  };
  const saveWorkout = async () => {
    if (!draft || saving) return;
    setSaving(true);
    setSaveError("");
    if (!new WorkoutSession(draft.workout).completedWorkingSets) {
      setSaveError("Отметь хотя бы один выполненный рабочий подход.");
      setSaving(false);
      return;
    }
    const { workout: performed, removed } = new WorkoutSession(draft.workout).withoutUnperformed();
    const workout = new WorkoutSession(performed).completedWithDuration(
      BackdatedWorkout.manualDuration(draft, settings.timeZone)
        ? draft.workout.duration
        : Math.floor(elapsedMs(draft) / 60000),
    );
    // Freeze completion time before sending. A retry after a lost response reuses
    // the same payload instead of changing its duration while the request waits.
    setDraft({
      ...checkpointDraft(draft, Date.now(), true),
      workout,
      manualDuration: true,
    });
    try {
      let result: { workout: Workout };
      try {
        result = await api<{ workout: Workout }>("/api/workouts", "PUT", workout);
      } catch (e) {
        if (PendingWorkouts.isRetryable(e) && pending.enqueue(workout)) {
          // Нет связи: тренировка не черновик и не потеряна — лежит в истории и уйдёт сама.
          persistDraft(localStorage, null, draftKey); // сразу, не дожидаясь эффекта: перезагрузка не вернёт черновик
          setDraft(null);
          setConflict(null);
          setSaveError("");
          go("history");
          warn("Нет связи: тренировка сохранена на устройстве и ждёт отправки. Уйдёт сама, когда появится связь.");
          return;
        }
        throw e;
      }
      pending.queue.remove(workout.id);
      pending.sync();
      persistDraft(localStorage, null, draftKey); // сразу: перезагрузка сразу после «Завершить» не вернёт готовую тренировку черновиком
      setWorkouts((ws) =>
        [result.workout, ...ws.filter((w) => w.id !== result.workout.id)].sort(
          (a, b) => b.date.localeCompare(a.date),
        ),
      );
      setDraft(null);
      setConflict(null);
      setDemo(false);
      setJustSaved(result.workout);
      // Напарники по комнате видят итог сразу. Правка старой тренировки в комнату не попадает.
      if (!draft.editing) {
        LiveFinished.write(account.id, result.workout.id);
        live.finish(LiveStateBuilder.fromWorkout(result.workout, { now: Date.now(), nameOf: entryName, finished: true }));
      } else {
        // R09-REQ01: правка той самой тренировки, что завершена в комнате, пересчитывает «Закончил · N т»; во время правки и при правке любой другой записи комната не меняется.
        const next = LiveBroadcastPolicy.afterEdit(live.room?.members.find((m) => m.isMe), result.workout, LiveFinished.read(account.id), Date.now(), entryName);
        if (next) live.finish(next);
      }
      if(draft.meetupId && !draft.editing) {
        const meetupId=draft.meetupId,gym=draft.meetupGym??"";
        void (async()=>{
          if(import.meta.env.MODE === "device")await (await import("./device/cloudSync")).syncCloud();
          await friendsApi.request(`/api/friends/meetups/${meetupId}`,"PUT",{action:"finish",workoutId:result.workout.id,gym});
          setToast("Тренировка сохранена, общий итог обновлён");
        })().catch(()=>setToast("Тренировка сохранена. Добавь общий итог в разделе друзей, когда появится связь."));
      }
      go("history");
      const savedText = draft.editing ? "Изменения сохранены" : "Тренировка сохранена";
      setToast(
        removed
          ? `${savedText} · убрано ${quantity(removed, "упражнение", "упражнения", "упражнений")} без подходов`
          : savedText,
      );
    } catch (e) {
      if (e instanceof ApiError && e.status === 409)
        setConflict({ current: e.data.current ?? null });
      setSaveError(e instanceof Error ? e.message : "Ошибка сохранения");
    } finally {
      setSaving(false);
    }
  };
  const editWorkout = (w: Workout) => {
    if (demo) return;
    if (pending.ids.has(w.id)) {
      setDetail(null);
      warn("Тренировка ещё не отправлена. Править её можно после отправки.");
      return;
    }
    if (draft) {
      setDetail(null);
      go("workout");
      warn("Сначала заверши или отмени текущий черновик.");
      return;
    }
    setDraft(newDraft(structuredClone(w), true));
    setConflict(null);
    setSaveError("");
    setDetail(null);
    go("workout");
  };
  const deleteWorkout = async () => {
    if (!deleteId || saving) return;
    if (pending.ids.has(deleteId)) {
      // Ещё не на сервере: удалять там нечего, снимаем с очереди.
      pending.queue.remove(deleteId);
      pending.sync();
      setDeleteId(null);
      setDetail(null);
      setToast("Тренировка удалена");
      return;
    }
    setSaving(true);
    try {
      await api("/api/workouts/" + encodeURIComponent(deleteId), "DELETE", {
        revision: workouts.find((w) => w.id === deleteId)?.revision ?? 0,
      });
      setWorkouts((ws) => ws.filter((w) => w.id !== deleteId));
      setDeleteId(null);
      setDetail(null);
      setToast("Тренировка удалена");
    } catch (e) {
      if (e instanceof ApiError && e.status === 409 && e.data.current) {
        const current = e.data.current;
        setWorkouts((ws) => ws.map((w) => (w.id === current.id ? current : w)));
        setDetail(current);
        setDeleteId(null);
      }
      setToast(e instanceof Error ? e.message : "Ошибка удаления");
    } finally {
      setSaving(false);
    }
  };
  const undoImport = async (run: string | undefined) => {
    if (!run || saving) return;
    setSaving(true);
    try {
      const result = await importService.undo(run);
      // Черновик и записанный импорт могут жить одновременно: убираем только тот, что отменён.
      if (run === lastImportRun?.runId) {
        importUndo.clear();
        setLastImport(null);
        setLastImportRun(null);
        setLastNoop(null);
      }
      if (run === pendingImport?.runId) setPendingImport(null);
      setUndoAsk(false);
      await load();
      setToast(ImportUndoMessage.describe(result));
    } catch (e) {
      await load().catch(() => undefined);
      warn(e instanceof Error ? `Не удалось отменить импорт: ${e.message}. Нажми ещё раз.` : "Не удалось отменить импорт");
    } finally {
      setSaving(false);
    }
  };
  const exportHistory = () =>
    saveFile(
      `tyaga-${localDate()}.json`,
      JSON.stringify(
        JournalBackup.create(workouts,settings,product,{entries:weights.tracker.getEntries(),goal:weights.tracker.getGoal()},getCurrentTheme(),{displayName:account.displayName,timeZone:account.timeZone,bodyMassKg:weights.massAt(localDate(new Date(),account.timeZone),account.bodyMassKg)}),
        null,
        2,
      ),
    ).then(
      () => setToast("Твои данные выгружены. Примеры в файл не входят."),
      (e) => setToast(e instanceof Error ? e.message : "Не удалось сохранить файл"),
    );
  const saveSettings = async () => {
    setSaving(true);
    setSaveError("");
    try {
      const result = await api<{ settings: Settings }>(
        "/api/settings",
        "PUT",
        settingsDraft,
      );
      setSettings(result.settings);
      setPlanEquipment(result.settings.equipment);
      setModal(null);
      setToast("Ориентиры обновлены");
    } catch (e) {
      if (e instanceof ApiError && e.status === 409 && e.data.settings)
        setSettings(e.data.settings);
      setSaveError(e instanceof Error ? e.message : "Ошибка сохранения");
    } finally {
      setSaving(false);
    }
  };
  const openSettings = () => {
    setSettingsDraft(structuredClone(settings));
    setSaveError("");
    setModal("settings");
  };
  const exportDraft = () => {
    if (draft) void saveFile("tyaga-draft.json", JSON.stringify(draft, null, 2));
  };
  // Только то, что делал: свежие и частые первыми; без истории — один жим лёжа, чтобы экран не был пустым.
  const strengthRows = StrengthExercises.list(displayed);
  const progressOptions = strengthRows.length
    ? strengthRows
    : [{ ...entrySpec("bench"), sets: [] } as WorkoutExercise].map((we) => ({ key: progressKey(we), we }));
  const progressExercise =
    progressPick && progressOptions.some((o) => o.key === progressPick) ? progressPick : progressOptions[0].key;
  const progressEntry = progressOptions.find((o) => o.key === progressExercise)
    ?.we ?? { ...entrySpec("bench"), sets: [] };
  const progressSpec = exerciseForEntry(progressEntry)!.recording;
  const progressPoints = ProgressSeries.strength(displayed, progressExercise, { timeZone: settings.timeZone });
  const progressMetric = ProgressSeries.metric(progressEntry);
  const progressBest = ProgressSeries.best(progressPoints, progressMetric.lowerIsBetter);
  const lastProgress = progressPoints.at(-1);
  const firstProgress = progressPoints[0];
  useTrainingTools({
    draft,
    workouts,
    loads: realLoads,
    settings,
    stage: (workout) => {
      setDraft(newDraft(workout));
      setDemo(false);
      setView("workout");
    },
  });

  const exerciseCards = (picker = false) => (
    <Suspense
      fallback={
        <div className="catalog-loading" role="status">
          Открываем библиотеку…
        </div>
      }
    >
      <ExerciseLibrary
        picker={picker}
        onAdd={addExercise}
        onDetail={setExerciseDetail}
        selectedIds={draft?.workout.exercises.map((e) => e.exerciseId) ?? []}
        limitReached={(draft?.workout.exercises.length ?? 0) >= 30}
        defaultMuscle={muscleFilter}
        personal={product.customExercises}
        favorites={product.favorites}
        onFavorite={(id) => void favoriteExercise(id)}
        onCreate={createPersonal}
        onEdit={editPersonal}
        onMarked={markExercises}
        catalogGaps={catalogGaps}
        startMarking={startMarking && !picker}
      />
    </Suspense>
  );
  const currentYear = localDate(new Date(), settings.timeZone).slice(0, 4);
  const sessionItem = (w: Workout, expanded = false) => {
    const tonnage = volumeSummary([w], "all");
    return (
    <button className="session-item" key={w.id} onClick={() => setDetail(w)}>
      <div className="session-date">
        <b>{new Date(w.date + "T12:00:00").getDate()}</b>
        <span>
          {DateText.monthShort(w.date)}
        </span>
        {w.date.slice(0, 4) !== currentYear ? <small className="session-year">{w.date.slice(0, 4)}</small> : null}
      </div>
      <div className="session-item-info">
        <h3>{w.name}{pending.ids.has(w.id) ? <span className="pending-badge">Ждёт отправки</span> : null}</h3>
        <p>
          {w.exercises.length} упр. <span>·</span> {workingSets([w])} подх.{" "}
          {expanded ? (
            <>
              <span>·</span>
              {w.exercises
                .slice(0, 2)
                .map((e) => entryName(e))
                .join(", ")}
            </>
          ) : null}
        </p>
      </div>
      <div className="session-item-value">
        <b
          title={
            tonnage.total > 0
              ? "Только однозначно записанные свободные веса"
              : VolumeLabel.reason(tonnage.omittedSets)
          }
        >
          {VolumeLabel.short(tonnage.total)}
        </b>
        {VolumeLabel.caption(tonnage.total, tonnage.omittedSets) ? (
          <small className="volume-none">
            {VolumeLabel.caption(tonnage.total, tonnage.omittedSets)}
          </small>
        ) : null}
        <span>
          <Clock3 size={13} />
          {w.duration} мин
        </span>
      </div>
      <ChevronRight size={17} className="muted" />
    </button>
    );
  };

  return (
    <div className={`app-shell ${view === "workout" && draft ? "in-workout" : ""} ${draft && view !== "workout" && view !== "overview" ? "has-resume" : ""}`}>
      <aside className="sidebar">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            go("overview");
          }}
        >
          тяга<span className="brand-period">.</span>
          <span className="brand-tagline">Силовой журнал</span>
        </a>
        <nav aria-label="Основная навигация">
          {NAV.map((n) => (
            <button
              className={`nav-item ${view === n.id ? "active" : ""}`}
              key={n.id}
              onClick={() => go(n.id)}
              aria-current={view === n.id ? "page" : undefined}
            >
              <n.icon size={22} />
              <span>{n.label}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <button className="nav-item" onClick={()=>setModal("tools")}>
            <Settings2 size={19} />
            Инструменты
          </button>
          <button className="profile-button" onClick={() => setModal("profile")}>
            <span className="profile-avatar">{account.displayName.slice(0, 1).toUpperCase()}</span>
            <span>
              <b>{account.displayName}</b>
              <small>Профиль</small>
            </span>
          </button>
        </div>
      </aside>
      <main className="main-content">
        <m.div
          className="page-content"
          key={view}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
        >
          {update && view !== "workout" ? (
            <div className="update-banner" role="status">
              <Download size={18} />
              <span>
                <b>Вышла версия {update.versionName}</b>
                Тренировки и настройки останутся на месте.
              </span>
              <button
                className="button primary"
                disabled={updateProgress !== null}
                onClick={installUpdate}
              >
                {updateProgress === null ? "Установить" : `${updateProgress}%`}
              </button>
              <button
                className="icon-button"
                aria-label="Напомнить позже"
                onClick={() => setUpdate(null)}
              >
                <X size={18} />
              </button>
            </div>
          ) : null}
          {persistence === "failed" && !draft ? (
            <div className="error-banner" role="alert">
              <Info size={18} />
              <span>
                Не удалось удалить локальный черновик. Сохранённая история на
                месте; проверь черновик после перезапуска.
              </span>
            </div>
          ) : null}
          {offlineData ? (
            <div className="offline-banner" role="status">
              <Info size={18} />
              <span>
                Нет связи: показаны данные с этого устройства.
                {draft ? " Начатая тренировка хранится на устройстве; нажми «Завершить» — без связи она встанет в очередь и уйдёт сама." : ""}
              </span>
              <button className="text-button" onClick={() => void load()}>
                Обновить
              </button>
            </div>
          ) : null}
          {pending.items.length ? (
            <div className={pendingError ? "error-banner pending-banner" : "offline-banner pending-banner"} role="status">
              <Info size={18} />
              <span>
                {pending.items.length === 1 ? "Ждёт отправки: 1 тренировка." : `Ждут отправки: ${pending.items.length}.`}{" "}
                {pendingError
                  ? `Сервер не принял: ${pendingError.replace(/[.\s]+$/, "")}. Тренировка осталась на устройстве.`
                  : "Она сохранена на устройстве и уйдёт сама, когда появится связь."}
              </span>
              <button className="text-button" disabled={saving} onClick={() => void pending.flush(true)}>
                Отправить сейчас
              </button>
            </div>
          ) : null}
          {loadError ? (
            <div className="error-banner" role="alert">
              <Info size={18} />
              <span>{loadError}</span>
              <button className="text-button" onClick={() => void load()}>
                Повторить
              </button>
            </div>
          ) : null}
          {loading ? (
            <div className="loading-state" role="status">
              <span className="loader" />
              Загружаем твой журнал…
            </div>
          ) : (
            <>
              {demo && view !== "workout" ? (
                <div className="demo-banner">
                  <span>
                    <Sparkles size={16} />
                    <b>Пример данных</b>
                    <span className="demo-explanation">
                      Так будет выглядеть твой прогресс. Эти тренировки не
                      сохранены.
                    </span>
                  </span>
                  <button onClick={() => setDemo(false)}>
                    Мои данные
                    <X size={14} />
                  </button>
                </div>
              ) : null}
              {!draft && legacyDraft && <div className="intro-banner"><Dumbbell size={18} /><span>На устройстве есть черновик прежней версии.</span><button className="text-button" onClick={()=> {
                setDraft(legacyDraft); setLegacyDraft(null); setDemo(false); go("workout");
                try { if(persistDraft(localStorage,legacyDraft,draftKey) === "saved") localStorage.removeItem(DRAFT_KEY); } catch { /* The old draft remains available if storage is blocked. */ }
              }}>Продолжить старый черновик</button></div>}
              {view === "overview" ? (
                <>
                  <header className="today-head">
                    <div>
                      <span className="today-date">
                        {new Date().toLocaleDateString("ru-RU", {
                          weekday: "long",
                          day: "numeric",
                          month: "long",
                          timeZone: settings.timeZone,
                        })}
                      </span>
                      <h1>Сегодня</h1>
                    </div>
                    <button
                      className="avatar-button"
                      aria-label="Мой профиль"
                      onClick={() => setModal("profile")}
                    >
                      {account.displayName.slice(0, 1).toUpperCase()}
                    </button>
                  </header>
                  <div className="today-dashboard">
                  <section className="plan-card training-hero" aria-labelledby="plan-title">
                    <div className="plan-main">
                    <span className="eyebrow">
                      {draft
                        ? "ТРЕНИРОВКА ИДЁТ"
                        : todayPlan
                          ? "СЕГОДНЯ ПО ПРОГРАММЕ"
                          : product.routines.length
                            ? "ПО ПРОГРАММЕ СЕГОДНЯ ОТДЫХ"
                            : "ТРЕНИРОВКА"}
                    </span>
                    <h2 id="plan-title">
                      {draft
                        ? draft.workout.name
                        : todayPlan
                          ? todayPlan.name
                          : displayed.length
                            ? "Свободная тренировка"
                            : "Первая тренировка"}
                    </h2>
                    <p className="plan-meta">
                      {draft
                        ? `${draft.workout.exercises.length} упр. · ${workingSets([draft.workout])} раб. подх. сделано`
                        : todayPlan
                          ? `${todayPlan.exercises.length} упр. · ${todayPlan.exercises.reduce((n, e) => n + e.sets.filter((s) => !s.warmup).length, 0)} подх.`
                          : "Записывай подходы — веса и прогресс посчитаем сами."}
                    </p>
                    {!todayPlan && !draft && nextProgramDay ? (
                      <button className="plan-next" onClick={() => go("programs")}>
                        <span>Следующая:</span> {nextProgramDay.dayName} · {nextProgramDay.routine.name}
                        <ChevronRight size={16} />
                      </button>
                    ) : null}
                    {todayPlan && !draft ? (
                      <ul className="plan-exercises">
                        {todayPlan.exercises.slice(0, 4).map((e, i) => (
                          <li key={e.exerciseId}>
                            <span>{entryName(e)}</span>
                            <b>
                              {PlanLine.sets(e)}
                              {e.sets.find((s) => !s.warmup)?.weight ? ` · ${fmt(e.sets.find((s) => !s.warmup)!.weight)} кг` : ""}
                              {e.sets.find((s) => !s.warmup)?.weight ? (
                                <small className="plan-source">
                                  {todaySources[i] === "history" ? "вес из истории" : "по плану"}
                                </small>
                              ) : null}
                            </b>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    <button
                      className="button primary plan-start"
                      onClick={() =>
                        draft
                          ? go("workout")
                          : todayRoutine
                            ? start(
                                [],
                                undefined,
                                programWorkout(todayRoutine),
                              )
                            : start()
                      }
                    >
                      <Play size={18} />
                      {draft ? "Продолжить тренировку" : "Начать тренировку"}
                    </button>
                    <div className="plan-links">
                      {todayRoutine && !draft ? (
                        <button className="text-button" onClick={() => start()}>
                          Пустая тренировка
                        </button>
                      ) : null}
                      <button className="text-button" onClick={() => go("programs")}>
                        Программы
                      </button>
                    </div>
                    {!draft && DeloadHint.line(deload, today) ? <p className="deload-line">{DeloadHint.line(deload, today)}</p> : null}
                    </div>
                    <div className="plan-art" aria-hidden="true">
                      <TrainingPlate />
                    </div>
                  </section>
                  <WeeklyActivityBar workouts={workouts} timeZone={settings.timeZone} />
                  <button className="week-summary" onClick={() => go("progress")}>
                    <span className="week-summary-head">
                      <b>Нагрузка за неделю</b>
                      <span>
                        <strong>{fmt(weekDone)}</strong> / {weekGoal} зачтено зонам
                      </span>
                    </span>
                    {weekNote ? <span className="week-summary-note">{weekNote}</span> : null}
                    <span className="meter" aria-hidden="true">
                      <span style={{ width: `${weekGoal ? Math.min(100, (100 * weekDone) / weekGoal) : 0}%` }} />
                    </span>
                    <span className="week-summary-foot">
                      {lagging.length
                        ? `Ниже твоей цели: ${lagging.map((m) => m.short.toLowerCase()).join(", ")}`
                        : "Все зоны в работе — так держать"}
                      <ChevronRight size={18} />
                    </span>
                  </button>
                  </div>
                  <section className="daily-shortcuts" aria-label="Быстрые действия">
                    <button onClick={()=>setModal("bodyweight")}><Scale size={21}/><span><b>Вес тела и тренд</b><small>Записать взвешивание</small></span><ChevronRight size={17}/></button>
                    <button onClick={()=>setModal("tools")}><Settings2 size={21}/><span><b>Инструменты</b><small>Калькуляторы и настройки</small></span><ChevronRight size={17}/></button>
                  </section>
                  <section className="recent-panel" aria-labelledby="recent-title">
                    <div className="section-head">
                      <h2 id="recent-title">Последние тренировки</h2>
                      {displayed.length ? (
                        <button className="text-button" onClick={() => go("history")}>
                          Все
                        </button>
                      ) : null}
                    </div>
                    {displayed.slice(0, 2).map((w) => sessionItem(w))}
                    {!displayed.length ? (
                      <p className="small-empty">Первый подход — начало истории.</p>
                    ) : null}
                  </section>
                </>
              ) : null}
              {view === "workout" ? (
                <WorkoutView
                  deloadMode={deload?.mode}
                  deloadPlan={deload}
                  focusRequest={restNotification.focus}
                  notificationError={restNotification.error}
                  draft={draft}
                  update={setDraft}
                  settings={settings}
                  history={workouts}
                  machines={product.machines ?? []}
                  onMachines={()=>setModal("machines")}
                  saving={saving}
                  error={saveError}
                  persistence={persistence}
                  onExport={exportDraft}
                  onPick={openPicker}
                  onSave={() => void saveWorkout()}
                  onDiscard={discardDraft}
                  onMinimize={() => go("overview")}
                  onOpenTogether={() => go("friends")}
                  onToast={setToast}
                />
              ) : null}
              {view === "history" ? (
                <>
                  <header className="screen-head history-head">
                    <h1>История тренировок</h1>
                  </header>
                  {pendingImport ? (
                    <section className="import-undo panel" role="status">
                      <p><b>Импорт не завершён · {pendingImport.total} тренировок ещё не записаны</b>
                        <small>Если запись оборвалась, открой тот же файл и повтори импорт с теми же ответами. До завершения тренировки в Истории не появляются. Этот черновик можно отменить.</small>
                      </p>
                      <div>
                        <button className="button secondary" onClick={() => setModal("import")}>Продолжить импорт</button>
                        <button className="button danger" disabled={saving} onClick={() => void undoImport(pendingImport.runId)}>Убрать черновик</button>
                      </div>
                    </section>
                  ) : null}
                  {justSaved && (
                    <SessionInsights
                      workout={justSaved}
                      settings={settings}
                      account={account}
                    />
                  )}
                  {lastImportRun ? (() => {
                    const when = DateText.moment(lastImportRun.at, settings.timeZone, currentYear);
                    const restored = lastImport?.kind === "restore";
                    const noun = restored ? "Восстановление" : "Импорт";
                    const scope = `${quantity(lastImportRun.activeCount, "тренировку", "тренировки", "тренировок")}, добавленных ${when}`;
                    return (
                    <section className={`import-undo panel${undoAsk ? "" : " import-undo-compact"}`} role="status" aria-label="Последний импорт">
                      <div className="import-undo-text">
                        <b>{noun}: записано {lastImportRun.activeCount} из {lastImportRun.total}</b>
                        <small className="import-undo-scope">
                          Отмена удалит {scope}.{restored ? " Программы, свои упражнения, избранное и вес останутся." : ""}
                        </small>
                        {lastNoop ? (
                          <small className="import-undo-noop">
                            {lastNoop.kind === "restore" ? "Восстановление" : "Импорт"} {DateText.moment(lastNoop.at, settings.timeZone, currentYear)} ничего не добавил{lastNoop.kind === "restore" ? "о" : ""} — отмена относится к {restored ? "восстановлению" : "импорту"} от {when}.
                          </small>
                        ) : null}
                        <details className="import-undo-more">
                          <summary>Как работает отмена</summary>
                          <small>Убираются только записи этого импорта, которые ты не менял. Твои правки и тренировки с других устройств остаются.</small>
                        </details>
                      </div>
                      {undoAsk ? (
                        <div>
                          <p className="import-undo-confirm"><b>Удалить {scope}?</b> Вернуть их можно только повторным импортом файла.</p>
                          <button className="button danger" disabled={saving} onClick={() => void undoImport(lastImportRun.runId)}>
                            Убрать {lastImportRun.activeCount}
                          </button>
                          <button className="button secondary" onClick={() => setUndoAsk(false)}>Не надо</button>
                        </div>
                      ) : (
                        <div className="import-undo-actions">
                          <button className="button secondary" onClick={() => setUndoAsk(true)}>{restored ? "Отменить восстановление" : "Отменить импорт"}</button>
                          <button className="text-button" onClick={() => setLastImportRun(null)}>Скрыть</button>
                        </div>
                      )}
                    </section>
                    );
                  })() : null}
                  {monthWorkouts.length ? (
                    // R06-REQ05: «Объём за 28 дней» — над списком одной строкой, график раскрывается касанием.
                    <details className="panel volume-panel volume-fold">
                      <summary>
                        <span>
                          <b>Объём за 28 дней</b>
                          <small>Свободные веса, включая разминку</small>
                        </span>
                        <b
                          className="volume-total"
                          title={VolumeLabel.reason(volumeSummary(monthWorkouts, "all").omittedSets)}
                        >
                          {VolumeLabel.short(volumeSummary(monthWorkouts, "all").total)}
                        </b>
                      </summary>
                      <VolumeChart workouts={monthWorkouts} timeZone={settings.timeZone} />
                    </details>
                  ) : null}
                  <HistoryList
                    workouts={displayed}
                    entryName={entryName}
                    renderItem={(w) => sessionItem(w, true)}
                    actions={
                      <>
                        {/* R08-REQ04: вход «Записать тренировку» (задним числом) и при непустой истории; на пустой он в самой заглушке. */}
                        {workouts.length ? (
                          <button className="button secondary" onClick={() => start([], undefined, undefined, true)}>
                            <Plus size={17} />
                            Записать тренировку
                          </button>
                        ) : null}
                        <button className="button secondary" onClick={() => void exportHistory()}>
                          <Download size={17} />
                          Экспорт JSON
                        </button>
                        <button className="button secondary" onClick={() => setModal("import")}>
                          Импорт истории
                        </button>
                      </>
                    }
                    empty={
                      <div className="empty-state">
                        <History size={36} />
                        <h2>История начинается сегодня</h2>
                        <p>Завершённая тренировка появится здесь.</p>
                        <button className="button primary" onClick={() => start([], undefined, undefined, true)}>
                          Записать тренировку
                        </button>
                      </div>
                    }
                  />
                </>
              ) : null}
              {view === "progress" ? (
                <>
                  <header className="screen-head progress-screen-head">
                    <div><span className="eyebrow">ТВОЯ РАБОТА В ЦИФРАХ</span><h1>Прогресс</h1><p>Нагрузка, сила и вес — каждый показатель на своём месте.</p></div>
                    <div className="screen-actions">
                      <button
                        className="icon-button"
                        aria-label="Как считаем"
                        onClick={() => setModal("method")}
                      >
                        <Info size={20} />
                      </button>
                      <button
                        className="icon-button"
                        aria-label="Настройки целей"
                        onClick={openSettings}
                      >
                        <Settings2 size={20} />
                      </button>
                    </div>
                  </header>
                  <div className="tabs progress-tabs" role="tablist" aria-label="Раздел прогресса">
                    {(
                      [
                        ["analytics", "Обзор"],
                        ["strength", "Сила"],
                        ["balance", "Мышцы"],
                        ["bodyweight", "Вес тела"],
                      ] as const
                    ).map(([id, label]) => (
                      <button
                        key={id}
                        role="tab"
                        aria-selected={progressTab === id || (id === "balance" && progressTab === "anatomy")}
                        tabIndex={progressTab === id || (id === "balance" && progressTab === "anatomy") ? 0 : -1}
                        className={progressTab === id ? "active" : ""}
                        onClick={() => setProgressTab(id)}
                        onKeyDown={(event) => {
                          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
                          event.preventDefault();
                          const tabs = Array.from(event.currentTarget.parentElement!.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
                          const current = tabs.indexOf(event.currentTarget);
                          const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (current + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
                          tabs[next].click(); tabs[next].focus();
                        }}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  {(progressTab === "balance" || progressTab === "anatomy") && <div className="muscles-tabs" role="tablist" aria-label="Виды нагрузки"><button role="tab" aria-selected={progressTab==="balance"} onClick={()=>setProgressTab("balance")}>Нагрузка по зонам</button><button role="tab" aria-selected={progressTab==="anatomy"} onClick={()=>setProgressTab("anatomy")}>Карта мышц</button></div>}
                  {(progressTab === "balance" || progressTab === "anatomy") ? (
                    <div className="week-selector">
                      <button
                        className="icon-button"
                        aria-label="Предыдущая неделя"
                        onClick={() => setWeekOffset((o) => o - 1)}
                      >
                        <ChevronLeft size={20} />
                      </button>
                      <span>
                        {dateLabel(anchor)} — {dateLabel(weekEnd)}
                        <small>{weekOffset === 0 ? "эта неделя" : "выбранная неделя"}</small>
                      </span>
                      <button
                        className="icon-button"
                        aria-label="Следующая неделя"
                        disabled={weekOffset >= 0}
                        onClick={() => setWeekOffset((o) => o + 1)}
                      >
                        <ChevronRight size={20} />
                      </button>
                    </div>
                  ) : null}
                  {progressTab === "bodyweight" && <BodyweightModal key={account.id} accountId={account.id} timeZone={settings.timeZone} />}
                  {progressTab === "analytics" ? (
                    <ProgressOverview
                      workouts={workouts}
                      settings={settings}
                      onStrength={(key) => {
                        setProgressExercise(key);
                        setProgressTab("strength");
                      }}
                    />
                  ) : null}
                  {progressTab === "balance" ? (
                    <>
                      <MovementBalance workouts={weekWorkouts}/>
                      <section className="panel zones-panel" aria-labelledby="zones-title">
                        <div className="panel-header">
                          <div>
                            <h2 id="zones-title">Рабочие подходы по зонам</h2>
                            <p>
                              <strong>{fmt(loads.reduce((n, m) => n + Math.min(m.total, m.goal), 0))}</strong>{" "}
                              из {loads.reduce((n, m) => n + m.goal, 0)} по твоим целям
                            </p>
                            {zonesNote ? <p className="tiny">{zonesNote}</p> : null}
                            {unmarkedNote}
                          </div>
                        </div>
                        <div className="analysis-controls">
                          <label className="chip-toggle">
                            <input
                              type="checkbox"
                              checked={hardSetsOnly}
                              onChange={(e) => setHardSetsOnly(e.target.checked)}
                            />
                            Только RIR ≤ 3
                          </label>
                          {hasLegacy ? (
                            <label>
                              Разметка
                              <Select
                                value={mapping}
                                onChange={(v) => setMapping(v as "recorded" | "current")}
                                options={[
                                  { value: "recorded", label: "Сохранённые версии" },
                                  { value: "current", label: "Пересчёт по каталогу 2" },
                                ]}
                              />
                            </label>
                          ) : null}
                        </div>
                        <div className="zone-list">
                          {loads.map((m) => (
                            <button
                              key={m.id}
                              className={`muscle-row ${selectedMuscle === m.id ? "selected" : ""}`}
                              aria-expanded={selectedMuscle === m.id}
                              onClick={() =>
                                setSelectedMuscle(selectedMuscle === m.id ? null : m.id)
                              }
                            >
                              <span className="zone-name">{m.short}</span>
                              <span className="zone-track" aria-hidden="true">
                                <span
                                  className={m.ratio >= 1.25 ? "over" : m.ratio >= 1 ? "hit" : ""}
                                  style={{ width: `${Math.min(100, (m.ratio / 1.5) * 100)}%` }}
                                />
                                <i />
                              </span>
                              <b className={m.ratio >= 1.25 ? "over" : m.ratio >= 1 ? "hit" : ""}>
                                {fmt(m.total)}
                                <small> / {m.goal}</small>
                              </b>
                            </button>
                          ))}
                        </div>
                        {selectedMuscle ? (
                          <div className="muscle-detail">
                            <b>{loads.find((m) => m.id === selectedMuscle)!.name}</b>
                            <p>
                              {fmt(loads.find((m) => m.id === selectedMuscle)!.direct)} прямых ·{" "}
                              {fmt(loads.find((m) => m.id === selectedMuscle)!.indirect)} с помощью ·{" "}
                              {fmt(loads.find((m) => m.id === selectedMuscle)!.stabilizing)} со стабилизацией
                            </p>
                            <div className="anatomical-breakdown">
                              {anatomy
                                .filter((m) => m.zone === selectedMuscle)
                                .map((m) => (
                                  <div key={m.id}>
                                    <span>{m.name}</span>
                                    <small>
                                      {m.direct} прямых / {m.assisting} помощь / {m.stabilizing} стаб.
                                    </small>
                                  </div>
                                ))}
                            </div>
                            {hasLegacy ? (
                              <p className="tiny">У записей каталога 1 нет разметки отдельных мышц.</p>
                            ) : null}
                          </div>
                        ) : null}
                        <div className="zone-legend" aria-hidden="true">
                          <span><i className="dim" />ниже цели</span>
                          <span><i className="hit" />в цели</span>
                          <span><i className="over" />заметно выше</span>
                          <span><i className="tick" />цель</span>
                        </div>
                      </section>
                      <section className="panel planner-card" aria-labelledby="planner-title">
                        <div>
                          <h2 id="planner-title">Закрыть пробелы</h2>
                          <p>
                            {currentLagging.length
                              ? `Меньше прямых подходов, чем в твоих целях: ${currentLagging
                                  .slice(0, 2)
                                  .map((m) => m.short.toLowerCase())
                                  .join(" и ")}. Соберём короткую тренировку под твоё время.`
                              : "Прямые подходы этой недели покрывают твои цели. Решение о дополнительной работе зависит от прогресса и самочувствия."}
                          </p>
                          {unmarkedNote}
                        </div>
                        <div className="planner-controls">
                          <div className="segmented" role="group" aria-label="Сколько есть времени">
                            {[20, 40, 60].map((n) => (
                              <button
                                key={n}
                                className={minutes === n ? "active" : ""}
                                aria-pressed={minutes === n}
                                onClick={() => setMinutes(n)}
                              >
                                {n} мин
                              </button>
                            ))}
                          </div>
                          <label>
                            Оборудование
                            <Select
                              value={planEquipment}
                              onChange={(v) => setPlanEquipment(v as Equipment)}
                              options={EQ_OPTIONS}
                            />
                          </label>
                        </div>
                        <details className="exclude-muscles">
                          <summary>Пропустить мышцы сегодня</summary>
                          <div className="muscle-chips">
                            {MUSCLES.map((m) => (
                              <label key={m.id}>
                                <input
                                  type="checkbox"
                                  checked={excluded.includes(m.id)}
                                  onChange={(e) =>
                                    setExcluded((xs) =>
                                      e.target.checked
                                        ? [...xs, m.id]
                                        : xs.filter((id) => id !== m.id),
                                    )
                                  }
                                />
                                {m.short}
                              </label>
                            ))}
                          </div>
                        </details>
                        <div className="plan-list">
                          {plan.picks.map((p) => (
                            <div className="plan-item" key={p.exercise.id}>
                              <div>
                                <h3>{p.exercise.name}</h3>
                                <p>{p.reason}</p>
                              </div>
                              <span>3 × 8–12</span>
                            </div>
                          ))}
                          {!plan.picks.length ? (
                            <div className="no-results">
                              Нет подходящих пробелов. Смени оборудование, сними
                              исключения или отдыхай.
                            </div>
                          ) : null}
                        </div>
                        <p className="tiny">
                          Покрытие целей {plan.before}% → {plan.after}% после плана · около {plan.minutes} мин.
                          Это не прогноз роста; вес подбери под себя.
                        </p>
                        <button
                          className="button primary full-width"
                          disabled={!plan.picks.length}
                          onClick={() =>
                            start(
                              plan.picks.map((p) => p.exercise.id),
                              "Баланс недели",
                            )
                          }
                        >
                          <Play size={18} />
                          {demo ? "Попробовать этот план" : "Начать по плану"}
                        </button>
                      </section>
                    </>
                  ) : null}
                  {progressTab === "anatomy" ? (
                    <>
                      <h2 className="sr-only">Анатомия движения</h2>
                      <Suspense
                        fallback={
                          <div className="loading-state" role="status">
                            Открываем атлас…
                          </div>
                        }
                      >
                        <AnatomyExplorer
                          loads={loads}
                          workouts={weekWorkouts}
                          options={analysisOptions}
                          onExercise={setExerciseDetail}
                          onLibrary={(zone) => {
                            setMuscleFilter(zone);
                            go("library");
                          }}
                        />
                      </Suspense>
                    </>
                  ) : null}
                  {progressTab === "strength" ? (
                    <>
                      <div className="progress-selector">
                        <label>
                          Упражнение
                          <Select
                            searchable
                            value={progressExercise}
                            onChange={setProgressExercise}
                            options={progressOptions.map((o) => ({
                              value: o.key,
                              label: [
                                entryName(o.we),
                                (o.we.catalogRevision ?? 1) === 1 ? "старое правило веса" : "",
                                o.we.machineInstanceId ? "" : o.we.equipmentNote ?? "",
                                ExecutionIdentity.describe(o.we),
                                ImportOrigin.label(o.we),
                                o.we.performedSides ? SIDES[o.we.performedSides] : "",
                              ].filter(Boolean).join(" · "),
                            }))}
                          />
                        </label>
                        <p className="tiny">
                          {recordingSentence(progressEntry)}{" "}
                          {progressSpec.loadMode === "assisted_bodyweight"
                            ? "Больше помощи — меньше сопротивления."
                            : "Сравниваются только записи одной версии каталога и одного правила записи."}{" "}
                          {progressSpec.e1rmEligible
                            ? "Расчётный 1ПМ — по 1–12 повторениям записанного веса."
                            : "Для этого правила записи расчётный 1ПМ отключён."}
                        </p>
                      </div>
                      <div className="stats-grid progress-stats">
                        <Stat
                          label="Лучшее значение"
                          value={progressBest === null ? "—" : fmt(progressBest)}
                          unit={progressMetric.unit}
                        />
                        <Stat
                          label={progressSpec.type === "duration" ? "Изменение, с" : "Изменение веса"}
                          value={
                            progressPoints.length > 1 && lastProgress && firstProgress
                              ? `${lastProgress.max - firstProgress.max >= 0 ? "+" : ""}${fmt(lastProgress.max - firstProgress.max)}`
                              : "—"
                          }
                          unit={progressPoints.length > 1 && lastProgress ? progressMetric.unit : ""}
                        />
                        <Stat
                          label="Расчётный 1ПМ"
                          value={lastProgress?.e1rm ? fmt(lastProgress.e1rm) : "—"}
                          unit={lastProgress?.e1rm ? "кг" : ""}
                        />
                        <Stat label="Тренировок" value={String(progressPoints.length)} />
                      </div>
                      <section className="panel progress-panel">
                        <div className="panel-header">
                          <div>
                            <h2>{entryName(progressEntry)}</h2>
                            <p>Лучшее записанное значение в каждой тренировке</p>
                          </div>
                        </div>
                        {progressPoints.length ? (
                          <>
                            <InteractiveStrengthChart
                              points={progressPoints}
                              unit={progressMetric.unit}
                              isDuration={progressSpec.type === "duration"}
                              exerciseName={entryName(progressEntry)}
                            />
                            <div className="progress-history">
                              {[...progressPoints].reverse().map((p, i) => (
                                <div key={`${p.date}-${i}`}>
                                  <span>{dateLabel(p.date, true)}</span>
                                  <span>
                                    {p.sets.length} подх. · {p.reps}{" "}
                                    {progressSpec.type === "duration" ? "с" : "повт."}
                                  </span>
                                  <b>
                                    {fmt(p.max)} {progressMetric.unit}
                                  </b>
                                </div>
                              ))}
                            </div>
                          </>
                        ) : (
                          <div className="empty-state">
                            <TrendingUp size={34} />
                            <h2>Прогрессу нужна точка отсчёта</h2>
                            <p>
                              Запиши {entryName(progressEntry).toLowerCase()} в
                              тренировке, чтобы увидеть динамику.
                            </p>
                            <button
                              className="button primary"
                              onClick={() => start([progressEntry.exerciseId])}
                            >
                              Записать упражнение
                            </button>
                          </div>
                        )}
                      </section>
                    </>
                  ) : null}
                </>
              ) : null}
              {view === "library" ? (
                <>
                  <header className="screen-head">
                    <h1>Упражнения</h1>
                  </header>
                  {exerciseCards()}
                </>
              ) : null}
              {view === "friends" && <Suspense fallback={<p role="status">Открываем напарников…</p>}><FriendsScreen
                onProfile={() => setModal("profile")}
                workouts={workouts}
                onStartMeetup={startMeetup}
                roomInvite={roomInvite}
                onRoomInviteHandled={() => setRoomInvite(null)}
                onToast={setToast}
                workoutActive={!!draft}
                onWorkout={() => (draft ? go("workout") : start())}
              /></Suspense>}
              {view === "programs" ? (
                <>
                  <header className="screen-head">
                    <h1>Программы</h1>
                  </header>
                  <Suspense fallback={<p role="status">Открываем программы…</p>}>
                    <ProgramsScreen
                      routines={product.routines}
                      workouts={workouts}
                      timeZone={settings.timeZone ?? browserTimeZone()}
                      personal={product.customExercises}
                      favorites={product.favorites}
                      onFavorite={(id) => void favoriteExercise(id)}
                      onSave={saveRoutine}
                      onDelete={deleteRoutine}
                      onStart={(r) =>
                        start([], undefined, programWorkout(r))
                      }
                      deload={deload}
                      onCancelDeload={() => {
                        deloadStore.cancel();
                        setDeload(null);
                        setToast("Разгрузка отменена: программы запускаются как раньше.");
                      }}
                      initial={initialRoutine}
                      onInitialUsed={() => setInitialRoutine(null)}
                    />
                  </Suspense>
                </>
              ) : null}
            </>
          )}
        </m.div>
      </main>
      <AnimatePresence>
        {draft && view !== "workout" && view !== "overview" ? (
          <m.button
            key="resume"
            className="resume-pill"
            style={{ x: "-50%" }}
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 24, transition: { duration: 0.18 } }}
            whileTap={{ scale: 0.97 }}
            transition={{ type: "spring", stiffness: 380, damping: 30 }}
            onClick={() => go("workout")}
          >
            <span className="resume-dot" aria-hidden="true" />
            Вернуться к тренировке
            <b>{BackdatedWorkout.manualDuration(draft, settings.timeZone) ? draft.workout.duration : Math.floor(elapsedMs(draft) / 60000)} мин</b>
          </m.button>
        ) : null}
      </AnimatePresence>
      <AnimatePresence>
        {toast ? (
          <m.div
            key="toast"
            className={`toast ${notice.tone === "warn" ? "toast-warn" : ""}`}
            role="status"
            style={{ x: "-50%" }}
            initial={{ opacity: 0, y: 14, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98, transition: { duration: 0.16 } }}
            transition={{ type: "spring", stiffness: 420, damping: 32 }}
          >
            {notice.tone === "warn" ? <TriangleAlert size={17} /> : <Check size={17} />}
            <span>{toast}</span>
            <button
              className="icon-button"
              aria-label="Скрыть уведомление"
              onClick={() => setToast("")}
            >
              <X size={16} />
            </button>
          </m.div>
        ) : null}
      </AnimatePresence>
      {modal === "picker" ? (
        <Modal title="Добавить упражнения" onClose={() => setModal(null)} wide>
          {exerciseCards(true)}
          <div className="modal-actions">
            <span className="muted">
              {draft?.workout.exercises.length ?? 0} упражнений в тренировке
            </span>
            <button
              className="button primary"
              onClick={() => {
                setModal(null);
                go("workout");
              }}
            >
              Готово
            </button>
          </div>
        </Modal>
      ) : null}
      {modal === "settings" ? (
        <Modal title="Мои недельные ориентиры" onClose={() => setModal(null)}>
          <p className="modal-intro">
            Твои недельные ориентиры по прямым подходам. Исходные числа —
            настройки приложения, не универсальные нормы или персональная
            программа.
          </p>
          <div className="goal-settings">
            {MUSCLES.map((m) => (
              <label key={m.id}>
                <span>{m.name}</span>
                <input
                  aria-label={`Недельная цель: ${m.name}`}
                  type="number"
                  min="1"
                  max="40"
                  value={settingsDraft.goals[m.id]}
                  onChange={(e) =>
                    setSettingsDraft((s) => ({
                      ...s,
                      goals: { ...s.goals, [m.id]: Number(e.target.value) },
                    }))
                  }
                />
                <span className="tiny">подх.</span>
              </label>
            ))}
          </div>
          <button
            type="button"
            className="button secondary full-width"
            style={{ marginTop: 16 }}
            onClick={() => {
              try {
                const goals = TrainingProgram.programV2Goals();
                setSettingsDraft((s) => ({
                  ...s,
                  goals: { ...s.goals, ...goals },
                }));
              } catch (err) {
                setSaveError(
                  err instanceof Error ? err.message : "Ошибка расчёта",
                );
              }
            }}
          >
            <Sparkles size={17} />
            Взять ориентиры из программы v2
          </button>
          <p className="tiny" style={{ marginTop: 8 }}>
            Числа — недельные рабочие подходы, которые программа v2 планирует
            сама; жимы в них считаются и подходами на трицепс.
          </p>
          <div className="settings-zone">
            <TimeZoneField
              label="Часовой пояс календаря"
              value={settingsDraft.timeZone ?? browserTimeZone()}
              onChange={(zone) => setSettingsDraft((v) => ({ ...v, timeZone: zone }))}
              required={false}
            />
            <small className="tiny">Даты прошлых тренировок не сдвигаются.</small>
          </div>
          <div className="settings-bottom">
            <label>
              Оборудование
              <Select
                value={settingsDraft.equipment}
                onChange={(v) =>
                  setSettingsDraft((s) => ({ ...s, equipment: v as Equipment }))
                }
                options={EQ_OPTIONS}
              />
            </label>
            <label>
              Отдых, секунды
              <input
                type="number"
                min="15"
                max="600"
                step="15"
                value={settingsDraft.restSeconds}
                onChange={(e) =>
                  setSettingsDraft((s) => ({
                    ...s,
                    restSeconds: Number(e.target.value),
                  }))
                }
              />
            </label>
          </div>
          {saveError ? (
            <div className="inline-error" role="alert">
              {saveError}
              {settings.revision !== settingsDraft.revision ? (
                <button
                  className="text-button"
                  onClick={() => {
                    setSettingsDraft(structuredClone(settings));
                    setSaveError("");
                  }}
                >
                  Загрузить актуальные настройки
                </button>
              ) : null}
            </div>
          ) : null}
          <div className="modal-actions">
            <button
              className="text-button"
              onClick={() =>
                setSettingsDraft({
                  ...structuredClone(DEFAULT_SETTINGS),
                  revision: settingsDraft.revision,
                  timeZone: browserTimeZone(),
                })
              }
            >
              Сбросить к исходным
            </button>
            <button
              className="button primary"
              disabled={saving}
              onClick={() => void saveSettings()}
            >
              {saving ? "Сохраняем…" : "Сохранить ориентиры"}
            </button>
          </div>
        </Modal>
      ) : null}
      {modal === "method" ? (
        <Modal
          title="Как считаем записанную работу"
          onClose={() => setModal(null)}
        >
          <div className="method-content">
            <p>
              Карта показывает <b>распределение записанных подходов</b>, не
              силу, рост или восстановление мышц.
            </p>
            <div className="formula-card">
              <b>1 выполненный рабочий подход</b>
              <span>как отдельная запись участия движителя</span>
            </div>
            <ul>
              <li>Разминка записывается и входит в общий тоннаж и количество выполненных подходов. Её участие в мышцах показывается отдельно; недельные ориентиры считают рабочие подходы. Невыполненные подходы исключаются.</li>
              <li>
                Роли движителя, помощника и стабилизатора разделены. Помощь не
                прибавляется к прямым целям; стабилизация не заполняет ориентир.
                В инструменте «Объём по мышцам» отдельно показана дробная оценка:
                прямые + 0,5 × помощь, с указанным периодом и ограничениями.
              </li>
              <li>
                RIR хранится отдельно. Можно включить фильтр ≤3, без
                коэффициентов стимула.
              </li>
              <li>
                Покрытие — среднее min(прямые подходы / мой ориентир, 1) по 10
                зонам. 100% означает выполнение настроек, не физиологический
                баланс.
              </li>
              <li>
                Один подход может иметь нескольких движителей. Внутри зоны он
                считается один раз, без деления «стимула» до суммы 1.
              </li>
            </ul>
            <p>
              Каталог содержит анатомические роли и источники с ограничениями.
              ЭМГ и мышечный рост — разные измерения. Проверяемая разметка не
              обещает 100% точности для любого человека и любой техники.
            </p>
            <p>
              <b>Внешний объём:</b> вес × число гантелей × повторы × явно
              записанные стороны. Масса тела, тренажёры и старые неопределённые
              веса не суммируются в этот показатель.
            </p>
            <p>
              <b>Расчётный 1ПМ записанного веса:</b> формула Эпли, версия 1, для
              разрешённых упражнений и 1–12 повторений. У гантелей — на одну
              гантель. Для массы тела, помощи, тренажёров и неизвестных старых
              правил веса он отключён. Это оценка внутри одного варианта
              упражнения.
            </p>
            <p className="tiny">
              Методика 2 применяется к счётчику подходов явно. История хранит
              версии каталога; исходные записи не меняются при пересчёте. Расчёт
              подходов по методике 1 доступен в старых тренировках.
            </p>
          </div>
        </Modal>
      ) : null}
      {detail ? (
        <Modal title={detail.name} onClose={() => setDetail(null)} wide>
          <div className="workout-detail-meta">
            <span>
              <CalendarDays size={16} />
              {dateLabel(detail.date, true)}
            </span>
            <span>
              <Clock3 size={16} />
              {detail.duration} мин
            </span>
            <span>
              <Dumbbell size={16} />
              {fmt(volumeSummary([detail], "all").total)} кг
            </span>
          </div>
          {detail.exercises.map((e) => (
            <div className="detail-exercise" key={e.exerciseId}>
              <h3>{entryName(e)}</h3>
              {(() => {
                const sides = e.performedSides
                  ? e.performedSides === "both" ? "обе стороны" : e.performedSides === "left" ? "левая сторона" : "правая сторона"
                  : "";
                const line = [
                  recordingNote(e),
                  e.machineSnapshot ? e.machineSnapshot.nickname : e.equipmentNote ?? "",
                  sides,
                ].filter(Boolean).join(" · ");
                return line ? <p className="tiny">{line}</p> : null;
              })()}
              <div className="detail-sets">
                {e.sets
                  .filter((s) => s.done)
                  .map((s) => (
                    <span key={s.id}>
                      {s.warmup ? "Разминка · " : ""}
                      {s.performedSides ? `${s.performedSides === "both" ? "обе стороны" : s.performedSides === "left" ? "левая" : "правая"} · ` : ""}
                      {s.execution?.rom ? `ROM: ${s.execution.rom} · ` : ""}
                      <b>
                        {exerciseForEntry(e)?.recording.type === "duration" ? (
                          `${s.durationSeconds} с`
                        ) : (
                          <>
                            {exerciseForEntry(e)?.recording.loadMode ===
                            "bodyweight"
                              ? "Без веса"
                              : `${fmt(recordedLoad(e, s))} ${recordingLabel(e)}`}{" "}
                            × {s.reps}
                            {exerciseForEntry(e)?.recording.repsMode ===
                            "per_side"
                              ? " / сторону"
                              : ""}
                          </>
                        )}
                      </b>
                      {exerciseForEntry(e)?.recording.type !== "duration" ? (
                        <small>RIR {s.rir ?? "—"}</small>
                      ) : s.distanceKm !== undefined ? (
                        <small>{s.distanceKm} км</small>
                      ) : null}
                    </span>
                  ))}
              </div>
            </div>
          ))}
          {detail.exercises.some((e) => (e.catalogRevision ?? 1) === 1) ? (
            <details className="historical-calculation">
              <summary>Архивный расчёт подходов · методика 1</summary>
              <p>
                Это прежняя эвристика 1 / 0,5 с RIR-множителем. Она сохранена
                для проверки старых расчётов и не используется как измерение
                роста.
              </p>
              {legacyMuscleLoad([detail])
                .filter((m) => m.total > 0)
                .map((m) => (
                  <p key={m.id}>
                    {m.name}: {fmt(m.direct)} прямых + {fmt(m.indirect)}{" "}
                    условных косвенных
                  </p>
                ))}
            </details>
          ) : null}
          {detail.notes ? <p className="detail-notes">{detail.notes}</p> : null}
          <p className="history-value-note">
            Внешний объём включает только свободные веса с известным правилом
            записи. Тренажёры, масса тела и неопределённые старые записи
            показаны по подходам.
          </p>
          <details className="detail-insights">
            <summary>Итоги, мышцы и карточка для сторис</summary>
            <SessionInsights
              workout={detail}
              settings={settings}
              account={account}
            />
          </details>
          <Suspense fallback={<p className="tiny">Открываем показатели часов…</p>}><AppleHealthPanel workout={detail} readOnly={demo} onSaved={saved => {
            setDetail(saved); setWorkouts(ws => ws.map(w => w.id === saved.id ? saved : w));
            setJustSaved(w => w?.id === saved.id ? saved : w); setToast("Показатели часов сохранены");
          }} /></Suspense>
          <div className="modal-actions">
            {!demo ? (
              <button
                className="text-button danger-text"
                onClick={() => setDeleteId(detail.id)}
              >
                <Trash2 size={15} />
                Удалить
              </button>
            ) : (
              <span className="tiny">Пример данных</span>
            )}
            <div className="button-group">
              <button
                className="button secondary"
                onClick={() => {
                  setInitialRoutine(TrainingProgram.fromWorkout(detail));
                  setDetail(null);
                  go("programs");
                }}
              >
                В программу
              </button>
              <button
                className="button secondary"
                onClick={() => {
                  const copy = repeatWorkout(detail, settings.timeZone);
                  setDetail(null);
                  start([], undefined, copy);
                }}
              >
                Повторить
              </button>
              {!demo ? (
                <button
                  className="button primary"
                  onClick={() => editWorkout(detail)}
                >
                  Редактировать
                </button>
              ) : null}
            </div>
          </div>
        </Modal>
      ) : null}
      {deleteId ? (
        <Modal title="Удалить тренировку?" onClose={() => setDeleteId(null)}>
          <p className="modal-intro">
            Подходы исчезнут из истории и расчётов. Это действие нельзя
            отменить.
          </p>
          <div className="modal-actions">
            <button
              className="button secondary"
              onClick={() => setDeleteId(null)}
            >
              Оставить
            </button>
            <button
              className="button danger"
              disabled={saving}
              onClick={() => void deleteWorkout()}
            >
              {saving ? "Удаляем…" : "Удалить"}
            </button>
          </div>
        </Modal>
      ) : null}
      {modal === "rest_notifications" && <Modal title="Уведомления отдыха" onClose={()=>setModal(null)}><RestNotificationSettings/></Modal>}
      {modal === "backup" && <Modal title="Резервная копия" onClose={()=>setModal(null)}><div className="backup-tools"><p>В одном файле: тренировки, программы, личные упражнения, избранное, вес, цели и настройки. Пароли и сессии в копию не входят.</p><button className="button primary" onClick={()=>void exportHistory()}><Download size={18}/>Скачать полную копию</button><button className="button secondary" onClick={()=>setModal("restore")}>Восстановить из файла</button><p className="tiny">Перед восстановлением можно просмотреть содержимое и выбрать, как поступить с разными замерами за один день.</p></div></Modal>}
      {modal === "import" || modal === "restore" ? (
        <Modal
          title={modal === "restore" ? "Восстановление из копии" : "Импорт истории"}
          wide
          onClose={() => {
            if (!importBusy) setModal(null);
          }}
        >
          <Suspense fallback={<p>Открываем импорт…</p>}>
            <HistoryImporter
              mode={modal === "restore" ? "restore" : "import"}
              existing={{ workouts, routines: product.routines, customExercises: product.customExercises, favorites: product.favorites }}
              onClose={() => {
                setModal(null);
                go("history");
              }}
              timeZone={settings.timeZone ?? browserTimeZone()}
              onBusy={setImportBusy}
              onComplete={async (result) => {
                if (result.settings) {
                  const latest = await api<{ settings: Settings }>("/api/data");
                  await api("/api/settings", "PUT", {
                    ...result.settings,
                    revision: latest.settings.revision ?? 0,
                  });
                }
                if(result.profile){const latest=await api<{profile:AccountProfile}>("/api/auth/session");const restored=await api<{profile:AccountProfile}>("/api/auth/profile","PUT",{...result.profile,revision:latest.profile.revision});onAccountChange(restored.profile);}
                await load();
                if(result.theme)applyTheme(result.theme);
                // Восстановление из копии остаётся на экране с итогом, пока его не закроют.
                if (modal !== "restore") {
                  setModal(null);
                  go("history");
                }
                setDemo(false);
                if (result.addedIds?.length) {
                  const record: ImportRecord = {
                    at: new Date().toISOString(),
                    ids: result.addedIds,
                    imported: result.imported - (result.replaced ?? 0),
                    replaced: result.replaced ?? 0,
                    kept: result.kept ?? 0,
                    kind: modal === "restore" ? "restore" : "import",
                  };
                  importUndo.save(record);
                  setLastImport(record);
                   const currentRuns = await importService.runs().catch(() => ({ runs: [], pending: [] }));
                   setLastImportRun(currentRuns.runs[0] ?? null);
                    // Черновик другого файла остаётся виден: сервер — единственный источник правды.
                    setPendingImport(currentRuns.pending?.[0] ? { runId: currentRuns.pending[0].runId, total: currentRuns.pending[0].total } : null);
                  setUndoAsk(false);
                  setLastNoop(null);
                } else {
                  setLastNoop({ at: new Date().toISOString(), kind: modal === "restore" ? "restore" : "import" });
                }
                const added = result.imported - (result.replaced ?? 0);
                setToast(
                  `Импорт завершён: добавлено ${added}` +
                    (result.replaced ? `, заменено ${result.replaced}` : "") +
                    `, пропущено ${result.skipped - (result.kept ?? 0)}` +
                    (result.kept ? `, твои правки сохранены: ${result.kept}` : "") +
                    (result.weightCount!==undefined?`; замеров веса: ${result.weightCount}`:""),
                );
              }}
            />
          </Suspense>
        </Modal>
      ) : null}
      {modal === "personal" ? (
        <Modal
          title={
            personalEditor ? "Редактировать своё упражнение" : "Своё упражнение"
          }
          onClose={() => setModal(null)}
        >
          <Suspense fallback={<p>Открываем редактор…</p>}>
            <PersonalExerciseEditor
              exercise={personalEditor}
              onDeleted={(id) => {
                setProduct((p) => ({
                  ...p,
                  customExercises: p.customExercises.filter((e) => e.id !== id),
                  favorites: p.favorites.filter((e) => e !== id),
                }));
                setModal(null);
                setToast("Упражнение убрано из каталога; история сохранена");
              }}
              onSaved={(exercise) => {
                exerciseCatalog.register([exercise]);
                setProduct((p) => {
                  const oldIds = p.customExercises
                    .filter(
                      (e) => e.custom?.familyId === exercise.custom?.familyId,
                    )
                    .map((e) => e.id);
                  const wasFavorite = p.favorites.some((id) =>
                    oldIds.includes(id),
                  );
                  return {
                    ...p,
                    customExercises: [
                      exercise,
                      ...p.customExercises.filter(
                        (e) => !oldIds.includes(e.id),
                      ),
                    ],
                    favorites: [
                      ...p.favorites.filter((id) => !oldIds.includes(id)),
                      ...(wasFavorite ? [exercise.id] : []),
                    ],
                  };
                });
                setModal(null);
                setToast("Упражнение сохранено в личном каталоге");
              }}
            />
          </Suspense>
        </Modal>
      ) : null}
      {exerciseDetail ? (
        <Modal
          title={exerciseById(exerciseDetail)!.name}
          onClose={() => setExerciseDetail(null)}
        >
          <ExerciseInfo
            exercise={exerciseById(exerciseDetail)!}
            disabled={
              !!draft?.workout.exercises.some(
                (e) => e.exerciseId === exerciseDetail,
              )
            }
            onAdd={() => {
              addExercise(exerciseDetail);
              setExerciseDetail(null);
              go("workout");
            }}
          />
        </Modal>
      ) : null}
      {modal === "profile" ? <Modal title="Мой профиль" onClose={() => setModal(null)}>
        <AccountProfileForm account={account} hasDraft={!!draft} queued={pending.items.length}
          onChange={p => { onAccountChange(p); void load(); }} onLogout={onLogout} />
      </Modal> : null}
      {modal === "plate" ? (
        <Modal title="Калькулятор блинов" onClose={() => setModal(null)} wide>
          <PlateCalculator onClose={() => setModal(null)} />
        </Modal>
      ) : null}
      {modal === "orm" ? (
        <Modal title="Калькулятор 1ПМ" onClose={() => setModal(null)} wide>
          <OneRepMaxCalculator onClose={() => setModal(null)} />
        </Modal>
      ) : null}
      {modal === "technique" && <Modal title="Анализ техники по видео" onClose={()=>setModal(null)} wide><Suspense fallback={<p role="status">Открываем анализ видео…</p>}><PoseAnalysisPanel/></Suspense></Modal>}
      {modal === "machines" && <Modal title="Мои тренажёры" onClose={()=>setModal(null)} wide><MachineManager
        machines={product.machines ?? []}
        onSave={async (machine)=>{ const result=await productService.saveMachine(machine); setProduct((p)=>({...p,machines:[result.machine,...(p.machines ?? []).filter((m)=>m.id!==result.machine.id)]})); }}
        onArchive={async (machine)=>{ await productService.archiveMachine(machine); setProduct((p)=>({...p,machines:(p.machines ?? []).filter((m)=>m.id!==machine.id)})); }}
      /></Modal>}
      {modal === "tools" && <Modal title="Инструменты и настройки" onClose={()=>setModal(null)}><ToolsHub onChoose={id=>id==="settings"?openSettings():setModal(id)}/></Modal>}
      {modal === "bodyweight" ? (
        <Modal title="Контроль массы тела" onClose={() => setModal(null)} wide>
          <BodyweightModal
            accountId={account.id}
            timeZone={settings.timeZone}
            onClose={() => setModal(null)}
          />
        </Modal>
      ) : null}
      {modal === "deload" ? (
        <Modal title="Настройка разгрузочной недели" onClose={() => setModal(null)} wide>
          <DeloadModal
            workouts={workouts}
            timeZone={settings.timeZone}
            plan={deload}
            hasDraft={!!draft}
            onApplyDeload={(mode) => {
              const result = deloadStore.apply(mode, today, product.routines);
              if (result.applied) setDeload(result.record);
              return result;
            }}
            onCancelDeload={() => {
              deloadStore.cancel();
              setDeload(null);
            }}
            onClose={() => setModal(null)}
          />
        </Modal>
      ) : null}
      {modal === "warmup" ? (
        <Modal title="Разминочная лесенка (OpenGym)" onClose={() => setModal(null)} wide>
          <WarmupModal onClose={() => setModal(null)} />
        </Modal>
      ) : null}
      {modal === "ios_install" ? (
        <Modal title="Установить на iPhone" onClose={() => setModal(null)}>
          <IosInstallPrompt onClose={() => setModal(null)} />
        </Modal>
      ) : null}
      {modal === "rp_volume" ? (
        <Modal
          title="Ориентиры недельного объёма"
          onClose={() => setModal(null)}
          wide
        >
          <VolumeLandmarksModal
            workouts={displayed}
            today={today}
            mapping={mapping}
            timeZone={settings.timeZone}
          />
        </Modal>
      ) : null}
      {conflict && draft ? (
        <Modal
          title={WorkoutConflict.title(conflict.current)}
          onClose={() => setConflict(null)}
        >
          {/* R09-REQ03: человеческим языком, с числами обеих записей и последствием у каждой кнопки; поведение кнопок прежнее. */}
          <dl className="conflict-compare">
            {WorkoutConflict.summary(draft.workout, conflict.current).map((row) => (
              <div key={row.label}>
                <dt>{row.label}</dt>
                <dd>{row.value}</dd>
              </div>
            ))}
          </dl>
          <div className="conflict-choices">
            <div className="conflict-choice">
              <button
                className="button primary"
                onClick={() => {
                  setDraft((d) =>
                    d
                      ? {
                          ...d,
                          workout: new WorkoutSession(d.workout).separateCopy(),
                          editing: false,
                          manualDuration: true,
                        }
                      : null,
                  );
                  // R09-QA-06: список «Истории» сразу показывает правду: сохранённая в другом окне запись вместо своей старой, удалённой — нет.
                  const stale = draft.workout.id;
                  setWorkouts((ws) =>
                    conflict.current
                      ? [conflict.current, ...ws.filter((w) => w.id !== conflict.current!.id)].sort((a, b) => b.date.localeCompare(a.date))
                      : ws.filter((w) => w.id !== stale),
                  );
                  setConflict(null);
                  setSaveError("");
                  setToast(WorkoutConflict.COPY_READY);
                }}
              >
                {WorkoutConflict.SAVE_COPY.label}
              </button>
              <small>{(conflict.current ? WorkoutConflict.SAVE_COPY : WorkoutConflict.SAVE_COPY_DELETED).effect}</small>
            </div>
            {conflict.current ? (
              <div className="conflict-choice">
                <button
                  className="button secondary"
                  onClick={() => {
                    const current = conflict.current!;
                    setWorkouts((ws) => [
                      current,
                      ...ws.filter((w) => w.id !== current.id),
                    ]);
                    setDraft(newDraft(structuredClone(current), true));
                    setConflict(null);
                    setSaveError("");
                  }}
                >
                  {WorkoutConflict.KEEP_SAVED.label}
                </button>
                <small>{WorkoutConflict.KEEP_SAVED.effect}</small>
              </div>
            ) : null}
            <div className="conflict-choice">
              <button className="text-button" onClick={exportDraft}>
                <Download size={16} />
                {WorkoutConflict.DOWNLOAD.label}
              </button>
              <small>{WorkoutConflict.DOWNLOAD.effect}</small>
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

function Stat({
  label,
  value,
  unit,
}: {
  label: string;
  value: string;
  unit?: string;
}) {
  return (
    <article className="stat-card panel">
      <span className="stat-label">{label}</span>
      <div className="stat-value">
        {value}
        {unit ? <span>{unit}</span> : null}
      </div>
    </article>
  );
}
