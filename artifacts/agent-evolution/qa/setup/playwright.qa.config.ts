import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { resolve, dirname, basename, isAbsolute } from "node:path";
import { readFileSync, realpathSync } from "node:fs";
const root = fileURLToPath(new URL("../../../../", import.meta.url));
const artifact = resolve(root, "artifacts/agent-evolution/qa/setup");
const runTag = process.env.QA_RUN_TAG;
if (!runTag || !/^[a-z0-9-]{1,48}$/.test(runTag)) throw new Error("QA_RUN_TAG is required and must be safe");
const suppliedRoot = process.env.QA_RUN_ROOT, nonce = process.env.QA_FRESH_OWNER;
if (!suppliedRoot || !isAbsolute(suppliedRoot) || !nonce) throw new Error("External exclusive fresh QA_RUN_ROOT/QA_FRESH_OWNER gate is required");
const output = resolve(suppliedRoot);
if (dirname(output) !== artifact || basename(output) !== `browser-run-${runTag}` || realpathSync(output) !== output) throw new Error("QA output root must be canonical owned run root");
const ownership: { runTag?: string; nonce?: string; root?: string } = JSON.parse(readFileSync(resolve(output, "fresh-owner.json"), "utf8"));
if (ownership.runTag !== runTag || ownership.nonce !== nonce || ownership.root !== output) throw new Error("QA run root ownership gate mismatch");
// Caller must create this root EXCLUSIVELY, reject any pre-existing root before execution; discovery uses a distinct root/tag. Do not reuse a previous nonce.
export default defineConfig({
  testDir: resolve(root, "tests/e2e"),
  testMatch: ["agent-qa*.spec.ts"],
  outputDir: resolve(output, "browser-results"),
  timeout: 120000,
  expect: { timeout: 15000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: true,
  reporter: [["list"], ["json", { outputFile: resolve(output, "browser-report.json") }]],
  use: {
    baseURL: "http://127.0.0.1:8796",
    browserName: "chromium",
    trace: "on",
    screenshot: "only-on-failure",
    video: "off",
    extraHTTPHeaders: { "oai-authenticated-user-id": "qa-default-unused" },
  },
  webServer: {
    command: "node artifacts/agent-evolution/qa/setup/serve-qa.mjs",
    cwd: root,
    url: "http://127.0.0.1:8796",
    reuseExistingServer: false,
    timeout: 120000,
    stdout: "pipe",
    stderr: "pipe",
    gracefulShutdown: { signal: "SIGTERM", timeout: 15000 },
  },
  projects: [
    { name: "qa-desktop", use: { viewport: { width: 1440, height: 1080 } } },
    { name: "qa-mobile", use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  ],
});
