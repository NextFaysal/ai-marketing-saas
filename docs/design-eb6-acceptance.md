# EB6 Acceptance — ED15 Responsive Sweep · ED16 Accessibility Pass

Batch 6 of 7 of the E-Commerce Design & Experience Program
(plan: `Ecommerce-Design-Master-Plan-2026-10-16.md`). Worktree
`~/workspace/ai-marketing-saas-design`, branch `design-v3`, base = EB5
HEAD `a04e5a7c`. **Local commits only — no push.** WEB-ONLY: zero
API/schema/prisma files touched, zero migrations.

## Gates — baseline vs final

Baseline measured personally by the coordinator on the untouched base;
finals re-run personally, SERIALLY, on the settled tree, all with
`TMPDIR` on the workspace disk.

| Gate | Baseline (a04e5a7c) | Final (EB6) |
|---|---|---|
| Web vitest | 783 passed / 94 files | **788 passed / 96 files** (+3 ui-eb6 trap/skip specs, +2 ui-eb6-layouts dict pins) |
| Web tsc (`tsc --noEmit`) | 0 errors | **0 errors** |
| @repo/ui build | exit 0 | **exit 0** |
| @repo/contracts build | — | **exit 0** |
| @repo/db build | — | **exit 0** |
| @repo/worker build | — | **exit 0** |
| @repo/api build | — | **exit 0** |
| @repo/admin build | — | **exit 0** |
| @repo/web build | exit 0 (EB5, per-project) | **exit 0** (route table printed) |

## Process incident (recorded plainly)

Mid-batch the branch was reset to `a04e5a7c` by a concurrent process
(reflog `reset: moving to a04e5a7c`). Three builders re-committed their
work onto the new history themselves and verified ancestry. The kit
commits and three selling-cluster pages (abandoned / affiliates /
bundles) were orphaned by the reset; their content survived
byte-intact as working-tree modifications. The coordinator recovered
them as five commits (`229491ea` kit, `b61ad4c4` specs, `74c08d9e`
abandoned, `dd77ff22` affiliates, `f611b801` bundles) after verifying
the diffs against the builders' reports and structural greps (trap
present in client.tsx, SkipLink in index.tsx, ResponsiveTable in all
three pages). Final EB6 commit count: **39 work commits + this docs
commit**. Every builder's file set was cross-checked against HEAD
before gates ran; the settled tree is clean.

## ED15 — Responsive sweep

