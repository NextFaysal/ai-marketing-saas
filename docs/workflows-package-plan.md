# Workflows Package Plan (W1–W6)

Owner directive 2026-10-11: after the audit, "full system
টা ready করে দাও" — the W1→W6 package from
`docs/` audit (chat, 2026-10-11). Local commits only.

Baseline (verified in code): engine with 5 triggers
(order_created, lead_created, lead_stage_changed,
inbox_message_received, inbox_unanswered scan), 7 step
types (send_email, send_sms, send_inbox_message,
add_conversation_note, add_lead_activity, wait, condition),
all-must-pass conditions, per-step run logs, wait/resume
with the M62 atomic claim + live context refresh, form
builder + React Flow canvas (M54), 3 web presets.

## W1 — Editable + Clone + Run Snapshot
Full update (trigger/conditions/steps, same validation as
create); clone (starts disabled); WorkflowRun stores a
steps snapshot at start so mid-flight edits never rewrite
a running flow; audit on update/delete/clone; the builder
(form + canvas) edits in place instead of creating a copy.

## W2 — Triggers++
Wire the already-emitted order.delivered +
order.cod_confirmed events; conversation_assigned +
conversation_closed emits; a schedule trigger (daily at
a Dhaka time, fired by the existing 5-minute scan, once
per workflow per day).

## W3 — Actions++
assign_conversation, change_lead_stage (no event emitted
— loop-proof), add_tag (lead/customer), notify_team,
create_follow_up, http_webhook (https-only, private-IP
refused, 10s timeout, no redirects).

## W4 — Real Branching
A branch step {field, op, value, then[], else[]} with
one level of sub-steps (waits not allowed inside arms in
v1); the form builder edits both arms; the canvas shows
branch as a locked composite node (losslessness first).

## W5 — Test + Insights
Dry-run (full trace, nothing sent, nothing stored),
manual run with an enriched context, per-workflow stats,
a runs explorer (filters + detail), failed-run retry,
and a failure notification to the workflow's creator
(at most one per workflow per hour).

## W6 — Governance + Gallery
Per-workflow cooldown (per entity) + daily run cap —
skips are recorded as skipped runs with the reason;
@PermissionArea("automations") on the controller;
server-side preset gallery (the 3 classics + delivered
review, COD thanks, unanswered escalation) with
one-click install; builder uses the gallery.
