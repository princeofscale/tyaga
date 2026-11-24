import { useEffect, useState } from "react";
import { LogOut, Share2, Users, WifiOff } from "lucide-react";
import { LiveLink, RoomLink } from "../domain/LiveSession";
import { CLOUD_URL } from "../device/cloudSync";
import { quantity } from "../lib/quantity";
import { shareLink } from "../lib/shareLink";
import { useLiveRoom } from "../lib/liveRoomContext";

const linkOrigin = () => (import.meta.env.MODE === "device" ? CLOUD_URL : window.location.origin);

/**
 * R04-REQ04: пока человек в комнате «Вместе», на экране тренировки видно, что подходы идут напарникам:
 * код, число участников, «Поделиться» и «Выйти из комнаты» (с вопросом).
 */
export default function RoomBadge({ onToast }: { onToast: (text: string) => void }) {
  const { room, leave, watch, busy, linkLost } = useLiveRoom();
  const [asking, setAsking] = useState(false);
  useEffect(() => watch(), [watch]);
  // Комната закрылась или человек вышел с другого экрана: вопрос не должен «залипнуть» до следующей комнаты.
  useEffect(() => {
    if (!room) setAsking(false);
  }, [room]);
  if (!room) return null;
  const members = quantity(room.members.length, "участник", "участника", "участников");
  const link = RoomLink.build(linkOrigin(), room.code);
  return (
    <section className="room-badge" aria-label="Комната совместной тренировки">
      <div className="room-badge-row">
        <span className="room-badge-title">
          <Users size={16} aria-hidden="true" />
          <b title="Напарники видят твои подходы и отдых">
            Комната {room.code} · {members}
          </b>
        </span>
        <span className="room-badge-actions">
          <button
            type="button"
            className="room-badge-btn"
            aria-label="Поделиться"
            title="Поделиться ссылкой на комнату"
            onClick={() => {
              void shareLink(
                { title: "Тренируемся вместе", text: `Заходи в мою комнату в Тяге. Код: ${room.code}`, url: link },
                onToast,
              );
            }}
          >
            <Share2 size={16} aria-hidden="true" />
            <span className="room-badge-label" aria-hidden="true">Поделиться</span>
          </button>
          <button
            type="button"
            className="room-badge-btn"
            aria-label="Выйти из комнаты"
            title="Выйти из комнаты"
            disabled={busy}
            onClick={() => setAsking(true)}
          >
            <LogOut size={16} aria-hidden="true" />
            <span className="room-badge-label" aria-hidden="true">Выйти</span>
          </button>
        </span>
      </div>
      {linkLost ? (
        <p className="room-badge-lost" role="status" title={LiveLink.DETAIL}>
          <WifiOff size={13} aria-hidden="true" />
          <span>{LiveLink.MESSAGE}</span>
        </p>
      ) : null}
      {asking ? (
        <div className="room-badge-ask" role="alertdialog" aria-label="Выйти из комнаты?">
          <p>Выйти из комнаты {room.code}? Напарники перестанут видеть твою тренировку. Сама тренировка продолжится.</p>
          <div className="room-badge-ask-actions">
            <button
              type="button"
              className="button danger"
              disabled={busy}
              onClick={async () => {
                await leave();
                setAsking(false);
                onToast("Ты вышел из комнаты");
              }}
            >
              Выйти
            </button>
            <button type="button" className="button secondary" autoFocus onClick={() => setAsking(false)}>
              Остаться
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
