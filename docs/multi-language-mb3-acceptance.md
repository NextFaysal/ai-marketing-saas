# MB3 Acceptance — Admin + Storefront/Public (ML7–ML8)

**Batch:** MB3 of the Multi-Language (i18n) Program (ML1–ML16), per the approved
Multi-Language Master Plan §৬. **Base:** MB2 close `85e7616a`. **Branch:**
`multi-language`, worktree `~/workspace/ai-marketing-saas-i18n`. **Local commits
only — NO push** (owner-only push rule). **No migration** (none was needed; the
`20261120000000+` claim was not touched). **No API changes.**

Execution: two parallel workers with disjoint ownership (Worker A = `apps/admin/**`
only; Worker B = web non-dashboard only; one owner per file, no duplicates — the
MB2 lesson held). Workers did not commit; the coordinator reviewed diffs, committed
per item, fixed gate failures, and ran all heavy gates serially.

## Commits

| Commit | Item |
|---|---|
| `ad47b616` | ML7: platform admin fully dictionary-driven |
| `88981735` | ML8: storefront completion + public surfaces dictionary-driven |
| `e7175d51` | ML7 fix: admin vitest `@` alias config (mirrors web) |
| `52b62750` | ML7 fix: tsc (5 errors) |
| `04ccb579` | ML8 fix: whole-string templates replace empty prefix/suffix pairs |
| `4f86cc94` | ML8 fix: tsc (23 errors) |

## Item audit

### ML7 — Platform Admin (`apps/admin`) — BUILT

- Single-file admin dictionary (`apps/admin/src/lib/i18n.ts`, MB1 pattern; bn is
  the shape source, en typed `typeof bn`): **1,817 flattened keys per locale**,
  28 namespaces; bn/en key sets exactly equal, zero empty values, zero
  placeholder-set mismatches (worker-verified by AST scan; pinned going forward
  by the new test).
- New `apps/admin/src/lib/i18n.test.ts` pins: exact key-set parity, no empty
  values, placeholder parity, bn fallback for unknown locale, missing-key
  behaviour, representative interpolation, `countWithClassifier` behaviour.
- Helpers: `getAdminDict`, `resolveAdminLocale` (localStorage `admin_ui_locale`
  → platform default bn), `trAdmin` with whole-string bn fallback + once-per-key
  warning, `interpolate`, `countWithClassifier`.
- Propagation: the existing MB1 `AdminLocale` mechanism was extended into
  `AdminLocaleProvider` + `useAdminLocale()` in `app/layout.tsx` — no second
  mechanism. Side effects preserved exactly (localStorage, `<html lang>`,
  fire-and-forget preference PATCH). Context default is the bn dictionary, so
  provider-less renders behave as the old bn UI and no existing test changed.
- All 20 admin pages + shell/nav/dialogs/toasts/command palette/attention bell
  converted; `not-found.tsx` (server component) renders via `getAdminDict("bn")`.
- Formatting: `dates.ts` rewritten on `@repo/contracts`; `api.ts`
  `formatMinorStr` is locale-aware and preserves its bare two-decimal contract
  (no duplicated ৳). **Zero** `toLocaleString`/`toLocaleDateString`/
  `toLocaleTimeString`/`Intl.` remain anywhere under `apps/admin/src`.
  `String.prototype.localeCompare` remains in exactly 2 places (org/user name
  sort collation — not a formatting call, not user-visible formatting).

### ML8 — Storefront completion + public surfaces (`apps/web` outside dashboard) — BUILT

- **Shop dictionary** (`lib/i18n/shop.ts`): **1,461 bn keys, 34 sections**,
  bn/en parity pinned by the pre-existing `shop.test.ts`. ML8 added/expanded:
  10 theme namespaces (Books, Kids, Electronics, Fashion, Furniture, Beauty,
  Grocery, Jewelry, Sports, Automotive), `pdp`, `checkoutExtra`, `accountExtra`,
  `booking`, `successExtra`, `promotions`, `express`, `shopWidgets`, `track`.
- **Public dictionary** (new `lib/i18n/public.ts`, standalone — deliberately not
  folded into the dashboard `dict.ts`): **825 bn keys, 26 sections**, bn/en key
  and placeholder parity verified.
- Surfaces converted (66 web files): all 10 shop themes, PDP, shop checkout,
  account, booking, success, cart, offers, promotions, express checkout,
  widgets (install bar, push prompt, social proof, quick view, bundle card,
  gift-card balance, product questions, review insight), shop blog, shop
  loading states; single-product checkout `checkout/[slug]`; landing pages
  `l/[slug]` (client, boosters, FAQ); platform landing + pricing; auth
  (login, Google login, register, reset-password, verify-email, accept-invite);
  join/optin/unsubscribe/preferences/pay/quote/review/returns/rider/supplier/
  tracking/ticket/referral/share token surfaces; onboarding; view-as; offline.
