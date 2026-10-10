# Next Roadmap Plan — What Remains & What Can Come Next

Date: 2026-10-10. Prepared from a fresh audit (git history, roadmap,
live-verification checklist: 10 done / 60 open, code TODO scan,
milestone acceptance files) after Milestone 28. All feature
roadmaps approved so far are DELIVERED: core SaaS (M1–11),
Customers & Automation Phases A–F (M12–17), Advertising Phases
G–L (M18–24), Admin Console Phases A–D (M25–28). Schema 88 models,
323 API tests passing.

## Part 1 — What is actually left (verified, grouped by blocker)

### A. Blocked on the owner's accounts/decisions (the biggest bucket)
The 60 open checklist items are almost all this kind — the code is
ready; each item needs a real credential or account only the owner
can provide:
- A real WooCommerce store (sync + webhook + chat-order push).
- A Meta app (ads_management + App Review): insights, publishing,
  inbox E2E, Lead Ads `leadgen` subscription, CAPI live test,
  Ad Library token.
- **One LLM provider key (OpenAI / Anthropic / Gemini)** — still
  undecided; it unlocks real AI chat quality, translation, thread
  summaries, vision payment verification, voice transcription.
- Courier production credentials: Steadfast keys, Pathao merchant
  (prod auth boundary proven; booking needs real creds), RedX token;
  Pathao sandbox E2E retry when their sandbox host is back.
- Google developer-token production approval; TikTok app + Events
  pixel; Shopify custom app.
- Real SMTP server and/or SSL Wireless SMS account.
- A VPS/server for permanent deployment (runbook incl. admin app
  is ready: `docs/deployment-vps-runbook.md`).
Shape of the work: a guided owner sprint — owner supplies accounts
one by one (Owner Action Table in the checklist), each is connected
through the app's own verify-before-save flows and ticked off with
real evidence. Estimated owner time: half a day to two days,
spreadable.

### B. Postponed by standing decision (do NOT start silently)
- Managed Ad Accounts + Prepaid Wallet: postponed since M9 pending
  platform-policy and legal review. Unblocking needs an explicit
  owner decision + a policy/legal pass, not just code.

### C. Genuinely unbuilt code (small, verified list)
1. **BullMQ worker processors are still placeholders**
   (`apps/worker/src/index.ts` says so). All real automation runs
   on the in-API scheduler + workflow scans today — fine for one
   instance, a ceiling for scale.
2. **Visual workflow canvas** — workflows are form steps + presets
   (engine v2 is complete: wait/branch/send steps work).
3. **Meta-side product set creation** — sets are local definitions;
   catalog push already sends category, so Meta filters are now
   possible but unimplemented.
4. **Order address field** — chat/bot delivery addresses live in
   internal notes because the Order model has no address column.
5. **Email-based member invitations** — inviting still requires
   the person to already have an account (M1 limitation, never
   closed). Admin-issued reset links exist; invite tokens don't.
6. **Tenant-user MFA** — TOTP exists for platform admins (M28);
   tenant users have no MFA option yet (M1 limitation).
7. **Production compose validation** — docker-compose.yml exists
   but has never run (no Docker in the sandbox); the deployment
   has only ever run as bare processes.

## Part 2 — What else could be built (new value, ranked)

1. **Production Deployment Pack (recommended first).** Everything
   above is worth little while the only running copy is an
   ephemeral sandbox (one VM replacement already wiped it once).
   Contents: production docker-compose (api/web/admin/worker/
   postgres/redis) validated as far as the sandbox allows, reverse
   proxy templates for the three subdomains, env/secrets checklist,
   automated DB backup script + restore drill doc, BullMQ
   processors for the heavy jobs (sync/report/broadcast queues)
   with the in-API scheduler kept as fallback, first-run admin
   bootstrap doc (grant CLI + TOTP enrolment + operator card —
   see `docs/admin-first-login-and-totp-recovery.md`).
2. **Commercial Readiness Pack.** Tenant self-serve billing page
   (current plan, limits in use, payment history, upgrade request
   to the operator), email invitations with expiring tokens,
   tenant MFA (reuse the M28 TOTP machinery), and an SSLCommerz
   integration design for online subscription payment (buildable
   once the owner has a merchant account; manual records stay).
3. **Advertising Stretch Pack.** TikTok video creative upload in
   publishing, Advantage+ Sales objective in the builder,
   Google Performance Max skeleton (asset groups, PAUSED-first,
   same publication discipline), Meta-side product sets from the
   local definitions (category/price filters).
4. **Inbox Depth Pack.** Rich product cards (image + buttons) in
   WhatsApp/Messenger replies and the order bot, webchat
   websockets instead of polling (needs an infra decision:
   sticky sessions or a pub/sub adapter), courier delivery-charge
   quoting wired into booking (Pathao price plans, RedX charge
   calculator endpoints already documented in M21).
5. **Activation Pack.** Guided setup checklist inside the tenant
   dashboard (connect store → connect ads → invite team → first
   report), plus an explicitly labeled, one-click-removable sample
   dataset for brand-new orgs (never mixed with real metrics).

## Recommended sequence (Milestones 29–32)

- **M29 — Production Deployment Pack** (Part 2.1 + C1/C7): makes
  everything real and durable; mostly buildable NOW without owner
  accounts; the final cutover needs the owner's VPS.
- **M30 — Owner Live-Verification Sprint** (Part 1A): I guide, the
  owner provides accounts in checklist order; every item closed
  with live evidence or a documented platform refusal.
- **M31 — Commercial Readiness Pack** (Part 2.2 + C5/C6): what a
  paying-customer launch actually needs.
- **M32 — Advertising Stretch Pack** (Part 2.3 + C3), then the
  Inbox Depth / Activation packs as M33+ if wanted.
- Wallet/Managed Accounts stay parked until the owner explicitly
  reopens them with a policy/legal review.

## What NOT to do next (deliberate)
- No new feature verticals before M29/M30: the product's risk is
  no longer missing features — it is that nothing has run against
  real accounts or survived outside the sandbox.
- No wallet/managed-accounts work without the legal/policy pass.
- No invented "growth" metrics or demo data in production paths —
  the standing honesty rules apply to every pack above.
