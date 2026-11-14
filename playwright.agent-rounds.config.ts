import { defineConfig } from "@playwright/test";
import original from "./playwright.config";

// Requires a live 8795 stand during the same bounded owner invocation; not a persistent URL.
// Tests with hardcoded legacy URLs are run through agent-baseline instead.
export default defineConfig({
  ...original,
  forbidOnly: true,
  retries: 0,
  testIgnore: [
    "**/workout.spec.ts",
    "**/program.spec.ts",
    "**/friends.spec.ts",
    "**/together.spec.ts",
  ],
  webServer: undefined,
  outputDir: "artifacts/agent-evolution/round-e2e/test-output",
  reporter: [
    ["list"],
    ["json", { outputFile: "artifacts/agent-evolution/round-e2e/results.json" }],
  ],
  use: {
    ...original.use,
    baseURL: "http://127.0.0.1:8795",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
});
