import { useEffect } from "react";
import { useLiveRoom } from "../components/LiveRoomProvider";
import { LiveBroadcastPolicy } from "../domain/LiveSession";
import { entryName } from "./catalog";
import type { Draft } from "./draft";

/** Передаёт состояние идущей тренировки в комнату. Правка сохранённой тренировки не транслируется. */
export function useLiveBroadcast(draft: Draft | null) {
  const { broadcast } = useLiveRoom();
  useEffect(() => {
    broadcast(LiveBroadcastPolicy.stateFor(draft, Date.now(), entryName));
  }, [draft, broadcast]);
}
