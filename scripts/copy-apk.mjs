// Optional manual step after a web build; not run by npm run deploy:cloud.
// Ships /tyaga.apk and paired /app-version.json from an explicitly built Android APK.
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";

const dir = "android/app/build/outputs/apk/debug/";
if (existsSync(dir + "app-debug.apk")) {
  // Gradle's metadata describes exactly the APK that was built.
  const { versionCode, versionName } = JSON.parse(readFileSync(dir + "output-metadata.json", "utf8")).elements[0];
  copyFileSync(dir + "app-debug.apk", "dist/client/tyaga.apk");
  writeFileSync("dist/client/app-version.json", JSON.stringify({ versionCode, versionName }));
  console.log(`tyaga.apk ${versionName} (${versionCode}) added to the site`);
} else
  console.warn(`No ${dir}app-debug.apk — the site ships without an APK. Build it first: npm run build:android, then gradlew assembleDebug.`);
