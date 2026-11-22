import { defineConfig } from "@playwright/test";
// Временный конфиг для проверки одного сценария Лейда, не трогая локальную базу .wrangler/dev.
export default defineConfig({
  testDir: "./tests/e2e",
  testIgnore: ["**/agent-*.spec.ts"],
  workers: 1,
  timeout: 45000,
  fullyParallel: false,
  use: {
    baseURL: "http://localhost:5191",
    browserName: "chromium",
    locale: "ru-RU",
    timezoneId: "Europe/Amsterdam",
    viewport: { width: 1440, height: 1080 },
    reducedMotion: "reduce",
    serviceWorkers: "block",
  },
  webServer: [
    {
      command:
        "npx wrangler d1 migrations apply DB --local --persist-to .wrangler/check-laid && npx wrangler dev --config wrangler.jsonc --ip 127.0.0.1 --port 8791 --persist-to .wrangler/check-laid",
      url: "http://localhost:8791/api/auth/session",
      reuseExistingServer: false,
      timeout: 60000,
    },
    {
      command: "npx vite preview --port 5191 --host 127.0.0.1",
      url: "http://localhost:5191",
      reuseExistingServer: false,
      timeout: 60000,
    },
  ],
  outputDir: "artifacts/playwright-laid-check",
});
