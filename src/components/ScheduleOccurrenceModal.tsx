import { useId, useMemo, useRef, useState } from "react";
import { DAY_NAMES } from "../domain/TrainingProgram";
import { addCalendarDays, calendarWeek, dateLabel, isCalendarDate } from "../lib/calendar";
import type { RoutineOccurrenceOverride } from "../lib/types";
import { ApiError } from "../services/ApiClient";
import Modal from "./Modal";

type Props = {
  name: string;
  originalDate: string;
  today: string;
  override?: RoutineOccurrenceOverride;
  onSave: (destination: string | null | undefined) => Promise<void>;
  onEditLaidDays?: () => void;
  onClose: () => void;
};

export default function ScheduleOccurrenceModal({ name, originalDate, today, override, onSave, onEditLaidDays, onClose }: Props) {
  const dateId = useId();
  const hintId = useId();
  const errorId = useId();
  const dateField = useRef<HTMLInputElement>(null);
  const saving = useRef(false);
  const [busy, setBusy] = useState(false);
  const [date, setDate] = useState("");
  const [invalidDate, setInvalidDate] = useState(false);
  const [error, setError] = useState("");
  const activeDate = override?.to ?? originalDate;
  const weekDays = useMemo(() => {
    const monday = calendarWeek(originalDate).from;
    return DAY_NAMES.map((label, idx) => ({ label, date: addCalendarDays(monday, idx) }));
  }, [originalDate]);

  async function apply(destination: string | null | undefined) {
    if (saving.current) return;
    saving.current = true;
    setBusy(true);
    setInvalidDate(false);
    setError("");
    try {
      await onSave(destination);
    } catch (e) {
      setError(e instanceof ApiError && e.status === 409
        ? "План изменился в другой вкладке. Обнови страницу и открой тренировку заново."
        : e instanceof Error ? e.message : "Не удалось изменить план");
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }

  const dismiss = () => {
    if (saving.current) return false;
    // Close before unmounting so the browser can restore focus to the invoker.
    dateField.current?.closest("dialog")?.close();
    onClose();
  };

  return (
    <Modal title="Изменить тренировку в плане" onClose={dismiss}>
      <form className="schedule-occurrence-form" aria-label="Разовая правка плана" onSubmit={(e) => {
        e.preventDefault();
        if (!isCalendarDate(date) || date < today || date === originalDate || date === override?.to) {
          setError(date === originalDate && override
            ? "Чтобы вернуть исходную дату, выбери «Вернуть в план»."
            : "Выбери другую дату — сегодня или позже.");
          setInvalidDate(true);
          dateField.current?.focus();
          return;
        }
        void apply(date);
      }}>
        <p className="schedule-occurrence-date">
          <strong>{name}</strong><br />
          По плану: <time dateTime={originalDate}>{dateLabel(originalDate, true)}</time>
          {override?.to ? <> · Перенесено на <time dateTime={override.to}>{dateLabel(override.to, true)}</time></>
            : override ? " · Пропущено" : null}
        </p>
        <p className="tiny" id={hintId}>Изменится только эта тренировка. Дни в шаблоне останутся прежними.</p>
        <div className="schedule-week-quick" role="group" aria-label="Быстрый перенос внутри недели">
          {weekDays.map((item) => {
            const isCurrent = item.date === activeDate && override?.to !== null;
            const isPast = item.date < today;
            return (
              <button
                key={item.date}
                type="button"
                className={`schedule-week-chip${isCurrent ? " is-current" : ""}`}
                disabled={busy || isPast || isCurrent}
                aria-current={isCurrent ? "date" : undefined}
                aria-label={`Перенести на ${item.label}, ${dateLabel(item.date, true)}`}
                onClick={() => void apply(item.date === originalDate ? undefined : item.date)}
              >
                <span>{item.label}</span>
                <b>{Number(item.date.slice(-2))}</b>
              </button>
            );
          })}
        </div>
        <div className="schedule-occurrence-field">
          <label htmlFor={dateId}>Новая дата</label>
          <input
            ref={dateField}
            data-autofocus
            id={dateId}
            name="date"
            type="date"
            min={today}
            required
            disabled={busy}
            value={date}
            aria-invalid={invalidDate || undefined}
            aria-describedby={invalidDate ? `${hintId} ${errorId}` : hintId}
            onChange={(e) => {
              setDate(e.currentTarget.value);
              if (invalidDate) {
                setError("");
                setInvalidDate(false);
              }
            }}
          />
        </div>
        {error ? <p className="error-banner" id={errorId} role="alert">{error}</p> : null}
        <button className="button primary full-width" type="submit" disabled={busy}>
          {busy ? "Сохраняем…" : "Перенести"}
        </button>
        <div className="schedule-occurrence-actions">
          {override?.to !== null ? (
            <button className="button secondary" type="button" disabled={busy} onClick={() => void apply(null)}>Пропустить</button>
          ) : null}
          {override ? (
            <button className="button secondary" type="button" disabled={busy} onClick={() => void apply(undefined)}>Вернуть в план</button>
          ) : null}
        </div>
        {onEditLaidDays ? (
          <button
            className="button secondary full-width"
            type="button"
            disabled={busy}
            onClick={() => {
              dismiss();
              onEditLaidDays();
            }}
          >
            Настроить дни всего цикла Лейда
          </button>
        ) : null}
      </form>
    </Modal>
  );
}
