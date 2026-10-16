# EB2 Acceptance — ED4 Image Pipeline + ED5 Shop Caching/Streaming + ED6 Font & Bundle Diet

Batch 2 of 7 of the E-Commerce Design & Experience Program
(plan: `Ecommerce-Design-Master-Plan-2026-10-16.md`). Worktree
`~/workspace/ai-marketing-saas-design`, branch `design-v3`, base =
EB1 head `53d42fac`. **Local commits only — no push.** Web-only:
`git diff 53d42fac..HEAD` touches 40 files, **all under apps/web**
(0 files in apps/api, packages/db, packages/contracts, apps/admin,
apps/worker); **zero migrations**.

Commits (oldest → newest):
- `8d003a91` ED5 cache policy — public server reads revalidate 60s
- `8fc2ea9e` ED5 PDP parallel reads + streaming loading shells
- `dd4f0d39` ED6 font discipline — metric-matched local fallback
- `c7f3c60b` ED5 shop header cache + logo via MediaImage
- `59b6ef8d` ED4 MediaImage component + tests (cdnWidthFor)
- `94df0772` ED6 bundle islands — deferred overlays, PDP lightbox
- `51390d1d` ED4 shop image adoption + cart ExpressCheckout dynamic
- `57707bf8` ED4 dashboard product thumbs
- `11316c4f` ED6 media swaps — PDP/landing/checkout/track

## Gates — baseline vs final (coordinator-run, exit-code checked)

| Gate | Baseline (53d42fac) | Final (EB2) |
|---|---|---|
| Web vitest | 715 passed / 83 files | **733 passed / 85 files** (+10 MediaImage specs, +4 header-cache specs, +4 cdn-image width-step specs) |
| Web tsc (`tsc --noEmit`) | 0 errors | **0 errors** |
| `pnpm -r build` (7 projects, production `next build`) | exit 0 | **exit 0** |
| API / prisma / migrations | — | untouched (0 files), zero migrations |

## ED4 — Image pipeline

**The R2 helper exists in this tree** (the EB1 audit's "missing"
finding was gc-tree-only): `lib/cdn-image.ts` — `cdn-cgi/image`
transformation URLs on the media CDN host (`media.qosprey.com`,
`NEXT_PUBLIC_MEDIA_CDN_BASE_URL` override), widths [320, 640, 960,
1280], non-CDN srcs passed through untouched. EB2 added
`cdnWidthFor(request)` (largest preset step ≥ request, clamped to
the largest step) with specs.

**MediaImage contract** (`components/MediaImage.tsx`, canonical;
the R2-era `components/media-image.tsx` is now a re-export shim —
exactly one component, one URL system):
- Props: `src` (string), `alt`, `width?`, `height?`, `aspectRatio?`
  (wins over the width/height-derived ratio), `sizes?` (defaults to
  the declared width in px, else `100vw`), `priority?`, `className`
  + `imgClassName` (both applied to the `<img>` — there is no
  wrapper element), `style?`, `onClick?`.
- CDN src → `src` = transformation URL at the step for the
  requested width, `srcSet` = all four steps; any other src
  (external, API-relative, data:/blob:) → plain `<img>`, no srcset —
  `/cdn-cgi/image/` exists only on the media zone.
- CLS guard: width/height attributes **and** an aspect-ratio style.
- Loading: `lazy` + `decoding="async"` by default; `priority` →
  eager + `fetchPriority="high"`. Server-component-safe (no hooks).
