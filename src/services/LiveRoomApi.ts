import type { LiveRoom, LiveState } from "../lib/liveRoom";
import { friendsApi } from "./FriendsApi";

type Reply = { room: LiveRoom | null };

/**
 * Комнаты «Вместе». Ходят через тот же клиент, что и напарники: на Android это прямой вызов
 * подключённого облака (без облака он сообщит об этом), в браузере — обычный запрос к воркеру.
 */
export class LiveRoomApi {
  /** Комната, в которой человек сейчас, или null. */
  current(signal?: AbortSignal) {
    return friendsApi.request<Reply>("/api/friends/live", "GET", undefined, signal);
  }

  create() {
    return friendsApi.request<Reply>("/api/friends/live", "POST");
  }

  join(code: string) {
    return friendsApi.request<Reply>("/api/friends/live/join", "POST", { code });
  }

  push(state: LiveState) {
    return friendsApi.request<Reply>("/api/friends/live/state", "PUT", state);
  }

  leave() {
    return friendsApi.request<Reply>("/api/friends/live", "DELETE");
  }
}

export const liveRoomApi = new LiveRoomApi();
