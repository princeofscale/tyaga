import { useEffect, useState } from "react";
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
import { MUSCLES, exerciseCatalog, type Exercise } from "../lib/model";
import { WGER_ZONES } from "../domain/WgerExercise";
import { matchesSearch } from "../lib/search";
import { quantity } from "../lib/quantity";
import { exerciseLibraryService } from "../services/ExerciseLibraryService";

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
}) {
  const [source, setSource] = useState<
    "tyaga" | "wger" | "personal" | "favorites"
  >("tyaga");
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [muscle, setMuscle] = useState(defaultMuscle);
  const [equipment, setEquipment] = useState("all");
  const [page, setPage] = useState(1);
  const [language, setLanguage] = useState("all");
  useEffect(() => {
    const id = setTimeout(() => setDebounced(search), 200);
    return () => clearTimeout(id);
  }, [search]);
  useEffect(() => setPage(1), [debounced, muscle, equipment, language]);
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
  const exercises =
    source === "tyaga"
      ? exerciseCatalog.search({ text: search, zone: muscle, equipment })
      : source === "wger"
        ? (query.data?.exercises ?? [])
        : filteredLocal;
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
      <div className="catalog-tabs" aria-label="Каталог упражнений">
        <button
          className={source === "tyaga" ? "active" : ""}
          aria-pressed={source === "tyaga"}
          onClick={() => {
            setSource("tyaga");
            setPage(1);
          }}
        >
          <Dumbbell size={17} />
          Основные <span>31</span>
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
      <div className="exercise-filters">
        <div className="search-field">
          <Search size={18} />
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
        <select
          aria-label="Оборудование упражнений"
          value={equipment}
          onChange={(e) => setEquipment(e.target.value)}
        >
          <option value="all">Всё оборудование</option>
          <option value="dumbbells">Гантели</option>
          <option value="bodyweight">Вес тела</option>
        </select>
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
      {source === "wger" ? (
        <p className="source-notice">
          <Globe2 size={16} />
          Открытая база wger: описания переведены автоматически, проверенные
          варианты отмечены.
        </p>
      ) : null}
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
                  <div className="library-icon">
                    <Dumbbell size={21} />
                  </div>
                  <div className="library-copy">
                    {e.source || e.custom ? (
                      <span className="exercise-source-tag">
                        {e.custom
                          ? "Моё"
                          : e.source!.record.review
                            ? "Проверено"
                            : "Не проверено"}
                      </span>
                    ) : null}
                    <h3>{e.name}</h3>
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
                  {!picker ? (
                    <span className="library-index">
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
