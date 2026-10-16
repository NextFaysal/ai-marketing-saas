import { describe, expect, it } from "vitest";
import {
  SHOP_MEDIA_CACHE,
  SHOP_MEDIA_CACHE_LIMIT,
  SHOP_PAGE_CACHE,
  SHOP_PAGE_CACHE_LIMIT,
  SHOP_STATIC_CACHE,
  SHOP_SW_OFFLINE_URL,
  SHOP_SW_VERSION,
  buildShopWorkerScript,
} from "./shop-sw";

/**
 * ED10 (EB4) — the generated shop worker script. The worker is
 * a string, so its rules are pinned as string contracts: the
 * AB7 push handlers byte-preserved, the ED10 fetch rules
 * (network-first navigations, transactional exclusions, media
 * cap), the version constant and the activate purge scope.
 */

const script = buildShopWorkerScript();

describe("ED10 shop worker — versioning + caches", () => {
  it("carries the version constant and the three versioned cache names", () => {
    expect(script).toContain(`var SHOP_SW_VERSION = "${SHOP_SW_VERSION}"`);
    expect(script).toContain(`var STATIC_CACHE = "${SHOP_STATIC_CACHE}"`);
    expect(script).toContain(`var PAGE_CACHE = "${SHOP_PAGE_CACHE}"`);
    expect(script).toContain(`var MEDIA_CACHE = "${SHOP_MEDIA_CACHE}"`);
    expect(SHOP_STATIC_CACHE).toBe(`shop-static-v${SHOP_SW_VERSION}`);
    expect(SHOP_PAGE_CACHE).toBe(`shop-pages-v${SHOP_SW_VERSION}`);
    expect(SHOP_MEDIA_CACHE).toBe(`shop-media-v${SHOP_SW_VERSION}`);
  });

  it("activate purges ONLY shop-* caches outside the current set", () => {
    expect(script).toContain('addEventListener("activate"');
    expect(script).toContain('k.indexOf("shop-") === 0');
    expect(script).toContain("SHOP_CACHES.indexOf(k) === -1");
    expect(script).toContain("caches.delete(k)");
    // The dashboard worker's caches are never named here.
    expect(script).not.toContain("qosprey-");
  });

  it("install precaches the offline page and skips waiting", () => {
    expect(script).toContain('addEventListener("install"');
    expect(script).toContain("cache.add(OFFLINE_URL)");
    expect(script).toContain(`var OFFLINE_URL = "${SHOP_SW_OFFLINE_URL}"`);
    expect(SHOP_SW_OFFLINE_URL).toBe("/shop/offline");
    expect(script).toContain("self.skipWaiting()");
    expect(script).toContain("self.clients.claim()");
  });
});

describe("ED10 shop worker — AB7 push preservation", () => {
  it("keeps the push handler body byte-identical to AB7", () => {
    const pushHandler = [
      'self.addEventListener("push", function (event) {',
      "  var data = {};",
      "  try {",
      "    data = event.data ? event.data.json() : {};",
      "  } catch (e) {",
      '    try { data = { title: event.data ? event.data.text() : "" }; } catch (ignored) { data = {}; }',
      "  }",
      '  var title = data.title || "নতুন আপডেট";',
      '  var url = data.url || (data.data && data.data.url) || "/";',
      "  event.waitUntil(",
      "    self.registration.showNotification(title, {",
      '      body: data.body || "",',
      "      data: { url: url },",
      "    })",
      "  );",
      "});",
    ].join("\n");
    expect(script).toContain(pushHandler);
  });

  it("keeps the notificationclick handler body byte-identical to AB7", () => {
    const clickHandler = [
      'self.addEventListener("notificationclick", function (event) {',
      "  event.notification.close();",
      '  var url = (event.notification.data && event.notification.data.url) || "/";',
      "  event.waitUntil(",
      "    self.clients",
      '      .matchAll({ type: "window", includeUncontrolled: true })',
      "      .then(function (windowClients) {",
      "        for (var i = 0; i < windowClients.length; i++) {",
      "          var client = windowClients[i];",
      '          if (client.url && client.url.indexOf(url) !== -1 && "focus" in client) {',
      "            return client.focus();",
      "          }",
      "        }",
      "        if (self.clients.openWindow) return self.clients.openWindow(url);",
      "        return undefined;",
      "      })",
      "  );",
      "});",
    ].join("\n");
    expect(script).toContain(clickHandler);
  });
});

