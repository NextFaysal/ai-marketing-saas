# E-Commerce Advanced Program (AX1–AX27) — Program Summary

**Plan:** `Ecommerce-Advanced-Plan-2026-10-15.md`
(approved in full by the owner 2026-10-15 22:29 +06, including the
two previously owner-gated items: loyalty points + gift cards as
money instruments, and multi-warehouse stock as an architecture
change). **Worktree:** `~/workspace/ai-marketing-saas-gc`, branch
`completion` — batches AB1–AB8 on top of the Completion Program
line (GB9 HEAD `7bd706d`). **Local commits only — NO push ever
made** (owner's standing rule; a release needs union integration
+ his explicit push instruction + his Dokploy Redeploy).
**Migrations:** 8 Advanced migrations in the claimed range
`20261017000000+`; this tree reaches **181 migrations** total.

Per-batch evidence lives in `docs/advanced-ab1-acceptance.md` …
`docs/advanced-ab8-acceptance.md` (AB3 design note:
`docs/advanced-ab3-design.md`). Final program gate (AB8 close,
coordinator-run): **API 401 suites / 4,523 tests, web 69 files /
570 tests, both tsc, full build 7/7, fresh-DB 181/181 — all
green.** Every item below is **spec/fixture/fresh-DB proven
only** — no Advanced feature is live-proven (M30 debt stands,
see Honest limits).

## Item-by-item audit (audited line by line against the plan)

