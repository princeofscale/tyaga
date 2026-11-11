import { apiClient, ApiClient } from "./ApiClient";
import { CLOUD_URL, cloudState } from "../device/cloudSync";
/** Pin native credentials to this journal instance so switching cloud accounts cannot replay its outbox elsewhere. */
export function weightClient(): ApiClient {
  if (import.meta.env.MODE !== "device") return apiClient;
  const identity = cloudState();
  return new ApiClient(async (input, init) => {
    if (!identity || !CLOUD_URL || cloudState()?.token !== identity.token)
      throw new Error("Подключи облако в профиле, чтобы синхронизировать вес");
    const headers = new Headers(init?.headers);
    headers.set("Authorization", `Bearer ${identity.token}`);
    return fetch(CLOUD_URL + String(input), {
      ...init,
      headers,
      credentials: "omit",
    });
  }, false);
}
