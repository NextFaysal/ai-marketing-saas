# AI Assistant Design v3 — Modern Refresh (Acceptance)

Owner instruction (2026-10-12 22:06 +06): "AI Assistant-এর design-টা
update করে modern করতে হবে।"

## Audit finding (why v3)

AP1 shipped Design v2 functionally (3-zone layout, streaming, rich
answers), but visually the page still used the pre-v2 palette — flat
`bg-blue-600` user bubbles, `bg-slate-100` assistant bubbles, plain
bordered suggestion pills, a single-line composer and plain cards —
while Inbox (v3), Competitors (v2), Support (v2) and Billing (v2)
already run on the brand-token system (`--brand-from/--brand-to`,
glass, gradients, soft shadows). Design v3 brings the AI Assistant
onto that same system. **Visual/UX only: no API, handler, text
semantics or data rule changed.**

## What changed

Files (only these):
- `apps/web/src/app/dashboard/ai/page.tsx` — layout/markup restyle.
- `apps/web/src/app/globals.css` — one additive block
  "AI Assistant Design v3 primitives" (`.ai3-*`) at the end of the
  file, on the existing brand tokens, plus late overrides that polish
  the AP1 rich-answer blocks (`.ai-stat-tile` gradient top rule,
  pill-shaped `.ai-tool-card`). Nothing existing was edited or removed.

Design v3 elements:
- **Hero header** — brand-gradient panel with a glass ✦ orb, the
  honesty subtitle verbatim, and glass badges driven only by real
  state: provider / dev-template badge, pending-proposal count,
  this-session streamed-answer count.
- **Conversation rail** — sticky rounded card, gradient
  "+ নতুন কথোপকথন" button, icon search, conversation rows with
  brand-ring active state + gradient side bar; row actions
  (pin/rename/MD/JSON/delete) appear on hover/focus (always visible
  on touch), tags unchanged. Empty state text added.
- **Chat canvas** — brand-tinted rounded-3xl surface (Inbox
  thread-canvas pattern); messages get avatars (gradient ✦ for AI,
  slate gradient for user), user bubbles take the org brand
  gradient, assistant bubbles are white cards with soft shadow;
  entrance `fade-rise` (global reduced-motion rule settles it);
  streaming keeps step rows + caret and adds a 3-dot typing
  indicator while no text has arrived yet.
- **Empty state** — centred orb + "আজ কী জানতে চান?" and the SAME
  nine suggestions as icon cards in a responsive grid (same texts,
  same `send()` calls).
- **Composer v3** — sticky floating glass shell with focus ring;
  multiline textarea: Enter sends, Shift+Enter newline (hint row
  with `kbd` chips); gradient send button (disabled when empty),
  red gradient Stop while streaming. ≥44px targets.
- **Follow-ups** — brand-soft chips.
- **Recap card** — brand-soft strip; now shown only on the home
  state (no active conversation / no messages) instead of above
  every chat — same real data (latest title + pending count).
- **Proposals** — panel with icon head, the create form grouped in
  an inset surface using the shared `.input` style, proposal rows
  as hover-lift cards, shared `.btn-primary/.btn-secondary` and
  `.badge` for actions/status (status colours unchanged).
- **Right panel** — pending-proposal queue with gradient count
  badge; Proactive settings as `setting-row` toggles (same three
  PATCH-backed checkboxes, same explanatory text); session usage
  as three stat tiles (count / input / output) from the same
  done-event sums — still no cap/limit number, with the same
  honesty footnote.

Honesty discipline preserved: no new numbers anywhere; hero badges,
usage tiles and counts all read existing page state only; rich
answers still render only from the stored `display` projection
(`ai-rich.tsx` logic untouched).

## Verification

- `tsc --noEmit`: zero errors in the AI files (page, ai-rich,
  globals). The only tsc errors in the tree are the pre-existing
  uncommitted AG working-tree ones in `dashboard/automations`
  (missing `automation-blueprints` module etc.) — untouched.
- Web vitest: targeted AI suites 18/18 (ai-rich 9, ai-stream 9);
  full suite as present in the working tree 100/100 (12 files —
  several test files are deleted in the uncommitted AG tree state).
- `next build`: **green** — `/dashboard/ai` 10.9 kB (114 kB first
  load). Note: the build was run with the AG tree's deleted lib
  files and `packages/ui` temporarily restored (backed up first),
  because the uncommitted AG state itself does not build
  (automations imports a deleted module; AG's ui change breaks the
  HEAD automations page). After the build, every temporary restore
  was reverted and `git status` verified byte-identical to the
  pre-build state — the AG uncommitted work is exactly as found.
- No live visual QA: sandbox has no running app/browser session for
  this page (same honest limit as UX0/AP1); verification is
  build + tests + static markup review.

## Scope / gates

- Local commit only — NOT pushed (owner push gate unchanged).
- No AG/CX files touched; the uncommitted AG1 working tree is
  untouched (verified identical status before/after).
