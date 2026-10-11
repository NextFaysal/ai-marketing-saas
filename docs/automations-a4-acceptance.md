# Automations A4 — Jobs Day-One: Acceptance

**Scope (plan docs/automations-package-plan.md, A4):** the one job type the tenant form could not create (`competitor_multi_sync`) and a job template gallery so a new org is not staring at a blank form. Local commit only — nothing pushed.

## Audit findings (before building)
- JOB_TYPES has 25 types, each with a real `executeJob` case — including `competitor_multi_sync` → `CompetitorsService.syncMultiPlatform(orgId, actor, targetId)` where targetId is a competitor id. The API accepted the type all along; **only the web form's competitor target group lacked the option** (24 of 25 creatable).
- Every other candidate template type was read case-by-case before its description was written: org-scoped cases ignore targetId (daily_report, daily_briefing, subscription_sweep, billing_reminders, lead_followup_sweep, inbox_assignment_sweep, meta_status_sync, audience_refresh, audit_retention — the last is platform-wide and honours the platform retention setting); `woo_orders` needs an integration id; `competitor_multi_sync` needs a competitor id.
- Workflow presets (W6) set the pattern: a server-side catalogue (`WORKFLOW_PRESETS`) + `presets/:key/install`. A4 mirrors it with `JOB_TEMPLATES` + `job-templates/:key/install` so API and web share one list.

## What shipped
- **Form fix:** `competitor_multi_sync` added to the Automations page's competitor target group — "Competitor Multi-Platform Sync (Meta/Google/TikTok/Bing — সব একসাথে)". All 25 job types are now creatable from the UI.
- **Catalogue:** `JOB_TEMPLATES` in `automation.service.ts`, served at `GET organizations/:id/automation/job-templates`.
- **Install:** `POST organizations/:id/automation/job-templates/:key/install` (OWNER/ADMIN/MARKETING_MANAGER) creates a REAL ScheduledJob through the existing `createJob` path — so the job carries the codebase's normal job defaults (**enabled = true**, `nextRunAt` = now + interval) and runs on the normal schedule (in-process or M57 worker dispatch). Semantics:
  - `targetKind: "org"` → targetId = the organization id (the form's org-group convention).
  - `targetKind: "integration" | "competitor"` → the request must carry the tenant-chosen `targetId`; missing → 400 (Bengali message); a target that does not belong to the org → 400. A target is never fabricated or defaulted.
  - Installing the same type + target twice → 400 "এই টেমপ্লেটের Job ইতিমধ্যে তৈরি আছে" (a duplicate sweep would only double store/platform API calls; the A3 dedupe discipline covers notifications, not job execution).
  - Unknown key → 404. An optional `name` overrides the template's default job name.

## Template catalogue (verbatim)
| key | type | target | interval | name |
|---|---|---|---|---|
| woo_orders_sync | woo_orders | integration | 30m | WooCommerce Orders Sync (টেমপ্লেট) |
| daily_briefing | daily_briefing | org | 1440m | Daily AI Briefing (টেমপ্লেট) |
| daily_report | daily_report | org | 1440m | Daily AI Report (টেমপ্লেট) |
| subscription_sweep | subscription_sweep | org | 1440m | Subscription Sweep (টেমপ্লেট) |
| billing_reminders | billing_reminders | org | 1440m | Billing Reminders (টেমপ্লেট) |
| lead_followup_sweep | lead_followup_sweep | org | 60m | Lead Follow-up Sweep (টেমপ্লেট) |
| inbox_assignment_sweep | inbox_assignment_sweep | org | 60m | Inbox Assignment Sweep (টেমপ্লেট) |
| competitor_multi_sync | competitor_multi_sync | competitor | 1440m | Competitor Multi-Platform Sync (টেমপ্লেট) |
| meta_status_sync | meta_status_sync | org | 60m | Meta Status Sync (টেমপ্লেট) |
| audience_refresh | audience_refresh | org | 360m | Audience Refresh (টেমপ্লেট) |
| audit_retention | audit_retention | org | 10080m | Audit Retention (টেমপ্লেট) |

Each card's Bengali description states only what the underlying `executeJob` case actually does (e.g. the audit-retention card says the job is platform-wide, the retention window is a platform setting, and admin activity logs are kept; the lead-follow-up card repeats the once-per-lead-per-day notification rule). No template promises behaviour the job does not have.

## Web (Automations page)
- The gallery renders as the FIRST section of the page (above Scheduled Jobs), so a brand-new org leads with templates and its own jobs below — no fake data; the section simply does not render if the catalogue fetch fails.
- Targeted templates render a select fed by the page's already-loaded integrations/competitors; installing without a selection is refused client-side and server-side (400).
- After install, the new job appears in the jobs list via the normal reload.

## Evidence
- Spec `apps/api/src/automation/a4-job-templates.spec.ts` — 8 tests: catalogue integrity (every template type ∈ JOB_TYPES — asserted against the live constant, keys unique, intervals ≥ 5, the required minimum set present), catalogue endpoint returns the same list, org-template install through createJob (targetId = org, enabled default), duplicate refusal, unknown key 404, competitor template (missing target 400, foreign target 400, own target installs), integration template validation, and `competitor_multi_sync` creatable via createJob + `executeJob` dispatching to `syncMultiPlatform` with (orgId, actor, targetId).
- Full gates: API **142 suites / 1046 tests pass**, web tests 39/39, web tsc + `next build` green, monorepo `pnpm -r build` green.
- Live (built API on :4100, scripted HTTP, 9/9): catalogue returned all 11 templates with `competitor_multi_sync` as a competitor-target template; installing `lead_followup_sweep` created a real enabled job with targetId = org and interval 60; a second install was refused 400; a competitor created via the API accepted the `competitor_multi_sync` template install with that target; `competitor_multi_sync` was also created through the plain jobs endpoint (the form's new option posts exactly this); the target-required `woo_orders_sync` without a target was refused 400; the jobs list contained all 3 created jobs.
