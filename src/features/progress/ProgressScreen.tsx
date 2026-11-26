import { Suspense, useMemo, useState } from "react";
import { m } from "motion/react";
import {
  ChevronLeft,
  ChevronRight,
  Dumbbell,
  Info,
  Settings2,
  TrendingUp,
  Trophy,
  Zap,
} from "lucide-react";
import {
  addCalendarDays,
  anatomicalLoad,
  entryName,
  entrySpec,
  exerciseCatalog,
  exerciseForEntry,
  fmt,
  muscleLoad,
  progressKey,
  recordingSentence,
  weekStart,
  type Exercise,
  type Muscle,
  type Routine,
  type Settings,
  type Workout,
  type WorkoutExercise,
} from "../../lib/model";
import { MuscleCoverage } from "../../domain/MuscleCoverage";
import type { DeloadPlanRecord } from "../../domain/DeloadPlan";
import { StrengthExercises } from "../../domain/StrengthExercises";
import { ProgressSeries } from "../../domain/ProgressSeries";
import { ExecutionIdentity } from "../../domain/ExecutionIdentity";
import { ImportOrigin } from "../../domain/ImportOrigin";
import { quantity } from "../../lib/quantity";
import { AnatomyExplorer } from "../../components/chunks";
import { BodyweightModal } from "../../components/BodyweightModal";
import SmartCoachPanel from "../../components/SmartCoachPanel";
import ProgressOverview from "../../components/ProgressOverview";
import MuscleVolumePanel from "../../components/MuscleVolumePanel";
import MovementBalance from "../../components/MovementBalance";
import InteractiveStrengthChart from "../../components/InteractiveStrengthChart";
import Select from "../../components/Select";
import "../../styles/progress.css";

export type ProgressTab =
  | "balance"
  | "analytics"
  | "coach"
  | "strength"
  | "anatomy"
  | "bodyweight";

const SIDES: Record<string, string> = {
  both: "обе стороны",
  left: "левая",
  right: "правая",
};

const dateLabel = (date: string, long = false) =>
  new Date(date + "T12:00:00").toLocaleDateString("ru-RU", {
    day: "numeric",
    month: long ? "long" : "short",
  });

export interface ProgressScreenProps {
  accountId: string;
  bodyMassKg: number | null;
  displayed: Workout[];
  workouts: Workout[];
  routines: Routine[];
  customExercises: Exercise[];
  settings: Settings;
  today: string;
  deload?: DeloadPlanRecord | null;
  progressTab: ProgressTab;
  onProgressTabChange: (tab: ProgressTab) => void;
  weekOffset: number;
  onWeekOffsetChange: (next: number | ((o: number) => number)) => void;
  mapping: "recorded" | "current";
  onMappingChange: (mapping: "recorded" | "current") => void;
  onOpenMethod: () => void;
  onOpenSettings: () => void;
  onOpenExerciseDetail: (id: string) => void;
  onOpenLibraryWithMuscle: (zone: Muscle | "all", startMarking?: boolean) => void;
  onStartExercise: (exerciseId: string) => void;
}

