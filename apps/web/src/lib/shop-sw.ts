/**
 * ED10 (EB4) — shop service-worker script builder.
 *
 * The shop has ONE worker for the "/shop/" scope, served by
 * app/shop-push-sw/route.ts. It began life in AB7 (AX16) as a
 * push-only worker; ED10 EXTENDS the same script with an app
 * shell (fetch caching + offline fallback) — the push and
 * notificationclick handlers below are BYTE-PRESERVED from AB7
 * (pinned by shop-sw.test.ts), because push behaviour
 * (subscription, payload rendering, click routing) must stay
 * functionally identical.
 *
 * Shell rules (all pinned by specs):
 *  - GET only; /backend/* and /api/* are NEVER intercepted.
 *  - Navigations under /shop/*: network-first; a successful
 *    copy goes to a bounded page cache (PAGE_CACHE_LIMIT). On
 *    network failure: the cached copy of that URL, else the
 *    cached shop home for the URL's org segment, else the
 *    precached offline page, else a tiny inline HTML document.
 *  - Transactional paths (cart / checkout / account / success,
 *    and /track/*) are NEVER intercepted — network only, no
 *    cache writes. (Success is included as a safe superset of
 *    the brief's list: an order summary must never be replayed
 *    from a cache.)
 *  - /_next/static/* and font files: cache-first, versioned
 *    cache name (build assets are content-hashed).
 *  - Media CDN images (the cdn-image host): cache-first with a
 *    bounded entry count (MEDIA_CACHE_LIMIT, oldest evicted) —
 *    opaque (no-cors <img>) responses are cacheable too.
 *  - Everything else: not intercepted.
 *
 * Versioning: SHOP_SW_VERSION names every cache
 * (shop-static-v{N} / shop-pages-v{N} / shop-media-v{N}); the
 * activate handler purges ONLY shop-* caches outside the
 * current set — the dashboard worker's qosprey-* caches share
 * this origin's Cache Storage and are never touched.
 *
 * Registration reality (documented, unchanged by ED10): the
 * worker is registered by ShopPushPrompt / push-panel when a
 * shopper subscribes to push, so the shell is active for those
 * shoppers; other shop visitors remain under the dashboard
 * worker exactly as before.
 */
import { MEDIA_CDN_BASE_URL } from "./cdn-image";

export const SHOP_SW_VERSION = "2";
export const SHOP_SW_OFFLINE_URL = "/shop/offline";
export const SHOP_MEDIA_CACHE_LIMIT = 60;
export const SHOP_PAGE_CACHE_LIMIT = 30;
export const SHOP_STATIC_CACHE = `shop-static-v${SHOP_SW_VERSION}`;
export const SHOP_PAGE_CACHE = `shop-pages-v${SHOP_SW_VERSION}`;
export const SHOP_MEDIA_CACHE = `shop-media-v${SHOP_SW_VERSION}`;

/** Hostname of the media CDN whose images the shell caches —
 * derived from the same base URL lib/cdn-image builds with. */
export function shopSwMediaHost(): string {
  try {
    return new URL(MEDIA_CDN_BASE_URL).hostname.toLowerCase();
  } catch {
    return "";
  }
}

/**
 * The generated worker script. Written in ES5-style JS (var /
 * function) like the AB7 original — it runs as a classic worker
 * with no build step. No backticks or ${} sequences appear in
 * the worker code itself; the few interpolations below inject
 * THIS module's constants so the script and the specs can never
 * drift apart.
 */
