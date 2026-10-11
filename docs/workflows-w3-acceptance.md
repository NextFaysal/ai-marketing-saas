# Workflows W3 — Acceptance (Actions++)

Status: **DELIVERED & LIVE-PROVEN in the sandbox**
(2026-10-11). Plan: `docs/workflows-package-plan.md`.
No schema change.

## What was built — six new step types
- **assign_conversation** {userId | clear}: the assignee
  must be an ACTIVE member (checked at run time; a
  suspended/gone member fails the step honestly).
- **change_lead_stage** {stage}: validates against the
  CRM stage vocabulary, writes a stage LeadActivity —
  and deliberately emits NO lead.stage_changed event,
  so a workflow can never re-trigger workflows
  (loop-proof by construction, spec-asserted).
- **add_tag** {tag, target: lead | conversation}:
  appends uniquely. (Customers have no tags column —
  not offered, rather than faked.)
- **notify_team** {role? | userId?, title?, text}:
  in-app AgentNotifications to ACTIVE members, text
  rendered from the real context; fails honestly when
  nobody matches.
- **create_follow_up** {days 1–90, text?}: sets the
  lead's nextFollowUpAt — picked up by the existing
  C1 follow-up sweep and board.
- **http_webhook** {url, secret?}: POSTs the run
  context as JSON, HMAC-SHA256 signature header when a
  secret is set. Guards: https only, loopback/private
  IP literals + local names refused (validated at
  save AND at send), redirects refused, 10s timeout,
  non-2xx fails the step.

## Builder
One field logic, as always: KNOWN_STEP_TYPES, draft
fields, PANEL_KEYS, payload builder and node metadata
extended in lib/workflow-graph; StepFields gained the
six editors (the assign editor is a real member
select — the page loads ACTIVE members and threads
them into both the form and the canvas); form edit
mode carries the new fields so editing never drops
them.

## Verification
- API jest: 5 new W3 specs (stage move + zero events
  emitted; a 4-step combo flow; suspended-assignee
  failure; webhook validation + host guard; webhook
  delivery 500→failed / 200→completed with a real
  HMAC header shape). Workflow suites: 15/15.
- **Live proof**: a real lead created via the API
  fired the flow — stage new → qualified, tag
  "workflow-qualified" added, follow-up set +3 days,
  run completed with all three steps ok.
