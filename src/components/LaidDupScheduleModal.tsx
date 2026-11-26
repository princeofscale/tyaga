import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, m, useReducedMotion } from "motion/react";
import { ArrowLeftRight, ArrowUpDown, ChevronDown, ShieldCheck, SlidersHorizontal } from "lucide-react";
import { LaidDupPlan } from "../domain/LaidDupPlan";
import { BiomechanicsEngine } from "../domain/BiomechanicsEngine";
import { DAY_NAMES } from "../domain/TrainingProgram";
import { dateLabel } from "../lib/calendar";
import { entryName, exerciseById } from "../lib/model";
import type { Routine, Workout } from "../lib/types";
import Modal from "./Modal";
import { LaidStatus } from "./LaidStatus";
import LaidWaveProgressChart from "./LaidWaveProgressChart";

const SPRING_TAB = { type: "spring" as const, stiffness: 460, damping: 35 };

const EXPLAIN = [
  "Тяжёлые и объёмные дни чередуются внутри недели и между неделями.",
  "День начинается с тяжёлого подхода на 1, 3 или 5 повторений (RIR 1–2 → 0,5–1 к волне 3), затем четыре откатных (RIR 2–3).",
  "Три волны по три недели поднимают веса с 85 до 97,5 % тренировочного максимума (90–95 % реального 1ПМ).",
  "Отдых: база 3–5 мин, тяжёлая подсобка 2–3 мин, тренажёры 60–90 с; вся подсобка — RIR 1–2.",
  "Разгрузки внутри 9 недель нет (кроме включённой недели 7) — после 9-й обязательна разгрузочная неделя.",
];
// Длина объяснения — часть контракта интерфейса: ≤ 5 предложений и < 520 символов (проверяется e2e).

const AUDIT_POINTS = [
  "Схема процентов (85/90/95 → 86/91/96,5 → 88/92,5/97,5 %) и откатных 4×12/10/8/6/4/2 сверена с оригинальной таблицей `David Laid DUP Program.xlsx`. Из-за жёстких 4×2 @ 92,5–93,5 % на становой вводи осторожный тренировочный максимум (90–95 % от реального 1ПМ) или включи облегчённый режим.",
  "Push 2 выстроен строго по листу оригинала: махи стоят перед брусьями с весом и дают передышку трицепсу после армейского и наклонного жимов.",
  "Редкий тренажёр GHR / Reverse Hyper из таблицы заменён сгибаниями ног сидя (Ноги 1) и лёжа (Ноги 2): колено сгибается без осевой нагрузки на поясницу, а сгибание сидя растит бицепс бедра лучше лёжа (Maeo, 2021).",
  "Блок «добавлено» дополняет таблицу Лейда: задней дельты, икр и пресса в ней нет, а на среднюю дельту всего 6 подходов махов в неделю — блок добавляет обратный пек-дек, отведения на блоке, икры стоя и сидя и пресс.",
  "После 9-й недели (или после 6-й при накопленной усталости) проведи разгрузочную неделю: 50–60 % от 1ПМ, половина подходов, RIR 3–4 — и только потом проверяй новые максимумы.",
];

type ScheduleProps = {
  cycle: Routine[];
  workouts: Workout[];
  today: string;
  busy: boolean;
  onClose: () => void;
  onEditDays?: () => void;
  onEditSubstitutions?: (focusOriginalId?: string) => void;
  onUpdate: () => void;
  onRecalc: () => void;
};

