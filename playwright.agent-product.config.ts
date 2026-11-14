import { defineConfig } from '@playwright/test';
import original from './playwright.config';

// Product-owner visits are bounded: Playwright owns this local Worker until teardown.
// Persisted data survives; this does not promise a server after the CLI invocation.
const visit = process.env.TYAGA_AGENT_VISIT;
if (!visit || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(visit)) {
  throw new Error('Set TYAGA_AGENT_VISIT to a unique safe visit name before discovery or execution.');
}
const evidenceRoot = `artifacts/agent-evolution/product-visits/${visit}`;

export default defineConfig({
  ...original,
  testMatch: '**/agent-po*.spec.ts',
  testIgnore: [],
  forbidOnly: true,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  repeatEach: 1,
  outputDir: `${evidenceRoot}/test-output`,
  reporter: [['list'], ['json', { outputFile: `${evidenceRoot}/results.json` }]],
  projects: [
    { name: 'desktop-chromium', use: { browserName: 'chromium', viewport: { width: 1280, height: 900 } } },
    { name: 'mobile-chromium', use: { browserName: 'chromium', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  ],
  use: {
    ...original.use,
    baseURL: 'http://127.0.0.1:8795',
    trace: 'on',
    screenshot: 'on',
  },
  webServer: {
    command: 'npx --no-install wrangler d1 migrations apply DB --local --config wrangler.agent-evolution.jsonc --persist-to .wrangler/agent-evolution && npx --no-install wrangler dev --local --config wrangler.agent-evolution.jsonc --ip 127.0.0.1 --port 8795 --persist-to .wrangler/agent-evolution',
    url: 'http://127.0.0.1:8795/api/auth/session',
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
