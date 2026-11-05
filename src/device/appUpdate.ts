// Android only: the website publishes /app-version.json next to /tyaga.apk
// (scripts/copy-apk.mjs). A newer version shows a banner; installing downloads
// the APK and opens Android's installer, where the person confirms.
import { registerPlugin } from "@capacitor/core";
import { Directory, Filesystem } from "@capacitor/filesystem";
import { CLOUD_URL } from "./cloudSync";
import { parseRelease, type Release } from "./release";

export type { Release } from "./release";
const ApkInstaller = registerPlugin<{ install(options: { path: string }): Promise<void> }>("ApkInstaller");

/**
 * Resolves to a newer release, or null when there is none. A failed check
 * rejects instead of returning null, so a phone that opens the app offline does
 * not look like "already up to date" and the next launch checks again.
 */
export async function findUpdate(): Promise<Release | null> {
  if (!CLOUD_URL) return null;
  // AbortSignal.timeout needs Chrome 103; android/variables.gradle allows older
  // WebViews, so the deadline is a plain timer.
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(`${CLOUD_URL}/app-version.json`, {
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) throw new Error("Версия приложения недоступна");
    // A missing file still answers 200 with the SPA shell, so a body that is not
    // a release record is a failed check, not "no update".
    const release = parseRelease(await response.json());
    if (!release) throw new Error("Неизвестный формат версии");
    return release.versionCode > __APP_VERSION__.code ? release : null;
  } finally {
    clearTimeout(deadline);
  }
}

export async function installUpdate(onProgress: (percent: number) => void) {
  const progress = await Filesystem.addListener("progress", (p) => {
    if (p.contentLength) onProgress(Math.round((100 * p.bytes) / p.contentLength));
  });
  try {
    const { path } = await Filesystem.downloadFile({
      url: `${CLOUD_URL}/tyaga.apk`,
      path: "tyaga-update.apk",
      directory: Directory.Cache,
      progress: true,
    });
    await ApkInstaller.install({ path: path! });
  } catch {
    // Fall back to the browser: Capacitor opens other sites outside the app.
    location.href = `${CLOUD_URL}/tyaga.apk`;
  } finally {
    await progress.remove();
  }
}
