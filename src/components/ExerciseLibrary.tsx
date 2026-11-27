import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Database,
  Dumbbell,
  Info,
  Pencil,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
  Star,
  Trophy,
  X,
} from "lucide-react";
import Select from "./Select";
import Modal from "./Modal";
import BiomechanicalAgentPanel from "./BiomechanicalAgentPanel";
import { MUSCLES, exerciseCatalog, fmt, type Exercise, type Workout } from "../lib/model";
import { DeloadEngine } from "../domain/DeloadEngine";
import { OneRepMaxFormulas } from "../domain/OneRepMaxFormulas";
import { WGER_ZONES } from "../domain/WgerExercise";
import { matchesSearch, normalizeSearch } from "../lib/search";
import { ExerciseSearchRank } from "../domain/ExerciseSearchRank";
import { quantity } from "../lib/quantity";
import { exerciseLibraryService, type LibraryPage } from "../services/ExerciseLibraryService";
import { MuscleParticipation } from "../domain/MuscleParticipation";
import { MuscleCoverage } from "../domain/MuscleCoverage";
import { PersonalExerciseMarking, type Marking } from "../domain/PersonalExerciseMarking";
import { productService } from "../services/ProductService";

const WGER_CACHE_TTL_MS = 300_000;
const wgerCache = new Map<string, { data: LibraryPage; fetchedAt: number }>();

function useWgerCatalog(
  enabled: boolean,
  filters: { search: string; muscle: string; equipment: string; page: number },
) {
  const key = JSON.stringify([filters.search, filters.muscle, filters.equipment, filters.page, "all"]);
  const [data, setData] = useState<LibraryPage | undefined>(() => wgerCache.get(key)?.data);
  const [error, setError] = useState<Error | null>(null);
  const [isPending, setIsPending] = useState(false);
  const [isFetching, setIsFetching] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);
  const dataRef = useRef(data);
  dataRef.current = data;

  const refetch = useCallback(() => {
    wgerCache.delete(key);
    setReloadTick((n) => n + 1);
  }, [key]);

  useEffect(() => {
    if (!enabled) return;
    const cached = wgerCache.get(key);
    if (cached && !cached.data.importing && Date.now() - cached.fetchedAt < WGER_CACHE_TTL_MS) {
      setData(cached.data);
      setError(null);
      setIsPending(false);
      setIsFetching(false);
      return;
    }

    const controller = new AbortController();
    let pollTimer: number | undefined;
    let active = true;

    const run = async (attempt: number) => {
      if (!active) return;
      if (!dataRef.current) setIsPending(true);
      setIsFetching(true);
      setError(null);
      try {
        const result = await exerciseLibraryService.find(
          {
            search: filters.search,
            muscle: filters.muscle,
            equipment: filters.equipment,
            page: filters.page,
            language: "all",
          },
          controller.signal,
        );
        if (!active) return;
        if (!result.importing) {
          wgerCache.set(key, { data: result, fetchedAt: Date.now() });
        }
        setData(result);
        setIsPending(false);
        setIsFetching(false);
        if (result.importing) {
          pollTimer = window.setTimeout(() => void run(0), 400);
        }
      } catch (err) {
        if (!active || controller.signal.aborted) return;
        if (attempt < 1) {
          void run(attempt + 1);
          return;
        }
        setError(err instanceof Error ? err : new Error("Не удалось загрузить базу упражнений"));
        setIsPending(false);
        setIsFetching(false);
      }
    };

    void run(0);
    return () => {
      active = false;
      controller.abort();
      if (pollTimer !== undefined) clearTimeout(pollTimer);
    };
  }, [enabled, key, filters.search, filters.muscle, filters.equipment, filters.page, reloadTick]);

  return {
    data,
    error,
    isError: error !== null,
    isPending: enabled && isPending && !data,
    isFetching: enabled && isFetching,
    refetch,
  };
}

function equipmentLabel(eq: Exercise["equipment"]): string {
  if (eq === "dumbbells") return "Гантели";
  if (eq === "bodyweight") return "Вес тела";
  return "Зал";
}

