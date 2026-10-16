# EB5 Acceptance — ED12 Commerce IA + Navigation · ED13 Orders/POS/Products · ED14 Feedback & States

Batch 5 of 7 of the E-Commerce Design & Experience Program
(plan: `Ecommerce-Design-Master-Plan-2026-10-16.md`). Worktree
`~/workspace/ai-marketing-saas-design`, branch `design-v3`, base = EB4
HEAD `3d4c4c7d`. **Local commits only — no push.** WEB-ONLY: zero
API/schema/prisma files touched, zero migrations.

Commits (oldest → newest):
- `a59807cf` wave 1 — Breadcrumb + PromptDialog kit, commerce nav sections, commerce breadcrumb layout
- `9753219c` orders — detail as a route + URL-driven list state (ED12)
- `ee696328` POS v2 — sticky pay bar, lucide icons, prompt/toast (ED13/ED14)
- `10bd9152` storefront settings — section anchors + sub-nav, visible load errors, confirm/toast (ED12/ED14)
- `30b31821` products — kit list, sticky save bar, confirm/toast, URL filters (ED12/ED13/ED14)
- `80fa1d50` ED14 sweep — native dialogs → Confirm/Prompt/Toast across 13 commerce/customers/orders files
- `39f2a766` orders decomposition — panels extracted; dialogs + toast (ED13/ED14)
- `9519fb42` orders extraction smoke specs + vitest `@` alias
- `8c242fbe` smoke spec setter typing fix
- `aba2d24a` PromptDialog input typing fix for @repo/ui no-DOM-lib tsc

## Gates — baseline vs final

Baseline measured personally by the coordinator on the untouched base:

| Gate | Baseline (3d4c4c7d) | Final (EB5) |
|---|---|---|
| Web vitest | 769 passed / 91 files | **783 passed / 94 files** (+6 nav-structure, +3 prompt/breadcrumb, +5 extraction smoke) |
| Web tsc (`tsc --noEmit`) | 0 errors | **0 errors** |
| @repo/ui build (`tsc --noEmit`) | exit 0 | **exit 0** (after the PromptDialog cast fix below) |
| `pnpm -r build` | exit 0 | see build note |
| API / prisma / migrations | — | **untouched; zero migrations** |

**Build note (stated plainly):** the first full `-r build` attempt
failed on ONE error — `packages/ui/src/client.tsx` TS2812 in the new
PromptDialog (`e.target.value` under the package's no-DOM-lib
tsconfig); fixed with the file's established structural-cast
discipline (`aba2d24a`), after which the ui package build is exit 0.
Subsequent single-invocation `-r build` runs were killed three times
by sandbox runtime restarts mid-run (each time after
ui/worker/contracts/db had printed `Done`), so the final build gate
was completed **per project**, every exit code observed: ui 0,
contracts/db/worker `Done` in the -r runs, admin 0 (foreground run,
route table printed), api 0 (`tsc -p tsconfig.build.json`), web 0
(`WEB_EXIT:0`; the route table lists the new
`ƒ /dashboard/orders/[id]` at 2.16 kB). No project was left unverified.
Web tsc 0 was measured before the type-only cast; the cast erases at
runtime (vitest behaviour unchanged) and both post-cast type gates
(ui build + web production build, which type-checks) are exit 0.
Sandbox note: `/tmp` is a 512 MB tmpfs that filled repeatedly during
the batch (ENOSPC in vitest collectors) — all final gates ran with
`TMPDIR` on the workspace disk.

## ED12 — IA, navigation, deep-linking

**Sidebar.** `lib/nav.ts` gains `COMMERCE_NAV_ITEMS` (27 items) +
`COMMERCE_NAV_SECTIONS` (7 task groups: বিক্রি / ক্যাটালগ / গ্রাহক /
অপারেশন / বৃদ্ধি / টাকা / দোকান). The dashboard layout's GROUPS now
renders each section as its own collapsible group via the existing
mechanism; item lookup merges both item lists. New lucide keys were
added to `NAV_ICONS` additively (values reuse the EB1 commerce icon
components).

