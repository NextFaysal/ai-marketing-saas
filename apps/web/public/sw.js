/**
 * Milestone 60 — hand-rolled service worker (no dependency; the
 * workspace is on Next 15, where next-pwa's compatibility is a
 * risk we chose not to take — see docs/milestone-60-acceptance.md).
 *
 * CACHING RULES — read before editing:
 *  1. ONLY GET requests are ever intercepted. Writes always go to
 *     the network.
 *  2. API traffic is NEVER cached and never intercepted:
 *     anything under /backend (the same-origin API proxy) or /api
 *     passes straight through — that includes auth calls and the
 *     inbox realtime stream.
 *  3. Immutable build assets (/_next/static/*) and the PWA icons
 *     are CACHE-FIRST: their URLs are content-hashed / versioned,
 *     so a cached copy can never go stale in a harmful way.
 *  4. Page navigations are NETWORK-FIRST: a fresh page wins when
 *     online; the last cached copy of that page is the fallback
 *     when offline, and /offline is the final fallback.
 *  5. Auth pages (/login, /register, /reset-password, /view-as,
 *     /accept-invite) are NEVER stored in the page cache.
 *  6. Other same-origin static files (images, fonts, JS in
 *     /public) are stale-while-revalidate.
 * Bump VERSION to invalidate every cache on the next deploy.
 */
const VERSION = "v1";
const STATIC_CACHE = `qosprey-static-${VERSION}`;
const PAGE_CACHE = `qosprey-pages-${VERSION}`;
const OFFLINE_URL = "/offline";
const PRECACHE = [
  OFFLINE_URL,
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-maskable-512.png",
  "/manifest.webmanifest",
];
const NEVER_CACHE_PAGES = ["/login", "/register", "/reset-password", "/view-as", "/accept-invite"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => ![STATIC_CACHE, PAGE_CACHE].includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return; // rule 1
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // third-party: untouched
  if (url.pathname.startsWith("/backend") || url.pathname.startsWith("/api")) return; // rule 2

  // Rule 3: immutable build assets + icons — cache-first.
  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/")) {
    event.respondWith(
      caches.match(request).then((hit) => hit ?? fetch(request).then((res) => {
        const copy = res.clone();
        caches.open(STATIC_CACHE).then((cache) => cache.put(request, copy));
        return res;
      })),
    );
    return;
  }

  // Rule 4 + 5: navigations — network-first, cache fallback, then offline page.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((res) => {
          if (res.ok && !NEVER_CACHE_PAGES.includes(url.pathname)) {
            const copy = res.clone();
            caches.open(PAGE_CACHE).then((cache) => cache.put(request, copy));
          }
          return res;
        })
        .catch(async () => (await caches.match(request)) ?? (await caches.match(OFFLINE_URL))),
    );
    return;
  }

  // Rule 6: everything else same-origin — stale-while-revalidate.
  event.respondWith(
    caches.match(request).then((hit) => {
      const network = fetch(request).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(STATIC_CACHE).then((cache) => cache.put(request, copy));
        }
        return res;
      }).catch(() => hit);
      return hit ?? network;
    }),
  );
});
