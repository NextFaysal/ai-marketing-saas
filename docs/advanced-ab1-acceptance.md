# Advanced Program — Batch AB1 Acceptance (AX1 Loyalty Points + AX2 Referral Rewards)

Built 2026-10-15 on branch `completion` (base `7bd706d`, the Completion
Program tree). Local commits only — NOT pushed, NOT deployed, NOT run
against any real database or live account. Everything below is
code-level + fake-prisma spec proof + a fresh-Postgres migration run.

Commits: `85f7705` (schema + migration) · `4e08f4e` (evaluator +
LoyaltyService + wiring + endpoints + job) · `26dbc3c` (checkout
callers + shop account surface) · `9aa4515` (spec, 31 tests) ·
`b1345ac` (account fallback shape fix) · `add34ce` (web UI) ·
`0ba6514` (GB9 drift-guard regeneration) · this doc.

---

## AX1 — Loyalty points

### AX1.1 Settings — DELIVERED
`LoyaltySetting` (organizationId unique): `enabled` default **false**;
`earnPointsPer1000Minor` (points per ৳10 of the earn basis, default 1);
`redeemValueMinorPerPoint` default 100 paisa = ৳1, validated **> 0** in
the service with a Bengali error; `minRedeemPoints` default 0;
`maxRedeemSharePct` nullable; `pointsExpiryDays` nullable (null = never
expires). Staff API: `GET/PUT organizations/:orgId/commerce/loyalty/settings`
(writes OWNER/ADMIN/MARKETING_MANAGER, audited `loyalty.settings_updated`).

### AX1.2 Ledger + cache choke point — DELIVERED
`LoyaltyLedger` is the only truth: signed `deltaPoints`, `reason`
(earn|redeem|expire|adjust|referral_reward), nullable `orderId`,
`balanceAfter`, nullable `expiresAt`, nullable `remainingPoints`
(FIFO lot remainder on credit entries), nullable `createdById`, `note`.
`Customer.loyaltyBalanceCache` is maintained **inside the same
transaction** as every ledger write. Every movement — earn, redeem,
reversal, clawback, expiry, adjust, referral reward — funnels through
one private transactional path in `LoyaltyService`; no other code
writes ledger rows or the cache (grep-verifiable: `loyaltyLedger`
writes exist only in `commerce/loyalty.service.ts`).

Exactly-once claims (ON8/GC23 precedent — in-transaction existence
check first, partial unique index as the DB backstop), created in
migration `20261017010000_ab1_loyalty_referral` and verified present
on a fresh database:

- `LoyaltyLedger_earn_once_per_order` — (organizationId, orderId) WHERE reason='earn'
- `LoyaltyLedger_referral_reward_once_per_order` — (organizationId, orderId) WHERE reason='referral_reward'
- `StoreDiscount_referral_reward_once_per_order` — (organizationId, sourceRef) WHERE origin='referral_reward'

### AX1.3 Earn — DELIVERED
Trigger: `LoyaltyService.onOrderTransition(orgId, orderId)` — a
**reconciler** that re-reads the order + its shipments and re-derives
everything from current state, so duplicate or reordered triggers are
no-ops. It is invoked from the event bus (subscribed in the
constructor, the EC32 affiliates pattern — payload
`{ organizationId, context: { orderId } }`) plus one direct hook (see
coverage table). Earn posts when the order is in the codebase's sold
set (status completed|delivered, or any CourierShipment
delivered|partial_delivered), the org's loyalty is enabled, the order
has a resolved customer, and the order is not a practice order.

**Earn basis (spec decision):** `totalMinor − shippingMinor −
giftWrapMinor` — the order total **after all discounts** (discounts are
already inside `totalMinor`), excluding the two pass-through charges
that are not merchandise value. This is the only basis computable
identically for native and externally-synced orders from stored
columns. Points = `floor(basis / 1000) × earnPointsPer1000Minor`;
skipped when 0. The earn entry carries `remainingPoints = delta` and
`expiresAt = placedAt + pointsExpiryDays` when configured.