| Item | Batch | Verdict | Key files | Notes |
|---|---|---|---|---|
| AX1 Loyalty points | AB1 | ✅ BUILT | `apps/api/src/commerce/loyalty.service.ts`, `orders/order-loyalty-reconciler.ts`, `commerce/loyalty-settings.ts`; migration `20261017000000` | Ledger is the single source of truth (FIFO lots, partial unique indexes, one `postEntry` choke point); earn basis = total − shipping − giftWrap (never tax); redemption is an evaluator line (promotions → coupon → referral → LOYALTY → tax) and clamps over-requests; refund clawback proportional, balances may go negative (debt, never silent zeroing); reconciler drives earn/rewards/reversals idempotently (event bus + direct upsertOrder hook). Silent-failure fix found in build: the earn path called `upsertOrder` recursively while claimed → moved to a dedicated idempotent path |
| AX2 Referral rewards | AB1 | ✅ BUILT | `commerce/loyalty.service.ts` (reward entries), `commerce/loyalty-reconciler` (referral arm), `promotions/promotion-evaluator.ts` | REQUIRED adding `Order.referrerCustomerId` stamping — it was never persisted before AB1; reward points land at `delivered`, reverse if the order leaves it pre-delivery; referral stays a percent discount line (evaluator `REFERRAL`) |
| AX3 Gift cards | AB2 | ✅ BUILT | `apps/api/src/commerce/gift-cards.service.ts`, `gift-card-settings.ts`; `20261017010000` | Mint ONLY at placement→paid transition (COD placement mints nothing) via the same reconciler; codes exist only as SHA-256 hash + AES-256-GCM sealed — full code visible solely through the buyer's own reveal surface and the recipient send; staff see last-4 (spec-asserted); redemption is the evaluator line **after** loyalty; gift-card products can't be bought with a gift card; refund voids only REMAINING balances — already-spent value explicitly NOT recovered; expiry sweep books breakage; liability report from records |
| AX4 Multi-warehouse stock | AB3 | ✅ BUILT | `apps/api/src/inventory/inventory-allocation.ts`, `warehouse/` (transfers), `commerce` stock services/hooks; `20261017020000` | Design note committed BEFORE code. Location truth = `StockBalance` per bin; org-global counters maintained in the same (newly wrapped) transactions; invariant Σ balances == global spec-asserted after every operation type (incl. in-transit + variance states); allocation = district-match → warehouse priority → default, assignment bins first then fullest-first; deduction timing proven UNIFORM (placement, one upsertOrder hook) so every path allocates identically; backfill proven 3 ways incl. a populated fixture DB. **Known limit:** transfer dispatch is pre-checked + sequentially compensated (not one multi-line transaction — a mid-dispatch crash leaves a compensated, audited partial state); per-terminal POS bin config deferred |
| AX5a Deposit payments | AB4 | ✅ BUILT | `apps/api/src/connections/` (deposit payments), `storefront` (public state), onboarding web; `20261017030000` | **Real latent bug found + FIXED:** a verified_paid gateway transaction never created a PaymentVerification, so canonical due math ignored online payments — fix writes exactly one approved PV per verified DEPOSIT (claim-idempotent, source `gateway_deposit`), zero reader changes; public state gained `deposit_paid`; webhook `order.paid` context carries purpose/fullySettled; full-vs-partial settlement touchpoints found + scoped (isCod/paymentMethod flip only on full settlement). Honesty split documented: deposit collection lives on the shop checkout; the single/landing partial-payment split is narrower (see AB4 acceptance) |
| AX5b Custom checkout fields | AB4 | ✅ BUILT | `storefront` (field defs + storefront payload), checkout services, settings UI | Strict validation: unknown keys REJECTED deliberately (a renamed required field must never silently vanish); defs ride the public payload for all three native checkouts |
| AX6 POS offline + express checkout | AB4 | ✅ BUILT | `pos/` (queue/replay), `storefront` (express delegate), web POS + checkout; `20261017040000` | Offline queue fires ONLY on network failure (HTTP errors never queue); replay goes through GB3 idempotency inside createSale (a retried sync can never double-place); classification deterministic (unknown product → rejected pre-call; stock → conflict; force re-post skips ONLY the stock refusal); express checkout delegates to the standard checkout with session + owned default address strictly required — no new pricing path, no invented card storage |
| AX7 B2B (price lists, quotes, net terms) | AB5 | ✅ BUILT | `apps/api/src/commerce/` B2B services, quotes, `orders` (createManual conversion), web CRM + quote UI | Price precedence spec-pinned: gift-card face value > explicit price list > wholesale tier > catalog; price lists are materialized prices only (never read-time percentages); quotes are OFFER documents (no tax/promotion evaluation) — conversion runs snapshot prices through createManual, totals match BY CONSTRUCTION (manual orders carry taxMinor = 0); convert-preview endpoint shows the result before confirming; net terms stamp `Order.creditDueDate` at placement (create-only). Known scope note: group price lists don't apply inside manual staff orders (see AB5 acceptance) |
| AX8 Mix-and-match bundles | AB5 | ✅ BUILT | `commerce/` bundles + cart/quote validation, product form UI | Slot picks validated at cart AND quote; bundle price is FIXED regardless of picks (merchant prices the box); sold/stock state from member availability |
| AX9 Digital products | AB5 | ✅ BUILT | `commerce/` digital (license pools, signed downloads), R2 storageKey migration | Keys assign at the buyer's **first reveal** (no delivery-transition choke point exists — pool counts lag until reveal, documented); signed download URLs are short-lived grants, the access counter moves per item, and the raw file URL leaves the server only as a 302 at download time |
| AX10 Meta catalog sync lifecycle | AB5 | ✅ BUILT | `apps/api/src/catalogs/` (sync queue + sweep), product hooks | CREATE/UPDATE/DELETE + variants on the same /batch endpoint; 3-attempt sweep + dead-letter read model; `autoSync` default OFF, kill-switch honoured. **Partial nuances:** variant deletions ride a product UPDATE (a removed variant can linger on Meta until a full manual push); stock-only movements don't enqueue a sync. No live Meta call exists (M30) |
| AX11 Smart (FTS) shop search | AB6 | ✅ BUILT | `storefront/` search + `products` search-vector maintenance; `20261017060000` | `Product.searchVector` tsvector + GIN, ONE canonical weighted expression (A name/SKUs, B category/brand, C descriptions) on the **`simple` config — no stemming, no typo tolerance claimed**; zero FTS hits fall back to the untouched substring scan (recall never worse); merchant synonym map expands whole-query else per-token, bound parameters only; proven on real Postgres incl. the migration backfill + a 12/12 runtime smoke of the shipped functions |
| AX12 Shop blog | AB6 | ✅ BUILT | `storefront/` blog API, web blog pages + dashboard editor | Reuses GC1's block validator verbatim + a shared `BlocksEditor` extracted for both editors; published-only public surface; sitemap entries with real lastmod. **V1 scope by design:** no RSS, no comments, no scheduled publishing |
| AX13 Multi-language product content | AB6 | ✅ BUILT | `products/product-display.ts` (locale rule), DTOs/import/export | `nameEn`/`descriptionEn` thread through listings, cart, quotes AND order snapshots on all three native placement paths; legacy CSV/XLSX files without the columns import unchanged; FTS vector includes the En fields |
| AX14 Cart cross-sell + recently viewed | AB6 | ✅ BUILT | `storefront` recommendations payload, web `CrossSellRail`, recently-viewed v2 | Recently-viewed moved to ids-only storage resolved live (prices never stale); cross-sell rides the existing recommendation engine's payload |
| AX15 AI review insights | AB7 | ✅ BUILT | `apps/api/src/orders/` review-insights, product-page UI | Staff-triggered only, org's configured LLM, proposals-style honest refusal when no LLM is configured; rating-only reviews excluded from the count basis by design; summaries cached on the review aggregate |
| AX16 Web Push | AB7 | ✅ BUILT | `apps/api/src/webpush/`, web shop worker scope `/shop/` | Per-shop VAPID keys (sealed), shop-scoped service worker coexisting with the dashboard PWA worker; subscription tied to the shop surface only (dashboard pages never prompt — documented web-platform constraint); sends ride the existing notification fan-out |
| AX17 Social-proof popups | AB7 | ✅ BUILT | `apps/api/src/social-proof/`, shop widget | REAL orders only — payload keys spec-pinned (first name token + district; amounts NEVER shown, a deliberate privacy choice); merchant-configurable recency/frequency caps |
| AX18 Cart-recovery sequence preset | AB7 | ✅ BUILT | `workflows/` (recovery step action), workflow builder preset | 3-step preset over the existing workflow engine; state matched by run context keys over the org's latest 200 runs (older enrolments fall off the scan — stated); no new scheduler |
| AX19 Order attribution stamps | AB7 | ✅ BUILT | `commerce/` attribution helpers, checkout DTOs (all three native paths), Order columns | UTM + fbclid/gclid/ttclid stamped on the Order at placement; **"first touch" is per browser SESSION** (sessionStorage — no durable cross-session store exists and none was fabricated); staff order detail shows the stamps |
| AX20 Forecasting v2 + A/B significance | AB7 | ✅ BUILT | `purchasing/` forecast, `landings/` significance, analytics UI | Deterministic trend/seasonality math, labelled as estimates; significance = z-test display only — **no automatic winner switching** (per plan). Social-proof/review/recovery/forecast are display/assist only; nothing here moves money or publishes |
| AX21 Merchant developer API | AB8 | ✅ BUILT | `apps/api/src/merchant-api/`, `common/api-usage.ts`; `20261017080000` | Scoped `qk_live_` keys (hash-only at rest, plaintext once, org derived from the credential); every route delegates to Products/Orders/Customers services — no parallel implementations; guard enforces 401/403/429; first-ever writer for GC22's `ApiUsageDaily`; OpenAPI merchant section documented outside the frozen public inventory (inventory is public-routes-only by construction — reason stated in the doc + spec). Notes: `keyPrefix` = first 8 of the random segment (the token's literal first 8 are `qk_live_` for all keys); customers list inherits CustomersService's ≤100-row window |
| AX22 Per-shop PWA | AB8 | ✅ BUILT | `apps/web/src/app/shop/[orgSlug]/manifest.webmanifest/route.ts`, `icon.svg/route.ts`, `lib/shop-pwa.ts`, `components/ShopInstallBar.tsx` | Manifest from org identity (brandName → org name), icons = merchant logo → white-label neutral icon → platform set; dashboard never picks up a shop manifest (layout split verified); install bar with iOS fallback copy + per-shop dismissal. **No service-worker changes** — shop caching explicitly NOT added, per plan |
| AX23 Custom CSS/JS | AB8 | ✅ BUILT | `StorefrontSetting.customCss/customJs/customJsEnabled`, `storefront.service.ts`, `lib/shop-custom-code.ts`, shop layout + storefront settings UI | **Cookie audit (done first, written finding): the platform has NO auth cookies** — staff auth is a JWT in app-origin localStorage sent as a Bearer header; the only cookies are host-only non-auth shop cookies. Derived rule implemented as a server-side host check: custom JS is refused on the primary app hosts (and their subdomains) and allowed on tenant subdomains + verified custom domains; CSS/JS breakout sequences rejected at save; audit carries lengths only |
| AX24 White-label completion | AB8 | ✅ BUILT | `Organization.whiteLabel`, `messaging/email.provider.ts` (fromName), shop favicon/manifest fallbacks, admin org page | Mark audit found: NO shop footer/powered-by mark, NO title suffix, order emails had no body mark — the real marks were the favicon/manifest platform fallbacks (→ neutral generated initial icon) and the bare platform SMTP From (→ org brand name when WL on). **Admin-set only** (plan tiers carry numeric limits only — no plan boolean invented); SaaS invoices deliberately NOT toggled (platform is the seller) |
| AX25 Merchant data tools | AB8 | ✅ BUILT | `apps/api/src/data-tools/`, `organizations/org-data-export.ts`, `admin.service.ts` (delegation), jobs `data_export_generate` + `org_backup_sweep` | (a) Audit viewer over the **org-stamped subset only** — AuditLog HAS organizationId but only ~219/393 write sites stamp it; the response + UI label the scope (`org_stamped_only`), never inferred. (b) Admin export builder generalized into a shared service (admin shape byte-identical, m40 spec unmodified); file pipeline adds order items + media metadata; inline ≤ 25,000 rows else job; 7-day expiry; expired download 410, pending 409 (flagged judgement). (c) Backup preference + sweep, newest-4 retention (file deleted + row expired) |
| AX26 Google SSO | AB8 | ✅ BUILT | `apps/api/src/auth/google-sso.service.ts`, `SsoLoginState`, `AuthService.completeGoogleLogin`, admin config section, web `/login/google` | Separate `googleOAuth` platform config (admin-set, sealed secret, **no env fallback** — the YouTube `googleApp` config is distinct); hashed single-use state (10 min) + user-bound handoff (5 min, fragment-delivered); `email_verified` required; **NO auto-provisioning** (unknown email → Bengali error + FAILED LoginEvent); TOTP users enter the existing challenge — SSO never bypasses TOTP; `LoginEvent.method` = "google". Live proof owed: owner must create the OAuth app + set the config |
| AX27 Device-fingerprint fraud signal | AB8 | ✅ BUILT | `apps/web/src/lib/device-hash.ts`, `fraud/` (CheckoutGuard + fraud-score), `Order.deviceHash`, orders/fraud UI | Client hash = SHA-256 of UA/screen/timezone/language/CPU-bucket — **NO canvas, NO WebGL**; BlockedIdentifier kind `device` with prefix-only attempt logs; ON4 `deviceVelocity` band **+15 at ≥ 3 distinct phones/24h** — 15 < the 70-point high band, so the signal alone can never hold an order (spec-asserted); settings carry the weak-signal copy verbatim. Hash is per-browser-profile stable only — weak by design |

