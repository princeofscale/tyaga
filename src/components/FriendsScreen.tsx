import TeamChallenges from "./TeamChallenges";
import TrainingMeetups, { WeeklyGoal } from "./TrainingMeetups";
import type { TrainingMeetup } from "../domain/TrainingMeetups";
import type { Workout } from "../lib/types";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
} from "react";
import { AnimatePresence, m, useReducedMotion } from "motion/react";
import {
  ArrowUpRight,
  Check,
  CheckCheck,
  Copy,
  Dumbbell,
  Flame,
  MapPin,
  Plus,
  Radio,
  RefreshCw,
  Share2,
  ShieldCheck,
  ThumbsUp,
  Trophy,
  Users,
  UserPlus,
  X,
} from "lucide-react";
import {
  FriendsService,
  type Athlete,
  type FriendsData,
} from "../domain/FriendsService";
import { friendsApi } from "../services/FriendsApi";
import { CLOUD_URL, cloudState } from "../device/cloudSync";
import { fmt } from "../lib/model";
import { quantity } from "../lib/quantity";
import Modal from "./Modal";
import "../styles/friends.css";

const initialCode = () =>
  new URLSearchParams(location.search).get("friend") ?? "";
const dateLabel = (date: string) =>
  new Date(date + "T12:00:00").toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "short",
  });
const initials = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((s) => s[0])
    .join("")
    .toUpperCase();
function Avatar({
  athlete,
  small = false,
}: {
  athlete: Pick<Athlete, "id" | "displayName">;
  small?: boolean;
}) {
  const color = ["var(--accent)", "#b6a1e8", "#ffb878", "#8dcde0"][
    Array.from(athlete.id).reduce((n, c) => n + c.charCodeAt(0), 0) % 4
  ];
  return (
    <span
      className={`friend-avatar ${small ? "small" : ""}`}
      style={{ "--avatar-color": color } as CSSProperties}
      aria-hidden="true"
    >
      {initials(athlete.displayName)}
    </span>
  );
}

