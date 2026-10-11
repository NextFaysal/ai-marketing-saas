# Competitors Design v2 — Acceptance

Build of `docs/competitors-design-v2-plan.md` (owner instruction 2026-10-12
01:23 +06: design আরও modern/powerful/super responsive, honesty-fix-এর আগে)।
Web-only restyle of the Competitor Intelligence page to the Inbox Design
v2/v3 standard. **No API, schema, lib, handler, state, endpoint, or payload
change** — render/style only; every handler, Bengali label, and data flow is
unchanged (diff-verified: the only handler lines touched are the two header
buttons, re-indented with identical handler expressions; one render-derived
const block added for header totals). No feature renamed, no section/tab
added or removed, no data-honesty change (that is the separate later
package). Local commit only — not pushed.

## Files

- `apps/web/src/app/dashboard/competitors/page.tsx` (+550/−469)
- `apps/web/src/app/globals.css` (+61/−0, purely additive `.comp-*` section)
- This acceptance doc.

All new primitives derive from `--brand-from`/`--brand-to` via the existing
v2 token pattern (`--brand-soft`, `--brand-ring`, color-mix), so tenant
white-label branding now flows into this page for the first time.

## Per-part changes

1. **Power header v2** — brand-gradient title icon tile (`.comp-title-icon`)
   replacing the hardcoded `blue-600→indigo-600` badge (now `.badge-brand`);
   live stat chips (`.stat-chip`) showing only already-fetched data:
   competitor count, total ads, active ads, price observations (sums of the
   fetched competitor list stats) and live alert count (danger variant when
   > 0). Header actions restyled to `.btn-secondary` / `.btn-primary`
   (Dossier was `slate-900`), ≥40px targets, wrapping cleanly on mobile.
2. **Tab rail v2** — `.comp-tab-rail` + `.comp-tab-btn`: sticky, one row,
   horizontally scrollable with scroll-snap on mobile (no more awkward
   wrap), ≥40px touch targets, ONE unified brand-gradient active state for
   all 7 tabs (was `slate-900` ×6 + `indigo-600` ×1), counts moved into
   `.comp-tab-count` badges, New/Hot/+35% AOV notes kept with an
   active-state contrast override.
3. **Competitor cards v2** — brand-gradient initials avatar (`.comp-avatar`),
   stats as three `.ctx-tile` tiles (বিজ্ঞাপন / সক্রিয় / দাম রেকর্ড — same
   numbers, same words), selected card uses `.comp-card-active` (brand ring
   + soft wash, was `ring-blue-500`), actions grouped: All-Platform Spy →
   `.btn-ai`, scan → `.btn-secondary`, auto-sync → `.comp-soft-btn`;
   edit/delete are 40px targets; website URL truncates within a `min-w-0`
   flex cell instead of a fixed `max-w-[220px]`.
4. **Section v2 (all 7 tabs)** — unified card padding/headers; ad cards
   rounded-2xl + shadow with platform badges on `.badge` (platform identity
   colours kept), fresh badge → `.badge-brand`, "Beat This Ad" → `.btn-ai`;
   pricing matrix on `.table-wrap` with a sticky first column
   (`.comp-sticky-col`); rules engine on `.comp-rule-on` / `.comp-switch-on`
   (brand toggle, 44px wide); SEO/funnel/complaint metric cards on
   `.comp-metric` (brand top rule + `.stat-*` type, values keep their
   semantic colours); intent/sentiment bars on `.meter`; the three dark
   hero panels (Omnichannel summary, SEO Gap engine, Reassurance Angles,
   Funnel tips, teleprompter) migrated from `slate-900→indigo-950` to
   `.comp-dark` — the brand pair mixed into ink — with `.comp-dark-panel`
   insets; indigo brand-accents (rule action text, bundle discount, dossier
   count, storyboard timestamps) → `brand-700`.
5. **Alerts banner v2** — `.alert alert-amber` family (was ad-hoc amber
   box), live ping dot and semantics unchanged, alert cards rounded-2xl +
   ring, banner action ≥32px.
6. **Modal v2 (all 5)** — edit, dossier, counter-ad, video-script and
   alert-settings modals now share `.modal-backdrop` (slate-900/50 + blur;
   was `bg-black/40`…`/75`, inconsistent) and `.comp-sheet`: bottom sheet
   with top-rounded corners on small screens, centred rounded-3xl dialog
   from `sm` up, consistent 40px circular close buttons and stacked
   full-width action rows on mobile. Dossier summary → `.stat-*` tiles,
   its matrix → `.table-wrap`.
7. **Skeleton loading** — on the exact existing loading conditions:
   `loadingSeo`, `loadingReviewMine`, `loadingFunnel` (report-shaped
   skeleton compositions incl. metric rows, keeping the same Bengali
   progress text), `loadingDossier` (summary + breakdown blocks + same
   text), `loadingRules` (two rule-card skeletons, only while the list is
   still empty so refresh doesn't flash). The spinner cards are gone.
   *Initial page load has no loading boolean in this page (`load()` sets
   no flag), so no skeleton was invented for it — same precedent as Inbox
   Design v3.*
8. **Super-responsive pass** — responsive utilities 31 → 109. Grids
   collapse 3→2→1 (cards, metrics stay 2-up on small, dossier summary
   3→1), spy layout stacks under `lg`, modal grids (counter-ad offer/CTA)
   stack on mobile, fixed truncations removed (`max-w-[200px]` ad link →
   fluid flex truncate), tables scroll inside `.table-wrap` with the
   pricing first column sticky, touch targets ≥40px on all primary
   actions (tabs 40px, toggles widened to 44px).
9. **Micro-motion** — `.fade-rise` on every tab-section mount, the
   alerts banner and the insights feed; settles instantly under the
   existing global `prefers-reduced-motion` rule (verified in globals.css).

## Verification gates (2026-10-12)

- `apps/web` production build (`next build`): **green** (full route table
  emitted, `/dashboard/competitors` included).
- `vitest run` in `apps/web`: **72/72 pass** (8 files).
- `tsc --noEmit -p tsconfig.json`: **clean** (exit 0).
- Markup verification: zero `bg-black/*` backdrops remain; the only
  remaining hardcoded brand-ish colour is the Meta platform-filter active
  state (`bg-indigo-600`) — kept deliberately as platform identity, like
  the TikTok pink / Google blue / Bing cyan active states beside it.
- Environment note: the sandbox `/tmp` tmpfs was 100% full
  (`/tmp/.pnpm-store`, 461 MB, another track's cache — left untouched);
  the gates were run with `TMPDIR` pointed at the home disk. Results are
  unaffected; the first vitest attempt failed with ENOSPC before any test
  ran, the rerun passed 72/72.

## Honest limits

- No live Meta/competitor data exists in the sandbox, so verification is
  build + typecheck + tests + markup — **no screenshot/visual QA with real
  competitor data was possible**. Breakpoint behaviour (360/768/1280px)
  is verified at markup level (utility audit), not pixel level.
- The fabricated-engine honesty issues found in the 2026-10-12 Competitor
  Intelligence audit are **unchanged by design** — this package is
  design-only, per the plan; labels/metrics/data are exactly as before.
