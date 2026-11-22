import { defineConfig } from "@playwright/test";

// Быстрый цикл визуальной проверки: только статическая сборка, без воркера и D1.
// Все запросы к /api/** в design.spec.ts перехвачены в браузере (fixtures).
export default defineConfig({
  testDir: "./tests/e2e",
  workers: 1,
  timeout: 90000,
  use: {
    baseURL: "http://127.0.0.1:5686",
    browserName: "chromium",
    locale: "ru-RU",
    timezoneId: "Europe/Saratov",
    viewport: { width: 1440, height: 1080 },
    reducedMotion: "reduce",
    // Фикстуры перехватывают HTTP-запросы; офлайн-кэш не должен подменять ответы.
    serviceWorkers: "block",
  },
  webServer: [
    {
      command: "npx vite preview --strictPort --port 5686 --host 127.0.0.1",
      url: "http://127.0.0.1:5686",
      reuseExistingServer: false,
      timeout: 60000,
    },
  ],
  outputDir: "artifacts/playwright-visual",
});
