# E-Commerce Completion Program — Program Summary (GB1–GB9)

**Program:** E-Commerce Completion Program (G1–G9 / GC1–GC23), approved in full by the owner
2026-10-15. Plan: `Ecommerce-Completion-Plan-2026-10-15.md` (gap audit of a 582-item checklist:
314 আছে / 35 local-only / 158 আংশিক / 75 নাই). Build line: `completion` branch in
`~/workspace/ai-marketing-saas-gc`, base = orders-next `55858ff`. Migration range claimed:
`20261013900000+` (9 batch migrations, 910000–990000). **Local commits only — never pushed.**
Per-batch detail: `docs/completion-gb1..gb9-acceptance.md` (+ `docs/gb4-gateway-research.md`,
`docs/gb5-courier-research.md`).

**Owner-decision exclusions (never in scope, unchanged):** loyalty points, gift cards,
warehouse-wise stock balances, direct external Accounting/CRM/ERP integrations, video
tutorials, pentest.

---

## Item-by-item audit table (GC1–GC23)

### GB1 — G1 Storefront (acceptance: completion-gb1-acceptance.md)

| Item | Status | Where / note |
|---|---|---|
| GC1 Themes (variants via config, picker + preview, favicon) | BUILT | 3 token-level themes (classic = pre-GB1 classes exactly; existing shops unchanged); favicon fallback chain. Themes are token/layout-level, not separate templates — by design. |
| GC2 Content pages (ShopPage + 7 system page seeds, contact form) | BUILT | Structured blocks only (no raw HTML); system pages seed as UNPUBLISHED drafts; contact form delivers to staff with an honest delivery log. |
| GC3 Promotional popup (triggers, frequency cap, schedule, real counters) | BUILT | Impression/click counters are real event counts. |
| GC4 Shop engagement (chat float buttons, quick view, zoom, video, sorting, custom 404) | BUILT | Product video is URL-embed only (YouTube/Vimeo/mp4); no video upload/hosting. |
| GC5 Section ordering (drag-reorder on existing order field) | BUILT | — |

### GB2 — G2 Catalog & Inventory (acceptance: completion-gb2-acceptance.md)

| Item | Status | Where / note |
|---|---|---|
| GC6 Brands (model + product link + shop filter/page) | BUILT | — |
| GC6 Product export CSV + xlsx import | BUILT | Export shape mirrors the importer (round-trip spec); xlsx import via ONE added dependency (exceljs, API path only). |
| GC6 Bulk delete (guarded) | BUILT | Order-referenced products are ARCHIVED, never hard-deleted. |
| GC6 Per-product shipping (override / free-shipping flag) | BUILT | `Product.freeShipping` flows through the ONE delivery resolver; pickup branch never calls the resolver (pickup fees still apply — documented). |
| GC6 Product change history (from AuditLog) | BUILT | — |
| GC7 Reserved stock | BUILT (scoped) | Real `StockReservation` on the server cart (`StoreCart`) only, `reserveMinutes` default 0 = OFF, lazy expiry; covers cart lifetime, not checkout-to-fulfilment. Audit found single-product + landing checkouts had NO stock check at all (unbounded oversell) — both gained enforcement via ONE `checkAvailability`. |
| GC7 available = on-hand − reserved everywhere | BUILT | — |
| GC7 damaged/lost reason + report | BUILT | — |
| GC7 backorder setting | BUILT | `allowBackorder` default OFF. |
| GC7 out-of-stock staff alert | BUILT | Exactly-once per zero-crossing (row stamp). |

### GB3 — G3 Checkout & Fraud (acceptance: completion-gb3-acceptance.md)

