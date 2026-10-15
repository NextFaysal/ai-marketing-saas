# E-Commerce Batch B4 — Acceptance (EC6 + EC7 + EC10)

Batch B4 of the Full E-Commerce System program (plan:
`Ecommerce-Full-System-Plan-2026-10-12.md` §৪), built on the B1–B3
foundation (SyncOutbox + CommerceAdapter registry, catalog/order push
with read-back verification, Store sync modes). Worktree
`ai-marketing-saas-ec`, branch `ec-package`. **Local commits only —
nothing pushed** (owner-only push rule). Migrations were **NOT run
on any real database** — deploy requires `prisma migrate deploy`
plus `prisma generate`, then a manual Dokploy Redeploy.

## Commits (in order)

| Hash | Subject |
|---|---|
| `34e130f` | EC6+EC7+EC10 schema: CustomerStoreIdentity, StoreDiscount(+Sync), AbandonedStoreCheckout (migrations 20261013060000/070000/080000) |
| `1c880c9` | EC6: customers two-way — sync inbound, explicit push-to-store, merge carries identities |
| `fe4a189` | EC7: discounts — validation math, push with read-back, inbound pull, campaign codes, checkout coupon |
| `dee5f69` | EC10: abandoned checkout — Shopify webhook + REST backfill, tracker health check, unified view + recovery |
| `71f839c` | Wiring + web: adapter dispatch/capabilities, commerce routes, discounts & abandoned pages, customer identities UI, Sync Customers + tracker guide, checkout coupon field |
| (this doc) | docs: B4 acceptance |

## Gates (final, clean tree)

- API jest: **2127/2127 passed (235 suites)** — B3 was 2078/232, so
  +49 tests / +3 suites, zero regressions. New specs:
  `ec6-customers.spec.ts` (19), `ec7-discounts.spec.ts` (16),
  `ec10-abandoned.spec.ts` (14). The EC DI spec passes with the
  extended module graph (CommerceModule now imports Messaging +
  Tracking; no cycle — Integrations is never imported by Commerce).
- API tsc: **0 errors**. Web vitest: **140/140**. Web tsc: **0
  errors**. Full build (`pnpm -r build`, incl. Next build): **green**.
  Prisma validate: **valid**.

## EC6 — Customers Two-Way

- **Model/migration** `20261013060000_ec6_customer_identity`:
  `CustomerStoreIdentity` (organizationId, customerId, storeId,
  externalId, email/phone snapshots; unique `[storeId, externalId]`).
- **Inbound sync** (both platforms): Woo `GET /customers` paginated,
  Shopify GraphQL `customers` paginated (max 20 pages/run). Wired as
  `POST integrations/:id/sync/customers` (same roles as
  products/orders) + automation job types `woo_customers` /
  `shopify_customers` with templates. SyncJob kind `customers`
  recorded; result returns `{fetched, created, updated, skipped,
  errors[]}` with per-customer platform errors verbatim (capped 20).
  **Matching order (documented in code):** (1) identity
  `[storeId + externalId]`, (2) legacy `source + externalId`,
  (3) email (case-insensitive), (4) phone (exact) — first hit wins;
  fields are only refreshed when the incoming value is non-null; the
  identity row is always upserted. Woo has no customer cursor
  column, so each run is a full paginated pull (documented in code).
- **Push (explicit only)**: `POST customers/:customerId/push-to-store/:storeId`
  (roles OWNER/ADMIN/SUPPORT_AGENT — same as customer PATCH) enqueues
  outbox op `push_customer`; mirror stores are refused with a Bengali
  explanation; merged customers refused. Adapters: Woo POST/PUT
  `/customers/{id}`, Shopify `customerCreate`/`customerUpdate`.
  Success only after **read-back** (GET/query, email compare when
  both sides have one), then the identity row is saved/refreshed with
  the real externalId. CRM create/update **never auto-pushes**
  (documented in customers.service + UI copy).
