# Campaign Builder CB4 — Acceptance (Collaboration++)

Status: **DELIVERED & LIVE-PROVEN in the sandbox**
(2026-10-11). Plan:
`docs/campaign-builder-advanced-plan.md`. Schema
gains CampaignPlan.submissionSnapshot + a
CampaignPlanComment model (migration
`20261010870000_cb4_plan_collaboration`).

## What was built
- **Approval notifications** on the existing
  AgentNotification rail: submit → ACTIVE OWNER/ADMIN
  members (never the submitter); approve → the
  creator; reject ("changes requested") → the creator
  WITH the reason. Best-effort and defensive — a
  notification failure can never block the workflow.
- **Submission snapshot**: submitting freezes the
  full normalized definition on the plan. Publish
  re-compares it and refuses on any difference —
  what was approved is what gets published. (Edits
  were already locked after submit by the state
  machine; this catches anything that bypasses it.)
- **Comments**: a plan discussion thread (2000-char
  cap, author names resolved, audited).
- **Plan timeline**: comments + plan audit entries +
  publish-log evidence merged into one feed.
- Web: a discussion/activity card on the plan page
  (comments + add form + history), loading on demand.

## Verification
- API jest: 4 new CB4 specs; campaign suites 62/62.
- **Live proof**: an ADMIN member inserted into the
  org received the campaign_approval notification on
  submit (the submitter did not); the snapshot froze
  with the full definition; a comment saved and the
  timeline merged comment + audit entries in order.
- **Live-caught bug, fixed**: submission-diff
  reported differs:true immediately after submit —
  Postgres JSONB reorders keys, so a raw stringify
  comparison lies. Snapshot comparisons now use a
  canonical (key-sorted) stringify in both the diff
  endpoint and the publish integrity check;
  re-proven differs:false live, and the spec's
  tampered-definition publish refusal still holds.