- Callers with a possibly-null src keep their existing conditional
  render / placeholder (the shop's established pattern) and render
  MediaImage only with a real URL.

**Adoption** (every usage carries real dims or an aspect box):
ProductCard (already on the R2 component — import moved to the
canonical path), BundleCard, QuickView, PageBlocks image blocks,
ShopPopup, blog list covers (4/3) + blog post cover (16/9) and body
blocks, brand page logo, cart line thumbs, account wishlist thumbs,
shop 404 logo, shop header logo (ED5), PDP main gallery + thumbs +
video poster + lightbox (ED6), landing upsell/bump/hero/gallery
(ED6), single-checkout product image (ED6), track page shop logo
(ED6). Dashboard (limited scope, as briefed): products list thumb
+ brand-manager logo (`dashboard/products/page.tsx`),
`ec-product-dialogs` gallery import moved to the canonical path.
The dashboard's full media pass remains a later-batch surface.

**Raw `<img>` proof** (grep over `app/shop`, `app/checkout`,
`app/track`, `app/l`): **20 → 0 JSX usages**. The single remaining
`<img` string in the tree is a comment in `ProductLightbox.tsx`
explaining the swap. Justified non-adoptions: none in the shop
tree. (Surfaces outside the audited trees — dashboard internals
beyond products, admin — were not in this batch's scope.)

## ED5 — Caching + streaming

**Fetch classification** (`lib/storefront-server.ts`): `serverGet`
gained an explicit class parameter — `"public"` →
`{ next: { revalidate: 60 } }`, `"private"` → `{ cache: "no-store" }`
— passed explicitly at every call site; React `cache()` dedupe
untouched. Verified by grep: cart/account/orders/track reads never
pass through this file (they are client-side `/backend` fetches in
`lib/storefront-cart.ts` / `lib/storefront-account.ts`), so the
file has no private exports today; the `"private"` class exists so
a future export cannot silently inherit the public default.

| Export | Class |
|---|---|
| fetchShopHome (all variants incl. search/category/brand/ids) | public |
| fetchShopBrand, fetchShopPage | public |
| fetchShopBlog, fetchShopBlogPost | public |
| fetchProductDetail, fetchProductReviewsSummary | public |
| fetchAllProductSlugs / fetchAllProductSitemapEntries (derived via fetchShopHome) | public |
| fetchLandingMeta (`lib/landing-server.ts` — same revalidate applied to its own fetch) | public |

**PDP waterfall**: the page body now starts detail ∥ reviews
summary in one `Promise.all` (previously detail → conditional home
→ reviews sequentially). Semantics preserved exactly: null detail
→ `notFound()`; reviews failure → null → JSON-LD omits the rating;
the flash-sale home fetch stays conditional on
`detail.product.flashSale`; `generateMetadata` untouched.

**Streaming shells** — 7 new `loading.tsx`, all server components,
skeleton-only (globals `.skeleton`, sr-only "লোড হচ্ছে…" label, no
page-logic imports): shop root (strip + hero + 8-card grid), PDP
segment (gallery box + thumbs + buy-panel lines — kept separate
from the shop shell so the arriving page doesn't shift layout),
dashboard root, commerce (stat grid + rows), orders (filter bar +
8 table rows), products (thumb rows), POS (tile grid + cart
panel).

**ShopHeader fetch trim** (`lib/shop-header-cache.ts`, +4 specs):
module-level per-org cache for the header's cart count and wishlist
state, TTL 30s. Invalidation is event-driven where the codebase
has events: `CART_UPDATED_EVENT` (cart), `GUEST_WISHLIST_EVENT` +
`SHOP_SESSION_EVENT` (wishlist), cross-tab `storage` for both —
the header's previous live-update behaviour is preserved.
Account-wishlist mutations dispatch no event anywhere in the
codebase, so that one path is TTL-only — and it is **not a
regression**: the header never live-updated on account-wishlist
toggles before EB2 either. Count semantics unchanged; the honest
bound is ≤30s staleness across soft navigations inside the TTL.

**Dashboard Suspense — skipped, documented**: the commerce hub
and orders pages are client components whose data loads page-level
in `useState`/`useEffect`; there is no async server component to
suspend, so wrapping would stream nothing. Route `loading.tsx`
covers the perception gap; no data-flow refactor was attempted.

## ED6 — Font + bundle diet

**Fonts**:
- `font-display: swap` — **already emitted by Fontsource** for
  every face (verified in the shipped package CSS for Hind
  Siliguri 400 bengali/latin-ext/latin and Inter Variable). No
  change needed; evidence recorded so nobody "fixes" it again.
- Weights: all four Hind Siliguri weights are genuinely used
  (grep: `font-medium` ×907/139 files, `font-semibold` ×2,489/177,
  `font-bold` ×1,258/134, plus CSS `font-weight` 600/700) — **none
  dropped**.
- Preload — **not added, with the reason**: Fontsource files are
  served under build-hashed `/_next/static/media/…` names that
  cannot be known at authoring time; copying a file to a stable
  public path would need a duplicate `@font-face` racing
  Fontsource's own family/weight/unicode-range faces. Inter was
  not preloaded instead — in this Bengali-first UI the LCP text
  renders in Hind Siliguri. **ED18/deploy recommendation**: load
  Hind Siliguri via `next/font/local` from the Fontsource woff2
  files so Next emits the correct hashed preload itself.
- Metric-matched fallback — **added** (`globals.css`):
  `@font-face "Hind Siliguri Fallback"` over
  `local("Arial")` / `local("Noto Sans Bengali")` /
  `local("Liberation Sans")`, wired into the body stack after
  "Hind Siliguri". Metrics were **measured from the actual font
  files with fonttools** (Hind Siliguri 400: upem 1000, hhea
  ascent 1116 → `ascent-override: 111.6%`, descent −501 →
  `50.1%`, lineGap 0; `size-adjust: 95.6%` = x-height ratio
  505/1000 ÷ Liberation Sans 1082/2048). No invented numbers.

**Bundle islands** (next/dynamic):
| Target | ssr | Why safe |
|---|---|---|
| ShopPopup + ShopSocialProof via new `ShopDeferredOverlays` client wrapper (server layouts can't use ssr:false) | false | both render null until their fetch/trigger fires — SSR output was already empty; same mount position, props, trigger/frequency logic |
| PDP lightbox → extracted `ProductLightbox.tsx` | false | opens only on gallery click; keyboard listener moved with it, same mount window; click stopPropagation preserved via wrapping span |
| PDP ExpressCheckout | false | renders null until an effect sets session presence — SSR output was already empty; props unchanged |
| Cart ExpressCheckout (ED4, in cart/page.tsx) | default (SSR) | same props; pulse fallback while the chunk loads |
| Landing `FaqBlock` → extracted sibling (verbatim) | default (SSR) | below-fold but meaningful content — SSR markup kept, only the chunk splits |
| Landing `ReviewsBlock` (`@/components/product-reviews`) | default (SSR) | same reasoning; type imports kept static |

**Server-shell splits for `/checkout/[slug]` + `/track/[orgSlug]`
— assessed and NOT done**: both are single `"use client"` pages
with no separable client component to wrap, and all header/product
markup derives from client-fetched state; a server wrapper would
ship an empty shell, gain no First Load reduction, and add
logic-drift risk. **Landing full section split — NOT done**:
`renderSection` sections close over shared order/checkout state
in one monolithic component; only the self-contained FaqBlock /
ReviewsBlock could be extracted mechanically. `next.config.mjs`:
no change needed.

## First Load JS — baseline vs after (real `next build` output)

| Route | Baseline | After | Δ |
|---|---|---|---|
| Shared by all | 103 kB | 103 kB | 0 |
| `/shop/[orgSlug]` (home) | 143 | 144 | +1 |
| `/shop/[orgSlug]/products/[productSlug]` (PDP) | 154 | **149** | **−5** |
| `/shop/[orgSlug]/brands/[brandSlug]` | 140 | 140 | 0 |
| `/shop/[orgSlug]/blog` | 106 | 106 | 0 |
| `/shop/[orgSlug]/blog/[postSlug]` | 114 | 114 | 0 |
| `/shop/[orgSlug]/cart` | 149 | **144** | **−5** |
| `/shop/[orgSlug]/checkout` | 154 | 154 | 0 |
| `/shop/[orgSlug]/account` | 150 | 150 | 0 |
| `/shop/[orgSlug]/success` | 146 | 146 | 0 |
| `/track/[orgSlug]` | 140 | 140 | 0 |
| `/l/[slug]` (landing) | 119 | 119 | 0 |
| `/checkout/[slug]` (single) | 132 | 133 | +1 |

Read honestly: the First Load wins are concentrated where chunks
were actually deferred (PDP −5, cart −5). Several routes are flat
or +1 (MediaImage + dynamic wrappers cost a little in the page
chunk). The batch's larger performance effects do **not** show in
this table at all: image payloads (full-resolution originals →
width-stepped CDN variants with srcset), the 60s fetch cache
removing repeat API round-trips, parallel PDP reads, and route
skeletons improving perceived load. Those are measured by ED18's
Lighthouse pass after deploy, not by bundle arithmetic.

## Process note (verification discipline)

The first ED4 dispatch returned a complete-looking report whose
commits and files **did not exist** in the worktree (verified by
`git log`, `cat-file`, and filesystem search). It was rejected;
the work was re-dispatched. The second dispatch then found the
first agent had in fact resumed and was landing the real work
(identical scope), and correctly stopped with zero edits rather
than clobber a sibling's uncommitted files. Every number and file
in this acceptance was verified by the coordinator directly
against the tree (`git log`, greps, full gates) — not transcribed
from builder reports.

## Honest limits

- **ISR staleness is product-visible**: with `revalidate: 60`, a
  merchant's price/stock/content edit can take up to ~60s to
  appear on the storefront. There is **no on-demand revalidation**
  (it needs API-side hooks — out of this program's web-only
  scope).
- Header badges can be ≤30s stale across soft navigations (TTL);
  event invalidation covers the cart and guest-wishlist paths.
- **No Lighthouse run**: a Chromium binary exists in the sandbox
  but there is no `lighthouse` CLI and no seeded shop backend
  (API + DB) to serve — so no scores are claimed. Real Lighthouse
  QA is ED18, post-deploy, per the plan.
- **No live proof, no screenshot/visual QA** — nothing in EB2 is
  deployed; behaviour preservation rests on the preserved-semantics
  notes above, the specs, and the green production build.
- Font preload remains undone by design (above) with the
  `next/font/local` path documented for ED18.
