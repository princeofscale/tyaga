import { ApiClient } from "./ApiClient";
import { CLOUD_URL, cloudState } from "../device/cloudSync";

// Android social actions go directly to the connected cloud, never local SQLite.
// The journal retains its independent offline/sync behavior.
export const friendsApi = new ApiClient(
  async (input, init) => {
    if (import.meta.env.MODE !== "device") return fetch(input, init);
    const state = cloudState();
    if (!CLOUD_URL || !state)
      throw new Error("Подключи облако в профиле, чтобы добавить напарников");
    const headers = new Headers(init?.headers);
    headers.set("Authorization", `Bearer ${state.token}`);
    return fetch(CLOUD_URL + String(input), {
      ...init,
      headers,
      credentials: "omit",
    });
  },
  import.meta.env.MODE !== "device",
);
