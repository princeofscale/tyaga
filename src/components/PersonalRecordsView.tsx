import { useMemo, useState } from "react";
import { ChevronRight, Search, Sparkles, Trophy, X } from "lucide-react";
import { AnalyticsFacts } from "../domain/AnalyticsFacts";
import { PersonalRecordsCalculator } from "../domain/PersonalRecords";
import { addCalendarDays, localDate } from "../lib/calendar";
import { dateLabel, fmt, type Settings, type Workout } from "../lib/model";

type FilterCategory = "big5" | "all" | "chest" | "back" | "legs" | "shoulders" | "arms";
type SortMode = "e1rm" | "weight" | "recent";

const FILTERS: ReadonlyArray<{ id: FilterCategory; label: string }> = [
  { id: "big5", label: "Базовые" },
  { id: "all", label: "Все" },
  { id: "chest", label: "Грудь" },
  { id: "back", label: "Спина" },
  { id: "legs", label: "Ноги" },
  { id: "shoulders", label: "Плечи" },
  { id: "arms", label: "Руки" },
];

function isBigMovement(id: string, name: string): boolean {
  const s = `${id} ${name}`.toLowerCase();
  return (
    s.includes("bench") ||
    s.includes("squat") ||
    s.includes("deadlift") ||
    s.includes("rdl") ||
    s.includes("ohp") ||
    s.includes("pullup") ||
    s.includes("pulldown") ||
    s.includes("row") ||
    s.includes("dip") ||
    s.includes("жим штанги") ||
    s.includes("присед") ||
    s.includes("становая") ||
    s.includes("румынская") ||
    s.includes("подтягиван")
  );
}

/**
 * Выделенная вкладка «Рекорды» (Прогресс → Рекорды):
 * точное разделение лучшего рабочего подхода и расчётного 1ПМ, поиск, сортировка и клик в график.
 */
