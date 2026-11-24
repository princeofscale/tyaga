// Optional manual step after a web build; not run by npm run deploy:cloud.
// Ships /tyaga.apk and paired /app-version.json (with SHA-256 integrity hash)
// from an explicitly built signed release Android APK.
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";

const allowDebug = process.argv.includes("--debug");
const variant = allowDebug ? "debug" : "release";
const dir = `android/app/build/outputs/apk/${variant}/`;
const apkFile = `${dir}app-${variant}.apk`;
const metadataFile = `${dir}output-metadata.json`;

if (existsSync(apkFile) && existsSync(metadataFile)) {
  // Gradle's metadata describes exactly the APK that was built.
  const { versionCode, versionName } = JSON.parse(readFileSync(metadataFile, "utf8")).elements[0];
  const sha256 = createHash("sha256").update(readFileSync(apkFile)).digest("hex");
  copyFileSync(apkFile, "dist/client/tyaga.apk");
  writeFileSync(
    "dist/client/app-version.json",
    JSON.stringify({ versionCode, versionName, sha256 }),
  );
  console.log(`tyaga.apk (${variant}) ${versionName} (${versionCode}) sha256=${sha256.slice(0, 12)}… added to the site`);
} else {
  console.warn(
    `No ${apkFile} — the site ships without an APK. Build a signed release first: npm run build:android, then gradlew assembleRelease (or pass --debug for local testing).`,
  );
}
