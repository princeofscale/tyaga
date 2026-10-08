// Ships the latest Android build with the website as /tyaga.apk (npm run deploy:cloud).
import { copyFileSync, existsSync } from "node:fs";

const apk = "android/app/build/outputs/apk/debug/app-debug.apk";
if (existsSync(apk)) {
  copyFileSync(apk, "dist/client/tyaga.apk");
  console.log("tyaga.apk added to the site");
} else
  console.warn(`No ${apk} — the site ships without an APK. Build it first: npm run build:android, then gradlew assembleDebug.`);
