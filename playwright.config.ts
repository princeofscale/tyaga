import { defineConfig } from "@playwright/test";

const visualMode = process.env.TYAGA_PLAYWRIGHT_MODE === "visual";

export default defineConfig({
  testDir: "./tests/e2e",
  workers: 1,
  timeout: visualMode ? 90000 : 45000,
  fullyParallel: false,
  use: {
    baseURL: visualMode ? "http://127.0.0.1:5686" : "http://localhost:5173",
    browserName: "chromium",
    locale: "ru-RU",
    timezoneId: visualMode ? "Europe/Saratov" : "Europe/Amsterdam",
    viewport: { width: 1440, height: 1080 },
    reducedMotion: "reduce",
    // Сервис-воркер включается только в сценарии офлайна (offline-pwa.spec.ts).
    serviceWorkers: "block",
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? {
          executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
          args: ["--no-sandbox"],
        }
      : {},
  },
  webServer: visualMode
    ? [
        {
          command: "npx vite preview --strictPort --port 5686 --host 127.0.0.1",
          url: "http://127.0.0.1:5686",
          reuseExistingServer: false,
          timeout: 60000,
        },
      ]
    : [
        {
          command:
            "npx wrangler d1 migrations apply DB --local --persist-to .wrangler/e2e && npm run preview:server -- --port 8787 --persist-to .wrangler/e2e",
          url: "http://localhost:8787/api/auth/session",
          reuseExistingServer: !process.env.CI,
          timeout: 60000,
        },
        {
          command: "npx vite preview --port 5173 --host 0.0.0.0",
          url: "http://localhost:5173",
          reuseExistingServer: !process.env.CI,
          timeout: 60000,
        },
      ],
  outputDir: visualMode ? "test-results/visual" : "test-results/playwright",
});
