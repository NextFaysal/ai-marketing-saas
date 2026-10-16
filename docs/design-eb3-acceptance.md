# EB3 Acceptance — ED7 Shop v2 Theme + Chrome · ED8 PDP/Listing v2 · ED9 Checkout/Cart v2 + Overlay Orchestration

Batch 3 of 7 of the E-Commerce Design & Experience Program
(plan: `Ecommerce-Design-Master-Plan-2026-10-16.md`). Worktree
`~/workspace/ai-marketing-saas-design`, branch `design-v3`, base =
EB2 head `d3787107`. **Local commits only — no push.** Web-only:
`git diff d3787107..HEAD` touches **32 files, all under apps/web**
(0 files in apps/api, packages/db, packages/contracts, apps/admin,
apps/worker); **zero migrations**.

Commits (oldest → newest; ED9 item 4 is a deliberately EMPTY
commit recording an investigation verdict — see ED9.4):
- ED7: `962feaca` v2 theme tokens + effective resolution · `d8272cda` themePreview plumbing · `443e6383` header v2 · `d940536c` bottom navigation · `e2d822a3` footer v2 · `9c0017d0` theme picker + preview link
- ED8: `04e911ee` ProductCard v2 · `26d7a9e2` PDP v2 buy bar + info panel · `405f6ae2` listing filter drawer
- ED9: `2c7667e7` overlay queue · `0eac7955` cart drawer · `64f68af2` checkout v2 + ExpressCheckout polish · `9faee566` single/landing CTA investigation (empty)

## Gates — baseline vs final (coordinator-run, exit-code checked)

| Gate | Baseline (d3787107) | Final (EB3) |
|---|---|---|
| Web vitest | 733 passed / 85 files | **753 passed / 88 files** (+20: bottom-chrome store 5, overlay queue + lift 8, card-v2 + theme/i18n extensions) |
| Web tsc (`tsc --noEmit`) | 0 errors | **0 errors** |
| `pnpm -r build` (7 projects, production `next build`) | exit 0 | **exit 0** |
| API / prisma / migrations | — | untouched (0 files), zero migrations |

First Load JS (real `next build` output, baseline → after): shop
home 144 → **148 kB** (page chunk 3.97 → 7.32: the v2 header
branch + filter drawer ship in the shared shop chunks — inert on
legacy shops but not free), checkout 154 → **156**, cart 144 →
145, account 150 → 151, brands 140 → 141; blog/PDP-family,
single checkout (133) and landing (119) unchanged. Small, honest
cost; the code is present-but-dormant for classic/bold/minimal.

**Legacy-theme byte-compat**: `lib/shop-theme.test.ts` — every
EB1 pin (classic strings, full bold/minimal `toEqual` objects,
fallbacks) passes unchanged; ED7 extended the spec with the v2
snapshot pin + `effectiveThemeId`/`isV2Theme` cases. The three
legacy themes omit the new optional token fields entirely, so
their rendering has no new inputs.

## ED7 — v2 theme + chrome

