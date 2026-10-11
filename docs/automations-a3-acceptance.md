# Automations A3 — Tenant Automation Health: Acceptance

**Scope (plan docs/automations-package-plan.md, A3):** dead-letter visibility for tenants, per-job health derived from stored runs, a dead-letter failure notification, and the rule-action label cosmetic fix. Local commit only — nothing pushed.

## Audit findings (before building)
- `DeadLetterJob` already carries its resolution state: `replayedAt` (null = open). **No migration was needed.**
- A real replay mechanism already existed — `AutomationService.replayDlq` (marks `replayedAt`, audits `automation.dlq_replayed`, re-enqueues via BullMQ in queue mode or executes inline) — but was exposed only to platform admins (`POST /admin/system/dlq/:dlqId/replay`). A3 exposes the SAME mechanism to tenants behind an org-ownership check; no parallel runner was built.
- Dead letters are written in exactly one place: `AutomationService.recordDlq`, called by the M57 worker callback `POST /internal/jobs/dlq`. The notification hook lives there, so the worker path is covered by construction.
- Per-run history exists: `AutomationRun` (kind `schedule` | `rule`, `refId` = scheduledJobId, status success | error | triggered | skipped). All health numbers below derive from those rows only.
- Webhook dead letters (`scheduledJobId` = `webhook:<source>:<integrationId>`) carry `organizationId = null` — they are platform-level, never appear in tenant lists, and never notify (no tenant recipients exist).

## Endpoints (all under `organizations/:organizationId/automation`, TenantGuard + RolesGuard, `@PermissionArea("automations")`)
- `GET automation/health` → `{ jobs: JobHealth[], deadLetters: { openCount, latest: DeadLetterEntry[20] } }`
- `GET automation/dead-letters?take&skip&open` → `{ total, entries }` (take clamped 1..50, newest first; `open=1|true` filters to `replayedAt IS NULL`)
- `POST automation/dead-letters/:dlqId/replay` (OWNER/ADMIN/MARKETING_MANAGER) → org check (another org's entry = 404) then the existing `replayDlq`.

## Health definitions (verbatim)
Computed per job from `AutomationRun` rows with `kind = "schedule"` and `refId = job.id`, plus the job row:
- `runs7d` — count of the job's schedule runs in the last 7 days (all statuses).
- `decided7d` — of those, the ones with status `success` or `error`. (`triggered`/`skipped` never count as decided.)
- `successRate7d` — `success7d / decided7d`, rounded to 4 decimals; **`null` when `decided7d = 0`** — never a fabricated 0 or 100. The page prints "জানা নেই (কোনো সম্পূর্ণ রান হয়নি)" for null.
- `consecutiveFailures` — error runs counting back from the newest decided run until the first success; the scan is capped at the job's latest 100 runs.
- `band` — `"never_run"` when no decided run exists in the scanned history (the job row's `lastStatus` is the fallback witness: error → `failing`, success → `ok`, null → `never_run`); `"failing"` when the latest decided run is an error; otherwise `"ok"`.
- `lastRunAt` / `lastStatus` / `lastError` are the job row's stored fields, unchanged.

## Dead-letter entries (verbatim)
`{ id, jobType, scheduledJobId, jobName, error, errorTruncated, errorLength, attempts, createdAt, replayedAt, open }`
- `jobName` is resolved from the owning `ScheduledJob` when it still exists, else `null` (page falls back to the job type).
- `error` is a **bounded excerpt of at most 300 characters** of the stored error (the write path stores at most 2000). `errorTruncated` + `errorLength` state the full stored length, so truncation is explicit, never silent.
- `open` = `replayedAt` is null. A replayed entry leaves the open list/count but stays in the full list with its `replayedAt`.

## Replay semantics (verbatim)
Tenant replay = org-ownership check, then the pre-existing `replayDlq`: refuses already-replayed entries (400), refuses entries whose scheduled job no longer exists (400), sets `replayedAt`, writes audit `automation.dlq_replayed`, and either re-enqueues to BullMQ (queue mode, returns `{ replayed: true, mode: "queued", bullJobId }`) or executes inline (fire-and-forget, `{ replayed: true, mode: "inline" }`). The replay response does NOT claim the job succeeded — only that it was re-run; the outcome lands in the job's runs/health like any other run.

## Notification (verbatim)
- Hook: inside `recordDlq`, after the row + `automation.job_dead_lettered` audit are written. Fully failure-isolated (per-recipient catches + outer catch + call-site catch): a notification failure can never break job processing or the DLQ write. Proven against the pre-existing M57 spec fake, which has no auditLog/membership/notification tables at all.
- Recipients: org memberships with `status = ACTIVE` and role OWNER or ADMIN.
- Type: `job_dead_letter`. Title: `অটোমেশন ব্যর্থ হয়েছে: {job name}`. Body names the job + type, the attempts count, a 200-char error excerpt, and points to the Automations page Dead Letter section.
- Dedupe: at most once per job per Asia/Dhaka day — an AuditLog marker `automation.dead_letter_notified` (entityType `ScheduledJob`, entityId = job id, checked against `dhakaDayStartUtc(now)`) is written after a successful notify round; later dead letters for the same job that day record their rows silently.
- No recipients (no ACTIVE OWNER/ADMIN) → no notification and no marker, so a later dead letter the same day can still notify once recipients exist.

## Web (Automations page)
- Job rows show a health badge (সুস্থ / ব্যর্থ হচ্ছে / এখনো চলেনি), "গত ৭ দিনে Nটি রান · সফলতার হার X%" (null rate printed honestly), and "টানা N বার ব্যর্থ" when the streak is positive.
- A Dead Letter card lists the latest entries (job name/type, time, attempts, excerpt with a সংক্ষেপিত note + total length, open/replayed state) with an open-count badge and an "আবার চালান" button per open entry (the tenant replay endpoint).
- Cosmetic fix from the plan: rule rows now label every action by its real name via `RULE_ACTION_LABELS` (pause_campaign → "Campaign Pause", alert → "শুধু Alert", activate_campaign → "Campaign Active", scale_budget → "Budget বাড়ান/কমান (%)", pause_ad → "বিজ্ঞাপন Pause") — previously everything except pause_campaign printed "শুধু Alert".

## Evidence
- Spec `apps/api/src/automation/a3-automation-health.spec.ts` — 10 tests: health derivation matrix (failing streak across the 7d window edge, non-decided statuses ignored, never-run null rate, ok band, cross-org run isolation), DLQ list isolation/pagination/open-filter/excerpt honesty, health openCount, replay (foreign org 404, double replay 400, replayedAt set), notification (recipients = ACTIVE OWNER/ADMIN only, once-per-day dedupe with both rows still recorded, webhook rows never notify, notification/membership failures never break recordDlq). Full API suite: **141 suites / 1038 tests pass**; web tests 39/39; web tsc + build green.
- Live (built API on :4100 against the sandbox Postgres, scripted HTTP, 14/14 assertions): register → org → two jobs created via the real API; seeded runs → health returned band `failing`, streak 2, rate 0.3333, and `never_run` + null rate for the fresh job; a dead letter posted through the REAL internal worker callback (`POST /internal/jobs/dlq`) produced exactly one `job_dead_letter` AgentNotification for the org owner; a second dead letter the same day added a row but **no** second notification; tenant list showed both entries with the resolved job name; health `openCount` = 2; tenant replay returned `{replayed: true}` and set `replayedAt` in the DB; a second replay was refused with 400.