**Before-inventory (coordinator grep, EB6 scope = commerce/** +
orders/** + customers + products + pos): 83 `overflow-x-auto`
occurrences across 32 files.** Orders/products main tables were
already dual-rendered by EB5 and were verified, not redone.

**Outcome: 75 occurrences converted to the kit `ResponsiveTable`
(76 tables — customers' per-courier table had no wrapper and was
converted anyway), 2 verified pre-existing dual renders left intact,
6 non-table occurrences left with named reasons. ZERO wide-matrix
keep-scroll exceptions were taken.**

| Cluster | Files | Occurrences | Converted | Left (named) |
|---|---|---|---|---|
| Money (finance 9, accounting 4, reports 7, commerce-recon 2, orders-recon 3) | 5 | 25 | 24 | 1 — orders-recon segmented **tab strip** (non-table flex chip row) |
| Ops (warehouse 5, inventory-intel 7, dispatch 3, purchasing 4, subscriptions 1, installments 2, sync 3, feeds 1) | 8 | 26 | 26 | — |
| Selling (abandoned 1, affiliates 2, bundles 1, discounts 1, gift-cards 1, landings 2, promotions 3, quotes 1, hub 2, customers 3, storefront 1) | 11 | 18 | 17 (+1 unwrapped table) | 1 — storefront's only occurrence is the sticky in-page **section sub-nav strip**; the page has no table |
| Orders residuals (orders/page 3, ndr 2, on12 1, on9 3, CourierHubModal 1, OrderActionPanel 1, OrderDrawer 2, OrdersFilterBar 1) | 8 | 14 | 8 | 2 verified pre-existing dual renders (orders main list, NDR incidents) + 4 non-table strips (queue rail, NDR status tabs, drawer tab row, filter segmented strip) |

Conversion discipline (all clusters): the desktop table node is
passed **unchanged** (columns, order, markup) as ResponsiveTable's
`table` prop — ≥md rendering is the pre-EB6 table by construction;
the mobile card shows **every column** (label + value, same
formatting/badges) and the **full row action set with the same
handlers**, via shared row-action renderers copied from the EB5
products discipline (`renderProductActions` pattern). One style
deviation, recorded: the selling cluster *removed* the overflow
wrapper from the desktop node instead of keeping it inside the
`table` prop; structurally equivalent (ResponsiveTable's
`hidden md:block` branch + the global ≤820px table-scroll CSS rule
cover the intermediate widths), noted here for the record.

After-state structural proof (coordinator grep on the final tree):
the only scope files still containing `overflow-x-auto` with **no**
ResponsiveTable are exactly the three documented cases —
`commerce/storefront` (sub-nav strip), `orders/ndr` (tab strip +
verified dual render), `orders/components/OrdersFilterBar` (tab
strip). Every other occurrence now sits inside a ResponsiveTable
desktop branch or was removed with the wrapper. The coordinator
also corrected one builder headline by direct count: orders-cluster
conversions are **8**, not 7 (on9-analytics carries 3 ResponsiveTable
usages, grep-verified) — the per-file detail was right, the summary
sum was wrong.

**Touch targets (≥44px hit areas, glyph size unchanged):** ~174
sites across the touched pages — money ~17 (tab chips, expense/
batch/claim actions, modal closes), ops 66 (warehouse 21, sync 14,
purchasing 10, dispatch 8, feeds 6, subscriptions 3, installments 3,
inventory-intel 1), selling 72 (storefront chips/card actions 16,
landings 12, bundles 8, promotions 8, abandoned 6, affiliates 5,
discounts 5, quotes 5, customers 5, gift-cards pagination 2), orders
19 templates (queue rail, tabs, closes, card actions, shared collect
button). Counting granularity differs per builder (templates vs
elements); the per-cluster numbers above are as reported.

**Mobile nav finding (ED15.3):** the dashboard's mobile bottom nav
already carried **অর্ডার as a direct shortcut** (M60: হোম / ইনবক্স /
অর্ডার / ক্যাম্পেইন + মেনু), and the মেনু drawer renders the full
NavContent — so EB5's commerce sections were already reachable there.
EB6 added **POS** as the fifth link (`{ label: "POS", href:
"/dashboard/pos", icon: "pos" }`, the `pos: Receipt` icon already
existed), grid `grid-cols-5` → `grid-cols-6`, nothing removed,
মেনু stays last.

## ED16 — Accessibility pass

**Skip links.** New kit `SkipLink` (server entry of @repo/ui,
`<a className="skip-link">`) + a token-driven `.skip-link` class in
globals.css (sr-only until focus → visible pill, brand ring,
shadow-pop). Dashboard layout renders it as the **first focusable
element** (href `#main-content`; `<main id="main-content"
tabIndex={-1}>`); shop layout likewise (href `#shop-main`, text from
the new `common.skipToContent` dict key — bn "মূল কন্টেন্টে যান" /
en "Skip to main content", parity pinned by spec).

**Language matrix — exactly what a screen reader gets:**

| Surface | Document `<html lang>` | Content lang in force | Why |
|---|---|---|---|
| Dashboard | `en` (unchanged) | **`bn`** — the dashboard layout's root div carries `lang="bn"` | Dashboard UI is Bengali-first; AT applies the nearest ancestor lang to all content beneath the div |
| Shop, org locale bn | `en` (unchanged) | **`bn`** — shop root div `lang={locale}` | Locale comes from the org payload (`shopLocaleOf`), as before |
| Shop, org locale en | `en` (unchanged) | **`en`** — shop root div `lang={locale}` | Same mechanism |

The root `<html lang>` was **deliberately not made per-route**:
reading `headers()` in the root layout to detect the route would
force dynamic rendering app-wide and break EB2's shop ISR;
subtree lang attributes are the correct declaration point and are
what screen readers apply. The reasoning is encoded in a code
comment in `app/dashboard/layout.tsx`.

**Focus management.** Verified before building: the kit's
`useDialogChrome` already returned focus on close and closed on
Escape, but did **not** move focus in or trap Tab. EB6 extended the
shared hook with a per-dialog container getter (all four surfaces —
Modal, Drawer, ConfirmProvider, PromptProvider — pass a callback-ref
to their own `[role="dialog"]` element; every page using kit
Modal/Drawer inherits it automatically):
- On open, focus moves to the first focusable descendant (or the
  container itself, `tabIndex={-1}`) — **unless** focus is already
  inside (PromptProvider's `autoFocus` input is respected, not
  stolen).
- Tab / Shift+Tab cycle within the dialog's focusables
  (`a[href]`, enabled button/input/select/textarea, `[tabindex]`
  ≠ -1); wrapping calls preventDefault. Zero focusables → Tab is
  swallowed and focus is (re)set to the container. Focus found
  outside (programmatic blur) → next Tab pulls it back in.
- Specs (`lib/ui-eb6.test.tsx`): Modal focus-in, Tab last→first,
  Shift+Tab first→last, Escape → onClose, focus returns to the
  pre-open trigger; Drawer focus-in; SkipLink render.
- The dashboard's hand-rolled mobile drawer gained Escape-to-close
  (active only while open); the shop listing filter drawer and shop
  drawers ride the kit Drawer and inherit Esc + trap.

**Contrast (slate-400 → slate-500 floor for small data text;
slate-500 on white = 4.76:1).** Kit level: KpiCard hint, StatChip
hint, Input/Select/Textarea hints, Toast dismiss button; globals.css
`.stat-hint` + `.setting-row-help`. Page level on ED15-touched pages:
**194** meta/label instances (orders cluster 63, selling 80, ops 41,
money 10). Deliberately left, per the stated rule: `placeholder:`
variants, disabled/decorative text, `text-sm` loading/empty lines,
and `text-[10px]` instances (5, listed in the orders builder's
report) — the rule covered 11/12px data-carrying meta only. Badge
tones needed no change (already ≥ slate-600 text, verified in the
kit source).

**aria + labels.** ~67 Bengali `aria-label` additions on icon-only
buttons across the clusters (orders 6, ops 42, selling 14 + products
3, money 2 — closes, clear-search ✕, copy/approve icon buttons…).
Label association: products create/edit form — **25 `htmlFor`
associations covering 26 controls** + 3 aria-labels (tag/wholesale
inputs); orders/POS — 8 aria-label associations (OrdersFilterBar
search, NDR search, POS search, OrderActionPanel collect form ×4,
OrderDrawer collect amount ×1). The orders page's own 8 filter
inputs were verified to already carry aria-labels (0 added there).

## Deviations + honest limits

- **NDR mobile-card field gap (pre-existing, NOT fixed):** the NDR
  page's pre-EB6 hand-rolled mobile cards omit five desktop-only
  fields (`createdAt`, `customerFeedback`, `notes`,
  `rescheduleDate`, `lastContactedAt`). It was a verified
  pre-existing dual render and was kept byte-intact under
  verify-don't-redo; the parity fix is a separate decision. The
  post-deploy checklist carries a re-check box for it.
- **Nested kit dialogs are not stacking-managed:** each open dialog
  keeps its own document keydown listener (the pre-existing Escape
  behaviour), so a Confirm opened over a page Modal traps within
  itself but Escape reaches both listeners — unchanged from before
  EB6, recorded as a limit, not silently "fixed".
- Early-return surfaces in the dashboard layout (the `!ready`
  spinner / verification wall) render before the main shell and did
  not receive a skip link.
- **Contrast/aria/responsive correctness is code-level proof only**
  (class changes, structural dual-render, jsdom specs). No
  screen-reader run, no device run, no screenshot exists — that
  proof is post-deploy work, enumerated in
  `docs/design-a11y-responsive-checklist.md` (all boxes unchecked).
- Nothing is live-proven; deploy still needs the owner's push
  instruction + Dokploy Redeploy, outside this batch.