- **Merge carries identities**: merging A into B moves A's identity
  rows; on a same-store conflict B's row wins and A's is deleted;
  the counts (`identitiesMoved`, `identityConflicts`) are recorded
  in the merge audit metadata.
- **Web**: customer detail gains a "স্টোর পরিচিতি" card (identities
  with store/platform/externalId/snapshots + per-store push buttons,
  mirror stores disabled with explanation); Integrations page gains a
  per-row **Sync Customers** button.

## EC7 — Discounts & Promotions

- **Models/migration** `20261013070000_ec7_discounts`:
  `StoreDiscount` (org-scoped, code unique per org — separate from
  the SaaS-plan Coupon model; kind percent|fixed|free_shipping;
  value Int; minOrderMinor BigInt; scope all|products|categories with
  scopeIds Json; window; usageLimit/usedCount; active; origin) +
  `StoreDiscountSync` (per discount+store, externalId, syncStatus,
  lastError).
- **API** under `commerce/discounts`: list (with per-store sync rows
  + store names), get, create, patch, set-active, generate-campaign,
  pull/:storeId. Writes use OWNER/ADMIN/MARKETING_MANAGER. Create/
  update enqueue `push_discount` per selected store (mirror stores
  reported `{enqueued:false, reason:"sync_mode_mirror"}` — never
  silently skipped); duplicate code → 409 with Bengali message.
- **Adapters**: Woo POST/PUT `/coupons` (scope resolved through
  listings + StoreTaxonomyMap; unmapped scope items are reported in
  the push result; if nothing resolves, the push fails verbatim
  `discount_scope_unmapped`); Shopify
  `discountCodeBasicCreate/Update` (percentage or fixed amount,
  minimum subtotal, usage limit). Read-back compare code+value on
  both. Shopify **free-shipping** basic discounts fail honestly
  (`shopify_free_shipping_basic_unsupported`) — the GraphQL basic
  surface has no shipping value type.
- **Inbound pull**: per-store manual action pulling Woo coupons and
  Shopify **basic code discounts only** (`discountNodes`) into
  StoreDiscount with origin set and sync row marked `synced`; pulled
  discounts stay editable and edits push back through the same
  outbox path. Automatic discounts and BXGY are **not** pulled —
  counted as skipped, documented here and in the service.
