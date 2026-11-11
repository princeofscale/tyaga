import { useEffect } from "react";
import { AnimatePresence, m } from "motion/react";
import { Timer, Users } from "lucide-react";
import { LivePresenter } from "../domain/LiveSession";
import { useNow } from "../lib/useNow";
import { useLiveRoom } from "./LiveRoomProvider";
import { Avatar } from "./friendsShared";

/** Полоса напарников над тренировкой: кто что делает, пока ты работаешь. Показывается, только если в комнате есть кто-то ещё. */
export default function LiveStrip({ onOpen }: { onOpen: () => void }) {
  const { room, watch } = useLiveRoom();
  useEffect(() => watch(), [watch]);
  const others = room?.members.filter((member) => !member.isMe) ?? [];
  const now = useNow(others.some((member) => member.state?.phase === "resting"));
  return (
    <AnimatePresence initial={false}>
      {room && others.length ? (
        <m.section
          key="strip"
          className="live-strip"
          aria-label="Напарники в комнате"
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          exit={{ opacity: 0, height: 0 }}
          transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
        >
          <div className="live-strip-row">
            <button type="button" className="live-strip-room" onClick={onOpen} aria-label={`Открыть комнату ${room.code}`}>
              <Users size={15} aria-hidden="true" />
              {room.code}
            </button>
            <ul>
              {others.map((member) => {
                const rest = member.state?.phase === "resting" ? LivePresenter.restLeft(member.state, now) : 0;
                return (
                  <li key={member.id} className={rest > 0 ? "resting" : ""}>
                    <Avatar seed={member.tag ?? member.displayName} name={member.displayName} size="sm" />
                    <span>
                      <b>{member.displayName}</b>
                      <small>{LivePresenter.headline(member, now)}</small>
                    </span>
                    {rest > 0 ? (
                      <i aria-hidden="true">
                        <Timer size={12} />
                      </i>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </div>
        </m.section>
      ) : null}
    </AnimatePresence>
  );
}
