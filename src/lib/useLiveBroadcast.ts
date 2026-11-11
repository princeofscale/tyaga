import { useEffect } from "react";
import { useLiveRoom } from "../components/LiveRoomProvider";
import { LiveStateBuilder } from "../domain/LiveSession";
import { entryName } from "./catalog";
import type { Draft } from "./draft";

/** Передаёт состояние идущей тренировки в комнату. Правка старой тренировки не транслируется. */
export function useLiveBroadcast(draft: Draft | null) {
  const { broadcast } = useLiveRoom();
  useEffect(() => {
    if (!draft || draft.editing) {
      broadcast(null);
      return;
    }
    broadcast(
      LiveStateBuilder.fromWorkout(draft.workout, {
        now: Date.now(),
        nameOf: entryName,
        // Отдых на паузе для напарников выглядит как обычный подход: таймер у них не тикает.
        restEndsAt: draft.pausedRest === null ? draft.restUntil : null,
      }),
    );
  }, [draft, broadcast]);
}
