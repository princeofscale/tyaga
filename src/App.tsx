import {
  useCallback,
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useState,
  useRef,
  type ReactNode,
} from "react";
import {
  Activity,
  ScanLine,
  BarChart3,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Download,
  Dumbbell,
  Flame,
  History,
  Info,
  LayoutDashboard,
  Menu,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Target,
  Trash2,
  TrendingUp,
  Trophy,
  X,
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
import BodyMap, { loadColor } from "./components/BodyMap";
import { VolumeChart, Sparkline } from "./components/Charts";
import Modal from "./components/Modal";
import WorkoutView from "./components/WorkoutView";
import { m } from "motion/react";
const AnatomyExplorer = lazy(() => import("./components/AnatomyExplorer"));
const ExerciseLibrary = lazy(() => import("./components/ExerciseLibrary"));
const ProgramsScreen = lazy(() => import("./components/ProgramsScreen"));
const PersonalExerciseEditor = lazy(
  () => import("./components/PersonalExerciseEditor"),
);
const HistoryImporter = lazy(() => import("./components/HistoryImporter"));
import ExerciseInfo from "./components/ExerciseInfo";
import {
  readDraft,
  persistDraft,
  checkpointDraft,
  elapsedMs,
  newDraft,
  type Draft,
  type PersistenceStatus,
} from "./lib/draft";
import { WorkoutSession } from "./domain/WorkoutSession";
import { api, ApiError } from "./services/ApiClient";
import { productService } from "./services/ProductService";
import { TrainingProgram } from "./domain/TrainingProgram";
import { useTrainingTools } from "./lib/webmcp";

type View =
  "overview" | "workout" | "history" | "library" | "progress" | "anatomy";
type ProductView = View | "programs";
const NAV = [
  { id: "overview", label: "Обзор", icon: LayoutDashboard },
  { id: "workout", label: "Тренировка", icon: Dumbbell },
  { id: "programs", label: "Программы", icon: CalendarDays },
  { id: "anatomy", label: "Анатомия", icon: ScanLine },
  { id: "history", label: "История", icon: History },
  { id: "library", label: "Упражнения", icon: Activity },
  { id: "progress", label: "Прогресс", icon: BarChart3 },
] as const;
const EQ = {
  gym: "Весь зал",
  dumbbells: "Гантели",
  bodyweight: "Без оборудования",
};
const dateLabel = (date: string, long = false) =>
  new Date(date + "T12:00:00").toLocaleDateString("ru-RU", {
    day: "numeric",
    month: long ? "long" : "short",
  });
export default function App() {
  const [view, setView] = useState<ProductView>("overview");
  const [product, setProduct] = useState<ProductData>({
    routines: [],
    customExercises: [],
    favorites: [],
  });
  const [personalEditor, setPersonalEditor] = useState<Exercise | undefined>();
  const [initialRoutine, setInitialRoutine] = useState<Routine | null>(null);
  const pendingFavorites = useRef(new Set<string>());
  const [importBusy, setImportBusy] = useState(false);
  const [workouts, setWorkouts] = useState<Workout[]>([]);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [demo, setDemo] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(readDraft);
  const [persistence, setPersistence] = useState<PersistenceStatus>("pending");
  const [conflict, setConflict] = useState<{ current: Workout | null } | null>(
    null,
  );
  const [mapping, setMapping] = useState<"recorded" | "current">("recorded");
  const [hardSetsOnly, setHardSetsOnly] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  const [toast, setToast] = useState("");
  const [modal, setModal] = useState<
    | "picker"
    | "planner"
    | "settings"
    | "method"
    | "discard"
    | "personal"
    | "import"
    | null
  >(null);
  const [detail, setDetail] = useState<Workout | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [muscleFilter, setMuscleFilter] = useState<Muscle | "all">("all");
  const [selectedMuscle, setSelectedMuscle] = useState<Muscle | null>(null);
  const [weekOffset, setWeekOffset] = useState(0);
  const [minutes, setMinutes] = useState(40);
  const [planEquipment, setPlanEquipment] = useState<Equipment>("gym");
  const [excluded, setExcluded] = useState<Muscle[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [progressExercise, setProgressExercise] = useState(
    progressKey({ ...entrySpec("bench"), sets: [] }),
  );
  const [historySearch, setHistorySearch] = useState("");
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
      exerciseCatalog.register([
        ...productData.customExercises,
        ...(productData.favoriteDefinitions ?? []),
      ]);
      setProduct(productData);
      setWorkouts(data.workouts);
      setSettings({
        ...data.settings,
        timeZone: data.settings.timeZone ?? browserTimeZone(),
      });
      setPlanEquipment(data.settings.equipment);
      setDemo(data.workouts.length === 0);
    } catch (e) {
      if (e instanceof Error && e.name !== "AbortError")
        setLoadError(e.message);
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);
  useEffect(() => {
    try {
      setPersistence(persistDraft(localStorage, draft));
    } catch {
      setPersistence("failed");
    }
  }, [draft]);
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
    () => ({ mapping, ...(hardSetsOnly ? { maxRir: 3 } : {}) }),
    [mapping, hardSetsOnly],
  );
  const loads = useMemo(
    () => muscleLoad(weekWorkouts, settings, analysisOptions),
    [weekWorkouts, settings, analysisOptions],
  );
  const anatomy = useMemo(
    () => anatomicalLoad(weekWorkouts, analysisOptions),
    [weekWorkouts, analysisOptions],
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
  const lowMuscles = [...loads]
    .sort((a, b) => a.ratio - b.ratio)
    .filter((m) => m.ratio < 0.8);
  const monthWorkouts = displayed.filter((w) => {
    const today = localDate(new Date(), settings.timeZone);
    return w.date >= addCalendarDays(today, -27) && w.date <= today;
  });
  const go = (v: ProductView) => {
    setView(v);
    setMobileNav(false);
    window.scrollTo({ top: 0, behavior: "instant" });
  };
  const start = (ids: string[] = [], name?: string, template?: Workout) => {
    if (draft) {
      go("workout");
      setToast("У тебя уже есть черновик. Продолжи или отмени его.");
      setModal(null);
      return;
    }
    const workout = template ?? makeWorkout(ids, workouts, settings.timeZone);
    if (name) workout.name = name;
    setDraft(newDraft(workout));
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
              makeExerciseEntry(id, workouts),
            ),
          }
        : null,
    );
    setToast("Упражнение добавлено");
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
  const saveWorkout = async () => {
    if (!draft || saving) return;
    setSaving(true);
    setSaveError("");
    if (!new WorkoutSession(draft.workout).completedWorkingSets) {
      setSaveError("Отметь хотя бы один выполненный рабочий подход.");
      setSaving(false);
      return;
    }
    const workout = new WorkoutSession(draft.workout).completedWithDuration(
      draft.manualDuration
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
      const result = await api<{ workout: Workout }>(
        "/api/workouts",
        "PUT",
        workout,
      );
      setWorkouts((ws) =>
        [result.workout, ...ws.filter((w) => w.id !== result.workout.id)].sort(
          (a, b) => b.date.localeCompare(a.date),
        ),
      );
      setDraft(null);
      setConflict(null);
      setDemo(false);
      go("history");
      setToast(
        draft.editing
          ? "Изменения сохранены"
          : "Тренировка сохранена. Хорошая работа!",
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
    if (draft) {
      setDetail(null);
      go("workout");
      setToast("Сначала заверши или отмени текущий черновик.");
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
  const exportHistory = () => {
    const blob = new Blob(
      [
        JSON.stringify(
          {
            version: 3,
            analysisVersion: 2,
            e1rmFormulaVersion: "epley-1",
            exportedAt: new Date().toISOString(),
            workouts,
            settings,
            routines: product.routines,
            customExercises: product.customExercises,
            favorites: product.favorites,
          },
          null,
          2,
        ),
      ],
      { type: "application/json" },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `tyaga-${localDate()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setToast("Твои данные выгружены. Примеры в файл не входят.");
  };
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
    if (!draft) return;
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(draft, null, 2)], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "tyaga-draft.json";
    a.click();
    URL.revokeObjectURL(url);
  };
  const historyFiltered = displayed.filter((w) =>
    `${w.name} ${w.exercises.map((e) => entryName(e)).join(" ")}`
      .toLowerCase()
      .includes(historySearch.toLowerCase()),
  );
  const progressOptions = [
    ...new Map(
      [
        ...EXERCISES.map(
          (e) => ({ ...entrySpec(e.id), sets: [] }) as WorkoutExercise,
        ),
        ...displayed.flatMap((w) => w.exercises),
      ].map((we) => [progressKey(we), we]),
    ).entries(),
  ].map(([key, we]) => ({ key, we }));
  const progressEntry = progressOptions.find((o) => o.key === progressExercise)
    ?.we ?? { ...entrySpec("bench"), sets: [] };
  const progressSpec = exerciseForEntry(progressEntry)!.recording;
  const progressPoints = displayed
    .filter((w) => w.exercises.some((e) => progressKey(e) === progressExercise))
    .sort(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        (a.createdAt ?? "").localeCompare(b.createdAt ?? "") ||
        a.id.localeCompare(b.id),
    )
    .map((w) => {
      const we = w.exercises.find((e) => progressKey(e) === progressExercise)!;
      const sets = we.sets.filter((s) => s.done && !s.warmup);
      return {
        date: w.date,
        max: Math.max(
          0,
          ...sets.map((s) =>
            progressSpec.type === "duration"
              ? (s.durationSeconds ?? 0)
              : recordedLoad(we, s),
          ),
        ),
        e1rm: Math.max(0, ...sets.map((s) => estimatedOneRepMax(s, we) ?? 0)),
        reps: sets.reduce(
          (n, s) =>
            n +
            (progressSpec.type === "duration"
              ? (s.durationSeconds ?? 0)
              : s.reps),
          0,
        ),
        sets,
      };
    });
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
      />
    </Suspense>
  );
  const sessionItem = (w: Workout, expanded = false) => (
    <button className="session-item" key={w.id} onClick={() => setDetail(w)}>
      <div className="session-date">
        <b>{new Date(w.date + "T12:00:00").getDate()}</b>
        <span>
          {new Date(w.date + "T12:00:00")
            .toLocaleDateString("ru-RU", { month: "short" })
            .replace(".", "")}
        </span>
      </div>
      <div className="session-item-info">
        <h3>{w.name}</h3>
        <p>
          {w.exercises.length} упр. <span>·</span> {workingSets([w])} подходов{" "}
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
        <b title="Только однозначно записанные свободные веса">
          {fmt(volume([w]) / 1000)} т
        </b>
        <span>
          <Clock3 size={13} />
          {w.duration} мин
        </span>
      </div>
      <ChevronRight size={17} className="muted" />
    </button>
  );

  return (
    <div className="app-shell">
      {mobileNav ? (
        <button
          className="nav-scrim"
          aria-label="Закрыть меню"
          onClick={() => setMobileNav(false)}
        />
      ) : null}
      <aside className={`sidebar ${mobileNav ? "open" : ""}`}>
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            go("overview");
          }}
        >
          <span className="brand-mark">
            <Dumbbell size={26} strokeWidth={2.7} />
          </span>
          <span>
            тяга<span className="brand-period">.</span>
          </span>
        </a>
        <span className="sidebar-caption">ТРЕНИРОВОЧНЫЙ ЖУРНАЛ</span>
        <nav aria-label="Основная навигация">
          {NAV.map((n) => (
            <button
              className={`nav-item ${view === n.id ? "active" : ""}`}
              key={n.id}
              onClick={() => go(n.id)}
              aria-current={view === n.id ? "page" : undefined}
            >
              <n.icon size={20} />
              <span>{n.label}</span>
              {n.id === "workout" && draft ? <i className="draft-dot" /> : null}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-motto">
            <div className="motto-line" />
            <b>
              Сильнее.
              <br />С каждым подходом.
            </b>
          </div>
          <button className="nav-item" onClick={openSettings}>
            <Settings2 size={19} />
            Мои ориентиры
          </button>
          <button className="profile-button" onClick={openSettings}>
            <span className="profile-avatar">Т</span>
            <span>
              <b>Твой профиль</b>
              <small>
                <ShieldCheck size={12} />
                Личный журнал
              </small>
            </span>
            <SlidersHorizontal size={16} />
          </button>
        </div>
      </aside>
      <main className="main-content">
        <header className="topbar">
          <button
            className="mobile-menu icon-button"
            aria-label="Открыть меню"
            onClick={() => setMobileNav(true)}
          >
            <Menu size={22} />
          </button>
          <div className="breadcrumb">
            Мой зал<span>/</span>
            <b>{NAV.find((n) => n.id === view)!.label}</b>
          </div>
          <div className="topbar-right">
            <span className="local-date">
              <CalendarDays size={16} />
              {new Date().toLocaleDateString("ru-RU", {
                day: "numeric",
                month: "long",
                weekday: "short",
                timeZone: settings.timeZone,
              })}
            </span>
            <button
              className="icon-button"
              aria-label="Настройки целей"
              onClick={openSettings}
            >
              <Settings2 size={19} />
            </button>
          </div>
        </header>
        <m.div
          className="page-content"
          key={view}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.22 }}
        >
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                {view === "overview"
                  ? "МЕНЬШЕ ДОГАДОК. БОЛЬШЕ ПРОГРЕССА."
                  : "ТВОЙ ТРЕНИРОВОЧНЫЙ ЖУРНАЛ"}
              </div>
              <h1>
                {
                  {
                    overview: "Твой прогресс",
                    workout: draft?.editing
                      ? "Редактировать тренировку"
                      : "Твоя тренировка",
                    anatomy: "Анатомия движения",
                    history: "История тренировок",
                    library: "Библиотека упражнений",
                    progress: "Сила в цифрах",
                    programs: "Твои программы",
                  }[view]
                }
              </h1>
              <p>
                {
                  {
                    overview: "Каждый подход складывается в результат.",
                    workout: "Записывай подходы. Остальное посчитаем.",
                    anatomy:
                      "Выбери мышцу. Посмотри работу и упражнения для неё.",
                    history: "Вся работа, которую ты уже сделал.",
                    library: "Найди упражнение для своей следующей тренировки.",
                    progress:
                      "Сравнивай себя с собой. По одному упражнению за раз.",
                    programs:
                      "Собери неделю и начинай сессию из готового шаблона.",
                  }[view]
                }
              </p>
            </div>
            {view !== "workout" ? (
              <button
                className="button primary start-button"
                onClick={() => start()}
              >
                <Plus size={19} />
                {draft ? "Продолжить тренировку" : "Начать тренировку"}
              </button>
            ) : null}
          </div>
          {persistence === "failed" && !draft ? (
            <div className="error-banner" role="alert">
              <Info size={18} />
              <span>
                Браузер не смог удалить локальный черновик. Сохранённая история
                доступна в аккаунте; проверь черновик после перезагрузки.
              </span>
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
                      сохранены в твоём аккаунте.
                    </span>
                  </span>
                  <button onClick={() => setDemo(false)}>
                    Мои данные
                    <X size={14} />
                  </button>
                </div>
              ) : null}
              {!demo && !workouts.length && view !== "workout" ? (
                <div className="intro-banner">
                  <Dumbbell size={18} />
                  <span>
                    Здесь появится твоя история. Начни первую тренировку или
                    посмотри, как работает журнал.
                  </span>
                  <button className="text-button" onClick={() => setDemo(true)}>
                    Посмотреть пример
                  </button>
                </div>
              ) : null}
              {view === "overview" ? (
                <>
                  <div className="stats-grid">
                    <Stat
                      icon={<Dumbbell size={19} />}
                      label="Тренировок"
                      value={String(monthWorkouts.length).padStart(2, "0")}
                      meta="за последние 28 дней"
                    />
                    <Stat
                      icon={<BarChart3 size={19} />}
                      label="Рабочих подходов"
                      value={String(workingSets(weekWorkouts))}
                      meta="за выбранную неделю"
                    />
                    <Stat
                      icon={<TrendingUp size={19} />}
                      label="Внешний объём"
                      value={fmt(volume(weekWorkouts) / 1000)}
                      unit="т"
                      meta="свободные веса × повторы"
                    />
                    <Stat
                      icon={<Target size={19} />}
                      label="Покрытие ориентиров"
                      value={String(balanceScore(loads))}
                      unit="%"
                      meta="по прямым рабочим подходам"
                      accent
                    />
                  </div>
                  {product.routines.length ? (
                    <section className="today-programs panel">
                      <div>
                        <span className="eyebrow">СЕГОДНЯ ПО ПЛАНУ</span>
                        <h2>
                          {product.routines.some((r) =>
                            new TrainingProgram(r).scheduled(
                              localDate(new Date(), settings.timeZone),
                            ),
                          )
                            ? "Твоя следующая сессия"
                            : "День без назначенной программы"}
                        </h2>
                      </div>
                      <div>
                        {product.routines
                          .filter((r) =>
                            new TrainingProgram(r).scheduled(
                              localDate(new Date(), settings.timeZone),
                            ),
                          )
                          .map((r) => (
                            <button
                              key={r.id}
                              className="button primary"
                              onClick={() =>
                                start(
                                  [],
                                  undefined,
                                  new TrainingProgram(r).start(
                                    workouts,
                                    settings.timeZone ?? browserTimeZone(),
                                  ),
                                )
                              }
                            >
                              <Dumbbell size={17} />
                              {r.name}
                            </button>
                          ))}
                        <button
                          className="button secondary"
                          onClick={() => go("programs")}
                        >
                          Мой план
                        </button>
                      </div>
                    </section>
                  ) : null}
                  <div className="overview-grid">
                    <section className="panel muscle-panel">
                      <div className="panel-header">
                        <div>
                          <div className="card-eyebrow">
                            ВИДЕТЬ ПОЛНУЮ КАРТИНУ
                          </div>
                          <h2>Распределение подходов</h2>
                        </div>
                        <button
                          className="icon-button"
                          aria-label="Как считается нагрузка"
                          onClick={() => setModal("method")}
                        >
                          <Info size={18} />
                        </button>
                      </div>
                      <div className="week-selector">
                        <button
                          className="icon-button"
                          aria-label="Предыдущая неделя"
                          onClick={() => setWeekOffset((o) => o - 1)}
                        >
                          <ChevronLeft size={18} />
                        </button>
                        <span>
                          {dateLabel(anchor)} — {dateLabel(weekEnd)}
                          <small>
                            {weekOffset === 0
                              ? "Эта неделя"
                              : "Выбранная неделя"}
                          </small>
                        </span>
                        <button
                          className="icon-button"
                          aria-label="Следующая неделя"
                          disabled={weekOffset >= 0}
                          onClick={() => setWeekOffset((o) => o + 1)}
                        >
                          <ChevronRight size={18} />
                        </button>
                      </div>
                      <div className="analysis-controls">
                        <label>
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
                            <select
                              value={mapping}
                              onChange={(e) =>
                                setMapping(
                                  e.target.value as "recorded" | "current",
                                )
                              }
                            >
                              <option value="recorded">
                                Сохранённые версии
                              </option>
                              <option value="current">
                                Пересчёт по каталогу 2
                              </option>
                            </select>
                          </label>
                        ) : null}
                      </div>
                      <p className="analysis-notice">
                        Методика 2: считаем прямые подходы без RIR-множителей.
                        Помощь и стабилизация показаны отдельно.
                        {hasLegacy
                          ? " В старых записях оставлена разметка каталога 1; пересчёт меняет только этот вид. Пересчёт предполагает технику текущего канонического варианта. Неопределённые старые варианты сохраняют прежнюю разметку."
                          : ""}
                      </p>
                      <div className="muscle-content">
                        <BodyMap
                          loads={loads}
                          workouts={weekWorkouts}
                          options={analysisOptions}
                          selected={selectedMuscle}
                          onSelect={setSelectedMuscle}
                        />
                        <div className="muscle-list">
                          <div className="muscle-list-label">
                            <span>МЫШЦА</span>
                            <span>ПРЯМЫЕ / ОРИЕНТИР</span>
                          </div>
                          {loads.map((m) => (
                            <button
                              key={m.id}
                              className={`muscle-row ${selectedMuscle === m.id ? "selected" : ""}`}
                              onClick={() => setSelectedMuscle(m.id)}
                            >
                              <div className="muscle-row-heading">
                                <span>{m.short}</span>
                                <b>
                                  {fmt(m.total)}
                                  <small> / {m.goal}</small>
                                </b>
                              </div>
                              <div className="load-track">
                                <span
                                  style={{
                                    width: `${Math.min(m.ratio, 1) * 100}%`,
                                    background: loadColor(m.ratio),
                                  }}
                                />
                              </div>
                            </button>
                          ))}
                          {selectedMuscle ? (
                            <div className="muscle-detail">
                              <b>
                                {
                                  loads.find((m) => m.id === selectedMuscle)!
                                    .name
                                }
                              </b>
                              <p>
                                {fmt(
                                  loads.find((m) => m.id === selectedMuscle)!
                                    .direct,
                                )}{" "}
                                прямых ·{" "}
                                {fmt(
                                  loads.find((m) => m.id === selectedMuscle)!
                                    .indirect,
                                )}{" "}
                                с помощью ·{" "}
                                {fmt(
                                  loads.find((m) => m.id === selectedMuscle)!
                                    .stabilizing,
                                )}{" "}
                                со стабилизацией
                              </p>
                              <div className="anatomical-breakdown">
                                {anatomy
                                  .filter((m) => m.zone === selectedMuscle)
                                  .map((m) => (
                                    <div key={m.id}>
                                      <span>{m.name}</span>
                                      <small>
                                        {m.direct} прямых / {m.assisting} помощь
                                        / {m.stabilizing} стаб.
                                      </small>
                                    </div>
                                  ))}
                              </div>
                              {hasLegacy ? (
                                <p className="tiny">
                                  У записей каталога 1 нет разметки отдельных
                                  мышц.
                                </p>
                              ) : null}
                            </div>
                          ) : (
                            <p className="map-instruction">
                              Выбери зону, чтобы увидеть отдельные мышцы.
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="muscle-footnote">
                        <span className="tiny">
                          Зоны объединяют разные мышцы. Прямые подходы не
                          означают равный стимул для всех частей зоны.
                        </span>
                        <button className="text-button" onClick={openSettings}>
                          Мои ориентиры
                        </button>
                      </div>
                    </section>
                    <aside className="focus-column">
                      <section className="focus-card">
                        <div className="focus-top">
                          <span className="feature-tag">
                            <Sparkles size={14} />
                            БАЛАНС НЕДЕЛИ
                          </span>
                          <Target size={22} />
                        </div>
                        <h2>
                          {lowMuscles.length
                            ? "Закрой пробелы. Без лишнего."
                            : "Баланс — в твоих руках."}
                        </h2>
                        <p>
                          {lowMuscles.length
                            ? `Ниже твоих ориентиров: ${lowMuscles
                                .slice(0, 2)
                                .map((m) => m.short.toLowerCase())
                                .join(
                                  " и ",
                                )}. Соберём короткую тренировку с понятным «почему».`
                            : "Записанные прямые подходы покрывают выбранные ориентиры. Это не оценка восстановления или оптимальности программы."}
                        </p>
                        <div className="focus-muscles">
                          {lowMuscles.slice(0, 3).map((m) => (
                            <span key={m.id}>
                              {m.short}
                              <b>
                                {fmt(m.total)} / {m.goal}
                              </b>
                            </span>
                          ))}
                        </div>
                        <button
                          className="button focus-button"
                          onClick={() => {
                            setExcluded([]);
                            setModal("planner");
                          }}
                        >
                          Собрать тренировку
                          <SlidersHorizontal size={17} />
                        </button>
                        <span className="focus-note">
                          По нагрузке и доступному времени
                        </span>
                      </section>
                      <section className="panel week-card">
                        <div className="panel-header">
                          <h3>Твоя неделя</h3>
                          <CalendarDays size={17} className="muted" />
                        </div>
                        <div className="week-days">
                          {Array.from({ length: 7 }, (_, i) => {
                            const d = new Date(anchor + "T12:00:00");
                            d.setDate(d.getDate() + i);
                            const date = localDate(d);
                            const trained = weekWorkouts.some(
                              (w) => w.date === date,
                            );
                            return (
                              <div
                                className={`week-day ${trained ? "trained" : ""} ${date === localDate(new Date(), settings.timeZone) ? "today" : ""}`}
                                key={i}
                              >
                                <span>
                                  {
                                    ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"][
                                      i
                                    ]
                                  }
                                </span>
                                <b>
                                  {trained ? <Check size={15} /> : d.getDate()}
                                </b>
                              </div>
                            );
                          })}
                        </div>
                        <div className="week-card-footer">
                          <span>
                            <i className="training-dot" />
                            Тренировочные дни
                          </span>
                          <b>{weekWorkouts.length}</b>
                        </div>
                      </section>
                      <section className="quiet-tip">
                        <Flame size={19} />
                        <p>
                          Рост — это нагрузка,
                          <br />
                          восстановление и постоянство.
                        </p>
                      </section>
                    </aside>
                  </div>
                  <div className="bottom-grid">
                    <section className="panel volume-panel">
                      <div className="panel-header">
                        <div>
                          <h2>Работа в цифрах</h2>
                          <p>Внешний объём · свободные веса × повторы</p>
                        </div>
                        <span className="period-label">28 дней</span>
                      </div>
                      <VolumeChart
                        workouts={monthWorkouts}
                        timeZone={settings.timeZone}
                      />
                      <div className="chart-footer">
                        <span>
                          <i />
                          Объём за день
                        </span>
                        <b>
                          {fmt(volume(monthWorkouts) / 1000)} т
                          <span> всего</span>
                        </b>
                      </div>
                    </section>
                    <section className="panel recent-panel">
                      <div className="panel-header">
                        <h2>Последние тренировки</h2>
                        <button
                          className="text-button"
                          onClick={() => go("history")}
                        >
                          Все
                        </button>
                      </div>
                      {displayed.slice(0, 3).map((w) => sessionItem(w))}
                      {!displayed.length ? (
                        <div className="small-empty">
                          Первый подход — начало истории.
                          <button
                            className="text-button"
                            onClick={() => start()}
                          >
                            Записать тренировку
                          </button>
                        </div>
                      ) : null}
                    </section>
                  </div>
                </>
              ) : null}
              {view === "workout" ? (
                <WorkoutView
                  draft={draft}
                  update={setDraft}
                  settings={settings}
                  saving={saving}
                  error={saveError}
                  persistence={persistence}
                  onExport={exportDraft}
                  onPick={openPicker}
                  onSave={() => void saveWorkout()}
                  onDiscard={() => setModal("discard")}
                />
              ) : null}
              {view === "history" ? (
                <>
                  <div className="history-toolbar">
                    <div className="search-field">
                      <Search size={18} />
                      <input
                        aria-label="Поиск по истории"
                        placeholder="Название или упражнение…"
                        value={historySearch}
                        onChange={(e) => setHistorySearch(e.target.value)}
                      />
                    </div>
                    <button
                      className="button secondary"
                      onClick={exportHistory}
                    >
                      <Download size={17} />
                      Экспорт JSON
                    </button>
                    <button
                      className="button secondary"
                      onClick={() => setModal("import")}
                    >
                      Импорт истории
                    </button>
                  </div>
                  <div className="panel history-panel">
                    {historyFiltered.map((w) => sessionItem(w, true))}
                    {!displayed.length ? (
                      <div className="empty-state">
                        <History size={36} />
                        <h2>История начинается сегодня</h2>
                        <p>
                          Завершённая тренировка появится здесь — с каждым
                          подходом.
                        </p>
                        <button
                          className="button primary"
                          onClick={() => start()}
                        >
                          Записать тренировку
                        </button>
                      </div>
                    ) : null}
                    {displayed.length && !historyFiltered.length ? (
                      <div className="no-results">
                        Таких тренировок пока нет.
                      </div>
                    ) : null}
                  </div>
                </>
              ) : null}
              {view === "anatomy" ? (
                <>
                  <div className="anatomy-week-heading">
                    <span>
                      {dateLabel(anchor)} — {dateLabel(weekEnd)}
                    </span>
                    <div>
                      <button
                        className="icon-button"
                        aria-label="Предыдущая неделя анатомии"
                        onClick={() => setWeekOffset((o) => o - 1)}
                      >
                        <ChevronLeft size={18} />
                      </button>
                      <button
                        className="icon-button"
                        aria-label="Следующая неделя анатомии"
                        disabled={weekOffset >= 0}
                        onClick={() => setWeekOffset((o) => o + 1)}
                      >
                        <ChevronRight size={18} />
                      </button>
                    </div>
                  </div>
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
              {view === "library" ? <>{exerciseCards()}</> : null}
              {view === "programs" ? (
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
                      start(
                        [],
                        undefined,
                        new TrainingProgram(r).start(
                          workouts,
                          settings.timeZone ?? browserTimeZone(),
                        ),
                      )
                    }
                    initial={initialRoutine}
                    onInitialUsed={() => setInitialRoutine(null)}
                  />
                </Suspense>
              ) : null}
              {view === "progress" ? (
                <>
                  <div className="progress-selector">
                    <label>
                      Упражнение
                      <select
                        value={progressExercise}
                        onChange={(e) => setProgressExercise(e.target.value)}
                      >
                        {progressOptions.map((o) => (
                          <option value={o.key} key={o.key}>
                            {entryName(o.we)}
                            {(o.we.catalogRevision ?? 1) === 1
                              ? " · старое правило веса"
                              : ""}
                            {o.we.equipmentNote
                              ? ` · ${o.we.equipmentNote}`
                              : ""}
                            {o.we.performedSides
                              ? ` · ${o.we.performedSides}`
                              : ""}
                          </option>
                        ))}
                      </select>
                    </label>
                    <p>
                      {recordingLabel(progressEntry)}.{" "}
                      {progressSpec.loadMode === "assisted_bodyweight"
                        ? "Больше помощи — меньше сопротивления."
                        : "Сравнение внутри одной версии и правила записи."}{" "}
                      {progressSpec.e1rmEligible
                        ? "Расчётный 1ПМ — оценка по 1–12 повторениям записанного веса."
                        : "Для этого правила записи расчётный 1ПМ отключён."}
                    </p>
                  </div>
                  <div className="stats-grid progress-stats">
                    <Stat
                      icon={<Trophy size={19} />}
                      label="Макс. записанное значение"
                      value={fmt(
                        Math.max(0, ...progressPoints.map((p) => p.max)),
                      )}
                      unit={progressSpec.type === "duration" ? "с" : "кг"}
                      meta={recordingLabel(progressEntry)}
                    />
                    <Stat
                      icon={<TrendingUp size={19} />}
                      label={
                        progressSpec.type === "duration"
                          ? "Изменение длительности"
                          : "Изменение веса"
                      }
                      value={
                        lastProgress && firstProgress
                          ? `${lastProgress.max - firstProgress.max >= 0 ? "+" : ""}${fmt(lastProgress.max - firstProgress.max)}`
                          : "—"
                      }
                      unit={
                        lastProgress
                          ? progressSpec.type === "duration"
                            ? "с"
                            : "кг"
                          : ""
                      }
                      meta="первая → последняя тренировка"
                    />
                    <Stat
                      icon={<Target size={19} />}
                      label="1ПМ записанного веса"
                      value={lastProgress?.e1rm ? fmt(lastProgress.e1rm) : "—"}
                      unit={lastProgress?.e1rm ? "кг" : ""}
                      meta={
                        progressSpec.e1rmEligible
                          ? "формула Эпли · версия 1"
                          : "не вычисляется для этого варианта"
                      }
                    />
                    <Stat
                      icon={<CalendarDays size={19} />}
                      label="Тренировок"
                      value={String(progressPoints.length)}
                      meta="с этим упражнением"
                    />
                  </div>
                  <section className="panel progress-panel">
                    <div className="panel-header">
                      <div>
                        <h2>{entryName(progressEntry)}</h2>
                        <p>
                          Максимальное записанное значение в каждой тренировке
                        </p>
                      </div>
                      <span className="chart-key">
                        <i />
                        Записанное значение
                      </span>
                    </div>
                    {progressPoints.length ? (
                      <>
                        <div className="large-sparkline">
                          <Sparkline
                            values={progressPoints.map((p) => p.max)}
                          />
                        </div>
                        <div className="progress-dates">
                          <span>{dateLabel(firstProgress.date, true)}</span>
                          <span>{dateLabel(lastProgress!.date, true)}</span>
                        </div>
                        <div className="progress-history">
                          {[...progressPoints].reverse().map((p, i) => (
                            <div key={`${p.date}-${i}`}>
                              <span>{dateLabel(p.date, true)}</span>
                              <span>
                                {p.sets.length} подходов · {p.reps}{" "}
                                {progressSpec.type === "duration"
                                  ? "с"
                                  : "повторов"}
                              </span>
                              <b>
                                {fmt(p.max)}{" "}
                                {progressSpec.type === "duration" ? "с" : "кг"}
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
          )}
          <footer className="page-footer">
            <span>
              тяга<span>.</span>
            </span>
            <p>Твоя работа. Твои данные. Твой результат.</p>
            <button onClick={() => setModal("method")}>Как мы считаем</button>
          </footer>
        </m.div>
      </main>
      {toast ? (
        <div className="toast" role="status">
          <Check size={17} />
          <span>{toast}</span>
          <button
            className="icon-button"
            aria-label="Скрыть уведомление"
            onClick={() => setToast("")}
          >
            <X size={16} />
          </button>
        </div>
      ) : null}
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
      {modal === "planner" ? (
        <Modal title="Баланс недели" onClose={() => setModal(null)} wide>
          <p className="modal-intro">
            Подберём упражнения для недобора прямых подходов относительно твоих
            ориентиров. План использует все рабочие подходы без фильтра RIR и
            учитывает {demo ? "пример тренировок" : "твой журнал"} за текущую
            неделю.
          </p>
          <div className="planner-controls">
            <div>
              <label>Сколько времени есть?</label>
              <div className="segmented">
                {[20, 40, 60].map((n) => (
                  <button
                    key={n}
                    className={minutes === n ? "active" : ""}
                    onClick={() => setMinutes(n)}
                  >
                    {n} мин
                  </button>
                ))}
              </div>
            </div>
            <label>
              Оборудование
              <select
                value={planEquipment}
                onChange={(e) => setPlanEquipment(e.target.value as Equipment)}
              >
                {Object.entries(EQ).map(([key, name]) => (
                  <option key={key} value={key}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <details className="exclude-muscles">
            <summary>Какие мышцы пропустить сегодня?</summary>
            <p className="tiny">
              Исключим упражнения с отмеченной ролью выбранных мышц, включая
              стабилизацию. Это не гарантия полного отсутствия участия.
            </p>
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
          <div className="balance-projection">
            <div>
              <span>Покрытие сейчас</span>
              <b>{plan.before}%</b>
            </div>
            <div className="projection-divider" />
            <div>
              <span>После 3 рабочих подходов каждого упражнения</span>
              <b>{plan.after}%</b>
            </div>
            <span className="projection-change">
              +{plan.after - plan.before} п.п.
            </span>
          </div>
          <div className="plan-list">
            {plan.picks.map((p, i) => (
              <div className="plan-item" key={p.exercise.id}>
                <span className="exercise-number">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <div>
                  <h3>{p.exercise.name}</h3>
                  <span>3 подхода × 8–12 повторений · RIR 2</span>
                  <p>
                    <Sparkles size={13} />
                    {p.reason}
                  </p>
                </div>
              </div>
            ))}
            {!plan.picks.length ? (
              <div className="no-results">
                Нет подходящих пробелов. Выбери другое оборудование, сними
                исключения или запланируй отдых.
              </div>
            ) : null}
          </div>
          <p className="tiny planner-disclaimer">
            Это покрытие ориентиров, а не прогноз роста. Время — приблизительная
            оценка: подготовка + повторы + выбранный отдых между подходами. Вес
            и амплитуду подбери под себя.
          </p>
          <div className="modal-actions">
            <span className="muted">
              <Clock3 size={16} />
              Около {plan.minutes} минут
            </span>
            <button
              className="button primary"
              disabled={!plan.picks.length}
              onClick={() =>
                start(
                  plan.picks.map((p) => p.exercise.id),
                  "Баланс недели",
                )
              }
            >
              <Plus size={17} />
              {demo ? "Попробовать этот план" : "Начать по плану"}
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
          <label className="settings-zone">
            Часовой пояс календаря
            <input
              aria-label="Часовой пояс календаря"
              value={settingsDraft.timeZone ?? browserTimeZone()}
              placeholder="Europe/Amsterdam"
              onChange={(e) =>
                setSettingsDraft((v) => ({ ...v, timeZone: e.target.value }))
              }
            />
            <small className="tiny">
              Например Europe/Amsterdam. Даты прошлых тренировок не сдвигаются.
            </small>
          </label>
          <div className="settings-bottom">
            <label>
              Оборудование
              <select
                value={settingsDraft.equipment}
                onChange={(e) =>
                  setSettingsDraft((s) => ({
                    ...s,
                    equipment: e.target.value as Equipment,
                  }))
                }
              >
                {Object.entries(EQ).map(([key, name]) => (
                  <option key={key} value={key}>
                    {name}
                  </option>
                ))}
              </select>
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
              <li>Разминка и невыполненные подходы исключаются.</li>
              <li>
                Роли движителя, помощника и стабилизатора разделены. Помощь не
                прибавляется как «0,5»; стабилизация не заполняет ориентир.
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
      {modal === "discard" ? (
        <Modal
          title={
            draft?.editing ? "Отменить изменения?" : "Отменить тренировку?"
          }
          onClose={() => setModal(null)}
        >
          <p className="modal-intro">
            {draft?.editing
              ? "Сохранённая тренировка останется в истории. Изменения в черновике будут потеряны."
              : "Черновик и незавершённые подходы будут удалены с этого устройства."}
          </p>
          <div className="modal-actions">
            <button className="button secondary" onClick={() => setModal(null)}>
              Продолжить
            </button>
            <button
              className="button danger"
              onClick={() => {
                setDraft(null);
                setConflict(null);
                setModal(null);
                setSaveError("");
              }}
            >
              Отменить
            </button>
          </div>
        </Modal>
      ) : null}
      {detail ? (
        <Modal title={detail.name} onClose={() => setDetail(null)} wide>
          <p className="history-value-note">
            Внешний объём включает только свободные веса с известным правилом
            записи. Тренажёры, масса тела и неопределённые старые записи
            показаны по подходам.
          </p>
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
              {fmt(volume([detail]))} кг
            </span>
          </div>
          {detail.exercises.map((e) => (
            <div className="detail-exercise" key={e.exerciseId}>
              <h3>{entryName(e)}</h3>
              <p className="tiny">
                {recordingLabel(e)}
                {e.equipmentNote ? ` · ${e.equipmentNote}` : ""}
                {e.performedSides
                  ? ` · ${e.performedSides === "both" ? "обе стороны" : e.performedSides === "left" ? "левая сторона" : "правая сторона"}`
                  : ""}
              </p>
              <div className="detail-sets">
                {e.sets
                  .filter((s) => s.done)
                  .map((s) => (
                    <span key={s.id}>
                      {s.warmup ? "Разминка · " : ""}
                      <b>
                        {exerciseForEntry(e)?.recording.type === "duration" ? (
                          `${s.durationSeconds} с`
                        ) : (
                          <>
                            {exerciseForEntry(e)?.recording.loadMode ===
                            "bodyweight"
                              ? "Без веса"
                              : `${recordedLoad(e, s)} ${recordingLabel(e)}`}{" "}
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
      {modal === "import" ? (
        <Modal
          title="Импорт истории"
          wide
          onClose={() => {
            if (!importBusy) setModal(null);
          }}
        >
          <Suspense fallback={<p>Открываем импорт…</p>}>
            <HistoryImporter
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
                await load();
                setModal(null);
                setDemo(false);
                go("history");
                setToast(
                  `Импорт завершён: добавлено ${result.imported}, пропущено ${result.skipped}`,
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
      {conflict && draft ? (
        <Modal
          title="Версии тренировки разошлись"
          onClose={() => setConflict(null)}
        >
          <p className="modal-intro">
            {conflict.current
              ? `На другом устройстве сохранена версия ${conflict.current.revision}. Твои изменения остаются в черновике; сервер их не записал поверх новой версии.`
              : "Исходная тренировка удалена. Твой черновик остаётся в форме."}
          </p>
          <button className="text-button" onClick={exportDraft}>
            <Download size={16} />
            Скачать мой черновик
          </button>
          <div className="conflict-actions">
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
                setConflict(null);
                setSaveError("");
                setToast(
                  "Отдельный черновик готов. Сохрани его, когда проверишь.",
                );
              }}
            >
              Создать отдельную копию
            </button>
            {conflict.current ? (
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
                Заменить мой черновик актуальной версией
              </button>
            ) : null}
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

function Stat({
  icon,
  label,
  value,
  unit,
  meta,
  accent = false,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  unit?: string;
  meta: string;
  accent?: boolean;
}) {
  return (
    <article className={`stat-card panel ${accent ? "accent-stat" : ""}`}>
      <div className="stat-top">
        <span>{label}</span>
        <span className="stat-icon">{icon}</span>
      </div>
      <div className="stat-value">
        {value}
        {unit ? <span>{unit}</span> : null}
      </div>
      <p>{meta}</p>
    </article>
  );
}
