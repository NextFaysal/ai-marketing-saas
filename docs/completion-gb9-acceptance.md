# GB9 — Completion Acceptance (GC21 Merchant Trust + GC22 Plan Enforcement + GC23 API & Support)

**Batch:** GB9, the FINAL batch of the E-Commerce Completion Program.
**Line:** `completion` branch, `~/workspace/ai-marketing-saas-gc`, base HEAD `d0a9ec8` (GB8).
**Migration:** `20261013990000_gb9_platform_completion` (the last of the claimed 20261013900000+ range).
**Commits (10, local only — NO push):**
`e696115` schema+migration · `e51a88f` GC21 API · `fe8a209` GC21 web/admin UI ·
`853ebee` GC22 invoice PDF · `925c67f` GC22 limits+enforcement · `02c5b92` GC22 spec + web/admin ·
`9100b5b` GC23 webhooks · `1923359` GC23 docs/support/alerts · `58b6170` GC23 web/admin UI ·
(+ this acceptance + `docs/completion-program-summary.md`).

**Process note (honest):** the original GC22 builder agent died in a daemon restart leaving 19
uncommitted changes and zero commits. A finisher agent audited every hunk against the brief,
found the work essentially complete, and fixed two real defects (below) before committing.
Everything was then re-verified by the coordinator's own full gate (below).

---

## GC21 — Merchant trust

- **Email verification** (`apps/api/src/auth/verification.service.ts`, in AuthModule): 32-byte
  token, SHA-256 hash only at rest, 24h expiry, prior unused tokens expired on re-issue; link
  `${WEB_URL}/verify-email?token=…`; public POST /auth/verify-email; re-click after verification
  returns `{verified:true, alreadyVerified:true}`. Registration fires the email fire-and-forget —
  a mail failure NEVER blocks registration.
- **Phone verification:** `setPhone` canonicalises via ON11 `normalizeBdPhone` (+8801…); changing
  the number resets `phoneVerifiedAt`. OTP mirrors EC25 discipline exactly: hash
  `sha256(userId:code)`, 5-min expiry, 5-attempt cap, 60s cooldown, 3/hour cap → 429, one constant
  Bengali failure message. Sent via the platform `SmsProvider` (Admin Console smsConfig → env
  fallback). **SMS not configured ⇒ nothing is created and the API returns
  `{sent:false, reason:"sms_not_configured"}`** — the UI shows "এসএমএস যাচাই এখন উপলব্ধ নয়".
  Provider failure kills the code and returns provider_error.
- **Gate (the exact rule):** SystemSetting `emailVerificationGate` = `{enforced, since}`;
  absent/invalid = OFF (the machinery ships OFF). When enforced: an authenticated user with
  `emailVerifiedAt = null` AND `user.createdAt >= since` gets 403
  `{code:"EMAIL_VERIFICATION_REQUIRED"}` on non-`/auth/*` routes; users created before `since`
  are grandfathered and never blocked; the check FAILS OPEN on lookup errors; JWT path only.
  NOT built: an admin UI/endpoint for writing this setting (operators set the SystemSetting).
- **Merchant verification:** BusinessProfile gains `tradeLicenseNo` + `businessAddress`;
  `POST /organizations/:id/verification/submit` (OWNER/ADMIN; missing pieces → 400 with a Bengali
  `missing` list) → `pending` + submittedAt + note cleared + audit. Admin
  `POST /admin/organizations/:id/verification` (@AdminTier SUPER,SUPPORT; pending only; reject
  REQUIRES a note; status `rejected` with the note visible to the merchant; resubmit
  rejected→pending; `logAdmin` audit). Badge shows in the merchant's own settings only — the
  storefront badge is future work, per the brief.
- **Storage metering:** `apps/api/src/common/storage-usage.ts` — `storageUsageForOrg()` =
  Σ `MediaAsset.sizeBytes` + asset count (BigInt → string); tenant endpoint
  `GET /organizations/:id/storage-usage`; settings card + admin org row; UI copy exactly
  "মিডিয়া লাইব্রেরিতে রেকর্ডকৃত আপলোড থেকে হিসাব". **Bandwidth is NOT metered anywhere — it is
  hosting-level and no number is shown or faked.**
- **UI:** register-flow note, public /verify-email page, AccountVerificationCard (incl. the honest
  SMS-unavailable state), OrgVerificationCard, a dashboard blocking verification wall when the
  gate is enforced, admin org-detail verification section + storage figure.
