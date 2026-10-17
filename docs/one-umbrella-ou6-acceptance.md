# OU6 Acceptance — Courier Completion: Generic Adapter Framework + Paperfly + Balance Visibility (One-Umbrella OB2, item 2)

- **Package:** OU6 from the OU0–OU12 One-Umbrella package (OB2 batch, item 2; OU2 Cloudflare-for-SaaS was item 1 of the same batch).
- **Worktree:** `~/workspace/ai-marketing-saas-ou`, branch `one-umbrella`
- **Base:** `fa436c2b` (OU2 complete)
- **Commits:** 44633566 (framework capabilities + Paperfly dev adapter), 9e6d2394 (Paperfly config surface), fd4f0c05 (balance visibility), + this docs commit.
- **Push:** NONE — local commits only (owner-only push trigger).
- **Migrations:** NONE added (no schema change was needed).

## Step-0 findings (code-verified before building)

### Courier layer map
- All courier code lives in `apps/api/src/courier/`. Concrete clients: `steadfast.client.ts` (base `https://portal.packzy.com/api/v1`, Api-Key/Secret-Key headers), `pathao.client.ts` (`PATHAO_PROD_BASE https://api-hermes.pathao.com`, OAuth password grant with token persistence), `redx.client.ts` (`https://openapi.redx.com.bd/v1.0.0-beta`, access token), `ecourier.client.ts` (`https://backoffice.ecourier.com.bd/api`, API-KEY/API-SECRET/USER-ID headers, all-POST documented contract).
- **A provider-neutral framework already existed (GB5/GC13)** in `courier-client.ts`: `COURIER_PROVIDERS` registry, `createCourierClient()` (the one construction site), `courierAdapter()` wrapping each concrete client into `CourierClient { book(), statusOf() }`. OU6 EXTENDS this framework; it does not build a second one.
- Registration/config per org = the Connect Center pattern: one `Integration` row per (org, provider, credential-fingerprint account key — CC29 multi-account), credentials sealed with `encryptJson` in `IntegrationCredential`, resolved via `pickPrimaryCourierAccount`. Connect is **verify-before-save** against each provider's real API (Steadfast balance, Pathao token+stores, RedX areas, eCourier packages).
- Flows on top: booking (`bookShipment`/`bookBulk`, CC29 account resolution, EC22 rule auto-selection), platform-generated label/invoice PDFs (`pdf.ts` — labels are NOT provider-generated), status sync + GC14 event log, manual status, NDR hub (`courier-ndr.service.ts`), COD disbursement reconciliation (`courier-reconciliation.service.ts`, documented for Steadfast/Pathao/RedX uploads), quote (Pathao price plan / RedX calculator; Steadfast + eCourier honestly `quotable:false`).
- Existing Steadfast balance read: `SteadfastClient.getBalance()` → `GET /get_balance` → `{ current_balance }`, used ONLY inside connect's verify-before-save before OU6 — no endpoint or UI ever surfaced a stored account's balance.

### Paperfly evidence verdict — NO API CONTRACT IN-REPO (development adapter is the only honest build)
Repo-wide search (code + docs + plans) found Paperfly ONLY in:
- `docs/gb5-courier-research.md` + `docs/completion-gb5-acceptance.md` (§Paperfly NO-BUILD): no developer documentation exists on any Paperfly-owned domain; Paperfly's own material frames API access as a per-enterprise partner arrangement ("Paperfly Go" is a token-gated partner API); the staging host public material names answers 401 behind a Cloudflare wall and publishes **no auth model, endpoints or payload shapes**.
- `courier-client.ts` / `gb5-courier.spec.ts` / `courier-connect-panel.tsx` comments recording that NO-BUILD verdict; summary docs listing Paperfly as NOT BUILT.
- There is NO Paperfly base URL, endpoint, header, or payload shape anywhere in the repo. Building a "real client" would fabricate an integration → forbidden by the product rules. OU6 therefore ships Paperfly as a **clearly labelled DEVELOPMENT adapter** (below).

