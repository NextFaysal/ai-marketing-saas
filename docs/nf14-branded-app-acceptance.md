# NF14 Acceptance — Branded Customer App (per-shop installable app + app-only offers)

**Item:** New Features Frontier FB5 · NF14
**Worktree/branch:** `~/workspace/ai-marketing-saas-nf`, `new-frontier` · **Base:** `aaa7f017` (NF13 complete)
**Local commits only — nothing pushed.** Migration claim used: `20261041000000_nf14_branded_app` (the only NF14 claim).

## Headline finding (audit, verified before building)

NF14's core **already existed** from AB7/AB8 (AX16/AX22/AX23). NF14 did NOT rebuild any of it. The one real gap was **app-only offers**, plus one settings honesty note. Everything below separates "already existed" from "built in NF14".

## Audit table — what already existed (file evidence)

| Piece | Evidence | State before NF14 |
|---|---|---|
| Per-shop PWA manifest | `apps/web/src/app/shop/[orgSlug]/manifest.webmanifest/route.ts` serving the pure builder `buildShopManifest` in `apps/web/src/lib/shop-pwa.ts`: name = `brandName ?? org name ?? shopName`, theme = org `primaryColor`, `start_url /shop/<slug>`, `scope /shop/<slug>/`, `display: standalone` | Complete |
| Icon honesty (in code) | `shop-pwa.ts`: own logo → that logo; white-label without logo → GENERATED initial icon (`/shop/<slug>/icon.svg`, `buildShopIconSvg`); non-white-label without logo → platform PNG icons. Maskable is claimed only for the platform's purpose-built maskable asset (ED10) | Complete |
| Manifest tests | `apps/web/src/lib/shop-pwa.test.ts` — name resolution, short_name, urls/scope/theme+fallback, all three icon branches, maskable honesty, SVG escaping | Complete (10 tests) |
| Install bar | `apps/web/src/app/shop/[orgSlug]/ShopInstallBar.tsx`: `beforeinstallprompt` via `window.__pwaInstallPrompt`; iOS Safari gets manual Share → "হোম স্ক্রিনে যোগ করুন" instructions (no fake button); dismissal per shop in localStorage `shop-install-dismissed:<orgSlug>`; renders nothing when standalone or dismissed | Complete (dismissal *key* had no test — NF14 added one, see below) |
| Per-shop push | `apps/api/src/webpush/webpush.service.ts`: PER-ORG VAPID keypair generated once, private key sealed; `WebPushSubscription` unique per (org, endpoint); per-org campaign fan-out. Push was therefore already honestly per-shop | Complete — **reused, no parallel system built** |
| Service worker | Shop registers NO service worker of its own (the dashboard worker owns the root scope; the shop push worker is push-only) | By design (AB8) |

## Deviation from the brief (recorded, reasoned)

The brief assumed an existing public payload listing a shop's active discount offers. **None existed**: `ShopPromotions.tsx` is the NF6 *gamified* overlay (spin/quiz/group-buy campaigns), and no API route or web surface listed `StoreDiscount` offers publicly. NF14 therefore built the missing payload + surface in the codebase's own pattern, rather than pretending to extend one:

- API: `StorefrontService.publicOffers(orgSlug)` + `GET /public/shop/:orgSlug/offers`, modelled on the neighbouring `publicFlashSales` (shop must be enabled or 404; failure-isolated to an empty list; public-safe fields only — no `usedCount`, no scope internals, no org id).
- Web: a new `ShopOffers` strip on the shop home page (next to the bundles/flash strips), fed server-side by `fetchShopOffers` (public cache class, like every catalogue read).

## What NF14 built

| # | Commit | Contents |
|---|---|---|
| 1 | `7180515b` | Schema + migration: `StoreDiscount.appOnly Boolean @default(false)` + hand-written `20261041000000_nf14_branded_app/migration.sql` (`ALTER TABLE … ADD COLUMN`, comment style of neighbours). `prisma validate` PASS |
| 2 | `ff66803c` | API: staff `DiscountDto` (class-validator + service interface) accepts `appOnly`; `DiscountsService` persists it on create (default false) and update (only when present), `serialize()` includes it with legacy-absent → false; `publicOffers` payload includes `appOnly` per offer; **checkout evaluation untouched**; spec `apps/api/src/commerce/nf14-app-only.spec.ts` |
| 3 | `39ab2060` | Web: pure helper `apps/web/src/lib/app-offers-nf14.ts` (`isStandaloneDisplay`, `visibleOffers`, `offerLabel`); `ShopOffers` strip applying the rule; dashboard discount form `appOnly` toggle + honesty note + list badge; BrandingCard app-icon honesty note; vitest (below) |

### The display rule, stated honestly

