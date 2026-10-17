# One-Umbrella Program Summary — OU0–OU12 (program close, 2026-10-17)

**Verdict: the One-Umbrella program is CODE-COMPLETE.** Every package was built, recorded as partial with evidence, or recorded as not-built with evidence and an unblock condition. **Nothing in the OU line is live-proven** — the line awaits a union release on the owner's explicit push instruction, then the owner's manual Dokploy Redeploy, then the live-verification sessions listed below.

**Line:** `~/workspace/ai-marketing-saas-ou`, branch `one-umbrella` (base: int8 union `b5d9dfe3`, on top of interim-release content + GitHub main `8f4fd0f3` lineage) · local commits only, NO push at any point in the program.
**Plan:** `~/workspace/goals/ai-marketing-saas-platform-build/files/One-Umbrella-Master-Plan-2026-10-16.md`
**Batch docs:** `one-umbrella-ou1-acceptance.md` (OB1) · `one-umbrella-ob2-acceptance.md` (OB2) · `one-umbrella-ob3-acceptance.md` (OB3) · `one-umbrella-ob4-acceptance.md` (OB4) · `one-umbrella-ob5-acceptance.md` (OB5) · `one-umbrella-ob6-acceptance.md` (OB6) — plus per-item docs (OU3 spike, OU5 Nagad/Stripe evidence, OU6/OU7/OU8 acceptances, OU9/OU11/OU12 sections).

---

## Item-by-item audit table

