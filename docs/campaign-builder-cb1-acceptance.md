# Campaign Builder CB1 — Acceptance (Builder Core++)

Status: **DELIVERED & LIVE-PROVEN in the sandbox**
(2026-10-11). Plan:
`docs/campaign-builder-advanced-plan.md`. No schema
change (placements live in the targeting Json).

## What was built
- **PATCH ad set** — full in-place edit on draft /
  rejected plans: name, goal, page/pixel, schedule,
  and targeting layered over the stored object (a
  partial edit never wipes untouched keys — interests
  survive a positions-only edit, spec-asserted). The
  budget pair is replaced wholesale when either field
  is sent (daily ↔ lifetime switch is one call).
- **PATCH ad** — in-place edit resolved through its
  ad set (a foreign plan's ad 404s); format rules are
  re-checked against the MERGED ad (switching to
  video without a video asset fails).
- **Duplicate ad set** (with its ads, daypart copied,
  external ids cleared) and **duplicate ad**.
- **Placements end-to-end**: vocabularies platforms
  {facebook, instagram, audience_network, messenger},
  positions {feed, story, reels, search}, devices
  {mobile, desktop} — validated in the service (400
  on unknown), stored in targeting, and mapped into
  the Graph payload per platform
  (facebook_positions feed/story/facebook_reels/
  search; instagram_positions stream/story/reels/
  ig_search; device_platforms; publisher_platforms).
  Empty = Meta default, and the UI says exactly that.
- All four operations are audit-logged.
- Web: placement checkbox groups (with the honest
  default note) on the create form; inline editors
  for existing ad sets and ads; duplicate buttons.

## Verification
- API jest: 5 new CB1 specs; campaign suites 51/51.
- **Live proof**: a real plan + ad set created with
  placements stored verbatim; PATCH switched the
  budget pair (daily → null, lifetime 900000); an ad
  headline edited in place; duplicate returned the
  copied set with its ad.
- **Live-caught bug, fixed**: the duplicate response
  500'd on BigInt serialization (dailyBudgetMinor) —
  the data was created correctly. The return now
  stringifies money like the other endpoints, and
  the re-proof returns the copy cleanly.
