/**
 * AB7 (AX16) — dedicated shop push service worker, served at
 * /shop-push-sw.
 *
 * This worker exists ONLY for web-push notifications on shop
 * surfaces. It has NO caching duties: the dashboard PWA worker
 * (public/sw.js, registered at root scope "/") owns caching.
 * The two coexist because their scopes differ — this one is
 * registered with scope "/shop/", which the
 * `Service-Worker-Allowed: /shop/` header below permits for a
 * script served from the app root.
 */

const WORKER_JS = `
// Shop push worker (AB7/AX16) — push only, no caching.
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
`;

export async function GET(): Promise<Response> {
  return new Response(WORKER_JS, {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Service-Worker-Allowed": "/shop/",
      "Cache-Control": "no-cache",
    },
  });
}
