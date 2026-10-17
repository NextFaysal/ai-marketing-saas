# MX8 — Per-recipient Dynamic Personalization — Acceptance

Status: **CODE-COMPLETE** (local commits only, no push). On top of
MB1+MB2+MX7 (base `b5d47daa`): a broadcast can now carry an MX8
`personalization` config — per-recipient product recommendations
from real purchase/browsing data, a unique single-use coupon
issued per recipient at send time, loyalty/gift-card balance
variables from the real Advanced ledgers, and segment-conditional
blocks evaluated per recipient with the MS3 machinery.

Commits (branch `messaging-advanced`, base `b5d47daa`):

- `MX8:` pure personalization module + pure specs (11)
- `MX8:` schema + migration `20261019040100_mx8_personalization`
- `MX8:` service integration (config, issuance, balances,
  recommendations, segment blocks, both engines) + service
  specs (14)
- (this doc's commit — see git log)

## Step 0 — audit findings (recorded before any MX8 code)

**1. Coupon machinery verdict (critical).** Two coupon models
exist and they are NOT interchangeable:

- **Platform `Coupon` + `CouponRedemption`** (schema ~line 6484):
  `code` is GLOBALLY unique (`@unique`, not per-org), `planScope`
  ties it to SaaS plan tiers, kinds are percent|fixed only.
  Created ONLY by platform admins (`PaymentsService.createCoupon`,
  admin controller) and redeemed ONLY inside the platform's own
  plan checkout (`PaymentsService.activate` writes a
  CouponRedemption + increments `redeemedCount` when a plan
  purchase completes). No org, no product checkout, no
  per-customer semantics. **Verdict: cannot back a merchant
  broadcast coupon — not used.**
- **`StoreDiscount`** (schema ~line 7515): org-scoped
  (`@@unique([organizationId, code])`), kinds
  percent|fixed|free_shipping, `startsAt`/`endsAt`,
  `usageLimit` + `usedCount`, `perCustomerLimit`, `active`,
  `origin` + `sourceRef` provenance. This is the store the MX7
  audit already identified and the one real checkouts use:
  `PromotionsService.evaluateCheckout` prices carts through
  `DiscountsService.validateForCheckout` → the pure
  `validateDiscount`, which refuses when `usedCount >=
  usageLimit` (`usage_limit_reached`) and when the customer's
  stamped-order count reaches `perCustomerLimit`
  (`customer_limit_reached`, counted from `Order.couponCode`
  stamps); `DiscountsService.redeem()` increments `usedCount`
  and is called at placement by the native storefront checkout,
  POS, landings and products services. System issuance precedents
  exist and were mirrored: abandoned-recovery coupons and
  AB1 referral-reward coupons are StoreDiscount rows created
  directly with `perCustomerLimit: 1`, an expiry and a
  `sourceRef` provenance key.
  **Verdict: StoreDiscount with `usageLimit: 1` +
  `perCustomerLimit: 1` honestly enforces single-use in the
  platform's own checkout evaluation** — the global cap binds
  after the first redemption increments `usedCount`, and the
  per-customer cap binds independently from stamped orders.
  Enforcement gaps, recorded not hidden: (a) `redeem()` is a
  read-then-increment (not an atomic conditional update), so
  two *simultaneous* first checkouts with the same code could
  both validate before either increments — the same race every
  StoreDiscount in the system already has; (b) MX8 issues the
  row directly (like the recovery/referral precedents) and does
  NOT enqueue a store sync push, so redemption is proven for
  the platform's native checkout/promotions path only — a
  WooCommerce/Shopify external checkout sees the code only if
  the org's discount sync carries it, which MX8 does not claim.

**2. Loyalty / gift-card ledgers.** Loyalty truth is
`LoyaltyLedger`, written only by `LoyaltyService`, which also
maintains `Customer.loyaltyBalanceCache` in the same
transaction; the ledger's own read path is
`LoyaltyService.checkoutSnapshot` (returns the cache balance, or
null when the program is disabled / the customer was merged
away). Gift cards are BEARER instruments: `GiftCard` rows hold
`balanceCache` (maintained only by `GiftCardService` with the
`GiftCardLedger`), a `buyerCustomerId` and free-text
`recipientEmail`/`recipientPhone` — there is NO per-customer
gift-card balance API and no holder field. On module boundaries:
messaging imports no commerce *service* (the MS8/MX6 registered-
port pattern exists for service behaviour), but messaging
already READS other modules' tables through Prisma as its
established pattern (Customer/Lead/Order aggregates in MS3/MS5,
Product + StoreDiscount in MX7). MX8 follows that pattern for
READS only — it creates StoreDiscount rows (issuance is a
messaging act, with two in-codebase precedents for direct
creation) and never writes a loyalty/gift-card row or cache.

**3. Recommendation inputs.** Orders: `Order` (customerId,
status, placedAt/createdAt) + `OrderItem.productId` give real
per-customer purchase history; `Product.category` (the legacy
display string, indexed per org) is the category both the
purchased rows and the catalog rows carry, so the rule compares
like with like. Browsing: `TrackingEvent` product_view events
carry `properties.productId`, grouped by `Visitor`; a visitor's
contact exists ONLY via an identify event (`Visitor.email`/
`phone`) — the MX5 `scanBrowseAbandoned` honesty rule. MX8
therefore resolves browsing per recipient by matching a Visitor
on the recipient's OWN email/phone; no match ⇒ no browsing
signal. Catalog: `Product` rows of the org, `status ACTIVE`,
`stockQuantity > 0` (null = untracked = sellable, the codebase's
reading), prices from the row's real `priceMinor`/`currency`,
URL by the MX7/MS5 slug rule (`/checkout/<slug>`, none invented
for slug-less products).

**4. Send-path integration points.** Per-recipient rendering
happens in exactly one place for broadcasts: the two engines
(recipient-table `processBroadcastTable`, legacy snapshot loop)
call `sendToRecipient`, which substitutes the recipient's vars
into the broadcast's stored body/htmlBody/subject. MX1 confirmed:
the table engine selects only `pending` rows; outcomes persist
per row (`persistRecipientOutcome`); the snapshot path persists
the whole snapshot per chunk. Workflow sends also call
`sendToRecipient` but NEVER pass through the broadcast engines —
and `ms5-composer.spec.ts` pins both "workflow sends are NEVER
rewritten" and the EXACT `TEMPLATE_VARIABLES` catalogue. MX8
therefore hooks personalization inside the two broadcast
engines only (workflow sends structurally untouched), on the
plain email/sms path only (a cascade run owns per-channel
content; WhatsApp sends Meta templates — both combinations are
refused at create rather than half-applied).

## Shipped

**Config — `Broadcast.personalizationConfig`** (migration
`20261019040100_mx8_personalization`, additive: also
`BroadcastRecipient.personalization`). `createBroadcast` accepts
`personalization`, validated strictly by the new pure module
`apps/api/src/messaging/personalization.ts`
(`parsePersonalizationConfig` — bad coupon kind/value, expiry
outside 1..365, >10 segment blocks, a block with both/neither
audience reference, or an invalid inline MS3 definition are a
400 at create; a saved-audience reference must name a real
MessagingSavedAudience of the org, checked at create). Clone
and recurrence chaining copy the config. DTO field added
(`CreateBroadcastDto.personalization`, shape-only like
cascade/recurrence).

**Unique per-recipient coupon.** At send time (first attempt
only), the engine issues one StoreDiscount row per recipient:
unique code `<prefix>-<10 hex>` (org-unique constraint is the
collision backstop, 5 retries with fresh bytes), the config's
kind/value, `endsAt = now + expiryDays`, `usageLimit: 1`,
`perCustomerLimit: 1`, `origin: "messaging_unique"`,
`sourceRef: "<broadcastId>:<dedupeKey>"`. The code reaches the
message as the `{{uniqueCouponCode}}` variable (subject/body/
html all render it); when the org referenced that variable
nowhere, the standard MS5 coupon line is appended so the
message still carries the code. **Resume idempotency is
two-layered and spec-proven:** (1) the issued code is persisted
in the recipient's personalization state (recipient row column
/ snapshot entry) BEFORE the provider call and reused verbatim
on resume and retry-failed — the retry spec asserts the same
code and zero new StoreDiscount rows; (2) issuance itself first
looks up the `sourceRef` claim, so even a crash between the
StoreDiscount create and the state persist recovers the same
code instead of issuing a second one (spec-proven by
pre-seeding the claim). Issuance failure ⇒ that recipient's
variable renders empty, no code line is appended, no shared or
fake code is substituted, and the error is recorded in the
recipient's state (`couponError`) — spec-proven.