### AX1.4 Redeem at checkout — DELIVERED
`PromotionsService.evaluateCheckout` gained an optional `loyalty`
input — a caller-resolved snapshot `{ pointsToRedeem, balance,
redeemValueMinorPerPoint, minRedeemPoints, maxRedeemSharePct }`
(the GB7 caller-passes-identity pattern; the evaluator reads no
loyalty tables). Final discount-line order:

**promotions → coupon → referral → LOYALTY → tax (EC23, last)**

The loyalty discount equals **appliedPoints × redeemValueMinorPerPoint
exactly**: the request is clamped to the balance, suppressed entirely
below `minRedeemPoints`, and capped at the payable-after-other-discounts
and at `maxRedeemSharePct` of that payable — caps reduce the applied
points by floor division, so the priced discount and the later ledger
spend can never disagree. An over-request **never errors the
checkout**; `loyaltyPointsApplied` / `loyaltyDiscountMinor` ride the
evaluation into totals and into `stampOrder`'s `appliedDiscounts` as
`{ kind: "loyalty", name: "লয়্যালটি পয়েন্ট ছাড়", points }`. The
ONE-CALCULATOR INVARIANT holds: redemption is a discount line, never
a payment method; due math is untouched.

Callers wired: shop checkout (quote + checkout DTOs carry
`loyaltyPoints`; snapshot via the GB7-resolved customer), single-product
checkout, landing checkout (DTO inherited), POS (phone-identified
customers only — a walk-in has no verified identity and cannot redeem).
At placement each caller posts the spend via
`LoyaltyService.postPlacementRedeem` **only after the order exists**:
a conditional in-transaction decrement (`balance >= points`) + FIFO
lot consumption; a duplicate call returns the already-posted entry and
posts nothing.

### AX1.5 Reversals — DELIVERED (one refinement, documented)
- **Cancel/failed after redeeming:** an `adjust` entry returns the
  redeemed points (note `redeem_reversal`), exactly-once. The returned
  points form a **new lot with no expiry** — the originally consumed
  lots are not reconstructable once FIFO has eaten them; this is the
  documented trade-off.
- **Refund after earning:** clawback is **proportional to the
  cumulative refunded share** of the order total
  (`floor(granted × refunded / total)`, cumulative-target based, so
  repeated reconciles are no-ops). The brief's "claw back the full
  earned amount" is exactly the full-refund case of this rule; a 50%
  refund claws back 50%, not 100%. The earn lot's `remainingPoints`
  is consumed source-first and zeroed at full refund.
- **Negative balance (decision, as briefed):** clawback is NOT capped
  at the current balance — the balance **may go negative**, and a
  negative balance simply redeems 0 (evaluator clamp) until future
  earnings repay it. The dashboard customer view shows the negative
  state explicitly.

