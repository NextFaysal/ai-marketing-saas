# AB4 (AX5 + AX6) — Checkout Completion & POS Depth: Acceptance

*Batch AB4 of the E-Commerce Advanced Program (plan:
`Ecommerce-Advanced-Plan-2026-10-15.md`). Built on branch
`completion` over AB3 HEAD `0b2f3c6`. LOCAL COMMITS ONLY —
nothing pushed; the migration has NOT run on any real
database.*

## Commits (9)

| Commit | Content |
|---|---|
| `3bdc652` | Schema + migration `20261017040000_ab4_checkout_pos` + pure helpers (`fraud/deposit.ts`, `storefront/checkout-fields.ts`) — coordinator |
| `cd8d8ed` | AX5a API: scoped initiation (deposit/balance/remainder), claim-idempotent `gateway_deposit` verification, settlement-scoped order stamps, deposit state + resend scoping, deposit settings |
| `895aedc` | AX5b/AX5c API: placement wiring (shop/landing/single stamps + field validation), quote deposit amounts, shopHome field defs, express checkout route |
| `ef76358` | AX5b API: checkout-field staff CRUD + getOne labels/deposit + CSV columns |
| `1e007b6` | Web libs: deposit types/helpers, initiate purpose, checkout-fields + express payload helpers |
| `af718e8` | Web shop surfaces: custom fields + deposit on checkout/success/single/landing, express on PDP+cart — **also contains the POS API files (see Process note)** |
| `fce7823` | Web dashboard: deposit settings card, field-def CRUD UI, order-detail fields+deposit |
| `8729692` | Web POS: offline outbox + sync ledger panel, camera scanning |
| (this doc) | AB4 acceptance |

**Process note (disclosed):** the POS builder's six
`apps/api/src/pos/*` files were staged in the shared index and
were swept into the web builder's commit `af718e8`. The content
is complete and verbatim (the POS builder verified it against
its own work); only the commit attribution is wrong. History
was not rewritten (parallel builders were active on the
branch).

## AX5a — Real deposit/advance collection

**Config (BusinessProfile, beside the GB3 COD rules):**
`depositMode` (null=off | percent | fixed), `depositPercent`
(1–90), `depositFixedMinor` (paisa), `depositAppliesTo`
(cod | online | all, default cod), `depositNote` (buyer copy;
a Bengali default is provided by `depositFor`). Managed in the
dashboard settings page next to the COD rules card; exposed on
the profile read as `deposit: depositConfigOf(profile)` (and on
`checkoutTrust` for the single/landing surfaces).

**Math:** the pure `depositFor(profile, { totalMinor, kind })`
(fraud/deposit.ts, 17 unit specs): percent = floor(total × pct
/ 100), a 0 result is OFF for that order; fixed = min(fixed,
total); invalid config (percent outside 1–90, fixed ≤ 0,
total ≤ 0, kind not covered) = OFF — never guessed. The
deposit is a PAYMENT slice: totals always come from
`evaluateCheckout`; nothing here discounts anything.

**Stamp:** at placement (all three surfaces) the order gets
`Order.depositDueMinor` = the computed amount (null = no
deposit). What has been PAID toward it is never stamped — it
derives from approved PaymentVerifications (see trace).

### The deposit money-flow trace (as built)

1. Placement computes the deposit server-side and stamps
   `depositDueMinor`; the checkout response carries
   `{ amountMinor, kind, note, dueAfterMinor }`.
2. Collection initiation (`initiatePublicPayment` with
   `purpose: "deposit"`, or staff `PaymentResendService` with
   `purpose: "deposit"`) recomputes the deposit from the
   profile — the client's amount is never trusted — and
   creates a `TenantPaymentTransaction` with
   `amountMinor = deposit`, `purpose = "deposit"`. Gateway
   verification compares the confirmed amount to
   `txn.amountMinor`, so a deposit-sized transaction verifies
   through the EXISTING trust chain unchanged.
