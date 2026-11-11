import { m, useReducedMotion } from "motion/react";
import { useMemo, useState } from "react";
import {
  Trophy,
  Flame,
  Clock,
  TrendingUp,
  Dumbbell,
  Scale,
  Calendar,
  Layers,
  ChevronRight,
  Sparkles,
  Zap,
  Info,
} from "lucide-react";
import {
  PersonalRecordsCalculator,
  type ExercisePR,
  type ActivityHeatmapDay,
} from "../domain/PersonalRecords";
import {
  localDate,
  volumeSummary,
  fmt,
  dateLabel,
  MUSCLES,
  type Workout,
  type Settings,
} from "../lib/model";

export default function StatsAnalytics({
  workouts,
  settings,
  onOpenExerciseStrength,
  compact = false,
  weeks = 16,
  rangeStart,
}: {
  workouts: Workout[];
  settings: Settings;
  compact?: boolean;
  weeks?: number;
  rangeStart?: string;
  onOpenExerciseStrength?: (key: string) => void;
}) {
  const [filterCategory, setFilterCategory] = useState<
    "all" | "big5" | "chest" | "back" | "legs" | "shoulders"
  >("big5");
  const [selectedDay, setSelectedDay] = useState<ActivityHeatmapDay | null>(
    null,
  );

  const calc = useMemo(
    () => new PersonalRecordsCalculator(workouts),
    [workouts],
  );
  const prs = useMemo(() => calc.calculateRecords(), [calc]);
  const streak = useMemo(
    () => calc.calculateStreak(settings.timeZone),
    [calc, settings.timeZone],
  );
  const trends = useMemo(
    () => calc.calculateVolumeTrends(settings.timeZone),
    [calc, settings.timeZone],
  );
  const ratios = useMemo(() => calc.calculateRatios(), [calc]);
  const heatmap = useMemo(
    () => calc.calculateHeatmap(weeks + (compact ? 1 : 0), settings.timeZone),
    [calc, settings.timeZone, weeks, compact],
  );

  const totalVolume = useMemo(() => volumeSummary(workouts).total, [workouts]);
  const reduced = useReducedMotion();
  const totalWorkingSets = useMemo(
    () =>
      workouts.reduce(
        (sum, w) =>
          sum +
          w.exercises.reduce(
            (eSum, e) =>
              eSum + e.sets.filter((s) => s.done && !s.warmup).length,
            0,
          ),
        0,
      ),
    [workouts],
  );

  const totalDurationMinutes = useMemo(
    () => workouts.reduce((sum, w) => sum + (w.duration || 0), 0),
    [workouts],
  );

  const avgWorkoutVolume = workouts.length
    ? Math.round(totalVolume / workouts.length)
    : 0;
  const avgWorkoutDuration = workouts.length
    ? Math.round(totalDurationMinutes / workouts.length)
    : 0;
  const totalHours = Math.floor(totalDurationMinutes / 60);
  const totalMinutes = totalDurationMinutes % 60;

  const isBig5 = (id: string, name: string) => {
    const s = `${id} ${name}`.toLowerCase();
    return (
      s.includes("bench") ||
      s.includes("squat") ||
      s.includes("deadlift") ||
      s.includes("rdl") ||
      s.includes("ohp") ||
      s.includes("pullup") ||
      s.includes("pulldown") ||
      s.includes("жим штанги") ||
      s.includes("присед") ||
      s.includes("тяга")
    );
  };

  const filteredPrs = useMemo(() => {
    if (filterCategory === "all") return prs;
    if (filterCategory === "big5")
      return prs.filter((p) => isBig5(p.exerciseId, p.name));
    return prs.filter((p) => {
      if (filterCategory === "chest") return p.category.includes("chest");
      if (filterCategory === "back") return p.category.includes("back");
      if (filterCategory === "legs")
        return p.category.some((m) =>
          ["quads", "hamstrings", "glutes", "calves"].includes(m),
        );
      if (filterCategory === "shoulders")
        return p.category.includes("shoulders");
      return true;
    });
  }, [prs, filterCategory]);

  return (
    <m.div
      className="stats-analytics-view progress-analytics"
      initial={reduced ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
    >
      {/* 1. Hero Highlights Grid */}
      {!compact && (
        <section
          className="analytics-hero-grid"
          aria-label="Сводные показатели"
        >
          <div className="stat-card accent-glow">
            <div className="stat-card-icon">
              <Zap size={22} />
            </div>
            <div className="stat-card-content">
              <span className="stat-label">Тоннаж свободных весов</span>
              <b className="stat-value">
                {fmt(
                  totalVolume >= 10000
                    ? Math.round(totalVolume / 100) / 10
                    : totalVolume,
                )}{" "}
                <small>{totalVolume >= 10000 ? "т" : "кг"}</small>
              </b>
              {trends.priorVolume > 0 && trends.growthPct !== 0 && (
                <span
                  className={`stat-trend ${trends.growthPct > 0 ? "positive" : "negative"}`}
                >
                  {trends.growthPct > 0
                    ? `+${trends.growthPct}%`
                    : `${trends.growthPct}%`}{" "}
                  за 4 нед.
                </span>
              )}
            </div>
          </div>

          <div className="stat-card streak-glow">
            <div className="stat-card-icon streak">
              <Flame size={22} />
            </div>
            <div className="stat-card-content">
              <span className="stat-label">Серия тренировок</span>
              <b className="stat-value">
                {streak.currentWeekStreak} <small>нед. подряд</small>
              </b>
              <span className="stat-sub">
                Рекорд: {streak.bestWeekStreak} нед.
              </span>
            </div>
          </div>

          <div className="stat-card">
            <div className="stat-card-icon">
              <Clock size={22} />
            </div>
            <div className="stat-card-content">
              <span className="stat-label">Время в зале</span>
              <b className="stat-value">
                {totalHours} <small>ч</small> {totalMinutes} <small>мин</small>
              </b>
              <span className="stat-sub">
                ~{avgWorkoutDuration} мин / тренировка
              </span>
            </div>
          </div>

          <div className="stat-card">
            <div className="stat-card-icon">
              <Layers size={22} />
            </div>
            <div className="stat-card-content">
              <span className="stat-label">Рабочих подходов</span>
              <b className="stat-value">{totalWorkingSets}</b>
              <span className="stat-sub">
                {workouts.length} тренировок всего
              </span>
            </div>
          </div>
        </section>
      )}

      {/* 2. Interactive Activity Calendar Heatmap */}
      <section className="panel heatmap-panel">
        <div className="panel-header">
          <div>
            <h2>Календарь активности</h2>
            <p>
              {compact
                ? "Тренировки за выбранный период"
                : `${weeks} недель регулярности тренировок`}
            </p>
          </div>
          <div className="heatmap-legend">
            <span>Меньше</span>
            <i className="heat-cell lvl-0" />
            <i className="heat-cell lvl-1" />
            <i className="heat-cell lvl-2" />
            <i className="heat-cell lvl-3" />
            <span>Больше</span>
          </div>
        </div>

        <div className="heatmap-wrapper">
          <div className="heatmap-days-header">
            <span>Пн</span>
            <span />
            <span>Ср</span>
            <span />
            <span>Пт</span>
            <span />
            <span>Вс</span>
          </div>
          <div className="heatmap-grid">
            {heatmap.map((day) => (
              <button
                key={day.date}
                type="button"
                className={`heat-cell lvl-${day.intensity} ${selectedDay?.date === day.date ? "selected" : ""}`}
                aria-label={`${day.date}: ${day.workingSets} рабочих подходов`}
                aria-pressed={selectedDay?.date === day.date}
                disabled={
                  day.date > localDate(new Date(), settings.timeZone) ||
                  !!(rangeStart && day.date < rangeStart)
                }
                title={`${day.date}: ${day.workingSets} подходов (${fmt(day.totalVolume)} кг)`}
                onClick={() => setSelectedDay(day)}
              />
            ))}
          </div>
        </div>

        {selectedDay && (
          <div className="heatmap-detail-card">
            <div className="detail-date">
              <Calendar size={14} />
              <b>{dateLabel(selectedDay.date, true)}</b>
            </div>
            {selectedDay.workingSets > 0 ? (
              <div className="detail-workout-info">
                <span>{selectedDay.names.join(" · ") || "Тренировка"}</span>
                <b>
                  {selectedDay.workingSets} рабочих подходов ·{" "}
                  {fmt(selectedDay.totalVolume)} кг тоннаж
                </b>
              </div>
            ) : (
              <p className="tiny">
                В этот день тренировок не было (день отдыха или восстановления).
              </p>
            )}
          </div>
        )}
      </section>

      {/* 4. Personal Records (PR) Hall of Fame */}
      <section className="panel pr-panel">
        <div className="panel-header">
          <div className="pr-header-title">
            <div className="pr-trophy-badge">
              <Trophy size={20} />
            </div>
            <div>
              <h2>Зал личных рекордов</h2>
              <p>
                {compact
                  ? "Лучшие подходы за выбранный период"
                  : "Лучшие подходы за всю историю"}
              </p>
            </div>
          </div>
        </div>

        <div className="pr-filter-chips">
          {[
            { id: "big5", label: "Базовые" },
            { id: "all", label: "Все" },
            { id: "chest", label: "Грудь" },
            { id: "back", label: "Спина" },
            { id: "legs", label: "Ноги" },
            { id: "shoulders", label: "Плечи" },
          ].map((cat) => (
            <button
              key={cat.id}
              type="button"
              aria-pressed={filterCategory === cat.id}
              className={`filter-chip ${filterCategory === cat.id ? "active" : ""}`}
              onClick={() => setFilterCategory(cat.id as typeof filterCategory)}
            >
              {cat.label}
            </button>
          ))}
        </div>

        <div className="pr-cards-list">
          {filteredPrs.slice(0, 15).map((pr) => (
            <div key={pr.key} className="pr-card">
              <div className="pr-card-head">
                <div>
                  <h3>{pr.name}</h3>
                  <span className="pr-date">
                    Рекорд от {dateLabel(pr.bestWeight.date, true)} · «
                    {pr.bestWeight.workoutName}»
                  </span>
                </div>
                {onOpenExerciseStrength && (
                  <button
                    type="button"
                    className="icon-button pr-nav-btn"
                    title="Посмотреть динамику силы"
                    aria-label={`Динамика силы: ${pr.name}`}
                    onClick={() => onOpenExerciseStrength?.(pr.key)}
                  >
                    <ChevronRight size={18} />
                  </button>
                )}
              </div>

              <div className="pr-metrics-row">
                <div className="pr-metric-pill weight">
                  <span className="pr-metric-label">Лучший подход</span>
                  <b>
                    {fmt(pr.bestWeight.weight)} {pr.unit}{" "}
                    {pr.unit === "кг" && <small>× {pr.bestWeight.reps}</small>}
                  </b>
                </div>

                {pr.bestE1rm && (
                  <div className="pr-metric-pill e1rm">
                    <span className="pr-metric-label">Расчётный 1ПМ</span>
                    <b>{fmt(pr.bestE1rm.e1rm)} кг</b>
                  </div>
                )}

                {pr.bestSetVolume.volume > 0 && (
                  <div className="pr-metric-pill volume">
                    <span className="pr-metric-label">Объём подхода</span>
                    <b>{fmt(pr.bestSetVolume.volume)} кг</b>
                  </div>
                )}
              </div>
            </div>
          ))}

          {!filteredPrs.length && (
            <div className="no-results">
              В этой категории пока нет записанных рекордов.
            </div>
          )}
        </div>
      </section>
    </m.div>
  );
}
