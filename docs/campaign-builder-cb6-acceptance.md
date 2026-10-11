# Campaign Builder CB6 — Acceptance (Cross-Platform Drafts)

Status: **DELIVERED & LIVE-PROVEN to the honest ceiling**
(2026-10-11). Plan:
`docs/campaign-builder-advanced-plan.md`. This
completes the CB1–CB6 package.

## Feasibility gate (docs + code audit)
The existing Google/TikTok publish paths were
verified in code before building: PublishingService
.publishGoogle (Search + RSA, created PAUSED) and
.publishTikTok (created PAUSED/DISABLE) both exist
and enforce their own input rules (Google needs ≥3
headlines ≤30 chars, ≥2 descriptions ≤90, keywords
REQUIRED; TikTok needs an image or video URL). No
new platform client was written.

## What was built
- POST plans/:id/cross-platform {platform,
  targetAdAccountId}: only for approved/published
  plans, only into a same-platform account of the
  same org. Mapping is mechanical: plan name +
  ad headlines sliced to 30 (Google headlines),
  descriptions sliced to 90, ad text sliced to 100
  (TikTok), interests → Google keywords, union of
  countries, plan daily total as the budget. Every
  slice is listed under `transformations`.
- **Blocked = export package**: anything unmappable
  (no daily budget, no countries, no link URL, too
  few headlines/descriptions, no keywords, no
  direct image URL for TikTok) returns
  {status:"blocked", mapped, unmapped} and the
  platform is NEVER called — the payload is the
  export the tenant can complete manually.
- A created draft writes a CampaignPublishLog row
  (step google/tiktok, the platform's campaign id)
  and an audit entry; a failed publish is logged
  as an error and returned as failed — never as
  created. The Meta flow is untouched.
- Web: cross-platform card on approved plans
  (platform + account pickers; blocked results show
  every missing item verbatim).

## Verification
- API jest: 4 new CB6 specs; **full suite 1207/1207
  (155 suites)** at package close; API + web green.
- **Live proof (fresh sandbox DB)**: TikTok on an
  image-less plan returned the blocked export
  package with the true reason and made no call;
  Google reached the existing path, whose own
  connection guard refused the unconnected fixture
  account with its real message. A "created" result
  needs a real connected Google/TikTok account —
  the M30 sprint item, stated plainly.

## Package close-out (CB1–CB6)
Builder edit-anything + placements (CB1), unified
readiness + reach estimate + budget cap (CB2),
grounded AI planner + preview + creative health
(CB3), approval collaboration (CB4), performance
loop + winner promotion + scheduled launch (CB5),
cross-platform drafts (CB6). Final state: API
1207 pass / 155 suites, web build green, all
acceptance docs in docs/campaign-builder-*.md.
Remaining honest ceilings, all M30-class: real
Meta reach estimate, real-LLM suggestion quality,
scheduled-launch happy path, cross-platform
"created" — each needs the owner's real accounts.