## Explicitly NOT in this program (per the plan — unchanged)

- **SAML SSO** — AX26 covers Google OAuth for staff only.
- **Embeddings / vector search** — AX11 is PostgreSQL FTS with a
  merchant synonym map, deliberately.
- **Native mobile apps** — AX22 makes the SHOP installable;
  there is no native app.
- **Automatic A/B winner switching** — AX20 shows significance;
  switching remains a human act.
- Anything from other programs' NOT-BUILT lists (Paperfly,
  ShurjoPay/aamarPay refunds, warehouse-specific access,
  bandwidth metering) — untouched by this program.

## Batch ledger

| Batch | Items | Head | Fresh-DB | Headline gates |
|---|---|---|---|---|
| AB1 | AX1, AX2 | `de80e4c` | 174/174 | API 370 suites / 3,967; web 419 |
| AB2 | AX3 | `d6a58e7` | owed at close; covered by AB3's 176 run | API 374 / 4,024; web 419 |
| AB3 | AX4 | `0b2f3c6` | 176/176 + populated-fixture backfill | invariant specs after every op type |
| AB4 | AX5, AX6 | `d4ed322` | 177/177 | API 382 / 4,159; web 462 |
| AB5 | AX7–AX10 | `cb7908a` | 178/178 | API 386 / 4,272; web 462 |
| AB6 | AX11–AX14 | `83e7444` | 179/179 + FTS runtime smoke 12/12 | API 388 / 4,311; web 469 |
| AB7 | AX15–AX20 | `6278acf` | 180/180 | API 396 / 4,441; web 524 |
| AB8 | AX21–AX27 + summary | (docs commit) | **181/181**, 282 tables | **API 401 / 4,523; web 570; build 7/7** |

