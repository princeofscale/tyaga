import { useCallback, useEffect, useRef, useState } from "react";
import { m, useReducedMotion } from "motion/react";
import { Flag, Check, Download, Plus, RefreshCw } from "lucide-react";
import type { FriendsData } from "../domain/FriendsService";
import {
  TeamChallengeProgress,
  type TeamChallenge,
} from "../domain/TeamChallenge";
import { friendsApi } from "../services/FriendsApi";
import { weekStart, dateLabel } from "../lib/model";
import { saveFile } from "../lib/saveFile";
import Modal from "./Modal";
export default function TeamChallenges({ data }: { data: FriendsData }) {
  const [challenges, setChallenges] = useState<TeamChallenge[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [loaded, setLoaded] = useState(false);
  const [creating, setCreating] = useState(false),
    [newId, setNewId] = useState(""),
    [cancel, setCancel] = useState<TeamChallenge | null>(null);
  const [targets, setTargets] = useState<Record<string, string>>({});
  const reduced = useReducedMotion(),
    alive = useRef(true),
    mutation = useRef(false);
  const load = useCallback(
    async (signal?: AbortSignal) => {
      const r = await friendsApi.request<{
        challenges: TeamChallenge[];
        accountId: string;
      }>("/api/challenges", "GET", undefined, signal);
      if (r.accountId !== data.me.id)
        throw new Error("Аккаунт изменился. Обнови страницу.");
      if (alive.current && !signal?.aborted) {
        setChallenges(r.challenges);
        setLoaded(true);
      }
    },
    [data.me.id],
  );
  useEffect(() => {
    alive.current = true;
    const controller = new AbortController();
    const refresh = () => {
      if (document.visibilityState !== "visible" || mutation.current) return;
      void load(controller.signal).catch((e) => {
        if (!controller.signal.aborted && alive.current)
          setError(
            e instanceof Error ? e.message : "Не удалось загрузить челленджи",
          );
      });
    };
    refresh();
    const id = window.setInterval(refresh, 30000);
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("online", refresh);
    return () => {
      alive.current = false;
      controller.abort();
      clearInterval(id);
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("online", refresh);
    };
  }, [load]);
  const perform = async (
    path: string,
    method: string,
    body: Record<string, unknown>,
    after?: () => void,
  ) => {
    if (mutation.current) return;
    mutation.current = true;
    setBusy(true);
    setError("");
    try {
      await friendsApi.request(path, method, {
        ...body,
        accountId: data.me.id,
      });
      await load();
      after?.();
    } catch (e) {
      if (alive.current)
        setError(
          e instanceof Error ? e.message : "Не удалось сохранить челлендж",
        );
    } finally {
      mutation.current = false;
      if (alive.current) setBusy(false);
    }
  };
  return (
    <section className="challenges-panel" aria-labelledby="challenges-title">
      <div className="section-head">
        <div>
          <h2 id="challenges-title">
            <Flag size={19} /> Четыре недели вместе
          </h2>
          <p>У каждого своя цель. Общий результат — по регулярности.</p>
        </div>
        <div className="challenge-header-actions">
          <button
            className="icon-button"
            aria-label="Обновить челленджи"
            disabled={busy}
            onClick={() =>
              void load()
                .then(() => setError(""))
                .catch((e) => setError((e as Error).message))
            }
          >
            <RefreshCw size={17} />
          </button>
          <button
            className="button secondary"
            disabled={busy || !data.friends.length}
            onClick={() => {
              setNewId(crypto.randomUUID());
              setError("");
              setCreating(true);
            }}
          >
            <Plus size={17} />
            Создать челлендж
          </button>
        </div>
      </div>
      {error && !creating && !cancel && (
        <p className="form-error" role="alert">
          {error}{" "}
          <button
            className="text-button"
            onClick={() =>
              void load()
                .then(() => setError(""))
                .catch((e) => setError((e as Error).message))
            }
          >
            Повторить
          </button>
        </p>
      )}
      {!challenges.length && (
        <p className="tiny">
          {loaded
            ? "Пригласи напарников на четыре недели. Каждый выберет свою цель перед участием."
            : "Загружаем челленджи…"}
        </p>
      )}
      <div className="challenge-list">
        {challenges.map((c) => {
          const me = c.participants.find((p) => p.id === data.me.id),
            total = TeamChallengeProgress.summary(c.participants),
            own = me ? TeamChallengeProgress.summary([me]) : null,
            ended = c.today > c.endDate;
          return (
            <m.article
              className="challenge-card"
              key={c.id}
              initial={reduced ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.22 }}
            >
              <div className="challenge-card-head">
                <div>
                  <span className="eyebrow">
                    {c.cancelled
                      ? "ОТМЕНЁН"
                      : ended
                        ? "ИТОГ ЧЕТЫРЁХ НЕДЕЛЬ"
                        : c.today < c.startDate
                          ? "СКОРО НАЧАЛО"
                          : "ЧЕЛЛЕНДЖ ИДЁТ"}
                  </span>
                  <h3>{c.name}</h3>
                  <p>
                    {dateLabel(c.startDate, true)} —{" "}
                    {dateLabel(c.endDate, true)}
                  </p>
                </div>
                <Flag size={21} />
              </div>
              {c.myResponse === "accepted" && (
                <>
                  <div className="challenge-score">
                    <strong>
                      {total.fulfilled}
                      <small> / {total.weekGoals}</small>
                    </strong>
                    <span>недельных целей команды</span>
                  </div>
                  <div
                    className="challenge-meter"
                    role="progressbar"
                    aria-label="Недельные цели команды"
                    aria-valuenow={total.fulfilled}
                    aria-valuemin={0}
                    aria-valuemax={total.weekGoals || 1}
                  >
                    <m.i
                      initial={false}
                      animate={{
                        width: `${total.weekGoals ? (total.fulfilled / total.weekGoals) * 100 : 0}%`,
                      }}
                      transition={{ duration: reduced ? 0 : 0.3 }}
                    />
                  </div>
                </>
              )}
              <div className="challenge-people">
                {c.participants.map((p) => (
                  <div key={p.id}>
                    <div className="challenge-person-head">
                      <b>
                        {p.displayName}
                        {p.id === data.me.id ? " · ты" : ""}
                      </b>
                      <span>
                        {p.response === "invited"
                          ? "Приглашён"
                          : p.response === "declined"
                            ? "Не участвует"
                            : `${p.target} в неделю`}
                      </span>
                    </div>
                    {p.weeks && (
                      <div
                        className="challenge-weeks"
                        aria-label={`Недели: ${p.displayName}`}
                      >
                        {p.weeks.map((w, i) => (
                          <div
                            key={w.start}
                            className={`${w.fulfilled ? "is-done" : ""} ${w.phase === "future" ? "is-future" : ""}`}
                          >
                            <span>Неделя {i + 1}</span>
                            <b>
                              {w.count} / {w.target}
                              {w.fulfilled && <Check size={13} />}
                            </b>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
              {c.myResponse === "accepted" && own && (
                <p className="tiny">
                  Твои выполненные недели: {own.fulfilled} / 4 · Лучшая серия:{" "}
                  {own.bestStreak} нед.
                </p>
              )}
              {!c.cancelled && !ended && c.myResponse !== "accepted" && (
                <form
                  className="challenge-accept"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void perform(`/api/challenges/${c.id}`, "PUT", {
                      action: "accept",
                      target: Number(
                        targets[c.id] ??
                          (c.myResponse === "declined"
                            ? me?.target
                            : data.me.weeklyTarget) ??
                          3,
                      ),
                    });
                  }}
                >
                  <label>
                    Моя цель в этом челлендже
                    <input
                      aria-label={`Цель: ${c.name}`}
                      type="number"
                      min="1"
                      max="14"
                      step="1"
                      value={
                        targets[c.id] ??
                        String(
                          (c.myResponse === "declined"
                            ? me?.target
                            : data.me.weeklyTarget) ?? 3,
                        )
                      }
                      onChange={(e) =>
                        setTargets((t) => ({ ...t, [c.id]: e.target.value }))
                      }
                      required
                    />
                  </label>
                  <p className="tiny">
                    Участники увидят имя, цель и число тренировок по неделям за
                    весь период. Цель фиксируется при первом принятии.
                  </p>
                  <button className="button primary" disabled={busy}>
                    Принять челлендж
                  </button>
                  {c.myResponse === "invited" && (
                    <button
                      type="button"
                      className="text-button"
                      disabled={busy}
                      onClick={() =>
                        void perform(`/api/challenges/${c.id}`, "PUT", {
                          action: "decline",
                        })
                      }
                    >
                      Не участвую
                    </button>
                  )}
                </form>
              )}
              <div className="challenge-actions">
                {me?.weeks && (
                  <button
                    className="text-button"
                    onClick={() =>
                      void saveFile(
                        `tyaga-4-weeks-${c.id.replace(/[^a-zA-Z0-9-]/g, "")}.svg`,
                        TeamChallengeProgress.card(c, me),
                        "image/svg+xml",
                      ).catch((e) => setError((e as Error).message))
                    }
                  >
                    <Download size={15} />
                    Моя карточка {ended ? "итога" : "прогресса"}
                  </button>
                )}
                {!c.cancelled &&
                  !ended &&
                  (c.hostId === data.me.id ? (
                    <button
                      className="text-button"
                      disabled={busy}
                      onClick={() => {
                        setError("");
                        setCancel(c);
                      }}
                    >
                      Отменить челлендж
                    </button>
                  ) : c.myResponse === "accepted" ? (
                    <button
                      className="text-button"
                      disabled={busy}
                      onClick={() =>
                        void perform(`/api/challenges/${c.id}`, "PUT", {
                          action: "decline",
                        })
                      }
                    >
                      Выйти из челленджа
                    </button>
                  ) : null)}
              </div>
            </m.article>
          );
        })}
      </div>
      {creating && (
        <Modal
          title="Челлендж на четыре недели"
          onClose={() => {
            if (!busy) setCreating(false);
          }}
        >
          <form
            className="meetup-form"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              void perform(
                "/api/challenges",
                "POST",
                {
                  id: newId,
                  name: f.get("name"),
                  startDate: f.get("startDate"),
                  target: Number(f.get("target")),
                  friendIds: f.getAll("friendIds"),
                },
                () => setCreating(false),
              );
            }}
          >
            <fieldset disabled={busy}>
              <label>
                Название
                <input
                  name="name"
                  maxLength={80}
                  defaultValue="Четыре недели в ритме"
                  required
                />
              </label>
              <label>
                Начало — понедельник
                <input
                  name="startDate"
                  type="date"
                  defaultValue={weekStart(new Date())}
                  required
                />
              </label>
              <label>
                Моя цель: тренировок в неделю
                <input
                  name="target"
                  type="number"
                  min="1"
                  max="14"
                  defaultValue={data.me.weeklyTarget ?? 3}
                  required
                />
              </label>
              <p className="tiny">
                Напарники выберут собственные цели. Для зачёта нужна сохранённая
                тренировка хотя бы с одним рабочим подходом.
              </p>
              <div className="meetup-invitees">
                {data.friends.map((f) => (
                  <label key={f.id}>
                    <input type="checkbox" name="friendIds" value={f.id} />
                    {f.displayName}
                  </label>
                ))}
              </div>
              <button className="button primary">
                Пригласить на четыре недели
              </button>
              {error && (
                <p role="alert" className="form-error">
                  {error}
                </p>
              )}
            </fieldset>
          </form>
        </Modal>
      )}
      {cancel && (
        <Modal
          title="Отменить челлендж?"
          onClose={() => {
            if (!busy) setCancel(null);
          }}
        >
          <p>
            Участники увидят отметку об отмене. Сохранённые тренировки останутся
            в их журналах.
          </p>
          <button
            className="button danger"
            disabled={busy}
            onClick={() =>
              void perform(
                `/api/challenges/${cancel.id}`,
                "PUT",
                { action: "cancel" },
                () => setCancel(null),
              )
            }
          >
            Подтвердить отмену
          </button>
          {error && (
            <p role="alert" className="form-error">
              {error}
            </p>
          )}
        </Modal>
      )}
    </section>
  );
}
