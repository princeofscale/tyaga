import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type SetStateAction,
} from "react";
import {
  CalendarDays,
  Download,
  Dumbbell,
  Info,
  Sparkles,
  X,
} from "lucide-react";
import { m, useReducedMotion } from "motion/react";
import {
  DEFAULT_SETTINGS,
  addCalendarDays,
  browserTimeZone,
  demoWorkouts,
  entryName,
  exerciseCatalog,
  localDate,
  makeExerciseEntry,
  makeWorkout,
  muscleLoad,
  weekStart,
  type Exercise,
  type Muscle,
  type ProductData,
  type Routine,
  type Settings,
  type Workout,
} from "./lib/model";
import { BodyweightProvider } from "./state/BodyweightContext";
import { useBodyweight } from "./state/bodyweightStore";
import { useLiveRoom } from "./lib/liveRoomContext";
import { useLiveBroadcast } from "./lib/useLiveBroadcast";
import { useDraftTabs } from "./lib/useDraftTabs";
import { useLiveClock } from "./lib/useNow";
import { usePendingWorkouts } from "./hooks/usePendingWorkouts";
import { useRestNotifications } from "./hooks/useRestNotifications";
import { useTrainingTools } from "./lib/webmcp";
import { offlineSnapshot } from "./lib/offlineSnapshot";
import { OfflineMutationQueue } from "./lib/offlineMutationQueue";
import { getCurrentTheme } from "./lib/theme";
import { takeRoomInvite } from "./lib/invite";
import { LiveFinished } from "./lib/liveFinished";
import { saveFile } from "./lib/saveFile";
import { quantity } from "./lib/quantity";
import {
  DRAFT_KEY,
  checkpointDraft,
  elapsedMs,
  newDraft,
  readDraft,
  type Draft,
} from "./lib/draft";
import type { AccountProfile } from "./lib/account";
import type { Release } from "./device/appUpdate";
import { api, ApiError } from "./services/ApiClient";
import { productService } from "./services/ProductService";
import { importService } from "./services/ImportService";
import { friendsApi } from "./services/FriendsApi";
import { BodyMass } from "./domain/BodyMass";
import { BackdatedWorkout } from "./domain/BackdatedWorkout";
import { DeloadEngine } from "./domain/DeloadEngine";
import { DeloadHint } from "./domain/DeloadHint";
import { DeloadPlan, type DeloadPlanRecord } from "./domain/DeloadPlan";
import { ImportUndo, type ImportRecord } from "./domain/ImportUndo";
import { ImportUndoMessage } from "./domain/ImportUndoMessage";
import { JournalBackup } from "./domain/JournalBackup";
import { LaidDupPlan, type LaidAutoUpdate } from "./domain/LaidDupPlan";
import { LiveBroadcastPolicy, LiveStateBuilder } from "./domain/LiveSession";
import { MuscleCoverage } from "./domain/MuscleCoverage";
import { PendingWorkouts } from "./domain/PendingWorkouts";
import { SupplementsStore, type SupplementsState } from "./domain/Supplements";
import { TrainingCalendar, calendarWeekday, type ScheduledTraining } from "./domain/TrainingCalendar";
import { DAY_NAMES, TrainingProgram } from "./domain/TrainingProgram";
import { VolumeLandmarksCalculator } from "./domain/VolumeLandmarks";
import { WorkoutSession } from "./domain/WorkoutSession";
import TodayDashboard from "./components/TodayDashboard";
import SessionCard from "./components/SessionCard";
import TabErrorBoundary from "./components/TabErrorBoundary";
import {
  ExerciseLibrary,
  FriendsScreen,
  HistoryScreen,
  ProgramsScreen,
  ProgressScreen,
  SupplementsScreen,
  WorkoutView,
} from "./components/chunks";
import type { ProgressTab } from "./features/progress/ProgressScreen";
import {
  AppOverlays,
  AppSidebar,
  AppTopbar,
  type ProductView,
} from "./features/navigation/AppChrome";
import { AppModals, type AppModalId } from "./features/modals/AppModals";

type AppProps = {
  account: AccountProfile;
  onAccountChange: (p: AccountProfile) => void;
  onLogout: () => void;
};

export default function App(props: AppProps) {
  return (
    <BodyweightProvider accountId={props.account.id} timeZone={props.account.timeZone}>
      <JournalApp {...props} />
    </BodyweightProvider>
  );
}

