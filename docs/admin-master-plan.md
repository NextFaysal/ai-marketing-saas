# Admin System Master Plan — What Else Can Be Built

Written 2026-10-10, after the Admin Console (M25–M28), Dynamic
Platform Config (M33), SSLCommerz billing (M36) and the Design
v2 refresh. This plan covers ONLY the operator/admin system.
House rules carry over unchanged: destructive/money actions
require a reason + audit; tenant secrets are never displayed;
no metric is ever fabricated (missing data shows as missing);
every phase ships with tests + live checks and ONE batched
GitHub push.

## Where the admin system stands today (verified inventory)

49 admin API routes live. Command Center (real cross-tenant
aggregates), Users (status/grant/revoke/force-reset/sessions),
Organizations (status, limits, flags, subscription editor,
support view with audited content access), SaaS Billing
(manual payments, MRR, overdue), Platform Health (integration
board, failed-job retry for 2 job kinds), Usage board,
Settings (kill switches, announcements, plan prices),
Dynamic Platform Config (LLM / Meta app / SMTP / SMS /
SSLCommerz, all with real test actions), Security (TOTP,
admin roster, session revocation), global search, audit
explorer. Design v2 shell (responsive, mobile drawer).

Known residuals this plan closes: feature flags are stored
but not enforced end-to-end; health retry covers only
scheduled jobs + store syncs; MRR does not prorate; the IP
allowlist is exact-IP only; no impersonation (metadata-first
support view only); no invoices; no dunning; no view of
gateway checkouts (stuck payments are invisible); no platform
growth/revenue analytics beyond the summary cards.

---

## Phase A1 — Operator Visibility++ (proposed Milestone 37)

Goal: run the business from the console, not from memory.

1. **Revenue analytics**: MRR + collections trend (monthly
   buckets from real SaasPayment + Subscription rows),
   trial→paid conversion, plan migration matrix, overdue
   aging. Charts render ONLY from stored rows.
2. **Growth board**: signups / new orgs / orders / ad spend
   over time (daily/weekly series from real tables), top
   tenants by revenue, usage and orders.
3. **Tenant health score**: a composite, clearly-labelled
   heuristic (subscription status, recent failed jobs,
   integration freshness, last activity) with every input
   shown — a triage aid, never presented as ground truth.
4. **AI cost view**: tokens are already real; money appears
   ONLY when the operator sets per-provider rates (per 1M
   tokens) in settings, and is labelled "আনুমানিক" (estimate)
   everywhere it appears.
5. **Subscription history timeline** per org: plan/status
   changes reconstructed from audit entries + payments.

Needs: nothing from the owner. Pure code + one migration at
most (rate settings ride the SystemSetting store).

## Phase A2 — Support & Customer Success++ (Milestone 38)

1. **View-as tenant (impersonation)**: the deferred M25
   item — time-boxed (e.g. 30 min), read-only by default,
   unmissable banner in the tenant app, start/stop audited
   with a mandatory reason; write-mode is a separate,
   SUPER-only, per-session opt-in.
2. **Support tickets**: tenants open tickets from the tenant
   app (new Ticket/TicketMessage models); admin inbox with
   assignment, status, priority; replies notify by email
   (real provider) and in-app.
3. **Org 360 timeline**: one chronological feed per org —
   orders, conversations, sync jobs, subscription events,
   admin actions — replacing tab-hopping during support.
4. **Proactive alerts board**: integrations silent > 24h,
   repeated sync failures, expiring trials — an operator
   task list; optional nudge email to the tenant owner
   (template + one click, sent via the real EmailProvider).
5. **Onboarding funnel board**: every org's M35 checklist
   state at a glance; who is stuck where; nudge actions.

Needs: nothing external. Impersonation needs a careful
security review pass inside the milestone.

## Phase A3 — Billing & Money++ (Milestone 39)

1. **Checkout reconciliation**: the PlanCheckout board —
   initiated / success / failed / cancelled with ages;
   "stuck" (> 1h initiated) flagged; a stuck checkout can be
   re-validated against the gateway on demand.
2. **Refunds**: recorded against a payment (reason + audit),
   subscription period adjusted honestly (never silently).
3. **Invoices & receipts**: PDF generated from real payment
   rows; tenants download from their Billing page; admin
   can resend by email.
4. **Proration**: mid-period plan changes credit unused
   days — all money math in integer minor units, the credit
   shown as its own ledger line.