- **Specs:** `gb9-gc21.spec.ts` 22/22; touched suites (auth+guards 40/40, organizations+admin
  252/252) green.

## GC22 — Plan enforcement

- **Limits overlay** (`common/platform-settings.ts`): `PLAN_LIMIT_FIELDS` gains OPTIONAL
  `productLimit` / `orderLimit` / `storageLimitMb` / `apiDailyLimit`. Absent ⇒ unlimited; a stored
  integer ≥ 0 wins (0 blocks everything). The existing three fields (aiDaily/broadcastCap/seats)
  are byte-identical — `aa4-plan-limits.spec.ts` passes UNMODIFIED. New helpers:
  `planResourceLimits(prisma, orgId)`, `billingGraceDays(prisma)` (SystemSetting
  `billingGraceDays`, integer ≥ 0, default 3).
- **Enforcement** (`common/plan-limit-checks.ts`): `commerceBlocked` (paused ⇔ latest
  Subscription.pausedAt set; past_due_grace ⇔ PAST_DUE AND currentPeriodEnd + graceDays < now),
  `checkProductCreate` (non-archived count ≥ limit refuses — at-limit boundary spec-pinned),
  `checkOrderCreate` (orders in the current Asia/Dhaka month ≥ limit refuses), `checkMediaUpload`
  (usage + incoming > limit refuses; exactly-at-limit is allowed, +1 byte refuses). All refusals
  are ForbiddenException with a Bengali message naming the limit and current usage.
- **Wiring:** products create → checkProductCreate; `IntegrationsService.upsertOrder` CREATE
  branch ONLY → checkOrderCreate; social.service's two merchant media-LIBRARY entry points
  (`uploadMedia` base64, `uploadMediaStream` — pre-stream probe + post-stream exact-byte check)
  → checkMediaUpload. AI-generated/imported/template/derived uploads count toward usage but are
  NOT refused (documented scoping).
- **Per-source order-block behaviour (verified in code + specs):** shopper checkouts
  (storefront, landings, products single-checkout) convert the block to ONLY the generic
  "দোকানটি সাময়িকভাবে অর্ডার নিতে পারছে না" — no plan/limit detail ever leaks to a shopper;
  Woo pull-loop sync SKIPS the blocked order and continues without advancing the cursor past it;
  Shopify pull-loop likewise; Shopify webhook acks `{processed:"order_skipped_plan_limit"}` (no
  retry storm); Woo webhook records the error via its existing catch-all (no crash); staff
  surfaces (manual orders, POS, CSV import per-row, subscription renewals) see the staff-facing
  Bengali limit message. On an order-limit block ONLY: audit `billing.order_limit_blocked` +
  `createAgentNotification` (type "billing") to ACTIVE OWNER/ADMINs, throttled by an identical
  audit row within 1h, fully failure-isolated.
- **Pause/resume:** tenant `POST /organizations/:organizationId/billing/pause|resume`
  (OWNER-only, audited; pause refuses when there is no subscription or it is CANCELLED) + coherent
  admin endpoints (requireReason + logAdmin + SUPER/FINANCE tier). While paused, the same choke
  points refuse commerce writes. GET billing payload additively gains `resourceUsage` {products,
  ordersThisMonth, storage{usedBytes, assetCount, limitMb}, apiToday (ApiUsageDaily, 0 when
  absent)}, `paused`, `pastDueGraceEndsAt` when PAST_DUE. Grace is consumed by `commerceBlocked`
  (dunning/sweep code untouched). NOT built: pause/resume BUTTONS on the admin billing page
  (endpoints + audited service exist; the tenant web billing page has the controls).
- **Invoice PDF:** one shared `saasInvoiceData` assembly feeds BOTH the existing HTML invoice
  and the new PDF (rendered via the codebase's ONE PDF toolkit — `courier/pdf.ts` `buildPdf` +
  new `saasInvoicePage`). Endpoints: `GET /organizations/:organizationId/billing/invoices/:paymentId/pdf`
  (own invoices only; a foreign payment id → 404) + the admin mirror; web + admin billing pages
  link it. Spec asserts field parity with the HTML invoice + the %PDF header.
  **Bug found and fixed in-batch:** the first build stacked two `@Get` decorators on one
  payments-controller method — NestJS registers only one route, so the brief's invoices-shape
  route would never have been live. Split into two handlers over a shared sender.
