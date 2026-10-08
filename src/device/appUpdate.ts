// Android only: the website publishes /app-version.json next to /tyaga.apk
// (scripts/copy-apk.mjs). A newer version shows a banner; installing downloads
// the APK and opens Android's installer, where the person confirms.
import { registerPlugin } from "@capacitor/core";
import { Directory, Filesystem } from "@capacitor/filesystem";
import { CLOUD_URL } from "./cloudSync";

export type Release = { versionCode: number; versionName: string };
const ApkInstaller = registerPlugin<{ install(options: { path: string }): Promise<void> }>("ApkInstaller");

export async function findUpdate(): Promise<Release | null> {
  if (!CLOUD_URL) return null;
  const response = await fetch(`${CLOUD_URL}/app-version.json`, {
    cache: "no-store",
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) return null;
  const release = (await response.json()) as Release;
  return release.versionCode > __APP_VERSION__.code ? release : null;
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
