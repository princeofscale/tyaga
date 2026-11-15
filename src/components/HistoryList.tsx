import { useEffect, useMemo, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { ArrowUp, Search } from "lucide-react";
import type { Workout } from "../lib/types";
import { HistoryFilter, type HistoryQuery } from "../domain/HistoryFilter";
import { quantity } from "../lib/quantity";

/**
 * «История» на сотни тренировок: заголовки месяцев с годом, отбор по периоду и типу, поиск по тексту и по месяцу,
 * переход к месяцу и «Наверх». Карточки каждого месяца рисуются браузером лениво (`content-visibility`), поэтому
 * длинный список остаётся отзывчивым.
 */
export default function HistoryList({
  workouts,
  entryName,
  renderItem,
  actions,
  empty,
}: {
  workouts: Workout[];
  entryName: (entry: Workout["exercises"][number]) => string;
  renderItem: (workout: Workout) => ReactNode;
  actions: ReactNode;
  empty: ReactNode;
}) {
  const [query, setQuery] = useState<HistoryQuery>(HistoryFilter.EMPTY);
  const [range, setRange] = useState(false);
  const [showTop, setShowTop] = useState(false);
  // R06-REQ04: у месяцев, не попавших на экран, высота — лишь оценка (`content-visibility`). Переход к месяцу по оценке
  // промахивался на 1–2 экрана, поэтому перед переходом месяцы рисуются целиком и высоты становятся настоящими.
  const [exact, setExact] = useState(false);
  const sorted = useMemo(
    () => [...workouts].sort((a, b) => b.date.localeCompare(a.date)),
    [workouts],
  );
  const months = useMemo(() => HistoryFilter.months(sorted), [sorted]);
  const types = useMemo(() => HistoryFilter.types(sorted), [sorted]);
  const found = useMemo(() => HistoryFilter.filter(sorted, query, entryName), [sorted, query, entryName]);
  const groups = useMemo(() => HistoryFilter.groups(found), [found]);
  const active = HistoryFilter.isActive(query);
  useEffect(() => {
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setShowTop(window.scrollY > 700));
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
    };
  }, []);
  const set = (patch: Partial<HistoryQuery>) => setQuery((q) => ({ ...q, ...patch }));
  const reset = () => {
    setQuery(HistoryFilter.EMPTY);
    setRange(false);
  };
  return (
    <>
      <div className="history-toolbar">
        <div className="search-field">
          <Search size={18} />
          <input
            aria-label="Поиск по истории"
            placeholder="Название, упражнение или месяц…"
            value={query.text}
            onChange={(e) => set({ text: e.target.value })}
          />
        </div>
        {actions}
      </div>
      {sorted.length ? (
        <div className="history-filters" role="group" aria-label="Отбор тренировок">
          <label>
            <span>Период</span>
            <select
              aria-label="Период"
              value={range ? "range" : query.month}
              onChange={(e) => {
                const value = e.target.value;
                if (value === "range") {
                  setRange(true);
                  set({ month: "all" });
                } else {
                  setRange(false);
                  set({ month: value, from: "", to: "" });
                }
              }}
            >
              <option value="all">Весь период</option>
              <option value="range">Свой диапазон дат…</option>
              {months.map((m) => (
                <option key={m.key} value={m.key}>
                  {m.label} · {m.count}
                </option>
              ))}
            </select>
          </label>
          {range ? (
            <>
              <label>
                <span>С даты</span>
                <input type="date" aria-label="С даты" value={query.from} max={query.to || undefined} onChange={(e) => set({ from: e.target.value })} />
              </label>
              <label>
                <span>По дату</span>
                <input type="date" aria-label="По дату" value={query.to} min={query.from || undefined} onChange={(e) => set({ to: e.target.value })} />
              </label>
            </>
          ) : null}
          <label>
            <span>Тип</span>
            <select aria-label="Тип тренировки" value={query.type} onChange={(e) => set({ type: e.target.value })}>
              <option value="all">Все типы</option>
              {types.map((t) => (
                <option key={t.name} value={t.name}>
                  {t.name} · {t.count}
                </option>
              ))}
            </select>
          </label>
          {groups.length > 1 ? (
            <label>
              <span>К месяцу</span>
              <select
                aria-label="Перейти к месяцу"
                value=""
                onChange={(e) => {
                  const key = e.target.value;
                  flushSync(() => setExact(true));
                  document.getElementById(`history-month-${key}`)?.scrollIntoView({ block: "start" });
                }}
              >
                <option value="">Перейти к месяцу…</option>
                {groups.map((g) => (
                  <option key={g.key} value={g.key}>
                    {g.label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>
      ) : null}
      {sorted.length ? (
        <p className="history-found" role="status">
          {active ? `Найдено ${found.length}` : quantity(sorted.length, "тренировка", "тренировки", "тренировок")}
          {active ? ` из ${sorted.length}` : ""}
          {active ? (
            <button type="button" className="text-button" onClick={reset}>
              Сбросить отбор
            </button>
          ) : null}
        </p>
      ) : null}
      <div className={`panel history-panel${exact ? " history-exact" : ""}`}>
        {groups.map((group) => (
          <section className="history-month" key={group.key} id={`history-month-${group.key}`} aria-label={group.label}>
            <h2 className="history-month-title">
              {group.label}
              <small>{quantity(group.items.length, "тренировка", "тренировки", "тренировок")}</small>
            </h2>
            {group.items.map(renderItem)}
          </section>
        ))}
        {!sorted.length ? empty : null}
        {sorted.length && !found.length ? (
          <div className="no-results" role="status">
            <p>Таких тренировок нет.</p>
            <p className="tiny">
              Попробуй день («20 янв», «20.01.2026»), месяц с годом («октябрь 2026»), название тренировки («Ноги») или выбери период и тип выше.
            </p>
            <button type="button" className="button secondary" onClick={reset}>
              Сбросить отбор
            </button>
          </div>
        ) : null}
      </div>
      {showTop ? (
        <button type="button" className="history-top" aria-label="Наверх" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}>
          <ArrowUp size={20} />
        </button>
      ) : null}
    </>
  );
}
