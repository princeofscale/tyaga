import { apiClient } from "./ApiClient";
import type { AthleteProfile, LiveRoom, LiveState, SocialOverview } from "../lib/social";

/** Клиент раздела «Напарники»: все данные живут на сервере аккаунта. */
export class SocialService {
  overview(signal?: AbortSignal) {
    return apiClient.request<SocialOverview>("/api/social", "GET", undefined, signal);
  }
  saveProfile(profile: AthleteProfile) {
    return apiClient.request<{ profile: AthleteProfile }>("/api/social/profile", "PUT", profile);
  }
  follow(tag: string) {
    return apiClient.request<SocialOverview>("/api/social/follow", "POST", { tag });
  }
  unfollow(tag: string) {
    return apiClient.request<SocialOverview>("/api/social/follow/" + encodeURIComponent(tag), "DELETE", {});
  }
  kudos(workoutId: string, give: boolean) {
    return apiClient.request<{ kudos: number; kudosByMe: boolean }>("/api/social/kudos", "PUT", { workoutId, give });
  }

  /** Комната совместной тренировки, в которой я сейчас сижу, или null. */
  liveRoom(signal?: AbortSignal) {
    return apiClient.request<{ room: LiveRoom | null }>("/api/social/live", "GET", undefined, signal);
  }
  createRoom() {
    return apiClient.request<{ room: LiveRoom }>("/api/social/live", "POST", {});
  }
  joinRoom(code: string) {
    return apiClient.request<{ room: LiveRoom }>("/api/social/live/join", "POST", { code });
  }
  /** Выложить состояние тренировки; в ответе — свежий состав комнаты. */
  pushLive(state: LiveState) {
    return apiClient.request<{ room: LiveRoom }>("/api/social/live/state", "PUT", state);
  }
  leaveRoom() {
    return apiClient.request<{ room: null }>("/api/social/live", "DELETE", {});
  }
}
export const socialService = new SocialService();