/** «Расписание цикла»: максимумы, волны, карточки недель с раскрытием состава дня (веса, повторы, RIR и замены). */
export function LaidDupSchedule({
  cycle,
  workouts,
  today,
  busy,
  onClose,
  onEditDays,
  onEditSubstitutions,
  onUpdate,
  onRecalc,
}: ScheduleProps) {
  const reduced = useReducedMotion();
  const state = useMemo(() => LaidDupPlan.cycleState(cycle, workouts, today), [cycle, workouts, today]);
  const { first, totalWeeks, rawWeek, isCurrentDeload, position, activeMaxes } = state;
  const subs = first.substitutions;
  const estimates = useMemo(() => LaidDupPlan.estimates(workouts, today, subs), [workouts, today, subs]);
  const suggestion = useMemo(() => LaidDupPlan.suggestion(first, workouts, today), [first, workouts, today]);
  const bioAudit = useMemo(() => BiomechanicsEngine.auditLaidCycle(cycle, workouts, today), [cycle, workouts, today]);
  const waveSeries = useMemo(() => LaidDupPlan.waveProgress(cycle, workouts, today), [cycle, workouts, today]);
  const hasWaveActuals = useMemo(() => waveSeries.some((s) => s.bestE1rm !== null), [waveSeries]);
  const [waveFilter, setWaveFilter] = useState<"all" | 1 | 2 | 3>("all");
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const current = useRef<HTMLElement | null>(null);

  useEffect(() => {
    current.current?.scrollIntoView?.({ block: "start" });
  }, []);

  const lifts = ["squat", "bench", "deadlift", "ohp"] as const;
  const visibleWeeks = useMemo(
    () =>
      Array.from({ length: totalWeeks }, (_, week) => week).filter((week) => {
        if (waveFilter === "all") return true;
        const deloadsBefore = (first.deloadWeeks ?? []).filter((w) => w < week).length;
        const idx = LaidDupPlan.isDeloadWeek(first, week) ? Math.max(0, week - deloadsBefore - 1) : week - deloadsBefore;
        return LaidDupPlan.position(idx).wave === waveFilter;
      }),
    [waveFilter, totalWeeks, first],
  );

  return (
    <Modal title={`Расписание на ${totalWeeks} нед.`} wide onClose={onClose}>
      <div className="laid-schedule">
        <div className="laid-sched-hero">
          <p className="laid-week">
            {position.beforeStart
              ? `Старт ${dateLabel(first.startMonday)} · неделя 1 из ${totalWeeks} · волна 1`
              : LaidDupPlan.weekLabel(position, { isDeload: isCurrentDeload, totalWeeks })}
            {first.weekMode === "rolling" ? " · плавающая неделя" : ""}
          </p>
          <p className="laid-explain">{EXPLAIN.join(" ")}</p>
        </div>

        {position.finished ? (
          <div className="laid-suggest" role="status">
            <p>Цикл закончен — обнови максимумы и начни новый.</p>
            <p className="tiny">{LaidDupPlan.DELOAD_NOTICE}</p>
            <button type="button" className="button primary" onClick={onUpdate}>
              Начать новый цикл
            </button>
          </div>
        ) : null}

        <section className="laid-sched-maxes-block" aria-label="Рабочие максимумы">
          <ul className="laid-maxes" aria-label="Максимумы">
            {lifts.map((lift, i) => {
              const liftMode = LaidDupPlan.liftModeOf(first, lift);
              return (
                <m.li
                  key={lift}
                  initial={reduced ? false : { opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.18, delay: reduced ? 0 : i * 0.025 }}
                >
                  <b>{LaidDupPlan.liftLabel(lift, subs)}</b>
                  <span>
                    {liftMode === "calibration"
                      ? "Калибровка"
                      : liftMode === "pain"
                        ? "Щадяще"
                        : liftMode === "rir_range"
                          ? "По RIR"
                          : `${LaidDupPlan.kg(activeMaxes[lift])} кг`}
                  </span>
                  <small>
                    {liftMode === "calibration"
                      ? "подбор веса · RIR 2–3"
                      : liftMode === "pain"
                        ? "боль · RIR 2–3"
                        : liftMode === "rir_range"
                          ? "работа по RIR 1–2"
                          : estimates[lift] !== null
                            ? `история ≈ ${LaidDupPlan.kg(estimates[lift]!)} кг`
                            : "истории нет"}
                  </small>
                </m.li>
              );
            })}
          </ul>
          <p className="tiny laid-window">
            «История» — лучшая оценка 1ПМ (Эпли) {LaidDupPlan.windowText(LaidDupPlan.ESTIMATE_DAYS)}.{" "}
            {LaidDupPlan.NOTICE}
            {first.light ? " Облегчённый режим: вместо синглов — тройки, вместо двоек тяги — 4 × 4." : ""}
          </p>
        </section>

        <details className="laid-wave-chart-disclosure" open={hasWaveActuals}>
          <summary>
            <span>График прогресса по волнам (1 → 2 → 3)</span>
            <ChevronDown size={15} aria-hidden="true" />
          </summary>
          <div className="laid-wave-chart-body">
            <LaidWaveProgressChart
              series={waveSeries}
              currentWeekIndex={position.beforeStart ? 0 : Math.min(totalWeeks - 1, Math.max(0, rawWeek))}
            />
          </div>
        </details>

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

        <div className="laid-wave-tabs" role="group" aria-label="Фильтр по волнам">
          {(
            [
              { id: "all" as const, label: `Все ${totalWeeks} нед.` },
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

        <p className="laid-sched-tip">Нажми на любой день в неделе, чтобы увидеть все упражнения, рабочие веса и RIR.</p>

        <ol className="laid-weeks">
          <AnimatePresence mode="popLayout" initial={false}>
            {visibleWeeks.map((week) => {
              const isWeekDeload = LaidDupPlan.isDeloadWeek(first, week);
              const deloadsBefore = (first.deloadWeeks ?? []).filter((w) => w < week).length;
              const effIdx = isWeekDeload ? Math.max(0, week - deloadsBefore - 1) : week - deloadsBefore;
              const weekPos = { ...LaidDupPlan.position(effIdx), raw: week };
              const isCurrent =
                !position.beforeStart && !position.finished
                  ? week === rawWeek
                  : position.finished
                    ? week === totalWeeks - 1
                    : week === 0;
              const wave = weekPos.wave;
              const inWave = weekPos.inWave;
              const maxes = LaidDupPlan.maxesFor(first, weekPos.week);
              const wGuide = LaidDupPlan.weekGuide(weekPos, {
                light: first.light,
                deload: isWeekDeload,
                totalWeeks,
                version: first.version,
              });
              return (
                <m.li
                  key={week}
                  layout={!reduced}
                  initial={reduced ? false : { opacity: 0, scale: 0.99 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.99 }}
                  transition={{ duration: 0.18 }}
                  className={`laid-week-card${isCurrent ? " current" : ""}${isWeekDeload ? " is-deload" : ""}`}
                  aria-current={isCurrent && !position.beforeStart ? "step" : undefined}
                  ref={(node) => {
                    if (isCurrent) current.current = node;
                  }}
                >
                  <h4>
                    <span>
                      {isWeekDeload ? `Неделя ${week + 1} · Разгрузка` : `Неделя ${week + 1} · волна ${wave}`}
                    </span>
                    <small className="laid-wave-tag">
                      {isWeekDeload ? "55–65 % · RIR 3–4" : LaidDupPlan.WAVE_META[wave].title}
                    </small>
                    {isCurrent && !position.beforeStart ? <span className="laid-now">сейчас</span> : null}
                  </h4>
                  <p className="laid-week-card-focus">
                    {wGuide.focusTitle} · {wGuide.baseRir}
                  </p>
                  <ul>
                    {cycle.map((r) => {
                      const p = r.periodization!;
                      const plan = LaidDupPlan.day(p.day, week, maxes, {
                        version: p.version,
                        light: p.light,
                        substitutions: p.substitutions,
                        calibrationLifts: p.calibrationLifts,
                        painFlags: p.painFlags,
                        deloadWeeks: p.deloadWeeks,
                      });
                      const waveAux = isWeekDeload
                        ? null
                        : LaidDupPlan.waveAuxSummary(p.day, inWave, p.substitutions, p.version);
                      const isPercent = plan.prescriptionMode === "percent_1rm";
                      const meterRatio = isWeekDeload
                        ? 0.3
                        : isPercent
                          ? Math.min(1, Math.max(0.25, (plan.heavy.percent - 80) / 20))
                          : 0.45;
                      const intensityTag = isWeekDeload
                        ? "Разгрузка"
                        : isPercent
                          ? `${LaidDupPlan.pct(plan.heavy.percent)} %`
                          : plan.prescriptionMode === "calibration"
                            ? "RIR 2–3"
                            : plan.painFlag
                              ? "Щадяще"
                              : "RIR 1–2";
                      const rowKey = `${week}:${r.id}`;
                      const isOpen = expandedKey === rowKey;
                      const preview = isOpen ? LaidDupPlan.dayExercisesPreview(r, week, workouts, today) : [];
                      return (
                        <li key={r.id} className={isOpen ? "is-open" : undefined}>
                          <button
                            type="button"
                            className="laid-sched-day-trigger"
                            aria-expanded={isOpen}
                            onClick={() => setExpandedKey(isOpen ? null : rowKey)}
                          >
                            <span className="laid-sched-day-head">
                              <b>{LaidDupPlan.SHORT[p.day]}</b>
                              <span className="laid-day-weekday">
                                {r.days.length ? r.days.map((d) => DAY_NAMES[d]).join("·") : "—"}
                              </span>
                              <span className="laid-pct-tag">{intensityTag}</span>
                              <LaidStatus status={LaidDupPlan.dayStatus(r, workouts, week, today)} />
                              <ChevronDown
                                size={15}
                                className={`laid-sched-chevron${isOpen ? " is-rotated" : ""}`}
                                aria-hidden="true"
                              />
                            </span>
                            <span className="laid-plan-line">{LaidDupPlan.line(plan)}</span>
                            {waveAux ? <small className="laid-wave-aux">{waveAux} · RIR 1–2</small> : null}
                            <span className="laid-intensity-bar" aria-hidden="true">
                              <m.span
                                className={`laid-intensity-fill reps-${plan.heavy.reps}`}
                                initial={reduced ? false : { scaleX: 0 }}
                                animate={{ scaleX: meterRatio }}
                                transition={{ duration: 0.28 }}
                              />
                            </span>
                          </button>

                          {isOpen ? (
                            <div className="laid-sched-day-detail">
                              {preview.map((item) => (
                                <div key={item.exerciseId} className={`laid-day-ex-row${item.role === "lift" ? " is-lift" : ""}`}>
                                  <div className="laid-day-ex-main">
                                    <span className="laid-day-ex-name">
                                      {item.name}
                                      {item.isReplaced ? <span className="laid-ex-tag is-replaced">замена</span> : null}
                                    </span>
                                    <span className="laid-day-ex-meta">
                                      <span>{item.setsRepsLabel}</span>
                                      <span className={`laid-day-ex-weight source-${item.weightSource}`}>{item.weightLabel}</span>
                                      <span className="laid-day-ex-rir">{item.rirLabel}</span>
                                    </span>
                                  </div>
                                  {onEditSubstitutions ? (
                                    <button
                                      type="button"
                                      className="laid-day-ex-swap"
                                      aria-label={`Заменить ${item.name}`}
                                      title="Заменить упражнение в цикле"
                                      onClick={() => onEditSubstitutions(item.originalId)}
                                    >
                                      <ArrowLeftRight size={14} aria-hidden="true" />
                                    </button>
                                  ) : null}
                                </div>
                              ))}
                            </div>
                          ) : null}
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
                      const spec = LaidDupPlan.exerciseSpec(day, e.exerciseId, daySubs, r.periodization!.version);
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

        <div className="laid-actions laid-sticky-footer">
          {onEditDays ? (
            <button type="button" className="button secondary" onClick={onEditDays}>
              <ArrowUpDown size={15} aria-hidden="true" />
              Дни недели
            </button>
          ) : null}
          {onEditSubstitutions ? (
            <button type="button" className="button secondary" onClick={() => onEditSubstitutions()}>
              <ArrowLeftRight size={15} aria-hidden="true" />
              Замены
            </button>
          ) : null}
          <button type="button" className="button secondary" onClick={onUpdate}>
            <SlidersHorizontal size={15} aria-hidden="true" />
            {position.finished ? "Новый цикл" : "Максимумы"}
          </button>
          <button type="button" className="button primary" onClick={onClose}>
            Закрыть
          </button>
        </div>
      </div>
    </Modal>
  );
}
