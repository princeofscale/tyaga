import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, m, useReducedMotion } from "motion/react";
import { ArrowLeftRight, ArrowUpDown, CalendarDays, RotateCcw, ShieldCheck, Sparkles } from "lucide-react";
import {
  LaidDupPlan,
  LAID_WEEKS,
  type LaidDay,
  type LaidLift,
  type LaidSlotInfo,
  type LaidSubstitutions,
  type LaidWeekSlot,
} from "../domain/LaidDupPlan";
import { BiomechanicsEngine } from "../domain/BiomechanicsEngine";
import { ExerciseAvoidStore, SubstitutionPolicy } from "../domain/SubstitutionPolicy";
import { DAY_NAMES } from "../domain/TrainingProgram";
import { dateLabel } from "../lib/calendar";
import { entryName, exerciseById } from "../lib/model";
import { quantity } from "../lib/quantity";
import type { Exercise, LaidMaxes, Routine, Workout } from "../lib/types";
import ExerciseSwapModal from "./ExerciseSwapModal";
import LaidWeekOrderEditor from "./LaidWeekOrderEditor";
import Modal from "./Modal";

type StatusState = ReturnType<typeof LaidDupPlan.dayStatus>;
const statusText = (s: StatusState) =>
  s.state === "done" ? `Сделана ${dateLabel(s.date!)}` : s.state === "missed" ? "Пропущена" : s.state === "ended" ? "Цикл закончен" : "Впереди";

const SPRING_TAB = { type: "spring" as const, stiffness: 460, damping: 35 };

/** Отметка дня: цвет и текст вместе, чтобы не полагаться на один цвет. */
export function LaidStatus({ status }: { status: StatusState }) {
  return <span className={`laid-status ${status.state}`}>{statusText(status)}</span>;
}

type CardProps = {
  cycle: Routine[];
  workouts: Workout[];
  today: string;
  busy: boolean;
  onSchedule: () => void;
  onEditDays: () => void;
  onEditSubstitutions?: () => void;
  onUpdate: () => void;
  /** Подсказка «Можно обновить максимум»: пересчитать план с текущей недели. */
  onRecalc: () => void;
};

