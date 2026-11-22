import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  Brain,
  ChevronRight,
  Play,
  ClipboardCheck,
  Dumbbell,
  Pill,
  Target,
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
import { SmartCoach } from "../domain/SmartCoach";
import { SupplementsStore, type SupplementsState } from "../domain/Supplements";
import { elapsedMs, type Draft } from "../lib/draft";
import { entryName, fmt, localDate, workingSets, type Routine, type Workout } from "../lib/model";
import { quantity, quantityWord } from "../lib/quantity";
import WeeklyActivityBar from "./WeeklyActivityBar";
import "../styles/today-redesign.css";

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
  load: { done: number; goal: number };
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
  onQuickTool,
}: Props) {
  const reduceMotion = useReducedMotion();
  const active = draft ?? plan;
  const finished = active ? undefined : completed;
  const status = draft ? "В работе" : plan ? "По программе" : finished ? "Выполнено" : hasPrograms ? "День отдыха" : null;
  const title = active?.name ?? finished?.name ?? (hasRecent ? "Свободная тренировка" : "Первая тренировка");
  const plannedSets = plan?.exercises.reduce(
    (sum, exercise) => sum + exercise.sets.filter((set) => !set.warmup).length,
    0,
  );
  const draftTotalSets = draft?.exercises.reduce(
    (sum, exercise) => sum + exercise.sets.filter((set) => !set.warmup).length,
    0,
  ) ?? 0;
  const draftDoneSets = draft ? workingSets([draft]) : 0;
  const estMinutes = plannedSets ? Math.max(20, Math.round(plannedSets * 2.8)) : null;

  const preview = !draft && plan && plan.exercises.length > 0 ? plan.exercises : null;
  const limit = 4;
  const progress = load.goal ? Math.min(1, load.done / load.goal) : 0;

  const todayKey = todayProp ?? localDate(new Date(), timeZone);
  const readiness = useMemo(
    () => MuscleReadiness.fromWorkouts(workouts, todayKey, timeZone),
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
    () => SmartCoach.analyze(workouts, routines, todayKey, timeZone),
    [workouts, routines, todayKey, timeZone],
  );
  const supSummary = useMemo(
    () => (supplements ? SupplementsStore.summary(supplements, todayKey) : null),
    [supplements, todayKey],
  );

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
            </div>
            <ol className="plan-exercises">
              {preview.slice(0, limit).map((exercise, index) => {
                const weight = exercise.sets.find((set) => !set.warmup)?.weight;
                return (
                  <li key={`${exercise.exerciseId}:${index}`}>
                    <span className="plan-number" aria-hidden="true">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <span className="plan-exercise-name">{entryName(exercise)}</span>
                    <b>
                      {PlanLine.sets(exercise)}
                      {weight ? ` · ${fmt(weight)} кг` : ""}
                      {weight ? (
                        <small className="plan-source">
                          {sources[index] === "history" ? "вес из истории" : "по плану"}
                        </small>
                      ) : null}
                    </b>
                  </li>
                );
              })}
            </ol>
            {preview.length > limit ? (
              <p className="plan-more">
                Ещё {quantity(preview.length - limit, "упражнение", "упражнения", "упражнений")} в тренировке
              </p>
            ) : null}
          </section>
        ) : null}

        <section className="today-readiness" aria-labelledby="readiness-title">
          <div className="today-section-head">
            <h2 id="readiness-title">Готовность мышц</h2>
            <button type="button" className="text-button readiness-more-btn" onClick={onProgress}>
              Зоны <ArrowUpRight size={15} aria-hidden="true" />
            </button>
          </div>
          <div className="readiness-grid">
            {readiness.map((item, idx) => (
              <div key={item.id} className={`readiness-tile is-${item.state}`}>
                <div className="readiness-tile-head">
                  <span className="readiness-name">{item.label}</span>
                  <span className="readiness-state">{item.statusText}</span>
                </div>
                <div className="readiness-bar" aria-hidden="true">
                  <m.span
                    initial={reduceMotion ? false : { scaleX: 0 }}
                    animate={{ scaleX: item.ratio }}
                    transition={{ duration: reduceMotion ? 0 : 0.36, delay: reduceMotion ? 0 : idx * 0.03, ease: [0.22, 1, 0.36, 1] }}
                  />
                </div>
                <span className="readiness-meta">
                  {item.lastSets > 0
                    ? `${item.lastSets} ${quantityWord(item.lastSets, "подход", "подхода", "подходов")}`
                    : "свежая"}
                </span>
              </div>
            ))}
          </div>
        </section>

        {onQuickTool ? (
          <div className="today-quick-tools" role="group" aria-label="Быстрые калькуляторы">
            <m.button type="button" className="quick-tool-chip" whileTap={reduceMotion ? undefined : { scale: 0.96 }} onClick={() => onQuickTool("plate")}>
              <Dumbbell size={15} aria-hidden="true" />
              <span>Блины</span>
            </m.button>
            <m.button type="button" className="quick-tool-chip" whileTap={reduceMotion ? undefined : { scale: 0.96 }} onClick={() => onQuickTool("orm")}>
              <Target size={15} aria-hidden="true" />
              <span>1ПМ</span>
            </m.button>
            <m.button type="button" className="quick-tool-chip" whileTap={reduceMotion ? undefined : { scale: 0.96 }} onClick={() => onQuickTool("warmup")}>
              <Flame size={15} aria-hidden="true" />
              <span>Разминка</span>
            </m.button>
          </div>
        ) : null}

        {(onOpenCoach || onOpenSupplements) ? (
          <div className="today-smart-row">
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
                    ИИ-анализ
                  </span>
                  <b>{coach.statusLabel}</b>
                  <small>{coach.nextSession.headline}</small>
                </div>
                <span className="today-smart-badge">{coach.score}</span>
              </m.button>
            ) : null}
            {onOpenSupplements ? (
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
                  <b>
                    {supSummary && supSummary.total > 0
                      ? `Принято ${supSummary.taken} из ${supSummary.total}`
                      : "Собрать ежедневный стек"}
                  </b>
                  <small>
                    {supSummary && supSummary.streak > 0
                      ? `Серия: ${supSummary.streak} ${quantityWord(supSummary.streak, "день", "дня", "дней")}`
                      : "Креатин, протеин, витамины"}
                  </small>
                </div>
                <span className="today-smart-badge">
                  {supSummary && supSummary.total > 0 ? `${supSummary.percent}%` : <ArrowUpRight size={17} aria-hidden="true" />}
                </span>
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
              <strong>{fmt(load.done)}</strong> / {load.goal} зачтено зонам
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
