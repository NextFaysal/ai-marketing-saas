# E-Commerce Design & Experience Program — Summary (ED1–ED18)

Program close document (ED18 / EB7). Plan:
`Ecommerce-Design-Master-Plan-2026-10-16.md` (owner-approved in
full 2026-10-16, incl. decision D1 dark mode IN, dashboard-first;
D2 v2 default for new shops after QA; D3 lucide icons).
Worktree `~/workspace/ai-marketing-saas-design`, branch
`design-v3`, base = gc-stack release `17a2c27`. **Local commits
only — nothing pushed, nothing deployed.** Per-batch evidence:
`docs/design-eb1..eb7-acceptance.md`.

## ED1–ED18 audit table

| Item | Verdict | Batch | Evidence / note |
|---|---|---|---|
| ED1 Tokens v3 | **BUILT** | EB1 | One CSS-variable token layer (brand/surface/ink/semantic/type/space/radius/shadow/motion), Tailwind wired to the vars, merchant `primaryColor` seam closed — buy/checkout CTAs ride `.btn-brand`; defaults sampled from values in force (zero visual change for un-migrated pages). `docs/design-tokens-v3.md`. |
| ED2 @repo/ui consolidation | **BUILT** | EB1 (+EB5/EB6) | Kit: Button/Input/Select/Textarea/PageHeader/FilterBar/Tabs/Modal/Drawer/Toast/Confirm (promise)/EmptyState/StatChip/ResponsiveTable; EB5 added Prompt + Breadcrumb; EB6 added SkipLink + dialog focus trap. Providers mounted at the dashboard root. |
| ED3 Icon system | **BUILT** | EB1 + EB5 | lucide-react + semantic icon maps; emoji → 0 in nav.ts, dashboard layout, commerce hub, ShopHeader (EB1) and POS page-internal glyphs (EB5). |
| ED4 Image pipeline | **BUILT** | EB2 | Canonical `MediaImage` on the R2 CDN transform helper; raw `<img>` in the shop tree 20 → 0; dashboard product thumbs adopted; aspect/dims everywhere (CLS), lazy below fold, priority for LCP. |
| ED5 Shop caching + streaming | **PARTIAL** | EB2 | Built: public shop reads → 60s ISR, PDP fetches parallelised, 7 `loading.tsx` shells, ShopHeader cart/wishlist cache (30s TTL + event invalidation). Not built: dashboard Suspense boundaries (assessed — the pages are client components with no async server component to suspend; route shells cover the gap) and on-demand revalidation (needs API-side hooks, out of web-only scope). |
| ED6 Font + bundle diet | **PARTIAL** | EB2 | Built: font-display swap verified as already-emitted by Fontsource; metric-matched Bengali fallback measured from the real font files (fonttools); deferred overlay/lightbox/express islands (PDP First Load −5kB, cart −5kB). Not built: font preload (Fontsource hashed URLs can't be known at authoring time; the `next/font/local` path is documented) and the `/checkout/[slug]` + `/track` server-shell splits (assessed — no separable client island; a shell would ship empty). |
| ED7 Shop v2 theme + chrome | **BUILT** | EB3 | Opt-in `v2` themeId beside the byte-pinned legacy themes; `?themePreview=v2` view-only preview; header v2 (sticky, search always reachable, hamburger → Drawer), mobile bottom nav, footer v2, merchant picker + preview link. Existing shops byte-untouched until the merchant switches. |
| ED8 PDP + listing v2 | **BUILT** | EB3 | Sticky mobile buy bar (IntersectionObserver, yields to bottom chrome via the shared store), ProductCard v2, listing filter Drawer with the REAL filter set (category/brand/sort — none invented). Deviation on record: the card never had add-to-cart; its quick actions were and are QuickView + wishlist. |
| ED9 Checkout/cart v2 + overlay orchestration | **PARTIAL** | EB3 | Built: the GLOBAL overlay queue (popup 40 > install 30 > push 20 > social 10, one at a time + bottom lift), cart drawer, checkout v2 chrome (step headers, sticky mobile pay bar, inline errors where the flow already attributes them). Not built: ED9.4 — `.btn-brand` on single-product checkout + landing CTAs (see register #1). |
| ED10 Shop app shell | **BUILT** | EB4 | AB7 shop push worker EXTENDED (push handlers proven byte-identical, 1,144 chars): network-first navigations (30-entry page cache), transactional paths NEVER cached, statics + media cache-first, branded-offline fallback chain; manifest maskable claimed ONLY for the platform's purpose-built icon. Caveat in register #4. |
| ED11 Micro-interactions | **BUILT** | EB4 | RouteProgress (shop + dashboard), cart badge bump on strict increase only, token-timed rise entrances, skeleton-family consistency verified; all new motion sits under the pre-existing `prefers-reduced-motion` kill-switch. |
| ED12 Commerce IA + navigation | **BUILT** | EB5 | Commerce in the sidebar as 7 task groups (all 25 hub destinations reachable; POS in the sidebar for the first time), Breadcrumb on commerce sub-pages, URL state for orders (queue/status/search) + products (q/category), storefront settings 15 section anchors + sticky sub-nav, order detail as a REAL route `/dashboard/orders/[id]`. Sub-item not built: nav count badges (register #3). |
| ED13 Orders + POS + products | **PARTIAL** | EB5 | Built: orders decomposed by verbatim extraction (4,117 → 3,141 lines; handler parity 104 → union 109; apiFetch sites unchanged), POS sticky pay bar wired to the SAME `completeSale` handler, products on the kit with sticky save bar. Not built: per-field product-form errors (register #2). |
| ED14 Feedback + states | **BUILT** | EB5 | Native `confirm/prompt/alert` 45 → 0 across the commerce scope (+1 bonus site = 46 converted to useConfirm/usePrompt with danger + amount bodies on money actions); ~80 one-shot success notices → toasts (persistent-result notices stay inline, per-page reasons recorded); storefront's 3 silent catches → visible error + retry; kit EmptyState swaps where copy-identical. |
| ED15 Responsive sweep | **BUILT** | EB6 | 83 `overflow-x-auto` occurrences inventoried: 75 converted to ResponsiveTable card renders (76 tables), 2 verified pre-existing dual renders kept, 6 non-table strips left with named reasons; ~174 touch-target lifts to ≥44px; POS added to the mobile bottom nav. Residual: register #5. |
| ED16 Accessibility pass | **BUILT** | EB6 | SkipLink (dashboard + shop), subtree `lang` matrix (root html lang deliberately unchanged — reasoning in code), kit dialog focus-in + Tab trap + focus return (spec'd), contrast floor slate-500 for small data text (194 page instances + kit level), ~67 Bengali aria-labels, 25 product-form label associations. Limit: register #6. |
| ED17 Dark mode | **BUILT** | EB7 | Dashboard: class strategy on the token layer + a frequency-ranked literal-class override layer + topbar toggle (সিস্টেম/লাইট/ডার্ক, localStorage, system default, live OS following); contrast computed ≥4.5:1 for every text token on both working surfaces. Shop v2: OS-driven via `prefers-color-scheme` on `[data-shop-theme="v2"]`. Coverage is inventoried honestly in the EB7 acceptance — token surfaces full, literal long tail mapped by frequency with named stragglers. |
| ED18 Verification & QA | **BUILT (deliverables)** | EB7 | Consolidated QA map (`docs/design-program-qa-map.md`: EB3's 48 + EB6's 46 checklist boxes + a new dark-mode section + score lines), Lighthouse budget pack (`apps/web/scripts/lighthouse-budgets.{json,mjs}`). Execution is post-deploy BY DESIGN: **no Lighthouse scores exist** — the sandbox has a fetchable CLI (13.5.0) + Chromium but no seeded shop backend to measure; no screenshot QA exists anywhere in the program. |

## Gate rollup — program start → program close

| Gate | Baseline (17a2c27) | Final (EB7 close) |
|---|---|---|
| Web vitest | 703 passed / 82 files | **797 passed / 97 files** |
| Web tsc (`tsc --noEmit`) | 0 errors | **0 errors** |
| Builds (ui / contracts / db / worker / api / admin / web) | 7/7 exit 0 | **7/7 exit 0** (per-project, exit-code verified) |
| API / prisma files changed | — | **0** |
| Migrations | — | **0** |

## NOT BUILT / limits register (program-wide, on record)

1. **ED9.4 single-checkout + landing brand CTAs** — the
   `/public/checkout/:slug` and `/public/landing/:slug` payloads
   carry no `primaryColor`, and API edits were out of scope.
   Unblock: add the one field to each endpoint, then swap the two
   CTAs to `.btn-brand` (resting colour already matches).
2. **Per-field product-form errors** — blocked on the API error
   shape: `apiFetch` surfaces only `Error(message)`; no
   field-keyed detail exists to wire. The page banner stays.
3. **Nav count badges** — not shipped: no honest client-fetched
   count source exists in the shell's data flow; none invented.
4. **Shop worker eager registration — OPEN OWNER DECISION**
   (from EB4): the ED10 app shell activates only for shoppers
   who subscribe to push (the AB7 registration posture).
   Registering on every shop visit would extend the shell to
   everyone but changes that consent posture; not decided here.
5. **NDR mobile-card field gap** — five desktop-only fields
   (`createdAt`, `customerFeedback`, `notes`,
   `rescheduleDate`, `lastContactedAt`) are still omitted from
   the NDR mobile cards (pre-existing dual render, kept
   byte-intact under EB6's verify-don't-redo); the parity fix is
   a separate decision; the EB6 checklist carries a re-check box.
6. **Nested kit dialogs** — each open dialog keeps its own
   keydown listener, so Escape reaches a Confirm opened over a
   page Modal AND the Modal beneath (no stacking manager);
   pre-existing behaviour, recorded in EB6.
7. **ISR staleness bound** — merchant price/stock/content edits
   can take ~60s to appear on the storefront (EB2); header
   badges ≤30s stale across soft navigations (TTL; cart +
   guest-wishlist paths are event-invalidated).
8. **Font preload** — undone by design (EB2); the documented
   path is migrating Hind Siliguri to `next/font/local` so Next
   emits the hashed preload itself.
9. **ED17 stragglers** — literal classes outside the mapped
   patterns (coloured tint chips beyond `.badge-*`, `bg-slate-900`
   literals, arbitrary hex classes) keep light colours in dark
   mode; the dashboard's early-return surfaces (loading spinner,
   verification wall) render light; the **admin app has no dark
   mode** (separate app — ADX/ADNX); legacy shop themes never
   flip dark (by design).
10. **MediaImage behaviour notes** (EB2) — the dropped onError
    fallback (server-safe contract) and standardized aspect
    boxes on previously dimension-less surfaces (off-ratio
    images crop via object-cover) await the screenshot pass.
11. **Nothing is live-proven.** No deploy, no screenshot QA, no
    Lighthouse scores, no screen-reader or device run exists for
    ANY batch of this program. Code-level proof only, throughout.

## Release notes — what design-v3 contains

- **Composition:** base `17a2c27` (gc-stack release) + **92
  commits** (incl. this summary); **155 files** changed — all
  under `apps/web`, `packages/ui`, `docs/`, plus
  `pnpm-lock.yaml` (lucide-react + the web test stack). **Zero
  migrations, zero API/contract/db/worker/admin changes** — the
  deploy carries no data risk; it is a web build swap.
- **What ships dark:** nothing changes visually for any user
  until (a) a dashboard user picks ডার্ক (or their OS is dark
  under the default সিস্টেম), (b) a merchant switches their shop
  to the v2 theme, or (c) a v2 shop is visited from an OS-dark
  device. Legacy shops and light-mode dashboards are the control
  case of the QA map.
- **Remote state at close (checked read-only during EB7,
  2026-10-16):** GitHub `main` was still `17a2c27` — this branch
  would fast-forward cleanly as of that check. **It MUST be
  re-checked at release time** (other lines — MX, TD, SN — are
  in flight): if main has moved, do a union integration and
  re-run the full gate set before pushing; never force-push.
- **Release sequence:** owner's explicit push instruction
  (standing rule) → push → owner's manual Dokploy Redeploy →
  execute `docs/design-program-qa-map.md` in its stated order →
  only after the v2 pass, the D2 decision (v2 as the default
  theme for NEW shops) takes effect.
- **Owner decisions still open after this program:** #4 above
  (shop worker eager registration) and D2's post-QA confirmation.