function LibraryContent({
  picker = false,
  onAdd,
  onDetail,
  selectedIds = [],
  limitReached = false,
  defaultMuscle = "all",
  personal = [],
  favorites = [],
  onFavorite,
  onCreate,
  onEdit,
  onMarked,
  startMarking = false,
  catalogGaps = [],
  workouts = [],
}: {
  picker?: boolean;
  onAdd: (id: string) => void;
  onDetail: (id: string) => void;
  selectedIds?: string[];
  limitReached?: boolean;
  defaultMuscle?: string;
  personal?: Exercise[];
  favorites?: string[];
  onFavorite?: (id: string) => void;
  onCreate?: () => void;
  onEdit?: (exercise: Exercise) => void;
  onMarked?: (exercises: Exercise[]) => void;
  startMarking?: boolean;
  catalogGaps?: Exercise[];
  workouts?: Workout[];
}) {
  const [source, setSource] = useState<"tyaga" | "wger" | "personal" | "favorites">(
    startMarking ? "personal" : "tyaga",
  );
  const [bulk, setBulk] = useState(startMarking);
  const [picked, setPicked] = useState<string[]>([]);
  const [zonePick, setZonePick] = useState("");
  const [basePick, setBasePick] = useState("");
  const [marking, setMarking] = useState<{ done: number; total: number } | null>(null);
  const [markResult, setMarkResult] = useState("");
  const [confirm, setConfirm] = useState<{ patch: Marking; marked: number; fresh: number } | null>(null);
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [muscle, setMuscle] = useState(defaultMuscle);
  const [subheadFilter, setSubheadFilter] = useState("all");
  const [equipment, setEquipment] = useState("all");
  const [spineFriendly, setSpineFriendly] = useState(false);
  const [agentOpen, setAgentOpen] = useState(false);
  const [page, setPage] = useState(1);

  const historyStats = useMemo(() => {
    const map = new Map<string, { bestE1rm: number; lastWeight: number; lastReps: number }>();
    for (const w of workouts) {
      if (DeloadEngine.isDeloadName(w.name)) continue;
      for (const ex of w.exercises) {
        let best = map.get(ex.exerciseId)?.bestE1rm ?? 0;
        let lastWeight = map.get(ex.exerciseId)?.lastWeight ?? 0;
        let lastReps = map.get(ex.exerciseId)?.lastReps ?? 0;
        for (const s of ex.sets) {
          if (!s.done || s.warmup || s.weight <= 0 || s.reps < 1) continue;
          if (lastWeight === 0) {
            lastWeight = s.weight;
            lastReps = s.reps;
          }
          if (s.reps <= 12) {
            const est = OneRepMaxFormulas.round(OneRepMaxFormulas.epley(s.weight, s.reps));
            if (est > best) best = est;
          }
        }
        if (best > 0 || lastWeight > 0) {
          map.set(ex.exerciseId, { bestE1rm: best, lastWeight, lastReps });
        }
      }
    }
    return map;
  }, [workouts]);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(search), 200);
    return () => clearTimeout(id);
  }, [search]);
  useEffect(() => {
    setPage(1);
    setSubheadFilter("all");
  }, [muscle]);
  useEffect(() => setPage(1), [debounced, equipment, subheadFilter]);

  const query = useWgerCatalog(source === "wger", {
    search: debounced,
    muscle,
    equipment,
    page,
  });

  const filteredLocal = useMemo(() => {
    const local =
      source === "personal"
        ? personal
        : favorites
            .map((id) => exerciseCatalog.find(id))
            .filter((e): e is Exercise => !!e);
    return local.filter(
      (e) =>
        matchesSearch(`${e.name} ${e.nameEn} ${(e.aliases ?? []).join(" ")}`, search) &&
        (muscle === "all" ||
          e.custom?.declaredZones.includes(muscle as never) ||
          e.primary.includes(muscle as never)) &&
        (equipment === "all" || e.equipment === equipment),
    );
  }, [source, personal, favorites, search, muscle, equipment]);

  const exercises = useMemo(() => {
    const baseExercises =
      source === "tyaga"
        ? exerciseCatalog.search({ text: search, zone: muscle, equipment })
        : source === "wger"
          ? ExerciseSearchRank.withCoreFirst(
              (query.data?.exercises ?? []).filter((e) => e.source?.record.loggable !== false),
              page === 1
                ? exerciseCatalog.search({ text: debounced, zone: muscle, equipment })
                : [],
              debounced,
              normalizeSearch,
            )
          : filteredLocal;
    const afterHead =
      subheadFilter !== "all"
        ? baseExercises.filter((e) => MuscleParticipation.headRole(subheadFilter, e) !== undefined)
        : baseExercises;
    return spineFriendly
      ? afterHead.filter((e) => DeloadEngine.axialLoadMultiplier(e) <= 0.5)
      : afterHead;
  }, [source, search, muscle, equipment, query.data?.exercises, page, debounced, filteredLocal, subheadFilter, spineFriendly]);

  const unmarked = useMemo(() => MuscleCoverage.unmarkedPersonal(personal), [personal]);
  const togglePicked = (id: string) =>
    setPicked((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
  const gapsShown = useMemo(
    () => catalogGaps.filter((e) => matchesSearch(`${e.name} ${e.nameEn}`, search)),
    [catalogGaps, search],
  );

  function requestMarking(patch: Marking) {
    const chosen = personal.filter((e) => picked.includes(e.id));
    const { marked, unmarked: fresh } = PersonalExerciseMarking.split(chosen);
    if (marked.length) {
      setConfirm({
        patch,
        marked: marked.length,
        fresh: fresh.length + catalogGaps.filter((e) => picked.includes(e.id)).length,
      });
      return;
    }
    void applyMarking(patch, false);
  }

  async function applyMarking(patch: Marking, onlyUnmarked: boolean) {
    setConfirm(null);
    const chosenPersonal = personal.filter((e) => picked.includes(e.id));
    const chosenGaps = catalogGaps.filter((e) => picked.includes(e.id));
    const own = onlyUnmarked ? PersonalExerciseMarking.split(chosenPersonal).unmarked : chosenPersonal;
    const total = own.length + chosenGaps.length;
    const eligible = (e: Exercise) => !patch.basedOn || PersonalExerciseMarking.canBaseOn(e);
    const todo: Array<{ exercise: Exercise; copy: boolean }> = [
      ...own.filter(eligible).map((exercise) => ({ exercise, copy: false })),
      ...chosenGaps.filter(eligible).map((exercise) => ({ exercise, copy: true })),
    ];
    const skipped = total - todo.length;
    const saved: Exercise[] = [];
    setMarkResult("");
    setMarking({ done: 0, total: todo.length });
    try {
      for (const { exercise, copy } of todo) {
        const body = copy
          ? PersonalExerciseMarking.copyPayload(exercise, patch, crypto.randomUUID())
          : PersonalExerciseMarking.payload(exercise, patch);
        const result = await productService.saveExercise(body);
        saved.push(result.exercise);
        setMarking({ done: saved.length, total: todo.length });
      }
      setMarkResult(
        `Размечено ${saved.length} из ${total}.` +
          (skipped ? ` ${skipped} на время — им подходит только группа мышц.` : "") +
          (onlyUnmarked && chosenPersonal.length > own.length
            ? ` Уже размеченные (${chosenPersonal.length - own.length}) не тронуты.`
            : ""),
      );
      setPicked([]);
    } catch (e) {
      setMarkResult(`Размечено ${saved.length} из ${todo.length}. ${e instanceof Error ? e.message : "Не удалось сохранить"}`);
    } finally {
      if (saved.length) onMarked?.(saved);
      setMarking(null);
    }
  }

  const curatedTotal = useMemo(() => exerciseCatalog.search({}).length, []);
  const count = source !== "wger" ? exercises.length : (query.data?.total ?? 0);

  const zones = (e: Exercise) =>
    e.source
      ? [
          ...new Set(
            [...e.source.record.muscles, ...e.source.record.secondaryMuscles]
              .map((m) => WGER_ZONES[m.id])
              .filter(Boolean),
          ),
        ]
      : e.custom
        ? e.custom.declaredZones
        : [...e.primary, ...e.secondary];

  const showBulkControl =
    source === "personal" && onMarked && (unmarked.length + catalogGaps.length > 0 || bulk);

  return (
    <div className={`exlib-screen exercise-library ${picker ? "is-picker" : ""}`}>
      {/* Вкладки каталога */}
      <div className="tel-pill-row" role="group" aria-label="Каталог упражнений">
        <button
          type="button"
          className={`tel-pill-btn${source === "tyaga" ? " active" : ""}`}
          aria-pressed={source === "tyaga"}
          onClick={() => {
            setSource("tyaga");
            setPage(1);
          }}
        >
          <Dumbbell size={15} aria-hidden="true" />
          Основные <span className="pill-count">{curatedTotal}</span>
        </button>
        <button
          type="button"
          className={`tel-pill-btn${source === "wger" ? " active" : ""}`}
          aria-pressed={source === "wger"}
          onClick={() => {
            setSource("wger");
            setPage(1);
          }}
        >
          <Database size={15} aria-hidden="true" />
          Вся база <span className="pill-count">{query.data?.catalogTotal ?? 918}</span>
        </button>
        <button
          type="button"
          className={`tel-pill-btn${source === "personal" ? " active" : ""}`}
          aria-pressed={source === "personal"}
          onClick={() => setSource("personal")}
        >
          <Pencil size={15} aria-hidden="true" />
          Мои <span className="pill-count">{personal.length}</span>
        </button>
        <button
          type="button"
          className={`tel-pill-btn${source === "favorites" ? " active" : ""}`}
          aria-pressed={source === "favorites"}
          onClick={() => setSource("favorites")}
        >
          <Star size={15} aria-hidden="true" />
          Избранное <span className="pill-count">{favorites.length}</span>
        </button>
      </div>

      {/* Поиск + оборудование */}
      <div className="exlib-toolbar">
        <div className="exlib-search">
          <Search size={17} aria-hidden="true" />
          <input
            aria-label="Поиск упражнений"
            placeholder="Найти упражнение…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search ? (
            <button
              type="button"
              className="exlib-search-clear"
              aria-label="Очистить поиск"
              onClick={() => setSearch("")}
            >
              <X size={14} aria-hidden="true" />
            </button>
          ) : null}
        </div>
        <Select
          aria-label="Оборудование упражнений"
          value={equipment}
          onChange={setEquipment}
          options={[
            { value: "all", label: "Всё оборудование" },
            { value: "dumbbells", label: "Гантели" },
            { value: "bodyweight", label: "Вес тела" },
          ]}
        />
        <button
          type="button"
          className={`tel-pill-btn exlib-spine-btn${spineFriendly ? " active" : ""}`}
          aria-pressed={spineFriendly}
          onClick={() => setSpineFriendly((v) => !v)}
          title="Показать только упражнения с низкой осевой нагрузкой на поясницу"
        >
          <ShieldCheck size={14} aria-hidden="true" />
          Щадящие поясницу
        </button>
        <button
          type="button"
          className="tel-pill-btn exlib-spine-btn exlib-agent-btn"
          onClick={() => setAgentOpen(true)}
          title="Разобрать любой тренажёр или технику с помощью ИИ-агента биомеханики"
        >
          <Sparkles size={14} aria-hidden="true" />
          ИИ-разбор тренажёра
        </button>
      </div>
      {agentOpen ? (
        <Modal title="ИИ-агент разметки мышц" onClose={() => setAgentOpen(false)}>
          <BiomechanicalAgentPanel initialQuery={search} />
        </Modal>
      ) : null}

      {/* Мышечные группы */}
      <div className="tel-pill-row" role="group" aria-label="Мышечная группа">
        {[{ id: "all", short: "Все" }, ...MUSCLES].map((m) => (
          <button
            key={m.id}
            type="button"
            className={`tel-pill-btn${muscle === m.id ? " active" : ""}`}
            aria-pressed={muscle === m.id}
            onClick={() => setMuscle(m.id)}
          >
            {m.short}
          </button>
        ))}
      </div>

      {(muscle === "chest" || muscle === "shoulders") && (
        <div className="tel-pill-row" role="group" aria-label="Фильтр по пучкам мышц">
          {[
            { id: "all", label: "Все пучки" },
            ...(muscle === "chest"
              ? [
                  { id: "chest-upper", label: "Верх груди" },
                  { id: "chest-mid", label: "Середина груди" },
                  { id: "chest-lower", label: "Низ груди" },
                ]
              : [
                  { id: "deltoid-anterior", label: "Передняя дельта" },
                  { id: "deltoid-middle", label: "Средняя дельта" },
                  { id: "deltoid-posterior", label: "Задняя дельта" },
                ]),
          ].map((sub) => (
            <button
              key={sub.id}
              type="button"
              className={`tel-pill-btn${subheadFilter === sub.id ? " active" : ""}`}
              aria-pressed={subheadFilter === sub.id}
              onClick={() => setSubheadFilter(sub.id)}
            >
              {sub.label}
            </button>
          ))}
        </div>
      )}

      {/* Действия раздела «Мои» */}
      {source === "personal" && (onCreate || showBulkControl) ? (
        <div className="tel-card-head">
          {onCreate ? (
            <button type="button" className="button primary" onClick={onCreate}>
              <Plus size={16} aria-hidden="true" />
              Создать упражнение
            </button>
          ) : null}
          {showBulkControl ? (
            <button
              type="button"
              className="button secondary"
              aria-pressed={bulk}
              onClick={() => {
                setBulk((v) => !v);
                setPicked([]);
                setMarkResult("");
              }}
            >
              {bulk
                ? "Готово"
                : `Разметить мышцы (${unmarked.length + catalogGaps.length})`}
            </button>
          ) : null}
        </div>
      ) : null}

      {/* Массовая разметка (только по запросу) */}
      {source === "personal" && bulk && onMarked ? (
        <section className="tel-card" aria-label="Массовая разметка">
          <div className="tel-card-head">
            <h3>Выбрано: {picked.length}</h3>
            <div className="bulk-select">
              <button
                type="button"
                className="button secondary"
                onClick={() =>
                  setPicked(
                    [...filteredLocal.filter((e) => MuscleCoverage.unmarked(e)), ...gapsShown].map(
                      (e) => e.id,
                    ),
                  )
                }
              >
                Без разметки ({filteredLocal.filter((e) => MuscleCoverage.unmarked(e)).length + gapsShown.length})
              </button>
              <button
                type="button"
                className="button secondary"
                disabled={!picked.length}
                onClick={() => setPicked([])}
              >
                Снять выбор
              </button>
            </div>
          </div>
          <div className="bulk-apply">
            <label>
              Группа мышц
              <Select
                value={zonePick}
                disabled={!!marking}
                onChange={setZonePick}
                options={[{ value: "", label: "Выбери группу" }, ...MUSCLES.map((m) => ({ value: m.id, label: m.name }))]}
              />
            </label>
            <button
              type="button"
              className="button primary"
              disabled={!picked.length || !zonePick || !!marking}
              onClick={() => requestMarking({ zones: [zonePick] })}
            >
              Назначить группу
            </button>
          </div>
          <div className="bulk-apply">
            <label>
              Аналог из каталога
              <Select
                searchable
                value={basePick}
                disabled={!!marking}
                onChange={setBasePick}
                options={[
                  { value: "", label: "Выбери упражнение" },
                  ...exerciseCatalog.curatedExercises().map((e) => ({
                    value: e.id,
                    label: e.name,
                    search: [e.nameEn, ...(e.aliases ?? [])].join(" "),
                  })),
                ]}
              />
            </label>
            <button
              type="button"
              className="button primary"
              disabled={!picked.length || !basePick || !!marking}
              onClick={() => requestMarking({ basedOn: basePick })}
            >
              Привязать
            </button>
          </div>
          {confirm ? (
            <div className="bulk-confirm" role="alert">
              <p>
                <b>У {confirm.marked} уже есть разметка.</b> Заменить её на выбранную?
              </p>
              <div className="bulk-select">
                <button type="button" className="button danger" onClick={() => void applyMarking(confirm.patch, false)}>
                  Заменить ({confirm.marked})
                </button>
                {confirm.fresh ? (
                  <button type="button" className="button secondary" onClick={() => void applyMarking(confirm.patch, true)}>
                    Только без разметки ({confirm.fresh})
                  </button>
                ) : null}
                <button type="button" className="button secondary" onClick={() => setConfirm(null)}>
                  Отмена
                </button>
              </div>
            </div>
          ) : null}
          {marking ? <p role="status">Сохраняем {marking.done} из {marking.total}…</p> : null}
          {markResult ? <p role="status" className="bulk-result">{markResult}</p> : null}
        </section>
      ) : null}

      {source === "personal" && bulk && onMarked && gapsShown.length ? (
        <section className="tel-card" aria-label="Из каталога без мышц">
          <h3>Из каталога без разметки ({gapsShown.length})</h3>
          <ul>
            {gapsShown.map((e) => (
              <li key={e.id}>
                <label className="bulk-check">
                  <input
                    type="checkbox"
                    aria-label={`Выбрать ${e.name}`}
                    checked={picked.includes(e.id)}
                    onChange={() => togglePicked(e.id)}
                  />
                  <span>{e.name}</span>
                </label>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {source === "wger" && query.isError ? (
        <div className="error-banner" role="alert">
          <p>{query.error?.message}</p>
          <button type="button" onClick={() => query.refetch()}>
            Повторить
          </button>
        </div>
      ) : null}

      {source === "wger" && (query.isPending || query.data?.importing) ? (
        <div className="catalog-loading" role="status">
          <span className="loader" />
          <b>
            {query.data?.importing
              ? `Подготовка базы · ${query.data.imported} / ${query.data.catalogTotal}`
              : "Открываем базу…"}
          </b>
        </div>
      ) : (
        <>
          <div className="exlib-meta-row">
            <span>{quantity(count, "упражнение", "упражнения", "упражнений")}</span>
            {query.isFetching ? <span role="status">Обновляем…</span> : null}
          </div>

          <div
            className={picker ? "exlib-picker-list" : "exlib-grid"}
            aria-busy={source === "wger" && query.isFetching}
          >
            {exercises.map((e) => {
              const added = selectedIds.includes(e.id);
              const isFav = favorites.includes(e.id);
              const muscleLabels = zones(e)
                .slice(0, 2)
                .map((z) => MUSCLES.find((m) => m.id === z)?.short)
                .filter(Boolean);

              return (
                <article key={e.id} data-exercise-id={e.id} className="exlib-card">
                  <div className="exlib-card-main">
                    {source === "personal" && bulk && onMarked ? (
                      <label className="bulk-check">
                        <input
                          type="checkbox"
                          aria-label={`Выбрать ${e.name}`}
                          checked={picked.includes(e.id)}
                          onChange={() => togglePicked(e.id)}
                        />
                      </label>
                    ) : null}
                    <button
                      type="button"
                      className="exlib-card-title-btn"
                      onClick={() => onDetail(e.id)}
                    >
                      {e.name}
                    </button>
                    <div className="exlib-tags">
                      {muscleLabels.map((mName) => (
                        <span key={mName} className="exlib-tag is-accent">
                          {mName}
                        </span>
                      ))}
                      <span className="exlib-tag">{equipmentLabel(e.equipment)}</span>
                      {(() => {
                        const st = historyStats.get(e.id);
                        if (!st) return null;
                        return (
                          <span className="exlib-tag is-pr">
                            <Trophy size={11} aria-hidden="true" />
                            {st.bestE1rm > 0
                              ? `1ПМ ${fmt(st.bestE1rm)} кг`
                              : `${fmt(st.lastWeight)} кг × ${st.lastReps}`}
                          </span>
                        );
                      })()}
                    </div>
                  </div>

                  <div className="exlib-actions">
                    <button
                      type="button"
                      className="exlib-icon-btn"
                      aria-label={`Техника и мышцы: ${e.name}`}
                      title="Техника и мышцы"
                      onClick={() => onDetail(e.id)}
                    >
                      <Info size={16} aria-hidden="true" />
                    </button>
                    {onFavorite ? (
                      <button
                        type="button"
                        className={`exlib-icon-btn${isFav ? " is-fav" : ""}`}
                        aria-label={`${isFav ? "Убрать из избранного" : "В избранное"}: ${e.name}`}
                        aria-pressed={isFav}
                        onClick={() => onFavorite(e.id)}
                      >
                        <Star size={16} fill={isFav ? "currentColor" : "none"} aria-hidden="true" />
                      </button>
                    ) : null}
                    {e.custom && onEdit ? (
                      <button
                        type="button"
                        className="exlib-icon-btn"
                        aria-label={`Редактировать ${e.name}`}
                        onClick={() => onEdit(e)}
                      >
                        <Pencil size={15} aria-hidden="true" />
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="exlib-icon-btn is-primary"
                      aria-label={`Добавить ${e.name}`}
                      disabled={added || limitReached}
                      onClick={() => onAdd(e.id)}
                    >
                      {added ? <Check size={17} aria-hidden="true" /> : <Plus size={17} aria-hidden="true" />}
                    </button>
                  </div>
                </article>
              );
            })}

            {!exercises.length ? (
              <div className="no-results">
                Ничего не нашлось. Попробуй другой запрос или фильтр.
              </div>
            ) : null}
          </div>

          {source === "wger" && count > 24 ? (
            <div className="catalog-pagination">
              <button
                type="button"
                className="button secondary"
                disabled={page <= 1 || query.isFetching}
                onClick={() => setPage((p) => p - 1)}
              >
                <ChevronLeft size={16} aria-hidden="true" />
                Назад
              </button>
              <span>
                {page} / {Math.ceil(count / 24)}
              </span>
              <button
                type="button"
                className="button secondary"
                disabled={page >= Math.ceil(count / 24) || query.isFetching}
                onClick={() => setPage((p) => p + 1)}
              >
                Далее
                <ChevronRight size={16} aria-hidden="true" />
              </button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

export default function ExerciseLibrary(props: Parameters<typeof LibraryContent>[0]) {
  return <LibraryContent {...props} />;
}