**Nav coverage inventory** (spec-pinned in
`lib/nav-commerce.test.ts`, 6/6): the hub page linked **25
destinations** (23 commerce sub-pages + orders + products) at base —
**all 25 are now in nav sections**, plus the hub itself, dispatch and
print (real pages the hub didn't link). Every section href resolves
to exactly one nav item; no href sits in two sections; no duplicate
hrefs across all nav items. Side effects, recorded as deviations:
the old "কমার্স ও সেলস" group is retitled "ইন্টিগ্রেশন ও প্রফিট"
(its products/orders hrefs moved into the sections — the shell would
otherwise render them twice), customers moved out of the CRM group
into কমার্স — গ্রাহক, and **POS appears in the sidebar for the first
time** (at base it was in NO group at all).

**Badge verdict: NO badges shipped.** No client-fetched count exists
in the shell's data flow for commerce items (the hub fetches its own
stats page-locally); per the batch rule, no counts were invented.

**Breadcrumbs.** New kit `Breadcrumb` (server entry of @repo/ui,
aria-current on the last item). A single
`app/dashboard/commerce/layout.tsx` + `components/commerce-breadcrumb.tsx`
renders ড্যাশবোর্ড / কমার্স / <page> on **every commerce sub-page**
(labels from the same nav data; storefront blog/pages/search get
trailing crumbs), and the new order-detail route carries its own.
The hub itself is excluded (it is the crumb target).

