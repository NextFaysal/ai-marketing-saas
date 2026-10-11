# Organization Settings — Design v2 (Acceptance)

Status: **DELIVERED** (2026-10-11). Frontend only
(`apps/web/src/app/dashboard/settings/page.tsx`); every
handler, field, endpoint and payload is the Milestone
75/77 one, unchanged — presentation only.

## What changed visually
- **Brain hero**: the completeness card is now a gradient
  hero panel (white-label brand vars, like Overview/Billing
  v2) with an SVG progress ring showing the real percent,
  the done/total section count, AI-can-answer chips, and
  the eight sections as glass tiles with their honest
  "what is missing" hints.
- **Section navigation**: eight anchored sections (Brain,
  Identity, Contact & Hours, Delivery, Payment, AI
  Behaviour, Branding, Security). Desktop gets a sticky
  sidebar nav; mobile gets a sticky horizontal chip rail.
  Every section scrolls with an offset (`scroll-mt-24`) so
  anchors never hide under the rail.
- **Section cards**: icon-headed cards (gradient icon chip
  + title + one-line purpose), roomier grids
  (1 → 2 → 3 columns), full-width inputs, ≥44px touch
  targets on primary actions.
- **Business hours editor**: day rows tint when enabled,
  wrap cleanly on small screens, time inputs sized for
  thumbs.
- **Sticky save bar**: the hub's save action (plus the
  Knowledge link) floats at the bottom of the viewport on
  every screen size, so a long form never buries it.
- **Alerts** use the v2 alert primitives; the 2FA and
  Branding cards were re-headed into the same system
  (all TOTP/branding logic byte-identical).

## Verification
- `next build` compiled successfully; the settings route
  is in the app-path manifest and the shipped chunk
  contains the new shell.
- Web tests: **38/38 pass** (vitest).
- Zero API files touched.

## Honest limit
Not pixel-QA'd in a real browser (same standing note as
the Tenant Web Design v2 and Support Design v2 passes) —
the layout follows the same primitives and breakpoints
those passes established.
