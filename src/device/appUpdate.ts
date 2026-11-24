// Android only: the website publishes /app-version.json next to /tyaga.apk
// (scripts/copy-apk.mjs). A newer version shows a banner; installing downloads
// the APK, verifies its SHA-256 checksum, and opens Android's installer.
import { registerPlugin } from "@capacitor/core";
import { Directory, Filesystem } from "@capacitor/filesystem";
import { CLOUD_URL } from "./cloudSync";
import { parseRelease, type Release } from "./release";

export type { Release } from "./release";
const ApkInstaller = registerPlugin<{ install(options: { path: string }): Promise<void> }>("ApkInstaller");
const UPDATE_APK_FILE = "tyaga-update.apk";

const toHex = (buf: ArrayBuffer) =>
  [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

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

export async function installUpdate(
  onProgress: (percent: number) => void,
  expectedSha256?: string,
) {
  let sha256 = expectedSha256;
  if (!sha256) {
    const release = await findUpdate();
    sha256 = release?.sha256;
  }
  if (!sha256) {
    throw new Error("Обновление отклонено: отсутствует контрольная сумма SHA-256.");
  }
  const progress = await Filesystem.addListener("progress", (p) => {
    if (p.contentLength) onProgress(Math.round((100 * p.bytes) / p.contentLength));
  });
  let downloaded = false;
  try {
    const { path } = await Filesystem.downloadFile({
      url: `${CLOUD_URL}/tyaga.apk`,
      path: UPDATE_APK_FILE,
      directory: Directory.Cache,
      progress: true,
    });
    downloaded = true;
    const file = await Filesystem.readFile({
      path: UPDATE_APK_FILE,
      directory: Directory.Cache,
    });
    const bytes =
      typeof file.data === "string"
        ? base64ToBytes(file.data)
        : new Uint8Array(await file.data.arrayBuffer());
    const actualHash = toHex(await crypto.subtle.digest("SHA-256", bytes.buffer as ArrayBuffer));
    if (actualHash !== sha256.toLowerCase()) {
      throw new Error("Контрольная сумма APK не совпала. Установка отменена.");
    }
    await ApkInstaller.install({ path: path! });
  } finally {
    await progress.remove();
    if (downloaded) {
      await Filesystem.deleteFile({
        path: UPDATE_APK_FILE,
        directory: Directory.Cache,
      }).catch(() => {});
    }
  }
}
