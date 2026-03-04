/* SilverDash PWA Service Worker (iPhone build)
 * Caches the UI shell for fast load + offline UI.
 * CME data is fetched live (network-first) to avoid stale market data.
 */
const CACHE_NAME = "silverdash-v63";
const APP_SHELL = [
  "./",
  "./index.html",
  "./tests.html",
  "./src/app.js",
  "./libs/xlsx.full.min.js",
  "./libs/pdf.min.js",
  "./libs/pdf.worker.min.js",
  "./libs/chart.umd.min.js",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(APP_SHELL);
    self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map(k => (k === CACHE_NAME ? null : caches.delete(k))));
    self.clients.claim();
  })());
});

function isExternal(url) {
  try {
    const u = new URL(url);
    return !u.origin.startsWith(self.location.origin);
  } catch {
    return false;
  }
}

self.addEventListener("fetch", (event) => {
  const req = event.request;

  // Same-origin (app shell): cache-first
  if (!isExternal(req.url)) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(req, { ignoreSearch: true });
      if (cached) return cached;
      const fresh = await fetch(req);
      if (req.method === "GET" && fresh.ok) cache.put(req, fresh.clone());
      return fresh;
    })());
    return;
  }


  // v63: Do NOT intercept NetDania (iOS Safari + SW can break CORS fetch and throw)
  if (/netdania\./i.test(req.url)) {
    return; // allow default browser fetch handling
  }

  // External (CME/CDNs): network-first, no caching (avoid stale)
  event.respondWith((async () => {
    try {
      return await fetch(req, { cache: "no-store" });
    } catch (e) {
      try { return await fetch(req); } catch { return new Response('', {status: 504, statusText: 'SW fetch failed'}); }
    }
  })());
});
