import { useEffect, useMemo, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { useReducedMotion } from "motion/react";
import { ArrowUp, Search, X } from "lucide-react";
import type { Workout } from "../lib/types";
import { HistoryFilter, type HistoryQuery } from "../domain/HistoryFilter";
import { HistoryInsights } from "../domain/HistoryInsights";
import { DateText } from "../domain/DateText";
import { VolumeLabel } from "../domain/VolumeLabel";
import { quantity, quantityWord } from "../lib/quantity";

const IN_MONTH = ["январе", "феврале", "марте", "апреле", "мае", "июне", "июле", "августе", "сентябре", "октябре", "ноябре", "декабре"];
const previousMonth = (key: string) => {
  const [y, m] = key.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
};

/** Короткая сводка над «Историей»: всего, текущий месяц, время и рекорды месяца. Только факты из журнала. */
export function HistoryStats({ workouts, today }: { workouts: Workout[]; today: string }) {
  const stats = useMemo(() => {
    const month = DateText.monthKey(today);
    const inMonth = workouts.filter((w) => DateText.monthKey(w.date) === month);
    const before = workouts.filter((w) => DateText.monthKey(w.date) === previousMonth(month)).length;
    const records = HistoryInsights.records(workouts);
    const recordNames = inMonth.flatMap((w) => records.get(w.id) ?? []);
    const minutes = HistoryInsights.totals(inMonth).minutes;
    const first = workouts.reduce<string | null>((min, w) => (!min || w.date < min ? w.date : min), null);
    return {
      monthName: IN_MONTH[+month.slice(5, 7) - 1] ?? "",
      previousName: DateText.NOMINATIVE[+previousMonth(month).slice(5, 7) - 1]?.toLowerCase() ?? "",
      count: inMonth.length,
      before,
      minutes,
      average: inMonth.length ? Math.round(minutes / inMonth.length) : 0,
      records: recordNames.length,
      recordNames: [...new Set(recordNames)],
      first,
    };
  }, [workouts, today]);
  if (!workouts.length) return null;
  return (
    <section className="history-stats" aria-label="Сводка истории">
      <div className="history-stat">
        <span>Всего</span>
        <b>{workouts.length}</b>
        <small>{stats.first ? `с ${DateText.monthShort(stats.first)} ${stats.first.slice(0, 4)}` : quantityWord(workouts.length, "тренировка", "тренировки", "тренировок")}</small>
      </div>
      <div className="history-stat">
        <span>В {stats.monthName}</span>
        <b>{stats.count}</b>
        <small>{stats.previousName} — {stats.before}</small>
      </div>
      <div className="history-stat">
        <span>Время</span>
        <b>{HistoryInsights.hours(stats.minutes)}</b>
        <small>{stats.average ? `≈ ${stats.average} мин за раз` : "в этом месяце"}</small>
      </div>
      <div className={`history-stat${stats.records ? " is-record" : ""}`}>
        <span>Рекорды</span>
        <b>{stats.records}</b>
        <small title={stats.recordNames.join(", ") || undefined}>
          {stats.records ? stats.recordNames.join(", ") : "расчётный 1ПМ"}
        </small>
      </div>
    </section>
  );
}

/**
 * «История» на сотни тренировок: заголовки месяцев с годом и итогами, отбор по периоду и типу, поиск по тексту
 * и по месяцу, переход к месяцу и «Наверх». Карточки каждого месяца рисуются браузером лениво
 * (`content-visibility`), поэтому длинный список остаётся отзывчивым.
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
  renderItem: (workout: Workout, records: string[]) => ReactNode;
  actions: ReactNode;
  empty: ReactNode;
}) {
  const [query, setQuery] = useState<HistoryQuery>(HistoryFilter.EMPTY);
  const [range, setRange] = useState(false);
  const [showTop, setShowTop] = useState(false);
  const reducedMotion = useReducedMotion();
  // R06-REQ04: у месяцев, не попавших на экран, высота — лишь оценка (`content-visibility`). Переход к месяцу по оценке
  // промахивался на 1–2 экрана, поэтому перед переходом месяцы рисуются целиком и высоты становятся настоящими.
  const [exact, setExact] = useState(false);
  // Новые первыми; две тренировки одного дня — по моменту записи, а не как пришли с сервера.
  const sorted = useMemo(() => HistoryInsights.newestFirst(workouts), [workouts]);
  const records = useMemo(() => HistoryInsights.records(workouts), [workouts]);
  const months = useMemo(() => HistoryFilter.months(sorted), [sorted]);
  const types = useMemo(() => HistoryFilter.types(sorted), [sorted]);
  const found = useMemo(() => HistoryFilter.filter(sorted, query, entryName), [sorted, query, entryName]);
  const groups = useMemo(
    () => HistoryFilter.groups(found).map((g) => ({ ...g, totals: HistoryInsights.totals(g.items) })),
    [found],
  );
  const active = HistoryFilter.isActive(query) || range;
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
  // Выбранный месяц или тип пропали из журнала (удаление, отмена импорта) — отбор не должен застревать на пустоте.
  useEffect(() => {
    if (query.month !== "all" && !months.some((m) => m.key === query.month)) setQuery((q) => ({ ...q, month: "all" }));
    if (query.type !== "all" && !types.some((t) => t.name === query.type)) setQuery((q) => ({ ...q, type: "all" }));
  }, [months, types, query.month, query.type]);
  const set = (patch: Partial<HistoryQuery>) => setQuery((q) => ({ ...q, ...patch }));
  const reset = () => {
    setQuery(HistoryFilter.EMPTY);
    setRange(false);
  };
  return (
    <>
      <div className="history-toolbar">
        <div className="search-field">
          <Search size={18} aria-hidden="true" />
          <input
            type="search"
            aria-label="Поиск по истории"
            placeholder="Название, упражнение или месяц…"
            value={query.text}
            onChange={(e) => set({ text: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Escape" && query.text) {
                e.preventDefault();
                set({ text: "" });
              }
            }}
          />
          {query.text ? (
            <button type="button" className="search-clear" aria-label="Очистить поиск" onClick={() => set({ text: "" })}>
              <X size={16} />
            </button>
          ) : null}
        </div>
        <div className="history-actions">{actions}</div>
      </div>
      {sorted.length ? (
        <div className={`history-filters${range ? " has-range" : ""}`} role="group" aria-label="Отбор тренировок">
          <label className={query.month !== "all" || range ? "is-set" : ""}>
            <span className="history-filter-label">Период</span>
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
          <label className={query.type !== "all" ? "is-set" : ""}>
            <span className="history-filter-label">Тип</span>
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
            <label className="history-jump">
              <span className="history-filter-label">К месяцу</span>
              <select
                aria-label="Перейти к месяцу"
                value=""
                onChange={(e) => {
                  const key = e.target.value;
                  if (!key) return;
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
          {range ? (
            <div className="history-range">
              <label>
                <span>С даты</span>
                <input type="date" aria-label="С даты" value={query.from} max={query.to || undefined} onChange={(e) => set({ from: e.target.value })} />
              </label>
              <label>
                <span>По дату</span>
                <input type="date" aria-label="По дату" value={query.to} min={query.from || undefined} onChange={(e) => set({ to: e.target.value })} />
              </label>
            </div>
          ) : null}
        </div>
      ) : null}
      {sorted.length ? (
        <div className="history-found">
          <span role="status">
            {active ? `Найдено ${found.length} из ${sorted.length}` : quantity(sorted.length, "тренировка", "тренировки", "тренировок")}
          </span>
          {active ? (
            <button type="button" className="text-button" onClick={reset}>
              Сбросить отбор
            </button>
          ) : null}
        </div>
      ) : null}
      <div className={`panel history-panel${exact ? " history-exact" : ""}`}>
        {groups.map((group) => (
          <section className="history-month" key={group.key} id={`history-month-${group.key}`} aria-label={group.label}>
            <header className="history-month-head">
              <h2 className="history-month-title">
                {group.label}
                <small>{quantity(group.items.length, "тренировка", "тренировки", "тренировок")}</small>
              </h2>
              <p className="history-month-meta" aria-label={`Итоги: ${group.label}`}>
                {group.totals.tonnage > 0 ? (
                  <span title="Свободные веса, включая разминку">{VolumeLabel.short(group.totals.tonnage)}</span>
                ) : null}
                <span>{HistoryInsights.duration(group.totals.minutes)}</span>
                <span>{group.totals.sets} подх.</span>
              </p>
            </header>
            <div className="history-month-list">
              {group.items.map((w) => renderItem(w, records.get(w.id) ?? []))}
            </div>
          </section>
        ))}
        {!sorted.length ? empty : null}
        {sorted.length && !found.length ? (
          <div className="no-results">
            <Search size={28} aria-hidden="true" />
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
        <button type="button" className="history-top" aria-label="Наверх" onClick={() => window.scrollTo({ top: 0, behavior: reducedMotion ? "instant" : "smooth" })}>
          <ArrowUp size={20} />
        </button>
      ) : null}
    </>
  );
}
