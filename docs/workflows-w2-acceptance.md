# Workflows W2 — Acceptance (Triggers++)

Status: **DELIVERED & LIVE-PROVEN in the sandbox**
(2026-10-11). Plan: `docs/workflows-package-plan.md`.
No schema change.

## What was built
- **order_delivered + order_cod_confirmed wired**: both
  events were emitted all along (integrations / inbox
  COD flow) but had no workflow mapping. Their raw
  payload carries only an orderId, so the engine now
  ENRICHES the context from the order row (customerId,
  total in taka, status, source, orderNumber) — the
  same shape order_created contexts carry, so
  conditions and recipient resolution work identically.
- **conversation_assigned + conversation_closed**:
  emitted from the ONE central path
  (`InboxService.updateConversation`) when the assignee
  actually changes or a conversation transitions into
  closed, with the standard conversation context.
- **schedule trigger**: daily at an Asia/Dhaka time,
  fired by the existing leader-claimed 5-minute scan.
  Definitions carry `scheduleTime` ("HH:MM", required —
  validated at create/update) and optional
  `scheduleDays` ("0,1,3", 0 = Sunday). The scanner
  strips both before condition evaluation, other
  conditions still apply, and a per-day dedupe (run
  context date) makes double-fires impossible.
- Builder (form + canvas) lists all five new triggers;
  the form's condition fields gained scheduleTime /
  scheduleDays.

## Verification
- API jest: 3 new W2 specs — delivered enrichment
  (condition on total passes, the customer is emailed),
  schedule validation + once-per-Dhaka-day firing,
  scheduleDays weekday gating (Sunday blocked, Monday
  fires).
- **Live proof**: a schedule workflow without
  scheduleTime was refused 400 by the real API; a real
  webchat conversation closed through the inbox API
  fired the conversation_closed workflow — the run
  completed and its note step executed.

## Honest limits
- Assignment events fire on the updateConversation
  path; the auto-assignment engine writes assignees
  directly and does not emit (its assignments are
  system-driven, and the sweep would storm the
  trigger).
- Delivered/COD live firing rides the existing
  integrations/inbox emit sites (proven producers —
  conversions consume the same events); the workflow
  side is spec-proven with the real enrichment code.
