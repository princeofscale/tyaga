import { useEffect, useId } from "react";
import { DoorOpen } from "lucide-react";
import { useLiveRoom } from "./LiveRoomProvider";

/**
 * Ссылка в комнату сама никого не впускает: вход показывает остальным имя человека и его подходы,
 * поэтому сначала спрашиваем. Пока неизвестно, сидит ли человек уже в комнате, ничего не показываем.
 */
export default function RoomInvite({
  code,
  onDone,
  onToast,
}: {
  code: string;
  /** Приглашение обработано: человек вошёл, отказался или уже был в этой комнате. */
  onDone: () => void;
  onToast: (text: string) => void;
}) {
  const { room, ready, busy, error, join, clearError } = useLiveRoom();
  const titleId = useId();
  const already = ready && room?.code === code;
  // Уже здесь: повторно входить незачем.
  useEffect(() => {
    if (already) onDone();
  }, [already, onDone]);
  if (!ready || already) return null;
  const switching = room !== null;
  return (
    <section className="together invite-banner" aria-labelledby={titleId}>
      <div>
        <h2 id={titleId}>Тебя зовут в комнату {code}</h2>
        <p>{switching ? "Ты выйдешь из текущей комнаты." : "Вы увидите подходы и отдых друг друга."}</p>
      </div>
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="together-actions">
        <button
          type="button"
          className="button primary"
          disabled={busy}
          onClick={async () => {
            if (!(await join(code))) return;
            onToast(`Ты в комнате ${code}`);
            onDone();
          }}
        >
          <DoorOpen size={16} aria-hidden="true" />
          {busy ? "Входим…" : switching ? "Перейти" : "Войти в комнату"}
        </button>
        <button
          type="button"
          className="button secondary"
          onClick={() => {
            clearError();
            onDone();
          }}
        >
          Не сейчас
        </button>
      </div>
    </section>
  );
}
