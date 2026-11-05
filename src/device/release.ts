// Android only: parsing of /app-version.json. Kept free of Capacitor imports so
// the comparison can be tested in Node, where there is no WebView.
export type Release = { versionCode: number; versionName: string };

/** A release record from the website, or null when the shape is not a release. */
export function parseRelease(value: unknown): Release | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const versionCode = record.versionCode;
  if (typeof versionCode !== "number" || !Number.isInteger(versionCode)) return null;
  if (versionCode < 1) return null;
  const versionName =
    typeof record.versionName === "string" ? record.versionName.slice(0, 40) : "";
  return { versionCode, versionName };
}

/** The release only when it is newer than the installed build. */
export function newerRelease(value: unknown, currentCode: number): Release | null {
  const release = parseRelease(value);
  return release && release.versionCode > currentCode ? release : null;
}
