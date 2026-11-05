import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";

// The Android version (android/app/build.gradle) lets the app spot a newer APK.
const gradle = readFileSync("android/app/build.gradle", "utf8");
const appVersion = {
  code: Number(gradle.match(/versionCode (\d+)/)![1]),
  name: gradle.match(/versionName "([^"]+)"/)![1],
};

// `vite build --mode device` is the Android build: the API runs in the app.
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  define: { __APP_VERSION__: JSON.stringify(appVersion) },
  build: {
    outDir: mode === "device" ? "dist/device" : "dist/client",
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (
            id.includes("/node_modules/react/") ||
            id.includes("/node_modules/react-dom/") ||
            id.includes("/node_modules/scheduler/")
          )
            return "react";
        },
      },
    },
  },
  server: { port: 5173, proxy: { "/api": "http://127.0.0.1:8787" } },
}));
