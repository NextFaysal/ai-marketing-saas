# Design Program — Consolidated QA Map (ED18 / EB7)

The E-Commerce Design & Experience Program (ED1–ED18) ships
**code-level proof only**: specs, byte-pins, type-checks and
production builds, all recorded in the per-batch acceptance docs.
Everything that needs a browser, a device, a screen reader or a
live shop executes **after deploy** (owner's push instruction +
Dokploy Redeploy), using the instruments indexed here. Every box
in every checklist below starts **unchecked** — nothing in this
map is verified until it is ticked against the live build.

## Run order after deploy

1. **Control pass first** — a shop still on a legacy theme +
   the dashboard in LIGHT mode: nothing may look different from
   before the design release. (Checklist 1, control section.)
2. **Shop v2 pass** — switch a test shop to themeId `v2` (or use
   `?themePreview=v2`) and run Checklist 1 in full.
3. **Responsive + accessibility pass** — Checklist 2 on the live
   dashboard (360px device/emulation + a screen-reader spot run).
4. **Dark-mode pass** — the new section below: dashboard dark +
   shop v2 under an OS-dark device.
5. **Performance pass** — the Lighthouse pack (below) against a
   real shop; record the scores next to the budgets.

## The instruments

### 1. Shop v2 screenshot QA — `docs/design-v2-screenshot-qa-checklist.md` (EB3)
48 boxes. Control pass on a classic shop (legacy themes must be
byte-for-byte the same experience), then the full v2 pass: header
v2 + search + drawer, mobile bottom nav, PDP sticky buy bar,
filter drawer, cart drawer, checkout v2 chrome + sticky pay bar,
overlay-queue behaviour (only one overlay at a time, lift above
the bottom chrome), ExpressCheckout polish. Widths 360 / 390 /
768 / 1440.

### 2. Responsive + accessibility — `docs/design-a11y-responsive-checklist.md` (EB6)
46 boxes. Section A: every EB6-converted commerce table renders
as cards with **no horizontal page scroll at 360px**, full column
+ action parity vs desktop. Section B (a11y): skip links,
focus-in + trap in kit dialogs, Escape behaviour, lang
announcement, contrast spot checks, ≥44px targets. Also carries
the NDR mobile-card field-parity re-check (the EB6 known
residual: five desktop-only fields).

### 3. Dark mode — NEW (ED17), this document
Executes on the live build. Dashboard: sign in, use the topbar
theme toggle (সিস্টেম → লাইট → ডার্ক). Shop: a v2 test shop on a
device/browser with OS dark mode ON (no in-shop toggle exists —
the v2 shop follows the visitor's OS by design).

#### Dashboard dark — shell + token surfaces
- [ ] Toggle cycles সিস্টেম → লাইট → ডার্ক → সিস্টেম; the choice survives a full page reload (localStorage `qosprey-theme`)
- [ ] With সিস্টেম selected and OS dark ON, the dashboard loads dark; with OS dark OFF it loads light
- [ ] Changing the OS theme while সিস্টেম is selected flips the dashboard without a reload
- [ ] No light flash longer than a frame on a cold dashboard load (hard refresh) in dark mode
- [ ] Sidebar (already dark in light mode) is unchanged in dark mode
- [ ] Topbar: translucent dark surface, readable title/breadcrumb, toggle + bell + avatar menu all legible; user menu panel is dark with readable items
- [ ] Mobile bottom nav is dark; active item indicator visible
- [ ] Cards, page titles and body text use the token surfaces — no white cards anywhere on the commerce hub, orders, products, POS pages
- [ ] Tables (kit ResponsiveTable + .table-wrap): dark header row, row borders visible, hover state visible but subtle
- [ ] Kit dialogs (confirm/prompt/modal/drawer), toasts and badges render dark and readable; the danger confirm reads as danger
- [ ] Form inputs: dark background, readable text + placeholder, focus ring visible
- [ ] Skeleton loaders shimmer subtly on dark (not bright white waves)

#### Dashboard dark — literal-class long tail (override layer)
- [ ] Orders list + order detail route: panels, chips and the action panel are dark; no glaring white blocks
- [ ] Storefront settings: section cards dark; the sticky sub-nav strip is dark
- [ ] Finance / reports / warehouse / inventory pages: the EB6 card lists are dark end-to-end
- [ ] Any page found with light blocks: record the page + a screenshot in the straggler list (docs/design-eb7-acceptance.md §coverage) for a follow-up sweep
- [ ] Semantic colours read correctly: success/warning/danger/info text and soft chips are legible on dark cards (not neon, not washed out)
- [ ] Gradient buttons (.btn-primary/.btn-success/.btn-warning) look unchanged vs light mode; labels readable
- [ ] The view-as / practice / platform banners at the top of the dashboard remain readable (amber/red/sky tones)

#### Shop v2 dark (OS-driven)
- [ ] On an OS-dark device, a v2 shop's home/PDP/listing render dark token surfaces; text contrast holds at a glance
- [ ] The merchant's brand colour still drives CTAs and prices in dark (brand seam untouched)
- [ ] MediaImage product photos sit naturally on the dark cards (no white image frames)
- [ ] The PDP sticky buy bar, bottom nav and cart drawer are dark; overlay queue surfaces (popup/install/push/social) are dark
- [ ] A legacy-theme shop (classic/bold/minimal) on the same OS-dark device renders LIGHT, unchanged — expected by design
- [ ] Checkout on the v2 shop in dark: form fields readable, sticky pay bar dark, place-order completes end to end

### 4. Performance — Lighthouse budget pack (ED18)
- Budgets: `apps/web/scripts/lighthouse-budgets.json` (Performance
  ≥ 0.90, LCP ≤ 2.5s, CLS ≤ 0.1, TBT ≤ 200ms as the lab proxy for
  INP ≤ 200ms, checkout interactive ≤ 3s; plus the plan's
  manual-only targets: first-viewport image payload ≤ 500KB,
  skeleton shell ≤ 300ms on dashboard navigation).
- Runner: `apps/web/scripts/lighthouse-budgets.mjs`
  ```
  node apps/web/scripts/lighthouse-budgets.mjs \
    --base https://app.qosprey.com \
    --org <a-real-shop-slug> --product <a-real-product-slug> \
    --listing-url "https://app.qosprey.com/shop/<slug>?category=<slug>" \
    --chrome-path <chrome-binary>
  ```
  Prints PASS/FAIL per budget, writes JSON reports to
  `./lighthouse-out`, exit 1 on any failure.
- [ ] Home run executed; scores recorded: Perf ___ LCP ___ CLS ___ TBT ___
- [ ] Listing run executed; scores recorded: Perf ___ LCP ___ CLS ___ TBT ___
- [ ] PDP run executed; scores recorded: Perf ___ LCP ___ CLS ___ TBT ___
- [ ] Checkout interactive checked (≤ 3s): ___
- [ ] First-viewport image payload on home + PDP ≤ 500KB: ___
- [ ] INP from field data (CrUX / web-vitals) reviewed once traffic exists: ___

## Where the code-level evidence lives

| Question | Document |
|---|---|
| What did each batch build + prove? | `docs/design-eb1..eb7-acceptance.md` |
| ED1–ED18 item-by-item verdicts + NOT BUILT register | `docs/design-program-summary.md` |
| Token reference (incl. dark values) | `docs/design-tokens-v3.md` |
| EB3 zero-feature-loss inventory | `docs/design-eb3-feature-inventory.md` |
| Dark-mode coverage inventory + stragglers | `docs/design-eb7-acceptance.md` |
