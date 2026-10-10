# Milestone 4 Acceptance Checklist - Tracking & Attribution

- [x] Prisma models: Visitor, TrackingSession, TrackingEvent, Touchpoint,
      AttributionCredit + Store.trackingKey. Migration
      20261010030000_milestone4. Schema total: 27 models.
- [x] Tracker.js (apps/web/public/tracker.js): pseudonymous visitor id
      (cookie/localStorage), 30-minute sessions, UTM + fbclid/gclid/ttclid
      capture on session start, auto page_view, product_view via
      [data-tp-product], add_to_cart via [data-tp-add-to-cart],
      window.TP.track / TP.purchase / TP.lead, sendBeacon with fetch
      fallback, and it can never break the host store. Syntax-checked.
- [x] Ingest API: POST /tracking/events (public, store tracking key),
      batch up to 50, allow-listed event types only, occurredAt parsing.
- [x] Deduplication: (organizationId, clientEventId) unique; beacon
      retries and reloads are stored exactly once (test).
- [x] Visitor/session/touchpoint: visitor upserted by anonymous id,
      session created once and exactly one touchpoint per session,
      source classified from utm_source, else inferred from click id,
      else "direct" (tests).
- [x] Attribution engine (pure, tested): FIRST_TOUCH, LAST_TOUCH,
      LAST_NON_DIRECT (only-direct journey = honestly unattributed),
      LINEAR with integer-minor split that sums EXACTLY to order revenue.
      Default window 30 days, touchpoints after the conversion excluded.
- [x] Purchase linking: purchase event with orderExternalId computes
      credits for all 4 models when the order is synced; compute is
      idempotent per (order, model) so duplicate purchase events and
      reconciles never double count (test).
- [x] Reconciliation: POST /attribution/reconcile computes credits for
      orders that have a tracked purchase event but no credits; orders
      with no tracking evidence are counted and left unattributed.
- [x] Report: GET /attribution/report?model= returns orders revenue
      (cancelled/refunded/failed excluded), attributed revenue,
      unattributed revenue, channel x campaign table, tracked purchase
      events and purchase events with no matching order.
- [x] Web: Attribution page with per-store install snippet (tracking key
      + API URL), model switcher, KPI cards, channel table, reconcile
      button, and a plain-language note that cross-device attribution is
      never exact and will not match platform-reported numbers exactly.
- [x] Tests: 57 total passing (API 49, contracts 7, worker 1).
- [x] Builds: all packages + API + Next.js pass.
- [ ] Verified live with tracker.js on a real store + live Postgres
      (pending user's environment, same open item as before)

## Known limitations
- Attribution window is fixed at 30 days in this milestone; making it an
  organization setting is planned with the analytics milestone.
- Orders are matched to purchase events by externalId; a store whose
  order ids collide across sources inside one org could mislink. Woo
  orders are the only source in the MVP, and the source-scoped unique
  order constraint makes this safe in practice.
- No consent banner is bundled; stores must present their own consent
  UI where required. Events carry pseudonymous ids only by design.
- WhatsApp / click-to-message attribution is Phase 7, with verified vs
  inferred attribution kept separate there too.