**URL-driven state.**
- Orders: `queue` (filters.queue), `status`, `search` (committed
  search; the input keeps its local draft, commit = the existing
  350 ms debounce) initialise from the URL and mirror back via
  `router.replace(..., {scroll:false})`, defaults omitted — a bare
  `/dashboard/orders` renders byte-identically to before. Saved
  views flow through the same replace path. The page is wrapped in
  a Suspense boundary (the app's existing print/labels pattern) for
  `useSearchParams`.
- Products: `?q=` / `?category=` with the same discipline; commit
  points unchanged (Enter / খুঁজুন button; category select). The
  brand filter was out of ED12 scope and is unchanged.
- Storefront settings: **15 section anchors** (`shop-link`,
  `shop-settings`, `referral-rewards`, `popup`, `push`,
  `social-proof`, `content-pages`, `blog`, `shop-search`,
  `delivery-slots`, `shipping-zones`, `rate-rules`, `pickup-points`,
  `checkout-fields`, `custom-domain`), each with `scroll-mt-24`, plus
  a sticky top chip sub-nav (the page is single-column; labels =
  section titles). Imported sub-components (referral/push/social
  proof) got wrapper divs carrying the id — components untouched.
- **Pagination skip, documented:** the orders list has NO page state
  (the list call always sends `pageSize=50`; `OrderFilters` has no
  page field) and products fetches a single page — there was nothing
  to put in the URL.

**Order detail as a route.** New `/dashboard/orders/[id]`
(`use client`, `useParams` per the app's sibling-route convention):
fetches the SAME endpoints the list uses
(`GET /organizations/:id/orders/:id`, `GET …/members`), renders a
back link, the kit Breadcrumb, a header card using only payload
fields (status, total via on2-detail's own `formatMinor` helper,
COD/payment method, customer name/phone, placed date) and the
existing `OrderDetailOn2` unchanged (onPatch → local order state;
onOpenOrder → `router.push` to the sibling order). Kit Skeleton
loading, verbatim error + retry. `[id]/loading.tsx` mirrors the list
shell. Navigation points added in the list: order-number cell →
Link (desktop table), a "বিস্তারিত →" row action (desktop + ON1
mobile card), and "সম্পূর্ণ বিবরণ →" in the action-panel header.
**The inline actOrder panel STAYS** — it is the quick-action surface
(surgery/status/courier/refunds orchestrated against list state);
the route is the linkable full detail. Noted by the builder and
confirmed in the tree: `components/OrdersTable.tsx` is not imported
by the page at all (the page renders its own table), so no
navigation point was blocked by an out-of-scope component.

## ED13 — Orders + POS + Products on the kit

**Orders decomposition** (pure extraction; page.tsx **4,117 →
3,141 lines**; blocks moved verbatim — the builder's scripted
slice-diff matched the originals except two type adaptations
`Order`→`PanelOrder`):

| New component | Lines | Props |
|---|---|---|
| `components/OrderActionPanel.tsx` | 784 | 108 (one interface; page keeps all state) |
| `components/FraudSettingsPanel.tsx` | 360 | 36 |
| `components/SplitDialog.tsx` | 97 | 15 |
| `components/NotificationSettingsPanel.tsx` | 93 | 9 |
| `components/MergeDialog.tsx` | 62 | 10 |
| `components/CodCallChips.tsx` | 38 | 3 (shared by page mobile cards + panel) |

Workflow inventory (builder's stated method — distinct
function/handler names in the file): page-only 104 before →
union of page + extracted components **109 after** (the 104 all
preserved + 5 new component functions; CodCallChips was already
counted in the 104). `apiFetch` occurrences: 105 before → **106
after** (+1 = the panel's own import line; call sites unchanged at
104). State was NOT lifted anywhere — every panel prop is a value
or callback owned by the page. Smoke specs
(`lib/orders-extraction.test.tsx`, 5/5): all four dialog/panels
render nothing while closed; Split/Merge/Notification/Fraud mount
their shells when open. A one-line `vitest.config.ts` was added
(additive `@` alias mirroring tsconfig paths) so component specs
can import dashboard components at all.

**POS v2.** A sticky pay bar below `lg` only
(`sticky bottom-[calc(62px+env(safe-area-inset-bottom))] z-30
lg:hidden` — the 62 px lift clears the shell's fixed 58 px mobile
bottom nav, verified from layout.tsx, not guessed) showing item
count + the panel's own estimate total; **its button calls the
exact same `completeSale` handler with the identical disabled
condition** (`cart.length === 0 || selling`) as the cart panel's
button. Emoji: **14 page-internal glyphs → lucide, 0 remain** in the
file (codepoint scan); none qualified as content (POS printing
lives on the separate print page); one placeholder glyph (🎁 in the
gift-card input placeholder) was dropped since placeholders can't
render icons — its Bengali text is unchanged.

**Products.** List header → kit `PageHeader` (same title/subtitle;
all 8 original action controls verbatim in the actions slot),
filter row → `FilterBar`, table → `ResponsiveTable` with a mobile
card per row (bulk-select checkbox with the same toggle behaviour,
thumbnail, name, category, SKU, price, status badge, stock state,
and the FULL row action set — actions were extracted verbatim into
a shared `renderProductActions(p)` used by both renders). The
create/edit modal's existing footer action row is now sticky
(`sticky bottom-0` inside the form scroll) — same buttons, same
handlers. **Per-field errors: NOT built, by evidence** —
`lib/api.ts` `apiFetch` throws only `Error(body.message)`; no
field-keyed detail exists anywhere in the responses the form
receives, so the page/form banner stays exactly as-is and no field
mapping was invented (client-side guards unchanged).

## ED14 — Feedback + states

**Kit additions.** `PromptProvider`/`usePrompt()` (client entry,
promise-based on the kit dialog chrome: resolves the string on
submit, `null` on cancel/Escape/backdrop, superseded calls resolve
`null` — ConfirmProvider's discipline) mounted at the dashboard
root beside Toast/Confirm; `Breadcrumb` in the server entry. Specs:
`lib/ui-eb5.test.tsx` (breadcrumb aria + prompt resolve/cancel).

**Native-dialog inventory — before/after per file**
(grep at base: `window.(confirm|prompt|alert)\(` + bare
`confirm(`/`prompt(`/`alert(`, method identical both sides;
audit said 35, precise grep found **45** — the grep, not the audit
number, is the record):

| File | Before | After |
|---|---|---|
| orders/page.tsx | 8 (6 confirm, 1 prompt, 1 alert) | **0** |
| products/page.tsx | 6 (5 window.confirm, 1 bare confirm) | **0** |
| orders/reconciliation/page.tsx | 6 (alert) | **0** |
| commerce/storefront/page.tsx | 5 (window.confirm) | **0** |
| customers/page.tsx | 4 (bare confirm) | **0** |
| orders/ndr/page.tsx | 3 (alert) | **0** |
| commerce/landings/page.tsx | 2 | **0** |
| commerce/feeds/page.tsx | 2 | **0** |
| pos/page.tsx | 1 (window.prompt) | **0** |
| commerce/bundles, promotions, questions, quotes, sync, storefront/search, storefront/pages, storefront/blog | 1 each | **0** |
| **Total** | **45** | **0** |

Plus one bonus site found during the batch in
`components/ec-product-dialogs.tsx` (gallery image delete) — also
converted (46 total). Final whole-scope grep: `window.(confirm|
prompt|alert)\(` = **0**, bare `alert(` = **0**; the only remaining
`prompt(` matches in scope are the two `usePrompt()` call sites
themselves. Conversions: confirms → `useConfirm()` (danger tone +
amounts/context in the body for financial/destructive actions —
bulk status/courier confirms keep their interpolated counts and
provider in the text verbatim); prompts → `usePrompt()` (POS
discard-ledger note, orders save-view name; `null` = the old cancel
path, byte-identical follow-up logic); alerts → `useToast()`
(error tone where the site reported failures).

**Toast migration (rule: one-shot success/info → toast; errors and
persistent results stay inline).** Moved: storefront settings — all
21 section successes (the `notice`/`popupNotice`/`domainNotice`
states and their 3 banners are GONE); sync 11; customers 13;
products 8; landings 5; storefront blog 4, pages 3, search 4;
questions 3; reconciliation 3; bundles 2; promotions 2; feeds 1
(URL copy); POS scan success 1; orders page-level 4 (saved-view
success + 3 rowNotice successes). Stayed inline, with reasons
recorded per page: every error; panel-scoped notices (act/courier/
fraud/panel notices — they belong to the panel the user is looking
at); and persistent-result notices that carry something the user
must keep (feeds create/rotate feed URL, landings create page
link, quotes convert order number, products mirror-progress
report). `feedToast` was already a toast-like state and is
unchanged.

**Silent failures.** The storefront settings page's 3 silent
catches (`catch { /* … stays empty … */ }` — popup card, checkout
field defs, shop-pages counts) now set section-scoped error states
rendering "লোড ব্যর্থ হয়েছে" + a পুনরায় চেষ্টা button that
re-runs that section's (already-named, re-callable) loader; success
clears the error. After-grep for the silent-catch pattern in the
file: 0.

**Empty states.** Kit `EmptyState` drop-in swaps with identical
copy: storefront settings 5 sections (delivery slots, shipping
zones — warning text preserved as the description, rate rules,
pickup points, checkout fields), reconciliation 2, ndr 1. The many
one-line `<p>` empties elsewhere were NOT swapped — the kit
component requires a description, so they are not identical-copy
drop-ins (recorded, not churned).

## Deviations + honest limits

- Group retitle/move (above) was forced by the shell's
  render-each-group-once mechanics; POS gaining a sidebar entry is
  a behaviour improvement beyond the letter of ED12, recorded here.
- Products uses `useSearchParams` directly in the page component
  (existing in-repo precedent; orders got the Suspense wrapper).
  The production build — the arbiter — is green with both.
- `OrderActionPanel`'s 108-prop interface is wide. It is the honest
  shape of "page keeps orchestrating, panel is pure presentation";
  splitting state ownership to shrink it would have changed the
  state flow the batch promised to preserve.
- The decomposition is **structural**: behaviour rests on verbatim
  extraction (scripted slice-diff), unchanged call sites
  (apiFetch parity), tsc 0, the smoke specs and the green
  production build — NOT on click-through testing.
- **No screenshot/visual QA** — impossible pre-deploy in this
  sandbox, as with every prior design batch; it remains the
  owner's post-deploy step.
- Nothing is live-proven; deploy still needs the owner's push
  instruction + Dokploy Redeploy, outside this batch.
