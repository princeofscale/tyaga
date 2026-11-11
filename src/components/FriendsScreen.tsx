import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { AnimatePresence, m } from "motion/react";
import { AtSign, Clock3, Crown, Flame, Link2, LoaderCircle, Lock, Plus, UserMinus, UserPlus, Users } from "lucide-react";
import { InviteLink } from "../domain/LiveSession";
import type { Invite } from "../lib/invite";
import { dateLabel, fmt } from "../lib/model";
import { pluralRu } from "../lib/plural";
import {
  TAG_PATTERN,
  normalizeTag,
  type FeedWorkout,
  type FollowedAthlete,
  type IncomingAthlete,
  type SocialOverview,
  type StandingRow,
} from "../lib/social";
import { socialService } from "../services/SocialService";
import { useLiveRoom } from "./LiveRoomProvider";
import TogetherCard from "./TogetherCard";
import { Avatar, errorText, shareLink } from "./friendsShared";

const EASE = [0.22, 1, 0.36, 1] as const;
const onDevice = import.meta.env.MODE === "device";
type Tab = "feed" | "week" | "people";
const TABS: { id: Tab; label: string }[] = [
  { id: "feed", label: "Лента" },
  { id: "week", label: "Неделя" },
  { id: "people", label: "Люди" },
];
const WORKOUTS = ["тренировка", "тренировки", "тренировок"] as const;

/** Без подписок начинаем с «Людей»: пока искать некого, ни лента, ни таблица недели ничего не покажут. */
const firstTab = (overview: SocialOverview): Tab => (overview.following.length || overview.feed.length ? "feed" : "people");

type Props = {
  /** Ссылка-приглашение, с которой человек пришёл. */
  invite: Invite | null;
  onInviteHandled: () => void;
  onToast: (text: string) => void;
  workoutActive: boolean;
  onWorkout: () => void;
};

