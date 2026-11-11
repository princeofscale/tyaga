import { quantity } from "../lib/quantity";
import { useBodyweight } from "../state/BodyweightContext";
import {
  useEffect,
  useMemo,
  useState,
  useRef,
  useId,
  type FormEvent,
} from "react";
import { m, useReducedMotion } from "motion/react";
import { Check, Pencil, Plus, Scale, Target, Trash2 } from "lucide-react";
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

/** Account-scoped weighing journal, reused by Progress and the quick tool dialog. */
export function BodyweightModal({
  accountId,
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
    () => entries.at(-1)?.weightKg.toString() ?? "",
  );
  const today = localDate(new Date(), timeZone);
  const [date, setDate] = useState(today),
    [note, setNote] = useState("");
  const [goalInput, setGoalInput] = useState(
      () => goal.targetWeightKg?.toString() ?? "",
    ),
    [goalEditor, setGoalEditor] = useState(false);
  const [period, setPeriod] = useState(90),
    [error, setError] = useState(() => tracker.storageIssue()),
    [notice, setNotice] = useState("");
  const [deleting, setDeleting] = useState<string | null>(null),
    [all, setAll] = useState(false);
  const reduced = useReducedMotion();
  useEffect(() => {
    const latest = journal.tracker.getEntries();
    setWeight(latest.at(-1)?.weightKg.toString() ?? "");
    setDate(localDate(new Date(), timeZone));
    setNote("");
    setGoalInput(journal.tracker.getGoal().targetWeightKg?.toString() ?? "");
    setGoalEditor(false);
    setDeleting(null);
    setError(journal.tracker.storageIssue());
    setNotice("");
  }, [journal]);
  const reload = () => {
    setEntries(tracker.getEntries());
    setGoal(tracker.getGoal());
  };
  useEffect(() => {
    const changed = () => {
      reload();
      refreshSync((n) => n + 1);
    };
    const off = journal.subscribe(changed);
    changed();
    return off;
  }, [journal]);
  const stats = useMemo(() => tracker.getStats(), [entries, tracker]);
  const rate = useMemo(() => tracker.getWeeklyRate(), [entries, tracker]);
  const trend = useMemo(() => tracker.getTrend(), [entries, tracker]);
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
      if (import.meta.env.MODE !== "device" || cloudState())
        void journal.sync();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось сохранить");
    }
  };
  const save = (e: FormEvent) => {
    e.preventDefault();
    attempt(() => {
      tracker.addEntry(BodyweightTracker.parseWeight(weight), date, note);
      setNote("");
    }, "Замер сохранён");
  };
  const edit = (entry: BodyweightEntry) => {
    setWeight(String(entry.weightKg));
    setDate(entry.date);
    setNote(entry.note ?? "");
    weightInputRef.current?.focus();
  };
  const step = (delta: number) => {
    try {
      setWeight(String(BodyweightTracker.step(weight, delta)));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <m.div
      className="weight-journal"
      initial={reduced ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
    >
      <div className="progress-section-title">
        <div>
          <span className="eyebrow">МАССА ТЕЛА</span>
          <h2>Вес и его динамика</h2>
          <p>Сравнивай замеры в похожих условиях — например, утром до еды.</p>
        </div>
        <Scale size={25} />
      </div>
      <section className="weight-sync-panel" aria-label="Сохранение веса">
        <div role="status">
          {journal.syncing
            ? "Синхронизируем вес…"
            : import.meta.env.MODE === "device" && !cloudState()
              ? "Сохранено на телефоне · облако не подключено"
              : journal.conflicts.length
                ? "Нужно выбрать версию замера"
                : journal.pendingCount
                  ? `${quantity(journal.pendingCount, "изменение", "изменения", "изменений")} ${journal.pendingCount === 1 ? "ждёт" : "ждут"} отправки`
                  : journal.lastSyncedAt
                    ? "Сохранено в аккаунте"
                    : journal.error
                      ? "Нет связи с аккаунтом"
                      : "Загружаем вес из аккаунта…"}
        </div>
        <div className="weight-sync-actions">
          <button
            className="text-button"
            disabled={journal.syncing}
            onClick={async () => {
              await journal.sync();
              if (import.meta.env.MODE === "device") {
                await syncCloud();
                await journal.sync();
              }
            }}
          >
            Синхронизировать
          </button>
          <button
            className="text-button"
            onClick={() =>
              void saveFile(
                "tyaga-bodyweight.json",
                JSON.stringify(journal.export(), null, 2),
                "application/json",
              )
            }
          >
            Экспорт веса
          </button>
        </div>
        {journal.error && !error && (
          <p className="form-error" role="alert">
            {journal.error} Изменения на устройстве сохранены.
          </p>
        )}
        {import.meta.env.MODE === "device" && (
          <p className="tiny">
            {cloudState()
              ? "Облако подключено. Вес синхронизируется с аккаунтом напрямую."
              : "Для переноса на другие устройства подключи облако в профиле."}
          </p>
        )}
        {journal.conflicts.map((key) => (
          <div className="weight-conflict" key={key}>
            <b>
              {key === "goal" ? "Цель по весу" : `Взвешивание ${key.slice(7)}`}{" "}
              изменено на другом устройстве.
            </b>
            <button
              className="button secondary"
              onClick={() => {
                void attempt(
                  () => journal.resolve(key, false),
                  "Выбрана версия из аккаунта",
                );
              }}
            >
              Принять версию из аккаунта
            </button>
            <button
              className="button primary"
              onClick={() => {
                void attempt(
                  () => journal.resolve(key, true),
                  "Выбрана твоя версия",
                );
              }}
            >
              Сохранить мою версию
            </button>
          </div>
        ))}
      </section>
      <div className="progress-metrics">
        <article className="progress-metric accent">
          <span>Последний замер</span>
          <strong>
            {stats ? fmt(stats.currentKg) : "—"}
            <small> кг</small>
          </strong>
          <p>
            {entries.length
              ? dateLabel(entries.at(-1)!.date, true)
              : "Запиши первый вес"}
          </p>
        </article>
        <article className="progress-metric">
          <span>Изменение за историю</span>
          <strong>
            {stats
              ? `${stats.totalChangeKg > 0 ? "+" : ""}${fmt(stats.totalChangeKg)}`
              : "—"}
            <small> кг</small>
          </strong>
          <p>
            {entries.length > 1
              ? `С ${dateLabel(entries[0].date)}`
              : "Нужны хотя бы два замера"}
          </p>
        </article>
        <article className="progress-metric">
          <span>Темп за последние 28 дней</span>
          <strong>
            {rate.label === "Мало данных"
              ? "—"
              : `${rate.rateKgPerWeek > 0 ? "+" : ""}${fmt(rate.rateKgPerWeek)}`}
            <small> кг/нед</small>
          </strong>
          <p>
            {rate.label === "Мало данных"
              ? "От 3 замеров за 7 дней и больше"
              : "По фактическим замерам, без прогноза"}
          </p>
        </article>
      </div>
      <div className="weight-layout">
        <section
          className="progress-card weight-chart-card"
          aria-label="Динамика веса"
        >
          <div className="progress-card-head">
            <div>
              <h3>Динамика веса</h3>
              <p>
                Сплошная линия соединяет взвешивания. Пунктир — сглаживание.
              </p>
            </div>
            <div
              className="progress-period"
              role="group"
              aria-label="Период веса"
            >
              {[
                [30, "30 дней"],
                [90, "90 дней"],
                [0, "Всё"],
              ].map(([value, label]) => (
                <button
                  key={value}
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
          <div className="weight-goal">
            <Target size={20} />
            <div>
              <b>
                {goal.targetWeightKg === null
                  ? "Цель по весу"
                  : `Цель: ${fmt(goal.targetWeightKg)} кг`}
              </b>
              <p>
                {goal.targetWeightKg === null
                  ? "Необязательно. Помогает держать ориентир."
                  : "Цель показана отдельно и не сжимает график."}
              </p>
            </div>
            <button
              className="text-button"
              onClick={() => {
                setGoalInput(goal.targetWeightKg?.toString() ?? "");
                setGoalEditor((v) => !v);
              }}
            >
              {goal.targetWeightKg === null ? "Задать цель" : "Изменить цель"}
            </button>
          </div>
          {goalEditor && (
            <form
              className="weight-goal-form"
              onSubmit={(e) => {
                e.preventDefault();
                attempt(() => {
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
              <button className="button primary">Сохранить цель</button>
              {goal.targetWeightKg !== null && (
                <button
                  type="button"
                  className="text-button"
                  onClick={() =>
                    attempt(() => {
                      tracker.setGoal(null);
                      setGoalEditor(false);
                    }, "Цель убрана")
                  }
                >
                  Убрать цель
                </button>
              )}
              {error && (
                <p className="form-error" role="alert">
                  {error}
                </p>
              )}
            </form>
          )}
        </section>
        <section
          className="progress-card weight-entry-card"
          aria-labelledby="weight-form-title"
        >
          <span className="weight-form-icon">
            <Plus size={22} />
          </span>
          <h3 id="weight-form-title">Записать вес</h3>
          <p>Один замер на дату. Повторное сохранение обновит запись.</p>
          <form onSubmit={save}>
            <label htmlFor={weightInputId}>
              Вес, кг
              <input
                id={weightInputId}
                ref={weightInputRef}
                className="weight-number-input"
                inputMode="decimal"
                autoComplete="off"
                value={weight}
                onChange={(e) => setWeight(e.target.value)}
                placeholder="Например, 61,5"
                required
              />
            </label>
            <div className="weight-steppers">
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
              <Check size={17} />
              {entries.some((e) => e.date === date)
                ? "Обновить замер"
                : "Сохранить замер"}
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
          <p className="tiny">
            Последний замер используется в новых упражнениях с весом тела. Масса
            в сохранённых тренировках остаётся прежней. Без сети изменения
            остаются на устройстве и отправляются при восстановлении связи.
          </p>
        </section>
      </div>
      <section className="progress-card weight-history">
        <div className="progress-card-head">
          <h3>
            История взвешиваний <span>{entries.length}</span>
          </h3>
          <span className="tiny">Новые сверху</span>
        </div>
        {!entries.length ? (
          <p className="progress-empty-copy">
            История пока пустая. Сохрани первый замер в форме выше.
          </p>
        ) : (
          [...entries]
            .reverse()
            .slice(0, all ? undefined : 30)
            .map((entry) => (
              <div className="weight-history-row" key={entry.id}>
                <div>
                  <b>
                    {fmt(entry.weightKg)} <small>кг</small>
                  </b>
                  <span>{dateLabel(entry.date, true)}</span>
                </div>
                <p>{entry.note || "Без заметки"}</p>
                {deleting === entry.id ? (
                  <div className="weight-row-actions">
                    <button
                      className="text-button"
                      onClick={() =>
                        attempt(() => {
                          tracker.removeEntry(entry.id);
                          setDeleting(null);
                        }, "Замер удалён")
                      }
                    >
                      Подтвердить удаление
                    </button>
                    <button
                      className="text-button"
                      onClick={() => setDeleting(null)}
                    >
                      Отмена
                    </button>
                  </div>
                ) : (
                  <div className="weight-row-actions">
                    <button
                      className="icon-button"
                      aria-label={`Изменить замер ${entry.date}`}
                      onClick={() => edit(entry)}
                    >
                      <Pencil size={16} />
                    </button>
                    <button
                      className="icon-button"
                      aria-label={`Удалить замер ${entry.date}`}
                      onClick={() => setDeleting(entry.id)}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                )}
              </div>
            ))
        )}
        {entries.length > 30 && !all && (
          <button className="text-button" onClick={() => setAll(true)}>
            Показать всю историю
          </button>
        )}
      </section>
    </m.div>
  );
}
