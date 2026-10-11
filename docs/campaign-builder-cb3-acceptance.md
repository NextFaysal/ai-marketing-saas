# Campaign Builder CB3 — Acceptance (AI Planner + Preview)

Status: **DELIVERED & LIVE-PROVEN in the sandbox**
(2026-10-11). Plan:
`docs/campaign-builder-advanced-plan.md`. No schema
change.

## What was built
- **AI plan suggestion** (POST campaign-plans/suggest):
  the skeleton is SERVER arithmetic — objective from
  the goal text, a 60/40 budget split at ≥ ৳1000/day
  (single set below), interests from the product's
  own category. The provider only writes words
  (plan name + per-set copy); every number in a real
  LLM's copy must already exist in the fact pack
  (the product price) or that variant falls back to
  the safe template. Grounded facts return with the
  draft: the product price, the saved-audience count,
  and the account's own past CPM/CPA when metric rows
  exist (null when they don't — never invented). The
  result is an ordinary editable DRAFT — nothing is
  submitted or published.
- **Creative health** (POST plans/:id/creative-health):
  deterministic, labelled heuristics — missing/long
  headline, primary-text length, image-less link ads,
  carousel cards without images, video without a
  video asset (error), and a landing-domain vs
  business-website mismatch warning.
- **Placement preview** (web): Feed / Reels / Story
  mock frames rendering the ad's REAL text, headline,
  CTA, domain and image (or an honestly labelled
  placeholder for library assets) — labelled a mock
  frame, not a Meta render.
- Web: the AI suggestion card on the builder start
  view (product + budget + goal), a Creative Health
  button + findings card, and a per-ad Preview toggle.

## Verification
- API jest: 3 new CB3 specs (60/40 split + grounded
  facts + createdByAi ads, single-set small budgets,
  creative-health findings). Campaign suites green.
- **Live proof**: with the dev template provider (no
  LLM key — labelled in the response), a suggestion
  for a ৳1,500 clothing product at ৳2,000/day created
  a real draft: two ad sets at 120000/80000 minor,
  category interests on the second, facts carrying
  the true price and pastPerformance: null. Creative
  health on a weak ad returned 4 true findings.
- **Live-caught bug, fixed**: setting a budget cap
  (CB2) put a real BigInt on the plan row and the
  plan LIST + GET then 500'd on serialization. Plan
  returns now stringify dailyBudgetCapMinor
  (getPlanFull + listPlans), re-proven live.
- Not live-proven: a real LLM's suggestion (needs
  the owner's LLM key — the number guard is
  unit-tested via the dev path and the guard code).
