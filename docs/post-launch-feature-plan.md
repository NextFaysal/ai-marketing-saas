# Post-Launch Feature Plan — what to build next

Status at writing (2026-10-10): the full product (Milestones
1–33) is LIVE on the owner's own Dokploy server at
app./admin./api.qosprey.com. Every approved feature roadmap is
delivered. This plan covers genuinely NEW features, grouped into
five phases by purpose. Sizes are in milestones (1 milestone =
one focused build + tests + live-check cycle, the unit used for
M1–M33). The M30 live-verification sprint continues in parallel;
it needs the owner's accounts, not code.

Ground rules carried over: no mock integrations in production
code paths; nothing counts as sent/paid/published without the
platform's own confirmation; money in integer minor units;
never fabricate metrics.

## Phase N1 — Commercial Readiness (make it sellable)
Goal: a stranger can sign up, invite a team, pay, and stay —
without the operator touching a terminal.
1. **Tenant billing page** (1 milestone) — current plan, period,
   usage vs effective limits (AI messages, broadcast cap,
   seats), SaasPayment history, upgrade/downgrade REQUEST flow
   (admin approves until online payments land). Today tenants
   cannot see any of this; billing is admin-side only (M27).
2. **SSLCommerz subscription payments** (2 milestones) — design
   first (hosted checkout, IPN validation, idempotent
   activation: subscription extends ONLY on a validated
   successful IPN, never on the browser success redirect),
   then sandbox, then live. Needs the owner's SSLCommerz
   merchant account (store id/password). ShurjoPay is the
   fallback if merchant onboarding stalls. bKash direct API is
   a later add-on, not v1 (tokenized checkout approval is
   slower).
3. **Email member invitations** (1 milestone) — today inviting
   a teammate requires them to already have an account.
   Token-link invites (signed, expiring, single-use) by email
   via the configured SMTP, accept → joins the org with the
   invited role. Seat limits already exist and apply.
4. **Tenant-user MFA** (1 milestone) — the TOTP machinery
   (M28) already challenges any user with totpEnabled; tenant
   users just have no enrolment UI. Add enrol + manage in the
   tenant settings, plus recovery via org OWNER reset.
5. **Onboarding wizard** (1 milestone) — a checklist home for
   new orgs: business profile → connect store → connect Meta →
   invite team → first report/campaign. Uses only real
   completion state from existing tables; skippable, never
   blocks the app.
6. **Trial lifecycle UX** (0.5 milestone) — days-left banner,
   expiry → PAST_DUE already sweeps (M27); add read-only grace
   mode instead of a hard wall, and an upgrade CTA wired to
   item 1/2.

## Phase N2 — Daily-Use Depth (make it stickier)
Goal: remove the known paper cuts sellers hit every day.
1. **Order address field** (1 milestone) — Order gains a
   structured shipping address (schema + forms + API). Fixes
   three workarounds at once: courier booking stops borrowing
   the customer profile address, the order bot stops parking
   addresses in internal notes, chat orders capture it
   properly.
2. **Courier quoting + bulk ops** (1–2 milestones) — delivery
   charge BEFORE booking via each provider's own pricing
   surface (Pathao price plan, RedX charge calculator,
   Steadfast: honest "shown after booking" where no quote API
   exists), bulk booking for selected orders, printable label
   / invoice PDF per shipment.
3. **Inbox rich product cards** (1 milestone) — send real
   catalog products as rich messages (image + price + order
   button) instead of text snippets; saved inbox views
   (filter sets) per agent.
4. **Order bot v2** (1–2 milestones) — multi-item orders,
   structured address steps (division/district pickers fed by
   courier area lists), quantity edits at the summary step,
   and a "talk to agent" state that survives bot restarts.
   Still text-first and COD-first by design.
5. **Visual workflow canvas** (2 milestones) — drag-and-drop
   editor over the existing engine v2 (triggers, conditions,
   waits, branches, actions). The engine, validation and run
   history already exist; this is presentation only.
6. **Real-time inbox** (1–2 milestones) — WebSocket push for
   new messages, assignments and notifications, replacing the
   4s/30s polling in webchat, inbox and the bell. Presence
   (M17) rides the same socket.

## Phase N3 — Scale & Reliability (make it safe to grow)
1. **BullMQ worker processors** (2 milestones) — apps/worker
   is still a placeholder; the scheduler, workflow scans and
   sync jobs live in the API process, which is why the API
   must stay at ONE replica. Move them to queued processors
   with retries/dead-letter, keeping the API-process fallback
   behind a flag during migration.
2. **Feature flags wired end-to-end** (1 milestone) — flags
   exist and are administrable (M26) but not every tenant
   feature reads them. Audit each KNOWN_FLAG, gate the
   feature server-side (not just in the UI), and show flag
   state on the admin org page.