/** Баннер приглашения: подписаться на атлета или войти в комнату одним нажатием. */
function InviteBanner({
  invite,
  onDone,
  onFollowed,
  onToast,
}: {
  invite: Invite;
  onDone: () => void;
  onFollowed: (overview: SocialOverview) => void;
  onToast: (text: string) => void;
}) {
  const { join, room } = useLiveRoom();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function accept() {
    setBusy(true);
    setError("");
    try {
      if (invite.room) {
        // Причину отказа (нет такой комнаты, она заполнена) показывает карточка «Вместе».
        if (await join(invite.room)) {
          onToast(`Ты в комнате ${invite.room}`);
          onDone();
        }
      } else if (invite.tag) {
        onFollowed(await socialService.follow(invite.tag));
        onToast(`Теперь ты следишь за @${invite.tag}`);
        onDone();
      }
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  const switching = Boolean(invite.room && room && room.code !== invite.room);
  return (
    <m.section
      className="friend-card invite-banner"
      role="region"
      aria-label="Приглашение"
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      transition={{ duration: 0.3, ease: EASE }}
    >
      <div>
        <b>{invite.room ? `Тебя зовут в комнату ${invite.room}` : `Тебя позвали следить за @${invite.tag}`}</b>
        <small>
          {invite.room
            ? switching
              ? "Ты выйдешь из текущей комнаты."
              : "Вы увидите подходы и отдых друг друга."
            : "Его тренировки появятся в твоей ленте."}
        </small>
      </div>
      <div className="invite-actions">
        <button type="button" className="button primary" disabled={busy} onClick={() => void accept()}>
          {invite.room ? (switching ? "Перейти" : "Войти") : "Следить"}
        </button>
        <button type="button" className="button secondary" disabled={busy} onClick={onDone}>
          Не сейчас
        </button>
      </div>
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
    </m.section>
  );
}

function ProfileCard({
  overview,
  onSaved,
  onToast,
}: {
  overview: SocialOverview;
  onSaved: (profile: NonNullable<SocialOverview["profile"]>) => void;
  onToast: (text: string) => void;
}) {
  const profile = overview.profile;
  const [editing, setEditing] = useState(!profile);
  const [tag, setTag] = useState(profile?.tag ?? "");
  const [bio, setBio] = useState(profile?.bio ?? "");
  const [isPublic, setIsPublic] = useState(profile?.isPublic ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const clean = normalizeTag(tag);
  const valid = TAG_PATTERN.test(clean);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    setError("");
    try {
      const saved = await socialService.saveProfile({ tag: clean, bio: bio.trim(), isPublic });
      onSaved(saved.profile);
      setEditing(false);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  if (profile && !editing)
    return (
      <section className="friend-card friend-me" aria-label="Мой профиль напарника">
        <div className="friend-me-head">
          <Avatar seed={profile.tag} name={profile.tag} />
          <div>
            <b>@{profile.tag}</b>
            <small>{profile.bio || "Без описания"}</small>
          </div>
        </div>
        <div className="friend-me-stats">
          <span>
            <b>{overview.followers}</b> {pluralRu(overview.followers, ["следит", "следят", "следят"])} за тобой
          </span>
          <span className={profile.isPublic ? "on" : ""}>
            {profile.isPublic ? (
              "Тренировки видны напарникам"
            ) : (
              <>
                <Lock size={12} aria-hidden="true" /> Профиль закрыт
              </>
            )}
          </span>
        </div>
        <div className="friend-form-actions">
          {profile.isPublic ? (
            <button
              type="button"
              className="button primary"
              onClick={() =>
                void shareLink(
                  {
                    title: "Тяга",
                    text: `Следи за моими тренировками в Тяге: @${profile.tag}`,
                    url: InviteLink.build(window.location.origin, profile.tag),
                  },
                  onToast,
                )
              }
            >
              <Link2 size={16} aria-hidden="true" />
              Позвать по ссылке
            </button>
          ) : null}
          <button type="button" className="button secondary" onClick={() => setEditing(true)}>
            Изменить профиль
          </button>
        </div>
      </section>
    );

  return (
    <form className="friend-card friend-form" onSubmit={save}>
      <h2>{profile ? "Профиль напарника" : "Создай профиль"}</h2>
      {!profile ? <p>Тег нужен, чтобы напарники нашли тебя. Пока профиля нет, тебя никто не видит.</p> : null}
      <label>
        Тег
        <span className="friend-input">
          <AtSign size={16} aria-hidden="true" />
          <input
            value={tag}
            onChange={(e) => setTag(e.target.value)}
            placeholder="ivan_power"
            maxLength={21}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            aria-invalid={tag !== "" && !valid}
          />
        </span>
        <small className={tag !== "" && !valid ? "bad" : ""}>3–20 символов: латиница, цифры, «_»</small>
      </label>
      <label>
        О себе
        <textarea value={bio} onChange={(e) => setBio(e.target.value)} maxLength={140} rows={2} placeholder="Жму, тяну, приседаю" />
      </label>
      <label className="friend-switch">
        <input type="checkbox" checked={isPublic} onChange={(e) => setIsPublic(e.target.checked)} />
        <span aria-hidden="true" />
        <b>Показывать тренировки напарникам</b>
      </label>
      <small className="friend-note">
        Напарникам видны название, подходы, тоннаж, время и мышцы. Заметки, веса и упражнения остаются у тебя.
      </small>
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="friend-form-actions">
        <button className="button primary" disabled={!valid || busy}>
          {busy ? "Сохраняем…" : "Сохранить профиль"}
        </button>
        {profile ? (
          <button type="button" className="button secondary" onClick={() => setEditing(false)}>
            Отмена
          </button>
        ) : null}
      </div>
    </form>
  );
}

function People({
  overview,
  onOverview,
  onToast,
}: {
  overview: SocialOverview;
  onOverview: (next: SocialOverview) => void;
  onToast: (text: string) => void;
}) {
  const [tag, setTag] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function follow(target: string) {
    const clean = normalizeTag(target);
    if (!clean || busy) return false;
    setBusy(true);
    setError("");
    try {
      onOverview(await socialService.follow(clean));
      return true;
    } catch (e) {
      setError(errorText(e));
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function unfollow(target: string) {
    try {
      onOverview(await socialService.unfollow(target));
    } catch (e) {
      setError(errorText(e));
    }
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (await follow(tag)) setTag("");
  }

  return (
    <div className="people">
      <ProfileCard overview={overview} onSaved={(profile) => onOverview({ ...overview, profile })} onToast={onToast} />

      <form className="friend-card friend-add" onSubmit={submit}>
        <h2>Найти напарника</h2>
        <span className="friend-input">
          <AtSign size={16} aria-hidden="true" />
          <input
            aria-label="Тег напарника"
            value={tag}
            onChange={(e) => setTag(e.target.value)}
            placeholder="тег напарника"
            maxLength={21}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
          />
          <button className="button primary" disabled={busy || !normalizeTag(tag)} aria-label="Следить за напарником">
            <Plus size={16} aria-hidden="true" />
            Следить
          </button>
        </span>
        <AnimatePresence>
          {error ? (
            <m.p className="form-error" role="alert" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}>
              {error}
            </m.p>
          ) : null}
        </AnimatePresence>
        <small className="friend-note">Находит только открытые профили. Спроси тег у друга: он виден в его разделе «Напарники».</small>
      </form>

      <AnimatePresence initial={false}>
        {overview.incoming.length ? (
          <m.section
            key="incoming"
            className="friend-card"
            aria-label="Следят за тобой"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.3, ease: EASE }}
          >
            <h2>Следят за тобой · {overview.incoming.length}</h2>
            <ul className="friend-list">
              <AnimatePresence initial={false}>
                {overview.incoming.map((a: IncomingAthlete) => (
                  <m.li key={a.tag} layout exit={{ opacity: 0, x: 20 }} transition={{ duration: 0.25, ease: EASE }}>
                    <Avatar seed={a.tag} name={a.displayName} />
                    <span>
                      <b>{a.displayName}</b>
                      <small>@{a.tag}</small>
                    </span>
                    <button
                      type="button"
                      className="button secondary compact"
                      disabled={busy}
                      onClick={() => {
                        void follow(a.tag).then((ok) => ok && onToast(`Теперь ты следишь за @${a.tag}`));
                      }}
                    >
                      <UserPlus size={15} aria-hidden="true" />
                      В ответ
                    </button>
                  </m.li>
                ))}
              </AnimatePresence>
            </ul>
          </m.section>
        ) : null}
      </AnimatePresence>

      {overview.following.length ? (
        <section className="friend-card" aria-label="Напарники">
          <h2>Напарники · {overview.following.length}</h2>
          <ul className="friend-list">
            <AnimatePresence initial={false}>
              {overview.following.map((a: FollowedAthlete) => (
                <m.li
                  key={a.tag}
                  layout
                  initial={{ opacity: 0, x: -12 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 20 }}
                  transition={{ duration: 0.3, ease: EASE }}
                >
                  <Avatar seed={a.tag} name={a.displayName} />
                  <span>
                    <b>
                      {a.displayName}
                      {a.mutual ? <i className="mutual">взаимно</i> : null}
                    </b>
                    <small>
                      @{a.tag} ·{" "}
                      {a.workoutsLast7Days
                        ? `${a.workoutsLast7Days} ${pluralRu(a.workoutsLast7Days, WORKOUTS)} за неделю`
                        : a.lastDate
                          ? `был ${dateLabel(a.lastDate)}`
                          : "пока без тренировок"}
                    </small>
                  </span>
                  <button type="button" className="icon-button" aria-label={`Перестать следить за @${a.tag}`} onClick={() => void unfollow(a.tag)}>
                    <UserMinus size={16} />
                  </button>
                </m.li>
              ))}
            </AnimatePresence>
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function Standings({ rows, onFind }: { rows: StandingRow[]; onFind: () => void }) {
  if (rows.length < 2)
    return (
      <div className="friend-card friend-empty">
        <Crown size={30} aria-hidden="true" />
        <h2>Неделя ждёт соперников</h2>
        <p>Добавь напарника по тегу: здесь появится таблица рабочего тоннажа за семь дней.</p>
        <button type="button" className="button primary" onClick={onFind}>
          Найти напарника
        </button>
      </div>
    );
  const idle = rows.every((row) => row.tonnageKg === 0);
  return (
    <section className="friend-card standings" aria-label="Таблица недели">
      <header>
        <h2>Неделя</h2>
        <small>Рабочий тоннаж за 7 дней. Разминка не считается.</small>
      </header>
      <ol>
        {rows.map((row, index) => (
          <m.li
            key={row.isMe ? "me" : row.tag}
            layout="position"
            className={`${row.isMe ? "me" : ""} ${row.leader ? "leader" : ""}`}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: Math.min(index, 8) * 0.05, ease: EASE }}
          >
            <span className="rank" aria-label={`Место ${row.rank}`}>
              {row.leader ? <Crown size={17} aria-hidden="true" /> : row.rank}
            </span>
            <Avatar seed={row.tag || row.displayName} name={row.displayName} />
            <span className="standing-main">
              <b>{row.isMe ? "Ты" : row.displayName}</b>
              <small>
                {row.sessions
                  ? `${row.sessions} ${pluralRu(row.sessions, WORKOUTS)} · ${row.sets} подх.`
                  : "без тренировок"}
              </small>
              <span className="standing-bar" aria-hidden="true">
                <m.span
                  initial={{ scaleX: 0 }}
                  animate={{ scaleX: row.share }}
                  transition={{ duration: 0.7, delay: 0.15 + Math.min(index, 8) * 0.06, ease: EASE }}
                />
              </span>
            </span>
            <span className="standing-value">
              {fmt(row.tonnageKg / 1000)}
              <small> т</small>
            </span>
          </m.li>
        ))}
      </ol>
      {idle ? <p className="friend-note">На этой неделе никто ещё не тренировался. Первый подход выведет в лидеры.</p> : null}
    </section>
  );
}

function FeedCard({ item, index, onKudos }: { item: FeedWorkout; index: number; onKudos: (item: FeedWorkout) => void }) {
  return (
    <m.article
      className="friend-card feed-card"
      layout="position"
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, delay: Math.min(index, 8) * 0.06, ease: EASE }}
    >
      <header>
        <Avatar seed={item.athlete.tag} name={item.athlete.displayName} />
        <span>
          <b>{item.athlete.displayName}</b>
          <small>
            @{item.athlete.tag} · {dateLabel(item.date, true)}
          </small>
        </span>
      </header>
      <h3>{item.title}</h3>
      <dl className="feed-stats">
        <div>
          <dt>Подходов</dt>
          <dd>{item.sets}</dd>
        </div>
        <div>
          <dt>Тоннаж</dt>
          <dd>
            {fmt(item.tonnageKg / 1000)}
            <small> т</small>
          </dd>
        </div>
        <div>
          <dt>Время</dt>
          <dd>
            {item.duration > 0 ? (
              <>
                {item.duration}
                <small> мин</small>
              </>
            ) : (
              <Clock3 size={15} aria-label="не записано" />
            )}
          </dd>
        </div>
      </dl>
      <footer>
        <span className="feed-chips">
          {item.muscles.map((name) => (
            <i key={name}>{name}</i>
          ))}
        </span>
        <m.button
          type="button"
          className={`kudos-button ${item.kudosByMe ? "given" : ""}`}
          aria-pressed={item.kudosByMe}
          aria-label={item.kudosByMe ? "Убрать респект" : "Дать респект"}
          whileTap={{ scale: 0.9 }}
          onClick={() => onKudos(item)}
        >
          <m.span
            key={String(item.kudosByMe)}
            initial={{ scale: item.kudosByMe ? 0.4 : 1, rotate: item.kudosByMe ? -25 : 0 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ type: "spring", stiffness: 500, damping: 14 }}
            className="kudos-icon"
          >
            <Flame size={17} aria-hidden="true" />
          </m.span>
          Респект
          <b>{item.kudos}</b>
        </m.button>
      </footer>
    </m.article>
  );
}

function Feed({ overview, onKudos, onFind }: { overview: SocialOverview; onKudos: (item: FeedWorkout) => void; onFind: () => void }) {
  if (overview.feed.length)
    return (
      <div className="feed-list">
        {overview.feed.map((item, i) => (
          <FeedCard key={item.id} item={item} index={i} onKudos={onKudos} />
        ))}
      </div>
    );
  const noFollowing = overview.following.length === 0;
  return (
    <div className="friend-card friend-empty">
      <Users size={30} aria-hidden="true" />
      <h2>{noFollowing ? "Лента пуста" : "Напарники пока не тренировались"}</h2>
      <p>
        {noFollowing
          ? "Добавь напарника по тегу — его тренировки появятся здесь, и ты сможешь дать респект."
          : "Как только кто-то из них запишет тренировку, она появится в ленте."}
      </p>
      {noFollowing ? (
        <button type="button" className="button primary" onClick={onFind}>
          Найти напарника
        </button>
      ) : null}
    </div>
  );
}

export default function FriendsScreen({ invite, onInviteHandled, onToast, workoutActive, onWorkout }: Props) {
  const [overview, setOverview] = useState<SocialOverview | null>(null);
  const [loadError, setLoadError] = useState("");
  const [tab, setTab] = useState<Tab | null>(null);
  const mounted = useRef(true);

  const load = useCallback(async () => {
    try {
      const data = await socialService.overview();
      if (mounted.current) {
        setOverview(data);
        // Раздел выбираем один раз, при открытии экрана: иначе первая подписка перебросит человека с «Людей» в «Ленту».
        setTab((current) => current ?? firstTab(data));
        setLoadError("");
      }
    } catch (e) {
      if (mounted.current) setLoadError(errorText(e));
    }
  }, []);
  useEffect(() => {
    mounted.current = true;
    if (!onDevice) void load();
    return () => {
      mounted.current = false;
    };
  }, [load]);

  if (onDevice)
    return (
      <section className="friend-card friend-empty">
        <Users size={30} aria-hidden="true" />
        <h2>Напарники работают в облачной версии</h2>
        <p>Здесь журнал хранится только на телефоне. Открой Тягу в браузере под своим аккаунтом, чтобы найти напарников и тренироваться вместе.</p>
      </section>
    );

  if (!overview)
    return (
      <div className="friend-loading" role={loadError ? "alert" : "status"}>
        {loadError ? (
          <>
            <p>{loadError}</p>
            <button className="button primary" onClick={() => void load()}>
              Повторить
            </button>
          </>
        ) : (
          <>
            <LoaderCircle className="spin" size={22} aria-hidden="true" /> Открываем напарников…
          </>
        )}
      </div>
    );

  async function toggleKudos(item: FeedWorkout) {
    const give = !item.kudosByMe;
    const patch = (kudos: number, kudosByMe: boolean) =>
      setOverview((o) => (o ? { ...o, feed: o.feed.map((f) => (f.id === item.id ? { ...f, kudos, kudosByMe } : f)) } : o));
    patch(Math.max(0, item.kudos + (give ? 1 : -1)), give);
    try {
      const result = await socialService.kudos(item.id, give);
      patch(result.kudos, result.kudosByMe);
    } catch (e) {
      patch(item.kudos, item.kudosByMe);
      onToast(errorText(e));
    }
  }

  const active: Tab = tab ?? firstTab(overview);
  const moveTab = (event: KeyboardEvent<HTMLButtonElement>) => {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    const next = TABS[(TABS.findIndex((t) => t.id === active) + step + TABS.length) % TABS.length].id;
    setTab(next);
    document.getElementById(`friends-tab-${next}`)?.focus();
  };

  return (
    <div className="friends-screen">
      <div className="friends-together">
        <AnimatePresence initial={false}>
          {invite ? (
            <InviteBanner key="invite" invite={invite} onDone={onInviteHandled} onFollowed={setOverview} onToast={onToast} />
          ) : null}
        </AnimatePresence>
        <TogetherCard workoutActive={workoutActive} onWorkout={onWorkout} onToast={onToast} />
      </div>

      <div className="friends-main">
        <div className="friends-tabs" role="tablist" aria-label="Разделы напарников">
          {TABS.map((t) => (
            <button
              key={t.id}
              id={`friends-tab-${t.id}`}
              type="button"
              role="tab"
              aria-selected={active === t.id}
              aria-controls="friends-panel"
              tabIndex={active === t.id ? 0 : -1}
              className={active === t.id ? "active" : ""}
              onClick={() => setTab(t.id)}
              onKeyDown={moveTab}
            >
              {active === t.id ? (
                <m.span layoutId="friends-tab-pill" className="friends-tab-pill" transition={{ type: "spring", stiffness: 480, damping: 38 }} />
              ) : null}
              <span>{t.label}</span>
            </button>
          ))}
        </div>
        <m.div
          key={active}
          id="friends-panel"
          role="tabpanel"
          aria-labelledby={`friends-tab-${active}`}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.28, ease: EASE }}
        >
          {active === "feed" ? <Feed overview={overview} onKudos={(it) => void toggleKudos(it)} onFind={() => setTab("people")} /> : null}
          {active === "week" ? <Standings rows={overview.standings} onFind={() => setTab("people")} /> : null}
          {active === "people" ? <People overview={overview} onOverview={setOverview} onToast={onToast} /> : null}
        </m.div>
      </div>
    </div>
  );
}