3. At the verified_paid transition (`markVerifiedPaid`, both
   own and platform paths), a deposit transaction writes
   exactly ONE approved `PaymentVerification`
   (source `gateway_deposit`, verdict `matched`,
   amount = the deposit). Exactly-once: a pre-generated id is
   claimed via conditional `updateMany` on
   `TenantPaymentTransaction.depositVerificationId`
   (the GB9 failureNotifiedAt idiom) before the row is
   created; an IPN re-delivery loses the claim and skips; a
   create failure reverts the claim so a later re-delivery
   can retry; the bookkeeping never throws out of the IPN
   path.
4. Because the order's canonical paid sum IS Σ approved
   PaymentVerifications, every existing reader — order detail
   `advancePaidMinor`/`amountDueMinor`, ON1 `due_collection`
   (whose predicate also requires status completed/delivered),
   ON7 khata/profit, order surgery's overpaid check — counts
   the deposit with ZERO reader changes: paid = deposit,
   due = total − deposit.
5. Settlement scoping (see below) keeps a partial payment
   from masquerading as a full one; the public payment state
   reports `deposit_paid` + `{ dueMinor, paidMinor,
   outstandingMinor }` until Σ verified ≥ total, when it
   reports `verified_paid`.
6. The remainder is collectable: a later initiation defaults
   to the remaining amount (`purpose: "balance"`), and the
   staff payment-link resend proceeds for the outstanding
   deposit/balance instead of refusing.

### Full-vs-partial settlement touchpoints found + scoped

Everything found that treated ANY verified payment as full
settlement, and what AB4 did:

| Touchpoint | Before | Now |
|---|---|---|
| `initiateOrderPayment` / `initiatePlatformOrderPayment` refusal | ANY verified payment blocked all further initiation | Refusal only when Σ verified ≥ total; new initiation defaults to the remainder; explicit amounts must be > 0 and ≤ remaining |
| Order stamp in `markVerifiedPaid` (own path) | `paymentMethod = provider`, `isCod = false` on any verified payment | Flip ONLY when this transition settles the total; a partial payment appends `[আংশিক পেমেন্ট যাচাইকৃত — …]` note and leaves method/COD untouched (a COD order that paid its deposit online stays COD for the balance). Platform path: the wallet service's own pre-credit stamp is snapshotted and restored when unsettled |
| `PaymentResendService` | Refused when any attempt was verified_paid | Refuses only at full settlement; supports `purpose: "deposit" | "balance"` |
| `publicPaymentState` | Any verified txn → `verified_paid` | `verified_paid` only when settled; a verified deposit with balance outstanding → `deposit_paid` + deposit block. Additive `deposit` block on all returns (three exact-shape GC10 expectations updated deliberately, commented) |
| `order.paid` webhook event (GC23) | Fired at any verified_paid | Still fires per verified transition (trigger unchanged), context now carries `purpose`, `fullySettled`, `orderTotalMinor` so consumers can distinguish a deposit from full settlement |

Deliberately NOT changed: full-payment behaviour is
byte-identical when no deposit is configured (purpose
defaults to `"full"`, Σ verified = total on the first
payment); a manual-method deposit (buyer pays bKash manually
+ proof) still rides the existing PaymentVerification review
flow — no new code, and the checkout copy presents it as the
unverified-claim path it is.

### Single/landing honesty split

Single-product and landing checkouts have NO initiation UI
(the GC10 partial). AB4 gives them the deposit config as a
NOTICE only: placement stamps `depositDueMinor` and the
response carries `{ amountMinor, note }`, rendered as
"এই অর্ডারে ৳{amount} advance প্রয়োজন — {note}" with copy
that the shop will arrange collection. No collection is
faked on those surfaces. (Their preview payloads carry the
deposit CONFIG via `checkoutTrust.deposit`; neither surface
has an amount-bearing quote endpoint to extend.)

## AX5b — Custom checkout fields

- `CheckoutFieldDef` CRUD (staff, OWNER/ADMIN/MARKETING_MANAGER
  writes, audited `checkout_field.*`): key slug
  `^[a-z0-9][a-z0-9_]{1,39}$`, unique per org; **key immutable
  after create** (renaming would orphan placed orders'
  answers); select requires 1–30 trimmed unique options;
  non-select types store options null.