| Item | Status | Where / note |
|---|---|---|
| GC8 Terms consent (toggle + order stamp) | BUILT | Default OFF; orders stamp termsConsentedAt/termsRef. |
| GC8 Checkout idempotency key | BUILT | Record written only after successful placement; in-flow, not one DB transaction (crash-window caveat documented). |
| GC8 Product/value-level COD rules v2 | BUILT | ONE `evaluateCodRules`. |
| GC9 Open-order policy (allow/warn/block + window) | BUILT | off\|warn\|block per org. |
| GC9 Repeat waiting period + per-day limit | BUILT | Per-phone waiting period + Dhaka-day cap. |
| GC9 Email/IP blocklist + trusted whitelist | BUILT | `BlockedIdentifier`/`TrustedIdentifier` beside untouched ON4 `BlockedPhone`; trusted bypasses block/score but NEVER CAPTCHA. |
| GC9 CAPTCHA (Turnstile) | BUILT | Secret sealed/write-only; provider outage = FAIL CLOSED (documented decision, merchant's explicit choice); half-configured = skipped with UI warning; siteverify exercised only against mocks (no live proof). |
| GC9 Blocked-attempt audit log | BUILT | `FraudAttemptLog` on every refusal (IP stored full — documented choice). |
| GC9 Fraud rule builder (condition → action on ON4 scoring) | BUILT | Timing split stated in UI: minRiskScore is post-placement only. |

### GB4 — G4 Payments (acceptance: completion-gb4-acceptance.md + gb4-gateway-research.md)

| Item | Status | Where / note |
|---|---|---|
| GC10 Embedded checkout payment (own CC9 + platform CC10) | BUILT (shop) / PARTIAL (single+landing) | Shop checkout: server-computed options, paid ONLY from a polled `verified_paid`, never the browser return. Single/landing: API payload + validated marker + initiation-ready response, but NO web initiation UI (deliberate: their stored paymentMethod semantics). |
| GC11 ShurjoPay | BUILT | Paid iff verification sp_code 1000 + exact amount/currency; verify-before-save = real get_token. Sandbox endpoint TIMED OUT from the sandbox — client built to documented shapes; **sandbox round still owed**. |
| GC11 aamarPay | BUILT | Search Transaction verification; IPN is trigger only; saves as "configured" (no credential pre-check exists). Sandbox endpoint reached (unknown tran_id → Invalid-Data = unconfirmed, never failed). |
| GC11 Gateway refunds (ShurjoPay/aamarPay) | NOT BUILT | Neither gateway exposes a refund API (research doc) — honest NO-BUILD. |
| GC11 Rocket | Unchanged | Manual only, as before. |
| GC12 Failed-payment recovery | BUILT (staff-triggered) | Fresh initiation + SMS link via shop SMS; `sentVia:"none"` returned honestly when no channel reaches the customer. Conversation (inbox) send NOT built — module cycle (documented). No automatic retries. |
| GC12 Per-provider gateway fee tracking | BUILT | Fees only from tenant-entered feeBps/feeFixedMinor; unset ⇒ fee/net null with "ফি হার সেট করা হয়নি" — never invented. Attempt record = existing TenantPaymentTransaction (no parallel table). |
| GC12 Own-gateway settlement tracking | BUILT | From existing records. |

### GB5 — G5 Courier (acceptance: completion-gb5-acceptance.md + gb5-courier-research.md)

| Item | Status | Where / note |
|---|---|---|
| GC13 Generic adapter framework + migrate existing 3 | BUILT | `CourierClient` registry; Pathao/Steadfast/RedX migrated at zero behaviour change (two disclosed spec-seam changes, assertions unchanged). |
| GC13 eCourier | BUILT | Realigned mid-batch to eCourier's OFFICIAL API docs v5.5 (all-POST, hyphenated headers, mandatory booking fields; `product_price` = collect amount). Staging base documented; **no live merchant account proof**. |
| GC13 Paperfly | NOT BUILT | No public developer documentation; partner-gated onboarding (research doc) — honest NO-BUILD. |
| GC14 Manual tracking update (source-labelled) | BUILT | Goes through the SAME status applicator as provider sync. |
| GC14 Shipment-level courier error/event history | BUILT | `CourierShipmentEvent` log — starts at GC14, NO backfill (stated). |
| GC14 RTO queue + report | BUILT | `rto_attention` queue; report timing only from shipments with both events (n stated). |
| GC14 Booking-time charge record | BUILT (provider-dependent) | `CourierShipment.chargeMinor` ONLY when the provider returns a charge at booking: Pathao YES (delivery_fee); Steadfast NO; RedX NO (quote ≠ actual); eCourier NO. ON7 profit falls back to it with a source label; reconciliation sheet still wins. |

### GB6 — G6 CRM & Staff (acceptance: completion-gb6-acceptance.md)

| Item | Status | Where / note |
|---|---|---|
| GC15 Customer tags/notes/VIP/block | BUILT | Leak-guard spec drives the real shop `me()` — notes/blockedReason never reach customer JSON; block enforced inside GB3's guard with the same generic refusal. |
| GC15 Per-customer AOV + first/repeat | BUILT | Sold-bucket money columns via ONE groupBy (an old silent 200-order cap removed). |
| GC15 CRM segments (Messaging-aligned) | BUILT (scoped) | `CrmSegment` with ONE evaluator feeding count + list. Messaging audiences are messaging CONTACTS — there is no customer-criteria concept there to fork; nothing forked, stated plainly. |
| GC16 Custom roles from permission matrix | BUILT (scoped) | Two-layer reality documented: `@PermissionArea` (14 areas) + `@Roles` role-lists (584 usages). Presets are PROFILES materialized as per-org CustomRole rows (the rank hierarchy cannot express FINANCE/INVENTORY_MANAGER); custom-role areas are the baseline for area-checked endpoints (denies win, grants add, OWNER-only gates never passable via areas). Honest limit: role-list-only endpoints still follow the member's base preset role. |
| GC16 Preset roles (Order/Inventory/Finance Manager) | BUILT | As profiles above. |
| GC16 Session management (list + revoke) | BUILT | Stateless JWT gained a real `UserSession` store (sid claim); guard rejects revoked/missing sessions but FAILS OPEN on lookup error; legacy sid-less tokens live until expiry. |
| GC16 Login history | BUILT | `LoginEvent` (success/failure/unknown-email/TOTP). Suspended-account logins record none — flagged in the acceptance. |
| GC16 Staff notification preferences | BUILT | Mute applied at ALL 23 AgentNotification creation sites via ONE helper. |
| GC16 Warehouse-specific access | NOT BUILT (plan-sanctioned skip) | No bin-level filter exists anywhere to hang even a preference on; stock is org-global (EC21 = bin assignments only). Building it would be theatre. |

### GB7 — G7 Promotions & Tracking (acceptance: completion-gb7-acceptance.md)

| Item | Status | Where / note |
|---|---|---|
| GC17 First-order discount | BUILT | `minPriorOrders` evaluator condition (automatic promotions only). |
| GC17 Repeat-customer discount | BUILT | Same condition family. |
| GC17 Per-customer coupon usage limit | BUILT | — |
| GC17 Coupon max order value + exclusions | BUILT (v1 semantics) | Exclusions are REFUSE-ALL — line-level partial application NOT built (stated in acceptance + form help copy). |
| GC17 Flash-sale countdown (shop UI) | BUILT | — |
| GC17 Abandoned-cart auto-coupon | BUILT | Code issued at recovery send time. |
| GC17 Campaign performance report | BUILT | — |
| GC18 GA4 / GTM / Google Ads conversion / Search Console settings + render | BUILT | Nothing renders when no ID is set. |

### GB8 — G8 Reports & Finance (acceptance: completion-gb8-acceptance.md)

| Item | Status | Where / note |
|---|---|---|
| GC19 Dedicated reports (discounts, refunds, payment-wise, category-wise, shipping charged-vs-actual, gateway fee) | BUILT | Each report's source definition is written in the acceptance (e.g. refunds judged by ReturnRequest rows; overlapping lenses must not be summed — stated). |
| GC19 xlsx export | BUILT | Beside existing CSV. |
| GC19 Scheduled reports (per-org job, emailed, honest send record) | BUILT | `ScheduledReport`/`ScheduledReportRun`; the job needs per-org enablement at deploy. |
| GC20 Expense management (entries + categories) | BUILT | `Expense` model. |
| GC20 Ledger views (sales / COD receivable / gateway settlement / courier settlement / refunds) | BUILT | Formal views over EXISTING real records only — no money invented. |
| GC20 Settlement mismatch alerts | BUILT | Exactly-once per import batch (conditional claim on `ReconciliationImport.mismatchAlertedAt`); fires only for imports completed after GB8 — no retro-alerts. |
| GC20 Accounting-format export | BUILT | CSV column mapping; refund rows without a recorded amount are skipped and counted in the export notes. |

### GB9 — G9 Platform (acceptance: completion-gb9-acceptance.md)

| Item | Status | Where / note |
|---|---|---|
| GC21 Email verification (token, hashed, 24h, single-use) | BUILT | Mirrors password-reset discipline; SHA-256 hash only at rest; register hook is fire-and-forget (never blocks registration). |
| GC21 Phone verification (platform OTP) | BUILT | EC25 discipline (hashed code, 5-min, attempt caps, rate caps); platform SmsProvider; **SMS unconfigured ⇒ nothing created, honest `{sent:false, reason:"sms_not_configured"}`** and UI shows "এসএমএস যাচাই এখন উপলব্ধ নয়". |
| GC21 Grandfathering + enforcement gate | BUILT | Gate = SystemSetting `emailVerificationGate` {enforced, since}, ships OFF; enforced ⇒ only users created ≥ since and unverified are blocked, `/auth/*` allow-listed, fails OPEN on lookup error. NOT built: an admin UI/endpoint for writing the gate setting (operators set it via SystemSetting — stated). |
| GC21 Merchant verification (trade license + business address, submit/review workflow) | BUILT | BusinessProfile fields; merchant submit (OWNER/ADMIN, missing pieces listed in Bengali); admin approve/reject (@AdminTier SUPER,SUPPORT, reject requires note, audited); rejected → resubmittable; badge in merchant settings only (storefront badge = future, per brief). |
| GC21 Storage metering | BUILT | Σ `MediaAsset.sizeBytes` per org (`common/storage-usage.ts`); tenant endpoint + settings card + admin org row; UI copy "মিডিয়া লাইব্রেরিতে রেকর্ডকৃত আপলোড থেকে হিসাব". |
| GC21 Bandwidth metering | NOT BUILT (by design) | Hosting-level; explicitly not metered — no fake number anywhere. |
| GC22 Plan limit fields extended (product/order/storage/api) | BUILT | Optional overlay on PLAN_LIMIT_FIELDS: absent ⇒ unlimited, stored integer ≥ 0 wins, 0 blocks; existing 3 fields byte-identical (aa4 spec passes UNMODIFIED). |
| GC22 Enforcement — product create | BUILT | Non-archived count ≥ limit ⇒ Bengali 403 naming limit + usage; boundary spec-pinned (at-limit refuses). |
| GC22 Enforcement — order placement | BUILT | Dhaka-month count at the ONE order door (`upsertOrder` CREATE branch). Shopper surfaces convert to ONLY the generic "দোকানটি সাময়িকভাবে অর্ডার নিতে পারছে না"; Woo/Shopify sync SKIPS + continues (cursor not advanced past a skipped Woo order; Shopify webhook acks `order_skipped_plan_limit`); staff surfaces see the Bengali limit message; block ⇒ audit + OWNER/ADMIN notification, 1h-throttled, failure-isolated. |
| GC22 Enforcement — media upload (storage limit) | BUILT (scoped) | The two merchant media-LIBRARY entry points (`uploadMedia`, `uploadMediaStream`) are gated; AI/import/template/derived uploads count toward usage but are NOT refused (documented). Exactly-at-limit allowed, +1 byte refused. |
| GC22 API daily limit | BUILT (scoped to the real surface) | There is NO separate merchant developer API + API keys product in this tree (AdminApiKey is platform-admin only). The public/programmatic surface IS the storefront/landing/tracking API: `ApiUsageDaily` counts it per org+Dhaka day, `apiDailyLimit` enforces there, and the billing payload surfaces `apiToday`. A merchant API-keys product remains NOT BUILT (nothing to hang it on in this tree). |
| GC22 Subscription pause/resume | BUILT | `Subscription.pausedAt`; tenant OWNER endpoints + admin endpoints (audited); while paused the same choke points refuse with a subscription-paused notice. |
| GC22 Past-due grace | BUILT | `billingGraceDays` platform setting (default 3); PAST_DUE commerce continues until periodEnd + grace, then the same choke points refuse. Dunning/sweep behaviour itself untouched. |
| GC22 Billing usage read | BUILT | Billing payload gains `resourceUsage` {products, ordersThisMonth, storage{usedBytes, assetCount, limitMb}, apiToday}, `paused`, `pastDueGraceEndsAt`; web billing page renders usage + pause/resume + PDF link. NOT built: pause/resume BUTTONS on the admin billing page (endpoints + audited service exist). |
| GC22 SaaS invoice PDF | BUILT | Same data assembly as the HTML invoice (`saasInvoiceData`), rendered via the ONE PDF toolkit (`buildPdf` + new `saasInvoicePage`); merchant endpoint (own only, foreign → 404) + admin mirror; spec asserts data parity + %PDF header. A stacked-`@Get` route bug found in the first build (one of the two routes would never have registered) was fixed before completion. |
| GC23 OpenAPI for the public surface | BUILT | OpenAPI 3.0 from Nest metadata introspection — 46 routes; served at GET /public/docs/openapi.json + /public/docs page. DRIFT GUARD: a frozen 46-route inventory spec fails if any route is renamed/removed. |
| GC23 /v1 versioning alias | BUILT | Middleware rewrite for /v1/public/shop/*, /v1/public/landing/*, /v1/tracking/* only; unversioned routes byte-identical (spec proves non-matching paths untouched). |
| GC23 Outgoing merchant webhooks | BUILT | Subscriptions CRUD (https-only + SSRF screen at save AND every delivery attempt; secret sealed, shown exactly once at create/rotate); events mapped to the REAL bus vocabulary (order.created deduped against order.ingested — canonical = ingested; a NEW order.paid emit was added at the verified_paid transitions; order.returned emits from the single ReturnRequest creation point); PII-minimal payloads (spec-proven); HMAC-SHA256 `X-Qosprey-Signature`; 5s timeout; retries 1m→5m→30m→2h, failed at 5th attempt; `webhook_delivery_sweep` per-org job; delivery log + detail + resend (same row, attempts kept — documented). Residuals stated in code: in-process dedupe window (restart between the two creation emits can double-deliver) and DNS TOCTOU/rebinding window. |
| GC23 Support categories | BUILT | billing\|technical\|account\|feature\|other, default "other"; merchant picker + admin recategorize. |
| GC23 First-response tracking | BUILT | `firstRespondedAt` stamped in the same write as the first admin reply (second reply does not move it — spec). |
| GC23 Support SLA | BUILT | `supportSlaHours` setting (defaults low 72 / normal 24 / high 8 / urgent 4); breach computed on read; exposed ONLY in admin payloads (tenant payload omits it — spec); admin filter + badge. NOT built: a dedicated admin settings UI for SLA hours (set via the generic platform-settings JSON editor; key documented). |
| GC23 Payment-failure alert (§13) | BUILT | ONE staff notification per failed attempt at 7 real failure-conclusion points (cancelled never alerts); exactly-once via conditional claim on `failureNotifiedAt`; GB6 helper, billing category. |
| GC23 Subscription-expiry alert (§13) | VERIFIED — already existed | `sendBillingReminders()` (7/3/1-day stages, audit-deduped, notification + email) and `sendDunningReminder()` in automation.service.ts — cited, NOT rebuilt. |
| GC23 Courier-settlement alert (§13) | VERIFIED — already existed | GB8's GC20.3 exactly-once mismatch alert (reconciliation.service.ts) — cited, NOT rebuilt. |

---

## Program totals

- **Batches:** GB1–GB9, all complete. Migrations: 9 new (`20261013910000`–`20261013990000`),
  sequence total 173 on this line; final fresh-DB run (GB9 gate): 173/173 applied on a throwaway
  PostgreSQL 16, 248 public tables. Final full gate at program close: API 369 suites / 3,936
  tests all pass, web vitest 419/419, tsc 0/0/0 (api/web/admin), `pnpm -r build` exit 0,
  `prisma validate` clean (detail: completion-gb9-acceptance.md).
- **NOT BUILT (complete list, with reasons):** Paperfly adapter (no public docs, partner-gated);
  ShurjoPay/aamarPay gateway refunds (no refund API exists); warehouse-specific access
  (no bin filter exists — plan-sanctioned skip); bandwidth metering (hosting-level, by design);
  merchant API-keys/developer-API product (no such surface in this tree — the public storefront
  API is the programmatic surface and IS metered/limited); admin UIs for the email-verification
  gate setting, SLA hours, and admin-billing pause/resume buttons (all three are fully functional
  via SystemSetting/endpoints — only the dedicated buttons/forms were not built).
- **PARTIAL (complete list):** GC10 single/landing embedded-payment initiation UI (API complete,
  shop surface complete); GC7 reservations scoped to the server cart; GC15 segments scoped to
  the CRM evaluator (Messaging audiences are a different population); GC16 custom roles scoped
  by the two-layer guard reality; GC17 coupon exclusions refuse-all v1; GC22 media-upload gate
  scoped to the two merchant library entry points.
- **Live proof:** NONE for the whole program. No migration of this line has run on a real
  database; no live SMTP/SMS/gateway/courier/SSRF-target proof exists. Everything is
  fixture/spec/fresh-DB proven only (the standing M30/EC12 debt, unchanged).
- **Deploy notes for any future release from this line:** union with the SU/CC-Advanced/
  integration lines + full fresh-DB sequence re-run are mandatory; per-org jobs to enable
  include `webhook_delivery_sweep` (GB9), the GB8 scheduled-report job, `stuck_parcel_sweep`,
  `order_automation_sweep`, `owner_order_digest` (Orders Next); the email-verification gate
  ships OFF until an operator sets the SystemSetting.
