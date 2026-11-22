import { useMemo, useState } from "react";
import { AnimatePresence, m, useReducedMotion } from "motion/react";
import {
  Check,
  CheckCheck,
  Clock,
  Flame,
  Pencil,
  Pill,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import {
  SUPPLEMENT_CATALOG,
  SUPPLEMENT_CATEGORIES,
  SUPPLEMENT_TIMINGS,
  SupplementsStore,
  type SupplementCategory,
  type SupplementTiming,
  type SupplementsState,
} from "../domain/Supplements";
import { DAY_NAMES, calendarWeekday } from "../domain/TrainingProgram";
import { quantityWord } from "../lib/quantity";
import "../styles/supplements.css";

const RING_RADIUS = 46;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

const SPRING = { type: "spring" as const, stiffness: 420, damping: 32 };

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
  const [category, setCategory] = useState<"all" | SupplementCategory>("all");
  const [showCustom, setShowCustom] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [customName, setCustomName] = useState("");
  const [customDose, setCustomDose] = useState("5 г");
  const [customTiming, setCustomTiming] = useState<SupplementTiming>("morning");
  const [customCategory, setCustomCategory] = useState<SupplementCategory>("base");

  const summary = useMemo(() => SupplementsStore.summary(state, today), [state, today]);
  const ordered = useMemo(() => SupplementsStore.orderedStack(state.stack), [state.stack]);
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

  const timingLabel = (timing: SupplementTiming) =>
    SUPPLEMENT_TIMINGS.find((t) => t.id === timing)?.short ?? "Любое";

  const strokeOffset = RING_CIRCUMFERENCE * (1 - summary.ratio);
  const allTaken = summary.total > 0 && summary.taken >= summary.total;

  const submitCustom = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customName.trim()) return;
    onChange(
      SupplementsStore.addCustom(state, {
        name: customName,
        dose: customDose,
        timing: customTiming,
        category: customCategory,
      }),
    );
    setCustomName("");
    setCustomDose("5 г");
    setShowCustom(false);
  };

  return (
    <div className="supplements-screen">
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
            Ежедневный стек
          </span>
          <h1>Добавки</h1>
          <div className="sup-hero-meta">
            <span>
              Сегодня:{" "}
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
          </div>
          <div className="sup-hero-actions">
            {summary.total > 0 && (
              <m.button
                type="button"
                className={`button ${allTaken ? "secondary" : "primary"}`}
                whileTap={reduced ? undefined : { scale: 0.97 }}
                onClick={() => onChange(SupplementsStore.markAllTaken(state, today, !allTaken))}
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
                  placeholder="Например, Витамин C или BCAA"
                  value={customName}
                  onChange={(e) => setCustomName(e.target.value)}
                />
              </label>
              <label className="sup-custom-field">
                <span>Дозировка</span>
                <input
                  type="text"
                  maxLength={40}
                  placeholder="5 г / 1 капс."
                  value={customDose}
                  onChange={(e) => setCustomDose(e.target.value)}
                />
              </label>
              <label className="sup-custom-field">
                <span>Когда принимать</span>
                <select
                  value={customTiming}
                  onChange={(e) => setCustomTiming(e.target.value as SupplementTiming)}
                >
                  {SUPPLEMENT_TIMINGS.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.label}
                    </option>
                  ))}
                </select>
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
            <div>
              <button type="submit" className="button primary">
                Добавить в мой стек
              </button>
            </div>
          </m.form>
        )}
      </AnimatePresence>

      {/* 7-дневная лента приверженности */}
      {summary.total > 0 && (
        <section className="sup-week-strip" aria-label="Приём добавок за 7 дней">
          {summary.weekDays.map((day) => {
            const isToday = day.date === today;
            const wd = DAY_NAMES[calendarWeekday(day.date)];
            return (
              <div key={day.date} className={`sup-week-day${isToday ? " is-today" : ""}`}>
                <span className="sup-week-day-label">{wd}</span>
                <m.span
                  className={`sup-week-dot${day.done ? " done" : day.partial ? " partial" : ""}`}
                  initial={false}
                  animate={day.done && !reduced ? { scale: [0.92, 1.06, 1] } : { scale: 1 }}
                  transition={{ duration: 0.28 }}
                  title={`${day.date}: ${day.count} из ${day.total}`}
                >
                  {day.done ? <Check size={14} aria-hidden="true" /> : day.count || "·"}
                </m.span>
              </div>
            );
          })}
        </section>
      )}

      {/* Мой ежедневный стек */}
      <section className="sup-section" aria-label="Мой стек на сегодня">
        <div className="sup-section-head">
          <h2>Мой стек ({ordered.length})</h2>
        </div>

        {ordered.length === 0 ? (
          <div className="sup-empty">
            <Pill size={24} className="text-accent" aria-hidden="true" />
            <p>Выбери ниже, что пьёшь каждый день — креатин, протеин, гейнер, омега-3 — и отмечай приём одним нажатием.</p>
          </div>
        ) : (
          <div className="sup-stack-grid">
            <AnimatePresence initial={false}>
              {ordered.map((item, idx) => {
                const taken = summary.takenIds.has(item.id);
                const editing = editingId === item.id;
                return (
                  <m.article
                    key={item.id}
                    layout={!reduced}
                    className={`sup-card${taken ? " is-taken" : ""}`}
                    style={{ "--sup-accent": item.accent } as React.CSSProperties}
                    initial={reduced ? false : { opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={reduced ? undefined : { opacity: 0, scale: 0.96 }}
                    transition={reduced ? { duration: 0 } : { ...SPRING, delay: Math.min(idx * 0.03, 0.15) }}
                  >
                    <m.button
                      type="button"
                      className="sup-check-btn"
                      aria-pressed={taken}
                      aria-label={taken ? `Снять отметку: ${item.name}` : `Отметить принятым: ${item.name}`}
                      whileTap={reduced ? undefined : { scale: 0.9 }}
                      onClick={() => onChange(SupplementsStore.toggleTaken(state, today, item.id))}
                    >
                      <Check size={19} aria-hidden="true" />
                    </m.button>

                    <div className="sup-card-body">
                      <span className="sup-card-title">{item.name}</span>
                      <div className="sup-card-sub">
                        <span className="sup-pill">{item.dose}</span>
                        <span className="sup-pill">
                          <Clock size={11} aria-hidden="true" />
                          {timingLabel(item.timing)}
                        </span>
                      </div>
                    </div>

                    <div className="sup-card-actions">
                      <button
                        type="button"
                        className="sup-icon-btn"
                        aria-label={`Настроить ${item.name}`}
                        aria-expanded={editing}
                        onClick={() => setEditingId(editing ? null : item.id)}
                      >
                        <Pencil size={15} aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        className="sup-icon-btn danger"
                        aria-label={`Убрать ${item.name} из стека`}
                        onClick={() => {
                          if (editing) setEditingId(null);
                          onChange(SupplementsStore.remove(state, item.id));
                        }}
                      >
                        <Trash2 size={15} aria-hidden="true" />
                      </button>
                    </div>

                    {editing && (
                      <div className="sup-edit-row">
                        <input
                          type="text"
                          aria-label={`Дозировка для ${item.name}`}
                          value={item.dose}
                          onChange={(e) =>
                            onChange(SupplementsStore.update(state, item.id, { dose: e.target.value }))
                          }
                        />
                        <select
                          aria-label={`Время приёма для ${item.name}`}
                          value={item.timing}
                          onChange={(e) =>
                            onChange(
                              SupplementsStore.update(state, item.id, {
                                timing: e.target.value as SupplementTiming,
                              }),
                            )
                          }
                        >
                          {SUPPLEMENT_TIMINGS.map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.label}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          className="button secondary"
                          onClick={() => setEditingId(null)}
                        >
                          Готово
                        </button>
                      </div>
                    )}
                  </m.article>
                );
              })}
            </AnimatePresence>
          </div>
        )}
      </section>

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
