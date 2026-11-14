import { defineConfig } from "@playwright/test";
import original from "./playwright.config";

// Original real-API fixtures require exactly 5173/8787. Never reuse servers;
// a busy port must fail rather than silently point tests at somebody's data.
export default defineConfig({
  ...original,
  // Partitions original suite from role-only QA/PO visit specs, and does not drop any originally executed test.
  testMatch: [
    "**/tests/e2e/biomechanics.spec.ts",
    "**/tests/e2e/daily-workflow.spec.ts",
    "**/tests/e2e/design.spec.ts",
    "**/tests/e2e/friends.spec.ts",
    "**/tests/e2e/program.spec.ts",
    "**/tests/e2e/progress.spec.ts",
    "**/tests/e2e/together.spec.ts",
    "**/tests/e2e/workout.spec.ts",
  ],
  forbidOnly: true,
  retries: 0,
  outputDir: "artifacts/agent-evolution/baseline-e2e/test-output",
  reporter: [
    ["list"],
    ["json", { outputFile: "artifacts/agent-evolution/baseline-e2e/results.json" }],
  ],
  use: {
    ...original.use,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: [
    {
      command: "npx wrangler d1 migrations apply DB --local --config wrangler.agent-evolution.jsonc --persist-to .wrangler/agent-evolution-e2e && npx wrangler dev --local --config wrangler.agent-evolution.jsonc --ip 127.0.0.1 --port 8787 --persist-to .wrangler/agent-evolution-e2e",
      url: "http://127.0.0.1:8787/api/auth/session",
      reuseExistingServer: false,
      timeout: 120000,
    },
    {
      command: "npx vite preview --port 5173 --host 127.0.0.1 --strictPort",
      url: "http://localhost:5173",
      reuseExistingServer: false,
      timeout: 60000,
    },
  ],
});
