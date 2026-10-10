# Milestone 11 Acceptance Checklist - Email/SMS & Workflows

- [x] Prisma models: MessageTemplate, Broadcast, MessageDelivery,
      Workflow, WorkflowRun + migration 20261010100000. Schema: 58 models.
- [x] Email provider: real SMTP via nodemailer, env-configured
      (SMTP_HOST/PORT/USER/PASS/FROM). Unconfigured = explicit error,
      never a pretend send. A message counts as sent ONLY with an SMTP
      message id; docker-compose Mailpit (localhost:1025, UI 8025) is
      the documented local path.
- [x] SMS provider: SSL Wireless (Bangladesh) v3 API - real POST with
      api_token/sid/msisdn/csms_id; sent ONLY on the gateway's SUCCESS
      status (envelope tested both ways); BD phone numbers normalized
      to 8801XXXXXXXXX, un-normalizable numbers fail loudly per
      recipient. Other gateways will get their own provider class -
      nothing pretends to be a universal adapter.
- [x] Templates with {{variable}} rendering from real data (order
      number, total, name); unknown variables render empty, never
      invented content.
- [x] Broadcasts: audiences resolved from real tables (all customers
      with a usable address, or leads in a chosen stage); per-send cap
      (BROADCAST_MAX_RECIPIENTS, default 1000) REFUSES oversized
      audiences instead of silently truncating; double-send of the
      same broadcast is blocked; final status is sent/partial/failed
      from actual per-recipient results, each recorded in
      MessageDelivery with the provider message id or the real error.
- [x] Event bus (global, in-process): order.created (only for orders
      placed within the last 24h, so an initial backfill sync cannot
      trigger a message storm), lead.created, lead.stage_changed.
      Producer operations never fail because a consumer failed.
- [x] Workflow engine: triggers above, all-must-pass conditions
      (eq/neq/gt/gte/lt/lte/contains over the event context), steps
      send_email / send_sms (template-driven, recipient resolved from
      the customer/lead in context) and add_lead_activity. Every
      trigger writes a WorkflowRun (completed/skipped/failed) with a
      per-step log; sends are recorded as MessageDelivery rows linked
      to the run.
- [x] Web: Messaging page (provider configuration status, templates,
      broadcast builder with audience choice, send with live counts,
      per-recipient delivery viewer) and Workflows page (trigger +
      optional condition + multi-step builder, enable toggles, runs
      history). Both nav items live.
- [x] Tests: 165 total passing (API 157, contracts 7, worker 1).
- [x] Builds: all packages + API + Next.js pass.
- [ ] Live sending needs the user's own SMTP credentials (or Mailpit
      locally) and an SSL Wireless account with balance - both are
      account-bound and cannot be verified from this sandbox.

## Deliberately deferred
- WhatsApp template-message broadcasts: the inbox (Milestone 7) sends
  within Meta's rules; bulk template campaigns need template approval
  workflows of their own and belong with a dedicated phase.
- Workflow "wait/delay" steps and branching: the engine is linear for
  now; delayed steps need the scheduler to own resumable runs, which
  is a Milestone 12 candidate alongside multi-instance scheduling.
- Wallet & Billing nav item remains disabled: prepaid wallet/managed
  accounts stay postponed (platform-policy + legal review), as
  decided in Milestone 9.
