import { useEffect, useId, useState, type FormEvent } from "react";
import { AnimatePresence, m } from "motion/react";
import { Check, Copy, DoorOpen, LoaderCircle, LogOut, Play, Share2, Timer, Users, WifiOff } from "lucide-react";
import { LivePresenter, RoomCode, RoomLink } from "../domain/LiveSession";
import { CLOUD_URL } from "../device/cloudSync";
import type { LiveMember } from "../lib/liveRoom";
import { copyText, shareLink } from "../lib/shareLink";
import { useNow } from "../lib/useNow";
import LiveAvatar from "./LiveAvatar";
import { useLiveRoom } from "./LiveRoomProvider";

const EASE = [0.22, 1, 0.36, 1] as const;
const linkOrigin = () => (import.meta.env.MODE === "device" ? CLOUD_URL : window.location.origin);

function MemberRow({ member, now }: { member: LiveMember; now: number }) {
  const state = member.state;
  const away = LivePresenter.isAway(member, now);
  const rest = LivePresenter.restLeft(state, now);
  const resting = state?.phase === "resting" && rest > 0;
  const phase = away ? "away" : state?.phase === "done" ? "done" : resting ? "resting" : state ? state.phase : "waiting";
  return (
    <m.li
      className={`live-member ${member.isMe ? "me" : ""} ${phase}`}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -16 }}
      transition={{ duration: 0.32, ease: EASE }}
    >
      <LiveAvatar name={member.displayName} />
      <span className="live-member-text">
        <b>
          {member.displayName}
          {member.isMe ? <i> · ты</i> : null}
        </b>
        <small>{LivePresenter.headline(member, now)}</small>
        <span className="live-bar" aria-hidden="true">
          <m.span
            initial={{ scaleX: 0 }}
            animate={{ scaleX: state?.phase === "done" ? 1 : LivePresenter.progress(state) }}
            transition={{ duration: 0.6, ease: EASE }}
          />
        </span>
      </span>
      <span className="live-member-side" aria-hidden="true">
        {phase === "done" ? <Check size={18} /> : null}
        {phase === "resting" ? (
          <span className="live-rest">
            <Timer size={14} />
            {LivePresenter.clock(rest)}
          </span>
        ) : null}
        {phase === "away" ? <WifiOff size={16} /> : null}
        {state && phase !== "done" && phase !== "away" && phase !== "resting" ? (
          <span className="live-tonnage">{Math.round((state.tonnageKg / 1000) * 10) / 10} т</span>
        ) : null}
      </span>
    </m.li>
  );
}

/** «Вместе»: создать комнату, войти по коду и видеть, кто что делает прямо сейчас. */
export default function TogetherCard({
  workoutActive,
  onWorkout,
  onToast,
  quietErrors = false,
}: {
  workoutActive: boolean;
  onWorkout: () => void;
  onToast: (text: string) => void;
  /** Причину отказа уже показывает приглашение над карточкой, второй раз её не повторяем. */
  quietErrors?: boolean;
}) {
  const { room, ready, busy, error, create, join, leave, watch } = useLiveRoom();
  const [joining, setJoining] = useState(false);
  const [code, setCode] = useState("");
  const fieldId = useId();
  useEffect(() => watch(), [watch]);
  const resting = room?.members.some((member) => member.state?.phase === "resting") ?? false;
  const now = useNow(resting);
  const clean = RoomCode.normalize(code);
  const failure =
    error && !quietErrors ? (
      <p className="form-error" role="alert">
        {error}
      </p>
    ) : null;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!RoomCode.isValid(clean) || busy) return;
    if (await join(clean)) {
      setJoining(false);
      setCode("");
    }
  }

  if (!ready)
    return (
      <section className="together" aria-busy="true">
        <p className="together-loading" role="status">
          <LoaderCircle className="spin" size={18} aria-hidden="true" /> Проверяем комнату…
        </p>
      </section>
    );

  if (!room)
    return (
      <section className="together" aria-label="Тренироваться вместе">
        <Users size={26} aria-hidden="true" className="together-icon" />
        <h2>Тренируйтесь вместе</h2>
        <p>Создай комнату и отправь код напарнику. Вы видите подходы и отдых друг друга прямо во время тренировки.</p>
        <div className="together-actions">
          <button type="button" className="button primary" disabled={busy} onClick={() => void create()}>
            {busy && !joining ? "Создаём…" : "Создать комнату"}
          </button>
          <button type="button" className="button secondary" aria-expanded={joining} onClick={() => setJoining((open) => !open)}>
            <DoorOpen size={16} aria-hidden="true" />
            Ввести код
          </button>
        </div>
        <AnimatePresence initial={false}>
          {joining ? (
            <m.form
              key="join"
              className="together-join"
              onSubmit={submit}
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.25, ease: EASE }}
            >
              <label htmlFor={fieldId}>Код комнаты</label>
              <span className="join-field">
                <input
                  id={fieldId}
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                  placeholder="H7KQ2"
                  maxLength={9}
                  autoFocus
                  autoCapitalize="characters"
                  autoCorrect="off"
                  spellCheck={false}
                  aria-invalid={code !== "" && !RoomCode.isValid(clean)}
                />
                <button className="button primary" disabled={!RoomCode.isValid(clean) || busy}>
                  {busy ? "Входим…" : "Войти"}
                </button>
              </span>
            </m.form>
          ) : null}
        </AnimatePresence>
        {failure}
      </section>
    );

  const alone = room.members.length === 1;
  const link = RoomLink.build(linkOrigin(), room.code);
  return (
    <section className="together live" aria-label="Комната совместной тренировки">
      <header className="room-head">
        <span className="room-label">Комната</span>
        <div className="room-code" role="img" aria-label={`Код комнаты ${[...room.code].join(" ")}`}>
          {[...room.code].map((char, index) => (
            <m.span
              key={`${room.code}-${index}`}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35, delay: index * 0.05, ease: EASE }}
            >
              {char}
            </m.span>
          ))}
        </div>
        <div className="room-tools">
          <button type="button" className="icon-button" aria-label="Скопировать код" onClick={() => void copyText(room.code, "Код скопирован", onToast)}>
            <Copy size={18} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label="Позвать напарника"
            onClick={() =>
              void shareLink({ title: "Тренируемся вместе", text: `Заходи в мою комнату в Тяге. Код: ${room.code}`, url: link }, onToast)
            }
          >
            <Share2 size={18} aria-hidden="true" />
          </button>
        </div>
      </header>

      <ul className="live-members">
        <AnimatePresence initial={false}>
          {room.members.map((member) => (
            <MemberRow key={member.id} member={member} now={now} />
          ))}
        </AnimatePresence>
      </ul>

      {alone ? <p className="together-hint">Пока ты один. Отправь код или ссылку — напарник увидит твои подходы, как только войдёт.</p> : null}
      {failure}
      <footer className="together-actions">
        <button type="button" className="button primary" onClick={onWorkout}>
          <Play size={16} aria-hidden="true" />
          {workoutActive ? "Открыть тренировку" : "Начать тренировку"}
        </button>
        <button type="button" className="button secondary" onClick={() => void leave()}>
          <LogOut size={16} aria-hidden="true" />
          Покинуть комнату
        </button>
      </footer>
    </section>
  );
}
