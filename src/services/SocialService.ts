import { apiClient } from "./ApiClient";
import type { AthleteProfile, SocialOverview } from "../lib/social";

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
}
export const socialService = new SocialService();