**Recommendation block.** Pure rule in `personalization.ts`
(`pickRecommendations`): the recipient's most recent purchased
category → in-stock ACTIVE catalog products of that category,
excluding products they already bought; second, the category of
their most recently viewed products (identified visitor only);
no usable signal or no eligible product ⇒ the org-authored
`fallbackText` or nothing — never a substitute category or an
invented product. Rendered with the MX7/MS5 price formatting
and HTML escaping, appended to body (+ HTML part) at send time;
the rendered bytes + signal + product ids are stored in the
recipient's state, so retries are byte-stable. Available as
appended dynamic content rather than an MX7 block type because
MX7 blocks render at template-save/broadcast-create time —
per-recipient content cannot exist there; the send path is the
only honest place (see Step 0.4).

**Loyalty / gift-card variables.** Built at prepare time in
`buildSnapshotVars` (`addBalanceVars`), so they ride the
existing vars on every broadcast path (table, snapshot, cascade,
WhatsApp params):
- `{{loyaltyPoints}}` (customers): mirrors
  `LoyaltyService.checkoutSnapshot` — the ledger-maintained
  `loyaltyBalanceCache`, rendered as-is (including a real 0 or
  a negative clawback balance); program disabled or customer
  merged away ⇒ EMPTY, never an invented number.