5. **Coupons & promos**: codes with percent/fixed discount,
   plan scoping, expiry, redemption caps; redemptions are
   ledger rows, applied at checkout (SSLCommerz amount is
   computed server-side from price − discount, as today).
6. **Dunning**: scheduled reminder emails for PAST_DUE orgs
   (day 1 / 3 / 7 templates, sent via the configured mail
   provider, every send logged); pairs with the M35
   read-only grace.
7. **bKash as a second gateway**: same trust pattern as
   SSLCommerz (server-side verification before activation).
   Needs the owner's bKash merchant API credentials —
   design + sandbox can proceed without them.
8. **Revenue export**: CSV of payments/subscriptions for
   accounting; monthly statement view.

## Phase A4 — Control & Safety++ (Milestone 40)

1. **Feature flags end-to-end** (closes the M26 residual):
   each known flag actually gates its feature server-side
   and hides it in the tenant UI; per-org rollout percent
   for new features.
2. **Scheduled maintenance windows**: announce + auto
   on/off; optional HARD lockout (tenant writes paused)
   with admin bypass — today maintenance is a banner only.
3. **CIDR IP allowlist** for the admin surface (today exact
   IPs only) + allowlist change auditing.
4. **Admin API keys**: scoped, hashed-at-rest keys for
   operator automation/scripts, with last-used tracking
   and instant revocation.
5. **Bulk actions**: multi-select orgs → announcement,
   flag, limit override, status — each with one reason,
   one audit entry listing every target.
6. **Login anomaly alerts**: failed-login spikes and
   impossible-travel heuristics on the Security page
   (from real auth audit rows; heuristics labelled).
7. **Tenant data export & verified deletion**: per-org
   export (JSON/CSV zip) and a soft-delete workflow with
   grace period + restore — the operator half of the N3
   item.
8. **Audit retention**: export + age-based pruning policy
   (pruning itself is SUPER + reason + snapshot-first).

## Phase A5 — Growth & Marketing Ops (Milestone 41)

1. **Targeted announcements**: by plan, subscription
   status, signup cohort or org list (today: global only).
2. **Tenant email campaigns**: product updates/release
   notes to tenant admins via the real EmailProvider, with
   per-recipient delivery rows (same discipline as tenant
   broadcasts; failures shown, never hidden).
3. **Changelog manager**: "What's new" entries shown in
   the tenant app; publish scheduling.
4. **Referral program**: tenant referral codes, signup
   attribution, credit ledger applied to future invoices;
   admin board for codes/credits/abuse review.
5. **Feedback & NPS**: in-app prompt for tenant users,
   responses board in admin, scores from real responses
   only.
6. **Public pricing page manager**: edit the prices/
   features shown on the future public site (ties into
   Phase N5) — values default to the live plan settings,
   so the site can never drift from real prices.

## Phase A6 — Reliability & DevOps Panel (Milestone 42)

1. **Version & deployment panel**: running build SHA
   (injected via env at deploy), boot time, uptime; a
   "GitHub is ahead of this server" indicator — this would
   have made both manual-redeploy surprises obvious.
2. **Backup status**: last backup time/size + restore
   drill log (the backups themselves are Phase N3 work;
   this is their operator face).
3. **Queue monitor**: BullMQ queue depths/failures once
   the N3 processors land (dependency noted, not hidden).
4. **Error tracking summary**: Sentry/GlitchTip counts via
   their API when configured (dynamic-config pattern);
   unconfigured = an honest empty state.
5. **Log tail viewer**: recent structured API logs,
   filterable, admin-only, secrets-redacted by the logger.
6. **Database growth panel**: table sizes/row counts from
   the pg catalog; growth trend from periodic snapshots.

Dependencies: items 2–4 light up as N3 lands its pieces;
1, 5, 6 are self-contained.

---

## Explicitly NOT in this plan

- Tenant Wallet / Managed Ad Accounts — the standing
  postponement (platform-policy + legal review) is
  unchanged; nothing here reopens it.
- Any "AI-suggested" numbers presented as measurements.
  Estimates are labelled; measurements come from rows.
- Replacing Dokploy or the hosting stack — A6 observes
  the deployment; it does not move it.

## Recommended sequence

A1 (visibility) → A3 (money) → A2 (support) → A4 (control)
→ A6 (reliability) → A5 (growth). A1 first because every
later phase is easier to prioritise with real revenue and
health data in view. Each phase = one milestone, local
commits, ONE batched push at phase end, owner redeploys in
Dokploy (auto-deploy still does not fire).
