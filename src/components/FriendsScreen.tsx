import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { AnimatePresence, m } from "motion/react";
import { AtSign, Clock3, Flame, LoaderCircle, Lock, Plus, UserMinus, Users } from "lucide-react";
import { dateLabel, fmt } from "../lib/model";
import { TAG_PATTERN, normalizeTag, type FeedWorkout, type FollowedAthlete, type SocialOverview } from "../lib/social";
import { socialService } from "../services/SocialService";

const EASE = [0.22, 1, 0.36, 1] as const;
const PALETTE = ["#cafa64", "#ff9d42", "#b6a1e8", "#58c0ff", "#ff7676", "#5fd6a2"];
const onDevice = import.meta.env.MODE === "device";

/** Цвет аватара зависит от тега, поэтому у одного человека он одинаков везде. */
const colorOf = (tag: string) => PALETTE[[...tag].reduce((n, c) => n + c.charCodeAt(0), 0) % PALETTE.length];
const initialOf = (name: string) => (name.trim()[0] ?? "?").toUpperCase();
const message = (error: unknown) => (error instanceof Error ? error.message : "Не удалось выполнить запрос");

function Avatar({ tag, name }: { tag: string; name: string }) {
  return (
    <span className="friend-avatar" style={{ background: colorOf(tag) }} aria-hidden="true">
      {initialOf(name)}
    </span>
  );
}

function ProfileCard({
  overview,
  onSaved,
}: {
  overview: SocialOverview;
  onSaved: (profile: NonNullable<SocialOverview["profile"]>) => void;
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
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }

  if (profile && !editing)
    return (
      <section className="friend-card friend-me" aria-label="Мой профиль напарника">
        <div className="friend-me-head">
          <Avatar tag={profile.tag} name={profile.tag} />
          <div>
            <b>@{profile.tag}</b>
            <small>{profile.bio || "Без описания"}</small>
          </div>
        </div>
        <div className="friend-me-stats">
          <span>
            <b>{overview.followers}</b> следят за тобой
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
        <button type="button" className="button secondary" onClick={() => setEditing(true)}>
          Изменить профиль
        </button>
      </section>
    );

  return (
    <form className="friend-card friend-form" onSubmit={save}>
      <h2>{profile ? "Профиль напарника" : "Создай профиль"}</h2>
      {!profile ? <p>Тег нужен, чтобы друзья нашли тебя. Пока профиль закрыт, тебя никто не видит.</p> : null}
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

function FollowingList({
  athletes,
  onRemove,
}: {
  athletes: FollowedAthlete[];
  onRemove: (tag: string) => void;
}) {
  if (!athletes.length) return null;
  return (
    <section className="friend-card" aria-label="Напарники">
      <h2>Напарники · {athletes.length}</h2>
      <ul className="friend-list">
        <AnimatePresence initial={false}>
          {athletes.map((a) => (
            <m.li
              key={a.tag}
              layout
              initial={{ opacity: 0, x: -12 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20, height: 0 }}
              transition={{ duration: 0.3, ease: EASE }}
            >
              <Avatar tag={a.tag} name={a.displayName} />
              <span>
                <b>{a.displayName}</b>
                <small>
                  @{a.tag} · {a.workoutsLast7Days ? `${a.workoutsLast7Days} трен. за неделю` : a.lastDate ? `был ${dateLabel(a.lastDate)}` : "пока без тренировок"}
                </small>
              </span>
              <button type="button" className="icon-button" aria-label={`Перестать следить за @${a.tag}`} onClick={() => onRemove(a.tag)}>
                <UserMinus size={16} />
              </button>
            </m.li>
          ))}
        </AnimatePresence>
      </ul>
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
        <Avatar tag={item.athlete.tag} name={item.athlete.displayName} />
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

export default function FriendsScreen() {
  const [overview, setOverview] = useState<SocialOverview | null>(null);
  const [loadError, setLoadError] = useState("");
  const [tag, setTag] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const live = useRef(true);

  const load = useCallback(async () => {
    try {
      const data = await socialService.overview();
      if (live.current) {
        setOverview(data);
        setLoadError("");
      }
    } catch (e) {
      if (live.current) setLoadError(message(e));
    }
  }, []);
  useEffect(() => {
    live.current = true;
    if (!onDevice) void load();
    return () => {
      live.current = false;
    };
  }, [load]);

  if (onDevice)
    return (
      <section className="friend-card friend-empty">
        <Users size={30} aria-hidden="true" />
        <h2>Напарники работают в облачной версии</h2>
        <p>Здесь журнал хранится только на телефоне. Открой Тягу в браузере под своим аккаунтом, чтобы найти напарников и видеть их ленту.</p>
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

  async function follow(event: FormEvent) {
    event.preventDefault();
    const clean = normalizeTag(tag);
    if (!clean || busy) return;
    setBusy(true);
    setError("");
    try {
      setOverview(await socialService.follow(clean));
      setTag("");
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function unfollow(target: string) {
    try {
      setOverview(await socialService.unfollow(target));
    } catch (e) {
      setError(message(e));
    }
  }
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
      setError(message(e));
    }
  }

  const noFollowing = overview.following.length === 0;
  return (
    <div className="friends-screen">
      <div className="friends-side">
        <ProfileCard overview={overview} onSaved={(profile) => setOverview((o) => (o ? { ...o, profile } : o))} />
        <form className="friend-card friend-add" onSubmit={follow}>
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
        <FollowingList athletes={overview.following} onRemove={(t) => void unfollow(t)} />
      </div>

      <div className="friends-feed">
        <div className="section-head">
          <h2>Лента</h2>
          <span>Последние 45 дней</span>
        </div>
        {overview.feed.length ? (
          <div className="feed-list">
            {overview.feed.map((item, i) => (
              <FeedCard key={item.id} item={item} index={i} onKudos={(it) => void toggleKudos(it)} />
            ))}
          </div>
        ) : (
          <div className="friend-card friend-empty">
            <Users size={30} aria-hidden="true" />
            <h2>{noFollowing ? "Лента пуста" : "Напарники пока не тренировались"}</h2>
            <p>
              {noFollowing
                ? "Добавь напарника по тегу — его тренировки появятся здесь, и ты сможешь дать респект."
                : "Как только кто-то из них запишет тренировку, она появится в ленте."}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
