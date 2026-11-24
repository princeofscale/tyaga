import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import { serviceWorkerPlugin } from "./scripts/serviceWorkerPlugin";

// The Android version (android/app/build.gradle) lets the app spot a newer APK.
const gradle = readFileSync("android/app/build.gradle", "utf8");
const appVersion = {
  code: Number(gradle.match(/versionCode (\d+)/)![1]),
  name: gradle.match(/versionName "([^"]+)"/)![1],
};

// `vite build --mode device` is the Android build: the API runs in the app.
export default defineConfig(({ mode }) => ({
  plugins: [react(), ...(mode === "device" ? [] : [serviceWorkerPlugin("dist/client")])],
  define: { __APP_VERSION__: JSON.stringify(appVersion) },
  build: {
    outDir: mode === "device" ? "dist/device" : "dist/client",
    sourcemap: false,
    // Keep fonts as external files so strict CSP `font-src 'self'` never blocks base64 data: fonts.
    assetsInlineLimit: (filePath) => (filePath.endsWith(".woff2") ? false : undefined),
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (
            id.includes("/node_modules/react/") ||
            id.includes("/node_modules/react-dom/") ||
            id.includes("/node_modules/scheduler/")
          )
            return "react";
          if (id.includes("/node_modules/motion") || id.includes("/node_modules/framer-motion"))
            return "motion";
          if (id.includes("/node_modules/lucide-react"))
            return "icons";
          if (
            id.includes("/src/data/catalog-v3") ||
            id.includes("/src/data/muscles") ||
            id.includes("/src/lib/catalog")
          )
            return "catalog";
        },
      },
    },
  },
  server: { port: 5173, proxy: { "/api": "http://127.0.0.1:8787" } },
  preview: { proxy: { "/api": "http://127.0.0.1:8787" } },
}));