**Theme plumbing.** `lib/shop-theme.ts`: `ShopThemeId` gains
`"v2"`; the `ShopTheme` interface gains OPTIONAL fields
(`cardBodyClass`, `cardPriceClass`, `sectionTitleClass`) that
only v2 sets. v2 is **token-native** — its strings are built from
the EB1 variables, e.g. card = `rounded-[var(--radius-lg)] border
border-[var(--border-soft)] bg-[var(--surface)]
shadow-[var(--shadow-card)]`, price = `text-[var(--brand)]` (so
the merchant's `--brand` finally colours prices), hero on
`--surface`/`--shadow-card`. New pure helpers: `isV2Theme(id)`,
`effectiveThemeId(storedId, previewId)` (preview wins only when
valid). Grid rhythm unchanged (2 → 3 → 4).

**Preview mechanics.** `src/middleware.ts`: on `/shop/*` requests
carrying `?themePreview=v2`, the middleware sets the request
header `x-shop-theme-preview: v2` (the pre-existing /shop
early-return branch; the custom-domain flow below is untouched).
The shop layout reads it via the `previewThemeIdFromHeaders`
helper (unit-tested as a pure function of a Headers-like) and
computes the effective theme ONCE, passing it to the header,
social proof and footer, stamping `data-shop-theme={effThemeId}`
on the shop root div, and mounting the bottom nav only for v2.
**View-only**: the stored `settings.themeId` never changes;
anyone with the link can view the preview (it's a public
storefront — stated in the middleware + layout comments and in
the settings UI copy). Trade-off, recorded honestly: the layout
now reads `headers()` on every shop request; EB2's caching is
fetch-level (`revalidate: 60` in `lib/storefront-server`) and is
**unaffected** — public reads still hit the 60s data cache.

**Header v2** (ShopHeader, v2 branch only; the legacy markup is
untouched in a separate branch, all badge/cache/event logic is
shared): sticky, slim, token surface; logo + name; ≥44px lucide
icon buttons (search toggle, wishlist w/ badge, account, cart);
the search toggle expands a full-width row holding the **exact
home-hero search form** (`method=get`, `action=/shop/<slug>`,
`name="q"` — no new search mechanism); below lg a hamburger
opens the @repo/ui Drawer (nav links, merchant pages, account,
wishlist — ≥44px rows); at lg+ the inline text nav remains. The
header listens for the bottom nav's `shop:open-search` event.

**Mobile bottom navigation** (new `ShopBottomNav.tsx`, v2 only,
`lg:hidden`): হোম / খুঁজুন / কার্ট (badge from the EB2 header
cache + the same update events) / অ্যাকাউন্ট, lucide icons +
labels, safe-area padding, active-route highlighting; খুঁজুন
scrolls to top and dispatches `shop:open-search`; hides on
scroll-down, reappears on scroll-up and near the top; renders
null while the PDP buy bar is active (the buy bar owns the
bottom — coordination via the new `lib/shop-bottom-chrome.ts`
store, unit-spec'd). The layout adds a v2-only bottom spacer so
the bar never covers footer content.

**Footer v2**: the layout footer's SAME content blocks (name,
footer links, COD note, payment note, bKash/Nagad, support
phone, return policy — nothing added/removed/reordered) with
token classes. Legacy footer markup byte-identical.

**Merchant picker** (dashboard storefront settings): THEME_OPTIONS
gains `{ id: "v2", label: "নতুন ডিজাইন v2" }` with a CSS mock
preview in the existing pattern; grid widened to fit 4 options;
a live-preview link under the picker opens the merchant's own
shop with `?themePreview=v2` in a new tab ("সেভ না করেই দেখুন").

**New i18n keys** (bn+en pairs, key-set test green): `chrome`
section — search খুঁজুন, menu মেনু, close বন্ধ করুন, filter
ফিল্টার, categories ক্যাটাগরি (+ ED8/ED9 additions in the same
section/dict as noted per item).

## ED8 — PDP + listing v2

**ProductCard v2 variant**: a separate v2 render branch (legacy
JSX untouched): token card surface, `cardBodyClass` body,
brand-coloured price via `cardPriceClass`, badges aligned in one
row; QuickView + WishlistHeart keep their exact handlers with
≥44px hit areas in v2 (a defaulted `large` prop on the heart).
No add-to-cart was added to the card — the card has never had
one (quick view + wishlist are its quick actions); the brief's
"add" was read as those existing actions and the deviation is
recorded here. Pinned by `lib/shop-card-v2.test.ts` (v2 price
class present, v2-only classes absent on legacy).

**PDP v2**: the page computes the effective theme and passes
`isV2` + tokens into ProductDetailClient. Threading, verified in
code: `detail.settings` carries NO themeId (locale/trust copy
only), so the page takes the stored id from `fetchShopHome`
(React `cache()`-deduped with generateMetadata's fetch in the
same request) and the preview from the headers helper. Related /
bought-together / recently-viewed cards receive v2 tokens
**only when the effective theme is v2** (passing legacy tokens
there would have changed bold/minimal rendering — those rails
render classic tokens today regardless of shop theme, a
pre-existing quirk left exactly as-is). The server page's EC18
trust sections (delivery promise / support / return policy)
also got a v2-only token restyle with lucide icons (Truck /
ShieldCheck / RotateCcw) replacing the emoji — text content and
legacy rendering unchanged.
- **Sticky buy bar** (v2, mobile, `lg:hidden`): thumb, name,
  variant-aware price, কার্টে যোগ + এখনই কিনুন riding
  `.btn-brand`, calling the EXISTING add/buy handlers (no new
  flow). Visibility = **IntersectionObserver** on the main buy
  section (bar shows when it scrolls out) — the IO option was
  chosen over always-visible and is documented in code. While
  visible it publishes `setBuyBarActive(true)` + its measured
  height as the buy-bar lift (fallback 64px) to the
  bottom-chrome store, so the bottom nav yields and ED9's
  overlays lift above it; both clear on hide/unmount. Out-of-stock
  disables it exactly like the main button.
- **Info panel v2**: token price block + trust rows with lucide
  icons in the client panel; no text added/removed.
- Gift-card products: the buy bar IS shown; its price is the
  selected face value (`gcAmountMinor()` — the same state the
  main panel's addToCart validates; `unitMinor` while a custom
  amount is unusable). The GC face-value/recipient form itself
  stays in the main panel; the bar's buy actions reuse the same
  handlers, which validate GC state as today. Buy-now = the
  existing addToCart handler (now returning Promise<boolean>;
  existing callers ignore it) + navigation to checkout only on
  success — the PDP has no separate buy-now flow today, and
  none was invented.

**Listing v2**: home (`page.tsx`) and the brand page now resolve
the **effective** theme (both already read searchParams, so
`themePreview` costs nothing there). New `ListingFilterDrawer`
(v2, mobile): a ফিল্টার button (active-filter count badge)
opening an @repo/ui Drawer whose category/brand/sort entries
are **links built with the existing `shopHref` helper** — the
same URLs the chips produce; applying = navigating, exactly
today's behaviour. There is **no price filter and no sidebar**
in the current listing (the brief assumed both) — none was
invented; the drawer carries the real filter set
(category/brand/sort). Desktop chips + SortSelect unchanged on
all themes; mobile keeps the chips too (the drawer is additive).
The PDP/home `loading.tsx` shells were NOT reshaped for v2
(a loading shell cannot know the shop's theme without fetching
— EB2's skeleton-only constraint kept).

## ED9 — checkout/cart v2 + overlay orchestration

**Overlay queue** (new `lib/shop-overlay-queue.ts`; ALL themes —
behaviour only, zero visual changes to any overlay's markup):
each overlay keeps its own trigger/frequency/dismissal logic and
now renders only when the queue grants it. Pure core + React
binding (`useOverlayGrant(id, wantsVisible)`,
useSyncExternalStore). Rules, all unit-spec'd
(`lib/shop-overlay-queue.test.ts`, 9 specs incl. the lift
computation): at most ONE active;
priority **popup 40 > install 30 > push 20 > social 10**;
releasing the active id frees the next-highest waiter;
re-request is idempotent; releasing a non-active id just
dequeues it; unknown ids sort below known priorities. Wiring:
ShopPopup (granted = its `visible && popup` state), ShopInstallBar
(mode != null), ShopPushPrompt (visible), ShopSocialProof
(item && visible — its rotation timers keep running while
queued; an item may rotate unseen behind a higher-priority
overlay, accepted + documented). The popup is a full-screen
modal and takes no lift.
- **Bottom lift**: `lib/shop-bottom-chrome.ts` now also carries
  `navLiftPx` / `buyBarLiftPx`; the effective lift is
  `max(nav, buyBar)` (spec'd). ShopBottomNav publishes its
  measured height; the PDP buy bar publishes its own. Granted
  bottom overlays (social, push, install bar) offset by the lift
  via inline `bottom` style **only when lift > 0** — with no
  bottom chrome the style is absent and rendering is
  byte-identical to pre-EB3.
- **Contact buttons**: ShopContactButtons keeps its markup; the
  layout now wraps it in the new client `ShopContactLift`: a
  `fixed inset-0 z-40 pointer-events-none` wrapper inside which
  the buttons render `absolute` (pixel-identical to their old
  `fixed` anchoring) and translate up by the lift. They stay
  persistent chrome — never queued, never hidden.

**Cart drawer** (new `ShopCartDrawer.tsx`, v2 header only — the
v2 cart button opens it instead of navigating; legacy header
untouched): @repo/ui Drawer with line items (MediaImage thumbs,
qty steppers, remove — via `fetchCart`/`patchCartLine` with the
cart page's exact call shapes; bundle lines render read-only,
mirroring the cart page's treatment — `patchBundleLine` is NOT
called from the drawer, bundle editing stays on the cart page),
subtotal, checkout CTA (Link, `.btn-brand`) and a full-cart-page
link. Refreshes on open + `CART_UPDATED_EVENT`; badge sync rides
the existing event flow. **The full cart page is unchanged** and
remains the fallback path.

**Checkout v2** (gated on the payload's own data: the public
shop payload DOES carry `settings.themeId` — verified against
the ShopPublic type/API shape; preview read from
`window.location.search` post-mount, which is safe here because
the page's content is client-fetched anyway):
- **Step chrome**: numbered step headers (১ তথ্য → ২ ডেলিভারি →
  ৩ পেমেন্ট; i18n `checkout.stepInfo/stepDelivery/stepPayment`)
  inserted BEFORE the existing sections — no field was
  re-parented, reordered or renamed; the summary card gets token
  styling in v2. Legacy rendering byte-identical (headers render
  only when isV2).
- **Sticky mobile bar** (v2, <lg): total from the EXISTING
  computed quote + a place-order button firing the EXISTING
  submit path; hidden while the main submit is in view
  (IntersectionObserver) and after a deposit is placed; while
  shown it yields the bottom nav and publishes its lift like
  the PDP buy bar.
- **Inline errors — honest bound**: the checkout form has ONE
  error string, not per-field error state. In v2 that existing
  string is ALSO rendered inline (rose-600, under the relevant
  section: pickup, slot, terms/consent, …) at the points where
  the flow already attributes it; the top banner remains the
  fallback. No new validation or messages were invented, and
  fields without an attributable existing message stay
  banner-only.
- **ExpressCheckout polish** (all themes, classes only): sheet
  surface/radius/ink moved to EB1 var tokens at values equal to
  the old hard-coded ones; its one hard-coded indigo primary
  (the no-address → account CTA) now rides `.btn-brand` (the
  sheet lives inside the shop layout seam; fallback = the exact
  indigo it replaces). The emerald confirm button is emerald BY
  DESIGN (EB1 record) and was NOT touched.

**ED9.4 — EB1 leftover verdict (empty commit `9faee566`)**:
READ-ONLY investigation of the API payloads:
- `GET /public/checkout/:slug` (single-product checkout): the
  organization object is built field-by-field
  (`ProductsService.getPublicProductBySlug`; prisma select
  { id, name, slug, businessProfile }) — **no primaryColor**.
- `GET /public/landing/:slug`: organization =
  { name, slug, metaPixelId, tikTokPixelId, returnPolicyText,
  deliveryPromiseText, supportPhone } — **no primaryColor**.
Both surfaces' CTAs ARE indigo-600-family today, so a `.btn-brand`
swap would have been resting-colour-equivalent — but with no
brand data in either payload and API edits out of this program's
scope, **both surfaces were SKIPPED** per the brief's rule (no
invented data). Unblocking them later needs one API field added
to each payload — a one-line change per endpoint, flagged for a
future API-touching batch.

## Feature inventory

`docs/design-eb3-feature-inventory.md` — every shop route,
layout chrome element and shared component from the BEFORE tree
(16 routes, 9 chrome elements, shared components) verified
present AFTER, with behaviour notes for the intentional changes
(v2-gated chrome on v2 shops; the global overlay queue; the
additive cart drawer; checkout v2 chrome). Zero features removed.

## Theme-gated vs global — summary

| Change | Scope |
|---|---|
| v2 theme tokens, header v2, bottom nav, footer v2, card v2, PDP buy bar/panel, filter drawer, cart drawer, checkout v2 | **v2 shops only** (stored themeId=v2 or ?themePreview=v2) |
| Overlay queue + bottom lift | **All themes** — behaviour only; visuals unchanged; with no bottom chrome present, overlay rendering is byte-identical |
| ExpressCheckout token polish | All themes — class values equal the previous hard-coded ones at the token defaults |
| Single checkout / landing CTAs | **Unchanged** (no payload brand data — ED9.4) |

## Screenshot QA

`docs/design-v2-screenshot-qa-checklist.md` — drafted, **all
boxes unchecked**; execution is post-deploy (control pass on a
classic shop + full pass on a v2 shop, 360/390/768/1440).

## Honest limits

- **No visual proof of anything**: no screenshot QA was possible
  in this sandbox (no seeded shop backend/browser pass); v2's
  correctness rests on the token/spec discipline, the byte-pins
  for legacy themes, type-checking and the green production
  build. The QA checklist above is the verification instrument
  and it is entirely unexecuted.
- The **preview is public and view-only**: `?themePreview=v2`
  changes nothing stored and requires no login (by design — a
  storefront is public); a merchant's customers could view the
  v2 rendering with the link before the merchant switches.
- **ISR 60s applies to v2 equally**: v2 pages use the same
  fetch-level `revalidate: 60` reads; a theme switch in settings
  can take up to ~60s to appear on cached storefront reads, the
  same bound EB2 recorded for price/stock edits.
- The layout's `headers()` read (preview plumbing) means shop
  pages render per-request with cached data rather than being
  full-route cached; the EB2 fetch cache is untouched, but the
  distinction is recorded here rather than smoothed over.
- Social-proof items can rotate unseen while queued behind a
  higher-priority overlay (their timers are unchanged); the item
  a shopper eventually sees may be mid-rotation.
- Checkout preview (`?themePreview=v2` on the checkout URL)
  applies after mount (client page); a stored-v2 shop is v2 from
  first paint of the loaded form.
- First Load JS grew slightly on shop routes (+1–4 kB) because
  v2 chrome ships in shared chunks — dormant on legacy shops.
- Nothing is deployed or live-proven; deploy still needs the
  owner's push instruction + Dokploy Redeploy, outside this batch.
