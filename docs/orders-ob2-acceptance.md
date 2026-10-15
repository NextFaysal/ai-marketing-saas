# Orders Next — Batch OB2 Acceptance (ON4 Fraud Shield v2 + ON11 Intake Quality)

Date: 2026-10-14 · Branch `orders-next` (base: OB1 final `41ac4c7`) · **Local commits only — NOT pushed, NOT deployed.**

Commits (oldest → newest): `e57786c` ON4 schema · `ff1bba0` ON4+ON11 pure + services · `518417a` ON4 web lib · `d32b511` ON4+ON11 wiring · `6dc81b4` ON4 web · `cfa435f` ON11 web · `1cf6410` ON4+ON11 specs · this doc.

## Migrations (Orders Next range 20261013700000+)

| Migration | Contents |
|---|---|
| `20261013730000_on4_fraud_shield` | `Order` += `riskScore Int?`, `riskBand String?`, `riskReasons Json?`, `riskAssessedAt`, `reviewHold Boolean default false`, `reviewHoldReason`, `reviewHeldAt`, `codCallAttempts Int default 0`, `codLastCallAt`, `codLastCallOutcome` + indexes `(organizationId, riskBand)`, `(organizationId, reviewHold)` · new tables `FraudShieldSetting` (unique org), `BlockedPhone` (unique org+phoneKey) |

**The `20261013740000_on11` slot was deliberately NOT used:** ON11 needed no schema change — the confirmed district persists into the existing `Customer.address` Json (`{ address_1, district }`), exactly where the native checkout already stores it and where the list-v2 district filter already reads it. Total migration count is therefore **158** (157 + 1), not 159.

**Deploy notes:** the migration has NOT been run on any real database. **Fresh-DB verification could not be re-run in this sandbox — no Postgres is installed here (no binaries, no service, no docker), so the OB1-style throwaway-cluster sequence was unavailable.** In its place a static cross-check was run over all 158 migration files: no duplicate `CREATE TABLE`, no duplicate (table, column) `ADD COLUMN` anywhere in the sequence; the ON4 migration's 10 columns / 2 tables / 5 indexes match the Prisma schema objects one-for-one; `prisma validate` passes. The full fresh-DB sequence (expect 158/158) remains owed at integration/deploy time and is stated here as NOT done, not implied.

## ON4 — Fraud Shield v2, delivered

### Scoring (`apps/api/src/orders/fraud-score.ts`, pure; weights are documented constants)

| Signal key | Points | Fires when |
|---|---|---|
| `blocked_phone` | forces score 100 / band high | phone is on the org `BlockedPhone` list |
| `duplicate_burst` | +30 | same phone key placed ≥ `burstCount` (default 3) OTHER orders in the org within `burstWindowHours` (default 24h); the assessed order is excluded from its own count |
| `history_band` | +35 (high) / +15 (medium) | the EXISTING M50 `RiskService.forOrder` band for this phone's history — its math is reused untouched; the reason carries the M50 score |
| `history_outcomes` | +20 | customer's cancelled+returned count ≥ 2 (ON2 customer-360 definitions) OR reliability < 50% with ≥ 3 decided orders |
| `high_value_new_customer` | +20 | customer has ≤ 1 prior non-practice order AND `totalMinor` ≥ `highValueMinor` (default 500000 = ৳5,000) |
| `phone_name_mismatch` | +15 | the same phone key was previously used under a materially different customer name (normalized comparison: case/space/honorific-insensitive; different = neither name contains the other and first tokens differ) |

Score = min(100, Σ points). Bands: **low < 40 · medium 40–69 · high ≥ 70**. Every assessment returns `{ score, band, reasons: [{key, label, points}] }` with Bengali labels carrying the actual numbers; zero signals → score 0 / low with the single reason "কোনো ঝুঁকির সংকেত পাওয়া যায়নি". There is no unexplained score anywhere: the stamps, the reassess response and the web panel all show the same reasons array.

### Persistence + hook coverage
Assessment stamps `riskScore/riskBand/riskReasons/riskAssessedAt` on the Order. It runs off a new **`order.ingested`** event, emitted unconditionally on create by the two choke points that create every order: `IntegrationsService.upsertOrder` (covers Woo webhook/sync, Shopify webhook/sync, CSV import, staff manual, POS, subscription renewals, and all three native checkouts) and `InboxService.createChatOrder` (chat orders; practice orders emit nothing and are never assessed). `FraudShieldService` subscribes in its constructor (the ConversionsService pattern); assessment is fully failure-isolated — a fraud failure can never break order creation. `POST orders/:id/reassess` recomputes on staff demand (audited). List v2 gained a `riskBand` filter (real column, base-where) + the `riskBand` saved-view key; list rows and order detail carry the persisted fraud fields alongside the separate M50 advisory `risk` object (the two are distinct and labelled distinctly in the UI).

