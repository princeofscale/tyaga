// Ships the latest Android build with the website (npm run deploy:cloud):
// /tyaga.apk to download and /app-version.json for in-app update checks.
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