### AX1.6 Expiry sweep — DELIVERED
Job type `loyalty_points_sweep` (AutomationService pattern, template
interval 1440 min, Bengali description) → `LoyaltyService.runExpirySweep`:
each expired lot (`expiresAt < now`, `remainingPoints > 0`) is settled
in its own transaction — lot zeroed, an `expire` entry posted for the
value the customer actually still holds (`min(remaining, balance)`;
if a clawback deficit already consumed the value, a 0-delta expire
entry is still written so the lot's fate is traceable). **The sweep
runs regardless of the enabled flag** — disabling the program must
not silently rewrite the expiry terms of points already issued.
Per-org enablement is owed at deploy (below).

### AX1.7 Surfaces — DELIVERED
- **Shop account** (`GET :orgSlug/account/loyalty`, EC25 session):
  points card (balance + taka value), history with Bengali reason
  labels, order numbers, expiry dates; checkout redeem control
  (balance display, points input, applied discount line, success
  screen points line).
- **Dashboard:** new `dashboard/commerce/loyalty` page (settings form
  + honest explainer copy) + commerce-hub card; customer detail
  (GC15) loyalty section — balance, ledger, referral coupons, staff
  adjust form (delta + **mandatory note**, guarded by WRITE_ROLES,
  audited `loyalty.points_adjusted`); Order 360 loyalty section
  (earned/redeemed/referral/clawed totals + entries) via
  `GET commerce/loyalty/orders/:orderId`.

## AX2 — Referral rewards

### AX2.1 Settings — DELIVERED
`ReferralRewardSetting` (organizationId unique): `enabled` default
**false**; `rewardType` points|coupon; `rewardPoints` nullable;
`couponPercent` nullable (validated 1–90); `rewardMinOrderMinor`
nullable (BigInt, API-serialized as string). Enabling validates that
the chosen type's amount is present (Bengali errors). API:
`GET/PUT organizations/:orgId/commerce/loyalty/referral-settings`.

### AX2.2 Trigger — DELIVERED
The **same reconciler** as earn: when a sold order carries a referrer
— read from the new `Order.referrerCustomerId` column (stamped by
`stampOrder` from the referral resolution; the landing path stamps it
on its inline EC16 stamp; the hook falls back to resolving
`Order.referralCode` → Customer for orders stamped before AB1) — and
referrer ≠ buyer and the payable meets `rewardMinOrderMinor`:
- **points** → a `referral_reward` ledger entry to the referrer.
  **Decision (as briefed): points rewards require the loyalty program
  enabled** — if disabled, the reward is skipped and warn-logged, and
  the settings UI says so. Coupon rewards work independently.
- **coupon** → a real `StoreDiscount` (GB7 pattern): generated
  `REF-XXXXXX` code, `kind: "percent"`, `value = couponPercent`,
  `perCustomerLimit: 1`, `endsAt = +30 days`, `origin:
  "referral_reward"`, `sourceRef = orderId` (the exactly-once claim).
  The referrer is notified by **SMS only**, through the same
  tenant-sender-config → platform-provider plumbing as the shop OTP
  sender; the outcome is recorded honestly in an audit row
  (`loyalty.referral_reward_issued`, metadata `sentVia: "sms" |
  "none"` — "none" whenever no send actually happened, e.g. no phone
  or no configured gateway). Points rewards create no notification;
  the ledger is their record.

`Order.referrerCustomerId` is the one schema addition beyond the two
settings + ledger: the pre-AB1 codebase resolved the referrer inside
the evaluation but never persisted it, so no reward hook could have
known it. Stamping mirrors `referralCode`'s existing discipline
(recorded even when the code granted no discount).

### AX2.3 Clawback — DELIVERED
Referred order refunded → points reward clawed back with the same
proportional rule (note `referral_reward_clawback`); an issued reward
coupon is **voided** (`active = false`) at full refund **only while
unused** (`usedCount = 0`). A redeemed coupon is never voided — its
value is spent; that is final (documented here and in the UI copy).

### AX2.4 Surfaces — DELIVERED
Referral-reward settings form sits **beside the existing buyer-side
referral % config** on the commerce storefront settings page, and on
the new loyalty page — one shared component
(`components/loyalty-referral-settings.tsx`), one API. Customer detail
shows referral rewards earned (points totals live in the ledger;
coupons listed with source order). Shop account shows **"আপনার
রেফারেল"**: the customer's referral code (existing EC16 machinery,
copy button) + reward coupons issued to them + points rewards in the
history list.

## Hook coverage (verified by spec + code path)

| Transition | Path | Earn | Referral reward | Redeem reversal | Clawback / coupon void |
|---|---|---|---|---|---|
| Staff marks delivered/completed | OrdersService → `order.delivered` / `order.status_changed` | ✓ | ✓ | — | — |
| External order syncs born-sold | IntegrationsService → `order.ingested` / `order.delivered` | ✓ | ✓ | — | — |
| External order status changes via sync | IntegrationsService emits **no** status event → **direct `LoyaltyService` hook** in `upsertOrder`'s status-change branch | ✓ | ✓ | ✓ | ✓ |
| Native shipment delivered | CourierService → `shipment.status_changed` (delivered/partial only) | ✓ | ✓ | — | — |
| POS sale | creates via upsert, completes via `updateOrder` → events | ✓ | ✓ | — | — |
| Cancel / failed | `order.status_changed` (+ sync hook) | — | — | ✓ | — |
| Refund (staff / returns completion) | `order.refunded` + reconcile reads cumulative `refundedMinor`; external status `refunded` counts as fully refunded | — | — | — | ✓ proportional; coupon void at full |
| Order surgery (ON2 rebuild) | passes **no loyalty input** (mirrors the known referral-drop behaviour of surgery) — the order's totals carry no loyalty line and nothing posts; staff adjust is the remedy | ✗ documented | ✗ | ✗ | reconciler still applies if the order later transitions |

