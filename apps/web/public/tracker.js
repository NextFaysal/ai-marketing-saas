/*
 * AI Marketing SaaS - first-party tracker (Milestone 4)
 *
 * Install on the store site:
 * <script async src="https://YOUR-APP/tracker.js"
 *   data-key="STORE-TRACKING-KEY"
 *   data-api="https://YOUR-API"></script>
 *
 * Optional hooks:
 *   window.TP.track("product_view", { productId: "123", name: "Shirt" })
 *   window.TP.purchase(orderId, "1250.00", "BDT")   // call on the thank-you page
 *   window.TP.lead({ source: "landing-form" })
 *   window.TP.identify({ email: "a@b.com", phone: "+8801..." })  // only when the shopper provides it, e.g. at checkout
 * Elements with [data-tp-add-to-cart] automatically emit add_to_cart on click.
 * Elements with [data-tp-product] automatically emit product_view.
 *
 * Privacy: only a pseudonymous random visitor id is stored (cookie/localStorage).
 * No names or payment data are collected by this script. Contact details
 * (email/phone) are stored ONLY when the store explicitly calls
 * TP.identify(...) — e.g. when a shopper types them at checkout; they are
 * never collected automatically.
 */
(function () {
  "use strict";
  var script = document.currentScript;
  if (!script) return;
  var KEY = script.getAttribute("data-key");
  var API = (script.getAttribute("data-api") || "").replace(/\/+$/, "");
  if (!KEY || !API) return;

  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return "id-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 12);
  }

  function getVisitorId() {
    try {
      var fromCookie = document.cookie.match(/(?:^|;\s*)tp_vid=([^;]+)/);
      if (fromCookie) return decodeURIComponent(fromCookie[1]);
      var stored = localStorage.getItem("tp_vid");
      if (stored) return stored;
      var id = uuid();
      localStorage.setItem("tp_vid", id);
      document.cookie = "tp_vid=" + encodeURIComponent(id) + "; path=/; max-age=31536000; SameSite=Lax";
      return id;
    } catch (e) { return uuid(); }
  }

  var SESSION_TIMEOUT_MS = 30 * 60 * 1000;
  function getSession() {
    var now = Date.now();
    try {
      var raw = sessionStorage.getItem("tp_sess");
      if (raw) {
        var s = JSON.parse(raw);
        if (now - s.lastActivity < SESSION_TIMEOUT_MS) {
          s.lastActivity = now;
          sessionStorage.setItem("tp_sess", JSON.stringify(s));
          return s;
        }
      }
    } catch (e) { /* fall through and create a new session */ }
    var params = new URLSearchParams(window.location.search);
    var fresh = {
      key: uuid(),
      lastActivity: now,
      data: {
        utmSource: params.get("utm_source") || undefined,
        utmMedium: params.get("utm_medium") || undefined,
        utmCampaign: params.get("utm_campaign") || undefined,
        utmContent: params.get("utm_content") || undefined,
        utmTerm: params.get("utm_term") || undefined,
        fbclid: params.get("fbclid") || undefined,
        gclid: params.get("gclid") || undefined,
        ttclid: params.get("ttclid") || undefined,
        landingPage: window.location.href,
        referrer: document.referrer || undefined
      }
    };
    try { sessionStorage.setItem("tp_sess", JSON.stringify(fresh)); } catch (e) { /* private mode */ }
    return fresh;
  }

  var visitorId = getVisitorId();

  function send(type, extra) {
    var session = getSession();
    var event = {
      clientEventId: uuid(),
      anonymousId: visitorId,
      sessionKey: session.key,
      type: type,
      url: window.location.href,
      referrer: document.referrer || undefined,
      occurredAt: new Date().toISOString(),
      session: session.data
    };
    if (extra) {
      if (extra.properties) event.properties = extra.properties;
      if (extra.orderExternalId) event.orderExternalId = extra.orderExternalId;
      if (extra.value) event.value = String(extra.value);
      if (extra.currency) event.currency = extra.currency;
    }
    var payload = JSON.stringify({ key: KEY, events: [event] });
    var url = API + "/tracking/events";
    try {
      if (navigator.sendBeacon) {
        var blob = new Blob([payload], { type: "application/json" });
        if (navigator.sendBeacon(url, blob)) return;
      }
    } catch (e) { /* fall back to fetch */ }
    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload,
      keepalive: true,
      credentials: "omit"
    }).catch(function () { /* tracking must never break the store */ });
  }

  function track(type, properties) { send(type, { properties: properties || {} }); }

  window.TP = {
    track: track,
    purchase: function (orderExternalId, value, currency) {
      send("purchase", { orderExternalId: String(orderExternalId), value: value, currency: currency });
      // If the store also runs Meta Pixel, fire the matching browser
      // event with the SAME event id our server-side Conversions API
      // uses ("purchase-<order number>") so Meta deduplicates them.
      try {
        if (typeof window.fbq === "function") {
          window.fbq("track", "Purchase", { value: Number(value) || 0, currency: currency || "BDT" }, { eventID: "purchase-" + String(orderExternalId) });
        }
      } catch (e) { /* pixel is optional; never break the store */ }
    },
    lead: function (properties) { track("lead", properties || {}); },
    identify: function (contact) {
      if (!contact) return;
      var p = {};
      if (contact.email) p.email = String(contact.email);
      if (contact.phone) p.phone = String(contact.phone);
      if (!p.email && !p.phone) return;
      send("identify", { properties: p });
    }
  };

  function onReady() {
    send("page_view", {});
    var productEl = document.querySelector("[data-tp-product]");
    if (productEl) {
      track("product_view", {
        productId: productEl.getAttribute("data-tp-product"),
        name: productEl.getAttribute("data-tp-name") || undefined
      });
    }
    document.addEventListener("click", function (e) {
      var el = e.target && e.target.closest ? e.target.closest("[data-tp-add-to-cart]") : null;
      if (el) track("add_to_cart", { productId: el.getAttribute("data-tp-add-to-cart") });
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", onReady);
  else onReady();
})();