- Locale resolution respected per surface: shop surfaces use the payload
  storefront locale (`settings.locale` via EC19 `shopLocaleOf`/`shopT`);
  platform landing/auth/token pages with no org context render the platform
  default **bn**; no new switcher or provider was invented anywhere.
- **Zero** direct `toLocale*` calls remain in `apps/web/src/app` outside the
  dashboard (baseline 61 in app scope); all formatting goes through
  `@repo/contracts` with the resolved locale. Merchant content stays on the
  NF5 system (ML-L5) — UI strings only were converted.

## Gates (coordinator-run, serial, on the committed trees)

| Gate | First run | Final |
|---|---|---|
| Admin tests (vitest) | FAIL — `ui.test.tsx` suite could not load `@/lib/i18n` (admin had no vitest alias config; the base file had no `@/` import, so ML7 exposed it). Fixed by `e7175d51`. | **2 files / 18 tests PASS** (9 pre-existing + 9 new i18n) |
| Admin tsc | 5 errors (`Locale`→`UiLocale` ×2 files, `AdminDict` imported from the wrong module, tickets `ticketMeta` nullability, test cast). Fixed by `52b62750`. | **0 errors** |
| Web vitest (full) | 139 files / 1,140 tests — 1 FAIL: pinned no-empty test caught empty prefix/suffix dictionary values (see below). Fixed by `04ccb579`; re-run on the final tree after the tsc fixes. | **139 files / 1,140 tests PASS** |
| Web tsc | 23 errors — theme price helpers passed `string` locale into contracts formatters (×15), `LandingClient` org-locale field missing on the payload type, `BundleCard` missing `fmtNumber` import, optional-number narrowing ×2, and **a real runtime bug: the ElectronicsTheme EMI `tenure` state declaration had been dropped in conversion** (restored verbatim from base). Fixed by `4f86cc94`. | **0 errors** |
| Admin `next build` | First attempt interrupted by an environment service restart (no process/BUILD_ID remained); rerun clean. | **PASS** |
| Web `next build` | — | **PASS** |
| Fresh PostgreSQL | Not run — MB3 contains no migration (as planned). | n/a |
| API tests | Not run — API untouched (scanner totals identical to baseline). | n/a |

### Coordinator fix of note — empty affix pairs (`04ccb579`)

Worker B composed several sentences as prefix + value + suffix key pairs with the
grammatically unused side set to `""` (10 pairs in `shop.ts`, 5 in `public.ts`),
which the pinned shop no-empty test rejects and which sits awkwardly with ML-L2
(whole-string rendering). All 15 pairs were converted to single whole-string
`{placeholder}` template keys with `.replace()` at the 12 call sites; the
rendered copy is unchanged in both locales. The one unreferenced key
(`reviewAnalyzedPrefix`, empty in both locales) was deleted from both locales.
Key-set parity is preserved (the shop parity test is green).

## Scanner before/after (`scripts/i18n-scan.mjs`, final tree)

| Area | Before (base `85e7616a`) | After | Notes |
|---|---|---|---|
| Admin — Bengali literals | 866 | **0** | |
| Admin — English-UI (heuristic) | 123 | 104 | All 104 classified below; zero are UI copy |
| Admin — direct `toLocaleString` | 27 | **0** | |
| Web app (non-dashboard) — Bengali | 996 | **324** | 286 of 324 = theme sample/demo DATA (see exceptions) |
| Web app (non-dashboard) — English-UI | 149 | 150 | Flat; spot-verified as Tailwind classes/data |
| Web app (non-dashboard) — direct calls | 61 | **0** | |
| Web excl. dashboard (incl. shared lib) — Bengali | 2,533 | 1,861 | Remainder = MB2-classified D7 data catalogues + shared-lib helpers (MB6) |
| Web excl. dashboard — direct calls | 77 | 16 | All 16 in shared `lib/` (MB2 exceptions / MB6 sweep) |
| API — Bengali | 6,114 | 6,114 | Untouched, as scoped |

## Exceptions (every remainder, classified)

**Admin (104 English-heuristic hits, 0 Bengali):**
- `components/nav.tsx` (18): SVG icon path `d` data — not text.
- ~81 across pages/components: Tailwind CSS class strings (heuristic false
  positives; spot-verified).
- `app/layout.tsx`: root metadata title "Qosprey Admin — SaaS Control"
  (metadata/brand).
- `app/billing/page.tsx`: "STARTER / GROWTH / AGENCY" placeholders — plan-name
  data.
