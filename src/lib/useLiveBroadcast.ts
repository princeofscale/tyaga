import { useEffect, useRef, useState } from "react";
import { useLiveRoom } from "../components/LiveRoomProvider";
import { LiveBroadcastPolicy } from "../domain/LiveSession";
import { entryName } from "./catalog";
import type { Draft } from "./draft";

/**
 * Передаёт состояние идущей тренировки в комнату. Правка сохранённой тренировки не транслируется.
 * Если черновик закончен или убран в другой вкладке (ключ черновика исчез из localStorage), эта вкладка устарела
 * и замолкает: комната — одна ячейка на человека, и устаревший heartbeat затирал бы «Закончил» (R09-QA-02).
 */
export function useLiveBroadcast(draft: Draft | null, draftKey: string) {
  const { broadcast } = useLiveRoom();
  const [released, setReleased] = useState<string | null>(null);
  const current = useRef(draft);
  current.current = draft;
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== draftKey || e.newValue !== null || e.storageArea !== localStorage) return;
      const mine = current.current;
      if (mine && !mine.editing) setReleased(mine.workout.id);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [draftKey]);
  useEffect(() => {
    broadcast(LiveBroadcastPolicy.stateFor(draft, Date.now(), entryName, released));
  }, [draft, broadcast, released]);
}
