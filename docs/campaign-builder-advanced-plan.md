# Campaign Builder Advanced — Plan (CB1–CB6)

Written 2026-10-11 from a full code audit of the current
builder (`apps/api/src/campaigns`, 944-line service;
`apps/web/src/app/dashboard/campaign-builder`). The
owner asked for a detailed plan to make the Campaign
Builder advanced and powerful. Execution follows the
usual discipline: one phase at a time, spec + build +
live proof + acceptance doc + local commit. **No
GitHub push without the owner's explicit word.**

## Audit — what already exists (do NOT rebuild)

- Plan → AdSet → Ad model with a real approval flow
  (draft → pending_approval → approved → publishing →
  published | publish_failed), everything created on
  Meta **PAUSED**, activation a separate explicit
  action, partial-failure publish resumes from kept
  external ids, and a CampaignPublishLog row for every
  external call — the evidence behind any "published"
  claim.
- Targeting: countries, age, genders, interests (Meta
  flexible_spec), custom audiences + exclusions,
  saved audiences; formats link / video / carousel
  from the creative library; Advantage+ Sales;
  Meta-side product sets.
- Live operations: budget edit (Meta first, then
  local), %-budget scaling with caps, dayparting,
  ad-set schedule, status sync incl. effective status
  + issues, per-object pause/activate.
- A/B variants + results, plan duplicate, own-plan
  templates, blueprints with product substitution,
  AI copy generation per ad set, deterministic policy
  pre-flight (M24), role-gated writes throughout.

## Audit — verified gaps

1. **Drafts are append-only.** There is no PATCH for
   an ad set or an ad — fixing a draft's targeting or
   budget means delete + recreate (and re-adding its
   ads). Plan PATCH covers only name/objective. No
   per-ad-set / per-ad duplicate either.
2. **No placements or device targeting.** The
   targeting payload has no placement fields at all —
   Meta's defaults apply silently and the user never
   sees that choice.
3. **Readiness checks are fragmented.** Structural
   validation runs only at submit; the policy
   pre-flight checks content only. Nothing combines:
   structure + policy + ad-account health/token state
   (the AD package computes it — the builder never
   shows it) + schedule sanity (an endTime in the
   past validates fine today) + budget totals +
   landing-page reachability. Meta's reach/delivery
   estimate API is not integrated anywhere.
4. **No budget picture.** No plan-level total (sum of
   ad-set budgets), no optional plan spend cap, no
   allocation helper.
5. **Approval is silent and single-shot.** Submitting
   notifies nobody; there is no comment thread, no
   "request changes" conversation, and nothing freezes
   WHAT was approved — a plan edited after approval
   (where the state machine allows it) diverges from
   what the approver saw. Approval history lives only
   in the global audit log, not on the plan.
6. **AI writes copy, nothing more.** No grounded
   structure/budget/audience suggestion (Business
   Brain facts, product margins, RFM segments, the
   account's own past performance are all available
   in-platform and unused here).
7. **No creative preview or health check.** Ads are
   published without ever being seen as a Feed /
   Reels / Stories card, and nothing flags weak
   creative inputs (missing headline, oversized text,
   format/asset mismatch) before Meta does.
8. **The builder is blind after publish.** Zero
   performance data on the builder or the plan list
   (spend/results live only in Ads analytics); A/B
   results exist but there is no "promote the winner
   into a new draft" loop.
9. **Meta-only.** Google / TikTok publishing exists
   elsewhere in the product (M20/M22/M32) but cannot
   be drafted from a plan.
10. **No scheduled launch.** Ad sets have start/end,
    but a plan cannot be set to publish at a chosen
    time.

## Phases

### CB1 — Builder Core++ (edit anything, target fully)
- PATCH ad-set and PATCH ad (full field edit while
  the plan is in an editable status; same validation
  as create; audited). Plan PATCH widened (objective
  change while draft, with the Advantage+ rule kept).
- Duplicate a single ad set (with its ads) and a
  single ad.
- Placements + device targeting end-to-end:
  DTO fields (platforms facebook/instagram, positions
  feed/reels/stories/search, device mobile/desktop/
  tablet, OS) → stored in the targeting Json → the
  publish client maps them to Meta's
  publisher_platforms / facebook_positions /
  instagram_positions / device_platforms /
  user_os fields. Empty = Meta default, and the UI
  SAYS so instead of hiding it.
- Web: inline edit forms for existing ad sets/ads
  (today: delete + re-add), placement picker with an
  honest "default" state.
- Specs: edit validation parity, duplicate integrity,
  placement mapping in the publish payload (client
  spec).

### CB2 — Readiness++ (one checklist before money)
- Unified `GET/POST plans/:id/readiness`: structural
  (existing validatePlan, reused) + policy findings +
  ad-account health from the AD package (token state,
  account status, last sync) + schedule sanity
  (endTime > startTime > now warnings) + landing URL
  check (server-side HEAD/GET with timeout; result is
  "reachable / unreachable / unchecked", never
  faked) + budget totals per ad set and plan.
- Meta delivery estimate adapter: targeting + budget
  → Meta's reachestimate; shown as an ESTIMATE with
  its source labelled. Without a real token it
  returns an honest unavailable state (M30 proves it
  live).