- **API limit (GC22.3 audit verdict):** this tree has NO separate merchant developer API +
  API-keys product (AdminApiKey is platform-admin only, AP3 scopes). The public/programmatic
  surface IS the storefront/landing/tracking API, so `ApiUsageDaily` + `apiDailyLimit` apply to
  that surface and `apiToday` is surfaced in billing. A merchant API-keys product is NOT BUILT —
  there is nothing in this tree to hang it on, and inventing one was out of scope.
- **Specs:** `gb9-gc22.spec.ts` (overlay absent/0 semantics, all three checks at limit−1/at-limit,
  pause+grace states, notification throttle, PDF parity) + aa4 unmodified; touched suites
  92 suites / 1,068 tests green in the finisher's run and re-verified in the coordinator's full
  gate below.

## GC23 — API & support

- **Outgoing webhooks** (`apps/api/src/webhooks-outgoing/`): controller
  `organizations/:organizationId/webhooks` (TenantGuard+RolesGuard; writes OWNER/ADMIN). Secret =
  32-byte hex stored via `seal()`, shown EXACTLY ONCE at create/rotate (`secretShownOnce: true`);
  list/get return only `secretSet: true`; audit on create/update/rotate/delete.
  **Event mapping (to the REAL bus vocabulary):** order.created — every creation site emits BOTH
  `order.ingested` (unconditional) and `order.created` (24h-guarded in integrations); canonical =
  order.ingested, claimed synchronously in an in-process map (orgId+orderId, 10-min window); the
  order.created handler defers 25ms so ingested always wins, and created-only sites are still
  covered. order.status_changed ← the existing bus event. **order.paid is a NEW emit** added at
  the two `verified_paid` transition points of `TenantPaymentsService.markVerifiedPaid` (own +
  CC10 platform paths, excluding alreadyProcessed), failure-isolated. **order.returned** — return
  creation emitted NO bus event; the codebase's single creation point (`ReturnsService.createLink`,
  grep-verified as the only `returnRequest.create`) gained a 2-line failure-isolated emit; status
  at creation is "requested".
  **Payloads are PII-minimal** (ids + summary fields; a spec proves customer name/phone/address
  never enter the payload even when present on the order row). Delivery list returns `hasPayload`
  only; the detail endpoint returns the full payload.
  **Delivery:** HMAC-SHA256 `X-Qosprey-Signature: sha256=…` over the raw body, 5s AbortController
  timeout, retries 1m → 5m → 30m → 2h, status `failed` at the 5th attempt. Resend = the same
  delivery row reset to pending (attempts KEPT — documented) + an immediate attempt. Sweep =
  `webhook_delivery_sweep` per-org job (AutomationModule template, 5 min) — **needs per-org
  enablement at deploy**.
  **SSRF discipline:** https-only; `validateWebhookUrl` resolves all DNS records and refuses
  private/loopback/link-local/CGNAT/TEST-NET/metadata ranges + IPv6 ::1, fc00::/7, fe80::/10,
  ::ffff:-mapped v4; literal IPs and "localhost" refused. Checked at create/update AND re-checked
  at every delivery attempt. Documented residuals (in code comments): DNS TOCTOU/rebinding
  window, and the in-process order.created dedupe window (a process restart between the two
  creation emits can double-deliver one order.created).