/** Карточка программы Лейда на экране «Программы»: прогресс волн, максимумы, дни недели с весами, подсказка про максимум. */
export function LaidDupCard({ cycle, workouts, today, busy, onSchedule, onEditDays, onEditSubstitutions, onUpdate, onRecalc }: CardProps) {
  const reduced = useReducedMotion();
  const first = cycle[0].periodization!;
  const subs = first.substitutions;
  const subCount = subs ? Object.keys(subs).length : 0;
  const rawWeek = LaidDupPlan.weekOf(first.startMonday, today);
  const position = LaidDupPlan.position(rawWeek);
  const activeMaxes = useMemo(() => LaidDupPlan.maxesFor(first, position.week), [first, position.week]);
  const suggestion = useMemo(() => LaidDupPlan.suggestion(first, workouts, today), [first, workouts, today]);
  const waveMeta = LaidDupPlan.WAVE_META[position.wave];
  const restDay = useMemo(() => LaidDupPlan.restWeekday(LaidDupPlan.slotsFromCycle(cycle)), [cycle]);

  const statuses = useMemo(
    () => cycle.map((r) => LaidDupPlan.dayStatus(r, workouts, position.week, today)),
    [cycle, workouts, position.week, today],
  );
  const doneCount = statuses.filter((s) => s.state === "done").length;

  return (
    <m.section
      className="laid-card panel"
      aria-label="Программа Дэвида Лейда"
      initial={reduced ? false : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
    >
      <div className="laid-card-head">
        <h3>Дэвид Лейд · DUP</h3>
        <span className="laid-phase-badge">
          {position.finished ? "Цикл пройден" : `Волна ${position.wave} · ${waveMeta.title}`}
        </span>
      </div>

      <p className="laid-week" aria-live="polite">
        {position.beforeStart ? `Старт ${dateLabel(first.startMonday)} · неделя 1 из ${LAID_WEEKS} · волна 1` : LaidDupPlan.weekLabel(position)}
      </p>

      <div className="laid-progress" aria-hidden="true">
        <div className="laid-progress-segments">
          {Array.from({ length: LAID_WEEKS }, (_, idx) => {
            const state = position.beforeStart
              ? "upcoming"
              : position.finished || idx < position.week
                ? "past"
                : idx === position.week
                  ? "active"
                  : "upcoming";
            return (
              <span key={idx} className={`laid-seg ${state}${idx === 2 || idx === 5 ? " wave-end" : ""}`}>
                {state === "past" || state === "active" ? (
                  <m.span
                    className="laid-seg-fill"
                    initial={reduced ? false : { scaleX: 0 }}
                    animate={{ scaleX: 1 }}
                    transition={{ duration: 0.28, delay: reduced ? 0 : idx * 0.03 }}
                  />
                ) : null}
              </span>
            );
          })}
        </div>
        <div className="laid-progress-meta">
          <span>В1 · В2 · В3{restDay !== null ? ` · выходной ${DAY_NAMES[restDay]}` : ""}</span>
          <span>
            На неделе: {doneCount}/{cycle.length} · отдых 3:00
          </span>
        </div>
      </div>

      <div className="laid-card-maxes" aria-label="Рабочие максимумы цикла">
        {(["squat", "bench", "deadlift", "ohp"] as const).map((lift) => (
          <span key={lift} className={`laid-mini-max${LaidDupPlan.isLiftSubstituted(lift, subs) ? " is-replaced" : ""}`}>
            <small>{LaidDupPlan.liftLabel(lift, subs)}</small>
            <b>{LaidDupPlan.kg(activeMaxes[lift])} кг</b>
          </span>
        ))}
      </div>

      <ul className="laid-days">
        {cycle.map((r, idx) => {
          const p = r.periodization!;
          const status = statuses[idx];
          const dayPlan = LaidDupPlan.day(p.day, rawWeek, activeMaxes, { light: p.light, substitutions: p.substitutions });
          return (
            <m.li
              key={r.id}
              className={`laid-day-tile ${status.state}`}
              initial={reduced ? false : { opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2, delay: reduced ? 0 : idx * 0.03 }}
            >
              <div className="laid-day-top">
                <span className="laid-day-title">
                  <b>{LaidDupPlan.SHORT[p.day]}</b>
                  <span className="laid-day-name">{r.days.length ? r.days.map((d) => DAY_NAMES[d]).join(" · ") : "любой день"}</span>
                </span>
                <LaidStatus status={status} />
              </div>
              <span className="laid-day-plan">{LaidDupPlan.compactLine(dayPlan)}</span>
            </m.li>
          );
        })}
      </ul>

      {position.finished ? <p className="tiny laid-deload-hint">{LaidDupPlan.DELOAD_NOTICE}</p> : null}

      <AnimatePresence initial={false}>
        {suggestion.length ? (
          <m.div
            key="suggest"
            className="laid-suggest"
            role="status"
            initial={reduced ? false : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.2 }}
          >
            <p>
              <b>Можно обновить максимум:</b>{" "}
              {suggestion.map((s) => `${LaidDupPlan.liftLabel(s.lift, subs)} ${LaidDupPlan.kg(s.from)} → ${LaidDupPlan.kg(s.to)} кг`).join("; ")}.
            </p>
            <button type="button" className="button secondary" disabled={busy} onClick={onRecalc}>
              Пересчитать с недели {position.beforeStart ? 1 : position.week + 1}
            </button>
            <p className="tiny laid-window">Оценка — по подходам {LaidDupPlan.windowText(LaidDupPlan.SUGGEST_DAYS)}.</p>
          </m.div>
        ) : null}
      </AnimatePresence>

      <div className="laid-actions">
        <m.button
          type="button"
          className="button primary"
          whileTap={reduced ? undefined : { scale: 0.985 }}
          onClick={onSchedule}
        >
          <CalendarDays size={16} aria-hidden="true" />
          Расписание на 9 недель
        </m.button>
        <m.button
          type="button"
          className="button secondary"
          whileTap={reduced ? undefined : { scale: 0.985 }}
          onClick={onEditDays}
        >
          <ArrowUpDown size={16} aria-hidden="true" />
          Дни недели
        </m.button>
        {onEditSubstitutions ? (
          <m.button
            type="button"
            className="button secondary"
            whileTap={reduced ? undefined : { scale: 0.985 }}
            onClick={onEditSubstitutions}
          >
            <ArrowLeftRight size={16} aria-hidden="true" />
            {subCount > 0 ? `Замены (${subCount})` : "Замены"}
          </m.button>
        ) : null}
        <m.button
          type="button"
          className="button secondary"
          whileTap={reduced ? undefined : { scale: 0.985 }}
          onClick={onUpdate}
        >
          {position.finished ? "Начать новый цикл" : "Обновить максимумы"}
        </m.button>
      </div>
      <p className="tiny">
        {LaidDupPlan.NOTICE} {LaidDupPlan.AUTO_NOTICE}
      </p>
    </m.section>
  );
}

type ScheduleProps = {
  cycle: Routine[];
  workouts: Workout[];
  today: string;
  busy: boolean;
  onClose: () => void;
  onEditDays?: () => void;
  onEditSubstitutions?: () => void;
  onUpdate: () => void;
  onRecalc: () => void;
};

const EXPLAIN = [
  "Тяжёлые и объёмные дни чередуются внутри недели и от недели к неделе.",
  "Каждый день начинается с тяжёлого подхода на 1, 3 или 5 повторений, затем идут четыре рабочих подхода.",
  "Три трёхнедельные волны (втягивание, интенсификация, пик) поднимают веса с 85 до 97,5 % от 1ПМ.",
  "На базе отдых 3–4 мин, вспомогательные идут с запасом 1–2 повторения (RPE 8–9).",
  "По данным мета-анализа 2022 года, такая периодизация лучше растит максимальную силу у тренированных.",
];