### Balance-support evidence per courier
| Courier | Balance read in-repo? | Evidence |
|---|---|---|
| Steadfast | **YES** | `SteadfastClient.getBalance()` → `GET /get_balance` → `{ status: 200, current_balance }` (steadfast.client.ts) |
| Pathao | NO | Client surface is verify/stores/cities/zones/areas/createOrder/pricePlan/orderStatus — no balance call anywhere |
| RedX | NO | Client surface is verify/areas/pickupStores/createParcel/calculateCharge/parcelStatus — no balance call anywhere |
| eCourier | NO | Client surface is packages/verify/cities/thanas/placeOrder/track — the documented Payment Status call (§2.18) reports per-parcel COD collection, not an account balance; no balance method exists in the client |
| Paperfly | NO | No API contract exists in-repo at all (above) |

## Shipped — item-by-item audit vs scope

### Item 1 — Generic courier adapter framework ✅ EXTENDED (existing GB5 framework), all 4 existing couriers expressed through it
- `COURIER_CAPABILITIES: Record<CourierProviderKey, CourierCapabilities>` in `courier-client.ts` — the ONE descriptor new couriers plug into: `book / label / track / cancel / balance / codReconcile / quote / live`, every value evidenced by in-repo code (e.g. `cancel:false` everywhere — no in-repo client implements a provider cancel call; `codReconcile` matches the reconciliation service's documented Steadfast/Pathao/RedX set).
- Every adapter now carries `readonly capabilities`; `CourierClient` gains OPTIONAL `balance()` — implemented ONLY by the Steadfast adapter (delegates to the existing `getBalance()`, parses `current_balance` major→minor, and a non-numeric response is an error, never a fabricated 0).
- **No behavior change for existing couriers:** `book()`/`statusOf()` bodies were not touched for any of the 4 providers; the only adapter changes are the added `capabilities` field (+ Steadfast's new `balance()`). Existing courier specs run before/after (gate section below).
- NOT MIGRATED list: **none for the adapter contract** — all 4 existing couriers were already expressed through `courierAdapter()` since GB5 and remain so. What intentionally stays OFF the neutral contract (unchanged from GB5, by design): provider-specific extras reached via `createCourierClient` concrete classes — Pathao store/city/zone/area pickers + price plan, RedX areas/pickup stores + charge calculator, eCourier city/thana/package lists, and each provider's verify-before-save call in `CourierService.connect`.

### Item 2 — Paperfly on the framework ✅ DEVELOPMENT ADAPTER (live client NOT BUILT — no contract evidenced)
- `apps/api/src/courier/paperfly.client.ts`: `PaperflyDevAdapterClient` — name, header comment and `developmentAdapter/live` markers all label it; it performs **no network call ever** (constructor accepts a fetch only for shape parity and never invokes it — spec-proven) and EVERY operation (verify/createOrder/status/balance) throws `PaperflyDevAdapterError` with the not-live reason.
- Registered in `COURIER_PROVIDERS` + both factories; `PaperflyCourierAdapter` surfaces booking/tracking attempts as `BadRequest` with the dev message, so a booking attempt is honestly labelled non-live in the API response and **no shipment row is ever created** (spec-proven at service level too).
- Config surface follows the existing per-org pattern: web form fields (`PaperflyForm`, `buildCourierConnectBody("paperfly", …)`) in the Connect Center courier panel, card titled "Paperfly (Development — লাইভ নয়)" with an up-front amber warning. `CourierService.connect(paperfly)` **refuses and saves nothing** — verify-before-save is impossible without a contract, and nothing may be stored as "connected".
- `quote(paperfly)` returns the honest `quotable:false` + dev reason; `getConnection` carries `capabilities/live/developmentAdapter` for every provider so settings surfaces label Paperfly correctly.

### Item 3 — Balance / billing visibility ✅ SHIPPED
- `CourierService.getBalance(orgId, provider)` + `getBalances(orgId)`; routes `GET organizations/:organizationId/courier/balance?provider=` and `GET …/courier/balances`.
- Honest states only: `ok` (real Steadfast read, `balanceMinor` + BDT + `fetchedAt`), `not_supported` (Pathao/RedX/eCourier/Paperfly — `balanceMinor` stays **null**, no invented figure), `not_configured` (no CONNECTED account), `error` (provider's own message carried, figure null). One provider's failure never fails the list.
- Web: the courier settings panel renders the balance line on every provider card — real ৳ figure + Refresh for `ok`, the no-API note for `not_supported`, connect-first note for `not_configured`, provider message for `error`. The Steadfast card's stale "no balance endpoint" copy was corrected.

## NOT BUILT / NOT MIGRATED (honest list)
- **Paperfly live client — NOT BUILT** (no API contract evidenced in-repo; partner-gated). Live proof entirely owed: partner API access + documentation from Paperfly, then a real client replacing the dev adapter.
- **Provider-side cancel — NOT BUILT for any courier** (no cancel call exists in any in-repo client; capability honestly `false` everywhere).
- **Balance for Pathao/RedX/eCourier — NOT BUILT** (no balance read evidenced in their in-repo clients/APIs; the surface reports `not_supported` rather than estimating).
- Paperfly accounts can never be saved/connected, booked, synced, quoted or reconciled in this build — by design, each path refuses or reports its honest state.
- No migration; no change to booking payloads, status mappings, charges, or any existing provider flow.

## Gates (run serially, solo, after all three build commits)
- API jest, full `src/courier` folder: **15 suites / 158 tests PASS** (includes gb5 with the OU6-updated registry block, cc29, ec22, courier, ndr, reconciliation, optimizer, performance, rules, cx6, m52, m53, m59, phase-21, ou6).
- API jest, `src/orders/cx1-courier-record.spec.ts` (courier-adjacent): **6/6 PASS**.
- OU6 spec progression: 15/15 after item 2, **20/20** after item 3.
- API tsc (`tsc --noEmit`): **0 errors**.
- Web vitest (full): **110 files / 900 tests PASS** (899 at OU1 + 1 new Paperfly connect-body test).
- Web tsc: **0 errors**. Web build (`pnpm --filter web build`): **green**.
- Baseline note: a pre-change full-courier baseline run was attempted first and **aborted under machine load (never recorded)**; it is not needed for attribution because every pre-existing courier suite passes against the new code and no failure exists anywhere. The only modified pre-existing spec is gb5's registry block (the intentional OU6 registry change, updated in the same commit as the framework change).
- Migrations: none added → no fresh-PG run required. Push: none.

## Proposed live-verification checklist (owner, post-deploy — OU6 lines)
- [ ] Steadfast: একটি আসল Steadfast অ্যাকাউন্ট যুক্ত থাকা অবস্থায় Courier settings কার্ডে আসল ব্যালেন্স (৳) দেখা যায় এবং Refresh চাপলে Steadfast API থেকে নতুন করে পড়ে; Portal-এর ব্যালেন্সের সাথে মিলিয়ে দেখা।
- [ ] Pathao/RedX/eCourier: যুক্ত অ্যাকাউন্টের কার্ডে "ব্যালেন্স দেখার API দেয় না" নোট দেখা যায় — কোনো সংখ্যা নয়।
- [ ] Paperfly: কার্ডে "Development — লাইভ নয়" badge ও সতর্কতা দেখা যায়; যুক্ত করার চেষ্টা করলে সার্ভারের সৎ অস্বীকৃতি আসে এবং কোনো অ্যাকাউন্ট তৈরি হয় না; অর্ডার থেকে Paperfly বুকিংয়ের চেষ্টা করলে not-live বার্তা আসে, কোনো shipment তৈরি হয় না।
- [ ] Paperfly live proof (আলাদা, দীর্ঘমেয়াদি): Paperfly partner API access + official documentation সংগ্রহ → dev adapter আসল client দিয়ে বদল → sandbox/আসল অ্যাকাউন্টে বুকিং + ট্র্যাকিং + (থাকলে) ব্যালেন্স যাচাই।
