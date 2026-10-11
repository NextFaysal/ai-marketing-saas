# CRM C1 — Follow-up Reminder System · Acceptance

Package: Leads & CRM Remaining Package (docs/leads-crm-package-plan.md), Batch 1, item C1.
Before C1, `Lead.nextFollowUpAt` existed and was settable via PATCH, but **nothing consumed it** — no job, no notification, no board. C1 wires it end to end. **No schema change.**

## Definitions (verbatim)

- **Day** = the Asia/Dhaka calendar day. Day bounds are UTC instants computed by a two-pass Intl offset solver identical to the inbox team-activity board's (`dhakaDayStartUtc` in `apps/api/src/crm/lead-followups.ts`): Dhaka midnight = 18:00 UTC of the previous day. "Today" = [Dhaka-midnight, next Dhaka-midnight).
- **Due lead** (sweep + board selection): `organizationId` matches, `mergedIntoId IS NULL`, `stage NOT IN (won, lost)`, `nextFollowUpAt IS NOT NULL AND nextFollowUpAt < start of tomorrow (Dhaka)`.
- **Bucket**: `nextFollowUpAt >= start of today (Dhaka)` → **today** (label `আজ`); older → **overdue**, `daysOverdue` = whole Dhaka days between the follow-up's Dhaka date and today (label `N দিন পেরিয়ে গেছে`). A follow-up set for "yesterday evening Dhaka" counts from its Dhaka date, not from a 24-hour window.
- **Dedupe rule**: at most **one reminder per lead per Dhaka day**. The marker is a `LeadActivity` row of type `followup_reminded` (userId null = system), written **after** that lead's notifications are created — so a crashed/failed run retries cleanly, and a same-day re-run (manual run-now, scheduler + worker double dispatch, multi-replica) finds the marker (createdAt >= today's Dhaka start) and skips the lead. The marker is also the audit trail: it appears in the lead's own activity timeline with the date, due label and recipient count. Chosen over a new table/column because the codebase already treats LeadActivity as the lead's auditable history (merge does the same) and AuditLog has no per-lead index convention; no migration was needed.
- **Recipients**: the lead's `ownerUserId` if that user holds an **ACTIVE** membership in the org; otherwise (unassigned, owner removed/suspended/unknown) **all ACTIVE OWNER/ADMIN members**. If that set is empty the lead is skipped *without* a marker (a later run can still notify once membership exists) and counted as `noRecipient`.

## What was built

- **Job**: `lead_followup_sweep` added to `JOB_TYPES` and to `AutomationService.executeJob` → `LeadsService.sweepFollowUpReminders(orgId)`. It therefore runs on every existing path: the in-process scheduler, the manual run-now endpoint, and the M57 BullMQ worker callback (`executeScheduledJobById` → same `executeJob`), inheriting retries/DLQ and the M62 leader/dispatch dedupe (plus the marker dedupe above). AutomationService injects LeadsService optionally via `CrmModule` (no module cycle: CrmModule imports nothing). The job is creatable from the Automations page (org target list gained "Lead Follow-up Sweep"), like `daily_briefing`/`subscription_sweep`.
- **Notification**: `AgentNotification` rows, type **`lead_followup`** (the model's type column is a free string; earlier types — `ai_briefing`, `ai_anomaly` — were added the same way), title `ফলোআপ বাকি: <lead name>`, body stating আজ / N দিন পেরিয়ে গেছে + name/phone/stage and pointing at the board. Rendered by the existing notification bell/list.
- **Board endpoint**: `GET /organizations/:id/leads/follow-ups` → `{ dueToday, overdue, counts }`, server-side Dhaka bounds, overdue oldest first; each row carries the lead plus `ownerName` (resolved from memberships) and the computed `due` state.
- **Leads page**: "📅 আজকের ফলোআপ" section with the two groups. Quick actions use **existing endpoints only**: খুলুন (lead detail), ✔ যোগাযোগ হয়েছে (POST note — server stamps `lastContactedAt` — then PATCH `nextFollowUpAt: null`), নতুন তারিখ (PATCH `nextFollowUpAt`), বাতিল (PATCH `nextFollowUpAt: null`).

## Tests

- `apps/api/src/crm/lead-followups.spec.ts` (new): Dhaka bound exactness (18:00 UTC), `classifyDue` boundary matrix (later today / earlier today / Dhaka-yesterday vs UTC-yesterday distinction / multi-day / tomorrow & null not due), board selection matrix (won, lost, merged, future, unset, other-org excluded; grouping + oldest-first + ownerName), sweep recipient resolution (active owner / unassigned → admins / suspended owner → admins / unknown owner → admins), dedupe (second same-day run = 0 notifications; previous-day marker does not block), skip matrix.
- `apps/api/src/automation/lead-followup-job.spec.ts` (new): job type registered; `executeJob` routes to the sweep with the job's org; missing-service failure is honest.

## Live verification (sandbox, 2026-10-11)

Verified over real HTTP against the locally running API + Postgres (fresh org/user): a lead with yesterday's follow-up date appeared on `GET leads/follow-ups` in the overdue group (`daysOverdue: 1`, label "1 দিন পেরিয়ে গেছে", owner name resolved) while won and future leads were excluded. A `lead_followup_sweep` job was created through the Automations API and run twice via run-now: run 1 created exactly **one** `lead_followup` AgentNotification (Bengali title/body with name/phone/stage) and one `followup_reminded` marker in the lead's timeline; run 2 created **zero** further notifications (dedupe held against the real database). Job `lastStatus: success` on both runs.

## Honest limits

- The sweep only runs when an org has a `lead_followup_sweep` ScheduledJob (created from the Automations page, e.g. every 60 minutes) — the same opt-in pattern as every other org job type in this codebase; there is no platform-global auto-seeding of jobs today.
- Board "যোগাযোগ হয়েছে" is two calls (note + clear); if the second fails the UI shows the error and the row stays, so the user can retry — the note may then appear twice in the timeline (harmless, truthful).