- `{{giftCardBalance}}` (customers + leads): the summed
  `balanceCache` of ACTIVE, unexpired GiftCard rows that are
  the recipient's own — addressed to their email/phone, or
  bought by the customer with no addressee (self-purchase). A
  card bought for someone else counts only for the addressee.
  No matching card ⇒ `0.00` for an identified recipient; csv
  recipients (no identity record) ⇒ empty. Rendered in major
  units with 2 decimals, like `lastOrderTotal`.
Both reads are defensive: any failure leaves the var empty.

**Segment-based dynamic blocks.** Each configured block carries
a saved-audience reference or an inline MS3 definition; at send
time the recipient's membership is evaluated with the SAME
`matchesAudienceDefinition` evaluator over facts built with the
resolver's exact rules (`audienceFactsForRecipient` — aggregates
and RFM computed only when a condition needs them, missing
facts are FALSE, a deleted saved audience matches nobody).
Member blocks append to the message (authored htmlBody used
as authored; text-only blocks are escaped into the HTML part);
a non-member's message is byte-identical to the stored content
(spec-proven in the pure suite). Matched indices are stored in
the recipient's state.

**Specs.** `mx8-personalization.spec.ts` (11 pure tests) +
`mx8-personalization-service.spec.ts` (14 service tests over a
fake-prisma harness in the MX1 style): config validation,
per-recipient issuance + code isolation, recommendation
signals, ledger balances (incl. disabled-program and
bought-for-someone-else cases), segment membership, no-config
byte-identity, partial+resume, retry-failed same-code,
crash-window sourceRef recovery, issuance-failure honesty,
snapshot-path parity, and the MS5 catalogue pin.

## Scoped gates (actually run, serially)

- **API jest, MX8 suites: 2 suites / 25 tests — all pass.**
- **API jest, messaging dir (full): 22 suites / 358 tests — all
  pass**, including every MS/MX pin suite unmodified (ms5
  catalogue pin included — see NOT BUILT).
- **API jest, workflows + inbox dirs: 37 suites / 895 tests —
  894 passed, 1 skipped, 1 failed.** The single failure is
  `inbox/cx3-debounce.spec.ts` — the known pre-existing flake
  named in the MB3 tasking; rerun alone it passes 18/18. MX8
  touches no inbox/workflows code; the workflow coupon/send
  paths that share `sendToRecipient` are covered by the green
  workflows suites in the same run.
- **API tsc (`npx tsc --noEmit`): clean (exit 0).**
- **Prisma validate: valid.**
- Web: not touched by MX8 (no web files changed), so no web
  gates were run by this worker.
- NOT run by this worker (coordinator's batch gates): full API
  jest, fresh-Postgres migration union (MX8 migration is
  additive two-column; union count becomes 217).

## NOT BUILT / honest limits

- **Balance variables are NOT in the composer catalogue.**
  `ms5-composer.spec.ts` pins `TEMPLATE_VARIABLES` to exactly
  the MS5 keys; per the standing rule the pin was not edited.
  `{{loyaltyPoints}}`, `{{giftCardBalance}}` and
  `{{uniqueCouponCode}}` fill and render (spec-proven) but are
  discoverable only via this doc / the config API, not the
  composer's variable picker. Lifting this needs an owner/MS5
  pin decision, not a quiet edit.
- **No MX8 web UI.** The config is API-only in this item (the
  Messaging page gains no personalization controls); the queued
  post-MX Messaging design task is the natural home for it.
- **Personalization on cascade / WhatsApp broadcasts** — refused
  at create (cascade owns per-channel content; WhatsApp sends
  Meta templates). MX2 cascade deliveries keep primary-content
  semantics, unchanged.
- **Single-use enforcement gaps** (from the Step-0 verdict):
  `redeem()`'s non-atomic increment race is inherited from the
  StoreDiscount system as a whole; external Woo/Shopify checkout
  redemption depends on discount sync, which MX8 issuance does
  not enqueue — native checkout/promotions redemption is the
  proven path.
- **Gift-card phone matching** relies on the candidate query
  (stored raw/digit forms) plus in-memory digit normalization;
  a card addressed by a phone stored in a third format, with no
  email/buyer link, can be missed (the balance then under-
  reports rather than inventing).
- **Recommendation reads are per recipient at send time**
  (orders/items/products/visitor queries per recipient on the
  personalized path only). Correctness first; no batching was
  built — a 50k-recipient personalized broadcast will be slower
  than a plain one, and no throughput number is claimed.
- **Segment facts are evaluated per recipient at send time**
  (same note); a saved audience edited mid-send changes later
  chunks' membership (draft-broadcast MS3 semantics: the
  definition is read at use time; already-sent recipients are
  never re-evaluated because only pending rows are processed).
- No migration has run on a real DB; no live provider proof
  exists for MX8 (M30 owed). No screenshot QA (no web changes).