Every hook is failure-isolated: a loyalty failure logs and never
breaks an order transition (the reconciler catches per-order; the
integrations hook is try/catch wrapped).

## Gates (all personally re-run, exit-code checked)

| Gate | Result |
|---|---|
| API jest (full, chunked serial) | **370 suites / 3967 tests PASS** (baseline 369/3936 + 31 new AB1 tests; the 2 initial public-docs failures were the GB9 drift guard meeting the new route — fixed by deliberately regenerating its frozen inventory, re-run 7/7) |
| API tsc | exit 0 |
| Web vitest | **419/419 PASS** (baseline held; no new web tests — the touched pages have no component-test pattern) |
| Web tsc | exit 0 |
| Full build (7 projects: contracts, db, ui, api, worker, web Next, admin Next) | all exit 0 |
| Prisma validate | valid |
| Fresh-DB migration run (throwaway PG16) | **174/174 applied clean** (173 + AB1); all 3 partial unique indexes present; 251 tables |

Sandbox note: mid-gate, `/tmp` filled to 100% (512 MB tmpfs) and jest
runs died silently on ENOSPC in the transform cache; caches/TMPDIR
were redirected to workspace disk and every chunk re-run clean — a
sandbox quirk, not a code failure.

## Migration + deploy notes

- Migration `20261017010000_ab1_loyalty_referral` — **NOT run on any
  real database.** It is additive only (2 new tables, 1 ledger table,
  2 new columns with defaults, 3 partial indexes).
- **`loyalty_points_sweep` needs per-org enablement** after deploy
  (Automation jobs UI), like every other per-org job.
- Both programs default **OFF** per org (`LoyaltySetting.enabled`,
  `ReferralRewardSetting.enabled`); nothing changes for any org until
  its owner turns them on.
- No push was made (owner-gated); the `completion` branch carries
  AB1 on top of Orders Next + the Completion Program, which are
  themselves still unpushed.

## HONEST LIMITS

1. **Nothing is live-proven.** No real order, SMS, refund or deploy
   was exercised; proof is spec-level (fake prisma), type-level,
   build-level and a fresh-DB migration run.
2. **Referral reward notification is SMS-only.** No inbox/conversation
   message is created (module-cycle posture); `sentVia` records the
   truth, including "none".
3. **Order surgery drops loyalty.** Rebuilt orders carry no loyalty
   discount line (the evaluator input is not passed there — the same
   known behaviour as referral on that path); points already posted
   stay posted; staff adjust is the correction path.
4. **Landing orders' `appliedDiscounts`** does not include the loyalty
   entry — the landing path stamps its EC16 split inline (pre-AB1
   shape, no `appliedDiscounts` write for any kind). The loyalty line
   for such orders is fully visible in the ledger + the Order 360
   loyalty section; referrer stamping (needed by AX2) WAS added to
   the inline stamp.
5. **The insufficient-balance race:** if the balance drops between
   quote and placement, the placement posts no spend (conditional
   decrement fails) but the placed order keeps its priced discount.
   The miss is warn-logged loudly for staff reconciliation via adjust.
   Money is never taken from the customer for it — the shop absorbs
   the priced discount.
6. **Shop checkout balance discovery** rides a 1-point probe quote
   (the quote only resolves loyalty when points are requested); the
   probe never replaces the displayed quote, and a null result hides
   the control. Slightly indirect, deliberately side-effect-free.
7. **Merged customers** cannot redeem under the merged-away record
   (snapshot returns null); postings always resolve to the survivor.
8. **Partial-refund proportionality is a refinement of the brief's**
   "claw back the full earned amount": full refund ⇒ full clawback
   (identical outcome); partial refunds claw back proportionally
   instead of 100%. Recorded here and in the settings UI copy.