function JournalApp({ account, onAccountChange, onLogout }: AppProps) {
  const weights = useBodyweight();
  const draftKey = `tyaga-draft-account:${account.id}`;
  const live = useLiveRoom();
  const [roomInvite, setRoomInvite] = useState<string | null>(() => takeRoomInvite());
  const [view, setView] = useState<ProductView>(() =>
    roomInvite || new URLSearchParams(location.search).has("friend") ? "friends" : "overview",
  );
  const [product, setProduct] = useState<ProductData>({
    routines: [],
    customExercises: [],
    favorites: [],
  });
  const [personalEditor, setPersonalEditor] = useState<Exercise | undefined>();
  const [initialRoutine, setInitialRoutine] = useState<Routine | null>(null);
  const pendingFavorites = useRef(new Set<string>());
  const [importBusy, setImportBusy] = useState(false);
  const [stored, setWorkouts] = useState<Workout[]>([]);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  useEffect(() => {
    weights.setTimeZone(settings.timeZone ?? account.timeZone);
  }, [weights, settings.timeZone, account.timeZone]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [demo, setDemo] = useState(false);
  const [offlineData, setOfflineData] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(() => readDraft(draftKey));
  useLiveBroadcast(draft, draftKey);

  const reduceMotion = useReducedMotion();
  const enter = (delay: number) =>
    reduceMotion
      ? {}
      : {
          initial: { opacity: 0.82, y: 4 },
          animate: { opacity: 1, y: 0 },
          transition: {
            duration: 0.2,
            delay: Math.min(delay, 0.08),
            ease: [0.22, 1, 0.36, 1] as [number, number, number, number],
          },
        };

  const [legacyDraft, setLegacyDraft] = useState(() => readDraft(DRAFT_KEY));
  const [conflict, setConflict] = useState<{ current: Workout | null } | null>(null);
  const [mapping, setMapping] = useState<"recorded" | "current">("recorded");
  const [progressTab, setProgressTab] = useState<ProgressTab>("analytics");
  const [supplements, setSupplements] = useState<SupplementsState>(() =>
    SupplementsStore.load(account.id),
  );
  useEffect(() => {
    setSupplements(SupplementsStore.load(account.id));
  }, [account.id]);
  const updateSupplements = useCallback(
    (next: SupplementsState) => {
      setSupplements(next);
      if (!SupplementsStore.save(account.id, next)) {
        setNotice({ text: "Не удалось сохранить план добавок на этом устройстве", tone: "warn" });
      }
    },
    [account.id],
  );

  const [notice, setNotice] = useState<{ text: string; tone: "ok" | "warn" }>({
    text: "",
    tone: "ok",
  });
  const toast = notice.text;
  const setToast = (text: string) => setNotice({ text, tone: "ok" });
  const warn = (text: string) => setNotice({ text, tone: "warn" });
  const [modal, setModal] = useState<AppModalId>(null);
  const [detail, setDetail] = useState<Workout | null>(null);
  const [justSaved, setJustSaved] = useState<Workout | null>(null);

  const pending = usePendingWorkouts(
    account.id,
    (saved) =>
      setWorkouts((ws) =>
        [saved, ...ws.filter((w) => w.id !== saved.id)].sort((a, b) =>
          b.date.localeCompare(a.date),
        ),
      ),
    (text) => setNotice({ text, tone: "ok" }),
  );
  const pendingError = pending.items.find((i) => i.error)?.error ?? "";
  const mutationQueue = useMemo(() => new OfflineMutationQueue(account.id), [account.id]);
  const [queuedMutations, setQueuedMutations] = useState(() => mutationQueue.read().length);
  const hasLoadedRef = useRef(false);
  const loadRef = useRef<(signal?: AbortSignal, options?: { background?: boolean }) => Promise<void>>(async () => {});
  const flushMutations = useCallback(async () => {
    const res = await mutationQueue.flush((path, method, body, meta) =>
      api(path, method, body, undefined, meta?.opId ? { "X-Tyaga-Op-Id": meta.opId } : undefined),
    );
    setQueuedMutations(res.remaining);
    if (res.storageError) {
      setNotice({ text: "Не удалось обновить офлайн-очередь на устройстве", tone: "warn" });
    } else if (res.conflicts > 0) {
      setNotice({ text: "Часть офлайн-изменений конфликтует с сервером — обновляем журнал", tone: "warn" });
      void loadRef.current(undefined, { background: true });
    } else if (res.failed > 0) {
      setNotice({
        text: res.dropped[0]?.message || "Часть офлайн-изменений не удалось применить",
        tone: "warn",
      });
    } else if (res.sent > 0) {
      setNotice({ text: "Офлайн-изменения синхронизированы", tone: "ok" });
    }
    return res;
  }, [mutationQueue]);
  const workouts = useMemo(
    () => PendingWorkouts.merge(stored, pending.items),
    [stored, pending.items],
  );
  const [deleteId, setDeleteId] = useState<string | null>(null);

  // Докачиваем частые экраны в фоне, пока есть связь, чтобы они открылись и в офлайне.
  useEffect(() => {
    const win = window as {
      requestIdleCallback?: (f: () => void, o?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    const warm = () => {
      ExerciseLibrary.preload();
      ProgramsScreen.preload();
      HistoryScreen.preload();
      ProgressScreen.preload();
    };
    if (win.requestIdleCallback) {
      const id = win.requestIdleCallback(warm, { timeout: 2000 });
      return () => win.cancelIdleCallback?.(id);
    }
    const id = window.setTimeout(warm, 1500);
    return () => window.clearTimeout(id);
  }, []);

  const importUndo = useMemo(
    () =>
      new ImportUndo(typeof localStorage === "undefined" ? null : localStorage, account.id),
    [account.id],
  );
  const [lastImport, setLastImport] = useState<ImportRecord | null>(() => importUndo.read());
  const [lastImportRun, setLastImportRun] = useState<{
    runId: string;
    at: string;
    total: number;
    activeCount: number;
  } | null>(null);
  const [pendingImport, setPendingImport] = useState<{ runId: string; total: number } | null>(null);
  const [undoAsk, setUndoAsk] = useState(false);
  const [lastNoop, setLastNoop] = useState<{ at: string; kind: "import" | "restore" } | null>(null);
  const [muscleFilter, setMuscleFilter] = useState<Muscle | "all">("all");
  const [startMarking, setStartMarking] = useState(false);
  const [weekOffset, setWeekOffset] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [settingsDraft, setSettingsDraft] = useState<Settings>(DEFAULT_SETTINGS);
  const [exerciseDetail, setExerciseDetail] = useState<string | null>(null);

  const load = useCallback(
    async (signal?: AbortSignal, options?: { background?: boolean }) => {
      const background = options?.background ?? hasLoadedRef.current;
      if (!background) setLoading(true);
      setLoadError("");
      try {
        const [data, productData] = await Promise.all([
          api<{ workouts: Workout[]; settings: Settings }>("/api/data", "GET", undefined, signal),
          productService.read(signal),
        ]);
        if (signal?.aborted) return;
        hasLoadedRef.current = true;
        exerciseCatalog.register([
          ...productData.customExercises,
          ...(productData.favoriteDefinitions ?? []),
          ...data.workouts.flatMap((w) =>
            w.exercises.flatMap((e) => (e.externalDefinition ? [e.externalDefinition] : [])),
          ),
        ]);
        setProduct(productData);
        setWorkouts(data.workouts);
        importService
          .runs()
          .then((result) => {
            setLastImportRun(result.runs[0] ?? null);
            setPendingImport(
              result.pending?.[0]
                ? { runId: result.pending[0].runId, total: result.pending[0].total }
                : null,
            );
          })
          .catch(() => {
            setLastImportRun(null);
            setPendingImport(null);
          });
        setSettings({
          ...data.settings,
          timeZone: data.settings.timeZone ?? browserTimeZone(),
        });
        setDemo(false);
        setOfflineData(false);
        offlineSnapshot.saveData(account.id, {
          workouts: data.workouts,
          settings: { ...data.settings, timeZone: data.settings.timeZone ?? browserTimeZone() },
          product: productData,
        });
      } catch (e) {
        if (e instanceof Error && e.name !== "AbortError") {
          const copy =
            e instanceof ApiError || signal?.aborted ? null : offlineSnapshot.data(account.id);
          if (copy) {
            hasLoadedRef.current = true;
            exerciseCatalog.register([
              ...copy.product.customExercises,
              ...(copy.product.favoriteDefinitions ?? []),
              ...copy.workouts.flatMap((w) =>
                w.exercises.flatMap((x) => (x.externalDefinition ? [x.externalDefinition] : [])),
              ),
            ]);
            setProduct(copy.product);
            setWorkouts(copy.workouts);
            setSettings(copy.settings);
            setDemo(false);
            setOfflineData(true);
          } else setLoadError(e.message);
        }
      } finally {
        if (!signal?.aborted && !background) setLoading(false);
      }
    },
    [account.id],
  );
  loadRef.current = load;

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  useEffect(() => {
    if (!offlineData) return;
    const back = () => void load();
    window.addEventListener("online", back);
    return () => window.removeEventListener("online", back);
  }, [offlineData, load]);

  const flushPending = pending.flush;
  useEffect(() => {
    if (!loading && !offlineData && !demo) {
      void flushPending();
      void flushMutations();
    }
  }, [loading, offlineData, demo, flushPending, flushMutations]);
  useEffect(() => {
    const onOnline = () => {
      void flushMutations();
    };
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [flushMutations]);

  useEffect(() => {
    if (loading || demo || offlineData) return;
    offlineSnapshot.saveData(account.id, { workouts: stored, settings, product });
  }, [loading, demo, offlineData, stored, settings, product, account.id]);

  const [update, setUpdate] = useState<Release | null>(null);
  const [updateProgress, setUpdateProgress] = useState<number | null>(null);
  useEffect(() => {
    if (import.meta.env.MODE !== "device") return;
    let checkedAt = 0;
    const check = () => {
      if (document.visibilityState !== "visible" || Date.now() - checkedAt < 3600000) return;
      void import("./device/appUpdate")
        .then((m) => m.findUpdate())
        .then((release) => {
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
      .then((m) => m.installUpdate(setUpdateProgress, update?.sha256))
      .catch((e) => warn(e instanceof Error ? e.message : "Не удалось установить обновление"))
      .finally(() => setUpdateProgress(null));
  };

  useEffect(() => {
    const reload = () => void load(undefined, { background: true });
    window.addEventListener("tyaga:synced", reload);
    return () => window.removeEventListener("tyaga:synced", reload);
  }, [load]);

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
  const liveNow = useLiveClock();
  const today = localDate(liveNow, settings.timeZone);
  const currentWeekStart = weekStart(liveNow, settings.timeZone);
  const currentWeek = useMemo(
    () =>
      displayed.filter(
        (w) =>
          w.date >= currentWeekStart &&
          w.date <= today,
      ),
    [displayed, currentWeekStart, today],
  );
  const familyKey = useMemo(
    () =>
      `${exerciseCatalog.adoptFamilies(product.customExercises)}:${product.customExercises.map((e) => e.id).join("|")}`,
    [product.customExercises],
  );
  const catalogGaps = useMemo(
    () => MuscleCoverage.catalogGaps(displayed, { timeZone: settings.timeZone }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [displayed, settings.timeZone, familyKey],
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
            w.date >= currentWeekStart &&
            w.date <= today,
        ),
        settings,
        { mapping },
      ),
    [workouts, settings, mapping, currentWeekStart, today],
  );
  const deloadStore = useMemo(() => new DeloadPlan(undefined, account.id), [account.id]);
  const [deload, setDeload] = useState<DeloadPlanRecord | null>(null);
  useEffect(() => setDeload(deloadStore.read(today)), [deloadStore, today]);

  const laidAutoBusy = useRef(false);
  useEffect(() => {
    if (loading || demo || offlineData || laidAutoBusy.current) return;
    const cycles = LaidDupPlan.cycles(product.routines);
    if (!cycles.length) return;
    const due: { cycle: Routine[]; update: LaidAutoUpdate }[] = [];
    for (const cycle of cycles) {
      // Тихое автоповышение 1ПМ внутри цикла работает только при явном согласии (`autoEscalate: true`).
      // По умолчанию на карточке цикла показывается подсказка с кнопкой «Пересчитать с недели X».
      if (!cycle[0].periodization?.autoEscalate) continue;
      // тот же расчёт, что и в подсказке на карточке: пользователь видит ровно те числа,
      // которые приложение применит само (иначе автопересчёт молча занижал бы результат)
      const next = LaidDupPlan.autoMaxes(cycle[0].periodization, workouts, today, {
        minorMode: settings.minorMode,
      });
      if (next) due.push({ cycle, update: next });
    }
    if (!due.length) return;
    laidAutoBusy.current = true;
    void (async () => {
      try {
        const saved: Routine[] = [];
        for (const { cycle, update: u } of due)
          for (const routine of cycle)
            saved.push(
              (
                await productService.saveRoutine({
                  ...routine,
                  periodization: LaidDupPlan.withMaxes(
                    routine.periodization!,
                    u.maxes,
                    u.fromWeek,
                  ),
                })
              ).routine,
            );
        setProduct((p) => ({
          ...p,
          routines: [...saved, ...p.routines.filter((r) => !saved.some((s) => s.id === r.id))],
        }));
        setNotice({
          text: due
            .map((item) =>
              LaidDupPlan.autoNotice(
                item.update,
                item.cycle[0]?.periodization?.substitutions,
                item.cycle[0]?.periodization?.version,
              ),
            )
            .join(" "),
          tone: "ok",
        });
      } catch {
        setNotice({
          text: "Максимумы Лейда не обновились автоматически: проверь связь или обнови их вручную.",
          tone: "warn",
        });
      } finally {
        laidAutoBusy.current = false;
      }
    })();
  }, [workouts, product.routines, loading, demo, offlineData, today, settings.minorMode]);

  const timeZone = settings.timeZone ?? browserTimeZone();
  const programWorkout = useCallback(
    (routine: Routine, slot?: ScheduledTraining) => {
      const program = new TrainingProgram(routine);
      const date = slot?.date ?? today;
      const phaseDate = slot?.originalDate ?? date;
      const base = deload ? DeloadEngine.regular(workouts) : workouts;
      const laidCycle = LaidDupPlan.cycleOf(product.routines, routine);
      const laidPlan = LaidDupPlan.planFor(routine, phaseDate, {
        workouts: base,
        cycle: laidCycle,
        accountId: account.id,
      });
      return DeloadPlan.workout(
        program.start(base, timeZone, date, slot?.originalDate, {
          cycle: laidCycle,
          accountId: account.id,
        }),
        deload,
        program.isDeload(workouts, phaseDate) || !!laidPlan?.isDeload,
      );
    },
    [deload, workouts, product.routines, timeZone, today, account.id],
  );
  const todaySlots = useMemo(
    () => TrainingCalendar.onDate(product.routines, today),
    [product.routines, today],
  );
  const todaySlot = todaySlots.find((slot) => !TrainingCalendar.completed(slot, workouts));
  const completedToday =
    !todaySlot && todaySlots.length ? TrainingCalendar.completed(todaySlots[0], workouts) : undefined;
  const nextSlot = useMemo(
    () => TrainingCalendar.next(product.routines, today, workouts),
    [product.routines, today, workouts],
  );
  const todayPlan = useMemo(
    () => (todaySlot ? programWorkout(todaySlot.routine, todaySlot) : null),
    [todaySlot, programWorkout],
  );
  const todaySources = useMemo(
    () =>
      todaySlot
        ? new TrainingProgram(todaySlot.routine).weightSources(workouts, timeZone, today)
        : [],
    [todaySlot, workouts, timeZone, today],
  );
  const weekAssessments = useMemo(
    () => VolumeLandmarksCalculator.assessWeeklyLoads(currentLoads),
    [currentLoads],
  );
  const weekDone = currentLoads.reduce(
    (n, load) => n + Math.min(load.direct + load.indirect * 0.5, load.goal),
    0,
  );
  const weekGoal = currentLoads.reduce((n, load) => n + load.goal, 0);
  const weekGrowthZones = weekAssessments.filter(
    (a) => a.phase === "min_growth" || a.phase === "optimal_growth",
  ).length;
  const weekMaintenanceZones = weekAssessments.filter((a) => a.phase === "maintenance").length;
  const monthWorkouts = displayed.filter(
    (w) => w.date >= addCalendarDays(today, -27) && w.date <= today,
  );

  const go = (v: ProductView) => {
    setView(v);
    window.scrollTo({ top: 0, behavior: "instant" });
  };

  const tabs = useDraftTabs({
    draft,
    setDraft,
    draftKey,
    accountId: account.id,
    notify: warn,
    onClosed: () => setView((v) => (v === "workout" ? "overview" : v)),
  });
  const persistence = tabs.persistence;
  const restoredLegacyId = useRef<string | null>(null);
  useEffect(() => {
    const id = restoredLegacyId.current;
    if (!id || draft?.workout.id !== id || tabs.role !== "owner" || persistence !== "saved") return;
    const saved = readDraft(draftKey);
    if (saved?.workout.id !== id || saved.owner !== tabs.tab) return;
    try {
      if (readDraft(DRAFT_KEY)?.workout.id === id) localStorage.removeItem(DRAFT_KEY);
    } catch {
      return;
    }
    restoredLegacyId.current = null;
    setLegacyDraft(null);
  }, [draft?.workout.id, draftKey, tabs.role, tabs.tab, persistence]);

  const canEditWorkout = tabs.canEdit;
  const hasDraft = !!draft;
  const workoutReadOnly = hasDraft && tabs.role !== "owner";
  const workoutFrame = useRef<HTMLElement>(null);
  const updateWorkoutDraft = useCallback(
    (change: SetStateAction<Draft | null>) => {
      if (canEditWorkout()) setDraft(change);
    },
    [canEditWorkout],
  );

  useEffect(() => {
    if (!hasDraft || workoutReadOnly) return;
    const checkpoint = () =>
      updateWorkoutDraft((d) => (d ? checkpointDraft(d, Date.now(), false) : d));
    const onVisibility = () => {
      updateWorkoutDraft((d) => (d ? checkpointDraft(d, Date.now(), false) : d));
    };
    const id = setInterval(checkpoint, 15000);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", checkpoint);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", checkpoint);
    };
  }, [hasDraft, workoutReadOnly, updateWorkoutDraft]);

  useEffect(() => {
    if (view !== "workout" || !workoutReadOnly) return;
    setModal((value) => (value === "picker" || value === "personal" ? null : value));
    setExerciseDetail(null);
    setConflict(null);
  }, [view, workoutReadOnly]);

  const dismissTabNote = tabs.dismissNote;
  useEffect(() => {
    if (view !== "workout") dismissTabNote();
  }, [view, dismissTabNote]);

  useEffect(() => {
    if (view !== "library") setStartMarking(false);
  }, [view]);

  const markExercises = (saved: Exercise[]) => {
    exerciseCatalog.register(saved);
    setProduct((p) => {
      const families = new Set(saved.map((e) => e.custom?.familyId));
      const oldIds = p.customExercises
        .filter((e) => families.has(e.custom?.familyId))
        .map((e) => e.id);
      const favored = new Set(p.favorites.filter((id) => oldIds.includes(id)));
      const nextFavorite = saved
        .filter((e) =>
          p.customExercises.some(
            (o) => o.custom?.familyId === e.custom?.familyId && favored.has(o.id),
          ),
        )
        .map((e) => e.id);
      return {
        ...p,
        customExercises: [...saved, ...p.customExercises.filter((e) => !oldIds.includes(e.id))],
        favorites: [...p.favorites.filter((id) => !oldIds.includes(id)), ...nextFavorite],
      };
    });
  };

  const layered =
    view !== "overview" ||
    !!(modal || detail || exerciseDetail || deleteId || (conflict && draft));
  const backEntry = useRef(false);
  const ignoringPop = useRef(false);
  const [backPops, setBackPops] = useState(0);
  useEffect(() => {
    if (layered && !backEntry.current) {
      history.pushState({ tyagaBack: true }, "");
      backEntry.current = true;
    } else if (!layered && backEntry.current) {
      backEntry.current = false;
      ignoringPop.current = true;
      history.back();
    }
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
      if (ignoringPop.current) {
        ignoringPop.current = false;
        return;
      }
      backEntry.current = false;
      closeTop.current();
      setBackPops((n) => n + 1);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const restNotification = useRestNotifications(
    account.id,
    draft,
    updateWorkoutDraft,
    () => go("workout"),
    view === "workout" && !workoutReadOnly,
  );

  const start = (ids: string[] = [], name?: string, template?: Workout, retro = false) => {
    if (draft) {
      go("workout");
      warn("У тебя уже есть черновик. Продолжи или отмени его.");
      setModal(null);
      return;
    }
    if (tabs.takeStored()) {
      go("workout");
      setModal(null);
      return;
    }
    const workout =
      template ?? makeWorkout(ids, DeloadEngine.regular(workouts), settings.timeZone, true);
    workout.exercises = BodyMass.workout(
      workout,
      weights.massAt(workout.date, account.bodyMassKg),
    ).exercises;
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
    if (!canEditWorkout()) return;
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
              BodyMass.entry(
                makeExerciseEntry(
                  id,
                  DeloadEngine.isDeloadName(d.workout.name)
                    ? workouts
                    : DeloadEngine.regular(workouts),
                  d.workout.date,
                  settings.timeZone,
                  true,
                ),
                weights.massAt(d.workout.date, account.bodyMassKg),
              ),
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
      favorites: add ? [...p.favorites, id] : p.favorites.filter((x) => x !== id),
    }));
    try {
      await productService.favorite(id, add);
    } catch (e) {
      if (OfflineMutationQueue.isRetryable(e) && mutationQueue.enqueue({
        key: `favorite:${id}`,
        path: "/api/favorites",
        method: "PUT",
        body: { exerciseId: id, favorite: add },
      })) {
        setQueuedMutations(mutationQueue.read().length);
        setToast("Сохранено на устройстве · уйдёт при появлении связи");
      } else {
        setProduct((p) => ({
          ...p,
          favorites: add ? p.favorites.filter((x) => x !== id) : [...p.favorites, id],
        }));
        setToast(e instanceof Error ? e.message : "Не удалось обновить избранное");
      }
    } finally {
      pendingFavorites.current.delete(id);
    }
  };

  const saveRoutine = async (routine: Routine) => {
    const result = await productService.saveRoutine(routine);
    setProduct((p) => ({
      ...p,
      routines: [result.routine, ...p.routines.filter((r) => r.id !== result.routine.id)],
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

  const deleteRoutines = async (routinesToDelete: Routine[]) => {
    const deletedIds = new Set<string>();
    try {
      for (const routine of routinesToDelete) {
        await productService.deleteRoutine(routine);
        deletedIds.add(routine.id);
      }
    } finally {
      if (deletedIds.size > 0) {
        setProduct((p) => ({
          ...p,
          routines: p.routines.filter((r) => !deletedIds.has(r.id)),
        }));
      }
    }
    if (deletedIds.size > 0) {
      setToast(
        deletedIds.size === 1
          ? "Программа удалена"
          : `Удалено программ: ${deletedIds.size}`,
      );
    }
  };

  const replaceRoutines = async (toDelete: Routine[], toCreate: Routine[]) => {
    if (product.routines.length + toCreate.length > 50) {
      const over = product.routines.length + toCreate.length - 50;
      throw new Error(
        `Нельзя безопасно заменить программы при лимите 50: сначала удали хотя бы ${quantity(over, "программу", "программы", "программ")}.`,
      );
    }
    const deletedIds = new Set<string>();
    const created: Routine[] = [];
    try {
      for (const r of toCreate) {
        const res = await productService.saveRoutine(r);
        created.push(res.routine);
      }
      for (const r of toDelete) {
        await productService.deleteRoutine(r);
        deletedIds.add(r.id);
      }
    } finally {
      if (created.length > 0 || deletedIds.size > 0) {
        setProduct((p) => {
          const createdIds = new Set(created.map((r) => r.id));
          return {
            ...p,
            routines: [
              ...created,
              ...p.routines.filter((r) => !deletedIds.has(r.id) && !createdIds.has(r.id)),
            ],
          };
        });
      }
    }
    setToast("Программа заменена");
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
    if (draft && !canEditWorkout()) return;
    if (!draft) {
      if (tabs.takeStored()) {
        go("workout");
        return;
      }
      start();
    }
    setMuscleFilter("all");
    setModal("picker");
  };

  const discardDraft = () => {
    if (!tabs.closeDraft()) return;
    setConflict(null);
    setSaveError("");
    setModal(null);
    go("overview");
  };

  const saveWorkout = async () => {
    if (!draft || saving) return;
    const stillEditing = tabs.guardEdit();
    if (!stillEditing) return;
    setSaving(true);
    setSaveError("");
    if (!new WorkoutSession(draft.workout).completedWorkingSets) {
      setSaveError("Отметь хотя бы один выполненный рабочий подход.");
      setSaving(false);
      return;
    }
    const { workout: performed, removed } = new WorkoutSession(draft.workout).withoutUnperformed();
    const isBackdated = BackdatedWorkout.isBackdated(draft, settings.timeZone);
    const autoDuration = draft.editing
      ? draft.workout.duration
      : isBackdated
        ? Math.max(
            10,
            Math.round(
              performed.exercises.reduce(
                (sum, ex) =>
                  sum +
                  ex.sets.reduce((sSum, s) => sSum + (s.done ? (s.warmup ? 1.5 : 3) : 0), 0),
                0,
              ),
            ),
          )
        : Math.max(1, Math.round(elapsedMs(draft) / 60000));
    const workout = new WorkoutSession(performed).completedWithDuration(autoDuration);
    try {
      let result: { workout: Workout };
      try {
        result = await api<{ workout: Workout }>("/api/workouts", "PUT", workout);
      } catch (e) {
        if (!stillEditing()) {
          warn(
            "Черновик изменился, пока сохранялась тренировка. Проверь подходы и нажми «Завершить» снова.",
          );
          return;
        }
        if (PendingWorkouts.isRetryable(e) && pending.enqueue(workout)) {
          if (!tabs.closeDraft()) {
            warn("Тренировка сохранена в очереди, но текущий черновик изменился в другом окне.");
            return;
          }
          setConflict(null);
          setSaveError("");
          go("history");
          warn(
            "Нет связи: тренировка сохранена на устройстве и ждёт отправки. Уйдёт сама, когда появится связь.",
          );
          return;
        }
        throw e;
      }
      const savedWhileEditing = stillEditing() && tabs.closeDraft();
      if (savedWhileEditing) {
        pending.queue.remove(workout.id);
        pending.sync();
      }
      setWorkouts((ws) =>
        [result.workout, ...ws.filter((w) => w.id !== result.workout.id)].sort((a, b) =>
          b.date.localeCompare(a.date),
        ),
      );
      if (!savedWhileEditing) {
        warn("Запись сохранена. Более свежий черновик не изменён.");
        return;
      }
      setConflict(null);
      setDemo(false);
      setJustSaved(result.workout);
      if (!draft.editing) {
        LiveFinished.write(account.id, result.workout.id);
        live.finish(
          LiveStateBuilder.fromWorkout(result.workout, {
            now: Date.now(),
            nameOf: entryName,
            finished: true,
          }),
        );
      } else {
        const next = LiveBroadcastPolicy.afterEdit(
          live.room?.members.find((member) => member.isMe),
          result.workout,
          LiveFinished.read(account.id),
          Date.now(),
          entryName,
        );
        if (next) live.finish(next);
      }
      if (draft.meetupId && !draft.editing) {
        const meetupId = draft.meetupId,
          gym = draft.meetupGym ?? "";
        void (async () => {
          if (import.meta.env.MODE === "device")
            await (await import("./device/cloudSync")).syncCloud();
          await friendsApi.request(`/api/friends/meetups/${meetupId}`, "PUT", {
            action: "finish",
            workoutId: result.workout.id,
            gym,
          });
          setToast("Тренировка сохранена, общий итог обновлён");
        })().catch(() =>
          setToast("Тренировка сохранена. Добавь общий итог в разделе друзей, когда появится связь."),
        );
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
    if (draft || tabs.takeStored()) {
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
      pending.queue.remove(deleteId);
      pending.sync();
      setDeleteId(null);
      setDetail(null);
      setToast("Тренировка удалена");
      return;
    }
    setSaving(true);
    try {
      const revision = workouts.find((w) => w.id === deleteId)?.revision ?? 0;
      await api("/api/workouts/" + encodeURIComponent(deleteId), "DELETE", { revision });
      setWorkouts((ws) => ws.filter((w) => w.id !== deleteId));
      setDeleteId(null);
      setDetail(null);
      setToast("Тренировка удалена");
    } catch (e) {
      const revision = workouts.find((w) => w.id === deleteId)?.revision ?? 0;
      if (OfflineMutationQueue.isRetryable(e) && mutationQueue.enqueue({
        key: `workout-delete:${deleteId}`,
        path: "/api/workouts/" + encodeURIComponent(deleteId),
        method: "DELETE",
        body: { revision },
      })) {
        setQueuedMutations(mutationQueue.read().length);
        setWorkouts((ws) => ws.filter((w) => w.id !== deleteId));
        setDeleteId(null);
        setDetail(null);
        setToast("Удаление поставлено в очередь · применится при появлении связи");
      } else {
        if (e instanceof ApiError && e.status === 409 && e.data.current) {
          const current = e.data.current;
          setWorkouts((ws) => ws.map((w) => (w.id === current.id ? current : w)));
          setDetail(current);
          setDeleteId(null);
        }
        setToast(e instanceof Error ? e.message : "Ошибка удаления");
      }
    } finally {
      setSaving(false);
    }
  };

  const undoImport = async (run: string | undefined) => {
    if (!run || saving) return;
    setSaving(true);
    try {
      const result = await importService.undo(run);
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
      warn(
        e instanceof Error
          ? `Не удалось отменить импорт: ${e.message}. Нажми ещё раз.`
          : "Не удалось отменить импорт",
      );
    } finally {
      setSaving(false);
    }
  };

  const exportHistory = () =>
    saveFile(
      `tyaga-${localDate()}.json`,
      JSON.stringify(
        JournalBackup.create(
          workouts,
          settings,
          product,
          { entries: weights.tracker.getEntries(), goal: weights.tracker.getGoal() },
          getCurrentTheme(),
          {
            displayName: account.displayName,
            timeZone: account.timeZone,
            bodyMassKg: weights.massAt(localDate(new Date(), account.timeZone), account.bodyMassKg),
          },
        ),
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
      const result = await api<{ settings: Settings }>("/api/settings", "PUT", settingsDraft);
      setSettings(result.settings);
      setModal(null);
      setToast("Ориентиры обновлены");
    } catch (e) {
      if (OfflineMutationQueue.isRetryable(e) && mutationQueue.enqueue({
        key: "settings",
        path: "/api/settings",
        method: "PUT",
        body: settingsDraft,
      })) {
        setQueuedMutations(mutationQueue.read().length);
        setSettings(settingsDraft);
        setModal(null);
        setToast("Ориентиры сохранены локально · уйдут при появлении связи");
      } else {
        if (e instanceof ApiError && e.status === 409 && e.data.settings) setSettings(e.data.settings);
        setSaveError(e instanceof Error ? e.message : "Ошибка сохранения");
      }
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

  useTrainingTools({
    draft,
    workouts,
    loads: realLoads,
    settings,
    stage: (workout) => start([], undefined, workout),
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
        accountId={account.id}
        onAdd={addExercise}
        onDetail={setExerciseDetail}
        selectedIds={draft?.workout.exercises.map((e) => e.exerciseId) ?? []}
        limitReached={(draft?.workout.exercises.length ?? 0) >= 30}
        defaultMuscle={muscleFilter}
        personal={product.customExercises}
        favorites={product.favorites}
        workouts={workouts}
        onFavorite={(id) => void favoriteExercise(id)}
        onCreate={createPersonal}
        onEdit={editPersonal}
        onMarked={markExercises}
        catalogGaps={catalogGaps}
        startMarking={startMarking && !picker}
      />
    </Suspense>
  );

  const currentYear = today.slice(0, 4);
  const sessionItem = (w: Workout, expanded = false, index = 0, records?: string[]) => (
    <SessionCard
      key={w.id}
      workout={w}
      expanded={expanded}
      index={index}
      records={records}
      currentYear={currentYear}
      pendingIds={pending.ids}
      enter={enter}
      onOpen={setDetail}
    />
  );

  return (
    <div
      className={`app-shell ${view === "workout" && draft ? "in-workout" : ""} ${draft && view !== "workout" && view !== "overview" ? "has-resume" : ""}`}
    >
      <AppSidebar
        view={view}
        reduceMotion={reduceMotion}
        onNavigate={go}
        onOpenTools={() => setModal("tools")}
      />
      <main className="main-content">
        <AppTopbar
          account={account}
          view={view}
          onNavigate={go}
          onOpenTools={() => setModal("tools")}
          onOpenProfile={() => setModal("profile")}
        />
        <TabErrorBoundary resetKey={view}>
          <m.div
            className="page-content"
            data-view={view}
            key={view}
            initial={reduceMotion ? false : { opacity: 0.45, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
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
                  Не удалось удалить локальный черновик. Сохранённая история на месте; проверь
                  черновик после перезапуска.
                </span>
              </div>
            ) : null}
            {offlineData ? (
              <div className="offline-banner" role="status">
                <Info size={18} />
                <span>
                  Нет связи: показаны данные с этого устройства.
                  {draft
                    ? " Начатая тренировка хранится на устройстве; нажми «Завершить» — без связи она встанет в очередь и уйдёт сама."
                    : ""}
                </span>
                <button className="text-button" onClick={() => void load()}>
                  Обновить
                </button>
              </div>
            ) : null}
            {pending.items.length ? (
              <div
                className={
                  pendingError ? "error-banner pending-banner" : "offline-banner pending-banner"
                }
                role="status"
              >
                <Info size={18} />
                <span>
                  {pending.items.length === 1
                    ? "Ждёт отправки: 1 тренировка."
                    : `Ждут отправки: ${pending.items.length}.`}{" "}
                  {pendingError
                    ? `Сервер не принял: ${pendingError.replace(/[.\s]+$/, "")}. Тренировка осталась на устройстве.`
                    : "Она сохранена на устройстве и уйдёт сама, когда появится связь."}
                </span>
                <button
                  className="text-button"
                  disabled={saving}
                  onClick={() => void pending.flush(true)}
                >
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
                        Так будет выглядеть твой прогресс. Эти тренировки не сохранены.
                      </span>
                    </span>
                    <button onClick={() => setDemo(false)}>
                      Мои данные
                      <X size={14} />
                    </button>
                  </div>
                ) : null}
                {!draft && legacyDraft && (
                  <div className="intro-banner">
                    <Dumbbell size={18} />
                    <span>На устройстве есть черновик прежней версии.</span>
                    <button
                      className="text-button"
                      onClick={() => {
                        if (tabs.takeStored()) {
                          go("workout");
                          return;
                        }
                        restoredLegacyId.current = legacyDraft.workout.id;
                        setDraft(legacyDraft);
                        setDemo(false);
                        go("workout");
                      }}
                    >
                      Продолжить старый черновик
                    </button>
                  </div>
                )}

                {view === "overview" ? (
                  <>
                    <header className="today-head">
                      <h1>Сегодня</h1>
                      <time className="today-date" dateTime={today}>
                        <CalendarDays size={16} aria-hidden="true" />
                        {new Date(today + "T12:00:00")
                          .toLocaleDateString("ru-RU", {
                            weekday: "long",
                            day: "numeric",
                            month: "long",
                          })
                          .replace(/^./u, (letter) => letter.toLocaleUpperCase("ru-RU"))}
                      </time>
                    </header>
                    <TodayDashboard
                      timeZone={settings.timeZone}
                      accountId={account.id}
                      bodyMassKg={weights.massAt(today, account.bodyMassKg)}
                      workouts={workouts}
                      routines={product.routines}
                      supplements={supplements}
                      today={today}
                      now={liveNow}
                      recent={displayed
                        .slice(0, 2)
                        .map((workout, index) => sessionItem(workout, false, index))}
                      hasRecent={displayed.length > 0}
                      draft={draft?.workout}
                      draftObj={draft}
                      plan={todayPlan}
                      completed={completedToday}
                      sources={todaySources}
                      hasPrograms={product.routines.length > 0}
                      nextProgram={
                        nextSlot
                          ? `${DAY_NAMES[calendarWeekday(nextSlot.date)]} · ${nextSlot.routine.name}`
                          : undefined
                      }
                      deloadLine={DeloadHint.line(deload, today)}
                      deload={deload}
                      load={{
                        done: weekDone,
                        goal: weekGoal,
                        growthZones: weekGrowthZones,
                        maintenanceZones: weekMaintenanceZones,
                        totalZones: currentLoads.length,
                      }}
                      onStart={() => {
                        if (draft) go("workout");
                        else if (todaySlot)
                          start([], undefined, programWorkout(todaySlot.routine, todaySlot));
                        else start();
                      }}
                      onOpenWorkout={setDetail}
                      onEmpty={() => start()}
                      onPrograms={() => go("programs")}
                      onProgress={() => {
                        setProgressTab("balance");
                        setWeekOffset(0);
                        go("progress");
                      }}
                      onProgressOverview={() => {
                        setProgressTab("analytics");
                        go("progress");
                      }}
                      onOpenCoach={() => {
                        setProgressTab("coach");
                        go("progress");
                      }}
                      onOpenSupplements={() => go("supplements")}
                      onHistory={() => go("history")}
                      onQuickTool={(tool) => setModal(tool)}
                    />
                  </>
                ) : null}

                {view === "supplements" ? (
                  <Suspense fallback={<p role="status">Открываем добавки…</p>}>
                    <SupplementsScreen
                      state={supplements}
                      today={today}
                      onChange={updateSupplements}
                    />
                  </Suspense>
                ) : null}

                {view === "workout" ? (
                  <>
                    {draft && tabs.banner ? (
                      <div
                        className={`draft-follower ${workoutReadOnly ? "is-follower" : "is-owner"}`}
                      >
                        <span className="draft-follower-text" role="status">
                          <span>
                            {workoutReadOnly
                              ? "Эта тренировка открыта в другом окне — здесь только просмотр."
                              : "Это окно основное — изменения сохраняются"}
                          </span>
                        </span>
                        <div className="draft-follower-actions" inert={!workoutReadOnly}>
                          <button
                            type="button"
                            className="button secondary"
                            onClick={() => go("overview")}
                          >
                            К журналу
                          </button>
                          <button
                            type="button"
                            className="button primary"
                            onClick={() => {
                              if (tabs.openHere() === "claimed")
                                requestAnimationFrame(() =>
                                  workoutFrame.current?.focus({ preventScroll: true }),
                                );
                            }}
                          >
                            Продолжить здесь
                          </button>
                        </div>
                      </div>
                    ) : null}
                    <section
                      className="workout-edit-frame"
                      ref={workoutFrame}
                      inert={workoutReadOnly}
                      tabIndex={-1}
                      aria-label="Редактор тренировки"
                    >
                      <Suspense fallback={<p role="status">Открываем тренировку…</p>}>
                        <WorkoutView
                        deloadMode={deload?.mode}
                        deloadPlan={deload}
                        routines={product.routines}
                        focusRequest={restNotification.focus}
                        notificationError={restNotification.error}
                        draft={draft}
                        readOnly={workoutReadOnly}
                        update={updateWorkoutDraft}
                        settings={settings}
                        history={workouts}
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
                        accountId={account.id}
                        onSwapInProgram={(routineId, oldExerciseId, newExercise, scope, avoidReason) => {
                          const targetRoutine = product.routines.find((r) => r.id === routineId);
                          if (!targetRoutine) return;
                          const p = LaidDupPlan.periodizationOf(targetRoutine);
                          if (p) {
                            const cycle = LaidDupPlan.cycleOf(product.routines, targetRoutine);
                            if (!cycle.length) return;
                            const curSubs = { ...(p.substitutions ?? {}) };
                            // Находим исходный слот (если упражнение уже было заменой)
                            const origSlot =
                              Object.entries(curSubs).find(([, v]) => v === oldExerciseId)?.[0] ?? oldExerciseId;
                            curSubs[origSlot] = newExercise.id;
                            const lift = (["squat", "bench", "deadlift", "ohp"] as const).find(
                              (l) =>
                                LaidDupPlan.baseLiftExerciseId(l, p.version) === origSlot ||
                                (p.version === "v3" && l === "deadlift" && origSlot === "rdl"),
                            );
                            const painFlags =
                              lift && avoidReason === "pain"
                                ? [...new Set([...(p.painFlags ?? []), lift])]
                                : p.painFlags;
                            const state = LaidDupPlan.cycleState(cycle, workouts, today);
                            const updated = LaidDupPlan.withSubstitutions(cycle, curSubs, {
                              fromWeek: state.position.beforeStart ? 0 : state.position.week,
                              painFlags,
                            });
                            void (async () => {
                              try {
                                const saved: Routine[] = [];
                                for (const r of updated) saved.push((await productService.saveRoutine(r)).routine);
                                setProduct((prev) => ({
                                  ...prev,
                                  routines: [...saved, ...prev.routines.filter((r) => !saved.some((s) => s.id === r.id))],
                                }));
                                setToast(
                                  scope === "avoid"
                                    ? "Заменено во всём цикле Лейда и скрыто из рекомендаций"
                                    : "Замена применена ко всем дням цикла Лейда",
                                );
                              } catch {
                                setToast("В текущей тренировке заменено; не удалось обновить программу");
                              }
                            })();
                          } else {
                            const nextRoutine: Routine = {
                              ...targetRoutine,
                              exercises: targetRoutine.exercises.map((e) =>
                                e.exerciseId === oldExerciseId
                                  ? {
                                      ...makeExerciseEntry(newExercise.id),
                                      sets: e.sets.map((s) => ({ ...s, id: crypto.randomUUID(), weight: 0, done: false })),
                                      repMin: e.repMin,
                                      repMax: e.repMax,
                                    }
                                  : e,
                              ),
                            };
                            void productService
                              .saveRoutine(nextRoutine)
                              .then((res) => {
                                setProduct((prev) => ({
                                  ...prev,
                                  routines: prev.routines.map((r) => (r.id === res.routine.id ? res.routine : r)),
                                }));
                                setToast(
                                  scope === "avoid"
                                    ? "Заменено в программе и скрыто из рекомендаций"
                                    : "Замена сохранена в программе",
                                );
                              })
                              .catch(() => setToast("В текущей тренировке заменено; не удалось обновить программу"));
                          }
                        }}
                      />
                      </Suspense>
                    </section>
                  </>
                ) : null}

                {view === "history" ? (
                  <Suspense fallback={<p role="status">Открываем историю…</p>}>
                    <HistoryScreen
                      account={account}
                      settings={settings}
                      displayed={displayed}
                      workouts={workouts}
                      monthWorkouts={monthWorkouts}
                      currentYear={currentYear}
                      justSaved={justSaved}
                      pendingImport={pendingImport}
                      lastImport={lastImport}
                      lastImportRun={lastImportRun}
                      lastNoop={lastNoop}
                      undoAsk={undoAsk}
                      saving={saving}
                      onUndoAskChange={setUndoAsk}
                      onUndoImport={(runId) => void undoImport(runId)}
                      onHideImportBanner={() => setLastImportRun(null)}
                      onOpenImport={() => setModal("import")}
                      onExportHistory={() => void exportHistory()}
                      onStartBackdated={() => start([], undefined, undefined, true)}
                      renderSession={(w, records) => sessionItem(w, true, 0, records)}
                    />
                  </Suspense>
                ) : null}

                {view === "progress" ? (
                  <Suspense fallback={<p role="status">Открываем прогресс…</p>}>
                    <ProgressScreen
                      accountId={account.id}
                      bodyMassKg={weights.massAt(today, account.bodyMassKg)}
                      displayed={displayed}
                      workouts={workouts}
                      routines={product.routines}
                      customExercises={product.customExercises}
                      settings={settings}
                      today={today}
                      deload={deload}
                      progressTab={progressTab}
                      onProgressTabChange={setProgressTab}
                      weekOffset={weekOffset}
                      onWeekOffsetChange={setWeekOffset}
                      mapping={mapping}
                      onMappingChange={setMapping}
                      onOpenMethod={() => setModal("method")}
                      onOpenSettings={openSettings}
                      onOpenExerciseDetail={setExerciseDetail}
                      onOpenLibraryWithMuscle={(zone, marking) => {
                        setMuscleFilter(zone);
                        setStartMarking(Boolean(marking));
                        go("library");
                      }}
                      onStartExercise={(id) => start([id])}
                    />
                  </Suspense>
                ) : null}

                {view === "library" ? (
                  <>
                    <header className="screen-head">
                      <h1>Упражнения</h1>
                    </header>
                    {exerciseCards()}
                  </>
                ) : null}

                {view === "friends" && (
                  <Suspense fallback={<p role="status">Открываем друзей…</p>}>
                    <FriendsScreen
                      onProfile={() => setModal("profile")}
                      workouts={workouts}
                      routines={product.routines}
                      timeZone={settings.timeZone ?? browserTimeZone()}
                      roomInvite={roomInvite}
                      onRoomInviteHandled={() => setRoomInvite(null)}
                      onToast={setToast}
                      workoutActive={!!draft}
                      onWorkout={() => (draft ? go("workout") : start())}
                      onSaveRoutine={saveRoutine}
                      onStartRoutine={(routine) => start([], undefined, programWorkout(routine))}
                      onOpenPrograms={() => go("programs")}
                    />
                  </Suspense>
                )}

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
                        accountId={account.id}
                        minorMode={settings.minorMode}
                        personal={product.customExercises}
                        favorites={product.favorites}
                        onFavorite={(id) => void favoriteExercise(id)}
                        onSave={saveRoutine}
                        onDelete={deleteRoutine}
                        onDeleteMany={deleteRoutines}
                        onReplaceRoutines={replaceRoutines}
                        onStart={(routine, slot) => {
                          const occurrence =
                            slot ??
                            todaySlots.find(
                              (item) =>
                                item.routine.id === routine.id &&
                                !TrainingCalendar.completed(item, workouts),
                            );
                          start([], undefined, programWorkout(routine, occurrence));
                        }}
                        onOpenWorkout={setDetail}
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
        </TabErrorBoundary>
      </main>

      <AppOverlays
        draft={draft}
        view={view}
        timeZone={settings.timeZone}
        notice={notice}
        onResume={() => go("workout")}
        onDismissToast={() => setToast("")}
      />

      <AppModals
        account={account}
        onAccountChange={onAccountChange}
        onLogout={onLogout}
        modal={modal}
        setModal={setModal}
        importBusy={importBusy}
        setImportBusy={setImportBusy}
        draft={draft}
        setDraft={setDraft}
        workouts={workouts}
        displayed={displayed}
        setWorkouts={setWorkouts}
        product={product}
        setProduct={setProduct}
        settings={settings}
        settingsDraft={settingsDraft}
        setSettingsDraft={setSettingsDraft}
        saving={saving}
        saveError={saveError}
        setSaveError={setSaveError}
        demo={demo}
        setDemo={setDemo}
        today={today}
        mapping={mapping}
        deload={deload}
        onApplyDeload={(mode) => {
          const result = deloadStore.apply(mode, today, product.routines);
          if (result.applied) setDeload(result.record);
          return result;
        }}
        onCancelDeload={() => {
          deloadStore.cancel();
          setDeload(null);
        }}
        pendingCount={pending.items.length + queuedMutations}
        detail={detail}
        setDetail={setDetail}
        setJustSaved={setJustSaved}
        deleteId={deleteId}
        setDeleteId={setDeleteId}
        personalEditor={personalEditor}
        exerciseDetail={exerciseDetail}
        setExerciseDetail={setExerciseDetail}
        conflict={conflict}
        setConflict={setConflict}
        canEditWorkout={canEditWorkout}
        renderPicker={() => exerciseCards(true)}
        onNavigate={go}
        onOpenSettings={openSettings}
        onSaveSettings={saveSettings}
        onDeleteWorkout={deleteWorkout}
        onEditWorkout={editWorkout}
        onStartWorkout={start}
        onAddExercise={addExercise}
        onCreateProgramFromWorkout={setInitialRoutine}
        onExportHistory={exportHistory}
        onExportDraft={exportDraft}
        onReload={() => load()}
        onImportCompleteState={(record, noopKind, runs) => {
          if (record) {
            importUndo.save(record);
            setLastImport(record);
            setLastImportRun(runs.last);
            setPendingImport(runs.pending);
            setUndoAsk(false);
            setLastNoop(null);
          } else if (noopKind) {
            setLastNoop({ at: new Date().toISOString(), kind: noopKind });
          }
        }}
        onToast={setToast}
      />
    </div>
  );
}
