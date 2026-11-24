import { useEffect, useState } from "react";

let cachedAvailable: boolean | null = null;
let inflight: Promise<boolean> | null = null;

/**
 * Проверяет, опубликован ли Android APK на текущем домене.
 * Без опубликованного /app-version.json SPA-fallback отдавал бы index.html вместо APK.
 */
export async function checkAndroidApkAvailable(
  fetcher: typeof fetch = fetch,
): Promise<boolean> {
  if (cachedAvailable !== null) return cachedAvailable;
  if (!inflight) {
    inflight = fetcher("/app-version.json", { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) return false;
        const ct = res.headers.get("content-type") ?? "";
        if (!ct.includes("application/json")) return false;
        const data = (await res.json()) as { versionCode?: unknown };
        return typeof data?.versionCode === "number" && data.versionCode > 0;
      })
      .catch(() => false)
      .then((ok) => {
        cachedAvailable = ok;
        inflight = null;
        return ok;
      });
  }
  return inflight;
}

export function resetAndroidApkCache() {
  cachedAvailable = null;
  inflight = null;
}

export function useAndroidApkAvailable(): boolean {
  const [available, setAvailable] = useState(() => cachedAvailable === true);
  useEffect(() => {
    if (import.meta.env.MODE === "device") return;
    let active = true;
    void checkAndroidApkAvailable().then((ok) => {
      if (active) setAvailable(ok);
    });
    return () => {
      active = false;
    };
  }, []);
  return available;
}
