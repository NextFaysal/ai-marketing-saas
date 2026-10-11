# Workflows W6 — Acceptance (Governance + Gallery)

Status: **DELIVERED & LIVE-PROVEN in the sandbox**
(2026-10-11). Plan: `docs/workflows-package-plan.md`.
Schema **115** (migration
`20261010850000_w6_workflow_governance`).

## What was built
- **Governance** (Workflow.cooldownMinutes,
  dailyRunCap): automated firings (event triggers,
  unanswered + schedule scans) are checked BEFORE
  conditions —
  - cooldown: no automated run for the same entity
    (first of conversationId/leadId/customerId/
    orderId present in the context) inside the window;
  - daily cap: at most N automated runs per
    Asia/Dhaka day.
  A suppressed firing is RECORDED as a skipped run
  whose error states the reason ("cooldown: …" /
  "daily_cap: …"), and governance skips never count
  toward either limit themselves (no
  self-perpetuation — spec-asserted with three
  consecutive firings). Manual runs and retries are
  deliberate human actions and bypass governance
  entirely. Fields validate on create and update
  (cooldown 0..10080, cap 1..10000 or null).
- **Custom Access**: the controller now carries
  @PermissionArea("automations") with class-level
  RolesGuard (the M72 pattern) — a member denied the
  automations area loses Workflows too. (Regression-
  checked live: normal members list/run as before.)
- **Preset gallery** (GET workflows/presets, POST
  presets/:key/install): six server-side presets —
  the three classics (recovery follow-up, complaint
  note, unanswered escalation) plus big-order alert,
  delivered-review reminder and COD-confirm ops
  alert. Every preset uses only steps that work with
  its trigger's REAL context (order contexts carry no
  conversationId, so order presets notify the team
  rather than pretending to message a conversation).
  Install creates the workflow DISABLED, like clone;
  the builder shows the gallery with one-click
  install next to the editor-loading presets.

## Verification
- API jest: 4 new W6 specs — cooldown skip + no
  self-perpetuation + per-entity isolation, daily cap
  + manual bypass, field validation, preset install
  semantics. Workflow suites: 34/34 (9 suites).
- **Live proof**: the workflow list survived the new
  class-level guard; the big-order preset installed
  disabled; a 60-minute cooldown PATCHed onto the W4
  workflow suppressed the second same-customer order's
  run as skipped with the cooldown reason recorded,
  while the first completed.