### Settings (`FraudShieldSetting`, one row per org, lazy-created)
Defaults: `enabled=true` (scoring), `autoHoldEnabled=false`, `autoHoldBand="high"`, `highValueMinor=500000`, `burstCount=3`, `burstWindowHours=24`. `GET/PUT orders/fraud-settings` (staff write roles; audit carries changed keys only). While `enabled=false`, assessment stamps nothing.

### Review hold
`hold`/`release` staff endpoints (audited; the hold reason itself is never written to audit metadata). Auto-hold only when `autoHoldEnabled` and the band reaches `autoHoldBand`, with reason `স্বয়ংক্রিয়: <top reason>`; a blocked phone ALWAYS force-holds (reason "ব্লকলিস্টে থাকা ফোন নম্বর থেকে অর্ডার"). Assessment never clears an existing hold. Effects, all spec-proven: (a) the ON1 `ready_to_pack` resolver now excludes held orders (count==list invariant intact — the OB1 spec's key-list assertion was updated for the two new queues, nothing else in it changed); (b) `CourierService.bookShipment` refuses a held order with a Bengali error naming the reason, unless the caller passes `overrideReviewHold: true` — the override writes audit `courier.booking_review_hold_override` before booking (the OB1 bulk book path does not pass it, so bulk booking fails held orders per-order with that message, honestly reported); (c) new queue **`review_hold`** = `reviewHold=true` AND status ∉ {completed, delivered, cancelled, refunded, failed, returned}, wired through the same resolver/count path and visible in the web rail automatically.

### Blocklist (`BlockedPhone` + leaf `FraudModule`/`BlockedPhoneService`)
Phone stored canonicalized by ON11's normalizer (+ `phoneKey` last-10 for format-tolerant matching). Staff CRUD under the orders permission area (audits carry the phoneKey only, never the reason). Enforcement: (a) the three NATIVE checkouts (storefront, single-product, landing) refuse a blocked phone BEFORE any order write with the generic customer message "দুঃখিত, এই মুহূর্তে অর্ডারটি নেওয়া যাচ্ছে না" — the blocklist is never revealed; (b) external-store orders via `upsertOrder` are never dropped — they are created, assessed, and force-held by the blocked signal; (c) staff manual/chat creation warns (`phone_blocked` warning) and proceeds — the standard assessment then force-holds the order.

### COD call worklist
`POST orders/:id/cod-call { outcome }`, outcome ∈ `confirmed | rejected | unreachable | callback_requested`. One order update: `codCallAttempts` +1, `codLastCallAt`, `codLastCallOutcome`. `confirmed` ALSO sets `codConfirmationStatus="confirmed"` and emits `order.cod_confirmed`; `rejected` sets `codConfirmationStatus="declined"` — the EXISTING verdict vocabulary (`parseCodReply` produces confirmed/declined), so there is exactly one confirmation state and the inbox chat flow and the staff call flow write the same field through the same values. `unreachable`/`callback_requested` leave the status untouched. The inbox endpoints (`requestCodConfirmation`, chat-reply handling) are unchanged. Web: outcome chip row ("কল করেছি: নিশ্চিত / প্রত্যাখ্যান / পাইনি / পরে কল করবে") on `needs_confirmation` queue rows and in the detail for awaiting COD orders, with attempt count + last outcome shown.

## ON11 — Intake Quality, delivered

### Phone (`apps/api/src/orders/phone-utils.ts`)
`normalizeBdPhone`: `01XXXXXXXXX` / `8801XXXXXXXXX` / `+8801XXXXXXXXX` / `1XXXXXXXXX` → canonical `+8801XXXXXXXXX`; Bengali digits are converted; the subscriber part must match `1[3-9]XXXXXXXX`; anything else → null. `bdPhoneMatchKey`: last-10-digits comparison key. Existing stored phones are NEVER rewritten — normalization happens at comparison time only (blocklist, burst, mismatch, warnings). Note: `messaging/sms.provider.ts` keeps its own gateway-form normalizer (880… without `+`) — a different consumer with a different canonical target, left untouched deliberately.

### Address parser (`apps/api/src/orders/bd-address.ts` + `bd-address-data.ts`)
`parseBdAddress(text)` → `{ district, thana, confidence, matchedTerms }`. Reference data: **all 64 districts** (canonical English + Bengali + common spelling variants — Chattogram/Chittagong, Cumilla/Comilla, Jashore/Jessore, Bogura/Bogra…) and **132 curated thana/upazila entries** mapped to their districts (full Dhaka metro coverage + every district's Sadar/Kotwali + the major urban thanas). Rules: an explicit "জেলা"/"district"/"zila" marker next to a district term makes it explicit; a matched thana pins its district (an explicit district beats a stray thana of another district, which is dropped but listed); confidence high = explicit marker, or district + same-district thana both matched; medium = district plainly matched, or thana-only inference; low = nothing matched, or two different districts with no tiebreak (district = null). Short English terms (≤4 chars) require word boundaries. It is a suggestion engine — nothing is ever written from it without staff confirmation.

### Where it applies
`POST orders/parse-address` (staff utility). `createManual` accepts an optional `district` in the DTO and persists it into the customer address Json ONLY when staff sends it (i.e. confirmed); both `createManual` and `createChatOrder` responses gain `warnings[]` + `addressSuggestion` (suggestion only when confidence ≥ medium and the order has no structured district). Warnings (never blocking — specs assert the order is still created): `invalid_phone`, `phone_blocked`, `duplicate_customer_phone` (same phone key, materially different name), `missing_address_parts` (no district and the parser found none). Web manual form: parse-on-blur → suggestion chip ("জেলা: খুলনা? নিশ্চিত করুন") → one click confirms into a removable chip → the confirmed district rides the submit body; response warnings render as an amber list before any navigation.

### Incomplete-intake queue
New queue **`incomplete_intake`** through the same resolver/count path: non-terminal (same open set as `review_hold`), non-practice orders where phone is missing (no customer phone) OR address text is missing (no `Order.address` and no customer address text) OR district is missing (no `Customer.address.district` AND `parseBdAddress` finds no district in the address text). Rows link to the order where staff fix the data; the CX7 chase flow is untouched.

## Web (apps/web)
lib `orders-on1.ts` gains the `riskBand` filter end-to-end (params + saved-view round-trip, tested); new `orders-on4.ts` (fraud band labels, COD-call outcome labels). Orders page: fraud band chip (table + mobile card, distinct from the M50 chip) opening a fraud detail panel with score, reasons-with-points, reassess, hold/release; rose hold banner + release in the detail, "আটকানো" row badge; riskBand filter select; COD call chips; a "জালিয়াতি সুরক্ষা" modal with the settings form (high-value threshold entered in taka, converted via the existing helpers) and full blocklist management. Manual form: the parse-suggestion flow + warnings display above.

## Gates — coordinator's own final run (exit-code verified, no piped output)

| Gate | Result | Baseline |
|---|---|---|
| API jest (5 chunks, `--runInBand`) | **329 suites / 3339 tests PASS**, every chunk exit 0, zero FAIL lines (611+628+684+746+670) | 327 / 3282 (+2 suites / +57 tests = on4-fraud + on11-intake specs) |
| API `tsc --noEmit` | exit 0 | — |
| Web vitest | **273/273 PASS**, exit 0 | 267 (+6 lib tests) |
| Web `tsc --noEmit` | exit 0 | — |
| Full build `pnpm -r build` | exit 0 (7/7 packages incl. next build web + admin) | — |
| `prisma validate` | exit 0 | — |
| Fresh-DB migration sequence | **NOT RUN — no Postgres exists in this sandbox** (checked: no binaries/service/docker). Static cross-check instead: 158 migrations, no duplicate CREATE TABLE / (table, column) ADD; ON4 objects match schema 1:1 | 157/157 at OB1 |

No flakes appeared in the coordinator's run (the known cx3-debounce flake did not trigger). Both builders' independent runs agreed with these numbers.

## Honest limits

- **Assessment is event-driven and therefore eventually consistent.** The `order.ingested` handler runs fire-and-forget after creation; a just-created order can briefly show no fraud band (null = "not assessed yet", never displayed as "low"), and a courier booking made inside that window would not yet see a force-hold. The booking guard reads the stamped `reviewHold` at booking time — it does not re-assess synchronously.
- **Burst population is customer-phone based.** The burst/mismatch population is orders whose CUSTOMER phone matches the key (bounded load, 5000 newest, same bound as M50). A phone that appears only as a shipment recipient or chat contact phone on other orders is resolved for the TARGET order (mirroring M50) but does not add those orders to the population.
- **Thana coverage is curated, not exhaustive:** 132 entries — all 64 district Sadars + major urban thanas. A thana outside the list simply yields no thana match (district may still match); the parser never guesses beyond its data, and low confidence returns district null.
- **Name-mismatch is a heuristic** (normalized containment/first-token comparison). Honorific and spelling variants beyond the normalization rules can produce false positives/negatives; it contributes only 15 points and its reason names the stored name so staff can judge.
- **Blocklist reads fail open.** If the BlockedPhone table read errors, `isBlocked` returns false (checkout availability wins, consistent with the codebase's failure-isolation discipline) — the post-create assessment applies the same read, so a transient outage delays rather than silently drops enforcement only while the table is unreachable.
- **Bad-outcome counts include the assessed order itself** when it is already in a cancelled/returned state at reassess time (they are the customer's current totals from the customer-360 definitions); at creation time the order is never in such a state.
- **COD call recording** writes the shared confirmation field + audit, but creates no conversation note (a phone call has no conversation); the inbox chat-reply path keeps its own note behaviour.
- **No live proof:** nothing in OB2 has run against a real database, real checkout traffic, or a real courier provider. Verification is fixture/spec-level plus the static migration cross-check; the fresh-DB sequence and M30-style live verification remain owed, as do the owner's Dokploy redeploy and running this migration on the real DB.
