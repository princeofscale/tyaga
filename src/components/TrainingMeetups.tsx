import { quantity } from "../lib/quantity";
import { useState } from "react";
import { AnimatePresence, m, useReducedMotion } from "motion/react";
import { CalendarDays, MapPin, Plus, CheckCheck } from "lucide-react";
import {
  TrainingMeetups as Meetups,
  type TrainingMeetup,
} from "../domain/TrainingMeetups";
import type { FriendsData } from "../domain/FriendsService";
import type { Workout } from "../lib/types";
import { localDate } from "../lib/calendar";
import Modal from "./Modal";
type Mutate = (
  path: string,
  method: string,
  body: unknown,
  message: string,
  after?: () => void,
) => Promise<void>;
export function WeeklyGoal({
  value,
  busy,
  onSave,
}: {
  value: number;
  busy: boolean;
  onSave: (n: number) => void;
}) {
  const [goal, setGoal] = useState(String(value));
  return (
    <form
      className="weekly-goal-form"
      onSubmit={(e) => {
        e.preventDefault();
        onSave(Number(goal));
      }}
    >
      <label>
        Моя цель на неделю
        <input
          type="number"
          min="1"
          max="14"
          step="1"
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          required
        />
      </label>
      <button className="button secondary" disabled={busy}>
        Сохранить цель
      </button>
    </form>
  );
}
export default function TrainingMeetups({
  data,
  workouts,
  busy,
  mutate,
  onStart,
  error: serverError,
}: {
  error?: string;
  data: FriendsData;
  workouts: Workout[];
  busy: boolean;
  mutate: Mutate;
  onStart: (m: TrainingMeetup) => void;
}) {
  const [creating, setCreating] = useState(false),
    [id, setId] = useState("");
  const [finishing, setFinishing] = useState<TrainingMeetup | null>(null),
    [error, setError] = useState("");
  const reduced = useReducedMotion();
  const [myGyms, setMyGyms] = useState<Record<string, string>>({});
  const meetings = data.meetups ?? [];
  return (
    <section className="meetups-panel" aria-labelledby="meetups-title">
      <div className="section-head">
        <div>
          <h2 id="meetups-title">Тренировки на связи</h2>
          <p>Начните в одно время, каждый в своём зале.</p>
        </div>
        <button
          className="button secondary"
          disabled={!data.friends.length || busy}
          onClick={() => {
            setId(crypto.randomUUID());
            setError("");
            setCreating(true);
          }}
        >
          <CalendarDays size={17} />
          Позвать на тренировку
        </button>
      </div>
      {!meetings.length ? (
        <p className="meetup-empty">
          {data.friends.length
            ? "Выбери время и пригласи напарника. После тренировки можно собрать общий итог."
            : "Добавь напарника, чтобы планировать тренировки вместе."}
        </p>
      ) : (
        <div className="meetup-grid">
          <AnimatePresence initial={false}>
            {meetings.map((meeting) => {
              const total = Meetups.summary(meeting.participants),
                accepted = meeting.myResponse === "accepted",
                finished = meeting.myResponse === "finished";
              return (
                <m.article
                  className="meetup-card"
                  key={meeting.id}
                  initial={reduced ? false : { opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                >
                  <div className="meetup-date">
                    <CalendarDays size={16} />
                    <time dateTime={meeting.startsAt}>
                      {new Date(meeting.startsAt).toLocaleString("ru-RU", {
                        day: "numeric",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </time>
                    <span>
                      {meeting.cancelled
                        ? "Отменена"
                        : finished
                          ? "Итог добавлен"
                          : accepted
                            ? "Ты участвуешь"
                            : meeting.myResponse === "declined"
                              ? "Ты отказался"
                              : "Приглашение"}
                    </span>
                  </div>
                  <h3>{meeting.name}</h3>
                  <p>Организатор: {meeting.hostName}</p>
                  <p className="meetup-gym">
                    <MapPin size={14} />
                    {meeting.gym || "Каждый в своём зале"}
                  </p>
                  <div className="meetup-members">
                    {meeting.participants.map((p) => (
                      <div key={p.id}>
                        <b>
                          {p.displayName}
                          {p.id === data.me.id ? " · ты" : ""}
                        </b>
                        <span>
                          {p.response === "finished"
                            ? p.summary
                              ? quantity(
                                  p.summary.setsCount,
                                  "рабочий подход",
                                  "рабочих подхода",
                                  "рабочих подходов",
                                )
                              : "Итог недоступен"
                            : p.response === "accepted"
                              ? "Участвует"
                              : p.response === "declined"
                                ? "Отказался"
                                : "Приглашён"}
                        </span>
                        {p.gym && <small>{p.gym}</small>}
                      </div>
                    ))}
                  </div>
                  {total.finished > 0 && (
                    <div className="meetup-summary">
                      <CheckCheck size={18} />
                      <span>
                        <b>
                          Общий итог:{" "}
                          {quantity(
                            total.finished,
                            "участник",
                            "участника",
                            "участников",
                          )}
                        </b>
                        <small>
                          {quantity(
                            total.sets,
                            "рабочий подход",
                            "рабочих подхода",
                            "рабочих подходов",
                          )}{" "}
                          · {total.minutes} мин суммарно
                        </small>
                      </span>
                    </div>
                  )}
                  {!meeting.cancelled && (
                    <div className="meetup-actions">
                      {(meeting.myResponse === "invited" ||
                        meeting.myResponse === "declined") && (
                        <>
                          <label>
                            Где тренируешься?
                            <input
                              placeholder="Можно в другом зале"
                              maxLength={60}
                              value={myGyms[meeting.id] ?? ""}
                              onChange={(e) =>
                                setMyGyms((g) => ({
                                  ...g,
                                  [meeting.id]: e.target.value,
                                }))
                              }
                            />
                          </label>
                          <p className="tiny">
                            Участники увидят твоё имя, зал и сводку, которую ты
                            добавишь после тренировки.
                          </p>
                          <button
                            className="button primary"
                            disabled={busy}
                            onClick={() =>
                              void mutate(
                                `/api/friends/meetups/${meeting.id}`,
                                "PUT",
                                {
                                  action: "accept",
                                  gym: myGyms[meeting.id] ?? "",
                                },
                                "Приглашение принято",
                              )
                            }
                          >
                            Присоединиться
                          </button>
                          {meeting.myResponse === "invited" && (
                            <button
                              className="text-button"
                              disabled={busy}
                              onClick={() =>
                                void mutate(
                                  `/api/friends/meetups/${meeting.id}`,
                                  "PUT",
                                  { action: "decline" },
                                  "Приглашение отклонено",
                                )
                              }
                            >
                              Не смогу
                            </button>
                          )}
                        </>
                      )}
                      {accepted && (
                        <>
                          <p className="tiny">
                            Начало включит статус «В зале» на 2 часа. Кнопка
                            доступна за 15 минут до встречи.
                          </p>
                          <button
                            className="button primary"
                            disabled={
                              busy ||
                              Date.parse(meeting.startsAt) >
                                data.serverTime + 15 * 60000
                            }
                            onClick={() => onStart(meeting)}
                          >
                            Начать вместе
                          </button>
                          <button
                            className="button secondary"
                            disabled={
                              busy ||
                              Date.parse(meeting.startsAt) > data.serverTime
                            }
                            onClick={() => setFinishing(meeting)}
                          >
                            Добавить итог
                          </button>
                        </>
                      )}
                      {finished && (
                        <button
                          className="button secondary"
                          disabled={busy}
                          onClick={() => setFinishing(meeting)}
                        >
                          Изменить итог
                        </button>
                      )}
                      {meeting.hostId === data.me.id && !finished && (
                        <button
                          className="text-button"
                          disabled={busy}
                          onClick={() =>
                            void mutate(
                              `/api/friends/meetups/${meeting.id}`,
                              "PUT",
                              { action: "cancel" },
                              "Встреча отменена",
                            )
                          }
                        >
                          Отменить встречу
                        </button>
                      )}
                    </div>
                  )}
                </m.article>
              );
            })}
          </AnimatePresence>
        </div>
      )}
      {creating && (
        <Modal title="Позвать на тренировку" onClose={() => setCreating(false)}>
          <form
            className="meetup-form"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              try {
                setError("");
                void mutate(
                  "/api/friends/meetups",
                  "POST",
                  {
                    id,
                    name: f.get("name"),
                    gym: f.get("gym"),
                    startsAt: Meetups.iso(String(f.get("startsAt"))),
                    friendIds: f.getAll("friendIds"),
                  },
                  "Приглашение отправлено напарникам",
                  () => setCreating(false),
                );
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            <fieldset disabled={busy}>
              <label>
                Название тренировки
                <input
                  name="name"
                  defaultValue="Тренировка вместе"
                  maxLength={80}
                  required
                />
              </label>
              <label>
                Дата и время
                <input
                  type="datetime-local"
                  name="startsAt"
                  defaultValue={Meetups.initialTime()}
                  required
                />
              </label>
              <p className="tiny">
                Время устройства:{" "}
                {Intl.DateTimeFormat().resolvedOptions().timeZone}. Напарники
                увидят его в своём часовом поясе.
              </p>
              <label>
                Твой зал
                <input
                  name="gym"
                  maxLength={60}
                  placeholder="Например, Атлетика на Лесной"
                />
              </label>
              <legend>Кого позвать</legend>
              <div className="meetup-invitees">
                {data.friends.map((f) => (
                  <label key={f.id}>
                    <input type="checkbox" name="friendIds" value={f.id} />
                    {f.displayName}
                  </label>
                ))}
              </div>
              <p className="tiny">
                Приглашение увидят только выбранные напарники. Участие
                подтверждается отдельно.
              </p>
              <button className="button primary">
                <Plus size={17} />
                {busy ? "Отправляем…" : "Отправить приглашение"}
              </button>
              {(error || serverError) && (
                <p role="alert" className="form-error">
                  {error || serverError}
                </p>
              )}
            </fieldset>
          </form>
        </Modal>
      )}
      {finishing && (
        <Modal
          title="Итог совместной тренировки"
          onClose={() => setFinishing(null)}
        >
          <form
            className="meetup-form"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              void mutate(
                `/api/friends/meetups/${finishing.id}`,
                "PUT",
                {
                  action: "finish",
                  workoutId: f.get("workoutId"),
                  gym:
                    myGyms[finishing.id] ??
                    finishing.participants.find((p) => p.id === data.me.id)
                      ?.gym ??
                    "",
                },
                "Итог добавлен в совместную тренировку",
                () => setFinishing(null),
              );
            }}
          >
            <p>
              Участники увидят название, продолжительность, количество рабочих
              подходов и тоннаж свободных весов. Заметки и детали подходов
              останутся личными.
            </p>
            <label>
              Сохранённая тренировка
              <select name="workoutId" required defaultValue="">
                <option value="" disabled>
                  Выбери тренировку за день встречи
                </option>
                {workouts
                  .filter(
                    (w) =>
                      w.date ===
                      localDate(new Date(finishing.startsAt), w.timeZone),
                  )
                  .map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name} · {w.date}
                    </option>
                  ))}
              </select>
            </label>
            <button className="button primary" disabled={busy}>
              Добавить итог
            </button>
            {serverError && (
              <p className="form-error" role="alert">
                {serverError}
              </p>
            )}
          </form>
        </Modal>
      )}
    </section>
  );
}
