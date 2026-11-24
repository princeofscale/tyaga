import { useId, useMemo, useRef, useState } from "react";
import { AnimatePresence, Reorder, m, useDragControls, useReducedMotion } from "motion/react";
import {
  AlarmClock,
  CalendarDays,
  Check,
  CheckCheck,
  Clock,
  Flame,
  GripVertical,
  Layers,
  Pencil,
  Pill,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import {
  ALL_WEEKDAYS,
  SUPPLEMENT_CATALOG,
  SUPPLEMENT_CATEGORIES,
  SUPPLEMENT_DOSE_UNITS,
  SUPPLEMENT_TIMINGS,
  SupplementsStore,
  type SupplementCategory,
  type SupplementDoseUnit,
  type SupplementTiming,
  type SupplementsState,
  type UserSupplement,
} from "../domain/Supplements";
import { DAY_NAMES, calendarWeekday } from "../domain/TrainingProgram";
import { quantityWord } from "../lib/quantity";
import "../styles/supplements.css";

const RING_RADIUS = 46;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

const SPRING = { type: "spring" as const, stiffness: 420, damping: 32 };

const DAY_PRESETS: Array<{ id: string; label: string; days: number[] }> = [
  { id: "daily", label: "Каждый день", days: [0, 1, 2, 3, 4, 5, 6] },
  { id: "weekdays", label: "Будни", days: [0, 1, 2, 3, 4] },
  { id: "mwf", label: "Пн · Ср · Пт", days: [0, 2, 4] },
];

type PlanTab = "stack" | "day" | "week";

function formatDaysShort(days?: number[]): string {
  const clean = days && days.length > 0 ? days : [...ALL_WEEKDAYS];
  if (clean.length === 7) return "Каждый день";
  if (clean.length === 5 && clean.every((d, i) => d === i)) return "Будни";
  return clean.map((d) => DAY_NAMES[d]).join(" · ");
}

function timingLabel(timing: SupplementTiming): string {
  return SUPPLEMENT_TIMINGS.find((t) => t.id === timing)?.short ?? "Любое";
}

/** Строгий числовой ввод дозировки + выбор единицы (исключает текст вроде «куцавп»). */
function DoseInput({
  amount,
  unit,
  label,
  onCommit,
}: {
  amount: number;
  unit: SupplementDoseUnit;
  label: string;
  onCommit: (nextAmount: number, nextUnit: SupplementDoseUnit) => void;
}) {
  const inputId = useId();
  const errorId = `${inputId}-err`;
  const [draft, setDraft] = useState(String(amount));
  const [touched, setTouched] = useState(false);

  const parsed = SupplementsStore.validateDoseAmount(draft);
  const invalid = touched && parsed === null;

  return (
    <div className="sup-dose-field">
      <div className="sup-dose-inputs">
        <input
          id={inputId}
          type="number"
          inputMode="decimal"
          min={0.1}
          max={10000}
          step="any"
          required
          aria-label={label}
          aria-invalid={invalid ? "true" : "false"}
          aria-describedby={invalid ? errorId : undefined}
          className={`sup-dose-num${invalid ? " user-invalid-fallback" : ""}`}
          value={draft}
          onKeyDown={(e) => {
            if (["e", "E", "+", "-"].includes(e.key)) e.preventDefault();
          }}
          onChange={(e) => {
            const raw = e.target.value;
            setDraft(raw);
            const valid = SupplementsStore.validateDoseAmount(raw);
            if (valid !== null) onCommit(valid, unit);
          }}
          onBlur={() => {
            setTouched(true);
            const valid = SupplementsStore.validateDoseAmount(draft);
            if (valid !== null) {
              setDraft(String(valid));
              onCommit(valid, unit);
            }
          }}
        />
        <select
          aria-label={`Единица измерения: ${label}`}
          className="sup-dose-unit"
          value={unit}
          onChange={(e) => {
            const nextUnit = e.target.value as SupplementDoseUnit;
            const valid = SupplementsStore.validateDoseAmount(draft) ?? amount;
            onCommit(valid, nextUnit);
          }}
        >
          {SUPPLEMENT_DOSE_UNITS.map((u) => (
            <option key={u} value={u}>
              {u}
            </option>
          ))}
        </select>
      </div>
      {invalid ? (
        <span id={errorId} className="sup-dose-error" role="alert">
          Ошибка: укажи число от 0,1 до 10 000.
        </span>
      ) : null}
    </div>
  );
}

/** Элемент стека с плавным перетаскиванием за ручку (мышь/тач) и клавиатурным режимом Grab–Move–Drop. */
function DraggableSupplementCard({
  item,
  index,
  total,
  taken,
  scheduledToday,
  editing,
  reduced,
  onToggleTaken,
  onToggleEdit,
  onRemove,
  onUpdate,
  onToggleDay,
  onMoveBy,
  onCancelKeyboardMove,
  onDragStateChange,
  onAnnounce,
}: {
  item: UserSupplement;
  index: number;
  total: number;
  taken: boolean;
  scheduledToday: boolean;
  editing: boolean;
  reduced: boolean | null;
  onToggleTaken: () => void;
  onToggleEdit: () => void;
  onRemove: () => void;
  onUpdate: (patch: Partial<Pick<UserSupplement, "doseAmount" | "doseUnit" | "timing" | "days" | "reminderTime">>) => void;
  onToggleDay: (weekday: number) => void;
  onMoveBy: (delta: -1 | 1) => void;
  onCancelKeyboardMove: (originalIndex: number) => void;
  onDragStateChange: (dragging: boolean) => void;
  onAnnounce: (msg: string) => void;
}) {
  const dragControls = useDragControls();
  const [kbGrabbed, setKbGrabbed] = useState(false);
  const originalIndexRef = useRef<number>(index);
  const handleRef = useRef<HTMLButtonElement>(null);
  const doseParts = SupplementsStore.getDoseParts(item);
  const days = SupplementsStore.getDays(item);

  return (
    <Reorder.Item
      value={item.id}
      as="div"
      dragListener={false}
      dragControls={dragControls}
      layout={reduced ? undefined : "position"}
      className={`sup-card${taken ? " is-taken" : ""}${kbGrabbed ? " is-grabbed" : ""}${!scheduledToday ? " is-rest-day" : ""}`}
      style={{ "--sup-accent": item.accent } as React.CSSProperties}
      whileDrag={
        reduced
          ? undefined
          : {
              scale: 1.02,
              boxShadow: "0 20px 44px rgba(0, 0, 0, 0.52)",
              zIndex: 25,
            }
      }
      onDragStart={() => onDragStateChange(true)}
      onDragEnd={() => onDragStateChange(false)}
      transition={reduced ? { duration: 0 } : SPRING}
    >
      {/* Выделенная ручка перетаскивания (touch-action: none только здесь) */}
      <button
        ref={handleRef}
        type="button"
        className="sup-drag-handle"
        aria-label={`Переместить ${item.name} (${index + 1} из ${total})`}
        aria-pressed={kbGrabbed}
        title="Зажми и перетащи для изменения порядка"
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.preventDefault();
          dragControls.start(e);
        }}
        onKeyDown={(e) => {
          if (e.key === " " || e.key === "Enter") {
            e.preventDefault();
            if (!kbGrabbed) {
              originalIndexRef.current = index;
              setKbGrabbed(true);
              onAnnounce(`Взята добавка «${item.name}», позиция ${index + 1} из ${total}. Стрелки вверх и вниз — переместить, Space — поставить, Escape — отмена.`);
            } else {
              setKbGrabbed(false);
              onAnnounce(`Поставлено: «${item.name}», позиция ${index + 1} из ${total}.`);
            }
          } else if (kbGrabbed && e.key === "ArrowUp") {
            e.preventDefault();
            if (index > 0) {
              onMoveBy(-1);
              onAnnounce(`«${item.name}» перемещена выше: ${index} из ${total}.`);
              requestAnimationFrame(() => handleRef.current?.focus({ preventScroll: true }));
            }
          } else if (kbGrabbed && e.key === "ArrowDown") {
            e.preventDefault();
            if (index < total - 1) {
              onMoveBy(1);
              onAnnounce(`«${item.name}» перемещена ниже: ${index + 2} из ${total}.`);
              requestAnimationFrame(() => handleRef.current?.focus({ preventScroll: true }));
            }
          } else if (kbGrabbed && e.key === "Escape") {
            e.preventDefault();
            setKbGrabbed(false);
            onCancelKeyboardMove(originalIndexRef.current);
            onAnnounce(`Перемещение «${item.name}» отменено.`);
          }
        }}
        onBlur={() => {
          if (kbGrabbed) setKbGrabbed(false);
        }}
      >
        <GripVertical size={17} aria-hidden="true" />
      </button>

      {/* Кнопка отметки приёма */}
      <m.button
        type="button"
        className="sup-check-btn"
        aria-pressed={taken}
        aria-label={taken ? `Снять отметку: ${item.name}` : `Отметить принятым: ${item.name}`}
        whileTap={reduced ? undefined : { scale: 0.9 }}
        onClick={onToggleTaken}
      >
        <Check size={19} aria-hidden="true" />
      </m.button>

      {/* Название и ключевые параметры */}
      <div className="sup-card-body">
        <div className="sup-card-title-row">
          <span className="sup-card-title">{item.name}</span>
          {!scheduledToday && <span className="sup-rest-badge">Сегодня перерыв</span>}
        </div>
        <div className="sup-card-sub">
          <span className="sup-pill is-dose">{item.dose}</span>
          <span className="sup-pill">
            <Clock size={11} aria-hidden="true" />
            {timingLabel(item.timing)}
            {item.reminderTime ? ` · ${item.reminderTime}` : ""}
          </span>
          <span className="sup-pill">
            <CalendarDays size={11} aria-hidden="true" />
            {formatDaysShort(item.days)}
          </span>
        </div>
        <span className="sup-key-hint" aria-hidden="true">
          {kbGrabbed ? "↑↓ двигать · Space поставить · Esc отмена" : "Space — переместить"}
        </span>
      </div>

      {/* Действия */}
      <div className="sup-card-actions">
        <button
          type="button"
          className={`sup-icon-btn${editing ? " is-active" : ""}`}
          aria-label={`Настроить ${item.name}`}
          aria-expanded={editing}
          onClick={onToggleEdit}
        >
          <Pencil size={15} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="sup-icon-btn danger"
          aria-label={`Убрать ${item.name} из стека`}
          onClick={onRemove}
        >
          <Trash2 size={15} aria-hidden="true" />
        </button>
      </div>

      {/* Встроенный редактор дозы, времени и дней недели */}
      {editing && (
        <div className="sup-edit-panel">
          <div className="sup-edit-grid">
            <div className="sup-edit-col">
              <span className="sup-edit-label">Дозировка</span>
              <DoseInput
                key={`${item.id}-${doseParts.amount}-${doseParts.unit}`}
                amount={doseParts.amount}
                unit={doseParts.unit}
                label={`Дозировка для ${item.name}`}
                onCommit={(nextAmount, nextUnit) =>
                  onUpdate({ doseAmount: nextAmount, doseUnit: nextUnit })
                }
              />
            </div>

            <label className="sup-edit-col">
              <span className="sup-edit-label">Когда принимать</span>
              <select
                aria-label={`Время приёма для ${item.name}`}
                value={item.timing}
                onChange={(e) => onUpdate({ timing: e.target.value as SupplementTiming })}
              >
                {SUPPLEMENT_TIMINGS.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="sup-edit-col">
              <span className="sup-edit-label">Время (ориентир)</span>
              <input
                type="time"
                aria-label={`Часы приёма для ${item.name}`}
                value={item.reminderTime ?? ""}
                onChange={(e) => onUpdate({ reminderTime: e.target.value || undefined })}
              />
            </label>
          </div>

          <div className="sup-edit-days">
            <div className="sup-edit-days-head">
              <span className="sup-edit-label">Дни приёма</span>
              <div className="sup-preset-row">
                {DAY_PRESETS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className="sup-preset-chip"
                    onClick={() => onUpdate({ days: [...p.days] })}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="sup-day-toggles" role="group" aria-label={`Дни недели для ${item.name}`}>
              {DAY_NAMES.map((dayLabel, wd) => {
                const active = days.includes(wd);
                return (
                  <button
                    key={dayLabel}
                    type="button"
                    aria-pressed={active}
                    className={`sup-day-toggle${active ? " active" : ""}`}
                    onClick={() => onToggleDay(wd)}
                  >
                    {dayLabel}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="sup-edit-foot">
            <button type="button" className="button secondary" onClick={onToggleEdit}>
              Готово
            </button>
          </div>
        </div>
      )}
    </Reorder.Item>
  );
}

export default function SupplementsScreen({
  state,
  today,
  onChange,
}: {
  state: SupplementsState;
  today: string;
  onChange: (next: SupplementsState) => void;
}) {
  const reduced = useReducedMotion();
  const [planTab, setPlanTab] = useState<PlanTab>("stack");
  const [activeDate, setActiveDate] = useState(today);
  const [category, setCategory] = useState<"all" | SupplementCategory>("all");
  const [showCustom, setShowCustom] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [liveNotice, setLiveNotice] = useState("");

  // Поля формы «Своя добавка» со строгим числовым вводом
  const [customName, setCustomName] = useState("");
  const [customAmount, setCustomAmount] = useState("5");
  const [customUnit, setCustomUnit] = useState<SupplementDoseUnit>("г");
  const [customAmountTouched, setCustomAmountTouched] = useState(false);
  const [customTiming, setCustomTiming] = useState<SupplementTiming>("morning");
  const [customTime, setCustomTime] = useState("08:30");
  const [customCategory, setCustomCategory] = useState<SupplementCategory>("base");
  const [customDays, setCustomDays] = useState<number[]>([...ALL_WEEKDAYS]);

  const customAmountId = useId();
  const customAmountErrId = `${customAmountId}-err`;
  const customAmountValid = SupplementsStore.validateDoseAmount(customAmount);
  const customAmountInvalid = customAmountTouched && customAmountValid === null;

  const summary = useMemo(() => SupplementsStore.summary(state, activeDate), [state, activeDate]);
  const ordered = useMemo(() => SupplementsStore.orderedStack(state.stack), [state.stack]);
  const orderedIds = useMemo(() => ordered.map((s) => s.id), [ordered]);

  const inStackCatalogIds = useMemo(
    () => new Set(state.stack.map((s) => s.catalogId).filter(Boolean)),
    [state.stack],
  );
  const filteredCatalog = useMemo(
    () =>
      category === "all"
        ? SUPPLEMENT_CATALOG
        : SUPPLEMENT_CATALOG.filter((item) => item.category === category),
    [category],
  );

  // Группировка плана на день по слотам времени суток
  const dayGroups = useMemo(() => {
    const scheduled = SupplementsStore.scheduledForDate(ordered, activeDate);
    return SUPPLEMENT_TIMINGS.map((slot) => ({
      slot,
      items: scheduled.filter((item) => item.timing === slot.id),
    })).filter((g) => g.items.length > 0);
  }, [ordered, activeDate]);

  const strokeOffset = RING_CIRCUMFERENCE * (1 - summary.ratio);
  const allTaken = summary.total > 0 && summary.taken >= summary.total;
  const remainingToday = Math.max(0, summary.total - summary.taken);

  const handleReorder = (nextIds: string[]) => {
    onChange(SupplementsStore.reorder(state, nextIds));
  };

  const moveItemBy = (index: number, delta: -1 | 1) => {
    const target = index + delta;
    if (target < 0 || target >= orderedIds.length) return;
    const copy = [...orderedIds];
    const [moved] = copy.splice(index, 1);
    copy.splice(target, 0, moved);
    handleReorder(copy);
  };

  const restoreItemIndex = (id: string, originalIndex: number) => {
    const copy = orderedIds.filter((x) => x !== id);
    copy.splice(Math.min(originalIndex, copy.length), 0, id);
    handleReorder(copy);
  };

  const submitCustom = (e: React.FormEvent) => {
    e.preventDefault();
    setCustomAmountTouched(true);
    const validAmount = SupplementsStore.validateDoseAmount(customAmount);
    if (!customName.trim() || validAmount === null) return;
    onChange(
      SupplementsStore.addCustom(state, {
        name: customName,
        doseAmount: validAmount,
        doseUnit: customUnit,
        timing: customTiming,
        reminderTime: customTime || undefined,
        days: customDays,
        category: customCategory,
      }),
    );
    setCustomName("");
    setCustomAmount("5");
    setCustomUnit("г");
    setCustomAmountTouched(false);
    setCustomDays([...ALL_WEEKDAYS]);
    setShowCustom(false);
  };

  return (
    <div className={`supplements-screen${isDragging ? " is-dragging" : ""}`}>
      <span className="sr-only" aria-live="polite" role="status">
        {liveNotice}
      </span>

      {/* Hero-карточка */}
      <m.section
        className="sup-hero"
        aria-label="Сводка добавок на сегодня"
        initial={reduced ? false : { opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
      >
        <div className="sup-hero-copy">
          <span className="sup-hero-eyebrow">
            <Pill size={14} aria-hidden="true" />
            {activeDate === today ? "Ежедневный стек" : `План на ${activeDate}`}
          </span>
          <h1>Добавки</h1>
          <div className="sup-hero-meta">
            <span>
              {activeDate === today ? "Сегодня" : "За день"}:{" "}
              <b>
                {summary.taken} / {summary.total}
              </b>
            </span>
            <span>
              <Flame size={14} aria-hidden="true" />
              Серия:{" "}
              <b>
                {summary.streak} {quantityWord(summary.streak, "день", "дня", "дней")}
              </b>
            </span>
            {remainingToday > 0 && (
              <span className="sup-remaining-pill">
                <AlarmClock size={13} aria-hidden="true" />
                Осталось выпить: <b>{remainingToday}</b>
              </span>
            )}
          </div>
          <div className="sup-hero-actions">
            {summary.total > 0 && (
              <m.button
                type="button"
                className={`button ${allTaken ? "secondary" : "primary"}`}
                whileTap={reduced ? undefined : { scale: 0.97 }}
                onClick={() => onChange(SupplementsStore.markAllTaken(state, activeDate, !allTaken))}
              >
                <CheckCheck size={16} aria-hidden="true" />
                {allTaken ? "Снять отметки" : "Отметить всё на сегодня"}
              </m.button>
            )}
            <m.button
              type="button"
              className="button secondary"
              whileTap={reduced ? undefined : { scale: 0.97 }}
              onClick={() => setShowCustom((v) => !v)}
            >
              {showCustom ? <X size={16} aria-hidden="true" /> : <Plus size={16} aria-hidden="true" />}
              {showCustom ? "Скрыть форму" : "Своя добавка"}
            </m.button>
          </div>
        </div>

        <div className="sup-ring-wrap" aria-label={`Принято ${summary.percent}% добавок`}>
          <svg className="sup-ring-svg" viewBox="0 0 112 112" aria-hidden="true">
            <circle className="sup-ring-track" cx="56" cy="56" r={RING_RADIUS} />
            <m.circle
              className="sup-ring-fill"
              cx="56"
              cy="56"
              r={RING_RADIUS}
              strokeDasharray={RING_CIRCUMFERENCE}
              initial={false}
              animate={{ strokeDashoffset: strokeOffset }}
              transition={reduced ? { duration: 0 } : { duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
            />
          </svg>
          <div className="sup-ring-center">
            <strong>{summary.total ? `${summary.percent}%` : "0%"}</strong>
            <span>{summary.total ? `${summary.taken} из ${summary.total}` : "стек пуст"}</span>
          </div>
        </div>
      </m.section>

      {/* Форма добавления своей добавки */}
      <AnimatePresence initial={false}>
        {showCustom && (
          <m.form
            key="custom-form"
            className="sup-custom-form"
            onSubmit={submitCustom}
            initial={reduced ? false : { opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2 }}
          >
            <div className="sup-custom-grid">
              <label className="sup-custom-field">
                <span>Название</span>
                <input
                  type="text"
                  required
                  maxLength={80}
                  placeholder="Например, Витамин C"
                  value={customName}
                  onChange={(e) => setCustomName(e.target.value)}
                />
              </label>

              <div className="sup-custom-field">
                <label htmlFor={customAmountId}>Дозировка (только число)</label>
                <div className="sup-dose-inputs">
                  <input
                    id={customAmountId}
                    type="number"
                    inputMode="decimal"
                    min={0.1}
                    max={10000}
                    step="any"
                    required
                    aria-invalid={customAmountInvalid ? "true" : "false"}
                    aria-describedby={customAmountInvalid ? customAmountErrId : undefined}
                    className={customAmountInvalid ? "user-invalid-fallback" : undefined}
                    value={customAmount}
                    onKeyDown={(e) => {
                      if (["e", "E", "+", "-"].includes(e.key)) e.preventDefault();
                    }}
                    onChange={(e) => setCustomAmount(e.target.value)}
                    onBlur={() => setCustomAmountTouched(true)}
                  />
                  <select
                    aria-label="Единица дозировки"
                    value={customUnit}
                    onChange={(e) => setCustomUnit(e.target.value as SupplementDoseUnit)}
                  >
                    {SUPPLEMENT_DOSE_UNITS.map((u) => (
                      <option key={u} value={u}>
                        {u}
                      </option>
                    ))}
                  </select>
                </div>
                {customAmountInvalid ? (
                  <span id={customAmountErrId} className="sup-dose-error" role="alert">
                    Ошибка: введи число больше 0.
                  </span>
                ) : null}
              </div>

              <label className="sup-custom-field">
                <span>Когда принимать</span>
                <select
                  value={customTiming}
                  onChange={(e) => {
                    const next = e.target.value as SupplementTiming;
                    setCustomTiming(next);
                    const def = SUPPLEMENT_TIMINGS.find((t) => t.id === next)?.defaultTime ?? "";
                    setCustomTime(def);
                  }}
                >
                  {SUPPLEMENT_TIMINGS.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="sup-custom-field">
                <span>Время</span>
                <input
                  type="time"
                  value={customTime}
                  onChange={(e) => setCustomTime(e.target.value)}
                />
              </label>

              <label className="sup-custom-field">
                <span>Категория</span>
                <select
                  value={customCategory}
                  onChange={(e) => setCustomCategory(e.target.value as SupplementCategory)}
                >
                  {SUPPLEMENT_CATEGORIES.filter((c) => c.id !== "all").map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="sup-edit-days">
              <span className="sup-edit-label">Дни приёма</span>
              <div className="sup-day-toggles">
                {DAY_NAMES.map((dayLabel, wd) => {
                  const active = customDays.includes(wd);
                  return (
                    <button
                      key={dayLabel}
                      type="button"
                      aria-pressed={active}
                      className={`sup-day-toggle${active ? " active" : ""}`}
                      onClick={() =>
                        setCustomDays((prev) => {
                          if (prev.includes(wd)) {
                            return prev.length > 1 ? prev.filter((d) => d !== wd) : prev;
                          }
                          return [...prev, wd].sort((a, b) => a - b);
                        })
                      }
                    >
                      {dayLabel}
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <button type="submit" className="button primary">
                Добавить в мой стек
              </button>
            </div>
          </m.form>
        )}
      </AnimatePresence>

      {/* Интерактивная 7-дневная лента (можно кликнуть на любой день недели) */}
      {state.stack.length > 0 && (
        <section className="sup-week-strip" aria-label="Приём добавок за 7 дней">
          {summary.weekDays.map((day) => {
            const isToday = day.date === today;
            const isSelected = day.date === activeDate;
            const wd = DAY_NAMES[calendarWeekday(day.date)];
            return (
              <button
                key={day.date}
                type="button"
                className={`sup-week-day${isToday ? " is-today" : ""}${isSelected ? " is-selected" : ""}`}
                aria-pressed={isSelected}
                onClick={() => setActiveDate(day.date)}
                title={`${day.date}: ${day.count} из ${day.total}`}
              >
                <span className="sup-week-day-label">{wd}</span>
                <m.span
                  className={`sup-week-dot${day.done ? " done" : day.partial ? " partial" : ""}`}
                  initial={false}
                  animate={day.done && !reduced ? { scale: [0.92, 1.06, 1] } : { scale: 1 }}
                  transition={{ duration: 0.28 }}
                >
                  {day.done ? <Check size={14} aria-hidden="true" /> : day.count || "·"}
                </m.span>
              </button>
            );
          })}
        </section>
      )}

      {/* Переключатель режимов: Мой стек / План на день / План на неделю */}
      <div className="sup-mode-tabs" role="tablist" aria-label="Режим планирования добавок">
        <button
          type="button"
          role="tab"
          aria-selected={planTab === "stack"}
          className={`sup-mode-tab${planTab === "stack" ? " active" : ""}`}
          onClick={() => setPlanTab("stack")}
        >
          <Layers size={15} aria-hidden="true" />
          Мой стек ({ordered.length})
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={planTab === "day"}
          className={`sup-mode-tab${planTab === "day" ? " active" : ""}`}
          onClick={() => setPlanTab("day")}
        >
          <Clock size={15} aria-hidden="true" />
          План на день
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={planTab === "week"}
          className={`sup-mode-tab${planTab === "week" ? " active" : ""}`}
          onClick={() => setPlanTab("week")}
        >
          <CalendarDays size={15} aria-hidden="true" />
          План на неделю
        </button>
      </div>

      {/* Вкладка 1: Переработанный «Мой стек» с плавным drag-and-drop */}
      {planTab === "stack" && (
        <section className="sup-stack-panel" aria-label="Мой стек на сегодня">
          <div className="sup-stack-header">
            <div className="sup-stack-title-group">
              <h2>Мой стек</h2>
              <span className="sup-count-badge">{ordered.length}</span>
              {summary.total > 0 && (
                <span className="sup-progress-chip">
                  {summary.taken} / {summary.total} принято
                </span>
              )}
            </div>
            {ordered.length > 1 && (
              <span className="sup-drag-hint">
                <GripVertical size={13} aria-hidden="true" />
                Зажми и перетащи
              </span>
            )}
          </div>

          {ordered.length === 0 ? (
            <div className="sup-empty">
              <Pill size={24} className="text-accent" aria-hidden="true" />
              <p>Выбери ниже, что принимаешь — креатин, протеин, омега-3 — и отмечай приём одним нажатием.</p>
            </div>
          ) : (
            <Reorder.Group
              axis="y"
              as="div"
              values={orderedIds}
              onReorder={handleReorder}
              className="sup-stack-list"
            >
              {ordered.map((item, idx) => {
                const scheduledToday = SupplementsStore.isScheduledOn(item, activeDate);
                const taken = (state.logs[activeDate] ?? []).includes(item.id);
                const editing = editingId === item.id;
                return (
                  <DraggableSupplementCard
                    key={item.id}
                    item={item}
                    index={idx}
                    total={ordered.length}
                    taken={taken}
                    scheduledToday={scheduledToday}
                    editing={editing}
                    reduced={reduced}
                    onToggleTaken={() => onChange(SupplementsStore.toggleTaken(state, activeDate, item.id))}
                    onToggleEdit={() => setEditingId(editing ? null : item.id)}
                    onRemove={() => {
                      if (editing) setEditingId(null);
                      onChange(SupplementsStore.remove(state, item.id));
                    }}
                    onUpdate={(patch) => onChange(SupplementsStore.update(state, item.id, patch))}
                    onToggleDay={(wd) => onChange(SupplementsStore.toggleDay(state, item.id, wd))}
                    onMoveBy={(delta) => moveItemBy(idx, delta)}
                    onCancelKeyboardMove={(origIdx) => restoreItemIndex(item.id, origIdx)}
                    onDragStateChange={setIsDragging}
                    onAnnounce={setLiveNotice}
                  />
                );
              })}
            </Reorder.Group>
          )}
        </section>
      )}

      {/* Вкладка 2: План на день по слотам времени */}
      {planTab === "day" && (
        <section className="sup-stack-panel" aria-label="План приёма на день">
          <div className="sup-stack-header">
            <div className="sup-stack-title-group">
              <h2>Расписание на {activeDate === today ? "сегодня" : activeDate}</h2>
              <span className="sup-progress-chip">
                {summary.taken} / {summary.total}
              </span>
            </div>
            {activeDate !== today && (
              <button type="button" className="text-button" onClick={() => setActiveDate(today)}>
                Вернуться к сегодня
              </button>
            )}
          </div>

          {dayGroups.length === 0 ? (
            <div className="sup-empty">
              <Clock size={24} className="text-accent" aria-hidden="true" />
              <p>На этот день добавок не запланировано. Добавь их из каталога или настрой дни в «Плане на неделю».</p>
            </div>
          ) : (
            <div className="sup-day-timeline">
              {dayGroups.map(({ slot, items }) => {
                const doneCount = items.filter((i) => (state.logs[activeDate] ?? []).includes(i.id)).length;
                return (
                  <div key={slot.id} className="sup-slot-block">
                    <div className="sup-slot-head">
                      <span className="sup-slot-title">
                        <Clock size={14} aria-hidden="true" />
                        {slot.label}
                      </span>
                      <span className="sup-slot-stat">
                        {doneCount} / {items.length}
                      </span>
                    </div>
                    <div className="sup-slot-items">
                      {items.map((item) => {
                        const taken = (state.logs[activeDate] ?? []).includes(item.id);
                        return (
                          <button
                            key={item.id}
                            type="button"
                            className={`sup-timeline-row${taken ? " is-taken" : ""}`}
                            style={{ "--sup-accent": item.accent } as React.CSSProperties}
                            aria-pressed={taken}
                            onClick={() => onChange(SupplementsStore.toggleTaken(state, activeDate, item.id))}
                          >
                            <span className="sup-timeline-check" aria-hidden="true">
                              <Check size={15} />
                            </span>
                            <span className="sup-timeline-copy">
                              <b>{item.name}</b>
                              <small>{item.dose}</small>
                            </span>
                            {item.reminderTime ? (
                              <span className="sup-pill">{item.reminderTime}</span>
                            ) : null}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* Вкладка 3: План на неделю (матрица Пн–Вс) */}
      {planTab === "week" && (
        <section className="sup-stack-panel" aria-label="План приёма на неделю">
          <div className="sup-stack-header">
            <div className="sup-stack-title-group">
              <h2>План на неделю</h2>
              <span className="sup-progress-chip">Нажми на день, чтобы включить или выключить</span>
            </div>
          </div>

          {ordered.length === 0 ? (
            <div className="sup-empty">
              <CalendarDays size={24} className="text-accent" aria-hidden="true" />
              <p>Добавь добавки из каталога ниже, чтобы составить расписание по дням недели.</p>
            </div>
          ) : (
            <div className="sup-week-planner">
              <div className="sup-wp-head">
                <span>Добавка</span>
                {DAY_NAMES.map((d) => (
                  <span key={d} className="sup-wp-day-col">
                    {d}
                  </span>
                ))}
              </div>
              {ordered.map((item) => {
                const days = SupplementsStore.getDays(item);
                return (
                  <div
                    key={item.id}
                    className="sup-wp-row"
                    style={{ "--sup-accent": item.accent } as React.CSSProperties}
                  >
                    <div className="sup-wp-name">
                      <b>{item.name}</b>
                      <small>
                        {item.dose} · {timingLabel(item.timing)}
                      </small>
                    </div>
                    {DAY_NAMES.map((dayLabel, wd) => {
                      const active = days.includes(wd);
                      return (
                        <button
                          key={dayLabel}
                          type="button"
                          className={`sup-wp-cell${active ? " is-active" : ""}`}
                          aria-pressed={active}
                          aria-label={`${item.name} — ${dayLabel}: ${active ? "запланировано" : "перерыв"}`}
                          onClick={() => onChange(SupplementsStore.toggleDay(state, item.id, wd))}
                        >
                          {active ? <Check size={14} aria-hidden="true" /> : "—"}
                        </button>
                      );
                    })}
                  </div>
                );
              })}
              <div className="sup-wp-foot">
                <span>Всего в день</span>
                {DAY_NAMES.map((d, wd) => {
                  const countForDay = ordered.filter((i) => SupplementsStore.getDays(i).includes(wd)).length;
                  return (
                    <span key={d} className="sup-wp-day-total">
                      {countForDay}
                    </span>
                  );
                })}
              </div>
            </div>
          )}
        </section>
      )}

      {/* Каталог популярных добавок */}
      <section className="sup-section" aria-label="Каталог добавок">
        <div className="sup-section-head">
          <h2>Выбрать добавки</h2>
        </div>

        <div className="sup-cat-tabs" role="tablist" aria-label="Категории добавок">
          {SUPPLEMENT_CATEGORIES.map((cat) => (
            <button
              key={cat.id}
              type="button"
              role="tab"
              aria-selected={category === cat.id}
              className={`sup-cat-tab${category === cat.id ? " active" : ""}`}
              onClick={() => setCategory(cat.id)}
            >
              {cat.label}
            </button>
          ))}
        </div>

        <div className="sup-catalog-grid">
          {filteredCatalog.map((item) => {
            const added = inStackCatalogIds.has(item.id);
            return (
              <m.article
                key={item.id}
                className={`sup-catalog-card${added ? " in-stack" : ""}`}
                style={{ "--sup-accent": item.accent } as React.CSSProperties}
                whileHover={reduced ? undefined : { y: -2 }}
                transition={{ duration: 0.16 }}
              >
                <div className="sup-catalog-top">
                  <span className="sup-catalog-dot" aria-hidden="true" />
                  <div className="sup-catalog-name">
                    <b>{item.name}</b>
                    <small>{item.tagline}</small>
                  </div>
                </div>
                <div className="sup-catalog-foot">
                  <span className="sup-pill">
                    {item.defaultDose} · {timingLabel(item.defaultTiming)}
                  </span>
                  <m.button
                    type="button"
                    className={`sup-add-btn${added ? " added" : ""}`}
                    whileTap={reduced ? undefined : { scale: 0.95 }}
                    onClick={() => {
                      if (added) {
                        const existing = state.stack.find((s) => s.catalogId === item.id);
                        if (existing) onChange(SupplementsStore.remove(state, existing.id));
                      } else {
                        onChange(SupplementsStore.addFromCatalog(state, item.id));
                      }
                    }}
                  >
                    {added ? <Check size={15} aria-hidden="true" /> : <Plus size={15} aria-hidden="true" />}
                    {added ? "В стеке" : "Добавить"}
                  </m.button>
                </div>
              </m.article>
            );
          })}
        </div>
      </section>
    </div>
  );
}