- **Validation + checkout**: pure `validateDiscount` (BigInt floor
  math; percent/fixed computed on the *eligible-scope* base only;
  reasons: inactive, not_started, expired, usage_limit_reached,
  below_min_order, no_eligible_items, invalid_kind — Bengali
  messages). The public single-product checkout accepts an optional
  `couponCode`: invalid → **400 with the Bengali reason, order NOT
  placed**; valid → `discountMinor` on the order, free-shipping
  zeroes the delivery charge, `usedCount` incremented exactly once
  after the order is placed (redemption failure is logged, never
  fails the customer's order). No-coupon behavior is unchanged
  (spec-pinned). Web checkout gains a coupon field; a refused coupon
  shows the server reason inline without wiping the form, and the
  success screen shows the applied discount.
- **Campaign codes**: `POST commerce/discounts/generate-campaign`
  (≤500, prefix + random suffix, collision-retry, batch summary) +
  UI dialog on the discounts page. **Broadcast-engine wiring is an
  integration point only** — codes are ordinary StoreDiscount rows;
  no messaging integration was built (out of scope per brief).
- **Web**: `/dashboard/commerce/discounts` — list with per-store sync
  chips, create/edit form with real product/category scope picker,
  campaign dialog, per-store pull buttons; linked from Sync Center.

## EC10 — Abandoned Checkout for Connected Stores

- **Model/migration** `20261013080000_ec10_abandoned_store_checkout`:
  `AbandonedStoreCheckout` (store, externalCheckoutId unique
  together, email/phone, items Json, totalMinor BigInt, currency,
  checkoutUrl, status, abandonedAt, recoveredOrderId).
- **Shopify inbound**: `checkouts/create` + `checkouts/update` added
  to the B1 subscription topic list and handled in the webhook
  processor (failure-isolated; the webhook event row is recorded
  regardless). Payload parsed from the real shape (line_items,
  email, phone with shipping→billing fallback, `total_price` major
  string → minor BigInt, `abandoned_checkout_url`); dedupe on
  `[storeId, externalCheckoutId]`; updates never overwrite status.
- **Backfill decision (documented)**: the 2025-10 GraphQL schema
  exposes no abandoned-checkouts query, so backfill is
  `POST commerce/abandoned/backfill/:storeId` via **REST
  `GET /checkouts.json`** using the same client-credentials token
  refresh + persistence as the catalog path. If a store's token path
  does not support REST, the platform error surfaces verbatim — the
  capability is webhook-first, REST-backfill-where-supported, and is
  labelled as such in the UI. No GraphQL field was invented.
- **Woo tracker path**: store health gains a `tracker_detected`
  check — the store homepage HTML is fetched (5s timeout, honest UA)
  and searched for `tracker.js` + the store's own `trackingKey`:
  pass / fail (fetched, not found) / **unknown** (no key, network
  error, non-200 — never faked as fail). Integrations page gains a
  numbered Bengali guide ("WooCommerce-তে ট্র্যাকার বসান") with the
  real snippet built from the store's actual trackingKey, verified
  via the health check.
- **Unified view**: `GET commerce/abandoned` merges S4 tracker carts
  (source `tracker`) with store checkouts (source `shopify`), sorted
  by value desc. Recovered determination for store checkouts is
  **computed on read**: a non-cancelled order in the same org whose
  customer matches the checkout's email/phone, placed at/after
  `abandonedAt`. A conversation link is included only when a real
  ChannelConversation exists for that customer.
- **Recovery**: `POST commerce/abandoned/:checkoutId/recover` sends
  one recovery email via EmailProvider when an email exists; the
  AuditLog marker (`commerce.store_checkout_recovery_sent`) is
  written **only on a provider-confirmed send** (failed send → no
  marker, verbatim error, retry stays possible), and a
  `cart.abandoned` event is emitted through EventsService with the
  checkout context so existing `cart_abandoned` workflow automations
  act on connected-store carts too. Recovered / already-sent /
  no-email cases refuse honestly. WhatsApp/inbox recovery is offered
  in the UI only when a linked conversation genuinely exists.
- **Web**: `/dashboard/commerce/abandoned` — unified table (source
  badge, store, contact, items, value, age, status), recovery email
  button only where it truly applies, conversation link only when
  present, per-store backfill buttons; linked from Sync Center.

## Honest limits

- **No live-store proof anywhere in B4** — everything is
  fixture/stub-proven (stubbed fetch/GraphQL in specs), exactly like
  B1–B3. Live verification with the owner's real Woo/Shopify stores
  is EC12 / the M30 sprint.
- Migrations `20261013060000_ec6`, `20261013070000_ec7`,
  `20261013080000_ec10` are **not run on any real DB**; the
  discounts/abandoned endpoints will 500 until deploy runs them.
- Shopify discount pull covers **basic code discounts only**
  (automatic + BXGY skipped and counted); Shopify free-shipping
  discount **push** is unsupported (verbatim failure, above).
- Shopify abandoned backfill depends on the legacy REST token path;
  webhook capture is the primary path (above).
- Woo customer sync has no incremental cursor — full paginated pull
  each run (bounded page cap on Shopify: 20 pages × 100).
- Customer push is explicit-only by design; there is no bulk push.
- Tracker detection reads homepage HTML only — a tracker installed
  solely on inner pages reports fail/unknown honestly rather than a
  site-wide claim.
- Recovered status is computed on read (no stored flag, no hook in
  the order path) — consistent with S4, at the cost of a bounded
  per-list query.
- Campaign codes are not wired into the broadcast/messaging engine
  (integration point documented above).