3. **Automated backups** (1 milestone) — scheduled pg_dump of
   the Dokploy Postgres volume to S3-compatible storage,
   retention policy, and a DOCUMENTED, actually-performed
   restore drill. Today backups are a manual note in the
   runbook.
4. **Observability** (1 milestone) — Sentry (or self-hosted
   GlitchTip) for API/web errors, an uptime check on
   /health + the two apps, and an Admin Console panel for API
   error rate and job failures (the data sources exist:
   SyncJob, AutomationRun, Platform Health).
5. **CI + deploy confidence** (1 milestone) — GitHub Actions
   running the API test suite + all builds on every push, and
   one observed end-to-end Dokploy auto-deploy (push →
   webhook → rebuild → live). Auto-deploy did NOT fire on the
   first pushed fix (2026-10-10); it fired only after a
   manual redeploy, so the webhook path needs one verified
   pass before it is trusted.
6. **Tenant data export & deletion** (1 milestone) — full org
   export (JSON/CSV zip: products, orders, customers, leads,
   conversations) and a soft-delete org workflow with a
   grace period, mirroring the admin soft-delete rules.

## Phase N4 — Marketing Power++
1. **Google/TikTok live editing** (2 milestones) — budget and
   status edits for Google/TikTok objects, reaching parity
   with Meta's confirmed-edit path (M20/M22 cover creation
   only; Meta covers edits). Same rule: platform confirms
   first, local state follows.
2. **Scheduled sync completeness** (1 milestone) — ad-level
   insights and breakdowns join the scheduler (today manual),
   and CAPI Purchase producers cover CSV/manual orders
   (today they emit no order.created, so they are never
   sent — a labelled gap, fixed by emitting the event in the
   import path).
3. **AI Creative Studio** (2 milestones) — from a product:
   LLM-generated copy variants (grounded in the real product
   name/price, never invented offers), headline/description
   sets, one-click into the campaign builder, and the M24
   policy pre-flight run automatically on every variant.
   Image generation only via the configured provider and
   labelled as AI-generated in the library.
4. **Audience automation** (1 milestone) — scheduled
   membership refresh (M22 made it possible manually/by job),
   plus Google Customer Match list upload alongside Meta
   custom audiences (same hashed-contact discipline).
5. **Competitor price alerts** (1 milestone) — scheduled
   price scans (M8 scanner) diffed against the last
   observation; a change creates an agent notification +
   optional email digest. Evidence rules unchanged.
6. **Retention analytics** (1 milestone) — cohort table
   (first-order month × repeat behaviour) and repeat-purchase
   rate in the BI area, computed from real orders only,
   alongside the existing RFM segments.

## Phase N5 — Expansion
1. **Public marketing site + pricing** (1–2 milestones) — a
   landing page for the SaaS itself (features, real pricing
   from the admin plan settings, signup CTA into the app).
   Until now the product has no public face.
2. **Agency white-label** (2 milestones) — agency-tier orgs
   get their own domain + logo + sender name across the
   tenant app and shareable reports (M20 report links are
   the first white-label surface).
3. **Standalone Instagram Login** (1 milestone) —
   graph.instagram.com tokens for creator accounts without a
   linked Page (the M17 inbox rides Page-linked IG today).
   Needs Meta app review for the instagram scopes.
4. **PWA mobile shell** (1–2 milestones) — installable,
   inbox-first mobile experience for sellers (conversations,
   COD confirm, order create). No native app until usage
   proves the need.
5. **Public API + outgoing webhooks** (2 milestones) —
   API keys per org, documented REST surface for orders/
   leads/customers, and signed webhooks-out for order.created
   / lead.created so tenants can wire their own tools.
6. **Template marketplace** (1 milestone) — share campaign
   blueprints and workflow presets across orgs (opt-in
   publish, install into a draft). Builds on M19 blueprints
   and M15 presets; no cross-tenant data ever moves, only
   the template definitions.

## Explicitly NOT in this plan
- **Managed Ad Accounts + prepaid Wallet** — still postponed
  by standing decision (platform-policy + legal review
  required before holding customer ad money). The SaaS-side
  billing in N1 is subscription collection only, which is a
  different, permitted thing.
- Native mobile apps, a second ad-platform rewrite, and
  multi-region hosting — no demand signal yet.

## Recommended sequence
M30 sessions opportunistically (owner accounts) → **N1**
(revenue) → **N2** (retention) → **N3** interleaved as
insurance → **N4** (depth for power users) → **N5**
(expansion). N1 items 3+4 (invites, tenant MFA) are the
cheapest trust wins and can jump the queue.
