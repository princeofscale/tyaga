import { quantity } from "../lib/quantity";
import { DecimalInput } from "../domain/DecimalInput";
import { useBodyweight } from "../state/bodyweightStore";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useRef,
  useId,
  type FormEvent,
} from "react";
import { m, useReducedMotion } from "motion/react";
import {
  Activity,
  Check,
  Download,
  Pencil,
  Plus,
  RefreshCw,
  Scale,
  Target,
  Trash2,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import {
  BodyweightTracker,
  type BodyweightEntry,
} from "../domain/BodyweightTracker";
import { addCalendarDays, browserTimeZone, localDate } from "../lib/calendar";
import { dateLabel, fmt } from "../lib/model";
import { saveFile } from "../lib/saveFile";
import { cloudState, syncCloud } from "../device/cloudSync";
import ProgressChart from "./ProgressChart";
import "../styles/progress.css";
import { DateText } from "../domain/DateText";

/** Account-scoped weighing journal, reused by Progress and the quick tool dialog. */
export function BodyweightModal({
  timeZone = browserTimeZone(),
}: {
  accountId: string;
  timeZone?: string;
  onClose?: () => void;
}) {
  const journal = useBodyweight();
  const tracker = journal.tracker;
  const weightInputId = useId();
  const weightInputRef = useRef<HTMLInputElement>(null);
  const [, refreshSync] = useState(0);
  const [entries, setEntries] = useState(() => tracker.getEntries());
  const [goal, setGoal] = useState(() => tracker.getGoal());
  const [weight, setWeight] = useState(
    () => (entries.at(-1) ? DecimalInput.format(entries.at(-1)!.weightKg, 1) : ""),
  );
  const today = localDate(new Date(), timeZone);
  const [date, setDate] = useState(today);
  const [note, setNote] = useState("");
  const [goalInput, setGoalInput] = useState(
    () => (goal.targetWeightKg != null ? DecimalInput.format(goal.targetWeightKg, 1) : ""),
  );
  const [goalEditor, setGoalEditor] = useState(false);
  const [period, setPeriod] = useState(90);
  const [error, setError] = useState(() => tracker.storageIssue());
  const [notice, setNotice] = useState("");
  const [deleting, setDeleting] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  const reduced = useReducedMotion();

  useEffect(() => {
    const latest = journal.tracker.getEntries();
    setWeight(latest.at(-1) ? DecimalInput.format(latest.at(-1)!.weightKg, 1) : "");
    setDate(localDate(new Date(), timeZone));
    setNote("");
    setGoalInput(
      journal.tracker.getGoal().targetWeightKg !== undefined &&
        journal.tracker.getGoal().targetWeightKg !== null
        ? DecimalInput.format(journal.tracker.getGoal().targetWeightKg!, 1)
        : "",
    );
    setGoalEditor(false);
    setDeleting(null);
    setError(journal.tracker.storageIssue());
    setNotice("");
  }, [journal, timeZone]);

  const reload = useCallback(() => {
    setEntries(tracker.getEntries());
    setGoal(tracker.getGoal());
  }, [tracker]);

  useEffect(() => {
    const changed = () => {
      reload();
      refreshSync((n) => n + 1);
    };
    const off = journal.subscribe(changed);
    changed();
    return off;
  }, [journal, reload]);

  const stats = useMemo(() => {
    void entries;
    return tracker.getStats();
  }, [entries, tracker]);
  const rate = useMemo(() => {
    void entries;
    return tracker.getWeeklyRate();
  }, [entries, tracker]);
  const neatVerdict = useMemo(() => {
    void entries;
    void goal;
    return tracker.getNeatVerdict(today);
  }, [entries, goal, tracker, today]);
  const trend = useMemo(() => {
    void entries;
    return tracker.getTrend();
  }, [entries, tracker]);
  const points = trend
    .filter((p) => !period || p.date >= addCalendarDays(today, -period + 1))
    .map((p) => ({
      id: p.date,
      date: p.date,
      value: p.weightKg,
      trend: p.emaKg,
      note: p.note,
    }));

  const attempt = async (action: () => void, message: string) => {
    setError("");
    setNotice("");
    try {
      await journal.change(action);
      reload();
      setNotice(message);
      if (import.meta.env.MODE !== "device" || cloudState()) void journal.sync();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось сохранить");
    }
  };

  const save = (e: FormEvent) => {
    e.preventDefault();
    void attempt(() => {
      const kg = BodyweightTracker.parseWeight(weight);
      tracker.addEntry(kg, date, note);
      setWeight(DecimalInput.format(kg, 1));
      setNote("");
    }, "Замер сохранён");
  };

  const edit = (entry: BodyweightEntry) => {
    setWeight(DecimalInput.format(entry.weightKg, 1));
    setDate(entry.date);
    setNote(entry.note ?? "");
    weightInputRef.current?.focus();
  };

  const step = (delta: number) => {
    try {
      setWeight(DecimalInput.format(BodyweightTracker.step(weight, delta), 1));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const syncStatusText = journal.syncing
    ? "Синхронизация…"
    : import.meta.env.MODE === "device" && !cloudState()
      ? "На устройстве"
      : journal.conflicts.length
        ? "Конфликт замеров"
        : journal.pendingCount
          ? `Ждёт отправки: ${journal.pendingCount}`
          : journal.lastSyncedAt
            ? "Синхронизировано"
            : journal.error
              ? "Нет связи"
              : "Аккаунт";

  const remainingToGoal =
    stats && goal.targetWeightKg !== null
      ? Math.round((goal.targetWeightKg - stats.currentKg) * 10) / 10
      : null;

  return (
    <m.div
      className="bw-screen weight-journal"
      initial={reduced ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.24 }}
    >
      {/* Hero-карточка в стиле ИИ-анализа */}
      <section className="bw-hero" aria-label="Сводка веса тела">
        <div className="bw-hero-top">
          <span className="tel-eyebrow-pill">
            <Scale size={14} aria-hidden="true" />
            Вес тела
          </span>
          <div className="bw-sync-cluster" aria-label="Сохранение веса">
            <span className="bw-sync-status" role="status">
              {syncStatusText}
            </span>
            <button
              type="button"
              className="bw-sync-icon"
              disabled={journal.syncing}
              aria-label="Синхронизировать"
              title="Синхронизировать"
              onClick={async () => {
                await journal.sync();
                if (import.meta.env.MODE === "device") {
                  await syncCloud();
                  await journal.sync();
                }
              }}
            >
              <RefreshCw size={15} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="bw-sync-icon"
              aria-label="Экспорт веса"
              title="Экспорт веса в JSON"
              onClick={() =>
                void saveFile(
                  "tyaga-bodyweight.json",
                  JSON.stringify(journal.export(), null, 2),
                  "application/json",
                )
              }
            >
              <Download size={15} aria-hidden="true" />
            </button>
          </div>
        </div>

        <div className="bw-hero-main">
          <div>
            <div className="bw-hero-val">
              <strong>{stats ? fmt(stats.currentKg) : "—"}</strong>
              {stats ? <small>кг</small> : null}
            </div>
            <span className="tel-metric-sub">
              {entries.length
                ? `Последний замер: ${dateLabel(entries.at(-1)!.date, true)}`
                : "Запиши первый вес, чтобы отслеживать тренд"}
            </span>
          </div>

          <div className="bw-goal-chip">
            <Target size={15} aria-hidden="true" />
            <span>
              {goal.targetWeightKg === null ? (
                "Цель не задана"
              ) : (
                <>
                  Цель: <b>{fmt(goal.targetWeightKg)} кг</b>
                  {remainingToGoal !== null && remainingToGoal !== 0
                    ? ` (${remainingToGoal > 0 ? "+" : ""}${fmt(remainingToGoal)} кг)`
                    : remainingToGoal === 0
                      ? " · достигнута"
                      : ""}
                </>
              )}
            </span>
            <button
              type="button"
              className="text-button"
              onClick={() => {
                setGoalInput(goal.targetWeightKg?.toString() ?? "");
                setGoalEditor((v) => !v);
              }}
            >
              {goal.targetWeightKg === null ? "Задать" : "Изменить"}
            </button>
          </div>
        </div>

        {goalEditor && (
          <form
            className="weight-goal-form"
            onSubmit={(e) => {
              e.preventDefault();
              void attempt(() => {
                tracker.setGoal(BodyweightTracker.parseWeight(goalInput));
                setGoalEditor(false);
              }, "Цель сохранена");
            }}
          >
            <label>
              Целевой вес, кг
              <input
                aria-label="Целевой вес, кг"
                inputMode="decimal"
                value={goalInput}
                onChange={(e) => setGoalInput(e.target.value)}
                required
              />
            </label>
            <button className="button primary" type="submit">
              Сохранить
            </button>
            {goal.targetWeightKg !== null && (
              <button
                type="button"
                className="text-button"
                onClick={() =>
                  void attempt(() => {
                    tracker.setGoal(null);
                    setGoalEditor(false);
                  }, "Цель убрана")
                }
              >
                Убрать
              </button>
            )}
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
          </form>
        )}

        {journal.error && !error && (
          <p className="form-error" role="alert">
            {journal.error} Изменения на устройстве сохранены.
          </p>
        )}

        {journal.conflicts.map((key) => (
          <div className="weight-conflict" key={key}>
            <b>
              {key === "goal" ? "Цель по весу" : `Взвешивание ${key.slice(7)}`} изменено на другом устройстве.
            </b>
            <button
              type="button"
              className="button secondary"
              onClick={() => void attempt(() => journal.resolve(key, false), "Выбрана версия из аккаунта")}
            >
              Принять из аккаунта
            </button>
            <button
              type="button"
              className="button primary"
              onClick={() => void attempt(() => journal.resolve(key, true), "Выбрана твоя версия")}
            >
              Оставить мою
            </button>
          </div>
        ))}
      </section>

      {/* 3 карточки телеметрии */}
      <section className="tel-metric-grid" aria-label="Показатели веса">
        <article className="tel-metric-card is-accent">
          <span className="tel-metric-label">
            <Scale size={13} aria-hidden="true" />
            Текущий вес
          </span>
          <b className="tel-metric-val">
            {stats ? fmt(stats.currentKg) : "—"} {stats ? <small>кг</small> : null}
          </b>
          <span className="tel-metric-sub">
            {stats ? `Мин ${fmt(stats.minKg)} · Макс ${fmt(stats.maxKg)} кг` : "Нет замеров"}
          </span>
        </article>

        <article className="tel-metric-card">
          <span className="tel-metric-label">
            {stats && stats.totalChangeKg < 0 ? (
              <TrendingDown size={13} aria-hidden="true" />
            ) : (
              <TrendingUp size={13} aria-hidden="true" />
            )}
            За всё время
          </span>
          <b className="tel-metric-val">
            {stats && entries.length > 1
              ? `${stats.totalChangeKg > 0 ? "+" : ""}${fmt(stats.totalChangeKg)}`
              : "—"}{" "}
            {stats && entries.length > 1 ? <small>кг</small> : null}
          </b>
          <span className="tel-metric-sub">
            {entries.length > 1
              ? `С ${DateText.dayInYear(entries[0].date, today.slice(0, 4))}`
              : "Нужно от 2 замеров"}
          </span>
        </article>

        <article className="tel-metric-card">
          <span className="tel-metric-label">
            <Activity size={13} aria-hidden="true" />
            Темп (28 дн.)
          </span>
          <b className="tel-metric-val">
            {rate.label === "Мало данных"
              ? "—"
              : `${rate.rateKgPerWeek > 0 ? "+" : ""}${fmt(rate.rateKgPerWeek)}`}{" "}
            {rate.label !== "Мало данных" ? <small>кг/нед</small> : null}
          </b>
          <span className="tel-metric-sub">
            {rate.label === "Мало данных" ? "От 3 замеров за 7 дней" : rate.label}
          </span>
        </article>
      </section>

      <section
        className={`bw-neat-card status-${neatVerdict.status}`}
        aria-label="Анти-NEAT оценка темпа за 14 дней"
      >
        <div className="bw-neat-head">
          <span className="bw-neat-badge">{neatVerdict.badge}</span>
          {neatVerdict.kcalDeltaHint ? (
            <span className="bw-neat-kcal">{neatVerdict.kcalDeltaHint}</span>
          ) : null}
        </div>
        <strong className="bw-neat-title">{neatVerdict.headline}</strong>
        <p className="bw-neat-detail">{neatVerdict.detail}</p>
      </section>

      {/* График + Форма записи */}
      <div className="bw-main-grid">
        <section className="tel-card" aria-label="Динамика веса">
          <div className="tel-card-head">
            <h3>Динамика</h3>
            <div className="tel-pill-row" role="group" aria-label="Период веса">
              {[
                [30, "30 дн."],
                [90, "90 дн."],
                [0, "Всё"],
              ].map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className={`tel-pill-btn${period === value ? " active" : ""}`}
                  aria-pressed={period === value}
                  onClick={() => setPeriod(Number(value))}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <ProgressChart
            points={points}
            unit="кг"
            label="Замеры и сглаженный вес по календарным датам"
            goal={goal.targetWeightKg}
          />
        </section>

        <section className="bw-form-card" aria-labelledby="weight-form-title">
          <div className="tel-card-head">
            <h3 id="weight-form-title">
              <Plus size={16} aria-hidden="true" />
              Записать вес
            </h3>
          </div>
          <form onSubmit={save}>
            <label htmlFor={weightInputId}>
              Вес, кг
              <input
                id={weightInputId}
                ref={weightInputRef}
                className="bw-weight-input"
                inputMode="decimal"
                autoComplete="off"
                value={weight}
                onChange={(e) => setWeight(e.target.value)}
                placeholder="Например, 78,5"
                required
              />
            </label>
            <div className="bw-steppers">
              {[-0.5, -0.1, 0.1, 0.5].map((n) => (
                <button
                  type="button"
                  key={n}
                  onClick={() => step(n)}
                  disabled={!weight.trim()}
                  aria-label={`Изменить вес на ${n > 0 ? "+" : ""}${n} кг`}
                >
                  {n > 0 ? "+" : ""}
                  {fmt(n)}
                </button>
              ))}
            </div>
            <label>
              Дата взвешивания
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                max={today}
                required
              />
            </label>
            <label>
              Заметка
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={200}
                placeholder="Утром, до еды"
              />
            </label>
            <button className="button primary" type="submit">
              <Check size={17} aria-hidden="true" />
              {entries.some((e) => e.date === date) ? "Обновить замер" : "Сохранить замер"}
            </button>
          </form>
          {error && !goalEditor && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          {notice && (
            <p className="success-message" role="status">
              {notice}
            </p>
          )}
        </section>
      </div>

      {/* История взвешиваний */}
      <section className="tel-card">
        <div className="tel-card-head">
          <h3>
            История взвешиваний{" "}
            <span className="coach-insight-metric">
              {quantity(entries.length, "замер", "замера", "замеров")}
            </span>
          </h3>
        </div>
        {!entries.length ? (
          <p className="mv-effect-line">История пока пуста. Добавь первый замер в форме выше.</p>
        ) : (
          <div className="bw-history-list">
            {[...entries]
              .reverse()
              .slice(0, all ? undefined : 20)
              .map((entry) => (
                <div className="bw-history-row" key={entry.id}>
                  <div className="bw-history-left">
                    <b>{fmt(entry.weightKg)} кг</b>
                    <span>{DateText.day(entry.date)}</span>
                  </div>
                  {entry.note ? <p className="bw-history-note">{entry.note}</p> : null}
                  {deleting === entry.id ? (
                    <div className="weight-row-actions">
                      <button
                        type="button"
                        className="text-button"
                        onClick={() =>
                          void attempt(() => {
                            tracker.removeEntry(entry.id);
                            setDeleting(null);
                          }, "Замер удалён")
                        }
                      >
                        Удалить
                      </button>
                      <button type="button" className="text-button" onClick={() => setDeleting(null)}>
                        Отмена
                      </button>
                    </div>
                  ) : (
                    <div className="weight-row-actions">
                      <button
                        type="button"
                        className="icon-button"
                        aria-label={`Изменить замер ${DateText.day(entry.date)}`}
                        onClick={() => edit(entry)}
                      >
                        <Pencil size={15} />
                      </button>
                      <button
                        type="button"
                        className="icon-button"
                        aria-label={`Удалить замер ${DateText.day(entry.date)}`}
                        onClick={() => setDeleting(entry.id)}
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  )}
                </div>
              ))}
          </div>
        )}
        {entries.length > 20 && !all && (
          <button type="button" className="text-button" onClick={() => setAll(true)}>
            Показать всю историю ({entries.length})
          </button>
        )}
      </section>
    </m.div>
  );
}
