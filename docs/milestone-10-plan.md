# Milestone 10 Plan (DRAFT - awaiting user approval)

Prepared 2026-10-10 after Milestone 9 completion (commit 02e3f7c).
Status: proposal only. No code written yet. Ordering below is a
recommendation, not a decision - the user was asked at Milestone 9
delivery which part of Phase 10 to do first.

## Recommendation: start with 10A - Worker Automation (scheduled jobs)

Why this first, from the project's own acceptance docs:

- Milestone 3: "Sync is triggered manually (button) ... scheduled
  is scheduled with the worker expansion."
- Milestone 6: "Reports are generated on demand. Scheduled automatic
  daily generation can reuse ReportsService with the worker later."
- Milestone 8: "Scheduled recurring sync/scans (worker cron) reuse
  these services."
- Milestone 9: "Automated rules (pause on CPA threshold etc.) arrive
  with the automation phase and will reuse setMetaStatus."

Current state verified 2026-10-10: `apps/worker/src/index.ts` still
registers placeholder processors for every queue ("processor not
implemented yet"). Queue contracts already exist in
`apps/worker/src/queues.ts`: sync-store, sync-ads, aggregate-daily,
ai-report, competitor-scan, webhook. So 10A is wiring existing
services into already-named queues, not new architecture.

### 10A scope (proposed)
1. Real BullMQ processors for sync-store (WooCommerce), sync-ads
   (Meta insights), aggregate-daily, ai-report (daily per org),
   competitor-scan - each calling the existing tested service,
   idempotent on retry (all sync services already upsert/dedupe).
2. Repeatable/scheduled jobs per organization with an on/off setting
   and visible last-run / next-run / last-error state (reuse SyncJob
   and CampaignPublishLog-style logging patterns already in the app).
3. Failure honesty, per project rules: a failed job stays failed with
   its real error; no job is reported succeeded without the underlying
   service confirming completion.
4. Tests: processor idempotency (same job twice = no duplicate data),
   schedule registration, failure recording. Worker test count should
   grow beyond the current 1.

Explicitly NOT in 10A: automation rules themselves (10B), new ad
platforms, Shopify, email/SMS.

## Then, in proposed order

### 10B - Automation rules
Rule examples named in earlier milestones: pause campaign when CPA
exceeds a threshold. Depends on 10A (needs scheduled metric checks).
Must reuse Milestone 9's `setMetaStatus` path with full logging, and
follow the same approval/safety posture: rules act only within limits
the user set, every action logged and visible.

### 10C - Shopify adapter
Second store platform. The store/sync models were designed source-
agnostic in Milestone 3 (upsert by org + source + externalId, queue
name comment already reads "WooCommerce / Shopify sync"), so this
reuses the sync and tracking pipeline instead of duplicating it.
Needs the user's Shopify dev/store credentials for live verification.

### 10D - Email / SMS channel
Extends the Milestone 7 inbox/CRM (leads already exist to send to).
WhatsApp template-message sending (deferred in Milestone 7 for the
24h-window rule) belongs in this block too. Provider choice for SMS
in Bangladesh is a billing/compliance-affecting decision - ask the
user before choosing.

### 10E - Google Ads / TikTok Ads adapters
Read-only insights sync first, mirroring the Milestone 5 Meta
adapter pattern (token verified before save, CSV/manual fallback so
analytics work before API approval). Publishing for these platforms
is a separate later decision, as it was for Meta.

## Open decisions for the user (only the material ones)
1. Approve 10A first, or pick a different starting block (10C/10E)?
2. Default sync cadence per org (proposal: store sync hourly,
   ads sync + daily report once daily) - affects API quota and cost.
3. SMS provider for 10D - defer until 10D starts.

## Known blockers that do not block 10A
- Live verification against real Postgres, a real WooCommerce store,
  and a real Meta app remains pending the user's local environment
  and credentials (carried since Milestones 1-3). 10A can be built
  and test-verified in the sandbox the same way Milestones 1-9 were.
