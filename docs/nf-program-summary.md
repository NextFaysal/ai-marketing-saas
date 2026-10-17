# NF Program Summary — New Features Frontier (NF1–NF15) Closing Audit

**Program:** New Features Frontier — approved in full by the owner 2026-10-17 01:35 +06 (plan `~/workspace/goals/ai-marketing-saas-platform-build/files/New-Features-Frontier-Plan-2026-10-17.md`)
**Worktree/branch:** `~/workspace/ai-marketing-saas-nf`, `new-frontier` · **Base:** `05b86e0c` (Smart AI line, SA-B2 code-complete, 224 migrations)
**Local commits only — nothing pushed.** This doc closes the program at code-complete level; everything remains local and live-unproven.
**Batch records:** `docs/nf-fb1-acceptance.md` (FB1) · `docs/nf-fb2-acceptance.md` (FB2) · `docs/nf-fb3-acceptance.md` (FB3) · `docs/nf-fb4-acceptance.md` (FB4) · `docs/nf-fb5-acceptance.md` (FB5), each with per-item acceptance docs beside them.

## Program totals (nf line, final)

| Measure | Final state |
|---|---|
| Commits on the nf line (base `05b86e0c` → program close, incl. this doc) | 77+ (76 at FB5 code-complete HEAD `c5a56c4a`, + FB5 acceptance `3f50e031`, + this summary) |
| Migrations on the line | **239** (224 base + 15 NF migrations, claims `20261028000000`–`20261042000000`) |
| Web tests at close | **124 files / 1000 tests PASS** (935 at FB1 → 947 FB2 → 962 FB3 → 975 FB4 → 1000 FB5) |
| Fresh-PG at close | **239/239 applied, 0 unfinished** (FB5 finisher run) |
| Boot smoke at close | **PASS** — `/health` ok, **1,835 routes** RouterExplorer-mapped |
| Verdict tally | **Shipped 8 · Shipped-gated 2 · Partial 5 · Silently dropped 0** |

## Item-by-item audit (NF1–NF15)

