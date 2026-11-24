import { createHash } from "node:crypto";
import { readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import type { Plugin } from "vite";

/** Тяжёлое (модель зрения, wasm) не кладём в предзагрузку: оно кэшируется при первом использовании. */
const heavy = /(^|\/)vision_|\.wasm$/;

function walk(dir: string, root: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full, root) : [relative(root, full).split("\\").join("/")];
  });
}

/**
 * Полный офлайн web-PWA (оболочка, ассеты, справочник `/api/exercises` и быстрый fallback навигации).
 * Личные данные и очередь записи ведутся в браузере отдельно по аккаунту
 * (`src/lib/offlineSnapshot.ts`, `src/domain/PendingWorkouts.ts`, `src/lib/offlineMutationQueue.ts`)
 * и очищаются при выходе.
 */
export function serviceWorkerPlugin(outDir: string): Plugin {
  return {
    name: "tyaga-service-worker",
    apply: "build",
    enforce: "post",
    closeBundle() {
      const root = resolve(outDir);
      const files = walk(root, root).filter((f) => f !== "sw.js" && !f.startsWith("licenses/"));
      const precache = ["/", ...files.filter((f) => !heavy.test(f)).map((f) => `/${f}`)];
      const version = createHash("sha256").update(files.sort().join("|")).digest("hex").slice(0, 12);
      writeFileSync(join(root, "sw.js"), source(version, precache));
    },
  };
}

function source(version: string, precache: string[]) {
  return `// Сгенерировано vite-плагином serviceWorkerPlugin. Версия = хэш состава сборки.
const VERSION = ${JSON.stringify(version)};
const CACHE = "tyaga-shell-" + VERSION;
const CATALOG_CACHE = "tyaga-catalog-" + VERSION;
const PRECACHE = ${JSON.stringify(precache)};
const NAVIGATION_TIMEOUT_MS = 1500;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(PRECACHE.map((url) => new Request(url, { cache: "reload" })))).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => (key.startsWith("tyaga-shell-") && key !== CACHE) || (key.startsWith("tyaga-catalog-") && key !== CATALOG_CACHE))
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms);
    promise.then((value) => { clearTimeout(timer); resolve(value); }, (error) => { clearTimeout(timer); reject(error); });
  });
}

async function navigate(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match("/", { ignoreVary: true });
  const network = fetch(request).then((response) => {
    if (response.ok && (response.headers.get("content-type") || "").includes("text/html")) {
      cache.put("/", response.clone());
    }
    return response;
  });
  if (cached) {
    try {
      return await withTimeout(network, NAVIGATION_TIMEOUT_MS);
    } catch {
      network.catch(() => {});
      return cached;
    }
  }
  try {
    return await network;
  } catch {
    return Response.error();
  }
}

async function assetFirst(request) {
  const cache = await caches.open(CACHE);
  // Скрипты с crossorigin уходят с заголовком Origin, а предзагрузка — без него: Vary в сравнении лишний.
  const hit = await cache.match(request.url, { ignoreVary: true });
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok && response.status === 200) cache.put(request, response.clone());
  return response;
}

async function catalogStaleWhileRevalidate(request) {
  const cache = await caches.open(CATALOG_CACHE);
  const hit = await cache.match(request.url, { ignoreVary: true });
  const network = fetch(request)
    .then((response) => {
      if (response.ok && response.status === 200) {
        cache.put(request.url, response.clone());
      }
      return response;
    })
    .catch(() => null);
  if (hit) return hit;
  const fresh = await network;
  return fresh || Response.error();
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname === "/sw.js") return;
  if (url.pathname === "/api/exercises") return event.respondWith(catalogStaleWhileRevalidate(request));
  if (url.pathname.startsWith("/api/")) return;
  if (request.mode === "navigate") return event.respondWith(navigate(request));
  if (url.pathname.startsWith("/assets/") || url.pathname === "/favicon.svg" || url.pathname === "/manifest.webmanifest")
    return event.respondWith(assetFirst(request));
});
`;
}