export default function FriendsScreen({
  onProfile,
  workouts = [],
  onStartMeetup = () => {},
}: {
  onProfile: () => void;
  workouts?: Workout[];
  onStartMeetup?: (m: TrainingMeetup) => void;
}) {
  const [data, setData] = useState<FriendsData | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [invite, setInvite] = useState(() => !!initialCode());
  const [code, setCode] = useState(initialCode);
  const [statusEditor, setStatusEditor] = useState(false);
  const [removing, setRemoving] = useState<Athlete | null>(null);
  const [clock, setClock] = useState(Date.now());
  const [cloudToken, setCloudToken] = useState(() =>
    import.meta.env.MODE === "device" ? (cloudState()?.token ?? null) : null,
  );
  const serverOffset = useRef(0);
  const generation = useRef(0),
    mounted = useRef(true),
    mutating = useRef(false);
  const reduced = useReducedMotion();
  const connected =
    import.meta.env.MODE !== "device" || !!(CLOUD_URL && cloudToken);
  useEffect(() => {
    if (import.meta.env.MODE !== "device") return;
    const changed = () => setCloudToken(cloudState()?.token ?? null);
    window.addEventListener("tyaga:cloud", changed);
    return () => window.removeEventListener("tyaga:cloud", changed);
  }, []);
  const refresh = useCallback(async (signal?: AbortSignal) => {
    const version = ++generation.current;
    const next = await friendsApi.request<FriendsData>(
      "/api/friends",
      "GET",
      undefined,
      signal,
    );
    if (!mounted.current || signal?.aborted || version !== generation.current)
      return;
    setData(next);
    serverOffset.current = next.serverTime - Date.now();
    setClock(next.serverTime);
    setError("");
    return next;
  }, []);
  useEffect(() => {
    mounted.current = true;
    setData(null);
    if (!connected) return;
    const controller = new AbortController();
    const load = () => {
      if (document.visibilityState !== "visible" || mutating.current) return;
      void refresh(controller.signal).catch((e) => {
        if (!controller.signal.aborted && mounted.current)
          setError(
            e instanceof Error ? e.message : "Не удалось загрузить напарников",
          );
      });
    };
    load();
    const interval = window.setInterval(load, 20000);
    const tick = window.setInterval(
      () => setClock(Date.now() + serverOffset.current),
      10000,
    );
    document.addEventListener("visibilitychange", load);
    window.addEventListener("online", load);
    return () => {
      mounted.current = false;
      controller.abort();
      ++generation.current;
      clearInterval(interval);
      clearInterval(tick);
      document.removeEventListener("visibilitychange", load);
      window.removeEventListener("online", load);
    };
  }, [refresh, connected, cloudToken]);

  async function perform(
    path: string,
    method: string,
    body: unknown,
    message: string,
    after?: () => void,
  ) {
    if (mutating.current) return;
    mutating.current = true;
    ++generation.current;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await friendsApi.request(path, method, body);
      if (!mounted.current) return;
      after?.();
      setNotice(message);
      try {
        await refresh();
      } catch {
        if (mounted.current)
          setError(
            "Действие сохранено, но список не обновился. Нажми «Обновить».",
          );
      }
    } catch (e) {
      if (mounted.current)
        setError(
          e instanceof Error ? e.message : "Не удалось выполнить действие",
        );
    } finally {
      mutating.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  function dismissInvite() {
    setInvite(false);
    const url = new URL(location.href);
    url.searchParams.delete("friend");
    history.replaceState(
      history.state,
      "",
      url.pathname + url.search + url.hash,
    );
  }
  async function share() {
    if (!data) return;
    const url = new URL(
      import.meta.env.MODE === "device" ? CLOUD_URL : location.origin,
    );
    url.searchParams.set("friend", data.me.inviteCode);
    try {
      if (navigator.share)
        await navigator.share({
          title: "Тяга · напарники",
          text: "Добавляйся в Тяге. Будем тренироваться на связи.",
          url: url.href,
        });
      else {
        await navigator.clipboard.writeText(url.href);
        setNotice("Ссылка скопирована — отправь её другу");
      }
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError"))
        setError(
          "Не удалось поделиться ссылкой. Скопируй код из приглашения вручную.",
        );
    }
  }
  const team = data ? [data.me, ...data.friends] : [];
  const progress = FriendsService.teamProgress(team);
  const live =
    data?.friends.filter((friend) => friend.activeUntil > clock) ?? [];
  const inGym = !!data && data.me.activeUntil > clock;
  const entrance = (index = 0) => ({
    initial: { opacity: 0, y: reduced ? 0 : 12 },
    animate: { opacity: 1, y: 0 },
    transition: {
      duration: 0.3,
      delay: reduced ? 0 : Math.min(index * 0.04, 0.2),
    },
  });
  const request = (e: FormEvent) => {
    e.preventDefault();
    const value = FriendsService.inviteCode(code);
    if (!value) {
      setError("Введи код из 12 символов или ссылку приглашения");
      return;
    }
    void perform(
      "/api/friends/requests",
      "POST",
      { code: value },
      "Заявка отправлена. Друг сможет принять её в разделе «Друзья».",
      () => {
        dismissInvite();
        setCode("");
      },
    );
  };
  return (
    <div className="friends-screen">
      <header className="screen-head friends-heading">
        <div>
          <span className="eyebrow">ТВОЯ КОМАНДА</span>
          <h1>Напарники</h1>
        </div>
        <div className="friends-heading-actions">
          <button
            className="icon-button"
            aria-label="Обновить напарников"
            disabled={busy || refreshing || !connected}
            onClick={async () => {
              setRefreshing(true);
              try {
                await refresh();
              } catch (e) {
                setError(
                  e instanceof Error ? e.message : "Не удалось обновить",
                );
              } finally {
                setRefreshing(false);
              }
            }}
          >
            <RefreshCw size={18} />
          </button>
          <button
            className="button primary"
            disabled={!data}
            onClick={() => setInvite(true)}
          >
            <UserPlus size={18} />
            Добавить друга
          </button>
        </div>
      </header>
      <div aria-live="polite">
        {notice && (
          <p className="friends-notice">
            <CheckCheck size={18} />
            {notice}
          </p>
        )}
      </div>
      {error && (
        <p className="form-error friends-error" role="alert">
          {error}{" "}
          <button
            className="text-button"
            onClick={() => {
              setRefreshing(true);
              void refresh()
                .catch((e) =>
                  setError(
                    e instanceof Error ? e.message : "Не удалось обновить",
                  ),
                )
                .finally(() => setRefreshing(false));
            }}
            disabled={refreshing}
          >
            Обновить
          </button>
        </p>
      )}
      {!connected ? (
        <section className="friends-empty">
          <Users size={32} />
          <h2>Тренируйтесь на связи</h2>
          <p>
            Подключи облако в профиле. Напарники и респекты работают через
            интернет, а журнал по-прежнему доступен без сети.
          </p>
          <button className="button primary" onClick={onProfile}>
            Подключить облако
          </button>
        </section>
      ) : !data ? (
        <div className="friends-empty" role="status">
          {error
            ? "Список пока недоступен. Можно повторить загрузку."
            : "Загружаем команду…"}
        </div>
      ) : (
        <>
          <m.section
            className="friends-hero friends-hero-compact"
            {...entrance()}
          >
            <div>
              <h2>Твоя команда</h2>
              <p>Тренируйтесь в своём ритме, оставайтесь на связи.</p>
            </div>
            <div
              className="friends-hero-team"
              aria-label={`${data.friends.length} напарников, ${live.length} сейчас в зале`}
            >
              <div className="friends-avatar-stack">
                {team.slice(0, 4).map((athlete) => (
                  <Avatar key={athlete.id} athlete={athlete} />
                ))}
                {team.length === 1 && (
                  <span className="friend-avatar empty" aria-hidden="true">
                    <Plus size={24} />
                  </span>
                )}
              </div>
              <strong>
                {data.friends.length
                  ? quantity(
                      data.friends.length,
                      "напарник",
                      "напарника",
                      "напарников",
                    )
                  : "Собери свою команду"}
              </strong>
              <span>
                {live.length
                  ? `${live.length} сейчас в зале`
                  : "Пригласи тех, с кем идёшь к прогрессу"}
              </span>
            </div>
          </m.section>
          <section
            className={`friend-checkin ${inGym ? "is-live" : ""}`}
            aria-labelledby="checkin-title"
          >
            <span className="friend-checkin-icon">
              <Radio size={22} />
            </span>
            <div>
              <h2 id="checkin-title">
                {inGym ? "Ты в зале" : "Сегодня тренируешься?"}
              </h2>
              <p>
                {inGym
                  ? [
                      data.me.gym || "Зал не указан",
                      data.me.focus || "Силовая тренировка",
                    ].join(" · ")
                  : "Отметься — напарники увидят, что ты на тренировке"}
              </p>
              {inGym && (
                <small>
                  Статус до{" "}
                  {new Date(data.me.activeUntil).toLocaleTimeString("ru-RU", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </small>
              )}
            </div>
            <button
              className={`button ${inGym ? "secondary" : "primary"}`}
              disabled={busy}
              onClick={() => setStatusEditor(true)}
            >
              {inGym ? "Изменить" : "Я в зале"}
              <ArrowUpRight size={16} />
            </button>
          </section>
          {data.requests.length > 0 && (
            <section
              className="friend-requests"
              aria-labelledby="requests-title"
            >
              <div className="section-head">
                <h2 id="requests-title">
                  Заявки{" "}
                  <span className="friend-count">{data.requests.length}</span>
                </h2>
              </div>
              <AnimatePresence initial={false}>
                {data.requests.map((item) => (
                  <m.div
                    key={item.id}
                    className="friend-request"
                    {...entrance()}
                    exit={{ opacity: 0 }}
                  >
                    <Avatar athlete={item} small />
                    <div>
                      <b>{item.displayName}</b>
                      <p>
                        {item.direction === "incoming"
                          ? "Хочет стать напарником"
                          : "Ждём подтверждения"}
                      </p>
                    </div>
                    {item.direction === "incoming" && (
                      <button
                        className="button primary"
                        disabled={busy}
                        onClick={() =>
                          void perform(
                            `/api/friends/connections/${item.id}`,
                            "PUT",
                            {},
                            "Напарник добавлен. Теперь вы видите активность друг друга.",
                          )
                        }
                      >
                        <Check size={16} />
                        Принять
                      </button>
                    )}
                    <button
                      className="icon-button"
                      aria-label={`${item.direction === "incoming" ? "Отклонить заявку" : "Отменить заявку"}: ${item.displayName}`}
                      disabled={busy}
                      onClick={() =>
                        void perform(
                          `/api/friends/connections/${item.id}`,
                          "DELETE",
                          {},
                          "Заявка удалена",
                        )
                      }
                    >
                      <X size={17} />
                    </button>
                  </m.div>
                ))}
              </AnimatePresence>
            </section>
          )}
          <TrainingMeetups
            error={error}
            data={data}
            workouts={workouts}
            busy={busy}
            mutate={perform}
            onStart={onStartMeetup}
          />
          <TeamChallenges key={data.me.id} data={data} />
          <div className="friends-columns">
            <div className="friends-main">
              <section aria-labelledby="team-title">
                <div className="section-head">
                  <h2 id="team-title">
                    Твоя команда{" "}
                    <span className="friend-count">{data.friends.length}</span>
                  </h2>
                  <span className="friends-live-label">
                    <span />
                    {live.length} в зале
                  </span>
                </div>
                {!data.friends.length ? (
                  <div className="friends-empty">
                    <Users size={32} />
                    <h3>Первый напарник — твой ход</h3>
                    <p>
                      Отправь приглашение другу. После принятия заявки здесь
                      появятся его тренировки и статус зала.
                    </p>
                    <button
                      className="button secondary"
                      onClick={() => setInvite(true)}
                    >
                      <UserPlus size={17} />
                      Пригласить напарника
                    </button>
                  </div>
                ) : (
                  <div className="friend-grid">
                    {[...data.friends]
                      .sort(
                        (a, b) =>
                          Number(b.activeUntil > clock) -
                            Number(a.activeUntil > clock) ||
                          a.displayName.localeCompare(b.displayName, "ru"),
                      )
                      .map((athlete, i) => (
                        <m.article
                          className="friend-card"
                          key={athlete.id}
                          {...entrance(i)}
                        >
                          <div className="friend-card-head">
                            <Avatar athlete={athlete} />
                            <span
                              className={`friend-presence ${athlete.activeUntil > clock ? "is-live" : ""}`}
                            >
                              {athlete.activeUntil > clock
                                ? "В зале"
                                : "Без статуса"}
                            </span>
                          </div>
                          <h3>{athlete.displayName}</h3>
                          <p className="friend-location">
                            <MapPin size={14} />
                            {athlete.gym || "Зал не указан"}
                          </p>
                          <p className="friend-focus">
                            {athlete.activeUntil > clock
                              ? athlete.focus || "Силовая тренировка"
                              : "До следующей тренировки"}
                          </p>
                          <div className="friend-week">
                            <span>
                              <Dumbbell size={14} />
                              {athlete.weekWorkouts} за неделю
                            </span>
                            <button
                              className="text-button"
                              aria-label={`Удалить напарника: ${athlete.displayName}`}
                              disabled={busy}
                              onClick={() => setRemoving(athlete)}
                            >
                              Удалить
                            </button>
                          </div>
                        </m.article>
                      ))}
                  </div>
                )}
              </section>
              <section className="friends-feed" aria-labelledby="feed-title">
                <div className="section-head">
                  <h2 id="feed-title">Лента тренировок</h2>
                  <span>Последние 30 дней</span>
                </div>
                {!data.feed.length ? (
                  <div className="friends-empty compact">
                    <Dumbbell size={26} />
                    <h3>Здесь будут ваши тренировки</h3>
                    <p>
                      Сохраните тренировку в журнале — она появится в ленте
                      команды.
                    </p>
                  </div>
                ) : (
                  data.feed.map((workout, index) => (
                    <m.article
                      key={workout.id}
                      className="friend-workout"
                      {...entrance(index)}
                    >
                      <div className="friend-workout-head">
                        <Avatar
                          athlete={{
                            id: workout.athleteId,
                            displayName: workout.displayName,
                          }}
                          small
                        />
                        <div>
                          <b>
                            {workout.displayName}
                            {workout.athleteId === data.me.id && (
                              <span className="muted"> · ты</span>
                            )}
                          </b>
                          <span>Завершена · {dateLabel(workout.date)}</span>
                        </div>
                        <CheckCheck size={18} className="text-accent" />
                      </div>
                      <h3>{workout.name}</h3>
                      <div className="friend-workout-stats">
                        <span>
                          <strong>{workout.setsCount}</strong> рабочих подходов
                        </span>
                        <span>
                          <strong>{workout.duration}</strong> мин
                        </span>
                        {workout.volumeKg > 0 && (
                          <span title="Только однозначно записанные свободные веса">
                            <strong>{fmt(workout.volumeKg / 1000)}</strong> т
                            свободных весов
                          </span>
                        )}
                      </div>
                      <div className="friend-workout-foot">
                        <span>
                          <Flame size={15} />
                          Тренировка в копилку команды
                        </span>
                        {workout.athleteId === data.me.id ? (
                          <span className="friend-own-kudos">
                            <ThumbsUp size={16} />
                            {workout.kudosCount}
                          </span>
                        ) : (
                          <m.button
                            whileTap={reduced ? undefined : { scale: 0.92 }}
                            className={`friend-kudos ${workout.hasGivenKudos ? "is-given" : ""}`}
                            aria-label={`Респект: ${workout.displayName}, ${workout.name}`}
                            aria-pressed={workout.hasGivenKudos}
                            disabled={busy}
                            onClick={() =>
                              void perform(
                                `/api/friends/kudos/${workout.id}`,
                                "PUT",
                                { given: !workout.hasGivenKudos },
                                workout.hasGivenKudos
                                  ? "Респект убран"
                                  : "Респект отправлен",
                              )
                            }
                          >
                            <m.span
                              key={String(workout.hasGivenKudos)}
                              initial={reduced ? false : { scale: 0.7 }}
                              animate={{ scale: 1 }}
                            >
                              <ThumbsUp size={16} />
                            </m.span>
                            Респект <b>{workout.kudosCount}</b>
                          </m.button>
                        )}
                      </div>
                    </m.article>
                  ))
                )}
                {data.feed.length === 60 && (
                  <p className="tiny">
                    Показаны 60 последних тренировок за 30 дней.
                  </p>
                )}
              </section>
            </div>
            <aside className="friends-aside">
              <section
                className="friends-week-card"
                aria-labelledby="week-title"
              >
                <span className="friends-card-icon">
                  <Trophy size={21} />
                </span>
                <span className="eyebrow">ОБЩИЙ ОРИЕНТИР</span>
                <h2 id="week-title">Неделя в движении</h2>
                <p>
                  У каждого свой недельный ориентир.
                  <br />У каждого свой вес и свой темп.
                </p>
                <div className="friends-team-score">
                  <strong>
                    {progress.done}
                    <span> / {progress.target}</span>
                  </strong>
                  <span>
                    {dateLabel(data.weekStart)} — {dateLabel(data.today)}
                  </span>
                </div>
                <div
                  className="friends-meter"
                  role="progressbar"
                  aria-label="Недельная активность команды"
                  aria-valuenow={progress.done}
                  aria-valuemin={0}
                  aria-valuemax={progress.target}
                >
                  <m.span
                    initial={false}
                    animate={{ width: `${progress.percent}%` }}
                    transition={{ duration: reduced ? 0 : 0.6 }}
                  />
                </div>
                <WeeklyGoal
                  key={data.me.weeklyTarget ?? 3}
                  value={data.me.weeklyTarget ?? 3}
                  busy={busy}
                  onSave={(target) =>
                    void perform(
                      "/api/friends/goal",
                      "PUT",
                      { target },
                      "Недельная цель сохранена",
                    )
                  }
                />
                <div className="friends-week-list">
                  {[...team]
                    .sort(
                      (a, b) =>
                        b.weekWorkouts - a.weekWorkouts ||
                        a.displayName.localeCompare(b.displayName, "ru"),
                    )
                    .map((athlete) => (
                      <div key={athlete.id}>
                        <Avatar athlete={athlete} small />
                        <span>
                          {athlete.id === data.me.id
                            ? "Ты"
                            : athlete.displayName}
                        </span>
                        <b>
                          {athlete.weekWorkouts}
                          <span> / {athlete.weeklyTarget ?? 3}</span>
                        </b>
                        {athlete.weekWorkouts >=
                          (athlete.weeklyTarget ?? 3) && (
                          <Check size={15} className="text-accent" />
                        )}
                      </div>
                    ))}
                </div>
                <p className="tiny">
                  Считаем сохранённые тренировки с понедельника, по твоему
                  часовому поясу. Это ориентир, а не обязательный план.
                </p>
              </section>
              <section className="friends-invite-card">
                <UserPlus size={22} />
                <h2>Код приглашения</h2>
                <p>Твой код напарника</p>
                <code className="friend-invite-code">
                  {data.me.inviteCode.match(/.{1,4}/g)?.join("–")}
                </code>
                <button
                  className="button secondary"
                  onClick={() => void share()}
                >
                  <Share2 size={17} />
                  Поделиться приглашением
                </button>
              </section>
              <p className="friends-privacy">
                <ShieldCheck size={18} />
                <span>
                  После принятия заявки видны статус зала и сводки тренировок за
                  30 дней. Почта, вес тела, заметки и детали подходов остаются
                  личными. Удаление напарника закрывает доступ.
                </span>
              </p>
            </aside>
          </div>
        </>
      )}
      {invite && data && (
        <Modal title="Добавить друга" onClose={dismissInvite}>
          <div className="friends-invite-dialog">
            <p>
              Отправь другу свой код или введи его приглашение. Вы увидите
              тренировки друг друга только после принятия заявки.
            </p>
            <div className="friends-code-box">
              <span>Твой код</span>
              <code className="friend-invite-code">
                {data.me.inviteCode.match(/.{1,4}/g)?.join("–")}
              </code>
              <button
                className="icon-button"
                aria-label="Скопировать код"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(data.me.inviteCode);
                    setNotice("Код скопирован");
                  } catch {
                    setError("Выдели и скопируй код вручную");
                  }
                }}
              >
                <Copy size={18} />
              </button>
            </div>
            <button className="button secondary" onClick={() => void share()}>
              <Share2 size={17} />
              Поделиться приглашением
            </button>
            <form onSubmit={request}>
              <label>
                Код или ссылка друга
                <input
                  autoFocus
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  maxLength={200}
                  placeholder="Например, A1B2C3D4E5F6"
                  autoCapitalize="characters"
                  autoComplete="off"
                  spellCheck={false}
                  required
                />
              </label>
              <p className="tiny">Друг найдёт свой код в разделе «Друзья».</p>
              <button
                className="button primary"
                disabled={busy || !code.trim()}
              >
                <UserPlus size={17} />
                {busy ? "Отправляем…" : "Отправить заявку"}
              </button>
            </form>
            {notice && (
              <p className="friends-notice" role="status">
                {notice}
              </p>
            )}
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
          </div>
        </Modal>
      )}
      {statusEditor && data && (
        <Modal title="Моя тренировка" onClose={() => setStatusEditor(false)}>
          <form
            className="friends-status-form"
            onSubmit={(e) => {
              e.preventDefault();
              const fields = new FormData(e.currentTarget);
              void perform(
                "/api/friends/status",
                "PUT",
                {
                  inGym: true,
                  gym: fields.get("gym"),
                  focus: fields.get("focus"),
                },
                "Ты в зале. Напарники увидят твой статус.",
                () => setStatusEditor(false),
              );
            }}
          >
            <p>
              Статус видят только принятые напарники. Он выключится через 2 часа
              или когда ты закончишь.
            </p>
            <label>
              Зал
              <input
                name="gym"
                maxLength={60}
                defaultValue={data.me.gym}
                placeholder="Например, Атлетика на Лесной"
              />
            </label>
            <label>
              Что тренируешь?
              <input
                name="focus"
                maxLength={80}
                defaultValue={data.me.focus}
                placeholder="Например, спина и бицепс"
              />
            </label>
            <button className="button primary" disabled={busy}>
              <Radio size={17} />
              {busy
                ? "Сохраняем…"
                : inGym
                  ? "Обновить статус на 2 часа"
                  : "Начать — я в зале"}
            </button>
            {inGym && (
              <button
                type="button"
                className="button secondary"
                disabled={busy}
                onClick={() =>
                  void perform(
                    "/api/friends/status",
                    "PUT",
                    { inGym: false, gym: data.me.gym, focus: data.me.focus },
                    "Статус зала выключен",
                    () => setStatusEditor(false),
                  )
                }
              >
                Закончил тренировку
              </button>
            )}
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
          </form>
        </Modal>
      )}
      {removing && (
        <Modal title="Удалить напарника?" onClose={() => setRemoving(null)}>
          <p>
            {removing.displayName} больше не увидит твою активность, а ты — его
            тренировки. Чтобы вернуться в команду, понадобится новая заявка.
          </p>
          <div className="modal-actions">
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => setRemoving(null)}
            >
              Оставить
            </button>
            <button
              className="button primary"
              disabled={busy}
              onClick={() =>
                void perform(
                  `/api/friends/connections/${removing.id}`,
                  "DELETE",
                  {},
                  "Напарник удалён",
                  () => setRemoving(null),
                )
              }
            >
              Удалить напарника
            </button>
          </div>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
        </Modal>
      )}
    </div>
  );
}
