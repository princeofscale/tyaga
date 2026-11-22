import { useEffect, useMemo, useState } from "react";
import {
  useQuery,
  keepPreviousData,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Database,
  Dumbbell,
  Globe2,
  Plus,
  Search,
  Star,
  Pencil,
} from "lucide-react";
import Select from "./Select";
import { MUSCLES, exerciseCatalog, type Exercise } from "../lib/model";
import { WGER_ZONES } from "../domain/WgerExercise";
import { matchesSearch, normalizeSearch } from "../lib/search";
import { ExerciseSearchRank } from "../domain/ExerciseSearchRank";
import { quantity } from "../lib/quantity";
import { exerciseLibraryService } from "../services/ExerciseLibraryService";
import { MuscleParticipation } from "../domain/MuscleParticipation";
import { MuscleCoverage } from "../domain/MuscleCoverage";
import { PersonalExerciseMarking, type Marking } from "../domain/PersonalExerciseMarking";
import { productService } from "../services/ProductService";

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
  /** Упражнения сохранены с новой разметкой (массовое назначение группы или упражнения каталога). */
  onMarked?: (exercises: Exercise[]) => void;
  /** Открыть «Мои» сразу в режиме разметки (переход из «Прогресс → Мышцы»). */
  startMarking?: boolean;
  /** Упражнения каталога (например, из базы) без мышц, которые уже есть в журнале: размечаются своей копией. */
  catalogGaps?: Exercise[];
}) {
  const [source, setSource] = useState<
    "tyaga" | "wger" | "personal" | "favorites"
  >(startMarking ? "personal" : "tyaga");
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
  const [page, setPage] = useState(1);
  const [language, setLanguage] = useState("all");
  useEffect(() => {
    const id = setTimeout(() => setDebounced(search), 200);
    return () => clearTimeout(id);
  }, [search]);
  useEffect(() => {
    setPage(1);
    setSubheadFilter("all");
  }, [muscle]);
  useEffect(() => setPage(1), [debounced, equipment, language, subheadFilter]);
  const query = useQuery({
    queryKey: ["wger", debounced, muscle, equipment, page, language],
    queryFn: ({ signal }) =>
      exerciseLibraryService.find(
        { search: debounced, muscle, equipment, page, language },
        signal,
      ),
    enabled: source === "wger",
    staleTime: 300000,
    placeholderData: keepPreviousData,
    refetchInterval: (q) => (q.state.data?.importing ? 400 : false),
    retry: 1,
  });
  const local =
    source === "personal"
      ? personal
      : favorites
          .map((id) => exerciseCatalog.find(id))
          .filter((e): e is Exercise => !!e);
  const filteredLocal = local.filter(
    (e) =>
      matchesSearch(
        `${e.name} ${e.nameEn} ${(e.aliases ?? []).join(" ")}`,
        search,
      ) &&
      (muscle === "all" ||
        e.custom?.declaredZones.includes(muscle as never) ||
        e.primary.includes(muscle as never)) &&
      (equipment === "all" || e.equipment === equipment),
  );
  const baseExercises =
    source === "tyaga"
      ? exerciseCatalog.search({ text: search, zone: muscle, equipment })
      : source === "wger"
        ? ExerciseSearchRank.withCoreFirst(
            query.data?.exercises ?? [],
            page === 1 && language !== "en"
              ? exerciseCatalog.search({ text: debounced, zone: muscle, equipment })
              : [],
            debounced,
            normalizeSearch,
          )
        : filteredLocal;

  const exercises =
    subheadFilter !== "all"
      ? baseExercises.filter((e) => MuscleParticipation.headRole(subheadFilter, e) !== undefined)
      : baseExercises;
  const unmarked = useMemo(() => MuscleCoverage.unmarkedPersonal(personal), [personal]);
  const togglePicked = (id: string) =>
    setPicked((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
  const gapsShown = catalogGaps.filter((e) => matchesSearch(`${e.name} ${e.nameEn}`, search));
  /** Сначала спрашиваем, если среди выбранных есть уже размеченные: молча их не переписываем. */
  function requestMarking(patch: Marking) {
    const chosen = personal.filter((e) => picked.includes(e.id));
    const { marked, unmarked: fresh } = PersonalExerciseMarking.split(chosen);
    if (marked.length) {
      setConfirm({ patch, marked: marked.length, fresh: fresh.length + catalogGaps.filter((e) => picked.includes(e.id)).length });
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
          (onlyUnmarked && chosenPersonal.length > own.length ? ` Уже размеченные (${chosenPersonal.length - own.length}) не тронуты.` : "") +
          " Мышцы в «Прогрессе» пересчитаны, в том числе за прошлые тренировки.",
      );
      setPicked([]);
    } catch (e) {
      setMarkResult(`Размечено ${saved.length} из ${todo.length}. ${e instanceof Error ? e.message : "Не удалось сохранить"}`);
    } finally {
      if (saved.length) onMarked?.(saved);
      setMarking(null);
    }
  }
  // Число на вкладке — весь список без поиска и фильтров, а не устаревшая константа.
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
  return (
    <div className={`exercise-library ${picker ? "is-picker" : ""}`}>
      <div className="catalog-tabs" role="group" aria-label="Каталог упражнений">
        <button
          className={source === "tyaga" ? "active" : ""}
          aria-pressed={source === "tyaga"}
          onClick={() => {
            setSource("tyaga");
            setPage(1);
          }}
        >
          <Dumbbell size={17} />
          Основные <span>{curatedTotal}</span>
        </button>
        <button
          className={source === "wger" ? "active" : ""}
          aria-pressed={source === "wger"}
          onClick={() => {
            setSource("wger");
            setPage(1);
          }}
        >
          <Database size={17} />
          База <span>{query.data?.catalogTotal ?? 918}</span>
        </button>
        <button
          className={source === "personal" ? "active" : ""}
          aria-pressed={source === "personal"}
          onClick={() => setSource("personal")}
        >
          <Pencil size={17} />
          Мои <span>{personal.length}</span>
        </button>
        <button
          className={source === "favorites" ? "active" : ""}
          aria-pressed={source === "favorites"}
          onClick={() => setSource("favorites")}
        >
          <Star size={17} />
          Избранное <span>{favorites.length}</span>
        </button>
      </div>
      {source === "personal" && onCreate ? (
        <button className="button secondary personal-create" onClick={onCreate}>
          <Plus size={17} />
          Создать упражнение
        </button>
      ) : null}
      {source === "personal" && onMarked && (personal.length || catalogGaps.length) ? (
        <div className="bulk-head">
          <span>
            {unmarked.length + catalogGaps.length
              ? `Без разметки мышц: ${unmarked.length + catalogGaps.length} из ${personal.length + catalogGaps.length}`
              : "У всех упражнений есть разметка мышц"}
          </span>
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
            {bulk ? "Готово" : "Разметить несколько"}
          </button>
        </div>
      ) : null}
      {source === "personal" && bulk && onMarked ? (
        <section className="bulk-panel panel" aria-label="Массовая разметка">
          <p>
            <b>Выбрано {picked.length}</b> из {filteredLocal.length + gapsShown.length}
          </p>
          <div className="bulk-select">
            <button type="button" className="button secondary" onClick={() => setPicked([...filteredLocal.filter((e) => MuscleCoverage.unmarked(e)), ...gapsShown].map((e) => e.id))}>
              Выбрать без разметки ({filteredLocal.filter((e) => MuscleCoverage.unmarked(e)).length + gapsShown.length})
            </button>
            <button type="button" className="button secondary" onClick={() => setPicked([...filteredLocal, ...gapsShown].map((e) => e.id))}>
              Выбрать все показанные
            </button>
            <button type="button" className="button secondary" disabled={!picked.length} onClick={() => setPicked([])}>
              Снять выбор
            </button>
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
              Это то же, что…
              <Select
                searchable
                value={basePick}
                disabled={!!marking}
                onChange={setBasePick}
                options={[
                  { value: "", label: "Выбери упражнение каталога" },
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
              Назначить упражнение каталога
            </button>
          </div>
          {confirm ? (
            <div className="bulk-confirm" role="alert">
              <p>
                <b>У {confirm.marked} уже есть разметка.</b> Заменить её на выбранную? Прежняя группа или привязка пропадёт.
              </p>
              <div className="bulk-select">
                <button type="button" className="button danger" onClick={() => void applyMarking(confirm.patch, false)}>
                  Заменить разметку у {confirm.marked}
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
          {marking ? (
            <p role="status">
              Сохраняем {marking.done} из {marking.total}…
            </p>
          ) : null}
          {markResult ? <p role="status" className="bulk-result">{markResult}</p> : null}
        </section>
      ) : null}
      {source === "personal" && bulk && onMarked && gapsShown.length ? (
        <section className="bulk-gaps panel" aria-label="Из каталога без мышц">
          <h3>Из каталога без мышц · {gapsShown.length}</h3>
          <p className="tiny">
            В каталоге у этих упражнений нет разметки мышц. Выбери их и назначь группу или движение: появится своя копия с тем же названием, а история подхватит мышцы.
          </p>
          <ul>
            {gapsShown.map((e) => (
              <li key={e.id}>
                <label className="bulk-check">
                  <input type="checkbox" aria-label={`Выбрать ${e.name}`} checked={picked.includes(e.id)} onChange={() => togglePicked(e.id)} />
                </label>
                <span>{e.name}</span>
                <small>из каталога</small>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <div className="exercise-filters">
        <div className="search-field">
          <Search size={18} aria-hidden="true" />
          <input
            aria-label="Поиск упражнений"
            placeholder={
              source === "wger"
                ? "Название на русском или английском…"
                : "Найти упражнение…"
            }
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search ? (
            <button
              className="text-button"
              aria-label="Очистить поиск"
              onClick={() => setSearch("")}
            >
              ×
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
      </div>
      <div className="muscle-chips-row" role="group" aria-label="Мышечная группа">
        {[{ id: "all", short: "Все" }, ...MUSCLES].map((m) => (
          <button
            key={m.id}
            className={muscle === m.id ? "active" : ""}
            aria-pressed={muscle === m.id}
            onClick={() => setMuscle(m.id)}
          >
            {m.short}
          </button>
        ))}
      </div>

      {(muscle === "chest" || muscle === "shoulders") && (
        <div className="subhead-filters-row" role="group" aria-label="Фильтр по пучкам мышц">
          <span className="subhead-label">
            {muscle === "chest" ? "Отдел груди:" : "Пучок дельты:"}
          </span>
          <button
            type="button"
            className={`subhead-btn ${subheadFilter === "all" ? "active" : ""}`}
            aria-pressed={subheadFilter === "all"}
            onClick={() => setSubheadFilter("all")}
          >
            Все
          </button>
          {muscle === "chest" ? (
            <>
              <button
                type="button"
                className={`subhead-btn ${subheadFilter === "chest-upper" ? "active" : ""}`}
                aria-pressed={subheadFilter === "chest-upper"}
                onClick={() => setSubheadFilter("chest-upper")}
              >
                Верх груди
              </button>
              <button
                type="button"
                className={`subhead-btn ${subheadFilter === "chest-mid" ? "active" : ""}`}
                aria-pressed={subheadFilter === "chest-mid"}
                onClick={() => setSubheadFilter("chest-mid")}
              >
                Середина груди
              </button>
              <button
                type="button"
                className={`subhead-btn ${subheadFilter === "chest-lower" ? "active" : ""}`}
                aria-pressed={subheadFilter === "chest-lower"}
                onClick={() => setSubheadFilter("chest-lower")}
              >
                Низ груди
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className={`subhead-btn ${subheadFilter === "deltoid-anterior" ? "active" : ""}`}
                aria-pressed={subheadFilter === "deltoid-anterior"}
                onClick={() => setSubheadFilter("deltoid-anterior")}
              >
                Передняя дельта
              </button>
              <button
                type="button"
                className={`subhead-btn ${subheadFilter === "deltoid-middle" ? "active" : ""}`}
                aria-pressed={subheadFilter === "deltoid-middle"}
                onClick={() => setSubheadFilter("deltoid-middle")}
              >
                Средняя дельта
              </button>
              <button
                type="button"
                className={`subhead-btn ${subheadFilter === "deltoid-posterior" ? "active" : ""}`}
                aria-pressed={subheadFilter === "deltoid-posterior"}
                onClick={() => setSubheadFilter("deltoid-posterior")}
              >
                Задняя дельта
              </button>
            </>
          )}
        </div>
      )}
      {source === "wger" && query.isError ? (
        <div className="error-banner" role="alert">
          <p>{query.error.message}</p>
          <button onClick={() => void query.refetch()}>Повторить</button>
        </div>
      ) : null}
      {source === "wger" && (query.isPending || query.data?.importing) ? (
        <div className="catalog-loading" role="status">
          <span className="loader" />
          <b>
            {query.data?.importing
              ? `Подготовка библиотеки · ${query.data.imported} / ${query.data.catalogTotal}`
              : "Открываем библиотеку…"}
          </b>
          <span>Упражнения сохраняются в локальной базе приложения.</span>
        </div>
      ) : (
        <>
          <div className="library-header">
            <span>
              {quantity(count, "упражнение", "упражнения", "упражнений")}
            </span>
            {query.isFetching ? <span role="status">Обновляем…</span> : null}
          </div>
          <div
            className={picker ? "picker-list" : "library-grid"}
            aria-busy={source === "wger" && query.isFetching}
          >
            {exercises.map((e, i) => {
              const added = selectedIds.includes(e.id);
              const loggable = e.source?.record.loggable ?? true;
              return (
                <article
                  key={e.id}
                  data-exercise-id={e.id}
                  className={picker ? "picker-exercise" : "library-card panel"}
                >
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
                  <div className="library-icon" aria-hidden="true">
                    <Dumbbell size={19} />
                  </div>
                  <div className="library-copy">
                    <h3>{e.name}</h3>
                    {e.source || e.custom ? (
                      <span className="exercise-source-tag">
                        {e.custom
                          ? "Моё"
                          : e.source!.record.review
                            ? "Проверено"
                            : "Не проверено"}
                      </span>
                    ) : null}
                    {(() => {
                      const badge = MuscleParticipation.primaryLabel(e);
                      return badge ? (
                        <span className="library-head-tag">{badge}</span>
                      ) : null;
                    })()}
                    <p>
                      {zones(e)
                        .slice(0, 3)
                        .map(
                          (zone) => MUSCLES.find((m) => m.id === zone)?.short,
                        )
                        .join(" · ") || "Мышцы не указаны источником"}
                    </p>
                    <button
                      className="text-button"
                      onClick={() => onDetail(e.id)}
                    >
                      Техника и мышцы
                    </button>
                    {!loggable ? (
                      <small className="timed-only">
                        Служебная запись для отдыха
                      </small>
                    ) : null}
                  </div>
                  <div className="library-actions">
                    <button
                      className={
                        picker ? "icon-button add-exercise-button" : "library-add"
                      }
                      aria-label={`Добавить ${e.name}`}
                      disabled={added || limitReached || !loggable}
                      onClick={() => onAdd(e.id)}
                    >
                      {added ? <Check size={19} /> : <Plus size={19} />}
                    </button>
                    {onFavorite ? (
                      <button
                        className={`favorite-button ${favorites.includes(e.id) ? "active" : ""}`}
                        aria-label={`${favorites.includes(e.id) ? "Убрать из избранного" : "В избранное"}: ${e.name}`}
                        aria-pressed={favorites.includes(e.id)}
                        onClick={() => onFavorite(e.id)}
                      >
                        <Star
                          size={17}
                          fill={
                            favorites.includes(e.id) ? "currentColor" : "none"
                          }
                        />
                      </button>
                    ) : null}
                    {e.custom && onEdit ? (
                      <button
                        className="custom-edit-button"
                        aria-label={`Редактировать ${e.name}`}
                        onClick={() => onEdit(e)}
                      >
                        <Pencil size={15} />
                      </button>
                    ) : null}
                  </div>
                  {!picker ? (
                    <span className="library-index" aria-hidden="true">
                      {String(
                        (source === "wger" ? (page - 1) * 24 : 0) + i + 1,
                      ).padStart(2, "0")}
                    </span>
                  ) : null}
                </article>
              );
            })}
            {!exercises.length ? (
              <div className="no-results">
                Нет подходящих упражнений. Попробуй другой поиск или фильтр.
              </div>
            ) : null}
          </div>
          {source === "wger" && count > 24 ? (
            <div className="catalog-pagination">
              <button
                className="button secondary"
                disabled={page <= 1 || query.isFetching}
                onClick={() => setPage((p) => p - 1)}
              >
                <ChevronLeft size={16} />
                Назад
              </button>
              <span>
                {page} / {Math.ceil(count / 24)}
              </span>
              <button
                className="button secondary"
                disabled={page >= Math.ceil(count / 24) || query.isFetching}
                onClick={() => setPage((p) => p + 1)}
              >
                Далее
                <ChevronRight size={16} />
              </button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false, retry: 1 } },
});
export default function ExerciseLibrary(
  props: Parameters<typeof LibraryContent>[0],
) {
  return (
    <QueryClientProvider client={queryClient}>
      <LibraryContent {...props} />
    </QueryClientProvider>
  );
}