| Item | Verdict | Shipped part — and the not-built part, in one line |
|---|---|---|
| **NF1** FB Live Commerce (FB1) | **Partial** | Shipped: live-session data model, cockpit, comments via a Meta provider port on the evidenced polling shape, comment→order exactly-once, recap, follow-up segment. Not built: broadcast creation/start from the hub, reactions/SSE/viewer counts — and any Meta capability without a usable account honestly degrades to labelled manual mode; no Meta call has ever been made (needs the owner's Page + App Review). |
| **NF2** Short Video Studio (FB1) | **Partial** | Shipped: video projects, a local ffmpeg template renderer (product images → verified 1080×1920 mp4), studio UI, publish through the existing Social engine, `video_render_sweep`. Not built: the external AI image-to-video provider — awaits owner decision D3 (provider + per-video cost); v1 video is silent and template-only, never labelled "AI-generated". |
| **NF3** AI Voice Agent upgrade (FB2) | **Partial** | Shipped: a deterministic Bengali/English conversation engine (OrgBrain PUBLIC facts only, actions via existing service paths exactly once, kill-switch + dual-enable safety), runnable **simulation** mode, ConversationRelay TwiML + WebSocket message handler built to the evidenced Twilio shapes, no-answer → labelled manual WhatsApp follow-up task. Not built: any live call, the WS gateway transport, live STT/TTS — all wait on the owner's Twilio account + D2 (provider/cost/BD number). |
| **NF4** Service & Appointment business type (FB2) | **Shipped** | Shipped: services CRUD, staff = existing Membership, weekly availability, slot engine with transactional overlap protection, guest booking → Customer, status machine, SMS reminders via `service_booking_reminder_sweep`, dashboard + public booking pages. Not built: online deposit collection (deposit is a quoted, manually-tracked state — no gateway charge, no PaymentVerification), WhatsApp reminders, per-staff↔per-service mapping, recurring bookings, customer self-service cancel/reschedule. |
| **NF5** Multi-language / multi-currency storefront (FB3) | **Partial** | Shipped: approved-only content translations (AI drafts via LlmFactory, never public until staff-approved; one added locale, hi, mechanism locale-agnostic) on shop home + PDP, and display-only currency with human-entered rates (checkout/orders/payments provably never read the rates). Not built: shop-chrome i18n beyond bn/en, variant-level translations, translations/display prices on cart/checkout/brand/landing surfaces, translation memory/glossary, bulk translate, language auto-detection. |
| **NF6** Gamified promotions (FB3) | **Shipped** | Shipped: spin wheel, quiz and group-buy campaigns on the existing popup placement vocabulary, server-side outcomes only, real StoreDiscount prizes issued exactly-once, Fraud Shield phone gate, dashboard + storefront overlay. Not built: any customer notification for group-buy expiry (staff-visible joiner list only — no honest send path existed), group-buy checkout auto-application or stock hold (join = record, deliberately), animated canvas wheel, dashboard campaign edit (API-only in v1). |
| **NF7** Membership tiers + store credit (FB3) | **Shipped** | Shipped: derived tiers from sold-order lifetime spend, PriceList tier binding through the existing pricing door, a ledger-only store-credit system (balance = Σ entries, exactly-once by sourceRef), refund-to-credit behind a per-store gate DEFAULT OFF, credit spend + reversal in the native shop checkout, shop-account credit view. Not built: credit spend in POS / single-product / landing checkouts, credit expiry/transfer/cash-out, tier-change notifications, tier price-list product-picker UI. |
| **NF8** Review & UGC upgrade (FB3) | **Shipped** | Shipped: photo/video review media via the existing private-bucket storage guards (keys only, EC15 moderation unchanged), the Google review offer (only after submission, only at 4–5★, only when the org configured its link, plain link — **no incentive attached to any rating**), staff social-draft via the Social engine with an exactly-once claim. Not built: video rendering on the PDP (staff moderation only in v1), media attach to the social draft, customer media removal/replacement, media on chat-captured reviews. The pre-existing hardcoded REVIEW10 reward display was left byte-identical — see the owner-gated list. |
| **NF9** Rider live GPS + fleet (FB4) | **Shipped** | Shipped: hashed-token rider share links (rotate/revoke, 30-day expiry), rider share page posting live fixes while open, retention-capped location storage (latest + ≤200 pings/assignment), fleet view, rider location on both customer tracking payloads with an honest 5-minute staleness label. Not built: native app, background tracking (by design — the page says sharing happens only while open), embedded maps/map vendor, route optimisation/ETA/geofencing, automated link delivery to riders (manual copy/paste). |
| **NF10** Full accounting upgrade (FB4) | **Shipped** | Shipped: lazily-seeded chart of accounts, double-entry journal with the balance invariant enforced at one door, idempotent auto-entries (sold-order revenue, approved-payment settlement, expenses, courier charges; COGS only from real ProductCost, gaps counted never invented), monthly P&L + VAT from journal data only, bank/mobile statement import on the EC26 machinery with suggest-only matching. Not built: journal rewrite on expense edit/delete (reversing entries are the correction path), courier charge amendments (first-charge-wins), journal creation from a confirmed statement match, Bengali glyphs inside PDFs (shared WinAnsi toolkit — PDFs carry the English gloss; the verbatim Bengali disclaimer stands on web + JSON). |
| **NF11** HR lite / payroll (FB4) | **Shipped** | Shipped: salary profiles on Membership, self check-in/out in the org timezone + audited admin corrections, shift roster, leave state machine, payroll runs (stored pro-rata rule from APPROVED UNPAID leave only + commission only from recorded `Order.commissionMinor` — the scoreboard's ৳50 read-time fallback was never used), OWNER mark-paid posting exactly one balanced NF10 journal entry, payslips from the stored line. Not built: any money movement (mark-paid is a record — salaries are paid outside the system), salary history/versioning, attendance reports/exports, late/absent derivation, leave balances/accruals, TDS/tax computation, payslip sending. |
| **NF12** Supplier portal + dropship (FB4) | **Shipped-gated** | Shipped: hashed-token supplier portal (own POs only, confirm = existing draft→ordered + stamp, ship = stamp only — no invented status), dropship agreements with pre-acceptance sharing nothing, floor-enforced listings, wholesale-only supplier orders with retail provably absent from the supplier side, exactly-once fulfilment + status mirror + pre-fulfilment cancel propagation, and a records-only commission ledger computed from real order totals. Gated: **payout execution is not built and no wallet is mutated anywhere — payouts remain behind the OU11 legal gate**; also not built: automatic checkout hook (explicit `processSellerOrder` path only), delivery-charge settlement between orgs, dropship orders in the supplier portal. |
| **NF13** Platform fraud network (FB5) | **Shipped-gated** | Shipped: per-org OWNER opt-in with timestamped consent (no pre-consent backfill), HMAC-hash-only contributions of aggregate outcome counters via `fraud_network_sweep` (exactly-once per org+order), a ≥3-org suppression floor on lookup, and a Fraud Shield `networkSignal` sibling that never touches the org's own score. Gated: **the feature is inert until the owner/operator sets `FRAUD_NETWORK_HMAC_KEY`** (no fallback key exists, by design). Not built: unmerge of past aggregates, any signal beyond phone, a public/checkout-time or admin per-phone view, any trigger other than the sweep. |
| **NF14** Branded customer app (FB5) | **Shipped** | Shipped (audit-first): the per-shop installable PWA, install bar and per-org push already existed from AB7/AB8 and were NOT rebuilt; NF14 built the one real gap — app-only offers (`StoreDiscount.appOnly`, a new public offers payload, the ShopOffers strip) — plus cross-shop manifest isolation coverage and honest settings notes. The flag is a display rule only: the code is never blocked at checkout (spec-proven). Not built: native apps/app-store presence, a new push system, service-worker changes, an app-icon upload (none exists — the note says so). |
| **NF15** Agency / reseller console (FB5) | **Partial** | Shipped: a membership-only console at `/dashboard/agency` (per-org numbers exclusively through each org's normal tenant paths, labelled totals with per-org failure isolation), client-org creation delegating exactly to the existing creation path (slug governance + ORG12 cap intact), ORG9 invite link for a new client org, and records-only commission entries (spec-proven ZERO wallet calls). Not built: **ORG14 cross-org team view — owner decision D2 is still open and NF15 deliberately does not substitute for it**; no agency entity/roles/settings, no automatic commission calculation from revenue, no consolidated analytics beyond the labelled sums, no billing/payout. |

## Program-wide NOT BUILT list

- **Live proof of everything.** No NF migration has run on a real database, no Meta/Twilio call has ever been made, no real org has used any NF feature end-to-end. All NF live verification is owed (see owner-gated list).
- **NF1:** Meta broadcast creation from the hub; reactions/SSE/viewer counts.
- **NF2:** external AI video provider (D3); voice-over/sound in rendered videos.
- **NF3:** live telephony, WS gateway transport, live STT/TTS, automatic WhatsApp follow-up.
- **NF4:** online deposit collection for bookings; WhatsApp booking reminders; recurring bookings; self-service cancel/reschedule.
- **NF5:** chrome i18n beyond bn/en; variant translations; translations on cart/checkout and other surfaces; translation memory/bulk.
- **NF6:** group-buy expiry notifications; checkout auto-application of group-buy prizes; animated wheel.
- **NF7:** credit spend outside the native shop checkout; credit expiry/transfer/cash-out.
- **NF8:** PDP video rendering; review media on social drafts; media removal actions.
- **NF9:** background tracking; native rider app; map vendor/route optimisation.
- **NF10:** journal rewrite on expense edit; courier charge amendments; Bengali-font PDF toolkit upgrade.
- **NF11:** salary payout execution; TDS/tax; attendance reporting/exports.
- **NF12:** dropship payout execution (OU11 gate); automatic checkout fulfilment hook; cross-org anything beyond the dropship design.
- **NF13:** aggregate unmerge; non-phone signals; checkout-time network check.
- **NF14:** native apps; app-icon upload.
- **NF15:** ORG14 cross-org team view (D2); automatic commission calculation; consolidated cross-org analytics.
- **Cross-line debt recorded in FB1:** the boot-smoke `@Optional()` fix for `TelegramClient` + `ThreadsClient` (commit `b6dcc457` on this line) is still owed to main / sai / ou / org at their next integration — without it those lines carry the same latent boot failure FB1's smoke caught.
- **Full API jest suite** was never run as a single program gate (the standing gate set = per-item targeted suites + recorded regressions + tsc/build/web/fresh-PG/boot smoke, per batch). The FB1 social-suite intermittent failure (666/666 on re-runs 2–3) remains a known flake with root cause open.

## Owner-gated list (nothing below happens without the owner)

1. **Explicit push instruction for the union release** — the nf line (239 migrations) is local only. Before any union: ls-remote/fetch first, merge the owner's own commits, never force-push; **check the CA line's actual migration folder names against the NF span `20261030000000`–`20261042000000`** (NF owns …28–…42 with distinct names; same timestamp + different name deploys lexicographically, an identical name would collide).
2. **Manual Dokploy Redeploy** after the push — runs all pending migrations on the real DB and activates production ffmpeg (NF2, via Dockerfile commit `443fa01c`).
3. **`FRAUD_NETWORK_HMAC_KEY`** — set in the API environment (deployment secret, never in chat/repo) or NF13 stays inert.
4. **Per-org job enables** (each default OFF): `fraud_network_sweep` (NF13, plus OWNER opt-in per org), `video_render_sweep` (NF2), `service_booking_reminder_sweep` (NF4) — alongside every earlier program's per-org enables still owed.
5. **D2 — voice provider/cost:** live per-minute numbers + BD number availability in the owner's own Twilio console; approve the ConversationRelay path + WS gateway deployment if live voice (NF3) is wanted. Simulation mode works without it.
6. **D3 — paid AI video provider:** provider choice + per-video cost + how the cost lands in merchant plans — blocks only NF2's AI-provider upgrade; the ffmpeg template path works without it.
7. **D4 — service-segment positioning:** NF4 is built; whether service businesses become a marketed target segment is the owner's positioning call.
8. **REVIEW10 decision:** the pre-existing CX12b-era hardcoded `REVIEW10` "reward" display + "পুরস্কার জিতুন" submit label on the public review page (shown irrespective of rating) was flagged by NF8 and left byte-identical — the owner decides remove / change / keep.
9. **ORG D2:** whether ORG14 (cross-org team view) is ever built — NF15 was deliberately membership-only.
10. **ALL live verification, incl. M30:** the NF checklists per batch doc (Meta Page + App Review for NF1, Twilio for NF3, three-org fraud-network check for NF13, real-phone install + app-only redemption for NF14, two-org dropship order for NF12, real payroll month for NF11, real statement import for NF10, rider GPS session for NF9, and the FB3 set) — plus the standing M30/EC12/TD12/S10 and OU4/OU9 checklists from earlier programs, all still unchecked.

## Batch gate progression (each batch's own recorded finisher gates)

| Batch | Targeted | Web vitest | Fresh-PG | Boot smoke |
|---|---|---|---|---|
| FB1 (NF1+NF2) | 16/16 + 12/12 | 112 files / 935 | 226/226 | PASS — caught + fixed 3 real DI bugs (see cross-line debt) |
| FB2 (NF3+NF4) | 35/35 + 24/24 (coordinator re-run 59/59) | 113 files / 947 | 228/228 | PASS |
| FB3 (NF5–NF8) | 73/73 (19+21+16+17) | 116 files / 962 | 232/232 | PASS |
| FB4 (NF9–NF12) | 72/72 (21+18+13+20) | 120 files / 975 | 236/236 | PASS (1,827 routes) |
| FB5 (NF13–NF15) | 37/37 (16+11+10) | 124 files / 1000 | 239/239 | PASS (1,835 routes) |

**Program state at close: NF1–NF15 code-complete on the local `new-frontier` line. 0 items silently dropped — every not-built part is named above and in the batch docs. The release itself (union + push + Redeploy + live verification) remains entirely the owner's, as with every prior program.**
