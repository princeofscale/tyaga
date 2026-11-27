import { useMemo, useState } from "react";
import { AnimatePresence, m, useReducedMotion } from "motion/react";
import {
  ArrowLeftRight,
  ArrowUpDown,
  CalendarDays,
  ChevronDown,
  Eye,
  Pencil,
  Play,
  RotateCcw,
  SlidersHorizontal,
  Sparkles,
  Trash2,
} from "lucide-react";
import {
  LaidDupPlan,
  LAID_WEEKS,
  type LaidCalibrationGraduation,
} from "../domain/LaidDupPlan";
import { DAY_NAMES } from "../domain/TrainingProgram";
import { dateLabel } from "../lib/calendar";
import type { Routine, Workout } from "../lib/types";
import { LaidStatus } from "./LaidStatus";

type CardProps = {
  cycle: Routine[];
  workouts: Workout[];
  today: string;
  busy: boolean;
  onSchedule: () => void;
  onEditDays: () => void;
  onEditSubstitutions?: (focusOriginalId?: string) => void;
  onUpdate: () => void;
  /** Подсказка «Можно обновить максимум»: пересчитать план с текущей недели. */
  onRecalc: () => void;
  /** Быстрый старт конкретного дня цикла прямо из карточки. */
  onStartDay?: (routine: Routine) => void;
  /** Превью конкретного дня цикла (силуэт мышц, недельный объём и EWMA). */
  onPreviewDay?: (routine: Routine) => void;
  /** Быстрое редактирование конкретного дня цикла прямо из карточки. */
  onEditDay?: (routine: Routine) => void;
  /** Автовыпуск из «Калибровки по RIR»: применить ТМ 92,5 % и включить проценты DUP. */
  onGraduateCalibration?: (graduations: LaidCalibrationGraduation[], fromWeek: number) => void;
  /** Вставить или отменить разгрузочную неделю цикла. */
  onToggleDeloadWeek?: (rawWeek: number, enable: boolean) => void;
  /** В один клик улучшить существующий классический цикл до «Умного DUP v2». */
  onUpgradeToV2?: () => void;
  /** Применить автокоррекцию TM (DUP v2 гистерезис) с текущей недели. */
  onApplyTmUpdates?: (updates: Array<{ lift: "squat" | "bench" | "deadlift" | "ohp"; toMax: number }>) => void;
  /** Удалить весь 6-дневный цикл разом. */
  onDeleteCycle?: () => void;
};

