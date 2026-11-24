import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";

const LAYER_ORDER = "@layer tokens, base, layout, components, screens, utilities;";
const MINIFIED_ORDER = "@layer tokens,base,layout,components,screens,utilities;";

test("every layered CSS file declares the canonical @layer order before any layer block", () => {
  const dir = path.resolve("src/styles");
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".css") || name === "fonts.css" || name === "layers.css") continue;
    const css = readFileSync(path.join(dir, name), "utf8");
    const orderIdx = css.indexOf(LAYER_ORDER);
    const blockIdx = css.search(/@layer\s+[a-z]+\s*\{/);
    assert.ok(orderIdx !== -1, `${name} must declare canonical @layer order`);
    assert.ok(blockIdx === -1 || orderIdx < blockIdx, `${name} must declare @layer order before its first @layer block`);
  }
});

test("src/main.tsx imports layers.css before any component or other stylesheet", () => {
  const main = readFileSync(path.resolve("src/main.tsx"), "utf8");
  const lines = main.split("\n").map((l) => l.trim()).filter(Boolean);
  assert.equal(lines[0], 'import "./styles/layers.css";');
});

test("built index CSS declares @layer order before the first @layer block", () => {
  const assetsDir = path.resolve("dist/client/assets");
  if (!existsSync(assetsDir)) return;
  const indexCss = readdirSync(assetsDir).find((f) => /^index-.*\.css$/.test(f));
  if (!indexCss) return;
  const css = readFileSync(path.join(assetsDir, indexCss), "utf8");
  const orderIdx = Math.min(
    ...[css.indexOf(MINIFIED_ORDER), css.indexOf(LAYER_ORDER)].filter((n) => n >= 0),
  );
  const firstBlock = css.search(/@layer\s+[a-z]+\s*\{/);
  assert.ok(Number.isFinite(orderIdx), `${indexCss} must contain canonical @layer order declaration`);
  assert.ok(firstBlock === -1 || orderIdx < firstBlock, `${indexCss} must declare @layer order (${orderIdx}) before first @layer block (${firstBlock})`);
});

test("screens.css does not override .brand display over layout.css .mobile-brand hiding", () => {
  const screens = readFileSync(path.resolve("src/styles/screens.css"), "utf8");
  assert.doesNotMatch(screens, /(?:^|[\s}])\.brand\s*\{/, "screens.css must not redefine .brand and override .app-shell .mobile-brand { display: none }");
});
