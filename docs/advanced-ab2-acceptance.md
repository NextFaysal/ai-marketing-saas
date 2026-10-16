# Advanced Program — Batch AB2 Acceptance (AX3 Gift Cards)

Built 2026-10-15 on branch `completion` (base `de80e4c`, the
Advanced Program tree after AB1). Local commits only — NOT pushed,
NOT deployed, NOT run against any real database or live account.
Everything below is code-level + fake-prisma spec proof + type /
build proof + a static migration cross-check (see Gates for why
the fresh-Postgres run could not be executed this time).

Commits: `f07ba8e` (schema + migration) · `98d8ef9`
(pure helpers + evaluator line + spec) · `7e0b23f`
(GiftCardsService + staff routes + job + hook + spec) ·
`1d6e9f0` (caller wiring: products / shop / POS / single /
landing / public-docs + specs) · `37a16c2` (web UI) · this doc.

---

## AX3 — Gift cards

### The instrument (AX3.3, schema) — DELIVERED
`GiftCard` is a bearer stored-value card. **Code hygiene
(design):** the full code (`QG-XXXX-XXXX-XXXX`, 12 chars from
the AB1 unambiguous alphabet) is NEVER stored in plaintext,
NEVER logged, NEVER in an audit body, a list payload or a URL.
At rest a card carries only `codeHash` (SHA-256 of the canonical
code — the lookup key) and `codeSealed` (AES-256-GCM via the
codebase's `integrations/crypto` `encryptJson({ code })` — the
one recoverable copy). Staff surfaces serialize prefix + last4
only (`serializeCard` projects no hash/sealed fields — spec
asserts the stored row's sealed value does not contain the code
and the reveal returns the original). `balanceCache` is
maintained ONLY by `GiftCardsService.postEntry` inside the same
DB transaction as the `GiftCardLedger` write — the ledger
(issue | redeem | restore | adjust | void | expire, signed
`deltaMinor`, `balanceAfter`) is the truth, mirroring AB1's
loyalty choke point. Exactly-once claims: `(issuedOrderItemId,
unitIndex)` UNIQUE on the card (quantity N on one line mints
units 0..N−1, never twice) + partial unique indexes
`GiftCardLedger_issue_once_per_card` and
`GiftCardLedger_redeem_once_per_card_order` (raw SQL in the
migration; the service checks first, the index backstops).

### Product side (AX3.1) — DELIVERED
`Product.isGiftCard` (default false) + `giftCardConfig` Json
`{ presetAmountsMinor: number[], allowCustomAmount: bool,
minAmountMinor?, maxAmountMinor? }`, validated at save by the
pure `validateGiftCardConfig` (commerce/gift-cards.ts): presets
are positive, de-duplicated, sorted, and must lie inside
[min, max] when both are set; at least one way to pick an amount
must exist (presets, or custom with a minimum when no presets).
A gift-card product has **no stock semantics**: `assertStock`
bypasses it exactly like the preorder bypass, it is never out of
stock, and reservations never engage (untracked by construction
— merchants set no stock on it). **A gift-card product cannot be
bought WITH a gift card**: `resolveForCheckout` refuses when the
cart contains one ("গিফট কার্ড দিয়ে গিফট কার্ড কেনা যাবে না"),
stated in the dashboard product-form help copy.

### Purchase intent (AX3.2) — DELIVERED
`StoreCartItem` gains `giftCardAmountMinor` + `giftCardRecipient`
({ name?, email?, phone?, message? }, flat DTO fields). At quote,
a gift-card line's unit price IS the chosen amount — validated
against the product config (`isGiftCardAmountAllowed`: preset
membership, or custom within [min, max]); a disallowed amount
refuses the quote with a Bengali error; a line with no stored
amount falls back to the product's price only when that price
itself is an allowed amount, else the buyer is sent back to the
product page to choose. At placement the shop checkout records a
`GiftCardIssuance` intent per gift-card order line (orderItemId
UNIQUE = the exactly-once recording claim; the line's unit price
= each card's face value; quantity N = N cards), handing the
cart's recipient data over as hints. POS and externally-synced
orders carry no hints — the reconciler's fallback recorder
creates their intents from the order items alone (recipient
null), so a POS-sold card still issues and its buyer reveals it
on the tracking page. Surfaces: shop + POS (staff manual issue is
AX3.5 below); manual staff orders are covered by the same
fallback the moment their items exist.

### Issuance (AX3.3) — DELIVERED, with the fraud rule
Issuance rides **AB1's reconciler pattern, not a second
transition system**: `GiftCardsService.onOrderTransition`
subscribes to the same event-bus events as `LoyaltyService`
(order.delivered / ingested / created / status_changed /
refunded + delivered shipment events) plus the same direct
`upsertOrder` status-change hook in IntegrationsService (external
sync emits no status event there). The reconciler re-reads the
order and re-derives everything from current state, so duplicate
or reordered triggers are no-ops. **The fraud rule: cards mint
ONLY when the order is in the codebase's sold set** (status
completed|delivered, or a delivered / partially-delivered
shipment — the shared `isSoldOrderShape`). An order that is
merely placed — an unpaid, possibly-abandoned COD order — mints
NOTHING: stored value is only ever created against a sale the
system already counts as sold. Each unissued unit then creates
its card + `issue` ledger entry in one transaction (the
(item, unitIndex) claim decides), copies the recipient fields,
stamps `expiresAt = now + GiftCardSetting.defaultExpiryDays`
when configured, and marks the intent issued.

