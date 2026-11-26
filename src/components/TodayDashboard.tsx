import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  Brain,
  ChevronDown,
  ChevronRight,
  Play,
  ClipboardCheck,
  Pill,
  Flame,
  Trophy,
  Clock,
} from "lucide-react";
import { m, useReducedMotion } from "motion/react";
import { PlanLine } from "../domain/PlanLine";
import { MuscleReadiness } from "../domain/MuscleReadiness";
import { StrengthTotal } from "../domain/StrengthTotal";
import { PersonalRecordsCalculator } from "../domain/PersonalRecords";
import { BackdatedWorkout } from "../domain/BackdatedWorkout";
import { WorkoutFlow } from "../domain/WorkoutFlow";
import { SmartCoach } from "../domain/SmartCoach";
import { LaidDupPlan } from "../domain/LaidDupPlan";
import type { DeloadPlanRecord } from "../domain/DeloadPlan";
import { SupplementsStore, type SupplementsState } from "../domain/Supplements";
import { elapsedMs, type Draft } from "../lib/draft";
import { entryName, fmt, localDate, workingSets, type Routine, type Workout } from "../lib/model";
import { quantity, quantityWord } from "../lib/quantity";
import WeeklyActivityBar from "./WeeklyActivityBar";

function formatClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  }
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