describe("ED10 shop worker — fetch rules", () => {
  it("intercepts GET only and never touches /backend or /api", () => {
    expect(script).toContain('addEventListener("fetch"');
    expect(script).toContain('if (request.method !== "GET") return;');
    expect(script).toContain('url.pathname.indexOf("/backend/") === 0');
    expect(script).toContain('url.pathname.indexOf("/api/") === 0');
  });

  it("navigations are network-first with page → home → offline fallback", () => {
    expect(script).toContain('request.mode === "navigate"');
    expect(script).toContain("function handleNavigation(request, url)");
    // network first: fetch(request) opens the handler…
    const nav = script.slice(script.indexOf("function handleNavigation"));
    expect(nav.indexOf("fetch(request)")).toBeLessThan(nav.indexOf("caches.match(request)"));
    // …then the cached shop home for the org segment…
    expect(script).toContain("function orgSlugOf(pathname)");
    expect(script).toContain('caches.match("/shop/" + slug, { ignoreSearch: true })');
    // …then the offline fallback (precached page, inline last resort).
    expect(script).toContain("function offlineFallback()");
    expect(script).toContain("caches.match(OFFLINE_URL)");
    expect(script).toContain("OFFLINE_HTML");
  });

  it("transactional paths are excluded from interception", () => {
    expect(script).toContain("function isTransactionalPath(pathname)");
    expect(script).toContain('pathname.indexOf("/track/") === 0');
    expect(script).toContain("(cart|checkout|account|success)");
    expect(script).toContain("if (isTransactionalPath(url.pathname)) return;");
  });

  it("only /shop/* navigations are handled", () => {
    expect(script).toContain('url.pathname.indexOf("/shop/") !== 0');
  });

  it("statics are cache-first and the worker never caches its own script", () => {
    expect(script).toContain('url.pathname.indexOf("/_next/static/") === 0');
    expect(script).toContain("woff2?");
    expect(script).toContain("function handleStatic(request)");
    expect(script).toContain('url.pathname === "/shop-push-sw"');
  });

  it("media CDN images are cache-first with the documented cap + oldest-eviction trim", () => {
    expect(SHOP_MEDIA_CACHE_LIMIT).toBe(60);
    expect(script).toContain(`var MEDIA_CACHE_LIMIT = ${SHOP_MEDIA_CACHE_LIMIT}`);
    expect(script).toContain("url.hostname === MEDIA_HOST");
    expect(script).toContain("function handleMedia(request)");
    expect(script).toContain('res.type === "opaque"');
    expect(script).toContain("function trimCache(cacheName, limit)");
    expect(script).toContain("keys.slice(0, keys.length - limit)");
    expect(SHOP_PAGE_CACHE_LIMIT).toBe(30);
    expect(script).toContain("trimCache(PAGE_CACHE, PAGE_CACHE_LIMIT)");
    expect(script).toContain("trimCache(MEDIA_CACHE, MEDIA_CACHE_LIMIT)");
  });

  it("cross-origin traffic other than the media CDN is left alone", () => {
    expect(script).toContain("if (url.origin !== self.location.origin) return;");
    // media check happens BEFORE the same-origin bail.
    expect(script.indexOf("url.hostname === MEDIA_HOST")).toBeLessThan(
      script.indexOf("url.origin !== self.location.origin"),
    );
  });
});
