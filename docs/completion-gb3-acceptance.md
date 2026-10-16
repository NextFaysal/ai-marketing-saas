# GB3 Acceptance — G3 Checkout & Fraud Hardening (GC8 + GC9)

**Batch:** GB3 of the E-Commerce Completion Program (plan: `Ecommerce-Completion-Plan-2026-10-15.md`).
**Base:** branch `completion` at GB2 HEAD `d966064` (orders-next line). Local commits only — **no push**.
**Migration:** `20261013930000_gb3_checkout_fraud` (167th migration).

**Deploy notes:** this migration has NOT been run on any real database. Fresh-Postgres-16 verification WAS run by the coordinator (throwaway cluster): `prisma migrate deploy` over the full sequence — **167/167 applied clean, 234 tables**; the 6 new tables (`IdempotencyRecord`, `BlockedIdentifier`, `TrustedIdentifier`, `FraudAttemptLog`, `FraudRule`, `FraudRuleHit`) and the new columns on `StorefrontSetting` / `BusinessProfile` / `Order` / `FraudShieldSetting` verified present via information_schema.

**New dependencies:** none. The Turnstile widget is rendered explicitly from Cloudflare's official script (no npm package); the server verifies with a plain `fetch` to siteverify.

---

## GC8 — Checkout trust

### §1 Terms consent — DELIVERED
- `StorefrontSetting.requireTermsConsent` (default **FALSE**) + `termsUrl` (nullable). There is deliberately **no stored `termsSource` enum**: the source is resolved dynamically by ONE shared builder (`apps/api/src/fraud/checkout-trust.ts`) — the org's **published** GC2 `ShopPage` slug `"terms"` wins, otherwise the merchant `termsUrl`. The consent reference is `page:terms@<updatedAt ISO>` (it pins WHICH version was consented to) or the URL itself.
- All three native checkout DTOs gain optional `termsAccepted`; when the setting is on and the flag is absent/false the server refuses **400** with a clear Bengali message (“অর্ডার করতে শর্তাবলিতে সম্মতি আবশ্যক”). Placed orders stamp `Order.termsConsentedAt` + `Order.termsRef`.
- One shared public payload shape — `checkoutTrust { termsRequired, termsRef, termsUrl, termsPage, captcha{…}, cod{…} }` — is attached by the shop home, the single-product payload and the landing payload, so every surface tells the shopper the same facts. All trust-payload reads are failure-isolated (a read problem degrades to “nothing required”, never a broken page).
- Web: consent checkbox (with terms link) on shop / single / landing checkouts; unchecked blocks submit client-side AND server-side. Dashboard: “শর্তাবলিতে সম্মতি আবশ্যক” toggle + terms URL field on the storefront settings card.
- **Parity:** with the setting off, no field is required and nothing is stamped — the GB3 specs pin the disabled behaviour on all three paths.