export function buildShopWorkerScript(): string {
  const mediaHost = shopSwMediaHost();
  return `
// Shop worker (AB7/AX16 push + ED10/EB4 app shell) — scope /shop/.
var SHOP_SW_VERSION = "${SHOP_SW_VERSION}";
var STATIC_CACHE = "${SHOP_STATIC_CACHE}";
var PAGE_CACHE = "${SHOP_PAGE_CACHE}";
var MEDIA_CACHE = "${SHOP_MEDIA_CACHE}";
var SHOP_CACHES = [STATIC_CACHE, PAGE_CACHE, MEDIA_CACHE];
var OFFLINE_URL = "${SHOP_SW_OFFLINE_URL}";
var MEDIA_HOST = "${mediaHost}";
var MEDIA_CACHE_LIMIT = ${SHOP_MEDIA_CACHE_LIMIT};
var PAGE_CACHE_LIMIT = ${SHOP_PAGE_CACHE_LIMIT};
var OFFLINE_HTML = "<!doctype html><html lang=\\"bn\\"><head><meta charset=\\"utf-8\\"><meta name=\\"viewport\\" content=\\"width=device-width, initial-scale=1\\"><title>অফলাইন</title></head><body style=\\"font-family: sans-serif; text-align: center; padding: 3rem 1.5rem; color: #0f172a;\\"><p style=\\"font-size: 2.5rem;\\">📡</p><h1 style=\\"font-size: 1.25rem;\\">ইন্টারনেট সংযোগ নেই</h1><p style=\\"font-size: 0.875rem; color: #64748b;\\">No internet connection — please reconnect and try again.</p><p><button onclick=\\"location.reload()\\" style=\\"background: #4f46e5; color: #fff; border: 0; border-radius: 0.75rem; padding: 0.625rem 1.25rem; font-size: 0.875rem; font-weight: 700;\\">আবার চেষ্টা করুন</button></p></body></html>";

// --- AB7 push handlers (byte-preserved from the original worker) ---
self.addEventListener("push", function (event) {
  var data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    try { data = { title: event.data ? event.data.text() : "" }; } catch (ignored) { data = {}; }
  }
  var title = data.title || "নতুন আপডেট";
  var url = data.url || (data.data && data.data.url) || "/";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "",
      data: { url: url },
    })
  );
});

self.addEventListener("notificationclick", function (event) {
  event.notification.close();
  var url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then(function (windowClients) {
        for (var i = 0; i < windowClients.length; i++) {
          var client = windowClients[i];
          if (client.url && client.url.indexOf(url) !== -1 && "focus" in client) {
            return client.focus();
          }
        }
        if (self.clients.openWindow) return self.clients.openWindow(url);
        return undefined;
      })
  );
});

// --- ED10 app shell (fetch caching + offline fallback) ---

function isTransactionalPath(pathname) {
  if (pathname.indexOf("/track/") === 0) return true;
  return /\\/(cart|checkout|account|success)(\\/|$)/.test(pathname);
}

function orgSlugOf(pathname) {
  var parts = pathname.split("/").filter(function (p) { return p.length > 0; });
  if (parts[0] === "shop" && parts[1] && parts[1] !== "offline") return parts[1];
  return null;
}

// Cache Storage keys are in insertion order, so deleting from
// the front evicts the OLDEST entries beyond the limit.
function trimCache(cacheName, limit) {
  return caches.open(cacheName).then(function (cache) {
    return cache.keys().then(function (keys) {
      if (keys.length <= limit) return undefined;
      var excess = keys.slice(0, keys.length - limit);
      return Promise.all(excess.map(function (k) { return cache.delete(k); }));
    });
  }).catch(function () { return undefined; });
}

function offlineFallback() {
  return caches.match(OFFLINE_URL).then(function (page) {
    if (page) return page;
    return new Response(OFFLINE_HTML, {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  });
}

function handleNavigation(request, url) {
  return fetch(request).then(function (res) {
    if (res && res.ok) {
      var copy = res.clone();
      caches.open(PAGE_CACHE).then(function (cache) {
        cache.put(request, copy).then(function () {
          trimCache(PAGE_CACHE, PAGE_CACHE_LIMIT);
        });
      });
    }
    return res;
  }).catch(function () {
    return caches.match(request).then(function (hit) {
      if (hit) return hit;
      var slug = orgSlugOf(url.pathname);
      if (slug) {
        // A filtered home view (any query) still beats the
        // generic offline page, so the home lookup ignores the
        // query string; the exact-page lookup above does not.
        return caches.match("/shop/" + slug, { ignoreSearch: true }).then(function (home) {
          if (home) return home;
          return offlineFallback();
        });
      }
      return offlineFallback();
    });
  });
}

function handleStatic(request) {
  return caches.match(request).then(function (hit) {
    if (hit) return hit;
    return fetch(request).then(function (res) {
      if (res && res.ok) {
        var copy = res.clone();
        caches.open(STATIC_CACHE).then(function (cache) {
          cache.put(request, copy);
        });
      }
      return res;
    });
  });
}

function handleMedia(request) {
  return caches.match(request).then(function (hit) {
    if (hit) return hit;
    return fetch(request).then(function (res) {
      // <img> loads are no-cors: a successful CDN image arrives
      // as an opaque response (ok === false, type "opaque") and
      // is still cacheable.
      if (res && (res.ok || res.type === "opaque")) {
        var copy = res.clone();
        caches.open(MEDIA_CACHE).then(function (cache) {
          cache.put(request, copy).then(function () {
            trimCache(MEDIA_CACHE, MEDIA_CACHE_LIMIT);
          });
        });
      }
      return res;
    });
  });
}

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(STATIC_CACHE).then(function (cache) {
      // The offline page must be ready before any navigation can
      // fail; a failed precache (installed while offline) still
      // activates — the inline OFFLINE_HTML is the last resort.
      return cache.add(OFFLINE_URL).catch(function () { return undefined; });
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) {
        // ONLY this worker's own shop-* caches are purged; the
        // dashboard worker's caches share this origin's storage.
        return k.indexOf("shop-") === 0 && SHOP_CACHES.indexOf(k) === -1;
      }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function (event) {
  var request = event.request;
  if (request.method !== "GET") return;
  var url;
  try { url = new URL(request.url); } catch (e) { return; }
  // API traffic is never intercepted (same rule as the
  // dashboard worker): auth, cart and order calls stay live.
  if (url.pathname === "/backend" || url.pathname.indexOf("/backend/") === 0) return;
  if (url.pathname === "/api" || url.pathname.indexOf("/api/") === 0) return;
  // Media CDN images: cache-first, bounded (any origin check is
  // the exact CDN hostname — other cross-origin traffic is
  // left completely alone).
  if (MEDIA_HOST && url.hostname === MEDIA_HOST) {
    event.respondWith(handleMedia(request));
    return;
  }
  if (url.origin !== self.location.origin) return;
  // The worker never caches its own script.
  if (url.pathname === "/shop-push-sw") return;
  // Immutable build assets + fonts: cache-first.
  if (url.pathname.indexOf("/_next/static/") === 0 || /\\.(woff2?|ttf|otf)$/.test(url.pathname)) {
    event.respondWith(handleStatic(request));
    return;
  }
  if (request.mode === "navigate") {
    if (url.pathname !== "/shop" && url.pathname.indexOf("/shop/") !== 0) return;
    if (isTransactionalPath(url.pathname)) return;
    event.respondWith(handleNavigation(request, url));
    return;
  }
  // Everything else: not intercepted.
});
`;
}