export default function ProgressScreen({
  accountId,
  bodyMassKg,
  displayed,
  workouts,
  routines,
  customExercises,
  settings,
  today,
  deload,
  progressTab,
  onProgressTabChange,
  weekOffset,
  onWeekOffsetChange,
  mapping,
  onMappingChange,
  onOpenMethod,
  onOpenSettings,
  onOpenExerciseDetail,
  onOpenLibraryWithMuscle,
  onStartExercise,
}: ProgressScreenProps) {
  const [hardSetsOnly, setHardSetsOnly] = useState(false);
  const [selectedMuscle, setSelectedMuscle] = useState<Muscle | null>(null);
  const [progressPick, setProgressExercise] = useState<string | null>(null);

  const anchor = useMemo(
    () => addCalendarDays(weekStart(new Date(), settings.timeZone), weekOffset * 7),
    [weekOffset, settings.timeZone],
  );
  const weekEnd = useMemo(() => addCalendarDays(anchor, 6), [anchor]);
  const weekWorkouts = useMemo(
    () => displayed.filter((w) => w.date >= anchor && w.date <= weekEnd),
    [displayed, anchor, weekEnd],
  );
  const analysisOptions = useMemo(
    () => ({ mapping, timeZone: settings.timeZone, ...(hardSetsOnly ? { maxRir: 3 } : {}) }),
    [mapping, hardSetsOnly, settings.timeZone],
  );
  const familyKey = useMemo(
    () => `${exerciseCatalog.adoptFamilies(customExercises)}:${customExercises.map((e) => e.id).join("|")}`,
    [customExercises],
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
  const coverage = useMemo(
    () => MuscleCoverage.report(weekWorkouts, { timeZone: settings.timeZone, ...(hardSetsOnly ? { maxRir: 3 } : {}) }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [weekWorkouts, settings.timeZone, hardSetsOnly, familyKey],
  );
  const hasLegacy = weekWorkouts.some((w) =>
    w.exercises.some((e) => (e.catalogRevision ?? 1) === 1),
  );

  const unmarkedNote = coverage.sets ? (
    <p className="zones-unmarked" role="status">
      <b>
        Не учтено: {quantity(coverage.exercises, "упражнение", "упражнения", "упражнений")},{" "}
        {quantity(coverage.sets, "подход", "подхода", "подходов")}
      </b>{" "}
      — у них нет разметки мышц, поэтому группы ниже занижены
      {coverage.items.length
        ? ` (${coverage.items.slice(0, 3).map((i) => i.name).join(", ")}${coverage.items.length > 3 ? "…" : ""})`
        : ""}.
      <button
        type="button"
        className="text-button"
        onClick={() => onOpenLibraryWithMuscle("all", true)}
      >
        Разметить
      </button>
    </p>
  ) : null;

  // Только то, что делал: свежие и частые первыми; без истории — один жим лёжа, чтобы экран не был пустым.
  const strengthRows = StrengthExercises.list(displayed);
  const progressOptions = strengthRows.length
    ? strengthRows
    : [{ ...entrySpec("bench"), sets: [] } as WorkoutExercise].map((we) => ({
        key: progressKey(we),
        we,
      }));
  const progressExercise =
    progressPick && progressOptions.some((o) => o.key === progressPick)
      ? progressPick
      : progressOptions[0].key;
  const progressEntry = progressOptions.find((o) => o.key === progressExercise)?.we ?? {
    ...entrySpec("bench"),
    sets: [],
  };
  const progressSpec = exerciseForEntry(progressEntry)!.recording;
  const progressPoints = ProgressSeries.strength(displayed, progressExercise, {
    timeZone: settings.timeZone,
  });
  const progressMetric = ProgressSeries.metric(progressEntry);
  const progressBest = ProgressSeries.best(progressPoints, progressMetric.lowerIsBetter);
  const lastProgress = progressPoints.at(-1);
  const firstProgress = progressPoints[0];

  return (
    <>
      <header className="screen-head progress-screen-head">
        <h1>Прогресс</h1>
        <div className="screen-actions">
          <button
            className="icon-button"
            aria-label="Как считаем"
            onClick={onOpenMethod}
          >
            <Info size={20} />
          </button>
          <button
            className="icon-button"
            aria-label="Настройки целей"
            onClick={onOpenSettings}
          >
            <Settings2 size={20} />
          </button>
        </div>
      </header>
      <div className="tabs progress-tabs" role="tablist" aria-label="Раздел прогресса">
        {(
          [
            ["analytics", "Обзор"],
            ["coach", "ИИ-анализ"],
            ["strength", "Сила"],
            ["balance", "Мышцы"],
            ["bodyweight", "Вес тела"],
          ] as const
        ).map(([id, label]) => {
          const selected = progressTab === id || (id === "balance" && progressTab === "anatomy");
          return (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={selected}
              tabIndex={selected ? 0 : -1}
              className={selected ? "active" : ""}
              onClick={(event) => {
                onProgressTabChange(id);
                event.currentTarget.scrollIntoView?.({ block: "nearest", inline: "nearest" });
              }}
              onKeyDown={(event) => {
                if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
                event.preventDefault();
                const tabs = Array.from(
                  event.currentTarget.parentElement!.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
                );
                const current = tabs.indexOf(event.currentTarget);
                const next =
                  event.key === "Home"
                    ? 0
                    : event.key === "End"
                      ? tabs.length - 1
                      : (current + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
                tabs[next].click();
                tabs[next].focus();
              }}
            >
              {selected ? (
                <m.span
                  layoutId="progress-active-tab"
                  className="progress-tab-pill"
                  aria-hidden="true"
                  transition={{ type: "spring", stiffness: 460, damping: 36 }}
                />
              ) : null}
              <span className="progress-tab-label">{label}</span>
            </button>
          );
        })}
      </div>
      {(progressTab === "balance" || progressTab === "anatomy") && (
        <div className="muscles-tabs" role="tablist" aria-label="Виды нагрузки">
          <button
            role="tab"
            aria-selected={progressTab === "balance"}
            onClick={() => onProgressTabChange("balance")}
          >
            Нагрузка по зонам
          </button>
          <button
            role="tab"
            aria-selected={progressTab === "anatomy"}
            onClick={() => onProgressTabChange("anatomy")}
          >
            Карта мышц
          </button>
        </div>
      )}
      {progressTab === "balance" || progressTab === "anatomy" ? (
        <div className="week-selector">
          <button
            className="icon-button"
            aria-label="Предыдущая неделя"
            onClick={() => onWeekOffsetChange((o) => o - 1)}
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
            onClick={() => onWeekOffsetChange((o) => o + 1)}
          >
            <ChevronRight size={20} />
          </button>
        </div>
      ) : null}
      {progressTab === "bodyweight" && (
        <BodyweightModal key={accountId} accountId={accountId} timeZone={settings.timeZone} />
      )}
      {progressTab === "coach" ? (
        <SmartCoachPanel
          workouts={displayed}
          routines={routines}
          today={today}
          timeZone={settings.timeZone}
          accountId={accountId}
          deload={deload}
        />
      ) : null}
      {progressTab === "analytics" ? (
        <ProgressOverview
          workouts={workouts}
          settings={settings}
          bodyMassKg={bodyMassKg}
          onStrength={(key) => {
            setProgressExercise(key);
            onProgressTabChange("strength");
          }}
        />
      ) : null}
      {progressTab === "balance" ? (
        <>
          <MuscleVolumePanel
            loads={loads}
            anatomy={anatomy}
            selectedMuscle={selectedMuscle}
            onSelectMuscle={setSelectedMuscle}
            hardSetsOnly={hardSetsOnly}
            onHardSetsChange={setHardSetsOnly}
            hasLegacy={hasLegacy}
            mapping={mapping}
            onMappingChange={onMappingChange}
            unmarkedNote={unmarkedNote}
          />
          <MovementBalance workouts={weekWorkouts} />
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
              onExercise={onOpenExerciseDetail}
              onLibrary={(zone) => onOpenLibraryWithMuscle(zone, false)}
            />
          </Suspense>
        </>
      ) : null}
      {progressTab === "strength" ? (
        <div className="tel-panel strength-telemetry">
          <section className="tel-hero is-single" aria-label="Выбор упражнения для анализа силы">
            <div className="str-hero-top">
              <span className="tel-eyebrow-pill">
                <TrendingUp size={14} aria-hidden="true" />
                Сила · динамика
              </span>
              <span className="str-rule-chip">
                {recordingSentence(progressEntry)} ·{" "}
                {progressSpec.e1rmEligible ? "1ПМ: 1–12 повт." : "без 1ПМ"}
              </span>
            </div>
            <label className="str-select-field">
              <span>Упражнение</span>
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
                  ]
                    .filter(Boolean)
                    .join(" · "),
                }))}
              />
            </label>
          </section>

          <section className="tel-metric-grid" aria-label="Показатели силы">
            <article className="tel-metric-card is-accent">
              <span className="tel-metric-label">
                <Trophy size={13} aria-hidden="true" />
                Лучшее значение
              </span>
              <b className="tel-metric-val">
                {progressBest === null ? "—" : fmt(progressBest)}
                {progressBest !== null && progressMetric.unit ? (
                  <>
                    {" "}
                    <small>{progressMetric.unit}</small>
                  </>
                ) : null}
              </b>
              <span className="tel-metric-sub">Максимум за историю</span>
            </article>

            <article className="tel-metric-card">
              <span className="tel-metric-label">
                <TrendingUp size={13} aria-hidden="true" />
                {progressSpec.type === "duration" ? "Изменение, с" : "Изменение веса"}
              </span>
              <b className="tel-metric-val">
                {progressPoints.length > 1 && lastProgress && firstProgress
                  ? `${lastProgress.max - firstProgress.max >= 0 ? "+" : ""}${fmt(lastProgress.max - firstProgress.max)}`
                  : "—"}
                {progressPoints.length > 1 && lastProgress && progressMetric.unit ? (
                  <>
                    {" "}
                    <small>{progressMetric.unit}</small>
                  </>
                ) : null}
              </b>
              <span className="tel-metric-sub">
                {progressPoints.length > 1 ? "От первой записи" : "Нужно от 2 записей"}
              </span>
            </article>

            <article className="tel-metric-card">
              <span className="tel-metric-label">
                <Zap size={13} aria-hidden="true" />
                Расчётный 1ПМ
              </span>
              <b className="tel-metric-val">
                {lastProgress?.e1rm ? fmt(lastProgress.e1rm) : "—"}
                {lastProgress?.e1rm ? (
                  <>
                    {" "}
                    <small>кг</small>
                  </>
                ) : null}
              </b>
              <span className="tel-metric-sub">
                {progressSpec.e1rmEligible ? "По последнему подходу" : "Не рассчитывается"}
              </span>
            </article>

            <article className="tel-metric-card">
              <span className="tel-metric-label">
                <Dumbbell size={13} aria-hidden="true" />
                Тренировок
              </span>
              <b className="tel-metric-val">{progressPoints.length}</b>
              <span className="tel-metric-sub">
                {progressPoints.length
                  ? `Последняя: ${dateLabel(progressPoints[progressPoints.length - 1].date, true)}`
                  : "Пока нет записей"}
              </span>
            </article>
          </section>

          <section className="tel-card" aria-label="График и история упражнения">
            <div className="tel-card-head">
              <h2>{entryName(progressEntry)}</h2>
              {progressPoints.length > 0 ? (
                <span className="coach-insight-metric">
                  {quantity(progressPoints.length, "запись", "записи", "записей")}
                </span>
              ) : null}
            </div>
            {progressPoints.length ? (
              <>
                <InteractiveStrengthChart
                  points={progressPoints}
                  unit={progressMetric.unit}
                  isDuration={progressSpec.type === "duration"}
                  exerciseName={entryName(progressEntry)}
                />
                <div className="bw-history-list">
                  {[...progressPoints].reverse().map((p, i) => (
                    <div className="bw-history-row" key={`${p.date}-${i}`}>
                      <div className="bw-history-left">
                        <b>
                          {fmt(p.max)} {progressMetric.unit}
                        </b>
                        <span>{dateLabel(p.date, true)}</span>
                      </div>
                      <span className="str-history-meta">
                        {p.sets.length} подх. · {p.reps}{" "}
                        {progressSpec.type === "duration" ? "с" : "повт."}
                      </span>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="empty-state">
                <TrendingUp size={32} aria-hidden="true" />
                <h2>Нет записей</h2>
                <p>Добавь {entryName(progressEntry).toLowerCase()} в тренировку.</p>
                <button
                  type="button"
                  className="button primary"
                  onClick={() => onStartExercise(progressEntry.exerciseId)}
                >
                  Записать упражнение
                </button>
              </div>
            )}
          </section>
        </div>
      ) : null}
    </>
  );
}