export default function PersonalRecordsView({
  workouts: history,
  settings,
  onOpenExerciseStrength,
}: {
  workouts: Workout[];
  settings: Settings;
  onOpenExerciseStrength?: (key: string) => void;
}) {
  const [category, setCategory] = useState<FilterCategory>("big5");
  const [sortBy, setSortBy] = useState<SortMode>("e1rm");
  const [query, setQuery] = useState("");

  const workouts = useMemo(
    () => new AnalyticsFacts(history, { timeZone: settings.timeZone }).workouts(),
    [history, settings.timeZone],
  );

  const prs = useMemo(
    () => new PersonalRecordsCalculator(workouts).calculateRecords(settings.timeZone),
    [workouts, settings.timeZone],
  );

  const recentCutoff = useMemo(
    () => addCalendarDays(localDate(new Date(), settings.timeZone), -30),
    [settings.timeZone],
  );

  const stats = useMemo(() => {
    const recent30 = prs.filter(
      (p) => p.bestWeight.date >= recentCutoff || (p.bestE1rm?.date ?? "") >= recentCutoff,
    ).length;
    const topE1rm = prs.reduce((max, p) => Math.max(max, p.bestE1rm?.e1rm ?? 0), 0);
    return { total: prs.length, recent30, topE1rm };
  }, [prs, recentCutoff]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = prs.filter((p) => {
      if (q && !`${p.name} ${p.context ?? ""}`.toLowerCase().includes(q)) return false;
      if (category === "all") return true;
      if (category === "big5") return isBigMovement(p.exerciseId, p.name);
      if (category === "chest") return p.category.includes("chest");
      if (category === "back") return p.category.includes("back");
      if (category === "legs") {
        return p.category.some((m) => ["quads", "hamstrings", "glutes", "calves"].includes(m));
      }
      if (category === "shoulders") return p.category.includes("shoulders");
      if (category === "arms") {
        return p.category.some((m) => ["biceps", "triceps"].includes(m));
      }
      return true;
    });

    const sorted = [...list];
    sorted.sort((a, b) => {
      if (sortBy === "recent") {
        const da = Math.max(
          Date.parse(a.bestWeight.date) || 0,
          Date.parse(a.bestE1rm?.date ?? "") || 0,
        );
        const db = Math.max(
          Date.parse(b.bestWeight.date) || 0,
          Date.parse(b.bestE1rm?.date ?? "") || 0,
        );
        return db - da || (b.bestE1rm?.e1rm ?? 0) - (a.bestE1rm?.e1rm ?? 0);
      }
      if (sortBy === "weight") {
        return b.bestWeight.weight - a.bestWeight.weight || b.bestWeight.reps - a.bestWeight.reps;
      }
      return (
        (b.bestE1rm?.e1rm ?? 0) - (a.bestE1rm?.e1rm ?? 0) ||
        b.bestWeight.weight - a.bestWeight.weight
      );
    });
    return sorted;
  }, [prs, category, sortBy, query]);

  return (
    <div className="tel-panel pr-view-shell">
      <section className="tel-hero is-single pr-view-hero" aria-label="Сводка личных рекордов">
        <div className="pr-view-hero-top">
          <div className="pr-view-title">
            <span className="tel-eyebrow-pill">
              <Trophy size={14} aria-hidden="true" />
              Зал рекордов
            </span>
            <h2>Личные рекорды</h2>
          </div>

          <div className="pr-view-kpis">
            <div className="pr-view-kpi">
              <span>Упражнений</span>
              <strong>{stats.total}</strong>
            </div>
            <div className="pr-view-kpi is-recent">
              <span>За 30 дн.</span>
              <strong>{stats.recent30}</strong>
            </div>
            <div className="pr-view-kpi">
              <span>Макс. 1ПМ</span>
              <strong>{stats.topE1rm > 0 ? `${fmt(stats.topE1rm)} кг` : "—"}</strong>
            </div>
          </div>
        </div>

        <div className="pr-view-controls">
          <div className="pr-search-box">
            <Search size={15} aria-hidden="true" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Найти упражнение…"
              aria-label="Поиск по личным рекордам"
            />
            {query ? (
              <button
                type="button"
                className="pr-search-clear"
                aria-label="Очистить поиск"
                onClick={() => setQuery("")}
              >
                <X size={14} aria-hidden="true" />
              </button>
            ) : null}
          </div>

          <div className="sf-sex-toggle pr-sort-toggle" role="group" aria-label="Сортировка рекордов">
            {(
              [
                ["e1rm", "1ПМ"],
                ["weight", "Вес"],
                ["recent", "Свежие"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={sortBy === id ? "is-active" : ""}
                aria-pressed={sortBy === id}
                onClick={() => setSortBy(id)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="tel-pill-row" role="group" aria-label="Фильтр рекордов по мышцам">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              className={`tel-pill-btn${category === f.id ? " active" : ""}`}
              aria-pressed={category === f.id}
              onClick={() => setCategory(f.id)}
            >
              {f.label}
            </button>
          ))}
        </div>
      </section>

      {filtered.length > 0 ? (
        <div className="pr-v2-grid-wrap">
          <div className="pr-v2-grid">
            {filtered.map((pr) => {
              const isRecent =
                pr.bestWeight.date >= recentCutoff || (pr.bestE1rm?.date ?? "") >= recentCutoff;
              const bestDate =
                pr.bestE1rm && pr.bestE1rm.date > pr.bestWeight.date
                  ? pr.bestE1rm.date
                  : pr.bestWeight.date;
              const clickable = Boolean(onOpenExerciseStrength);
              const Tag = clickable ? "button" : "article";
              return (
                <Tag
                  key={pr.key}
                  {...(clickable
                    ? {
                        type: "button" as const,
                        onClick: () => onOpenExerciseStrength?.(pr.key),
                        "aria-label": `Открыть динамику: ${pr.name}`,
                      }
                    : {})}
                  className={`pr-v2-card${isRecent ? " is-recent" : ""}${clickable ? " is-clickable" : ""}`}
                >
                  <div className="pr-v2-head">
                    <div className="pr-v2-name-col">
                      <div className="pr-v2-title-line">
                        <h3>{pr.name}</h3>
                        {isRecent ? (
                          <span className="pr-v2-new-badge">
                            <Sparkles size={11} aria-hidden="true" />
                            PR
                          </span>
                        ) : null}
                      </div>
                      <span className="pr-v2-meta">
                        {dateLabel(bestDate, true)}
                        {pr.context ? ` · ${pr.context}` : ""}
                      </span>
                    </div>
                    {clickable ? <ChevronRight size={17} className="pr-v2-arrow" aria-hidden="true" /> : null}
                  </div>

                  <div className="pr-v2-metrics">
                    {pr.bestE1rm ? (
                      <div className="pr-v2-metric is-primary">
                        <span className="pr-v2-metric-label">Расчётный 1ПМ</span>
                        <strong>
                          {fmt(pr.bestE1rm.e1rm)} <small>кг</small>
                        </strong>
                        <span className="pr-v2-metric-sub">
                          из {fmt(pr.bestE1rm.weight)} × {pr.bestE1rm.reps}
                        </span>
                      </div>
                    ) : null}

                    <div className={`pr-v2-metric${!pr.bestE1rm ? " is-primary" : ""}`}>
                      <span className="pr-v2-metric-label">Макс. подход</span>
                      <strong>
                        {fmt(pr.bestWeight.weight)}{" "}
                        <small>
                          {pr.unit === "кг" ? `кг × ${pr.bestWeight.reps}` : pr.unit}
                        </small>
                      </strong>
                      <span className="pr-v2-metric-sub">{pr.bestWeight.workoutName}</span>
                    </div>
                  </div>
                </Tag>
              );
            })}
          </div>
        </div>
      ) : (
        <section className="tel-card pr-v2-empty">
          <Trophy size={28} aria-hidden="true" />
          <h3>Рекордов пока нет</h3>
          <p>
            {query
              ? "По этому запросу ничего не найдено — попробуй сбросить поиск или выбрать вкладку «Все»."
              : "Запиши рабочие подходы с весом, чтобы здесь появились точные рекорды и расчётный 1ПМ."}
          </p>
        </section>
      )}
    </div>
  );
}
