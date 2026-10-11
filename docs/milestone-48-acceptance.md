# Milestone 48 Acceptance — Proactive Assistant (Daily Briefing + Anomaly Alerts)

- [x] Schema: `AIProactiveSetting` (per-org, unique organizationId;
      briefingEnabled + anomalyAlertsEnabled, both default true;
      absence of a row means defaults) + migration
      `20261010480000_m48_proactive`. prisma generate run before
      rebuild/restart.
- [x] Briefing composition uses ONLY the existing grounded tools:
      `get_analytics_overview` for yesterday's full day (explicit
      from=to=yesterday) and `get_anomalies` (14 days) — the same
      outputs the chat shows. Figures in the live briefing matched
      the seeded row exactly (see live evidence below).
- [x] Honest no-data briefing: a day with zero orders still produces
      a briefing that says so in plain Bengali ("কোনো অর্ডার রেকর্ড
      হয়নি... কোনো সংখ্যা বানানো হয়নি") instead of silence or an
      invented summary. Proven live on the job-path org, which had
      no orders at all.
- [x] Delivery through the EXISTING notification system:
      AgentNotification rows of type `ai_briefing` / `ai_anomaly`,
      visible in the same notification surface as assignments and
      mentions. Recipients: ACTIVE memberships with role OWNER or
      ADMIN only.
- [x] Anomaly alerts: fire only for the detector's highest severity.
      Honest mapping note — the anomaly detector emits severities
      warning | critical (there is no "high" tier in it), so alerts
      fire on **critical** (e.g. spend_no_sales); warning-tier
      anomalies are summarised inside the briefing text instead.
      Dedupe: per user + day + anomaly type (type stored as a body
      marker `[type]`). Briefing dedupe: per user + type + day.
- [x] Settings: GET/PATCH `ai/proactive/settings` (OWNER/ADMIN for
      writes; the DTO carries real @IsBoolean decorators — the M40
      lesson). AI page gains a Proactive card with both toggles and
      an "এখনই ব্রিফিং পাঠান" run-now button that reports the real
      counts returned by the service (including dedupe zeros).
- [x] Scheduling: new automation job type `daily_briefing` in
      JOB_TYPES + executeJob (AutomationService gains an @Optional
      ProactiveService dependency, so existing specs constructing
      the service positionally are untouched), plus the job label in
      the Automations page org-job list. The job is created and run
      exactly like every other scheduled job (interval of the
      owner's choosing; a daily interval is the intended use).
- [x] Audit: ai.proactive_settings_updated on settings change and
      ai.daily_briefing with counts (briefings, anomalyAlerts,
      anomalies seen, orders) on every run.
- [x] Tests: 6 new tests in ai/proactive.spec.ts — defaults,
      delivery to OWNER/ADMIN only with real figures + same-day
      dedupe, honest no-data body, critical-only alerts deduped per
      type/day (warning produces none), both-off skip, briefing-off
      + alerts-on independence. Full API suite: 485 pass / 71
      suites. Full monorepo build green (one earlier parallel
      `pnpm -r build` attempt failed in apps/web with no captured
      error while other tracks were building concurrently; the
      standalone web build and the full rerun both passed — recorded
      here rather than hidden).
- [x] Live-proven on the sandbox (fresh tenants, real HTTP + DB):
      settings defaults returned true/true; run-now created exactly
      1 briefing for the org owner whose body carried the seeded
      yesterday order verbatim (অর্ডার 1টি, Revenue BDT 2500.00,
      Contribution Profit BDT 2500.00) plus the honest COGS-coverage
      note; a second run-now returned briefings: 0 (dedupe); PATCH
      briefingEnabled=false persisted and re-read correctly; and the
      scheduled path — POST automation/jobs {type: daily_briefing}
      then run — finished with lastStatus "success" and delivered a
      real ai_briefing notification to a no-orders org (the honest
      no-data variant).

## Honest boundaries
- An alert firing live requires a critical anomaly in real data
  (the detector's sample guard also suppresses rate anomalies on
  thin data). The critical-alert path is unit-proven with the
  detector's real output shape; no critical anomaly existed in the
  sandbox fixtures to trigger one live, and none was fabricated to
  force it.
- Briefings are in-app notifications only — no email/WhatsApp copy
  is sent (the weekly ads email remains the email channel's job).
- No pixel QA of the Proactive card (build + live API checks only).
