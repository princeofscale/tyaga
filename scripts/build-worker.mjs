import { build } from "esbuild";
import { existsSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";

const hasFullCatalog =
  existsSync("data/wger/catalog-v1.json") &&
  existsSync("data/wger/catalog-v2-ru.json") &&
  existsSync("data/wger/catalog-v3-reviewed.json");

const wgerCatalogPlugin = {
  name: "tyaga-wger-catalog",
  setup(b) {
    if (!hasFullCatalog) return;
    b.onResolve({ filter: /fallback-snapshots\.json$/ }, () => ({
      path: "full-wger-catalog",
      namespace: "tyaga-wger",
    }));
    b.onLoad({ filter: /.*/, namespace: "tyaga-wger" }, () => ({
      contents: [
        'import v1 from "./data/wger/catalog-v1.json";',
        'import v2 from "./data/wger/catalog-v2-ru.json";',
        'import v3 from "./data/wger/catalog-v3-reviewed.json";',
        "export default { v1, v2, v3 };",
      ].join("\n"),
      resolveDir: resolve("."),
      loader: "ts",
    }));
  },
};

await mkdir("dist/server", { recursive: true });
await build({
  entryPoints: ["server/index.ts"],
  outfile: "dist/server/index.js",
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  minify: true,
  plugins: [wgerCatalogPlugin],
});
// Не генерируем deployable wrangler.json на bare server/index.ts (без cloud.ts/local.ts):
// прод деплоится через wrangler.production.jsonc (server/cloud.ts), dev — через wrangler.jsonc (server/local.ts).
await rm("dist/server/wrangler.json", { force: true });