### §2 Idempotent checkout submission — DELIVERED
- Transport choice (documented): a **body field** `idempotencyKey` on the three checkout DTOs — the codebase's public checkout POSTs are body-driven and the global ValidationPipe is whitelist + forbidNonWhitelisted, so a header would have needed parallel plumbing in three controllers for no gain. Keys are capped at 80 chars.
- `IdempotencyRecord` (organizationId, key, scope shop|single|landing, orderId, responseJson; `@@unique([organizationId, key])`). Flow per checkout: replay-check first → a known key returns the **stored original response** (same shape as a fresh success; no second order, stock decrement or verification is created — spec-asserted). The record is written only **after a successful placement**, so a key whose first attempt failed validation is NOT burned and can be retried. A unique-violation race returns the winner's stored response. All idempotency reads/writes are failure-isolated: bookkeeping can never fail a placed order.
- Web: `useIdempotencyKey` (in `TurnstileWidget.tsx`'s module) generates one key per checkout-form mount, reuses it across retries/double-clicks, and the three forms `reset()` it only after a successful order.

### §3 COD rules v2 — DELIVERED
- The fields live on `BusinessProfile`, next to the existing `codAvailable`: `codMaxOrderMinor` (BigInt, nullable), `codBlockedDistricts` (Json string list), `codAdvanceRequiredAboveMinor` (BigInt, nullable). `OrganizationsService.profileJson` serializes the money fields as strings (BigInt-safe) and the districts as an array-or-null; the update path trims/dedupes districts and treats an empty list as null.
- ONE pure evaluator — `evaluateCodRules(profile, { totalMinor, district, parsedDistrict, parsedConfidence })` in `apps/api/src/fraud/cod-rules.ts` — is called by all three checkouts (parity spec across shop/single/landing):
  - total above `codMaxOrderMinor` → COD refused;
  - district match → COD refused. District = the structured district when present, else the ON11 parse **only at high|medium confidence** (a low-confidence parse never blocks), compared normalized (case/space-insensitive);
  - max and district refusals share **one generic Bengali COD message** — the shopper is never told which rule fired;
  - total above `codAdvanceRequiredAboveMinor` → the placed order is stamped `Order.codAdvanceRequired = true` and checkout shows an advance-required notice. **Display/flag only — no payment gate was built** (the EC19 staff advance flow already exists).
- The ON1 `needs_confirmation` queue is extended by a **union**: orders with `codConfirmationStatus = "awaiting"` (unchanged query) PLUS orders with `codAdvanceRequired = true`. The existing queue predicate shape is untouched (ON1 queue specs pass unchanged); `ready_to_pack` is unchanged.
- Shop quote response gains `codRules { maxOrderMinor, advanceAboveMinor, unavailableForTotal, advanceRequiredForTotal }` so the shop checkout can disable the COD option and show the notices before submit (the server still enforces).
- Dashboard: COD সর্বোচ্চ অর্ডার / অগ্রিম আবশ্যক সীমা (taka inputs) + comma-separated blocked districts on the settings page profile form.

## GC9 — Fraud hardening

### §1 Identifier lists — DELIVERED
- Two new models in the leaf `FraudModule`: `BlockedIdentifier` and `TrustedIdentifier` (organizationId, kind phone|email|ip, normalized `value`, `matchKey`, reason?, createdById, createdAt; `@@unique([organizationId, kind, matchKey])`). Phone `matchKey` = last-10 digits (ON11 normalization); email lowercased/trimmed; IP as-is trimmed. **ON4's `BlockedPhone` is untouched and keeps working** — semantics migrated, data not; a phone BlockedIdentifier additionally merges into the ON4 assessment's `blocked` verdict.
- Staff CRUD: `GET/POST/DELETE organizations/:orgId/orders/blocked-identifiers` and `…/trusted-identifiers` (writes guarded by WRITE_ROLES). Audits carry **kind + masked form only** (phone last-4, email first-char+domain, IP full — see §4), never the raw email/IP in the audit body, mirroring ON4's phoneKey-only precedent.
- Dashboard fraud panel: one “ব্লক তালিকা” with kind tabs (ON4 phone list unchanged, plus blocked email/IP) and a “বিশ্বস্ত তালিকা” for trusted identifiers of all kinds.

### §2 Open-order policy — DELIVERED
- `FraudShieldSetting.openOrderPolicy` (off|warn|block, default **off**) + `openOrderWindowHours` (default 72). Evaluation is phone-keyed over non-practice orders in (pending, on-hold, processing) created inside the window, inside the ONE gate (`CheckoutGuardService.evaluateGate` in the leaf FraudModule — all three checkout modules already import it):
  - **block** → refuse with “আপনার আগের অর্ডারটি এখনো প্রক্রিয়াধীন আছে — সেটি সম্পন্ন হলে আবার চেষ্টা করুন” + one attempt-log row;
  - **warn** → the order is created, then force-held through the assessment pipeline with reason “একই নম্বরে খোলা অর্ডার আছে”.
- Staff surfaces: `OrdersService.createManual` gains the non-blocking warning `open_order_exists` (implemented inline there, NOT in the shared intake warnings — manual orders never block). **POS is exempt.** Store-synced orders are exempt from blocking (they arrive after the fact): under `block` policy they receive the warn-level hold in `assessOrder` instead.

### §3 Per-phone rate rules + trusted bypass — DELIVERED
- `waitingPeriodMinutes` (default 0 = off): a second order from the same phone within N minutes of their last order → generic refusal + attempt log. `maxOrdersPerPhonePerDay` (default 0 = off): the “day” is the **Asia/Dhaka calendar day**; exceeding → generic refusal + attempt log.
- A **trusted phone** bypasses the blocked-identifier check, the open-order policy and both rate rules — but **never CAPTCHA**. In assessment, a trusted phone stamps score 0 / band low with the single reason `{ key: "trusted_phone", label: "বিশ্বস্ত তালিকাভুক্ত নম্বর" }` and skips all other signals (including the ON4 burst signal); trusted orders also skip fraud-rule HOLD actions (tag actions still allowed).

### §4 FraudAttemptLog — DELIVERED
- `FraudAttemptLog` (organizationId, channel shop|single|landing|otp, kind blocked_identifier|open_order_policy|waiting_period|daily_limit|captcha|fraud_rule, identifierSummary, ruleId?, createdAt). **Every GC9 refusal path writes exactly one row** (spec-asserted per path).
- Masking: phone → last-4 summary; email → first char + domain; **IP is stored in full** — a documented choice: IPs are order-adjacent data staff already see on orders, and the IP blocklist is unmanageable from masked values. Raw emails/phones are never stored in the log.
- Staff list endpoint `GET …/orders/fraud-attempts` + a “আটকানো চেষ্টা” section in the fraud panel.
- Failure posture (ON4 precedent): blocklist/table **read errors fail OPEN** — a broken list table must not take checkout down. The explicitly-chosen blocking controls (policy/lists/captcha) block only on a positive decision.

### §5 CAPTCHA (Cloudflare Turnstile) — DELIVERED
- Tenant config on `FraudShieldSetting`: `turnstileSiteKey` (public), `turnstileSecretEncrypted` (**sealed** via the existing `seal()` from `common/platform-config.ts`; the settings GET returns only `turnstileSecretSet`, the secret is never returned), `captchaEnabled` (default false), `captchaOnCheckout` (default true), `captchaOnOtp` (default false).
- When enabled for a surface: the public payload exposes ONLY the site key + enabled flags; the checkout/OTP form renders the Turnstile widget (explicit render, no new dependency) and submits the token; the server verifies against Cloudflare's siteverify endpoint (real HTTP call, 5s timeout). Missing/invalid token → 400 + attempt log (kind captcha).
- **Provider-outage decision (documented in the settings UI copy too): fail CLOSED.** A verification-call error is a failed verification — the checkout is refused — and the attempt is logged distinctly with a ` (provider_error)` marker appended to the identifierSummary. Rationale: the merchant explicitly chose the control. Counter-guard: captcha enabled but site key or secret **missing** = treated as not configured and skipped (a half-configured setting must never hard-fail every checkout); the settings UI warns about both behaviours.
- OTP: the same gate runs inside `ShopAccountService.requestOtp` (channel/surface “otp”) when `captchaOnOtp` is on; the shop account page renders the widget for the OTP form.
- In specs the HTTP layer is mocked — **no live Cloudflare verification has happened** and none is claimed.

### §6 Fraud rule builder (basic) — DELIVERED
- `FraudRule` (organizationId, name, enabled, conditions Json, action hold|tag|block_checkout, tagValue?, createdById) + `FraudRuleHit` (ruleId, orderId nullable, action, at). Conditions are validated server-side against the fixed vocabulary — `minTotalMinor`, `isCod`, `districtIn[]`, `phoneOpenOrdersGte`, `minRiskScore` — unknown keys are rejected; all present conditions must match.
- **Timing split (honest, and stated in the UI copy):** at checkout, rules evaluate synchronously from checkout-local facts (total, COD, district, open-order count). `minRiskScore` is **post-placement only** (it needs the assessed score): a rule whose ONLY checkout-applicable condition is missing — in particular a minRiskScore-only rule — never blocks a checkout. `block_checkout` never applies to store orders; hold/tag fire post-placement through the ingested assessment pipeline. Checkout blocks write a `FraudRuleHit` with `orderId = null` plus the attempt-log row.
- The order timeline gains a `fraud_rule` source kind built from the order's hits. Dashboard: rules section in the fraud panel (list, enable toggle, simple form over the vocabulary, hit counts).

---

## Settings defaults (all new behaviour ships OFF / parity-preserving)

| Setting | Where | Default |
|---|---|---|
| `requireTermsConsent` | StorefrontSetting | false |
| `termsUrl` | StorefrontSetting | null |
| `codMaxOrderMinor` / `codAdvanceRequiredAboveMinor` | BusinessProfile | null (no rule) |
| `codBlockedDistricts` | BusinessProfile | null |
| `openOrderPolicy` / `openOrderWindowHours` | FraudShieldSetting | off / 72 |
| `waitingPeriodMinutes` / `maxOrdersPerPhonePerDay` | FraudShieldSetting | 0 / 0 (off) |
| `captchaEnabled` / `captchaOnCheckout` / `captchaOnOtp` | FraudShieldSetting | false / true / false |
| `turnstileSiteKey` / `turnstileSecretEncrypted` | FraudShieldSetting | null / null (sealed) |
| `Order.codAdvanceRequired` | Order | false |

## Gates (coordinator-run, exit-code checked)

| Gate | Result |
|---|---|
| `prisma validate` | exit 0 |
| API tsc (`tsc --noEmit`) | exit 0 |
| API jest (6 chunks, `--runInBand`) | **348 suites / 3621 tests** (baseline 346/3565 → +2 suites / +56 tests, exactly the two GB3 specs: `gb3-fraud-core` 36 + `gb3-checkout-wiring` 20, both green). One chunk reported 1 failure: the **pre-existing `cx3-debounce` flake** (documented since the CX package, unrelated to GB3) — standalone re-run **18/18 PASS** |
| Web vitest | **356/356** (baseline 343 → +13) |
| Web tsc | exit 0 |
| `pnpm -r build` (incl. Next build) | exit 0 |
| Fresh Postgres 16, full sequence | **167/167 migrations clean, 234 tables**; GB3 tables/columns verified via information_schema |

## Commits (14 + this doc)

`880560c` schema+migration · `7efa113` fraud core · `e3c07d5` checkout-rule applicability fix · `0e97f08` shield settings + assessment + staff endpoints · `ec51d23` fraud-core spec (36) · `d2d96ef` idempotency + client-ip + checkout-trust · `b1d2c28` shop wiring + OTP gate · `908424e` single/landing wiring + COD profile fields · `67396c3` needs_confirmation union + manual warning + timeline source · `95b37df` wiring spec (20) · `02894c3` Turnstile component + idempotency hook + web lib/tests · `16d463d` three checkout UIs · `ae1800c` OTP captcha + fraud panel · `96fa19f` COD profile fields + storefront terms settings.

## HONEST LIMITS

- **IP trust caveat:** client IP = first `x-forwarded-for` entry, else `req.ip`. No trust-proxy is configured in `main.ts`; behind the Dokploy/Traefik edge this is the original address, but XFF is **spoofable if the API is ever exposed directly** — the IP list is a signal, not proof.
- **CAPTCHA trade-off:** provider outage with captcha enabled = checkouts refused (fail closed, merchant's explicit choice; attempt rows carry the `provider_error` marker). Half-configured captcha (missing key/secret) is skipped instead — the settings UI warns about both.
- **Rule-condition timing split:** `minRiskScore` conditions can only fire post-placement; checkout-time rules see total/COD/district/open-order count only. A minRiskScore-only `block_checkout` rule will never block — by design, and the UI copy says so.
- **Idempotency window:** the record is written in the same request flow immediately after placement (not one DB transaction spanning order creation). A process crash between order commit and record write could let one retry duplicate; the realistic races (double-click, retry, concurrent same-key) are covered and spec-pinned. Failed validations deliberately do not burn keys.
- **Phone-order counting** resolves a phone by a bounded customer scan (≤5000 customers, ≤5000 orders) with comparison-time match-key matching — stored phones are never rewritten. Extremely large orgs could exceed the scan bound; no index-backed phone-key column exists on Customer today.
- **Nothing is live-proven:** Turnstile siteverify is exercised only against a mocked HTTP layer in specs; no real Cloudflare call, no deployed checkout, no real order has touched GB3. The migration has NOT run on any real DB.
- The pre-existing `cx3-debounce` flake failed once inside a full chunk run and passes standalone (18/18) — unchanged by this batch.