/** Изолированный живой таймер на карточке «В работе», чтобы не перерисовывать весь экран каждую секунду. */
function LiveDraftChip({ draft, timeZone }: { draft: Draft; timeZone?: string }) {
  const [now, setNow] = useState(() => Date.now());
  const manual = BackdatedWorkout.manualDuration(draft, timeZone);
  const running = !manual && draft.clock.runningSince !== null;

  useEffect(() => {
    if (!running) return;
    const tick = () => setNow(Date.now());
    const id = setInterval(tick, 1000);
    const onVis = () => {
      if (document.visibilityState === "visible") tick();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [running]);

  const text = manual
    ? `${draft.workout.duration} мин`
    : formatClock(Math.floor(elapsedMs(draft, now) / 1000));

  return (
    <span className={`hero-live-timer${running ? " is-running" : ""}`}>
      <Clock size={13} aria-hidden="true" />
      <span>{text}</span>
    </span>
  );
}

type QuickTool = "plate" | "orm" | "warmup";

type Props = {
  timeZone?: string;
  bodyMassKg?: number | null;
  workouts: Workout[];
  routines?: Routine[];
  supplements?: SupplementsState;
  today?: string;
  recent: ReactNode;
  hasRecent: boolean;
  draft?: Workout;
  draftObj?: Draft | null;
  plan: Workout | null;
  completed?: Workout;
  sources: Array<"history" | "plan">;
  hasPrograms: boolean;
  nextProgram?: string;
  deloadLine?: string | null;
  deload?: DeloadPlanRecord | null;
  load: { done: number; goal: number; growthZones?: number; maintenanceZones?: number; totalZones?: number };
  onStart: () => void;
  onOpenWorkout: (workout: Workout) => void;
  onEmpty: () => void;
  onPrograms: () => void;
  onProgress: () => void;
  onProgressOverview?: () => void;
  onOpenCoach?: () => void;
  onOpenSupplements?: () => void;
  onHistory: () => void;
  onQuickTool?: (tool: QuickTool) => void;
};

export default function TodayDashboard({
  timeZone,
  bodyMassKg,
  workouts,
  routines = [],
  supplements,
  today: todayProp,
  recent,
  hasRecent,
  draft,
  draftObj,
  plan,
  completed,
  sources,
  hasPrograms,
  nextProgram,
  deloadLine,
  deload,
  load,
  onStart,
  onOpenWorkout,
  onEmpty,
  onPrograms,
  onProgress,
  onProgressOverview,
  onOpenCoach,
  onOpenSupplements,
  onHistory,
}: Props) {
  const reduceMotion = useReducedMotion();
  const [showAllPreview, setShowAllPreview] = useState(false);
  const active = draft ?? plan;
  const finished = active ? undefined : completed;
  const status = draft ? "В работе" : plan ? "По программе" : finished ? "Выполнено" : hasPrograms ? "День отдыха" : null;
  const title = active?.name ?? finished?.name ?? (hasRecent ? "Свободная тренировка" : "Первая тренировка");
  const plannedSets = plan?.exercises.reduce(
    (sum, exercise) => sum + exercise.sets.filter((set) => !set.warmup).length,
    0,
  );
  const { workingTotal: draftTotalSets, workingDone: draftDoneSets } = useMemo(
    () => new WorkoutFlow(draft?.exercises ?? []),
    [draft?.exercises],
  );
  const estMinutes = plannedSets ? Math.max(20, Math.round(plannedSets * 2.8)) : null;

  const preview = !draft && plan && plan.exercises.length > 0 ? plan.exercises : null;
  const limit = 4;
  const progress = load.goal ? Math.min(1, load.done / load.goal) : 0;

  const todayKey = todayProp ?? localDate(new Date(), timeZone);
  const readiness = useMemo(
    () => MuscleReadiness.fromWorkoutsV2(workouts, todayKey, timeZone),
    [workouts, todayKey, timeZone],
  );
  const totalSummary = useMemo(
    () => StrengthTotal.fromWorkouts(workouts, timeZone, bodyMassKg),
    [workouts, timeZone, bodyMassKg],
  );
  const streak = useMemo(
    () => new PersonalRecordsCalculator(workouts).calculateStreak(timeZone),
    [workouts, timeZone],
  );
  const coach = useMemo(
    () => SmartCoach.analyze(workouts, routines, todayKey, timeZone, undefined, undefined, deload),
    [workouts, routines, todayKey, timeZone, deload],
  );
  const supSummary = useMemo(
    () => (supplements ? SupplementsStore.summary(supplements, todayKey) : null),
    [supplements, todayKey],
  );
  const todayLaid = useMemo(() => {
    const rid = active?.routineId ?? finished?.routineId;
    if (!rid) return null;
    const routine = routines.find((r) => r.id === rid);
    if (!routine || !LaidDupPlan.periodizationOf(routine)) return null;
    const cycle = LaidDupPlan.cycleOf(routines, routine);
    if (!cycle.length) return null;
    const state = LaidDupPlan.cycleState(cycle, workouts, todayKey);
    const dayPlan = LaidDupPlan.planFor(routine, active?.programDate ?? todayKey, { workouts, cycle });
    if (!dayPlan) return null;
    const exerciseRows = LaidDupPlan.dayExercisesPreview(routine, state.rawWeek, workouts, todayKey);
    return { state, dayPlan, exerciseRows };
  }, [active?.routineId, active?.programDate, finished?.routineId, routines, workouts, todayKey]);

  const readyMusclesCount = readiness.filter((r) => r.canTrain).length;
  const recoveringMuscles = readiness
    .filter((r) => !r.canTrain)
    .sort((a, b) => a.readinessPct - b.readinessPct);
  const coachLoadPct = Math.round(
    Math.max(coach.v2.deload.axialUtilization, coach.v2.deload.localUtilization) * 100,
  );
  const showSupplementsCard = Boolean(onOpenSupplements && supSummary && supSummary.total > 0);
  const smartCardCount = (onOpenCoach ? 1 : 0) + (showSupplementsCard ? 1 : 0);

  return (
    <div className="today-dashboard">
      <div className="today-training">
        <section className={`training-hero${draft ? " is-live" : ""}`} aria-labelledby="plan-title">
          <div className="plan-main">
            <div className="plan-status-row">
              {status && (
                <p className={`plan-status${finished ? " is-complete" : ""}${draft ? " is-live" : ""}`}>
                  {status}
                </p>
              )}
              {draftObj ? <LiveDraftChip draft={draftObj} timeZone={timeZone} /> : null}
            </div>
            <h2 id="plan-title">{title}</h2>
            <p className="plan-meta">
              {draft
                ? `${draft.exercises.length} упр. · ${draftDoneSets} / ${draftTotalSets} раб. подх.`
                : plan
                  ? `${plan.exercises.length} упр. · ${plannedSets} подх.${estMinutes ? ` · ~${estMinutes} мин` : ""}`
                  : finished
                    ? `${finished.exercises.length} упр. · ${workingSets([finished])} раб. подх.`
                    : "Выбери упражнения и запиши подходы."}
            </p>
            {todayLaid ? (
              <div className={`hero-laid-strip${todayLaid.state.isCurrentDeload ? " is-deload" : ""}`}>
                <span className="hero-laid-pill">
                  Неделя {todayLaid.state.weekGuide.weekNumber} из {todayLaid.state.totalWeeks} · {todayLaid.state.weekGuide.badge}
                </span>
                <span className="hero-laid-line">{LaidDupPlan.compactLine(todayLaid.dayPlan)}</span>
                <small className="hero-laid-rir">{todayLaid.state.weekGuide.baseRir}</small>
              </div>
            ) : null}
            {draft && draftTotalSets > 0 ? (
              <div className="hero-draft-progress" aria-hidden="true">
                <m.span
                  initial={false}
                  animate={{ scaleX: Math.min(1, draftDoneSets / draftTotalSets) }}
                  transition={{ duration: reduceMotion ? 0 : 0.28, ease: "easeOut" }}
                />
              </div>
            ) : null}
            {!active && nextProgram ? (
              <button type="button" className="plan-next" onClick={onPrograms}>
                <span>Следующая:</span> {nextProgram} <ChevronRight size={16} aria-hidden="true" />
              </button>
            ) : null}
            <div className="plan-actions">
              <m.button
                type="button"
                className="button primary plan-start"
                whileTap={reduceMotion ? undefined : { scale: 0.975 }}
                transition={{ type: "spring", stiffness: 500, damping: 36 }}
                onClick={() => (finished ? onOpenWorkout(finished) : onStart())}
              >
                {finished ? (
                  <ClipboardCheck size={18} aria-hidden="true" />
                ) : (
                  <Play size={17} fill="currentColor" aria-hidden="true" />
                )}
                {draft ? "Продолжить тренировку" : finished ? "Посмотреть запись" : "Начать тренировку"}
              </m.button>
              {!draft && (plan || finished) ? (
                <button type="button" className="text-button plan-option" onClick={onEmpty}>
                  Пустая тренировка
                </button>
              ) : !active ? (
                <button type="button" className="text-button plan-option" onClick={onPrograms}>
                  К программам <ArrowUpRight size={15} aria-hidden="true" />
                </button>
              ) : null}
            </div>
            {!draft && !finished && deloadLine ? <p className="deload-line">{deloadLine}</p> : null}
          </div>
        </section>

        {preview ? (
          <section className="plan-preview" aria-labelledby="preview-title">
            <div className="today-section-head">
              <h2 id="preview-title">План тренировки</h2>
              {preview.length > limit ? (
                <button
                  type="button"
                  className="text-button plan-preview-toggle"
                  aria-expanded={showAllPreview}
                  onClick={() => setShowAllPreview((v) => !v)}
                >
                  {showAllPreview ? "Свернуть" : `Все ${preview.length}`}
                </button>
              ) : null}
            </div>
            <ol className="plan-exercises">
              {(showAllPreview ? preview : preview.slice(0, limit)).map((exercise, index) => {
                const laidRow =
                  todayLaid?.exerciseRows[index]?.exerciseId === exercise.exerciseId
                    ? todayLaid.exerciseRows[index]
                    : null;
                const firstWork = exercise.sets.find((set) => !set.warmup);
                const weight = firstWork?.weight;
                const rir = firstWork?.rir;
                return (
                  <li key={`${exercise.exerciseId}:${index}`}>
                    <span className="plan-number" aria-hidden="true">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <span className="plan-exercise-name">{entryName(exercise)}</span>
                    {laidRow ? (
                      <b>
                        {laidRow.setsRepsLabel} · {laidRow.weightLabel}
                        <small className="plan-source">{laidRow.rirLabel}</small>
                      </b>
                    ) : (
                      <b>
                        {PlanLine.sets(exercise)}
                        {weight ? ` · ${fmt(weight)} кг` : ""}
                        {rir !== null && rir !== undefined ? ` · RIR ${rir}` : ""}
                        {weight ? (
                          <small className="plan-source">
                            {sources[index] === "history" ? "вес из истории" : "по плану"}
                          </small>
                        ) : null}
                      </b>
                    )}
                  </li>
                );
              })}
            </ol>
            {preview.length > limit && !showAllPreview ? (
              <button
                type="button"
                className="text-button plan-more-btn"
                onClick={() => setShowAllPreview(true)}
              >
                Показать ещё {quantity(preview.length - limit, "упражнение", "упражнения", "упражнений")}
              </button>
            ) : null}
          </section>
        ) : null}

        <section className="today-readiness" aria-labelledby="readiness-title">
          <details className="today-readiness-disclosure">
            <summary className="today-readiness-summary">
              <div className="today-readiness-summary-copy">
                <h2 id="readiness-title">Готовность мышц</h2>
                <span className="today-readiness-summary-meta">
                  {recoveringMuscles.length > 0
                    ? `Готовы ${readyMusclesCount}/${readiness.length} · устали: ${recoveringMuscles
                        .slice(0, 2)
                        .map((m) => `${m.label.toLowerCase()} (${m.readinessPct}%)`)
                        .join(", ")}`
                    : `Все ${readiness.length} групп готовы к работе (≥75 %)`}
                </span>
              </div>
              <ChevronDown size={18} className="today-readiness-chevron" aria-hidden="true" />
            </summary>
            <div className="today-readiness-body">
              <div className="readiness-grid">
                {readiness.map((item, idx) => {
                  const tileTone =
                    item.status === "fresh" || item.status === "usable"
                      ? "ready"
                      : item.status;
                  return (
                    <div key={item.id} className={`readiness-tile is-${tileTone}`}>
                      <div className="readiness-tile-head">
                        <span className="readiness-name">{item.label}</span>
                        <span className="readiness-state">{item.readinessPct}%</span>
                      </div>
                      <div className="readiness-bar" aria-hidden="true">
                        <m.span
                          initial={reduceMotion ? false : { scaleX: 0 }}
                          animate={{ scaleX: Math.max(0.08, item.readinessPct / 100) }}
                          transition={{ duration: reduceMotion ? 0 : 0.36, delay: reduceMotion ? 0 : idx * 0.02, ease: [0.22, 1, 0.36, 1] }}
                        />
                      </div>
                      <span className="readiness-meta">
                        {item.status === "fresh"
                          ? "свежая"
                          : item.status === "usable"
                            ? "готова"
                            : item.status === "recovering"
                              ? "восстан."
                              : "устала"}
                      </span>
                    </div>
                  );
                })}
              </div>
              <div className="today-readiness-foot">
                <button type="button" className="text-button readiness-more-btn" onClick={onProgress}>
                  Открыть зоны нагрузки <ArrowUpRight size={15} aria-hidden="true" />
                </button>
              </div>
            </div>
          </details>
        </section>

        {smartCardCount > 0 ? (
          <div className={`today-smart-row${smartCardCount === 1 ? " is-single" : ""}`}>
            {onOpenCoach ? (
              <m.button
                type="button"
                className="today-smart-card"
                whileHover={reduceMotion ? undefined : { y: -2 }}
                whileTap={reduceMotion ? undefined : { scale: 0.985 }}
                onClick={onOpenCoach}
              >
                <div className="today-smart-copy">
                  <span className="today-smart-eyebrow">
                    <Brain size={13} aria-hidden="true" />
                    Умный коуч
                  </span>
                  <b>{coach.v2.stateLabel}</b>
                  <small>{coach.v2.actions[0]?.title ?? coach.nextSession.headline}</small>
                </div>
                <span className="today-smart-badge">
                  {coach.v2.state === "DELOAD_ACTIVE"
                    ? "RIR 3–4"
                    : `${Math.min(130, coachLoadPct)}%`}
                </span>
              </m.button>
            ) : null}
            {showSupplementsCard && supSummary && onOpenSupplements ? (
              <m.button
                type="button"
                className="today-smart-card"
                whileHover={reduceMotion ? undefined : { y: -2 }}
                whileTap={reduceMotion ? undefined : { scale: 0.985 }}
                onClick={onOpenSupplements}
              >
                <div className="today-smart-copy">
                  <span className="today-smart-eyebrow">
                    <Pill size={13} aria-hidden="true" />
                    Добавки
                  </span>
                  <b>{`Принято ${supSummary.taken} из ${supSummary.total}`}</b>
                  <small>
                    {supSummary.streak > 0
                      ? `Серия: ${supSummary.streak} ${quantityWord(supSummary.streak, "день", "дня", "дней")}`
                      : "Ежедневный стек"}
                  </small>
                </div>
                <span className="today-smart-badge">{`${supSummary.percent}%`}</span>
              </m.button>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="today-rail">
        <WeeklyActivityBar workouts={workouts} timeZone={timeZone} />
        <button type="button" className="week-summary" onClick={onProgress}>
          <span className="week-summary-title">
            Нагрузка за неделю <ArrowUpRight size={17} aria-hidden="true" />
          </span>
          <span className="week-summary-head">
            <span>
              <strong>{fmt(load.done)}</strong> / {load.goal} экв. подх.
              <small style={{ display: "block", fontSize: "0.74rem", color: "var(--ink-soft)", marginTop: 2 }}>
                {load.growthZones
                  ? `В росте: ${load.growthZones} из ${load.totalZones ?? 10} мышц${load.maintenanceZones ? ` · поддержка: ${load.maintenanceZones}` : ""}`
                  : `Сумма целей ${load.totalZones ?? 10} групп мышц · зачтено зонам`}
              </small>
            </span>
          </span>
          <span className="meter" aria-hidden="true">
            <m.span
              className="week-meter-fill"
              style={{ transformOrigin: "left" }}
              initial={reduceMotion ? false : { scaleX: 0 }}
              animate={{ scaleX: progress }}
              transition={{ duration: reduceMotion ? 0 : 0.42, ease: [0.22, 1, 0.36, 1] }}
            />
          </span>
        </button>

        <button
          type="button"
          className="today-telemetry-card"
          onClick={onProgressOverview ?? onProgress}
        >
          <div className="telemetry-top">
            <span className="telemetry-label">
              <Trophy size={14} aria-hidden="true" />
              Силовой тотал
            </span>
            <span className="telemetry-streak">
              <Flame size={13} aria-hidden="true" />
              {streak.currentWeekStreak} нед.
            </span>
          </div>
          <div className="telemetry-value-row">
            <strong>
              {totalSummary.totalKg > 0 ? fmt(totalSummary.totalKg) : "—"}
              {totalSummary.totalKg > 0 ? <small> кг</small> : null}
            </strong>
            <span className="telemetry-milestone">
              {totalSummary.totalKg > 0
                ? `до ${totalSummary.milestone.nextKg} кг ещё ${fmt(totalSummary.milestone.remainingKg)} кг`
                : "присед + жим + тяга"}
            </span>
          </div>
          <span className="telemetry-meter" aria-hidden="true">
            <m.span
              initial={reduceMotion ? false : { scaleX: 0 }}
              animate={{ scaleX: totalSummary.totalKg > 0 ? totalSummary.milestone.ratio : 0 }}
              transition={{ duration: reduceMotion ? 0 : 0.42, ease: [0.22, 1, 0.36, 1] }}
            />
          </span>
        </button>
      </div>

      <section className="recent-panel" aria-labelledby="recent-title">
        <div className="today-section-head">
          <h2 id="recent-title">Последние тренировки</h2>
          {hasRecent ? (
            <button type="button" className="text-button" onClick={onHistory}>
              Вся история <ArrowRight size={16} aria-hidden="true" />
            </button>
          ) : null}
        </div>
        {hasRecent ? recent : <p className="today-empty">Здесь появятся завершённые тренировки</p>}
      </section>
    </div>
  );
}