| Item | Verdict | What stands |
|---|---|---|
| **OU0** Release + live proof | 🟡 PARTIAL — owner-gated | Interim release pushed + verified (GitHub main `5b3d4030`, 2026-10-16). The OU line itself is NOT in any release yet (see release note). Live proof (M30/EC12/TD12/S10) remains entirely owed and is owner-action. |
| **OU1** Org switcher + portfolio | ✅ SHIPPED | Dashboard OrgSwitcher (ACTIVE memberships + role, full-reload switching), in-switcher create-org via POST /organizations, portfolio honesty fixes (per-currency totals, ACTIVE-only, platformConversions surfaced). Also repaired 3 code pieces lost in the int8 union merges. HEAD `b8b9d28c`. |
| **OU2** Custom-domain HTTPS (Cloudflare for SaaS) | ✅ SHIPPED (code) — live owed | Isolated CfS adapter (active only when hostname AND ssl both active; unknown → failed, never fake), SUPER sealed config + verify-before-save, TXT-verify triggers hostname registration (unconfigured → honest `not_configured`), merchant status UI + manual Refresh, domain change resets state. Migration `20261020000000`. Live CfS proof = checklist S10, unchecked, owner-gated. |
| **OU3** Daraz | 🟡 PARTIAL — evidenced layer only | Spike from official sources only: shared Alibaba/Lazada signing + app/OAuth gating evidenced; Daraz BD base URL, payloads, Seller Center CSV columns NOT evidenced anywhere official. Built: adapter in labelled refusing state (vector-tested signing, dev client refuses every op, never calls fetch, config honestly `configured_not_verified`, status forced DISCONNECTED, capabilities all false) + product feed export from the real catalog via EC14 feed items. NOT BUILT: live Daraz client, order CSV import (columns not evidenced, not guessed). |
| **OU4** Google/TikTok Ads management + audience sync | ✅ SHIPPED (specs mocked) — live owed | Live status reads replace the old stub (Google GAQL, TikTok `/campaign/get/`; raw status kept; honest unavailable reasons verbatim); pause/resume with account-access gating on resume and did-not-confirm honesty; Google Customer Match (SHA-256 only, 5k chunks, count stored only when Google returns a plain number); TikTok DMP custom audiences + lookalike (endpoint verified vs TikTok's official SDK). NOT BUILT: Google lookalike (no such API — honest refusal), cross-platform delete (TikTok v1.3 has none), hub budget/targeting edit. |
| **OU5** Payments (Nagad / Refund Center / international rail) | 🟡 PARTIAL | Refund Center ✅ on the SAME PaymentRefund rows (manual marker, provider ref required, completion reuses the existing exactly-once verified-refund application, OWNER/ADMIN floor). Stripe ✅ BOTH tenant own-gateway (paid only via HMAC-verified webhook into markVerifiedPaid; browser return inert; verify-before-save saves nothing on failure) AND platform subscription billing (activates only from the verified webhook; Stripe subscription objects deliberately unused). Nagad ❌ NOT BUILT with evidence (no official API docs evidencable — honest refusal kept). PayPal ❌ NOT BUILT (Orders v2 capture does not fit the initiate + verified-confirmation pattern; no second architecture faked). |
| **OU6** Couriers (Paperfly + framework + balance) | 🟡 PARTIAL | GB5's provider-neutral framework EXTENDED (no second framework); `COURIER_CAPABILITIES` (cancel = false for ALL couriers). Paperfly = labelled DEVELOPMENT adapter only (no contract evidence; no network call, refuses every op, nothing created, web card "Development — লাইভ নয়", connect does not save). Balance: real Steadfast read surfaced; others `not_supported`, `balanceMinor` always null. Live Paperfly client ❌ NOT BUILT. |
| **OU7** Accounting-lite | ✅ SHIPPED | CoA + balanced journal DERIVED from real source records (never a second set of books), trial balance / balance sheet, bank-statement CSV reconciliation with human-confirmed matching, payroll-lite optional-last per plan. Migration `20261023000000`, fresh-PG 218/218 at its batch gate. |
| **OU8** Storefront freedom | ✅ SHIPPED | +2 real preset themes (warm/ocean) + section customizer (no drag-drop builder, per plan), marketing lead popup on the existing lead machinery, customer ticket tracking page on signed-token discipline (internal notes spec-proven hidden). Migration `20261023100000`, fresh-PG 219/219 at its batch gate. |
| **OU9** Google Business Profile | ✅ SHIPPED (code) — live blocked by Google | Social registry platform with documented v1/v4 client shapes; connect + location picker following existing Google OAuth patterns; approval gate `gbpApiAccessApproved` (default false) — publishing refuses FIRST with the plain-words message, spec-proven zero Google calls while unapproved. NOT BUILT: reviews/replies, EVENT/OFFER posts, insights, live proof (Google API-access application is an owner/operator action). |
| **OU10** Messaging channels | 🟡 PARTIAL | Telegram broadcast was DELIVERED by the Messaging Advanced program (MX13, mx line) — collision caught in OB3 Step-0, deliberately NOT rebuilt here. SMS/email keyword campaigns ❌ NOT BUILT with evidence: MX6 keyword engine exists only in the mx tree (not forked), NO inbound SMS webhook exists for any configured gateway (all send-only), NO inbound email reply processing. Recorded as a post-union build once a real inbound path is evidenced. |
| **OU11** Payout automation (legal gate) | ✅ SHIPPED (gated code) — live blocked by legal review | `PayoutLegalGate` (SUPER-recorded confirmation, reference required, audited) + separate automation switch default OFF; service-layer fail-closed enforcement on every execution entry point (DB-read per call); bank-instruction rail completing ONLY through the existing `adminMarkPaid` (four-eyes preserved, exactly-once debit spec-proven); affiliate payouts on the same rail/gate via shared `applyFifoFlip`. Manual mark-paid explicitly NOT gated. Provider disbursement client ❌ NOT BUILT (bKash disbursement unevidenced — checkout-only clients). Migration `20261024030000`, fresh-PG 222/222. |
| **OU12** Subscription auto-charge + backup restore | 🟡 PARTIAL — honest subset only | Step-0 proved: the only integrated tokenized charge (`chargeAutoRenew`) is platform-billing-bound, the shop side has no agreement/charge path, and the backup bundle does not round-trip (no import machinery; credentials never exported; media metadata-only; source-org ids). Shipped: consent capture with literal `chargingActive: false` labelling ("auto-charge ready — চার্জিং এখনো চালু নয়") + backup VERIFICATION (OWNER-only, slug-confirmed, read-only integrity check, `restoreSupported: false` in every outcome). Real auto-charge ❌ and restore ❌ NOT BUILT, each with its unblock condition (restore's natural home is Organization-Next ORG16). |

**Headline counts (13 rows):** ✅ shipped **6** (OU1, OU4, OU7, OU8, plus OU2 + OU9 as shipped-code/live-owed) · ✅ shipped-gated **1** (OU11) · 🟡 partial **6** (OU0, OU3, OU5, OU6, OU10, OU12 — each mixes shipped parts with evidence-backed not-built parts) · **0 silently dropped** — every not-built part is named above with its evidence.

**Plan §6 exclusions honoured throughout:** multi-vendor marketplace, Rocket gateway, SEO suite, Messenger broadcast — none built, none claimed.

---

## Gate rollup (per batch, as recorded; heavy gates serial)

| Batch | Headline gates |
|---|---|
| OB1 (OU1) | Web 110 files/899 · web tsc 0 · build green · API touched 7/7 + tsc 0 |
| OB2 (OU2+OU6) | Fresh-PG 217/217 · web 110/900 · API tsc 0 · courier 15 suites/158 · OU2 specs 27/27; sole failure adx3-nav-counts (base-proven) |
| OB3 (OU4) | API touched 19 suites/155 (42 new) · API+web tsc 0 · web 110/900 · build green (no migration) |
| OB4 (OU5+OU3) | Spot-check 7 suites 76/76 · connections 377/378 (cc26 only) · payments+admin+orgs 393/396 (gb9 + adx3 base-proven) · web 110/901 + build · admin 9/9 + build; two OOM-killed attempts passed solo (recorded) |
| OB5 (OU7+OU8) | OU7 fresh-PG 218/218 · OU8 fresh-PG 219/219 · coordinator spot-check 5 suites 53/53 · web 905/905 (OU8) |
| OB6 (OU12+OU9+OU11) | OU12 fresh-PG 221/221 · OU9 social 697/697, web 905/905, admin build green · OU11 fresh-PG **222/222**, connections 389/390, affiliates 35/35, admin 244/245 · coordinator spot-check 3 suites 51/51 |

**Known pre-existing failures (base-proven, never introduced by OU):** `cc26` (incl. its date-dependent sweep fake pinned to 2026-10-15), `adx3-nav-counts`, `gb9-public-docs`. Migration union in this tree: **222 migrations**, final fresh-PG run 222/222 clean (OU11 gate).

---

## Everything still owed (one list — all live, all owner-gated)

1. **Release:** the OU line is in NO release. It needs a union release on top of the then-current GitHub main on the owner's explicit push instruction (the standing rule: ls-remote + fetch first, merge the owner's own commits, never force-push), full union gates incl. fresh-PG, then the owner's manual Dokploy Redeploy.
2. **Live verification sessions (all checklists exist, all unchecked):** M30 (accounts/providers), EC12 (real stores), TD12 + OU2's S10 (Cloudflare for SaaS spare-domain journey), Stripe test-mode sandbox (incl. BDT chargability), OU4's 8-item ads checklist, OU9's Google API-access approval + first real GBP post, Daraz app approval (if pursued), Paperfly partner access + official docs (owner-side collection).
3. **Owner decisions/actions:** wallet legal review (OU11's gate records it — the review itself is the owner's, with a real reviewer) before enabling payout automation; per-org job enables at deploy; Connect Center platform gateway creds / wallet feeBps / IPN URLs (standing); INTERNAL_JOB_SECRET confirmation (standing).
4. **Post-union builds recorded, not lost:** OU10 remainder (SMS/email keywords) once the mx keyword engine is unioned and a real inbound SMS/email path is evidenced; OU12 restore via a future id-remapping import engine (ORG16's home); OU12 real auto-charge if a tenant-side bKash agreement lifecycle is ever built + sandbox-verified.

## Release note
The OU line (branch `one-umbrella`, this worktree) is complete and awaits a union release on the owner's explicit push instruction. No part of it has been pushed, deployed, or live-proven.
