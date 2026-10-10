# Milestone 24 Acceptance — Phase L: Reach & Agency

Date: 2026-10-10. Schema: 83 models, migration
20261010240000_m24_phase_l applied. API tests 292 pass (6 new).

## L1 Google offline conversions
OfflineConversionsService (shared with L2): per-org per-platform
setting (ad account, conversion action id, trigger
placed/cod_confirmed/delivered, enabled). Uploads keyed by the
gclid our own tracker stored on the order's attributed
touchpoints; the click conversion goes to
conversionUploads:uploadClickConversions with the order value and
a Dhaka-formatted conversionDateTime. "Sent" ONLY when Google
returns a confirmed result row for that gclid and no
partialFailureError; dedupe via the unique (org, platform,
eventId) log; orders without a gclid are logged "skipped", never
sent unkeyed. Backfill endpoint for the last N days.

## L2 TikTok Events API
Same service/log/triggers: CompletePayment events keyed by ttclid
(context.ad.callback), event_id shared with the log for dedupe;
"sent" only on TikTok's code 0. Failures are recorded as failed
with TikTok's own message and surfaced, never swallowed.

## L3 Policy pre-flight
Deterministic BN+EN rule checker (campaigns/policy-check.ts):
personal attributes, before/after + weight claims (incl. Bengali
numerals and word orders), guaranteed results, health claims,
prohibited content, caps/emoji/punctuation hygiene. Every finding
quotes the snippet, explains the rule in plain Bengali and
suggests a safer direction. POST campaign-plans/:planId/preflight
+ builder panel. Deliberately deterministic — no LLM variance —
and the UI states plainly that passing is NOT an approval
guarantee.

## L4 Agency portfolio
GET /portfolio rolls up ONLY the signed-in user's own memberships:
month spend (campaign-level rows), revenue (non-cancelled orders),
platform conversions, ROAS and published plans per org + totals.
POST /portfolio/digest emails the same numbers via the real SMTP
provider (honest failure when unconfigured). Portfolio page +
nav entry.

## Live verification performed (sandbox)
Portfolio returns the demo org with honest zeros; settings/log
endpoints respond; pre-flight runs over the demo plan. The live
run also caught a REAL bug the unit tests missed: the new
controller initially lacked the class-level TenantGuard, so role
checks failed and tenant isolation was not enforced on its GET
routes — fixed and re-verified (wrong org -> 403, platform
mismatch -> 400). Real Google/TikTok uploads need the owner's
accounts (checklist section 20).

## Advertising roadmap status
Reviews #1-#2 and Phases G/H/I/J/K/L are ALL delivered
(Milestones 18-24). Remaining from the reviews are only stretch
items: TikTok video creative upload, Advantage+ Sales objective
support, Google Performance Max skeleton, and Meta-side product
set creation (now unblocked by category in the catalog push).
