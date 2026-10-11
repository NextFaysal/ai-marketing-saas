# Competitor Intelligence — Design v2 (Modern, Powerful, Super Responsive)

Owner instruction 2026-10-12 01:23 +06 (this side chat): before the Competitor
Intelligence honesty-fix, first make the design more modern and powerful and
super responsive for a better user experience. Scope = the Competitors page
(`apps/web/src/app/dashboard/competitors/page.tsx`). The Inbox Design v2/v3
work is the reference standard.

## Audit verdict (code-verified, 2026-10-12)

The page is functionally complete but visually a generation behind the
Inbox v2 standard:

- 3,401 lines, 7 tabs (spy / swipefile / pricing / playbook / seo /
  complaints / funnel) + alerts banner + competitor cards + 5 modals
  (edit competitor, dossier, alert settings, counter-ad / video-script,
  rules-related).
- **Zero** use of the Design v2 system: no `--brand-from/--brand-to`
  primitives, no `.stat-chip` / `.btn-ai` / skeleton. Gradients are
  hardcoded `blue-600→indigo-600` and active states are `slate-900`
  (one tab inconsistently `indigo-600`) — so tenant white-label branding
  does **not** flow into this page at all.
- Responsive coverage is thin: only ~31 `sm:/md:/lg:/xl:` utilities in
  3,401 lines. The 7-pill tab bar wraps awkwardly on mobile; tables rely
  on bare `overflow-x-auto`; several fixed truncations (`max-w-[200px]`,
  `max-w-[220px]`); dense desktop-first cards.
- No skeleton loading anywhere — per-section loading booleans exist
  (`loadingSeo`, `loadingReviewMine`, `loadingFunnel`, `loadingDossier`,
  `loadingRules`) but render bare text/buttons only.
- 5 modals have inconsistent backdrops (`bg-black/40`…`/75`, some with
  blur, some without) and none are full-screen-on-mobile.

## Hard rules (same as Inbox Design v2/v3)

- `apps/web` only. No API, schema, lib, handler, state, endpoint, or
  payload changes. Render/style only — every existing handler, Bengali
  label, aria attribute, and data flow stays byte-identical in behaviour.
- No invented metrics. Header stat chips may only show numbers already
  fetched on this page (competitor count, total ads, active ads, alert
  count, price observations).
- NO data-honesty changes in this package — the fabricated-engine labels
  are the separate, later honesty-fix package. Do not rename features,
  do not add or remove sections or tabs.
- All new primitives derive from `--brand-from/--brand-to` via
  `color-mix` (like the inbox v2 primitives) so white-label keeps working.
- Local commit only. **No GitHub push** (owner-only trigger).
- Overlap discipline: the working tree carries other tracks' uncommitted
  work (AG leftovers, CX files) and the Inbox Design v3 build edits
  `inbox/page.tsx` + `globals.css`. Before touching `globals.css`, check
  `git log` — the v3 commit must be landed; build on top of it. Stage
  surgically: only `competitors/page.tsx`, additive `globals.css` hunks,
  and this plan's acceptance doc go into the commit.

## Build parts

1. **Power header v2** — compact header in the inbox v2 style: brand
   gradient title chip (replacing the hardcoded blue→indigo badge),
   live stat chips sourced only from already-fetched data, header
   actions (Alert Bot, Dossier export) restyled with brand primitives
   and wrapping cleanly on mobile.
2. **Tab bar v2** — sticky tab rail: one unified brand-gradient active
   state for all 7 tabs, count badges, horizontally scrollable with
   scroll-snap on mobile (no wrap), ≥40px touch targets.
3. **Competitor cards v2** — initials avatar with brand gradient,
   stat tiles (ads / active / observations), brand-soft active ring,
   sync/action buttons grouped and full-width-friendly on mobile.
4. **Section v2 across all 7 tabs** — unified card headers, ad cards
   with platform/winning/fresh badges on brand primitives, pricing
   table v2 (styled header, sticky first column, clear scroll
   affordance on mobile), playbook/SEO/complaints/funnel report cards
   on the same primitives. Hardcoded `slate-900`/`blue-600` gradients
   migrate to brand tokens.
5. **Alerts banner v2** — keep the live-alert semantics, restyle with
   the `.alert` family used by inbox v2 (no behaviour change).
6. **Modal v2 (all 5)** — consistent backdrop blur, rounded-2xl shell,
   full-screen sheet on small screens, consistent header/close.
7. **Skeleton loading** — skeleton blocks on the exact existing loading
   conditions (`loadingSeo`, `loadingReviewMine`, `loadingFunnel`,
   `loadingDossier`, `loadingRules`, initial page load) using the
   existing `.skeleton` primitive.
8. **Super-responsive pass** — breakpoint audit of the whole page:
   grids collapse 3→2→1 cleanly, header/tab/table/card behaviour
   verified at ~360px, ~768px, ~1280px widths (markup-level), no fixed
   pixel truncations that break small screens, touch targets ≥40px.
9. **Micro-motion** — fade-rise on tab-section mount, under the existing
   `prefers-reduced-motion` rule.

## Verification gates

- `apps/web` build green, `vitest` all pass, `tsc --noEmit` clean.
- Acceptance doc `docs/competitors-design-v2-acceptance.md` listing
  per-part changes, files touched, and the honest limit: no live Meta
  data in the sandbox, so verification is build + typecheck + markup;
  no screenshot QA with real competitor data.