### Delivery of the code (AX3.4) — DELIVERED
The buyer sees the full code on the order's existing
digital-delivery surface: `StorefrontService.digitalAccess`
(the tracking page's reveal — order number + phone match,
delivery gate unchanged) now also returns the order's issued
gift cards, unsealed at reveal time by
`GiftCardsService.buyerRevealForOrder` — the ONLY unseal path
besides the recipient send. The tracking payload itself carries
names + an `issued` flag + a Bengali note, never a code (spec
asserts the serialized payload contains no code). When the
purchase named a recipient email/phone, the issuance ALSO sends
the code to the recipient (email via EmailProvider when
configured, else SMS via the exact tenant-config → platform
plumbing AB1 uses); the outcome is recorded on the intent as
`sentVia: "email" | "sms" | "none"` — "none" whenever no send
actually happened. Staff surfaces NEVER show the full code
(last-4 only) — including manual issue (below).

### Staff manual issue / void / adjust (AX3.5) — DELIVERED
Dashboard gift-cards page + staff API (commerce controller,
WRITE_ROLES = OWNER/ADMIN/MARKETING_MANAGER, audited):
- **Manual issue** (no order): amount + **note REQUIRED** + a
  recipient contact REQUIRED (email or phone) — refused
  otherwise, because the code can only ever travel to the
  recipient; it is never displayed to staff, not even once. The
  send outcome (`sentVia`) is returned + audited
  (`gift_card.manual_issued`, metadata carries amount + last4
  only). Card + issue entry are created in one transaction.
- **List**: last-4 search, status filter, paginated; columns
  last-4 / initial / balance / status / source (order link or
  manual) / expiry. Balances and statuses in every staff payload
  are EFFECTIVE (lazy expiry applied on read).
- **Detail**: full ledger history.
- **Void**: note required, audited; the remaining balance is
  zeroed through a `void` ledger entry; status → void.
- **Balance adjust**: note required, audited; corrections only,
  through the ledger (`adjust` entry); the resulting balance
  may not go negative; void/expired cards refuse adjustment.

### Redemption (AX3.6) — DELIVERED
Checkout input `giftCardCode` on shop quote + checkout, POS,
and the single-product + landing checkouts (payload + full
wiring — snapshot, evaluation, post-placement spend, mirroring
their AB1 loyalty sites). The server resolves the code by hash
**inside the shop's own org** — a wrong-org code returns the
same generic "কোডটি সঠিক নয়" as an unknown one. The evaluator
gains a caller-supplied snapshot `{ giftCardId, balanceMinor,
codeLast4 }` (it reads no gift-card tables, never throws for
gift-card reasons) and a line **after loyalty** — the final
discount-line order is now:

**promotions → coupon → referral → loyalty → GIFT CARD → tax**

Applied = `min(cardBalance, merchandise payable after every
other discount line)` — it can never exceed what is left to
pay, and like loyalty it shrinks the EC23 tax base
proportionally (it is priced as a discount line; due stays
`total − Σ approved PaymentVerifications` — the
ONE-CALCULATOR INVARIANT holds, a gift card is not a payment
method). `stampOrder` stamps `appliedDiscounts` kind
`"gift_card"` with the code's last4. Callers post the spend
ONLY after successful placement via
`GiftCardsService.postPlacementRedeem` (conditional
in-transaction decrement + the (card, order) redeem claim;
status flips to `depleted` at zero). A depleted / expired /
void card — or redemption disabled — refuses with a clear
Bengali error at quote AND placement time, before any order
exists. **Balance race** (two checkouts, one card): the loser
of the race posts nothing — the conditional claim fails, the
miss is warn-logged for staff reconciliation via adjust, and
the placed order keeps its priced discount (the shop absorbs
it) — AB1's documented posture, adopted verbatim rather than
inventing a rollback of a placed order.

### Reversals (AX3.7) — DELIVERED, one refinement documented
All through the same reconciler:
- **Redeeming order cancelled/failed** → the redeemed amount is
  restored in full (`restore` entry); a card depleted by that
  redemption returns to `active`.
- **Redeeming order refunded** → restore is **proportional to
  the cumulative refunded share** of the order total (AB1's
  rule; cumulative-target based, so repeated reconciles
  converge instead of double-posting). A staff-voided card is
  never resurrected by a restore (warn-logged).
- **Purchase order cancelled/failed or FULLY refunded** → the
  issued cards' REMAINING balances are voided (`void` entries).
  **Already-spent value is NOT recovered** — it was spent as
  money-like value at another checkout and there is nothing to
  claw back from; this is stated plainly here and is the
  liability semantics of the instrument.
- **Refinement:** a PARTIALLY refunded purchase order does NOT
  void its cards (the buyer keeps the un-refunded share of what
  they bought) — mirroring AB1's referral-coupon rule (void at
  full refund only), where the brief's wording did not
  distinguish partial from full.

### Settings + expiry (AX3.8) — DELIVERED
`GiftCardSetting` (org-unique): `redemptionEnabled` default
**true** (the redemption kill-switch — balances survive it),
`defaultExpiryDays` nullable (null = cards never expire). Job
`gift_card_expiry_sweep` (AutomationService pattern, template
interval 1440 min, Bengali description): cards past `expiresAt`
flip to `expired` and their remaining balance is zeroed through
an `expire` entry — the liability view shows that released
amount as expired-unredeemed breakage, a records fact, not an
accounting opinion. Reads are lazy-expiry-aware everywhere even
before the sweep runs. Per-org enablement is owed at
...[truncated 5593 chars]