/** Карточка программы Лейда на экране «Программы»: спокойная иерархия, волна, RIR, состав дня с весами и быстрые действия. */
export function LaidDupCard({
  cycle,
  workouts,
  today,
  busy,
  onSchedule,
  onEditDays,
  onEditSubstitutions,
  onUpdate,
  onRecalc,
  onStartDay,
  onPreviewDay,
  onEditDay,
  onGraduateCalibration,
  onToggleDeloadWeek,
  onUpgradeToV2,
  onApplyTmUpdates,
  onDeleteCycle,
}: CardProps) {
  const reduced = useReducedMotion();
  const [expandedDayId, setExpandedDayId] = useState<string | null>(null);
  const state = useMemo(() => LaidDupPlan.cycleState(cycle, workouts, today), [cycle, workouts, today]);
  const { first, rawWeek, totalWeeks, isCurrentDeload, position, activeMaxes, statusWeek, weekGuide } = state;
  const subs = first.substitutions;
  const subCount = subs ? Object.keys(subs).length : 0;
  const suggestion = useMemo(() => LaidDupPlan.suggestion(first, workouts, today), [first, workouts, today]);
  const tmAutoreg = useMemo(() => LaidDupPlan.tmAutoregSuggestions(first, workouts, today), [first, workouts, today]);
  const calibrationReady = useMemo(
    () => LaidDupPlan.calibrationReady(first, workouts, today),
    [first, workouts, today],
  );
  const cycleSummary = useMemo(
    () => (position.finished ? LaidDupPlan.cycleSummary(cycle, workouts, today) : null),
    [position.finished, cycle, workouts, today],
  );
  const waveMeta = LaidDupPlan.WAVE_META[position.wave];
  const restDay = useMemo(() => LaidDupPlan.restWeekday(LaidDupPlan.slotsFromCycle(cycle)), [cycle]);

  const statuses = useMemo(
    () => cycle.map((r) => LaidDupPlan.dayStatus(r, workouts, statusWeek, today)),
    [cycle, workouts, statusWeek, today],
  );
  const doneCount = statuses.filter((s) => s.state === "done").length;

  const expandedRoutine = expandedDayId ? cycle.find((r) => r.id === expandedDayId) ?? null : null;
  const expandedPreview = useMemo(
    () =>
      expandedRoutine
        ? LaidDupPlan.dayExercisesPreview(expandedRoutine, statusWeek, workouts, today)
        : [],
    [expandedRoutine, statusWeek, workouts, today],
  );

  return (
    <m.section
      className="laid-card panel"
      aria-label="Программа Дэвида Лейда"
      initial={reduced ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22 }}
    >
      <header className="laid-card-head">
        <div className="laid-card-title-group">
          <div className="laid-card-title-row">
            <h3>{first.version === "v2" ? "Умный DUP v2 · Баланс и защита" : "Дэвид Лейд · DUP"}</h3>
            {first.version === "v2" ? <span className="laid-v2-pill">DUP v2</span> : null}
          </div>
          <p className="laid-week" aria-live="polite">
            {position.beforeStart
              ? `Старт ${dateLabel(first.startMonday)} · неделя 1 из ${totalWeeks} · волна 1`
              : LaidDupPlan.weekLabel(position, { isDeload: isCurrentDeload, totalWeeks })}
            {first.weekMode === "rolling" ? " · плавающая" : ""}
          </p>
        </div>
        <span className={`laid-phase-badge${isCurrentDeload || position.finished ? " is-deload" : ""}`}>
          {position.finished
            ? "Цикл закончен"
            : isCurrentDeload
              ? `Неделя ${rawWeek + 1} · Разгрузка`
              : `Волна ${position.wave} · ${waveMeta.title}`}
        </span>
      </header>

      {first.version !== "v2" && onUpgradeToV2 ? (
        <div className="laid-v2-upgrade-bar">
          <div className="laid-v2-upgrade-copy">
            <b>Улучшить до «Умного DUP v2»</b>
            <span>−68 % на поясницу, икры/пресс/задняя дельта, без синглов 1ПМ, разгрузка на 7-й нед.</span>
          </div>
          <button
            type="button"
            className="button secondary laid-v2-upgrade-btn"
            disabled={busy}
            onClick={onUpgradeToV2}
          >
            <Sparkles size={14} aria-hidden="true" />
            Улучшить
          </button>
        </div>
      ) : null}

      <div className={`laid-overview-block${weekGuide.isDeloadWindow ? " is-deload" : ""}`}>
        <div className="laid-progress-segments" aria-hidden="true">
          {Array.from({ length: totalWeeks }, (_, idx) => {
            const segDeload = LaidDupPlan.isDeloadWeek(first, idx);
            const stateSeg = position.beforeStart
              ? "upcoming"
              : position.finished || idx < rawWeek
                ? "past"
                : idx === rawWeek
                  ? "active"
                  : "upcoming";
            const deloadsUpTo = (first.deloadWeeks ?? []).filter((w) => w <= idx).length;
            const waveEnd = !segDeload && (idx - deloadsUpTo === 2 || idx - deloadsUpTo === 5);
            return (
              <span
                key={idx}
                className={`laid-seg ${stateSeg}${waveEnd ? " wave-end" : ""}${segDeload ? " is-deload" : ""}`}
              >
                {stateSeg === "past" || stateSeg === "active" ? (
                  <m.span
                    className="laid-seg-fill"
                    initial={reduced ? false : { scaleX: 0 }}
                    animate={{ scaleX: 1 }}
                    transition={{ duration: 0.26, delay: reduced ? 0 : idx * 0.025 }}
                  />
                ) : null}
              </span>
            );
          })}
        </div>

        <div className="laid-progress-meta">
          <span>
            {totalWeeks > LAID_WEEKS ? `3 волны + разгрузка (${totalWeeks} нед.)` : "В1 (1–3) · В2 (4–6) · В3 (7–9)"}
            {restDay !== null ? ` · выходной ${DAY_NAMES[restDay]}` : ""}
          </span>
          <span className="laid-progress-count">
            {doneCount}/{cycle.length} на неделе
          </span>
        </div>

        <details className="laid-week-guide-disclosure">
          <summary className="laid-week-guide-summary">
            <span className="laid-week-guide-headline">
              <strong>{weekGuide.focusTitle}</strong>
              <span className="laid-guide-inline-meta">
                {weekGuide.baseRir} · {weekGuide.auxRir.replace("Подсобка и тренажёры: ", "Подсобка: ")}
              </span>
            </span>
            <ChevronDown size={16} className="laid-disclosure-chevron" aria-hidden="true" />
          </summary>
          <div className="laid-week-guide-details">
            <p className="laid-week-guide-copy">{weekGuide.summary}</p>
            <div className="laid-guide-rules" aria-label="Ориентиры RIR и отдыха">
              <span className="laid-guide-chip is-accent">{weekGuide.baseRir}</span>
              <span className="laid-guide-chip">{weekGuide.auxRir}</span>
              <span className="laid-guide-chip">{weekGuide.restSummary}</span>
            </div>
          </div>
        </details>
      </div>

      <div className="laid-card-maxes" aria-label="Рабочие максимумы цикла">
        {(["squat", "bench", "deadlift", "ohp"] as const).map((lift) => {
          const liftMode = LaidDupPlan.liftModeOf(first, lift);
          return (
            <button
              key={lift}
              type="button"
              className={`laid-mini-max${LaidDupPlan.isLiftSubstituted(lift, subs) ? " is-replaced" : ""}${liftMode !== "percent_1rm" ? " is-mode" : ""}`}
              onClick={onUpdate}
              title="Нажми, чтобы обновить максимумы"
            >
              <small>{LaidDupPlan.liftLabel(lift, subs)}</small>
              <strong>
                {liftMode === "calibration"
                  ? "Калибровка"
                  : liftMode === "pain"
                    ? "Щадяще"
                    : liftMode === "rir_range"
                      ? "По RIR"
                      : `${LaidDupPlan.kg(activeMaxes[lift])} кг`}
              </strong>
            </button>
          );
        })}
      </div>

      <ul className="laid-days">
        {cycle.map((r, idx) => {
          const p = r.periodization!;
          const status = statuses[idx];
          const dayPlan = LaidDupPlan.day(p.day, rawWeek, activeMaxes, {
            version: p.version,
            light: p.light,
            substitutions: p.substitutions,
            calibrationLifts: p.calibrationLifts,
            painFlags: p.painFlags,
            deloadWeeks: p.deloadWeeks,
          });
          const waveAux = dayPlan.isDeload
            ? null
            : LaidDupPlan.waveAuxSummary(p.day, position.inWave, p.substitutions, p.version);
          const isExpanded = expandedDayId === r.id;

          return (
            <m.li
              key={r.id}
              className={`laid-day-tile ${status.state}${dayPlan.isDeload ? " is-deload" : ""}${isExpanded ? " is-expanded" : ""}`}
              initial={reduced ? false : { opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.18, delay: reduced ? 0 : idx * 0.025 }}
            >
              <div className="laid-day-top">
                <span className="laid-day-title">
                  <b>{LaidDupPlan.SHORT[p.day]}</b>
                  <span className="laid-day-name">{r.days.length ? r.days.map((d) => DAY_NAMES[d]).join("·") : "—"}</span>
                </span>
                <LaidStatus status={status} />
              </div>

              <span className="laid-day-plan">{LaidDupPlan.compactLine(dayPlan)}</span>
              {waveAux ? <small className="laid-day-sub">{waveAux}</small> : null}

              <div className="laid-day-tile-actions">
                {onStartDay ? (
                  <button
                    type="button"
                    className="laid-tile-btn is-start"
                    disabled={busy}
                    onClick={() => onStartDay(r)}
                  >
                    <Play size={14} aria-hidden="true" />
                    <span>Начать</span>
                  </button>
                ) : null}
                {onPreviewDay ? (
                  <button
                    type="button"
                    className="laid-tile-btn is-icon"
                    disabled={busy}
                    aria-label={`Превью дня: ${LaidDupPlan.SHORT[p.day]}`}
                    title="Превью мышц и недельного объёма"
                    onClick={() => onPreviewDay(r)}
                  >
                    <Eye size={15} aria-hidden="true" />
                  </button>
                ) : null}
                <button
                  type="button"
                  className={`laid-tile-btn is-icon${isExpanded ? " is-active" : ""}`}
                  aria-expanded={isExpanded}
                  aria-label={`Состав и веса: ${LaidDupPlan.SHORT[p.day]}`}
                  title="Состав дня, веса и RIR"
                  onClick={() => setExpandedDayId(isExpanded ? null : r.id)}
                >
                  <ChevronDown size={16} className={isExpanded ? "is-rotated" : ""} aria-hidden="true" />
                </button>
                {onEditDay ? (
                  <button
                    type="button"
                    className="laid-tile-btn is-icon"
                    disabled={busy}
                    aria-label={`Править ${LaidDupPlan.SHORT[p.day]}`}
                    title={`Править ${LaidDupPlan.SHORT[p.day]}`}
                    onClick={() => onEditDay(r)}
                  >
                    <Pencil size={15} aria-hidden="true" />
                  </button>
                ) : null}
              </div>

              {isExpanded ? (
                <div className="laid-day-exercises" role="region" aria-label={`Упражнения: ${LaidDupPlan.SHORT[p.day]}`}>
                  <ul className="laid-day-ex-list">
                    {expandedPreview.map((item) => (
                      <li key={item.exerciseId} className={`laid-day-ex-row${item.role === "lift" ? " is-lift" : ""}`}>
                        <div className="laid-day-ex-main">
                          <span className="laid-day-ex-name">{item.name}</span>
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
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </m.li>
          );
        })}
      </ul>

      {cycleSummary ? (
        <div className="laid-cycle-summary" role="status">
          <div className="laid-cycle-summary-head">
            <strong>Итоги цикла · {totalWeeks} нед.</strong>
            <span>
              {cycleSummary.completedSessions} / {cycleSummary.plannedSessions} трен. ({cycleSummary.adherencePct} %)
              {cycleSummary.totalTonnageKg > 0
                ? ` · ${LaidDupPlan.kg(Math.round(cycleSummary.totalTonnageKg / 100) / 10)} т`
                : ""}
            </span>
          </div>
          <ul className="laid-summary-lifts">
            {cycleSummary.lifts.map((item) => (
              <li key={item.lift}>
                <small>{item.name}</small>
                <strong>
                  {item.bestE1rm !== null
                    ? `${LaidDupPlan.kg(item.bestE1rm)} кг`
                    : `${LaidDupPlan.kg(item.startMax)} кг`}
                </strong>
                <span>
                  {item.deltaKg !== null && item.deltaKg !== 0
                    ? `${item.deltaKg > 0 ? "+" : ""}${LaidDupPlan.kg(item.deltaKg)} кг`
                    : item.suggestedNextTm !== null
                      ? `ТМ ≈ ${LaidDupPlan.kg(item.suggestedNextTm)} кг`
                      : "нет записей"}
                </span>
              </li>
            ))}
          </ul>
          <p className="tiny laid-deload-hint">{LaidDupPlan.DELOAD_NOTICE}</p>
        </div>
      ) : null}

      <AnimatePresence initial={false}>
        {calibrationReady.length > 0 && onGraduateCalibration ? (
          <m.div
            key="cal-grad"
            className="laid-suggest laid-calibration-banner"
            role="status"
            initial={reduced ? false : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.2 }}
          >
            <p>
              <b>Калибровка по RIR завершена:</b>{" "}
              {calibrationReady
                .map(
                  (g) =>
                    `${g.exerciseName} → ТМ ${LaidDupPlan.kg(g.suggestedTm)} кг (1ПМ ${LaidDupPlan.kg(g.estimated1Rm)} кг)`,
                )
                .join("; ")}
              .
            </p>
            <button
              type="button"
              className="button primary"
              disabled={busy}
              onClick={() =>
                onGraduateCalibration(calibrationReady, position.beforeStart ? 0 : position.week)
              }
            >
              <Sparkles size={15} aria-hidden="true" />
              Включить % DUP с недели {position.beforeStart ? 1 : rawWeek + 1}
            </button>
          </m.div>
        ) : null}

        {tmAutoreg.length > 0 && onApplyTmUpdates ? (
          <m.div
            key="tm-autoreg"
            className="laid-suggest"
            role="status"
            initial={reduced ? false : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.2 }}
          >
            <p>
              <b>Автокоррекция TM (DUP v2):</b>{" "}
              {tmAutoreg
                .map(
                  (u) =>
                    `${LaidDupPlan.liftLabel(u.lift, subs)} ${LaidDupPlan.kg(u.fromMax)} → ${LaidDupPlan.kg(u.toMax)} кг (${u.changePct > 0 ? "+" : ""}${Math.round(u.changePct * 1000) / 10} %)`,
                )
                .join("; ")}
              .
            </p>
            <button
              type="button"
              className="button secondary"
              disabled={busy}
              onClick={() =>
                onApplyTmUpdates(tmAutoreg.map((u) => ({ lift: u.lift, toMax: u.toMax })))
              }
            >
              Применить TM с недели {position.beforeStart ? 1 : position.week + 1}
            </button>
          </m.div>
        ) : suggestion.length ? (
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

      <div className="laid-card-toolbar">
        <div className="laid-actions-main">
          <m.button
            type="button"
            className="button secondary laid-btn-schedule"
            whileTap={reduced ? undefined : { scale: 0.985 }}
            onClick={onSchedule}
          >
            <CalendarDays size={16} aria-hidden="true" />
            <span>Расписание ({totalWeeks} нед.)</span>
          </m.button>
          <m.button
            type="button"
            className="button secondary laid-btn-tool"
            whileTap={reduced ? undefined : { scale: 0.985 }}
            onClick={onEditDays}
          >
            <ArrowUpDown size={15} aria-hidden="true" />
            <span>Дни недели</span>
          </m.button>
          {onEditSubstitutions ? (
            <m.button
              type="button"
              className="button secondary laid-btn-tool"
              whileTap={reduced ? undefined : { scale: 0.985 }}
              onClick={() => onEditSubstitutions()}
            >
              <ArrowLeftRight size={15} aria-hidden="true" />
              <span>{subCount > 0 ? `Замены (${subCount})` : "Замены"}</span>
            </m.button>
          ) : null}
          <m.button
            type="button"
            className="button secondary laid-btn-tool"
            whileTap={reduced ? undefined : { scale: 0.985 }}
            onClick={onUpdate}
          >
            <SlidersHorizontal size={15} aria-hidden="true" />
            <span>{position.finished ? "Начать новый цикл" : "Обновить максимумы"}</span>
          </m.button>
        </div>

        {(onToggleDeloadWeek && !position.beforeStart && rawWeek <= 12) || onDeleteCycle ? (
          <div className="laid-card-utilities">
            {onToggleDeloadWeek && !position.beforeStart && rawWeek <= 12 ? (
              <button
                type="button"
                className="laid-utility-btn"
                disabled={busy}
                onClick={() => onToggleDeloadWeek(rawWeek, !isCurrentDeload)}
              >
                <RotateCcw size={14} aria-hidden="true" />
                <span>
                  {isCurrentDeload
                    ? `Убрать разгрузку нед. ${rawWeek + 1}`
                    : position.finished
                      ? `Разгрузка (нед. ${rawWeek + 1})`
                      : `Вставить разгрузку (нед. ${rawWeek + 1})`}
                </span>
              </button>
            ) : null}
            {onDeleteCycle ? (
              <button
                type="button"
                className="laid-utility-btn is-danger"
                disabled={busy}
                onClick={onDeleteCycle}
              >
                <Trash2 size={14} aria-hidden="true" />
                <span>Удалить цикл</span>
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </m.section>
  );
}
