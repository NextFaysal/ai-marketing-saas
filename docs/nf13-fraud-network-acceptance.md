# NF13 Acceptance — Platform Fraud Network (FB5, Tier-4 item 1)

**Package:** New Features Frontier (NF13 approved in full 2026-10-17) · **Worktree/branch:** `~/workspace/ai-marketing-saas-nf`, `new-frontier` · **Base:** `daeb4ed5` (FB4 code-complete, 236 migrations; 237 with NF13's)
**Local commits only — nothing pushed.** Migration claim used: `20261040000000_nf13_fraud_network` ONLY.

**PRIVACY IS THE PRODUCT.** This is a cross-org feature whose entire value rests on what does NOT cross: the only things that ever leave an org are an HMAC-SHA256 hash of a phone number and aggregate outcome counters. No raw phone is stored in any of the three new tables (the org-side ledger included), no name/order detail/message exists anywhere in the design, and the shared aggregate table carries no org id at all. Opt-in is per-org, OWNER-only, and consent is timestamped: orders created before opt-in NEVER contribute.

## Per-item record

| # | Commit | Item |
|---|---|---|
| 1 | `3c3e2270` | Schema + migration `20261040000000_nf13_fraud_network`: `FraudNetworkSetting` (org-unique, opt-in), `FraudNetworkPhoneStat` (hash-keyed aggregate, NO other fields), `FraudNetworkContribution` (org-side hash-only ledger, unique per org+order) |
| 2 | `09839754` | API: `FraudNetworkService` + `FraudNetworkController` + `FraudNetworkModule`; `fraud_network_sweep` job in AutomationService (type + template, default OFF per org); FraudShield sibling `networkSignal`; module registered in `app.module.ts`, `orders.module.ts`, `automation.module.ts` |
| 3 | `7f00e18e` | Specs: `nf13-fraud-network.spec.ts` — 16 tests (the 10 required cases + outcome mapping, shipment phone fallback, sweep honesty, 3 FraudShield sibling tests) |
| 4 | `3a2a4e8d` | Web: `FraudNetworkCard` in the Fraud Shield settings panel, `networkSignal` rendering in the fraud detail card + order action panel, `lib/fraud-network-nf13` + 5 vitest |

## Design

### Data model (exactly as briefed)

- **`FraudNetworkSetting`** — `{ id, organizationId @unique, enabled (default false), enabledAt?, enabledById?, createdAt, updatedAt }` + Organization relation (Cascade). One row per org; absence of a row = not opted in.
- **`FraudNetworkPhoneStat`** — `{ phoneHash @id, contributingOrgCount, deliveredCount, returnedFailedCount, codRefusalCount, updatedAt }`. **NO other fields.** No org ids, no raw phone — the row cannot say WHICH orgs contributed, only how many.
- **`FraudNetworkContribution`** — `{ id, organizationId, orderId, phoneHash, outcome, createdAt }`, `@@unique([organizationId, orderId])`, `@@index([organizationId, phoneHash])`. The org-side ledger stores the HASH only too — a raw phone appears in none of the three tables (spec-proven by string inspection of every row).

### Hashing

- `hashFraudPhone` = HMAC-SHA256 hex of the canonical phone, key = `process.env.FRAUD_NETWORK_HMAC_KEY`, read on **every** call (never cached at construction). Canonical phone: `normalizeBdPhone` (orders/phone-utils) first; if null, the `phoneDigits` string when it has ≥ 10 digits; if neither, no contribution/lookup for that value.
- **Key absent = the whole feature is inert.** Settings GET returns `available: false`; enabling REFUSES with an honest Bengali `BadRequestException` ("এই সুবিধাটি সার্ভারে এখনো চালু হয়নি — …"); `contributeForOrder` returns `{ contributed: false, reason: "unavailable" }`, `lookup` returns `{ status: "unavailable" }`, the sweep reports `skippedReason: "unavailable"`. There is **never** a fallback to plain SHA or a hardcoded key. Disabling remains possible without a key (it can only stop things).

### Contribution

Outcome classification REUSES `classifyOutcome` + `OrderOutcomeInput` from `apps/api/src/orders/risk-score.ts` with the order's status/isCod and its courier shipment statuses — no second classifier exists. Mapping:

| classifyOutcome | deliveredCount | returnedFailedCount | codRefusalCount |
|---|---|---|---|
| `delivered` | +1 | — | — |
| `returned` | — | +1 | — |
| `refunded` | — | +1 | — |
| `cancelledOrFailed` | — | +1 | +1 **only if** `order.isCod` |
| `open` | contributes nothing | | |

COD refusals are a SUBSET of returnedFailed (a COD refusal is a failed delivery), so `total = delivered + returnedFailed` never double-counts.

- `contributeForOrder(orgId, orderId)` is a no-op unless **all** hold: key present; setting exists with `enabled = true`; `order.createdAt >= setting.enabledAt` (**NO pre-consent backfill** — an order created before opt-in never contributes, even if it terminates after); no existing contribution row for `(orgId, orderId)`. Phone is resolved exactly like `RiskService.loadOrgData`: customer.phone → first shipment recipientPhone → conversation contactPhone.
- Exactly-once rides the `(organizationId, orderId)` unique claim row, written BEFORE the aggregate merge; a replay/race hits the unique and counts nothing twice.
- `contributingOrgCount` increments ONLY when this org has no prior contribution row for that phoneHash — it counts DISTINCT orgs, never orders (spec-proven: one org, two orders, same phone → count 1, delivered 2).
- **Trigger:** the `fraud_network_sweep` automation job ONLY (template default OFF per org, like `service_booking_reminder_sweep`). The sweep scans the org's terminal (non-`open`) orders not yet contributed and calls `contributeForOrder` per order; per-order failures are COLLECTED into the result (`failures: [{orderId, error}]`), never silent and never aborting the sweep. No order/courier flow was forked to call contribution opportunistically.

### Consumption

- `lookup(orgId, phone)`: key absent → `{ status: "unavailable" }` (checked first, so a key-less deployment answers unavailable even before opt-in state matters); setting not enabled → `{ status: "not_opted_in" }`; hash; no stat row or `contributingOrgCount < 3` → `{ status: "insufficient_data", contributingOrgCount }` — **the delivered/returned counts are NEVER returned below the floor** (spec-proven by exact-object equality + string inspection); otherwise `{ status: "ok", delivered, returnedFailed, codRefusals, contributingOrgCount, total }`.
- **Fraud Shield wiring:** `FraudShieldService` gains `FraudNetworkService` as an `@Optional()` dep appended LAST in the constructor (positional spec constructions keep their meaning), provided via `FraudNetworkModule` imported by `OrdersModule`. `assessOrder` computes the signal once (failure-isolated helper) and returns it as an OPTIONAL sibling field `networkSignal` on both the trusted-phone and normal returns; `reassess` carries it to staff the same way (and computes it from the fresh order when the shield itself returned no assessment). The field is present ONLY when the lookup says the org opted in (`ok` / `insufficient_data`); `not_opted_in` / `unavailable` / any thrown error → the field is **absent**. It is never merged into the org's own score/band/reasons, and assessment still never throws (spec-proven with a throwing lookup stub).
- **Routes** (`FraudNetworkController`, `@PermissionArea("orders")`, TenantGuard + RolesGuard): `GET /organizations/:organizationId/fraud-network` → `{ available, enabled, enabledAt, enabledById, explainerSeen }` for any staff member (`explainerSeen` is derived: an org that has ever enabled has an `enabledAt`); `PATCH` same path with `@Roles("OWNER")` only, body `{ enabled: boolean }`; `GET /organizations/:organizationId/fraud-network/lookup?phone=…` → the lookup result. The phone query value is hashed server-side and never stored or echoed.

### Settings semantics

- Enabling stamps a FRESH `enabledAt` + `enabledById` (the consent moment the createdAt rule rides) and writes an audit log (`fraud_network.enabled` / `fraud_network.disabled`, no phone data in metadata).
- Disabling flips `enabled` off (the last `enabledAt` is kept as history); every contribution path checks `enabled` first, so contributions stop immediately. Re-enabling stamps a NEW `enabledAt`, so orders created during the disabled window have `createdAt < enabledAt` and never contribute (spec-proven end-to-end).

## Web

- **Card:** `FraudNetworkCard` (self-contained: loads/saves its own settings, no new prop plumbing) rendered inside the existing Fraud Shield settings panel (`FraudSettingsPanel`). BEFORE the toggle it states in plain Bengali: what is shared (শুধু সংখ্যা — কতটি ডেলিভারি/রিটার্ন; ফোন নম্বর hash আকারে; নাম, অর্ডারের বিবরণ, মেসেজ — কিছুই নয়), that enabling is per-org and OWNER-only, that disabling stops future contributions immediately, and honestly that past contributions already merged into the aggregates cannot be removed ("সত্যি কথা: … তা আর আলাদা করে সরানো যায় না") — the string is pinned byte-stable in `lib/fraud-network-nf13` and its vitest. If the API says `available: false`, the card shows "এই সুবিধাটি সার্ভারে এখনো চালু হয়নি" and the toggle is disabled. A non-owner toggle attempt surfaces the API's OWNER-only refusal verbatim (the server is the authority).
- **Signal rendering:** the orders page fraud detail card and the order action panel render `networkSignal` when present: heading "নেটওয়ার্ক তথ্য (Xটি দোকানের সম্মিলিত)", body with delivered/returnedFailed/COD-refusal counts for `ok`, and "নেটওয়ার্কে এখনো যথেষ্ট তথ্য নেই" for `insufficient_data` — always with the note that it is NOT the shop's own score. The page's `reassessFraud` merges the reassess response's `networkSignal` into the row/detail state via the existing `syncOrderRow`. `lib/fraud-network-nf13.ts` holds the types + pure label helpers; `fraud-network-nf13.test.ts` pins them (5 tests).

## Gates (targeted only, per brief — full web vitest/build + fresh-PG + boot smoke are the coordinator's serial gates)

| Gate | Result |
|---|---|
| `nf13-fraud-network.spec.ts` (jest) | **16/16 PASS** — (1) opt-in gating both directions (direct + sweep + lookup), (2) hash-only storage (no raw phone in raw/+880/digits form in any of the 3 tables or settings/lookup payloads; stat row has no organizationId), (3) exactly-once (contribute ×2 + sweep ×2 → counters move once), (4) no pre-consent backfill (before-enabledAt refused `pre_consent`, after contributes; sweep honours it), (5) <3-org suppression (1 and 2 orgs → `insufficient_data` with NO counts, exact-object proven; 3rd org → `ok` with counts), (6) disable stops immediately + re-enable's new enabledAt excludes the disabled-window order, (7) key absent (settings `available:false`, enable refuses in Bengali, contribute/lookup/sweep unavailable, disable still allowed), (8) distinct-org counting, (9) settings isolation org A vs B, (10) COD refusal mapping both ways; plus returned/refunded mapping + shipment-returned wins + open contributes nothing, shipment-recipientPhone fallback, sweep honesty counts; plus FraudShield sibling: opted-in `networkSignal` present with own score untouched + reassess carries it, non-opted-in ABSENT, throwing lookup still yields a score |
| Regression (touched surfaces) | `gb3-fraud-core` + `on4-fraud` + `risk-score` + `ab8-device-signal` + `cx1-courier-record` — **106/106 PASS** in one run; `src/automation` suites (incl. `a4-job-templates`, which cross-checks templates ↔ executeJob cases) — **83/83 PASS** |
| API `tsc --noEmit` | **PASS** (after the API commit) |
| Web `tsc --noEmit` | **PASS** |
| Web vitest (targeted) | `fraud-network-nf13.test.ts` **5/5 PASS** |
| `prisma validate` | **PASS**. Note: `prisma generate` was not re-run in this worktree (the pre-existing root-owned client noted in FB1–FB4); all NF13 API code follows the codebase's `(prisma as any)` discipline and typechecks without regenerated types. The coordinator's fresh-PG gate deploys the migration SQL directly. |

## NOT BUILT / limits

- **No removal of past aggregates.** Once a contribution has merged into `FraudNetworkPhoneStat`, there is no per-org/per-order unmerge — by design (the aggregate cannot attribute counts back to an org) and stated honestly in the card, the API design and this doc. Disabling stops only future contributions.
- **No cross-check beyond phone.** The network keys on the phone hash only — no device, address, name, IP or payment-instrument signals cross orgs, and none were added.
- **The sweep is the only trigger.** No order-status, courier-webhook or checkout hook calls contribution; an opted-in org that never installs/enables the `fraud_network_sweep` job contributes nothing. Contribution latency is therefore the sweep interval, not real-time.
- **No lookup API beyond staff surfaces.** There is no public/checkout-time network check, no customer-facing surface, and no platform-admin view of per-phone stats; the stat table is readable only through an opted-in org's own staff lookup (floor-gated).
- **Suppression floor is a constant** (`FRAUD_NETWORK_MIN_ORGS = 3`), not a per-org or platform setting.
- **Stat merge is read-modify-write** after the unique claim row; concurrent sweeps for the SAME org could interleave the aggregate update (the claim row still guarantees each order counts once per org; the sweep is serial per org in the scheduler). No transactional counter increment is claimed.
- **Fallback-canonical numbers** (non-BD-parseable digit strings ≥ 10 digits) hash their digit string, so the same physical number written in two different non-canonical forms could hash differently — the strict BD normal form covers the product's actual market; the fallback exists so a hashable number is never silently dropped.
- **Fractional coverage of `explainerSeen`:** it is derived from `enabledAt` (ever-enabled ⇒ explainer seen), not a separately tracked UI acknowledgement — no schema field was added for it beyond the briefed model.

## Live proof owed

- **Everything live is unproven.** No NF13 migration has run on a real database, no real org has opted in, no real sweep has contributed a real order, and `FRAUD_NETWORK_HMAC_KEY` has not been set on any real deployment (until the owner sets it, production correctly reports the feature as unavailable). Owner actions owed: (1) push instruction for this line + manual Dokploy Redeploy (migration `20261040000000` will run on the real DB); (2) set `FRAUD_NETWORK_HMAC_KEY` in the API environment (a deployment secret, never in chat/repo) — without it the feature stays honestly inert; (3) per-org OWNER opt-in from the Fraud Shield settings card + installing the `fraud_network_sweep` job template per org; (4) a real three-org check: the same test phone completing orders in three opted-in shops, then the lookup + order-panel signal verified against the real counters.
