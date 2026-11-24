import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
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

/** Хэш строится по пути И содержимому каждого файла, чтобы правки un-hashed файлов (manifest, иконки, html) меняли версию SW. */
export function computeBundleVersion(root: string, files: string[]): string {
  const hash = createHash("sha256");
  for (const file of [...files].sort()) {
    hash.update(file);
    hash.update("\0");
    hash.update(readFileSync(join(root, file)));
    hash.update("\0");
  }
  return hash.digest("hex").slice(0, 12);
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
      const files = walk(root, root).filter((f) => f !== "sw.js" && !f.startsWith("licenses/") && f !== "tyaga.apk");
      const precache = ["/", ...files.filter((f) => !heavy.test(f)).map((f) => `/${f}`)];
      const version = computeBundleVersion(root, files);
      writeFileSync(join(root, "sw.js"), buildServiceWorkerSource(version, precache));
    },
  };
}

export function buildServiceWorkerSource(version: string, precache: string[]) {
  return `// Сгенерировано vite-плагином serviceWorkerPlugin. Версия = хэш содержимого сборки.
const VERSION = ${JSON.stringify(version)};
const CACHE = "tyaga-shell-" + VERSION;
const CATALOG_CACHE = "tyaga-catalog-" + VERSION;
const PRECACHE = ${JSON.stringify(precache)};
const NAVIGATION_TIMEOUT_MS = 1500;
const MAX_CATALOG_ENTRIES = 30;

self.addEventListener("install", (event) => {
  // Неатомарный precache: единичный сетевой сбой не срывает установку SW целиком.
  // skipWaiting() намеренно НЕ вызываем, чтобы открытые вкладки со старым JS не теряли свои ленивые чанки.
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      Promise.allSettled(
        PRECACHE.map((url) =>
          fetch(new Request(url, { cache: "reload" }))
            .then((res) => (res.ok ? cache.put(url, res) : undefined))
            .catch(() => undefined),
        ),
      ),
    ),
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

async function navigate(request, event) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match("/", { ignoreVary: true });
  const network = fetch(request).then((response) => {
    if (response.ok && (response.headers.get("content-type") || "").includes("text/html")) {
      event.waitUntil(cache.put("/", response.clone()).catch(() => {}));
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

async function assetFirst(request, event) {
  const cache = await caches.open(CACHE);
  // Скрипты с crossorigin уходят с заголовком Origin, а предзагрузка — без него: Vary в сравнении лишний.
  const hit = await cache.match(request.url, { ignoreVary: true });
  if (hit) return hit;
  const response = await fetch(request);
  const contentType = (response.headers.get("content-type") || "").toLowerCase();
  // Защита от отравления кэша: SPA-fallback отдаёт text/html с 200 на пропавший чанк /assets/*.
  const isHtmlFallback = new URL(request.url).pathname.startsWith("/assets/") && contentType.includes("text/html");
  if (response.ok && response.status === 200 && !isHtmlFallback) {
    event.waitUntil(cache.put(request, response.clone()).catch(() => {}));
  }
  return response;
}

async function trimCatalogCache(cache) {
  const keys = await cache.keys();
  if (keys.length <= MAX_CATALOG_ENTRIES) return;
  await Promise.all(keys.slice(0, keys.length - MAX_CATALOG_ENTRIES).map((k) => cache.delete(k)));
}

async function catalogStaleWhileRevalidate(request, event) {
  const cache = await caches.open(CATALOG_CACHE);
  const hit = await cache.match(request.url, { ignoreVary: true });
  const network = fetch(request)
    .then((response) => {
      if (response.ok && response.status === 200 && (response.headers.get("content-type") || "").includes("application/json")) {
        const clone = response.clone();
        event.waitUntil(cache.put(request.url, clone).then(() => trimCatalogCache(cache)).catch(() => {}));
      }
      return response;
    })
    .catch(() => null);
  if (hit) {
    event.waitUntil(network);
    return hit;
  }
  const fresh = await network;
  return fresh || Response.error();
}

const STATIC_ROOT_FILES = new Set([
  "/favicon.svg",
  "/manifest.webmanifest",
  "/apple-touch-icon.png",
  "/icon-192.png",
  "/icon-512.png",
  "/icon-512-maskable.png",
]);

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname === "/sw.js") return;
  if (url.pathname === "/api/exercises") return event.respondWith(catalogStaleWhileRevalidate(request, event));
  if (url.pathname.startsWith("/api/")) return;
  if (request.mode === "navigate") return event.respondWith(navigate(request, event));
  if (url.pathname.startsWith("/assets/") || STATIC_ROOT_FILES.has(url.pathname))
    return event.respondWith(assetFirst(request, event));
});
`;
}