- **Public API docs** (`apps/api/src/public-docs/`): OpenAPI 3.0 built by Nest metadata
  introspection — **46 routes** across the storefront public API, landings-public and tracking;
  served at GET /public/docs/openapi.json (@Public) + a minimal GET /public/docs page;
  checkout/track schemas hand-written, parameters from introspection. **Drift guard:** a frozen
  46-route inventory spec fails if any documented route is renamed or removed. (A first-pass
  RequestMethod enum mapping error — DELETE/PATCH swapped — was caught against node_modules and
  fixed.) **/v1 alias:** middleware rewrite in main.ts for ONLY /v1/public/shop/*,
  /v1/public/landing/*, /v1/tracking/* (query preserved; a spec proves non-matching paths such as
  /v1/public/shopping are untouched); the unversioned routes are byte-identical.
- **Support completion:** `SupportTicket.category` (billing|technical|account|feature|other,
  default "other"; invalid → 400 at service + DTO), settable at creation (merchant form gained a
  Bengali category select + list chip), admin recategorize via the existing update path, admin
  list gained category column/filter. `firstRespondedAt` is stamped in the SAME update write as
  the first admin reply (a second reply does not move it — spec). SLA: SystemSetting
  `supportSlaHours`, defaults low 72 / normal 24 / high 8 / urgent 4 (per-key fallback; today's
  tickets carry only normal|high); breach computed on read; exposed ONLY in admin payloads (the
  tenant payload omits it — spec); admin filter `?sla=breached` + badge. NOT built: a dedicated
  admin settings UI for SLA hours (set via the admin platform-settings generic JSON editor; the
  key is documented).
- **Payment-failure alert (GC23.4a):** `notifyPaymentFailure(txn)` fires at 7 real
  failure-conclusion points (initiation catch own+platform, SSLCommerz IPN FAILED, bKash
  non-success excluding cancel, ShurjoPay non-1000, aamarPay confirm-failed + fail-POST);
  a CANCELLED payment NEVER alerts. Exactly-once via a conditional `updateMany({failureNotifiedAt:
  null})` claim, then `createAgentNotification` type "billing" to ACTIVE OWNER/ADMINs; fully
  try/catch-isolated.
- **GC23.4 verified-not-rebuilt (citations):** subscription-expiry alerts already exist —
  `sendBillingReminders()` (automation.service.ts ~line 965; 7/3/1-day stages, audit-deduped per
  stage+periodEnd, AgentNotification + email) and `sendDunningReminder()` (~line 928; job
  `dunning_reminders`). Courier settlement mismatch alert already exists — GB8/GC20.3
  (reconciliation.service.ts ~lines 448–486, exactly-once claim; mismatch list computed in
  finance.service.ts ~line 356ff).
- **Specs:** 38/38 new (gb9-webhooks 17, gb9-public-docs 7, gb9-support 9, gb9-payment-failure 5);
  touched existing suites 169/169.

## Gates (coordinator's own final run, exit-code checked)

- **API jest (full): 369 suites / 3,936 tests — ALL PASS, 0 failures.** Run chunked
  (`--runInBand`): chunks 01/03 completed in the first pass (798 + 956 tests); chunks 00/02 were
  killed mid-run by the sandbox OOM killer (SIGKILL, zero test failures before the kill) and were
  re-run in halves to full completion (393+269, 451+283); chunk 04 re-run whole for a clean
  summary (72 suites / 786). Baseline before GB9: 363 suites / 3,848 tests → +6 suites / +88 tests.
- **tsc:** API 0 errors, web 0, admin 0 (exit 0 each).
- **Web vitest: 419/419 pass.** Admin has no test files (passWithNoTests exit 0).
- **Full build:** `pnpm -r build` exit 0 (7 workspace packages, incl. Next builds for web + admin).
- **Prisma:** `validate` clean.
- **Fresh-DB:** throwaway PostgreSQL 16 cluster, `prisma migrate deploy` — **173/173 migrations
  applied, exit 0**; 248 public tables (244 after GB8 + VerificationToken, WebhookSubscription,
  WebhookDelivery, ApiUsageDaily); all GB9 columns verified via information_schema; cluster dropped.

## Deploy notes

- Migration `20261013990000_gb9_platform_completion` has NOT run on any real database.
- Enable the per-org job `webhook_delivery_sweep` for orgs that use outgoing webhooks.
- The email-verification gate ships OFF; an operator enables it by writing the
  `emailVerificationGate` SystemSetting ({enforced:true, since:<ISO date>}).
- `supportSlaHours` and `billingGraceDays` are SystemSettings with the documented defaults.

## Honest limits

- **No live proof for anything in GB9** (the standing M30 debt): no real SMTP send, no real SMS
  (platform provider configured or not), no live webhook delivery to a real endpoint (fetch is
  stubbed in specs; the SSRF screen is unit-proven against crafted DNS answers, not against a
  live rebinding attacker), no real gateway failure exercised the failure alert end-to-end.
- The gate, OTP, webhook and SLA machinery is fixture/spec-proven only; the fresh-DB sequence is
  proven on an EMPTY database only (the real DB carries data — the standing caveat for every line).
- Known residuals, all documented in code/acceptance rather than hidden: in-process order.created
  dedupe window; DNS TOCTOU at delivery; storage metering covers recorded MediaAsset bytes only
  (labelled as such in the UI); admin pause/resume buttons and dedicated settings UIs for the
  gate/SLA settings were not built (functionality exists via endpoints/SystemSetting).
- NO push was made. Release, redeploy, migrations on the real DB, per-org job enablement and all
  live verification remain the owner's calls.
