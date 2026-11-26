import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildServiceWorkerSource, computeBundleVersion } from "../scripts/serviceWorkerPlugin";

test("computeBundleVersion changes when un-hashed file contents change", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "tyaga-sw-"));
  try {
    writeFileSync(path.join(dir, "manifest.webmanifest"), '{"name":"v1"}');
    writeFileSync(path.join(dir, "index.html"), "<html>v1</html>");
    const v1 = computeBundleVersion(dir, ["manifest.webmanifest", "index.html"]);

    writeFileSync(path.join(dir, "manifest.webmanifest"), '{"name":"v2"}');
    const v2 = computeBundleVersion(dir, ["manifest.webmanifest", "index.html"]);

    assert.notEqual(v1, v2, "modifying un-hashed manifest content must produce a new SW version");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("generated service worker never self-activates, uses non-atomic precache, guards HTML fallback, and caps catalog cache", () => {
  const sw = buildServiceWorkerSource("abc123def456", ["/", "/manifest.webmanifest", "/assets/index.js"]);
  const installBlock = sw.slice(sw.indexOf('self.addEventListener("install"'), sw.indexOf('self.addEventListener("activate"'));
  assert.doesNotMatch(installBlock, /self\.skipWaiting\(/, "install must not force skipWaiting and break lazy chunks in open tabs");
  assert.match(
    sw,
    /addEventListener\("message"[\s\S]*SKIP_WAITING"[\s\S]*skipWaiting\(\)/,
    "skipWaiting must stay behind the explicit user-triggered SKIP_WAITING message",
  );
  assert.match(sw, /Promise\.allSettled\(/, "precache must tolerate single file failure");
  assert.match(sw, /isHtmlFallback/, "assetFirst must refuse caching HTML SPA fallback under /assets/");
  assert.match(sw, /event\.waitUntil\(network\)/, "catalog SWR must keep SW alive while revalidating");
  assert.match(sw, /MAX_CATALOG_ENTRIES/, "catalog cache must be bounded");
});