- Validation (`checkout-fields.ts`, spec'd matrix): answers
  are checked against the org's ACTIVE defs for the placement
  surface (`appliesTo` = surface | all). Unknown keys are
  REJECTED (a renamed required field must never silently
  vanish), missing required is rejected, select values must
  be in options, checkbox coerces boolean/"true"/"false"
  only (a required checkbox must be true), text is trimmed
  and capped (1000 / textarea 4000 chars). Rejection happens
  BEFORE any order write on all three surfaces.
- Storage/rendering: validated map → `Order.checkoutFields`.
  Order detail (getOne + dashboard) resolves labels at read
  (deleted def → the key itself is the label). The orders CSV
  export appends one `field:<key>` column per ACTIVE def
  (boolean → yes/no); with no defs the CSV is byte-identical
  to before. Defs are exposed per surface on the public
  payloads (shop home for shop; the single/landing payloads
  for theirs).

## AX5c — Express checkout

- `POST /public/shop/:orgSlug/express-checkout` (added to the
  GB9 frozen public-route inventory with an AB4 comment, per
  the AB1/AB2 precedent). Server: valid EC25 session required
  (else 400 "এক্সপ্রেস অর্ডারের জন্য আগে লগইন করুন") + an
  OWNED address (explicit `addressId` not owned → 400; else
  the default address, else the oldest; none → 400). The
  endpoint builds a standard CheckoutDto from the saved
  address and delegates to the SAME `checkout()` — no new
  pricing path, no stored payment instruments (none exist).
  Note: the order attaches to a customer by `checkout()`'s
  normal phone rules — if the saved address's phone differs
  from the account phone, the order follows the address
  phone, exactly like a manual checkout with that address.
- Web: PDP + cart show "এক ক্লিকে অর্ডার করুন" only for a
  logged-in shop session; the confirmation sheet shows the
  default address, server quote totals (+ deposit lines when
  active), the account's last-used payment method as a
  DISPLAY preselect, custom fields and terms when required;
  confirm places through the endpoint and hands off to the
  success page exactly like the normal checkout.

## AX6a — POS camera scanning

POS page scan button with `BarcodeDetector` feature
detection: unsupported browsers (Safari/Firefox) get the
manual-entry note + focus — never a crash. The camera loop
(getUserMedia, environment facing, 300 ms detect interval)
normalizes each code (`lib/pos-scan.ts`: trim/control-strip
+ a 1500 ms same-code debounce, unit-spec'd) and feeds it
into the EXISTING exact SKU/barcode search flow (the same
handler as Enter), with visible "স্ক্যান হয়েছে: {code}"
feedback. Camera/permission errors degrade to the manual
note. Purely additive UI — no API change.

## AX6b — POS offline sales + sync

**Client outbox** (`lib/pos-offline.ts`, unit-spec'd):
versioned localStorage queue per org
(`qosprey.posOutbox.v1.{orgId}`), corrupt data reads as an
empty queue. Every sale attempt (online or off) carries a
client UUID `idempotencyKey`; a sale is queued ONLY on a
network failure (lib/api.ts's network-error signal) or when
`navigator.onLine` is false — HTTP errors surface normally
and are never queued. Queued sales show a clearly-labelled
local/আনুমানিক receipt card. The POS header shows connection
state + pending count; sync posts entries sequentially and
removes a local entry only on a terminal server status.

**Server:** `CreatePosSaleDto.idempotencyKey` replays through
GB3's `IdempotencyService` under the namespaced key
`pos:{key}` inside `createSale` — a retried sync (or a
retried online sale) returns the stored result and can never
place a second order (spec-proven: upsert called once).
`PosOfflineSync` is the staff ledger: sync upserts by
(org, idempotencyKey), a synced key returns its row
unchanged, and every attempt posts through the NORMAL
`createSale` (server prices are truth; stock checks apply at
sync time).

**Classification (deterministic, pre-checks first):**

| Condition | Outcome |
|---|---|
| Product missing/inactive, variant not owned, empty items (pre-check) | **rejected** — `createSale` never called |
| Aggregated tracked stock insufficient (pre-check) | **conflict** — `createSale` never called |
| `createSale` throws plan-limit (`OrderLimitBlockedError`) | **conflict** |
| `createSale` throws the stock refusal (a race past the pre-check) | **conflict** |
| Any other `createSale` error (invalid coupon, duplicate TrxID, gift-card refusal…) | **rejected** (reason truncated to 500) |
| Posted clean | **synced** — `serverOrderId`, `serverTotalMinor`, `varianceMinor = server − local` recorded EVEN WHEN 0 (null only when the client sent no local total), `syncedAt` |

**Staff actions** (sync panel; writes are POS WRITE_ROLES,
audited): a conflict can be re-posted — with `force: true`
the re-post calls `createSale(..., { forceStock: true })`,
which skips ONLY the per-line stock-quantity refusal (the
merchant-sanctioned overdraw, like backorder; prices, the
evaluator and placement stock hooks are untouched) — or
discarded with a note. Rejected rows: discard only. A
plan-limit conflict re-posted without a lifted limit simply
conflicts again (force does NOT override plan limits — it
is a stock override, not a billing override). Discarding a
synced row is refused.

## Gates (coordinator-run, exit-code checked)

| Gate | Result |
|---|---|
| API jest (8 chunks, `--runInBand`) | **382 suites / 4,159 tests — all pass** (baseline 376/4,067 → +6/+92 = exactly the batch's new specs: deposit 17, deposit-payments 14, checkout 9, fields 41, pos-offline 11). One in-chunk failure: `inbox/cx3-debounce` — the CX-era flake already on record in MEMORY.md; standalone re-run 18/18 pass, untouched by this batch |
| API tsc (`tsconfig.build.json`) | exit 0 |
| Web vitest | **462/462 pass** (baseline 431) |
| Web tsc | exit 0 |
| Full build (`pnpm -r build`) | exit 0 — 7/7 projects incl. both Next builds |
| prisma validate | valid |
| Fresh-DB (throwaway DB on the sandbox PG16 cluster) | **177/177 migrations applied clean**, 261 public tables; `CheckoutFieldDef` + `PosOfflineSync` tables and all AB4 columns verified via information_schema; DB dropped + cluster restored afterwards |
| Boot smoke (compiled API vs the fresh DB) | "Nest application successfully started"; new routes mapped: `POST /public/shop/:orgSlug/express-checkout`, checkout-fields CRUD ×4, `pos/offline-sync` POST/GET + repost/discard |

## Deploy notes

- Migration `20261017040000_ab4_checkout_pos` is additive
  only and has NOT run on any real DB — run it at deploy.
- NO new per-org jobs in AB4 (offline sync is staff-driven,
  deposits ride the existing payment IPN paths).
- The GB9 public-docs drift guard was regenerated for the
  one new public route (express-checkout) — deliberate, in
  `gb9-public-docs.spec.ts`.

## Honest limits

- **No live proof:** no real gateway deposit round-trip, no
  real browser camera scan, no real offline→online browser
  sync was exercised — everything is spec/fixture/fresh-DB
  level (M30-style live verification still owed). The deposit
  VERIFICATION leg rides the same trust chain as full
  payments (amount == txn.amountMinor), which is fixture-
  proven for the existing providers.
- Deposit configuration lives on BusinessProfile; the
  pre-existing `advancePaymentPercent` field (M75, an AI
  context/display field) is separate and untouched — the
  settings card makes clear the deposit fields are the ones
  checkout enforces.
- A deposit collected MANUALLY (buyer sends to the shop's
  bKash number) still enters the paid sum only through staff
  recording/approving a PaymentVerification — by design;
  the system never treats a buyer's claim as money.
- POS offline: the client queue lives in ONE browser's
  localStorage — clearing site data loses unsynced sales
  (the panel copy does not claim otherwise); queued sales
  carry client-computed totals that are display-only — the
  recorded variance is where any difference surfaces.
- Express checkout covers the shop surface only (single/
  landing have no account sessions), and delivery-slot /
  pickup-point choices stay in the full checkout.
