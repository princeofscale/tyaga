import { useMemo } from "react";
import { AnimatePresence, m, useReducedMotion } from "motion/react";
import { ArrowLeftRight, ArrowUpDown, CalendarDays, Pencil, Play, RotateCcw, Sparkles, Trash2 } from "lucide-react";
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
  onEditSubstitutions?: () => void;
  onUpdate: () => void;
  /** Подсказка «Можно обновить максимум»: пересчитать план с текущей недели. */
  onRecalc: () => void;
  /** Быстрый старт конкретного дня цикла прямо из карточки. */
  onStartDay?: (routine: Routine) => void;
  /** Быстрое редактирование конкретного дня цикла прямо из карточки. */
  onEditDay?: (routine: Routine) => void;
  /** Автовыпуск из «Калибровки по RIR»: применить ТМ 92,5 % и включить проценты DUP. */
  onGraduateCalibration?: (graduations: LaidCalibrationGraduation[], fromWeek: number) => void;
  /** Вставить или отменить разгрузочную неделю цикла. */
  onToggleDeloadWeek?: (rawWeek: number, enable: boolean) => void;
  /** Удалить весь 6-дневный цикл разом. */
  onDeleteCycle?: () => void;
};

/** Карточка программы Лейда на экране «Программы»: прогресс волн, суть текущей недели, RIR, максимумы, кликабельные дни недели. */
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
  onEditDay,
  onGraduateCalibration,
  onToggleDeloadWeek,
  onDeleteCycle,
}: CardProps) {
  const reduced = useReducedMotion();
  const state = useMemo(() => LaidDupPlan.cycleState(cycle, workouts, today), [cycle, workouts, today]);
  const { first, rawWeek, totalWeeks, isCurrentDeload, position, activeMaxes, statusWeek, weekGuide } = state;
  const subs = first.substitutions;
  const subCount = subs ? Object.keys(subs).length : 0;
  const suggestion = useMemo(() => LaidDupPlan.suggestion(first, workouts, today), [first, workouts, today]);
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
        <span className={`laid-phase-badge${isCurrentDeload || position.finished ? " is-deload" : ""}`}>
          {position.finished
            ? "Цикл закончен"
            : isCurrentDeload
              ? `Неделя ${rawWeek + 1} · Разгрузка`
              : `Волна ${position.wave} · ${waveMeta.title}`}
        </span>
      </div>

      <p className="laid-week" aria-live="polite">
        {position.beforeStart
          ? `Старт ${dateLabel(first.startMonday)} · неделя 1 из ${totalWeeks} · волна 1`
          : LaidDupPlan.weekLabel(position, { isDeload: isCurrentDeload, totalWeeks })}
        {first.weekMode === "rolling" ? " · плавающая неделя" : ""}
      </p>

      <div className="laid-progress" aria-hidden="true">
        <div className="laid-progress-segments">
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
                    transition={{ duration: 0.28, delay: reduced ? 0 : idx * 0.03 }}
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
          <span>
            На неделе: {doneCount}/{cycle.length}
          </span>
        </div>
      </div>

      <div className={`laid-week-guide${weekGuide.isDeloadWindow ? " is-deload" : ""}`}>
        <div className="laid-week-guide-top">
          <strong>Суть недели: {weekGuide.focusTitle}</strong>
        </div>
        <p className="laid-week-guide-copy">{weekGuide.summary}</p>
        <div className="laid-guide-rules" aria-label="Ориентиры RIR и отдыха">
          <span className="laid-guide-chip is-accent">{weekGuide.baseRir}</span>
          <span className="laid-guide-chip">{weekGuide.auxRir}</span>
          <span className="laid-guide-chip">{weekGuide.restSummary}</span>
        </div>
      </div>

      <div className="laid-card-maxes" aria-label="Рабочие максимумы цикла">
        {(["squat", "bench", "deadlift", "ohp"] as const).map((lift) => {
          const liftMode = LaidDupPlan.liftModeOf(first, lift);
          return (
            <span
              key={lift}
              className={`laid-mini-max${LaidDupPlan.isLiftSubstituted(lift, subs) ? " is-replaced" : ""}${liftMode !== "percent_1rm" ? " is-mode" : ""}`}
            >
              <small>{LaidDupPlan.liftLabel(lift, subs)}</small>
              <b>
                {liftMode === "calibration"
                  ? "Калибровка · RIR 2–3"
                  : liftMode === "pain"
                    ? "Щадяще · RIR 2–3"
                    : liftMode === "rir_range"
                      ? "По RIR 1–2"
                      : `${LaidDupPlan.kg(activeMaxes[lift])} кг`}
              </b>
            </span>
          );
        })}
      </div>

      <ul className="laid-days">
        {cycle.map((r, idx) => {
          const p = r.periodization!;
          const status = statuses[idx];
          const dayPlan = LaidDupPlan.day(p.day, rawWeek, activeMaxes, {
            light: p.light,
            substitutions: p.substitutions,
            calibrationLifts: p.calibrationLifts,
            painFlags: p.painFlags,
            deloadWeeks: p.deloadWeeks,
          });
          const waveAux = LaidDupPlan.waveAuxSummary(p.day, position.inWave, p.substitutions);
          return (
            <m.li
              key={r.id}
              className={`laid-day-tile ${status.state}${dayPlan.isDeload ? " is-deload" : ""}`}
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
              <small className="laid-day-sub">
                {dayPlan.isDeload
                  ? "Разгрузка: 65 % и половина подходов · RIR 3–4"
                  : waveAux
                    ? `${waveAux} · подсобка RIR 1–2`
                    : "Подсобка и тренажёры: RIR 1–2"}
              </small>
              {onStartDay || onEditDay ? (
                <div className="laid-day-tile-actions">
                  {onStartDay ? (
                    <button
                      type="button"
                      className="laid-tile-btn is-start"
                      disabled={busy}
                      onClick={() => onStartDay(r)}
                    >
                      <Play size={13} aria-hidden="true" />
                      <span>Начать</span>
                    </button>
                  ) : null}
                  {onEditDay ? (
                    <button
                      type="button"
                      className="laid-tile-btn"
                      disabled={busy}
                      aria-label={`Править ${LaidDupPlan.SHORT[p.day]}`}
                      onClick={() => onEditDay(r)}
                    >
                      <Pencil size={13} aria-hidden="true" />
                      <span>Править</span>
                    </button>
                  ) : null}
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
                <b>
                  {item.bestE1rm !== null
                    ? `${LaidDupPlan.kg(item.bestE1rm)} кг`
                    : `${LaidDupPlan.kg(item.startMax)} кг`}
                </b>
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
                    `${g.exerciseName} → ТМ ${LaidDupPlan.kg(g.suggestedTm)} кг (92,5 % от 1ПМ ${LaidDupPlan.kg(g.estimated1Rm)} кг)`,
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
          Расписание ({totalWeeks} нед.)
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
        {onToggleDeloadWeek && !position.beforeStart && rawWeek <= 12 ? (
          <m.button
            type="button"
            className="button secondary"
            disabled={busy}
            whileTap={reduced ? undefined : { scale: 0.985 }}
            onClick={() => onToggleDeloadWeek(rawWeek, !isCurrentDeload)}
          >
            <RotateCcw size={15} aria-hidden="true" />
            {isCurrentDeload
              ? `Убрать разгрузку нед. ${rawWeek + 1}`
              : position.finished
                ? `Начать разгрузку (нед. ${rawWeek + 1})`
                : `Вставить разгрузку (нед. ${rawWeek + 1})`}
          </m.button>
        ) : null}
        {onDeleteCycle ? (
          <m.button
            type="button"
            className="button secondary laid-delete-cycle-btn"
            disabled={busy}
            whileTap={reduced ? undefined : { scale: 0.985 }}
            onClick={onDeleteCycle}
          >
            <Trash2 size={15} aria-hidden="true" />
            Удалить цикл ({cycle.length})
          </m.button>
        ) : null}
      </div>
      <p className="tiny">
        {LaidDupPlan.NOTICE}{" "}
        {first.autoEscalate
          ? LaidDupPlan.AUTO_NOTICE
          : "Обновление 1ПМ внутри цикла — по кнопке, без скрытых изменений."}
      </p>
    </m.section>
  );
}
