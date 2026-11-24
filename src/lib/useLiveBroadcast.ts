import { useEffect, useRef, useState } from "react";
import { useLiveRoom } from "./liveRoomContext";
import { LiveBroadcastPolicy } from "../domain/LiveSession";
import { entryName } from "./catalog";
import { storedDraftId, type Draft } from "./draft";

/**
 * Передаёт состояние идущей тренировки в комнату. Правка сохранённой тренировки не транслируется.
 * Если именно наш черновик закончен или убран в другой вкладке (из localStorage исчез ключ с нашей тренировкой), эта вкладка устарела
 * и замолкает: комната — одна ячейка на человека, и устаревший heartbeat затирал бы «Закончил» (R09-QA-02).
 * Убранный чужой черновик (в соседней вкладке закончили или отменили другую тренировку) нас не касается (R09-QA-08).
 * Возвращает id отпущенной тренировки: вкладка не должна записывать её черновик обратно в localStorage (R09-QA-09).
 */
export function useLiveBroadcast(draft: Draft | null, draftKey: string): string | null {
  const { broadcast } = useLiveRoom();
  const [released, setReleased] = useState<string | null>(null);
  const current = useRef(draft);
  current.current = draft;
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== draftKey || e.newValue !== null || e.storageArea !== localStorage) return;
      const id = LiveBroadcastPolicy.releasedBy(current.current, storedDraftId(e.oldValue));
      if (id) setReleased(id);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [draftKey]);
  useEffect(() => {
    broadcast(LiveBroadcastPolicy.stateFor(draft, Date.now(), entryName, released));
  }, [draft, broadcast, released]);
  return released;
}