- `app/settings/page.tsx`: a `querySelectorAll` selector string; Stripe
  `pk_test_…`/`pk_live_…` formats; email/URL placeholders; JSON examples —
  data-format examples, identical in both locales by design.
- `components/Breadcrumb.tsx`: `aria-label="breadcrumb"` (technical term).
- System page: five short technical labels (`Version:`, `Git:`, `Database:`,
  `Redis:`, `Job Secret:`) exist as dictionary keys with intentionally
  identical bn/en values (glossary terms); KB/MB/GB unit labels stay Latin
  technical units in both locales with localized number rendering.
- Never translated by design: API-returned message text, entity/user/merchant
  data, enum/status identifiers, plan/provider/brand names, URLs, code/JSON.

**Web public/shop (324 Bengali + 150 English heuristic hits in app scope):**
- Ten theme files (286 Bengali): sample/demo DATA only — fake product names,
  prices, spec values, demo author/branch/category arrays, sample paragraphs.
  All UI chrome is keyed.
- `l/[slug]/ConversionBoosters.tsx` (18): the pre-existing fabricated
  sample social-proof array (RecentBuyersToast sample data).
- `landing-client.tsx` (4): showcase SAMPLE content (sample chat/ad/AI copy).
- `ProductDetailClient.tsx` (7): selector default state values that are data
  values matching option labels, plus a demo author default.
- Shop checkout (2) / account (1): "ঢাকা" as a district NAME data value.
- A few Bengali hits are code comments only (review, supplier, booking,
  install bar).
- Metadata/manifest copy (root `page.tsx`, `layout.tsx`, `manifest.ts`,
  `l/[slug]/page.tsx`, offline pages' metadata): static Next metadata objects,
  not rendered UI.
- English hits: overwhelmingly Tailwind class strings (spot-verified in
  `ShopHeader.tsx` / `ShopCartDrawer.tsx`, which carry 27 / 24 dictionary
  references respectively) and data values.
- Shared libs consumed by converted surfaces but NOT modified (locale-unaware
  helpers kept where already established): `@/lib/money-bn`,
  `@/lib/storefront-money`, `@/lib/courier-status` step labels (shared with
  the dashboard inbox), `@/lib/social-posts-sn`, `@/lib/dropship-nf12`,
  `@/lib/booking` slot/status labels, `@/lib/rider-gps`, `@/lib/express-checkout`
  bn payment-label helper (pinned bn by its own test; ExpressCheckout now
  prefers dictionary labels for known methods and falls back to the lib),
  success page's `payOptionLabel`. These are MB6-sweep candidates.
- Pre-existing quirks preserved, not introduced: `ShopOffers` is imported by
  the shop home but never rendered (dead import); the login page keeps its
  pre-existing English "Login failed" fallback and demo-credentials line
  (data); the `r/[token]` agency report is bilingual by design.

## Presentation changes to note (pinned-format consequences)

- English dates on track/account/blog surfaces now use the contracts en-IN
  long form (`19 October 2026`) instead of the previous ad-hoc en-GB.
- `LandingClient` money via `fmtMoneyMinor` shows paisa digits only when
  non-zero (previously up to 2 always); theme price helpers preserve their
  original whole-taka rounding.
- Admin tickets header and system inbox line: single dictionary templates
  replaced JSX compositions that bolded individual parts — text content and
  order are unchanged; the per-part bold styling is lost.
- AdminShell nav group open-state localStorage keys changed from Bangla group
  titles to stable group ids (previously stored open-state simply won't match;
  the active group auto-opens as before).

## NOT BUILT / partial — explicit

- **API locale field for single-product/landing payloads:** `checkout/[slug]`
  and `l/[slug]` read `organization?.locale ?? locale` defensively and default
  to bn. The API does not send the field today, so until an API batch (MB4
  territory) adds it, those surfaces render bn exactly as before.
- **Shop booking page locale:** renders bn default — its public API helpers
  (`@/lib/booking`) expose no shop settings/locale to resolve from.
- **No locale switcher/provider added** to any public surface (by design —
  storefront locale comes from the shopper/store payload; platform pages use
  the platform default).
- **Hindi UI:** not introduced (decision D5 — Hindi stays content-only via NF5).
- **Merchant/content translation:** untouched everywhere (NF5's system, ML-L5).
- **Screenshot/visual QA:** NOT performed — this environment cannot do visual
  screenshot verification. No visual claim is made for MB3; bilingual visual
  QA belongs to the MB6 checklist / post-deploy pass.
- Nothing in MB3 is live-proven; no push, no deploy.

## Batch state

MB3 is **COMPLETE** at the final HEAD (this doc's commit). Program continues:
MB4 (API catalog + notifications + documents), MB5 (AI/automation language +
translation workflow), MB6 (zero-hardcoded enforcement + bilingual QA +
program audit) remain.
