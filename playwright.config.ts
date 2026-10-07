import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/e2e",
  workers: 1,
  timeout: 45000,
  fullyParallel: false,
  use: {
    baseURL: "http://localhost:5173",
    browserName: "chromium",
    locale: "ru-RU",
    timezoneId: "Europe/Amsterdam",
    viewport: { width: 1440, height: 1080 },
    reducedMotion: "reduce",
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? {
          executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
          args: ["--no-sandbox"],
        }
      : {},
  },
  webServer: [
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
  outputDir: "artifacts/playwright",
});