## Honest limits (program-wide)

- **Nothing in AX1–AX27 is live-proven.** No real loyalty
  redemption at a live checkout, no real gift-card purchase/send,
  no live Meta catalog push, no live LLM review summary, no real
  web-push delivery, no live Google OAuth round trip (no Google
  app exists yet — owner setup), no live merchant-key HTTP call,
  no real export-file download. All proof is spec / fixture /
  fresh-DB level; the M30 live-verification debt stands in full,
  now including AX26's owner-side OAuth app setup and AB8's
  per-org job enables (`data_export_generate`,
  `org_backup_sweep`).
- **The 8 Advanced migrations have never run on a real,
  data-bearing DB** — fresh-DB (181/181 clean) and populated-
  fixture backfill (AX4) only.
- Money-instrument honesty carried from the batches: gift-card
  refunds void remaining balances only (spent value is not
  recovered); loyalty balances may go negative on clawback
  (visible debt, by design); the AX5 deposit fix changed
  canonical due math for ALL readers — deliberate, and covered
  by the AB4 acceptance.
- AX25's audit viewer is scoped to org-stamped rows (~219/393
  call sites) and labels itself so; backfilling org ids onto
  platform-level audit rows was NOT done (it would be inference,
  not fact).
- Whole-program state: this line (gc, 181 migrations) is
  **local-only**. A future release needs union integration with
  the other lines (ls-remote first, per the standing rule), a
  full union fresh-DB run, the owner's explicit push
  instruction, and his manual Dokploy Redeploy.
