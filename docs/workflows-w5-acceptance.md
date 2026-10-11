# Workflows W5 — Acceptance (Test + Insights)

Status: **DELIVERED & LIVE-PROVEN in the sandbox**
(2026-10-11). Plan: `docs/workflows-package-plan.md`.
No schema change.

## What was built
- **Dry-run** (POST workflows/:id/dry-run): simulates
  the definition against a caller context — workflow
  conditions, condition steps, branch arms, waits —
  with read-only recipient/template lookups. The trace
  states what WOULD happen per step, including honest
  "would FAIL" entries (unresolvable recipient,
  missing conversation/lead). By construction it
  shares no code path with the executor's writes:
  nothing is sent, stored or mutated (spec-asserted:
  zero run rows, zero sends, lead untouched).
- **Manual run** (POST workflows/:id/run): enriches
  the chosen context from the real rows (order/lead/
  customer/conversation — the W2 order enrichment was
  generalized into `enrichContext`), then executes
  for real. Works on disabled workflows (a deliberate
  human action); audited.
- **Runs explorer**: GET runs now takes workflowId /
  status / take (≤200) filters; the page gained the
  two filter selects.
- **Retry** (POST runs/:runId/retry): failed runs
  only; replays the stored context against the
  CURRENT definition, linked via `_retryOf`; audited.
- **Per-workflow stats** (GET workflows/stats): 30-day
  runs/completed/failed/skipped/waiting, success rate
  (null when nothing decided — never a fake 0), last
  run time; shown as a chip line under each workflow.
- **Failure notification**: when a run finishes failed,
  its creator gets an in-app notification — at most
  once per workflow per hour (dedupe marker in the
  audit log). A creator who left the org gets nothing.

## Builder
Test panel per workflow (context ID inputs, dry-run
trace view, confirm-guarded real run), stats chips in
the list, run filters, and a retry button on failed
runs.

## Verification
- API jest: 5 new W5 specs — dry-run purity + trace
  shape, conditions honesty, manual run on a disabled
  workflow with enrichment, retry + once-per-hour
  failure notification, stats math (66.7% on a seeded
  mix, 40-day-old run excluded). Workflow suites:
  30/30.
- **Live proof**: dry-run of the W4 branch workflow
  against a real order id enriched the total (300),
  traced the else arm with the rendered notification
  text, and stored zero runs; stats returned real
  per-workflow counts; a manual run of the W3 flow
  against a fresh lead completed and moved its stage
  to qualified.
