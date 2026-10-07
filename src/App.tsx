import {
  useCallback,
  lazy,
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
  Play,
  Search,
  Settings2,
  Sparkles,
  Trash2,
  TrendingUp,
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
const AppleHealthPanel = lazy(() => import("./components/AppleHealthPanel"));
import ExerciseInfo from "./components/ExerciseInfo";
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
import { productService } from "./services/ProductService";
import { TrainingProgram } from "./domain/TrainingProgram";
import { useTrainingTools } from "./lib/webmcp";
import { AccountProfileForm } from "./components/AccountProfileForm";
import type { AccountProfile } from "./lib/account";
import SessionInsights from "./components/SessionInsights";

type ProductView =
  "overview" | "workout" | "history" | "library" | "progress" | "programs";
// "programs" lives in the desktop sidebar; on a phone it opens from «Сегодня».
const NAV = [
  { id: "overview", label: "Сегодня", icon: House },
  { id: "history", label: "История", icon: History },
  { id: "progress", label: "Прогресс", icon: BarChart3 },
  { id: "library", label: "Упражнения", icon: Dumbbell },
  { id: "programs", label: "Программы", icon: CalendarDays },
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
export default function App({ account, onAccountChange, onLogout }: { account: AccountProfile; onAccountChange: (p: AccountProfile) => void; onLogout: () => void }) {
  const draftKey = `tyaga-draft-account:${account.id}`;
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
  const [draft, setDraft] = useState<Draft | null>(() => readDraft(draftKey));
  const [persistence, setPersistence] = useState<PersistenceStatus>("pending");
  const [legacyDraft, setLegacyDraft] = useState(() => readDraft(DRAFT_KEY));
  const [conflict, setConflict] = useState<{ current: Workout | null } | null>(
    null,
  );
  const [mapping, setMapping] = useState<"recorded" | "current">("recorded");
  const [hardSetsOnly, setHardSetsOnly] = useState(false);
  const [progressTab, setProgressTab] = useState<"balance" | "strength" | "anatomy">("balance");
  const [toast, setToast] = useState("");
  const [modal, setModal] = useState<
    | "picker"
    | "settings"
    | "method"
    | "discard"
    | "personal"
    | "import"
    | "profile"
    | null
  >(null);
  const [detail, setDetail] = useState<Workout | null>(null);
  const [justSaved, setJustSaved] = useState<Workout | null>(null);
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
      if (signal?.aborted) return;
      exerciseCatalog.register([
        ...productData.customExercises,
        ...(productData.favoriteDefinitions ?? []),
        ...data.workouts.flatMap(w => w.exercises.flatMap(e => e.externalDefinition ? [e.externalDefinition] : [])),
      ]);
      setProduct(productData);
      setWorkouts(data.workouts);
      setSettings({
        ...data.settings,
        timeZone: data.settings.timeZone ?? browserTimeZone(),
      });
      setPlanEquipment(data.settings.equipment);
      setDemo(false);
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
  const today = localDate(new Date(), settings.timeZone);
  const thisWeek = Array.from({ length: 7 }, (_, i) => {
    const date = addCalendarDays(weekStart(new Date(), settings.timeZone), i);
    return {
      date,
      label: ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"][i],
      day: Number(date.slice(8)),
      trained: displayed.some((w) => w.date === date),
    };
  });
  const todayRoutine = product.routines.find((r) =>
    new TrainingProgram(r).scheduled(today),
  );
  // Preview only; starting builds a fresh workout so ids never repeat.
  const todayPlan = useMemo(
    () =>
      todayRoutine
        ? new TrainingProgram(todayRoutine).start(
            workouts,
            settings.timeZone ?? browserTimeZone(),
          )
        : null,
    [todayRoutine, workouts, settings.timeZone],
  );
  const weekDone = currentLoads.reduce((n, m) => n + Math.min(m.total, m.goal), 0);
  const weekGoal = currentLoads.reduce((n, m) => n + m.goal, 0);
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
  const start = (ids: string[] = [], name?: string, template?: Workout) => {
    if (draft) {
      go("workout");
      setToast("У тебя уже есть черновик. Продолжи или отмени его.");
      setModal(null);
      return;
    }
    const workout = template ?? makeWorkout(ids, workouts, settings.timeZone);
    if (!template && account.bodyMassKg !== null) workout.exercises = workout.exercises.map(e =>
      ["bodyweight","added_bodyweight","assisted_bodyweight"].includes(exerciseForEntry(e)?.recording.loadMode ?? "") ? { ...e, bodyMassKg: account.bodyMassKg! } : e);
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
              { ...makeExerciseEntry(id, workouts),
                ...(account.bodyMassKg !== null && ["bodyweight","added_bodyweight","assisted_bodyweight"].includes(exerciseById(id)?.recording.loadMode ?? "") ? {bodyMassKg:account.bodyMassKg} : {}) },
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
      setJustSaved(result.workout);
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
        <b title="Только однозначно записанные свободные веса">
          {fmt(volumeSummary([w], "all").total / 1000)} т
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
    <div className={`app-shell ${view === "workout" ? "in-workout" : ""}`}>
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
        </a>
        <nav aria-label="Основная навигация">
          {NAV.map((n) => (
            <button
              className={`nav-item ${view === n.id ? "active" : ""} ${n.id === "programs" ? "desktop-only" : ""}`}
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
          <button className="nav-item" onClick={openSettings}>
            <Settings2 size={19} />
            Мои цели
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
          transition={{ duration: 0.2 }}
        >
          {persistence === "failed" && !draft ? (
            <div className="error-banner" role="alert">
              <Info size={18} />
              <span>
                Не удалось удалить локальный черновик. Сохранённая история на
                месте; проверь черновик после перезапуска.
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
                  {!demo && !workouts.length ? (
                    <div className="intro-banner">
                      <Dumbbell size={18} />
                      <span>
                        Здесь появится твоя история. Начни первую тренировку
                        или посмотри, как работает журнал.
                      </span>
                      <button className="text-button" onClick={() => setDemo(true)}>
                        Посмотреть пример
                      </button>
                    </div>
                  ) : null}
                  <div className="week-strip" aria-label="Эта неделя">
                    {thisWeek.map((d) => (
                      <div
                        key={d.date}
                        className={`week-strip-day ${d.trained ? "trained" : ""} ${d.date === today ? "today" : ""}`}
                      >
                        <span>{d.label}</span>
                        <b>{d.day}</b>
                        <i aria-label={d.trained ? "тренировка" : undefined} />
                      </div>
                    ))}
                  </div>
                  <section className="plan-card" aria-labelledby="plan-title">
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
                          ? `${todayPlan.exercises.length} упр. · ${todayPlan.exercises.reduce((n, e) => n + e.sets.length, 0)} подх.`
                          : "Записывай подходы — веса и прогресс посчитаем сами."}
                    </p>
                    {todayPlan && !draft ? (
                      <ul className="plan-exercises">
                        {todayPlan.exercises.slice(0, 4).map((e) => (
                          <li key={e.exerciseId}>
                            <span>{entryName(e)}</span>
                            <b>
                              {e.sets.length} × {e.sets[0]?.reps ?? 0}
                              {e.sets[0]?.weight ? ` · ${fmt(e.sets[0].weight)} кг` : ""}
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
                                new TrainingProgram(todayRoutine).start(
                                  workouts,
                                  settings.timeZone ?? browserTimeZone(),
                                ),
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
                  </section>
                  <button className="week-summary" onClick={() => go("progress")}>
                    <span className="week-summary-head">
                      <b>Неделя</b>
                      <span>
                        <strong>{fmt(weekDone)}</strong> / {weekGoal} подх.
                      </span>
                    </span>
                    <span className="meter" aria-hidden="true">
                      <span style={{ width: `${weekGoal ? Math.min(100, (100 * weekDone) / weekGoal) : 0}%` }} />
                    </span>
                    <span className="week-summary-foot">
                      {lagging.length
                        ? `Отстают: ${lagging.map((m) => m.short.toLowerCase()).join(", ")}`
                        : "Все зоны в работе — так держать"}
                      <ChevronRight size={18} />
                    </span>
                  </button>
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
                  draft={draft}
                  update={setDraft}
                  settings={settings}
                  history={workouts}
                  saving={saving}
                  error={saveError}
                  persistence={persistence}
                  onExport={exportDraft}
                  onPick={openPicker}
                  onSave={() => void saveWorkout()}
                  onDiscard={() => setModal("discard")}
                  onMinimize={() => go("overview")}
                />
              ) : null}
              {view === "history" ? (
                <>
                  <header className="screen-head">
                    <h1>История тренировок</h1>
                  </header>
                  {justSaved && <SessionInsights workout={justSaved} settings={settings} />}
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
                    <button className="button secondary" onClick={exportHistory}>
                      <Download size={17} />
                      Экспорт JSON
                    </button>
                    <button className="button secondary" onClick={() => setModal("import")}>
                      Импорт истории
                    </button>
                  </div>
                  <div className="panel history-panel">
                    {historyFiltered.map((w) => sessionItem(w, true))}
                    {!displayed.length ? (
                      <div className="empty-state">
                        <History size={36} />
                        <h2>История начинается сегодня</h2>
                        <p>Завершённая тренировка появится здесь.</p>
                        <button className="button primary" onClick={() => start()}>
                          Записать тренировку
                        </button>
                      </div>
                    ) : null}
                    {displayed.length && !historyFiltered.length ? (
                      <div className="no-results">Таких тренировок пока нет.</div>
                    ) : null}
                  </div>
                  {monthWorkouts.length ? (
                    <section className="panel volume-panel">
                      <div className="panel-header">
                        <div>
                          <h2>Объём за 28 дней</h2>
                          <p>Свободные веса, включая разминку</p>
                        </div>
                        <b className="volume-total">
                          {fmt(volumeSummary(monthWorkouts, "all").total / 1000)} т
                        </b>
                      </div>
                      <VolumeChart workouts={monthWorkouts} timeZone={settings.timeZone} />
                    </section>
                  ) : null}
                </>
              ) : null}
              {view === "progress" ? (
                <>
                  <header className="screen-head">
                    <h1>Прогресс</h1>
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
                  <div className="tabs" role="tablist" aria-label="Раздел прогресса">
                    {(
                      [
                        ["balance", "Баланс"],
                        ["strength", "Сила"],
                        ["anatomy", "Карта мышц"],
                      ] as const
                    ).map(([id, label]) => (
                      <button
                        key={id}
                        role="tab"
                        aria-selected={progressTab === id}
                        className={progressTab === id ? "active" : ""}
                        onClick={() => setProgressTab(id)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  {progressTab !== "strength" ? (
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
                  {progressTab === "balance" ? (
                    <>
                      <section className="panel zones-panel" aria-labelledby="zones-title">
                        <div className="panel-header">
                          <div>
                            <h2 id="zones-title">Рабочие подходы по зонам</h2>
                            <p>
                              <strong>{fmt(loads.reduce((n, m) => n + Math.min(m.total, m.goal), 0))}</strong>{" "}
                              из {loads.reduce((n, m) => n + m.goal, 0)} по твоим целям
                            </p>
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
                              <select
                                value={mapping}
                                onChange={(e) =>
                                  setMapping(e.target.value as "recorded" | "current")
                                }
                              >
                                <option value="recorded">Сохранённые версии</option>
                                <option value="current">Пересчёт по каталогу 2</option>
                              </select>
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
                              ? `На этой неделе отстают: ${currentLagging
                                  .slice(0, 2)
                                  .map((m) => m.short.toLowerCase())
                                  .join(" и ")}. Соберём короткую тренировку под твоё время.`
                              : "Подходы этой недели покрывают твои цели. Можно отдыхать или добавить объём."}
                          </p>
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
                                {o.we.equipmentNote ? ` · ${o.we.equipmentNote}` : ""}
                                {o.we.performedSides ? ` · ${o.we.performedSides}` : ""}
                              </option>
                            ))}
                          </select>
                        </label>
                        <p className="tiny">
                          {recordingLabel(progressEntry)}.{" "}
                          {progressSpec.loadMode === "assisted_bodyweight"
                            ? "Больше помощи — меньше сопротивления."
                            : "Сравнение внутри одной версии и правила записи."}{" "}
                          {progressSpec.e1rmEligible
                            ? "Расчётный 1ПМ — по 1–12 повторениям записанного веса."
                            : "Для этого правила записи расчётный 1ПМ отключён."}
                        </p>
                      </div>
                      <div className="stats-grid progress-stats">
                        <Stat
                          label="Лучшее значение"
                          value={fmt(Math.max(0, ...progressPoints.map((p) => p.max)))}
                          unit={progressSpec.type === "duration" ? "с" : "кг"}
                        />
                        <Stat
                          label={progressSpec.type === "duration" ? "Изменение, с" : "Изменение веса"}
                          value={
                            lastProgress && firstProgress
                              ? `${lastProgress.max - firstProgress.max >= 0 ? "+" : ""}${fmt(lastProgress.max - firstProgress.max)}`
                              : "—"
                          }
                          unit={lastProgress ? (progressSpec.type === "duration" ? "с" : "кг") : ""}
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
                            <div className="large-sparkline">
                              <Sparkline values={progressPoints.map((p) => p.max)} />
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
                                    {p.sets.length} подх. · {p.reps}{" "}
                                    {progressSpec.type === "duration" ? "с" : "повт."}
                                  </span>
                                  <b>
                                    {fmt(p.max)} {progressSpec.type === "duration" ? "с" : "кг"}
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
                </>
              ) : null}
            </>
          )}
        </m.div>
      </main>
      {draft && view !== "workout" ? (
        <button className="resume-pill" onClick={() => go("workout")}>
          <span className="resume-dot" aria-hidden="true" />
          Вернуться к тренировке
          <b>{draft.manualDuration ? draft.workout.duration : Math.floor(elapsedMs(draft) / 60000)} мин</b>
        </button>
      ) : null}
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
              <li>Разминка записывается и входит в общий тоннаж и количество выполненных подходов. Её участие в мышцах показывается отдельно; недельные ориентиры считают рабочие подходы. Невыполненные подходы исключаются.</li>
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
              {fmt(volumeSummary([detail], "all").total)} кг
            </span>
          </div>
          <SessionInsights workout={detail} settings={settings} />
          <Suspense fallback={<p className="tiny">Открываем показатели часов…</p>}><AppleHealthPanel workout={detail} readOnly={demo} onSaved={saved => {
            setDetail(saved); setWorkouts(ws => ws.map(w => w.id === saved.id ? saved : w));
            setJustSaved(w => w?.id === saved.id ? saved : w); setToast("Показатели часов сохранены");
          }} /></Suspense>
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
      {modal === "profile" ? <Modal title="Мой профиль" onClose={() => setModal(null)}>
        <AccountProfileForm account={account} hasDraft={!!draft}
          onChange={p => { onAccountChange(p); void load(); }} onLogout={onLogout} />
      </Modal> : null}
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