- Plan budget rollup everywhere (builder header +
  list): total daily/lifetime across ad sets; an
  optional plan-level daily cap that submit/publish
  enforce as a guardrail (a cap breach blocks submit
  with the numbers shown).
- Web: a pre-publish checklist card — every row green
  / amber / red with the reason; publish stays a
  separate explicit action exactly as today.

### CB3 — AI Planner + Creative Preview
- **AI plan suggestion**: inputs = goal, product(s),
  total budget, Business Brain facts. Output = a
  DRAFT plan structure (objective, ad-set split with
  budgets, targeting suggestion drawn from saved
  audiences / RFM segment sizes, per-ad copy from the
  existing grounded generator). It creates a normal
  draft the human edits — never submits, never
  publishes. All numbers in the suggestion come from
  real rows (margins, segment counts, past account
  CPA when it exists); the LLM composes, it does not
  invent figures (the M45/U3 grounding discipline:
  number guard applies).
- **Placement preview**: Feed / Reels / Stories
  frames rendering the REAL ad (page name, primary
  text, headline, CTA, asset) from the creative
  library — a preview of the actual inputs, clearly
  a mock frame, not a Meta render.
- **Creative health checks** (deterministic, labelled
  as heuristics): missing/overlong headline, primary
  text length, video-for-video-format, carousel card
  count/images, link domain vs the org's store
  domain mismatch warning.

### CB4 — Collaboration++ (approvals with a memory)
- Notifications: submit → in-app notification to
  ACTIVE OWNER/ADMIN members; approve / request
  changes → the creator is notified (AgentNotification,
  the platform's existing rail).
- **Submission snapshot**: submitting freezes the full
  definition onto the plan (the W1 pattern); the
  approval view diffs snapshot vs current. Any edit
  to a plan in pending_approval returns it to draft
  (integrity rule, stated in the UI) — what was
  approved is what gets published; publish verifies
  the snapshot still matches and refuses otherwise.
- **Comments**: new model CampaignPlanComment
  (plan, author, body, createdAt) + a comment thread
  on the plan; "Request changes" = reject WITH a
  comment (the reason field stays for compatibility).
- **Plan timeline**: comments + audit entries +
  publish logs merged compute-on-read into one
  activity feed on the plan page.

### CB5 — Performance Loop (the builder learns)
- Real performance on the builder + list for
  published plans: spend, impressions, clicks,
  conversions, CPA and — where orders attribute —
  revenue/ROAS, joined from DailyAdMetric by the
  plan's external ids. Empty state when there is no
  data; nothing estimated.
- **Promote the winner**: from A/B results, one click
  creates a NEW draft pre-filled from the winning
  variant (the loser is NOT auto-paused — pausing on
  Meta stays an explicit action, offered next to it).
- **Scheduled launch**: plan.publishAt + a 5-minute
  scan (the platform's existing pattern) that submits
  NOTHING automatically — at the set time it publishes
  an already-APPROVED plan (created PAUSED as always)
  and records the outcome + notifies the creator.
  An unapproved plan at its launch time is skipped
  with the reason recorded, never force-approved.

### CB6 — Cross-Platform Drafts (one plan, three doors)
- From an approved plan, generate a Google Ads or
  TikTok draft through the platform's EXISTING
  create paths (M20/M22/M32: created DISABLED/PAUSED),
  mapping objective → platform objective, budgets,
  copy, and assets where the formats fit; every
  unmappable field is listed in the result instead of
  silently dropped.
- Each platform publish is its own plan target with
  its own publish log rows and status — the Meta flow
  is untouched.
- **Feasibility gate at phase start**: re-verify each
  platform's draft-create path from its official docs
  (the house rule). A platform whose safe draft
  create cannot be confirmed gets an export package
  (the mapped payload as JSON + a deep link) instead
  — stated plainly, never a fake "published".

## Schema / surface summary
- CB4: + CampaignPlanComment model; + submission
  snapshot Json on CampaignPlan.
- CB5: + publishAt on CampaignPlan.
- CB1/CB2/CB3/CB6: no new models expected (targeting
  Json grows fields; readiness is compute-on-read;
  estimates are not stored).
- New endpoints live under the existing
  `organizations/:organizationId/campaign-plans`
  controller and inherit its role gates + the
  @PermissionArea("campaigns") tag.

## Batches
- Batch 1: CB1 + CB2 (build + readiness).
- Batch 2: CB3 + CB4 (AI + collaboration).
- Batch 3: CB5 + CB6 (performance + cross-platform).

## Honest limits
- Reach estimates and cross-platform creates need
  real ad accounts/tokens → built + stub-proven in
  the sandbox, live-proven in the M30 sprint on the
  owner's deployment (same class as AD3–AD6).
- No image generation exists in the platform (M55
  finding) — previews use the tenant's real assets.
- Managed ad accounts / prepaid wallet stay
  postponed (owner decision); publishing always uses
  the tenant's own account and payment method.
- Auto-publish without human approval is NOT in this
  plan and will not be added: approval → PAUSED →
  explicit activation remains the safety spine.

## Not in scope
- Rebuilding the approval state machine, publish
  resume, dayparting, A/B engine or blueprints
  (they work; this package extends them).
- A drag-and-drop canvas builder (the W4-style canvas
  question): the current structured builder stays;
  if wanted later it is its own package.