- `appOnly` is a **display rule only**, end to end. The public payload carries ALL active offers with their flag; the storefront hides app-only offers unless `isStandaloneDisplay()` (matchMedia `(display-mode: standalone)` OR iOS `navigator.standalone`). Standalone is client-only, so the strip first renders as a browser tab and corrects after mount — an app-only offer can never flash into a tab.
- **The code is never blocked.** Discount evaluation (`validateDiscount` / `DiscountsService.validateForCheckout`) does not read the flag; a shared app-only code redeems normally on the web. This is stated verbatim next to the dashboard toggle: "অ্যাপ-অনলি অফার: এই অফারটি শুধু দোকানের ইনস্টল করা অ্যাপে (standalone মোডে) দেখানো হবে। তবে কোডটি শেয়ার হলে ওয়েবেও কাজ করবে — এটি শুধু প্রদর্শনের নিয়ম, কোড বন্ধ করার ব্যবস্থা নয়।" — and proven by spec (below).
- The settings note (Organization Settings → BrandingCard, where logo/brand name/colour are edited) describes the icon behaviour exactly as `buildShopManifest` implements it, and states plainly that there is no separate app-icon upload.

## Spec / gate results (worker-run)

| Gate | Result |
|---|---|
| API spec `nf14-app-only.spec.ts` | **11/11 PASS** — create persists + payload includes; default false; update flips both ways; update without the flag leaves it; legacy row (field absent) serializes false; public payload includes `appOnly` per offer with no staff internals; inactive/future/expired/exhausted/other-org offers excluded; non-enabled shop 404; **checkout evaluation identical for appOnly true vs false** (valid/reason/discountMinor/freeShipping compared field-wise — the result's echoed discount snapshot of course carries the flag itself); an appOnly code still redeems (25% of ৳100 = ৳25) |
| API regression (same run) | `ec7-discounts` + `gb7-promotions` + `promotions` — combined with NF14: **4 suites / 61 tests PASS** |
| API regression (storefront, separate run) | `ec8-storefront` + `ec29-shop` + `storefront` — **3 suites / 44 tests PASS** |
| API tsc `--noEmit` | **PASS** (exit 0) |
| Web vitest (targeted) | **3 files / 23 tests PASS**: `app-offers-nf14.test.ts` **10** (appOnly hidden when not standalone, shown when standalone, regular offers always shown, legacy flag-absent = regular, `isStandaloneDisplay` via media query / iOS standalone / plain tab / no-window); `shop-pwa.test.ts` **11** (10 pre-existing + 1 NEW cross-shop isolation test: two shops' manifests share no name/colour/scope/icon); `shop-install-bar-nf14.test.ts` **2** (NEW — the dismissal localStorage key is per-shop; the key behaviour had no prior coverage. The full component flow — localStorage read in the mount effect, write in `dismiss()` — is component-internal and remains covered only at this key-contract level, stated plainly) |
| Web tsc `--noEmit` | **PASS** (exit 0) |
| Full web vitest / web build / fresh-PG / boot-smoke | **Not run by this worker** — the coordinator's serial gates, per the brief |

**shop-pwa coverage judgement (per the brief):** manifest name/colours/scope per shop were already covered by the pre-existing 10 tests; the one listed item not asserted *explicitly* was cross-shop isolation, so exactly one test was added for it — no duplication of the rest.

## NOT BUILT

- **No native apps** (no iOS/Android binaries, no app-store presence) — the "app" is the installable per-shop PWA that AB8 already shipped.
- **No new push system** — the existing per-org VAPID push (AB7) is the shop's push; nothing parallel was built.
- **No service-worker change** — none added or modified for NF14.
- **No checkout/redemption change** — evaluation, redemption counts and sync pushes behave exactly as before; `appOnly` is write-staff → read-public → display-filter only. Campaign-code generation (`generateCampaignCodes`) does not set the flag (defaults false).
- **No app-icon upload** — the icon still comes from the existing logo/generated/platform rule; the settings note says so instead of implying otherwise.
- **Install prompt limits (inherited, unchanged):** the install bar can only offer installation when the browser actually fires `beforeinstallprompt`; iOS Safari never does, so there it shows manual instructions only. Nothing in NF14 changes that.
- The offers strip renders on the shop **home** page only (not product/cart/checkout pages), and the offers payload is cached like other public catalogue reads (up to ~60s stale, the documented ED5 trade-off).

## Live proof owed

Nothing in NF14 is live-proven: the migration has not run on a real database, no real shop has had an app-only offer created, no real phone has installed a shop or been checked for standalone-only visibility, and no shared app-only code has been redeemed on the live web checkout. All of that is M30-style owner verification, owed after the union release + Dokploy Redeploy.