const AUDIT_POINTS = [
  "Push 2 выстроен строго по листу оригинала: махи стоят перед брусьями с весом и дают передышку трицепсу после армейского и наклонного жимов.",
  "Редкий тренажёр GHR / Reverse Hyper из таблицы заменён сгибаниями ног сидя (Ноги 1) и лёжа (Ноги 2): колено сгибается без осевой нагрузки на поясницу, а сгибание сидя растит бицепс бедра не хуже лёжа (Maeo, 2021).",
  "Блок «добавлено» дополняет таблицу Лейда: задней дельты, икр и пресса в ней нет, а на среднюю дельту всего 6 подходов махов в неделю — блок добавляет обратный пек-дек, отведения на блоке, икры стоя и сидя и пресс.",
  "После 9-й недели рекомендована разгрузочная неделя (50–60 % от 1ПМ, половина подходов) перед проверкой новых максимумов.",
];

/** «Расписание на 9 недель»: максимумы, фильтр по волнам с анимацией Motion, карточки недель, разбор упражнений и периодизации. */
export function LaidDupSchedule({ cycle, workouts, today, busy, onClose, onEditDays, onEditSubstitutions, onUpdate, onRecalc }: ScheduleProps) {
  const reduced = useReducedMotion();
  const first = cycle[0].periodization!;
  const subs = first.substitutions;
  const position = LaidDupPlan.position(LaidDupPlan.weekOf(first.startMonday, today));
  const activeMaxes = useMemo(() => LaidDupPlan.maxesFor(first, position.week), [first, position.week]);
  const estimates = useMemo(() => LaidDupPlan.estimates(workouts, today, subs), [workouts, today, subs]);
  const suggestion = useMemo(() => LaidDupPlan.suggestion(first, workouts, today), [first, workouts, today]);
  const bioAudit = useMemo(() => BiomechanicsEngine.auditLaidCycle(cycle, workouts, today), [cycle, workouts, today]);
  const [waveFilter, setWaveFilter] = useState<"all" | 1 | 2 | 3>("all");
  const current = useRef<HTMLElement | null>(null);

  useEffect(() => {
    current.current?.scrollIntoView?.({ block: "start" });
  }, []);

  const lifts = ["squat", "bench", "deadlift", "ohp"] as const;
  const visibleWeeks = useMemo(
    () =>
      Array.from({ length: LAID_WEEKS }, (_, week) => week).filter((week) =>
        waveFilter === "all" ? true : Math.floor(week / 3) + 1 === waveFilter,
      ),
    [waveFilter],
  );

  return (
    <Modal title="Расписание на 9 недель" wide onClose={onClose}>
      <div className="laid-schedule">
        <p className="laid-week">
          {position.beforeStart ? `Старт ${dateLabel(first.startMonday)} · неделя 1 из ${LAID_WEEKS} · волна 1` : LaidDupPlan.weekLabel(position)}
        </p>

        {position.finished ? (
          <div className="laid-suggest" role="status">
            <p>Цикл закончен — обнови максимумы и начни новый.</p>
            <p className="tiny">{LaidDupPlan.DELOAD_NOTICE}</p>
            <button type="button" className="button primary" onClick={onUpdate}>
              Начать новый цикл
            </button>
          </div>
        ) : null}

        <ul className="laid-maxes" aria-label="Максимумы">
          {lifts.map((lift, i) => (
            <m.li
              key={lift}
              initial={reduced ? false : { opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2, delay: reduced ? 0 : i * 0.03 }}
            >
              <b>{LaidDupPlan.liftLabel(lift, subs)}</b>
              <span>{LaidDupPlan.kg(activeMaxes[lift])} кг</span>
              <small>{estimates[lift] !== null ? `по истории ≈ ${LaidDupPlan.kg(estimates[lift]!)} кг` : "истории нет"}</small>
            </m.li>
          ))}
        </ul>
        <p className="tiny laid-window">«По истории» — лучшая оценка 1ПМ (Эпли) по подходам {LaidDupPlan.windowText(LaidDupPlan.ESTIMATE_DAYS)}.</p>

        <AnimatePresence initial={false}>
          {suggestion.length ? (
            <m.div
              key="sched-suggest"
              className="laid-suggest"
              role="status"
              initial={reduced ? false : { opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.2 }}
            >
              <p>
                <b>Можно обновить максимум:</b>{" "}
                {suggestion.map((s) => `${LaidDupPlan.liftLabel(s.lift, subs)} ${LaidDupPlan.kg(s.from)} → ${LaidDupPlan.kg(s.to)} кг`).join("; ")}.
              </p>
              <button type="button" className="button secondary" disabled={busy} onClick={onRecalc}>
                Пересчитать с недели {position.beforeStart ? 1 : position.week + 1}
              </button>
              <p className="tiny laid-window">Оценка — по подходам {LaidDupPlan.windowText(LaidDupPlan.SUGGEST_DAYS)}.</p>
            </m.div>
          ) : null}
        </AnimatePresence>

        <p className="laid-explain">{EXPLAIN.join(" ")}</p>
        <p className="tiny">
          {LaidDupPlan.NOTICE} {LaidDupPlan.AUTO_NOTICE}
          {first.light ? " Включён облегчённый режим: вместо одного повторения — три, двойки тяги заменены на 4 × 4 (не по оригиналу)." : ""}
        </p>

        <div className="laid-wave-tabs" role="group" aria-label="Фильтр по волнам">
          {(
            [
              { id: "all" as const, label: "Все 9 нед." },
              { id: 1 as const, label: "Волна 1" },
              { id: 2 as const, label: "Волна 2" },
              { id: 3 as const, label: "Волна 3" },
            ] as const
          ).map((tab) => {
            const active = waveFilter === tab.id;
            return (
              <button
                key={String(tab.id)}
                type="button"
                aria-pressed={active}
                className={`laid-wave-tab${active ? " active" : ""}`}
                onClick={() => setWaveFilter(tab.id)}
              >
                {active ? (
                  <m.span
                    layoutId="laid-schedule-wave-pill"
                    className="laid-wave-tab-pill"
                    aria-hidden="true"
                    transition={reduced ? { duration: 0 } : SPRING_TAB}
                  />
                ) : null}
                <span className="laid-wave-tab-label">{tab.label}</span>
              </button>
            );
          })}
        </div>

        <AnimatePresence initial={false}>
          {waveFilter !== "all" ? (
            <m.div
              key={`wave-info-${waveFilter}`}
              className="laid-wave-banner"
              initial={reduced ? false : { opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.18 }}
            >
              <b>
                {LaidDupPlan.WAVE_META[waveFilter].range} · {LaidDupPlan.WAVE_META[waveFilter].title}
              </b>
              <span>{LaidDupPlan.WAVE_META[waveFilter].subtitle}</span>
            </m.div>
          ) : null}
        </AnimatePresence>

        <ol className="laid-weeks">
          <AnimatePresence mode="popLayout" initial={false}>
            {visibleWeeks.map((week) => {
              const isCurrent =
                !position.beforeStart && !position.finished
                  ? week === position.week
                  : position.finished
                    ? week === LAID_WEEKS - 1
                    : week === 0;
              const wave = (Math.floor(week / 3) + 1) as 1 | 2 | 3;
              const inWave = (week % 3) as 0 | 1 | 2;
              const maxes = LaidDupPlan.maxesFor(first, week);
              return (
                <m.li
                  key={week}
                  layout={!reduced}
                  initial={reduced ? false : { opacity: 0, scale: 0.98 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.98 }}
                  transition={{ duration: 0.2 }}
                  className={`laid-week-card${isCurrent ? " current" : ""}`}
                  aria-current={isCurrent && !position.beforeStart ? "step" : undefined}
                  ref={(node) => {
                    if (isCurrent) current.current = node;
                  }}
                >
                  <h4>
                    <span>
                      Неделя {week + 1} · волна {wave}
                    </span>
                    <small className="laid-wave-tag">{LaidDupPlan.WAVE_META[wave].title}</small>
                    {isCurrent && !position.beforeStart ? <span className="laid-now">сейчас</span> : null}
                  </h4>
                  <ul>
                    {cycle.map((r) => {
                      const p = r.periodization!;
                      const plan = LaidDupPlan.day(p.day, week, maxes, { light: p.light, substitutions: p.substitutions });
                      const waveAux = LaidDupPlan.waveAuxSummary(p.day, inWave, p.substitutions);
                      const meterRatio = Math.min(1, Math.max(0.25, (plan.heavy.percent - 80) / 20));
                      return (
                        <li key={r.id}>
                          <b>{LaidDupPlan.SHORT[p.day]}</b>
                          <span className="laid-day-weekday">
                            {r.days.length ? r.days.map((d) => DAY_NAMES[d]).join("·") : "—"}
                          </span>
                          <span className="laid-pct-tag">{LaidDupPlan.pct(plan.heavy.percent)} %</span>
                          <LaidStatus status={LaidDupPlan.dayStatus(r, workouts, week, today)} />
                          <span className="laid-plan-line">{LaidDupPlan.line(plan)}</span>
                          {waveAux ? <small className="laid-wave-aux">{waveAux} · RPE 8–9</small> : null}
                          <span className="laid-intensity-bar" aria-hidden="true">
                            <m.span
                              className={`laid-intensity-fill reps-${plan.heavy.reps}`}
                              initial={reduced ? false : { scaleX: 0 }}
                              animate={{ scaleX: meterRatio }}
                              transition={{ duration: 0.3 }}
                            />
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </m.li>
              );
            })}
          </AnimatePresence>
        </ol>

        <details className="laid-composition">
          <summary>Состав дней: оригинал и добавленное</summary>
          <div className="laid-composition-body">
            <div className="laid-audit-card">
              <div className="laid-audit-head">
                <ShieldCheck size={16} aria-hidden="true" />
                <b>Проверка упражнений и периодизации</b>
              </div>
              <ul>
                <li>{bioAudit.summary}</li>
                {bioAudit.topSetFeedback.map((sig) => (
                  <li key={sig.id}>
                    <b>{sig.title}:</b> {sig.detail}
                  </li>
                ))}
                {AUDIT_POINTS.map((point) => (
                  <li key={point}>{point}</li>
                ))}
              </ul>
            </div>

            {cycle.map((r) => {
              const day = r.periodization!.day;
              const daySubs = r.periodization!.substitutions;
              return (
                <div key={r.id} className="laid-comp-day">
                  <h4>
                    {LaidDupPlan.SHORT[day]} <small>({LaidDupPlan.ORIGINAL[day]})</small>
                  </h4>
                  <ul>
                    {r.exercises.map((e) => {
                      const spec = LaidDupPlan.exerciseSpec(day, e.exerciseId, daySubs);
                      const replacedName = spec.replacedFrom ? exerciseById(spec.replacedFrom)?.name ?? spec.replacedFrom : null;
                      return (
                        <li key={e.exerciseId}>
                          <div className="laid-comp-row">
                            <span>{entryName(e)}</span>
                            <span className={`laid-origin ${spec.replacedFrom ? "replaced" : spec.added ? "added" : "original"}`}>
                              {spec.replacedFrom ? "заменено" : spec.added ? "добавлено" : "оригинал"}
                            </span>
                          </div>
                          <small className="laid-comp-meta">
                            {spec.setsLabel} · {spec.intensityLabel}
                            {replacedName ? ` · вместо «${replacedName}»` : ""}
                            {spec.note ? ` — ${spec.note}` : ""}
                          </small>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })}
          </div>
        </details>

        <div className="laid-actions">
          {onEditDays ? (
            <button type="button" className="button secondary" onClick={onEditDays}>
              <ArrowUpDown size={16} aria-hidden="true" />
              Дни недели
            </button>
          ) : null}
          {onEditSubstitutions ? (
            <button type="button" className="button secondary" onClick={onEditSubstitutions}>
              <ArrowLeftRight size={16} aria-hidden="true" />
              Замены
            </button>
          ) : null}
          <button type="button" className="button secondary" onClick={onUpdate}>
            {position.finished ? "Начать новый цикл" : "Обновить максимумы"}
          </button>
          <button type="button" className="button primary" onClick={onClose}>
            Закрыть
          </button>
        </div>
      </div>
    </Modal>
  );
}

type WeekScheduleProps = {
  cycle: Routine[];
  allRoutines: Routine[];
  today: string;
  onSave: (weekdays: Record<LaidDay, number>) => Promise<void>;
  onClose: () => void;
};

/** Модальное окно «Дни недели · Дэвид Лейд»: перестановка тренировок и выходного по Пн–Вс. */
export function LaidWeekScheduleModal({ cycle, allRoutines, today, onSave, onClose }: WeekScheduleProps) {
  const initialSlots = useMemo(() => LaidDupPlan.slotsFromCycle(cycle), [cycle]);
  const [slots, setSlots] = useState<LaidWeekSlot[]>(initialSlots);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const first = cycle[0].periodization!;
  const rawWeek = LaidDupPlan.weekOf(first.startMonday, today);
  const position = LaidDupPlan.position(rawWeek);
  const activeMaxes = useMemo(() => LaidDupPlan.maxesFor(first, position.week), [first, position.week]);
  const cycleIds = useMemo(() => new Set(cycle.map((r) => r.id)), [cycle]);
  const otherRoutines = useMemo(() => allRoutines.filter((r) => !cycleIds.has(r.id)), [allRoutines, cycleIds]);

  const { summaries, counts } = useMemo(() => {
    const sum: Partial<Record<LaidDay, string>> = {};
    const cnt: Partial<Record<LaidDay, string>> = {};
    for (const r of cycle) {
      const p = r.periodization!;
      const plan = LaidDupPlan.day(p.day, rawWeek, activeMaxes, { light: p.light, substitutions: p.substitutions });
      sum[p.day] = LaidDupPlan.compactLine(plan);
      cnt[p.day] = quantity(r.exercises.length, "упражнение", "упражнения", "упражнений");
    }
    return { summaries: sum, counts: cnt };
  }, [activeMaxes, cycle, rawWeek]);

  const changed = slots.some((s, idx) => s !== initialSlots[idx]);

  async function handleSave() {
    setBusy(true);
    setError("");
    try {
      await onSave(LaidDupPlan.weekdaysFromSlots(slots));
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось сохранить дни недели");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Дни недели · Дэвид Лейд" wide onClose={() => (busy ? false : onClose())}>
      <div className="laid-week-modal">
        <p className="laid-lead">
          Перетащи тренировки или день отдыха на нужные дни недели. Веса по волнам DUP, состав упражнений и история сохраняются.
        </p>

        <LaidWeekOrderEditor
          slots={slots}
          initialSlots={initialSlots}
          onChange={setSlots}
          summaries={summaries}
          counts={counts}
          otherRoutines={otherRoutines}
          disabled={busy}
        />

        {error ? (
          <p className="error-banner" role="alert">
            {error}
          </p>
        ) : null}

        <div className="laid-actions">
          <button type="button" className="button primary" disabled={busy || !changed} onClick={() => void handleSave()}>
            {busy ? "Сохраняем…" : "Сохранить расписание"}
          </button>
          <button type="button" className="button secondary" disabled={busy} onClick={onClose}>
            Отмена
          </button>
        </div>
      </div>
    </Modal>
  );
}

/** Строка программы Лейда на её карточке в «Сохранённых программах»: неделя, план дня, отметка. */
export function LaidRoutineLine({ routine, workouts, today }: { routine: Routine; workouts: Workout[]; today: string }) {
  const plan = LaidDupPlan.planFor(routine, today);
  if (!plan) return null;
  const status = LaidDupPlan.dayStatus(routine, workouts, plan.position.week, today);
  return (
    <div className="laid-routine-line">
      <p>
        {plan.position.beforeStart ? `Старт ${dateLabel(routine.periodization!.startMonday)}` : LaidDupPlan.weekLabel(plan.position)}
        {" · "}
        <LaidStatus status={status} />
      </p>
      <p className="laid-plan-line">{LaidDupPlan.line(plan)}</p>
    </div>
  );
}

type SubstitutionsModalProps = {
  cycle: Routine[];
  workouts: Workout[];
  personal?: Exercise[];
  accountId?: string;
  minorMode?: boolean;
  today: string;
  onSave: (
    substitutions: LaidSubstitutions | undefined,
    maxes: LaidMaxes,
    options?: { calibrationLifts?: LaidLift[]; painFlags?: LaidLift[] },
  ) => Promise<void>;
  onClose: () => void;
};

const SUB_LIFTS: LaidLift[] = ["squat", "bench", "deadlift", "ohp"];

/** Модальное окно «Замены упражнений · Дэвид Лейд»: замена любого базового или подсобного упражнения на весь 9-недельный цикл. */
export function LaidSubstitutionsModal({ cycle, workouts, personal, accountId, today, onSave, onClose }: SubstitutionsModalProps) {
  const first = cycle[0].periodization!;
  const avoidedIds = useMemo(
    () => (accountId ? new ExerciseAvoidStore(accountId).ids() : undefined),
    [accountId],
  );
  const initialSubs = useMemo(() => first.substitutions ?? {}, [first.substitutions]);
  const [subs, setSubs] = useState<LaidSubstitutions>(() => ({ ...initialSubs }));
  const [calibrationLifts, setCalibrationLifts] = useState<LaidLift[]>(() =>
    first.calibrationLifts ? [...first.calibrationLifts] : [],
  );
  const [painFlags, setPainFlags] = useState<LaidLift[]>(() =>
    first.painFlags ? [...first.painFlags] : [],
  );
  const [maxValues, setMaxValues] = useState<Record<LaidLift, string>>(() =>
    Object.fromEntries(SUB_LIFTS.map((l) => [l, LaidDupPlan.kg(first.maxes[l])])) as Record<LaidLift, string>,
  );
  const [swapSlot, setSwapSlot] = useState<LaidSlotInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [shown, setShown] = useState(false);

  const activeSubs = useMemo(() => LaidDupPlan.normalizeSubstitutions(subs), [subs]);
  const normalizedInitial = useMemo(() => LaidDupPlan.normalizeSubstitutions(initialSubs), [initialSubs]);

  const catalogSlots = useMemo(
    () => LaidDupPlan.catalogSlots(first.extras, activeSubs),
    [first.extras, activeSubs],
  );
  const liftSlots = useMemo(() => catalogSlots.filter((s) => s.role === "lift"), [catalogSlots]);
  const auxSlots = useMemo(() => catalogSlots.filter((s) => s.role !== "lift"), [catalogSlots]);

  const estimates = useMemo(
    () => LaidDupPlan.estimates(workouts, today, activeSubs),
    [workouts, today, activeSubs],
  );

  const currentVolume = useMemo(() => LaidDupPlan.cycleMuscleVolume(cycle), [cycle]);
  const nextVolume = useMemo(
    () =>
      LaidDupPlan.cycleMuscleVolume(
        LaidDupPlan.withSubstitutions(cycle, activeSubs),
      ),
    [cycle, activeSubs],
  );

  const checks = SUB_LIFTS.map((lift) => ({ lift, ...LaidDupPlan.checkMax(maxValues[lift]) }));
  const validMaxes = checks.every((c) => c.error === null);
  const parsedMaxes = validMaxes
    ? (Object.fromEntries(checks.map((c) => [c.lift, c.value!])) as LaidMaxes)
    : null;

  const subsChanged = JSON.stringify(activeSubs ?? {}) !== JSON.stringify(normalizedInitial ?? {});
  const calChanged =
    JSON.stringify([...calibrationLifts].sort()) !== JSON.stringify([...(first.calibrationLifts ?? [])].sort());
  const painChanged =
    JSON.stringify([...painFlags].sort()) !== JSON.stringify([...(first.painFlags ?? [])].sort());
  const maxesChanged = !!parsedMaxes && SUB_LIFTS.some((l) => parsedMaxes[l] !== first.maxes[l]);
  const changed = subsChanged || maxesChanged || calChanged || painChanged;

  function applySub(originalId: string, nextId: string | null) {
    const nextMap = { ...subs };
    if (!nextId || nextId === originalId) {
      delete nextMap[originalId];
    } else {
      nextMap[originalId] = nextId;
    }
    setSubs(nextMap);

    // Если заменён базовый лифт: проверяем класс A/B/C и наличие ≥2 собственных тренировок
    const lift = SUB_LIFTS.find((l) => LaidDupPlan.LIFT_EXERCISE[l] === originalId);
    if (lift) {
      if (!nextId || nextId === originalId) {
        setCalibrationLifts((prev) => prev.filter((l) => l !== lift));
      } else {
        const ownSessions = LaidDupPlan.sessionsForExercise(workouts, nextId);
        const compat = SubstitutionPolicy.classify(exerciseById(originalId), exerciseById(nextId), {
          hasOwnHistory: ownSessions >= 2,
          painFlag: painFlags.includes(lift),
        });
        if (compat.prescriptionMode !== "percent_1rm") {
          setCalibrationLifts((prev) => (prev.includes(lift) ? prev : [...prev, lift]));
        }
        const nextEst = LaidDupPlan.estimates(workouts, today, LaidDupPlan.normalizeSubstitutions(nextMap))[lift];
        if (nextEst !== null) {
          setMaxValues((prev) => ({ ...prev, [lift]: LaidDupPlan.kg(nextEst) }));
        }
      }
    }
  }

  async function handleSave() {
    setShown(true);
    if (!parsedMaxes) return;
    setBusy(true);
    setError("");
    try {
      await onSave(activeSubs, parsedMaxes, { calibrationLifts, painFlags });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось сохранить замены");
    } finally {
      setBusy(false);
    }
  }

  const swapCurrentEx = swapSlot ? exerciseById(swapSlot.resolvedId) ?? exerciseById(swapSlot.originalId) : null;
  const swapOriginalEx = swapSlot ? exerciseById(swapSlot.originalId) : undefined;
  const swapExcludeIds = swapSlot
    ? LaidDupPlan.conflictingIdsForSubstitution(swapSlot.originalId, first.extras, activeSubs)
    : [];

  return (
    <>
      <Modal title="Замены упражнений · Дэвид Лейд" wide onClose={() => (busy ? false : onClose())}>
        <div className="laid-subs-modal">
          <p className="laid-lead">
            Замени любое упражнение на весь цикл (например, при травме спины или под инвентарь). Периодизация, проценты волн и объём по мышцам пересчитаются автоматически, а история тренировок сохранится.
          </p>

          <div className="laid-volume-strip" aria-label="Плановый объём цикла">
            <div className="laid-volume-strip-head">
              <span>Недельный объём цикла</span>
              <span className="laid-volume-axial">
                Осевая нагрузка: <b>{nextVolume.axialSets}</b> подх.
                {nextVolume.axialSets !== currentVolume.axialSets ? (
                  <small>
                    {" "}
                    ({nextVolume.axialSets - currentVolume.axialSets > 0 ? "+" : ""}
                    {nextVolume.axialSets - currentVolume.axialSets})
                  </small>
                ) : null}
              </span>
            </div>
            <div className="laid-volume-chips">
              {nextVolume.muscles.map((mItem) => {
                const prevSets = currentVolume.muscles.find((b) => b.id === mItem.id)?.sets ?? 0;
                const delta = Math.round((mItem.sets - prevSets) * 10) / 10;
                return (
                  <span key={mItem.id} className={`laid-vol-chip${delta !== 0 ? " changed" : ""}`}>
                    <span>{mItem.name}</span>
                    <b>{LaidDupPlan.kg(mItem.sets)}</b>
                    {delta !== 0 ? (
                      <small>{delta > 0 ? `+${LaidDupPlan.kg(delta)}` : LaidDupPlan.kg(delta)}</small>
                    ) : null}
                  </span>
                );
              })}
            </div>
          </div>

          <div className="laid-subs-group">
            <p className="laid-subcaption">Базовые движения (волновая периодизация DUP)</p>
            <ul className="laid-subs-list">
              {liftSlots.map((slot) => {
                const lift = slot.lift!;
                const origName = exerciseById(slot.originalId)?.name ?? slot.originalId;
                const curDef = exerciseById(slot.resolvedId);
                const curName = curDef?.name ?? slot.resolvedId;
                const check = checks.find((c) => c.lift === lift)!;
                const liftErr = shown && check.error ? check.error : "";
                const est = estimates[lift];
                const changedThisLift = slot.resolvedId !== LaidDupPlan.liftExerciseId(lift, normalizedInitial);
                return (
                  <li key={slot.originalId} className={`laid-subs-item laid-subs-lift-item${slot.replaced ? " is-replaced" : ""}`}>
                    <div className="laid-subs-item-row">
                      <div className="laid-subs-item-info">
                        <b>{curName}</b>
                        <small>
                          {slot.days.map((d) => LaidDupPlan.SHORT[d]).join(" · ")} · {slot.weeklySets} подх./нед
                          {slot.replaced ? ` · вместо «${origName}»` : ""}
                        </small>
                      </div>
                      <div className="laid-subs-item-actions">
                        {slot.replaced ? (
                          <button
                            type="button"
                            className="laid-subs-reset-btn"
                            aria-label={`Вернуть ${origName}`}
                            onClick={() => applySub(slot.originalId, null)}
                          >
                            <RotateCcw size={14} aria-hidden="true" />
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className="laid-subs-swap-btn"
                          onClick={() => setSwapSlot(slot)}
                        >
                          <ArrowLeftRight size={14} aria-hidden="true" />
                          <span>Заменить</span>
                        </button>
                      </div>
                    </div>

                    {slot.replaced || changedThisLift || calibrationLifts.includes(lift) || painFlags.includes(lift) ? (
                      <div className="laid-subs-max-row">
                        <div className="laid-lift-mode-row">
                          <button
                            type="button"
                            aria-pressed={calibrationLifts.includes(lift)}
                            className={`laid-mode-chip${calibrationLifts.includes(lift) ? " active" : ""}`}
                            onClick={() =>
                              setCalibrationLifts((prev) =>
                                prev.includes(lift) ? prev.filter((l) => l !== lift) : [...prev, lift],
                              )
                            }
                          >
                            {calibrationLifts.includes(lift) ? "Калибровка по RIR: вкл" : "Режим калибровки"}
                          </button>
                          <button
                            type="button"
                            aria-pressed={painFlags.includes(lift)}
                            className={`laid-mode-chip is-pain${painFlags.includes(lift) ? " active" : ""}`}
                            onClick={() =>
                              setPainFlags((prev) =>
                                prev.includes(lift) ? prev.filter((l) => l !== lift) : [...prev, lift],
                              )
                            }
                          >
                            {painFlags.includes(lift) ? "Щадяще (боль): вкл" : "Травма / боль"}
                          </button>
                        </div>
                        {!calibrationLifts.includes(lift) && !painFlags.includes(lift) ? (
                          <>
                            <label className="laid-subs-max-label">
                              <span>1ПМ для {curName}</span>
                              <span className="laid-input">
                                <input
                                  inputMode="decimal"
                                  value={maxValues[lift]}
                                  aria-invalid={liftErr ? true : undefined}
                                  onChange={(e) => setMaxValues({ ...maxValues, [lift]: e.target.value })}
                                />
                                <span className="laid-unit" aria-hidden="true">
                                  {curDef?.recording.loadMode === "per_implement" ? "кг · 1 гант." : "кг"}
                                </span>
                              </span>
                            </label>
                            {est !== null && maxValues[lift] !== LaidDupPlan.kg(est) ? (
                              <button
                                type="button"
                                className="laid-estimate"
                                onClick={() => setMaxValues({ ...maxValues, [lift]: LaidDupPlan.kg(est) })}
                              >
                                <Sparkles size={13} aria-hidden="true" />
                                <span>по истории ≈ {LaidDupPlan.kg(est)} кг</span>
                              </button>
                            ) : null}
                            {liftErr ? <p className="laid-error" role="alert">{liftErr}</p> : null}
                          </>
                        ) : (
                          <p className="tiny laid-quiet-note">
                            {painFlags.includes(lift)
                              ? "Синглы 95 % и автоповышение веса отключены — работа по переносимому весу (RIR 2–3)."
                              : "1-я неделя в режиме калибровки по RIR без фиктивных % от старого 1ПМ."}
                          </p>
                        )}
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="laid-subs-group">
            <p className="laid-subcaption">Подсобные упражнения</p>
            <ul className="laid-subs-list">
              {auxSlots.map((slot) => {
                const origName = exerciseById(slot.originalId)?.name ?? slot.originalId;
                const curName = exerciseById(slot.resolvedId)?.name ?? slot.resolvedId;
                return (
                  <li key={slot.originalId} className={`laid-subs-item${slot.replaced ? " is-replaced" : ""}`}>
                    <div className="laid-subs-item-info">
                      <b>{curName}</b>
                      <small>
                        {slot.days.map((d) => LaidDupPlan.SHORT[d]).join(" · ")} · {slot.weeklySets} подх./нед
                        {slot.role === "wave-aux" ? " · волна повт." : ""}
                        {slot.replaced ? ` · вместо «${origName}»` : ""}
                      </small>
                    </div>
                    <div className="laid-subs-item-actions">
                      {slot.replaced ? (
                        <button
                          type="button"
                          className="laid-subs-reset-btn"
                          aria-label={`Вернуть ${origName}`}
                          onClick={() => applySub(slot.originalId, null)}
                        >
                          <RotateCcw size={14} aria-hidden="true" />
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="laid-subs-swap-btn"
                        onClick={() => setSwapSlot(slot)}
                      >
                        <ArrowLeftRight size={14} aria-hidden="true" />
                        <span>Заменить</span>
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>

          {error ? (
            <p className="error-banner" role="alert">
              {error}
            </p>
          ) : null}

          <div className="laid-actions laid-sticky-footer">
            <button
              type="button"
              className="button primary"
              disabled={busy || !changed}
              onClick={() => void handleSave()}
            >
              {busy ? "Сохраняем…" : "Сохранить замены"}
            </button>
            <button type="button" className="button secondary" disabled={busy} onClick={onClose}>
              Отмена
            </button>
          </div>
        </div>
      </Modal>

      {swapSlot && swapCurrentEx ? (
        <ExerciseSwapModal
          title={swapSlot.role === "lift" ? "Заменить базовое движение" : "Заменить упражнение в цикле"}
          subtitle={`Замена применится на всех 9 неделях цикла (${swapSlot.days.map((d) => LaidDupPlan.SHORT[d]).join(" · ")}). Объём по мышцам и периодизация пересчитаются автоматически.`}
          currentExercise={swapCurrentEx}
          originalExercise={swapOriginalEx}
          showCompatibilityFor={swapSlot.role === "lift" ? swapOriginalEx : undefined}
          personal={personal}
          avoidedIds={avoidedIds}
          excludeIds={swapExcludeIds}
          requireWeighted={swapSlot.role === "lift"}
          onSwap={(nextEx) => applySub(swapSlot.originalId, nextEx.id)}
          onReset={() => applySub(swapSlot.originalId, null)}
          onClose={() => setSwapSlot(null)}
        />
      ) : null}
    </>
  );
}
