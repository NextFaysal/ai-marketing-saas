# MX15 — Deliverability, Reputation & Governance: Acceptance

Item: MX15 (Messaging Advanced, batch MB6 — first item; the
Step-0 audit below covers ALL of MB6 and is written for the
MX16 worker to lift). Base HEAD `9e1958f7` (MB5 close).
Worktree `~/workspace/ai-marketing-saas-mx`, branch
`messaging-advanced`. **Local commits only — nothing pushed.**
No live provider proof (M30 still owed); the MX15 migration has
NOT been run on any real DB.

Commits:
- `8e0812e1` — API: governance service + pure modules + DTO/
  controller + schema/migration `20261019070000_mx15_governance`.
- `71661e8b` — specs (`mx15-governance.spec.ts`, 22 tests).
- `5d98a80b` — web: health section, checklist v2 panel, seed
  list, approval queue/actions, governance settings fields,
  per-broadcast cap in the composer.
- (this doc)

---

## MB6 Step-0 audit (ALL of MB6 — recorded before MX15 code)

### 1. Delivery/health data; sender health; suppression today

- **`MessageDelivery`** (schema.prisma, MS1/MS7/MX2):
  `status` = the send outcome (`sent|failed|skipped`, written by
  the engine; `providerMessageId` = proof of provider
  acceptance, null = not sent; `error` = the provider's real
  reason verbatim) and a SEPARATE post-send lifecycle:
  `deliveryStatus` (`null|delivered|read|failed`), `deliveredAt`,
  `readAt`, `openedAt`. **There is NO bounce field, NO complaint
  field, and no per-delivery sender field anywhere on the row.**
- **Which channels produce which signals (the funnel rule in
  `broadcastFunnel`, messaging.service.ts):** delivered/read are
  real ONLY for WhatsApp (Meta status webhooks via
  `applyWhatsAppDeliveryStatus`, called best-effort from
  `inbox.service.ts` when a status matches no ChannelMessage)
  and on-site (MX14: the create IS the delivery; a real customer
  open stamps read). Opened = the signed email open pixel
  (`performOpenTracking`) and only for HTML email. Email over
  SMTP has NO delivered signal; platform/tenant SMS has NO DLR.
  Every incapable stage already reads `null`, never 0.
- **MS4 sender health surface:** `getDomainHealth(org)` —
  SPF/DKIM for the tenant From domain (else the platform
  From's) via an injectable DNS TXT resolver; statuses
  `found|missing|unknown|not_checked` (a resolver failure is
  `unknown`, never "missing"). Exposed at
  `GET …/messaging/senders/email/domain-health` and rendered in
  the Sender settings card. It is a DOMAIN view only — no
  rate/aggregate health view existed before MX15.
- **Auto-suppression BEFORE MX15: none exists.** Evidence:
  repo-wide, the only preference writes are unsubscribe link /
  preference center (`setPreference` callers), STOP/START
  (`handleInboundKeyword`, source `inbound_keyword`), manual/
  import (dashboard), signup/double-opt-in (MX10), and MX11
  human-confirmed suppression-apply. `applyWhatsAppDelivery
  Status` on `failed` only stamps `deliveryStatus="failed"` (+
  the error) — it never wrote a preference. There is **no email
  bounce/complaint webhook endpoint anywhere in the codebase**
  (no SES/SMTP bounce receiver; the email provider is send-only
  SMTP), and no SMS DLR — so the only existing webhook path
  that can carry a hard failure is the WhatsApp status path.
  No suppression THRESHOLDS existed either (no bounce-rate
  auto-pause, no complaint-rate guard).

### 2. The MS5 compose-check — exactly what it validates today

`apps/api/src/messaging/compose-check.ts` (`composeCheck`, pure,
advisory-only, NEVER blocks a send; `POST …/compose-check`,
WRITE_ROLES): (a) spam-trigger words from the fixed lists
`SPAM_WORDS_EN` (8 phrases) + `SPAM_WORDS_BN` (4 phrases) over
subject+body; (b) shouting subject (>60% uppercase letters,
≥10 letters); (c) link stuffing (>3 links via `findLinks`);
(d) missing email subject; (e) SMS parts >3 (`smsSegments`);
(f) body >10,000 chars. Warnings are `{code, message}` in
Bengali. It does NOT check URL validity, tracked-link
membership, per-recipient variable fill, or image sizes — those
are exactly the v2 additions (MX15, below), built as an
EXTENSION (`compose-check-v2.ts` calls `composeCheck` and
includes its warnings verbatim — no duplicate validator).

### 3. Roles/permissions; Broadcast status machine; audit log

- Controller `apps/api/src/messaging/messaging.controller.ts`:
  `@PermissionArea("campaigns")` + TenantGuard + RolesGuard on
  the whole controller. **WRITE_ROLES = OWNER, ADMIN,
  MARKETING_MANAGER** — create/send/schedule/pause/resume/
  cancel/retry/test-send/compose-check all take WRITE_ROLES.
  OWNER/ADMIN-only: sender config writes, rates, settings PATCH,
  deletes, preference delete, deliveries CSV export. Reads take
  any authenticated org member the area guard admits.
  Membership: `Membership.role` (enum Role; OWNER 100, ADMIN,
  MARKETING_MANAGER 60 in `common/permissions.ts`), status
  ACTIVE; per-member overrides/custom roles exist but role-list
  endpoints (like messaging's) read the preset role.
- **Broadcast status machine** (schema comment + service):
  `draft | scheduled | sending | paused | sent | partial |
  failed | cancelled`, plus the MS10 `archivedAt` marker
  (archived refuses send/schedule/prepare). Transitions are
  enforced per-method (sendBroadcast / scheduleBroadcast /
  pauseBroadcast / resumeBroadcast / cancelBroadcast /
  retryFailedBroadcast / prepareBroadcast / processBroadcast +
  the `broadcast_send_sweep` body `runDueBroadcasts`, which
  prepares due `scheduled` rows and recovers stale `sending`
  rows). MX15 adds ONE state: `pending_approval` (see below).
- **Audit log:** `AuditService` (`apps/api/src/audit/
  audit.service.ts`) → `AuditLog` rows via
  `audit.log({organizationId, userId, action, entityType,
  entityId, metadata})`; best-effort (a failed insert logs an
  error, never breaks the action); the literal `"system"` actor
  is stored as null userId. Messaging already audits sends,
  schedules, settings updates, test sends, exports, etc.
  (`broadcast.send`, `messaging.settings_update`, …). MX15's
  approval/seed actions audit through this same service.

### 4. Rates / balance

- **Rates (org-entered only):** `MessagingSenderConfig` —
  `smsCostPerPartMinor`, `whatsappCostPerMessageMinor`,
  `emailCostPerMessageMinor`, plus MX9 per-category WhatsApp
  rates (`whatsappMarketing/Utility/AuthenticationCostPer
  MessageMinor`, category wins over flat, resolved by
  `resolveWhatsAppRateMinor`). `buildCostEstimate(org, channel,
  count, body?, waCategory?)` is the ONE estimator: SMS =
  count × parts(`smsSegments(body)`) × per-part rate; WhatsApp
  = count × (category|flat) rate; email = count × rate;
  push/telegram/onsite = **null by design** (no org rate exists
  for them); any missing rate = null (no figure shown, ever).
- **Balance/credit for messaging: NONE exists.** The only
  wallet in the schema is CC10's `WalletAccount`
  (`balanceMinor`, platform-payment money a tenant accumulated
  through the platform gateway + its payout machinery) — it is
  NOT a messaging balance, nothing in messaging reads it, and
  spending it on sends is not a product fact. Loyalty/gift-card
  balances are CUSTOMER instruments (MX8 variables), not org
  messaging credit. **Verdict for MX15 budget governance (and
  for MX16 if it touches cost): caps are SPEND-based, computed
  from org rates × sends, labelled spend-based; there is no
  balance to warn on and "low-balance warning" is NOT BUILT
  (see the NOT BUILT list).**

### 5. Analytics; Touchpoint/AttributionCredit; scheduled reports

- **Available aggregates today:** per-broadcast
  `getBroadcastReport` = `broadcastFunnel` (per-recipient
  sent/failed/skipped from progress; delivered/read/opened
  per-recipient-key from delivery lifecycle fields; clicked
  from `MessageLinkClick` rows) + grouped normalized failure
  reasons (`delivery-report.ts groupFailureReasons`) + revenue
  ASSOCIATION (recipient customers' non-cancelled orders in
  the 7 days after `sentAt` — labelled association, not
  attribution) + WhatsApp replies count (inbound messages in
  matched conversations after send; null for other channels) +
  A/B variant funnels with the `abSuggestion` (suggestion
  only). Cross-broadcast, the MX11 engagement pass aggregates
  ALL of an org's `MessageDelivery` + `MessageLinkClick` rows
  (bounded take 50000) — the precedent MX15's health aggregate
  and any MX16 cross-broadcast analytics should follow.
  `MessageLinkClick` rows are written ONLY by the signed
  redirect endpoint (broadcastId, recipientKey
  `type:id|address`, final URL) — workflow sends are never
  rewritten, so clicks exist for broadcasts only.
- **`Touchpoint`** (schema ~line 3174): a WEB-visitor tracking
  row — `visitorId`, nullable unique `sessionId`, UTM
  source/medium/campaign/content/term, clickIdType
  (fbclid|gclid|ttclid) + clickId, landingPage, referrer,
  `occurredAt`. It is written by the storefront tracker, keyed
  to a Visitor — **it carries NO broadcastId, NO recipient key,
  NO message/delivery reference.**
- **`AttributionCredit`**: one row per (order, model,
  touchpoint) — `orderId`, `model` (FIRST_TOUCH | LAST_TOUCH |
  LAST_NON_DIRECT | LINEAR), nullable `touchpointId` (null =
  the unattributed credit row), `revenueMinor` allocated under
  that model. It attributes ORDER revenue to WEB touchpoints.
- **Honest-join verdict for MX16:** there is **no honest join**
  between a broadcast delivery and a Touchpoint/
  AttributionCredit with the data stored today: no shared key
  exists (delivery = org + customer/lead/address; touchpoint =
  org + anonymous visitorId). The tracked-link click does not
  create a Touchpoint and carries no visitor id. Any MX16
  "attribution" for messaging must therefore stay at the
  existing labelled ASSOCIATION level (the 7-day revenue
  association above), unless MX16 builds a real bridge (e.g.
  stamping a visitor/session on the redirect) — presenting
  AttributionCredit numbers as messaging-caused revenue would
  be fabrication.
- **Scheduled-report system: YES, one exists** — GB8's
  `ScheduledReport` / `ScheduledReportRun` (schema ~line 9066)
  with `apps/api/src/finance/scheduled-reports.service.ts`:
  reportTypes are commerce/finance only (`discounts | refunds |
  payment_sales | category_sales | shipping_cost | profit`),
  cadence daily|weekly, format csv|xlsx, recipients = validated
  email strings, a run counts `sent` only when ≥1 recipient's
  EmailProvider send returns a message id; the sweep lives in
  the automation jobs. **Messaging is NOT one of its report
  types** — MX16's scheduled messaging report would plug in by
  adding a report type + generator to that service (the honest
  integration point), not by building a second scheduler.

### 6. A/B machinery

- **Split:** two Broadcast ROWS sharing `abGroupId`, one per
  variant (`abVariant` "A"|"B"), created together in
  `createBroadcast` (email/sms: variant B subject/body inputs;
  WhatsApp: a second template; B's htmlBody is null by design).
  Assignment is DETERMINISTIC at prepare: hash
  `h=0; for ch of \`${type}:${id}\`: h=(h*31+code)>>>0`, variant
  = `h % 2` (A=0, B=1) — the same hash discipline MX11's
  holdout reuses (`engagement.ts recipientHash`, holdout =
  `h % 100 < percent`, applied BEFORE the A/B split).
  Recipients are materialized per variant row (snapshot or
  BroadcastRecipient rows), so a resumed send never re-rolls.
- **Per-variant funnels:** `getBroadcastReport` computes
  `broadcastFunnel` per variant row + `abSuggestion` (pure,
  `delivery-report.ts`): basis prefers read rate (WhatsApp),
  falls back to click rate; <30 sends on either side, no
  comparable signal, or an exact tie ⇒ leader null with the
  reason. **It is a SUGGESTION only — nothing picks or sends.**
- **Winner-decision hook point for MX16:** the natural seam is
  the chunked send itself — `processBroadcast` /
  `processBroadcastTable` re-read the broadcast row between
  chunks (pause/cancel land there), and prepare is where the
  split is stamped. An auto-winner would have to (a) decide
  from BOTH variant rows' funnels (the report's lite-funnel
  shape is the honest input), (b) act BEFORE the losing
  variant's remaining pending recipients are processed (row
  re-read between chunks is where a "winner decided" flag
  would be observed), and (c) reassign only PENDING recipients
  — sent rows are frozen truth. There is NO existing winner
  flag, threshold, or org setting; MX16 must add them (plan
  D3: default OFF).

### 7. MS9 AI guard path — exact modules MX16 must reuse verbatim

- **Guard:** `MessagingService.checkMessagingAiLimit(orgId)`
  (private, messaging.service.ts) — FIRST
  `killSwitches(prisma).aiDisabledOrgIds` from
  `apps/api/src/common/platform-settings.ts` ⇒ 403 if the org
  is listed; THEN the daily cap: `effectiveLimits(prisma, org,
  {aiDaily: env AI_DAILY_MESSAGE_LIMIT ?? 200, broadcastCap:
  1000})`, counting `AIUsageRecord` rows with
  `feature = MESSAGING_AI_FEATURE` since UTC midnight ⇒ 429 at
  the limit. Both checks run BEFORE any provider call.
- **Feature constant:** `MESSAGING_AI_FEATURE = "messaging_copy"`
  (exported from messaging.service.ts) — copy drafts AND subject
  variants share this one feature/cap/ledger.
- **Usage record:** `recordMessagingAiUsage(org, userId,
  provider, model, inTokens, outTokens, estimated)` — written
  ONLY after a call produced a usable response; an unparseable
  provider answer ⇒ 502 and NO usage record, NO stored draft.
- **Provider:** `messagingAiProvider(org)` →
  `providerForOrg(llm, org)` (`apps/api/src/ai/llm/
  llm.factory.ts`); a real provider named without a key ⇒
  honest 502, never a silent fallback. The non-real (dev)
  provider path returns deterministic template variants LABELLED
  `providerLabel: "dev-template", isRealLlm: false` with the
  Bengali/English notice — never presented as AI output.
- **Returned-only mechanics:** `draftMessagingCopy` /
  `draftMessagingSubjects` (and MX11's
  `draftSegmentFromDescription`, MX6's keyword-hit classify)
  create NO broadcast, template, audience or delivery rows —
  the composer applies a variant only on an explicit merchant
  click (`applyAiVariant` in the web page). MX16's planner /
  translation / subject-scoring outputs must follow the same
  shape: check limit → provider → parse-or-502 → record usage
  → RETURN only.

---

## Shipped (MX15)

### 1. Health dashboard — `GET …/messaging/health?days=`
`getDeliveryHealth` (window clamped 1–90, default 30) over REAL
`MessageDelivery` rows (bounded 50k, newest window by
`createdAt`): per-channel + totals with `sent/failed/skipped`,
`failureRate = failed/(sent+failed)` (null when nothing was
attempted), failure reasons grouped by the MS7 normalizer.
Delivered/read rates are computed ONLY for whatsapp/onsite
(the channels with real lifecycle signals); every other
channel gets `null`. **Bounce/complaint rates are `null` on
every channel with the verbatim note** (no bounce/complaint
signal exists in this system). Per-sender is `null` with the
reason (delivery rows record no sender identity); the MS4
SPF/DKIM `getDomainHealth` result rides along as
`domainHealth`. An unreadable delivery table ⇒
`available:false` with a reason — never invented figures.
Web: a Governance section on the Messaging page (tabbed
structure kept) with the window picker, totals, per-channel
rows, failure reasons, domain status, and all three honesty
notes verbatim.

### 2. Auto-suppression — gap closed on the one existing path
Per audit §1: NO webhook path suppressed anyone before MX15.
The WhatsApp status path now closes the gap CONSERVATIVELY:
when `applyWhatsAppDeliveryStatus` applies a `failed`
transition AND the provider error matches the hard-recipient-
failure patterns (`governance.ts HARD_FAILURE_PATTERNS` —
Meta codes 131026/131030/131047/131051 + unambiguous titles
like "message undeliverable" / "not on whatsapp"), the address
is written `opted_out` into the SAME MS2 preference store
every send path enforces, source `auto_suppression`, with the
error in the note and a consent-history event via
`setPreference`. Template/quality/rate failures never match
and suppress nobody (spec-proven both ways). Everything else
was already-true and is unchanged: STOP/unsubscribe/preference
center suppression pre-dates MX15 (MS2/MX10) and is untouched.
There is no email/SMS path to close — no such webhook exists
(see NOT BUILT).

### 3. Pre-send checklist v2 — `POST …/messaging/compose-check-v2`
`composeCheckV2` (pure, `compose-check-v2.ts`) EXTENDS MS5:
the v1 warnings are included verbatim (`composeCheck` is
called, never duplicated). Five checks, each with `status`
(pass|warn|fail|not_run), a `detail` stating what was found,
and a `verified` line stating what was actually verified:
- **URL_FORMAT** — every link from `findLinks` over
  subject/body/HTML must parse as an absolute http(s) URL.
  Format only — no link is fetched, reachability never
  claimed. No links ⇒ not_run.
- **LINKS_TRACKED** — with tracking on, the tracked set equals
  the found set by construction (the engine wraps every link);
  with tracking OFF it warns that clicks will not be recorded
  instead of claiming tracking. No links ⇒ not_run.
- **VARIABLES_SAMPLE** — the service resolves the supplied
  audience through the SAME resolver + `buildSnapshotVars` a
  send uses (sample ≤5) and renders each `{{var}}` against the
  real vars: empty renders are counted per variable. No
  variables ⇒ pass (nothing can render empty); no sample ⇒
  not_run with the reason.
- **IMAGE_SIZE** — images are extracted from HTML `<img>` +
  image-file links; the check runs ONLY where stored size
  metadata exists. This codebase stores NO image byte sizes,
  so in production today it honestly reports **not_run** with
  that reason (spec proves the metadata-present branch too:
  >1 MB ⇒ warn).
- **SPAM_HEURISTIC** — the MS5 word lists, returned to the org
  verbatim in the response and LABELLED heuristic in both the
  API (`spamWords.label`, each check's `verified`) and the UI.
Web: "Checklist v2 চালান" panel in the Governance section,
driven by the composer's current channel/subject/body/
htmlBody/audience; every check renders its status, detail and
"যাচাই করা হয়েছে" (verified) line, plus the word list.

### 4. Seed/test list — `MessagingSeedRecipient`
Org-maintained rows (channel email|sms|whatsapp|telegram —
push/onsite honestly refused: their test sends cannot target a
typed address, the MS5 refusals), address validated by the
existing `validatePrefAddress` and stored normalized, unique
per (org, channel, address) — a duplicate add returns the
existing row. CRUD at `GET/POST/DELETE …/seed-recipients`
(WRITE_ROLES), audited (`messaging.seed_add/seed_remove`). A
seed is NOT a contact/preference/audience member. One-click
test send: `POST …/broadcasts/:id/test-send-seed {seedId}` →
channel-match check → the EXISTING `testSendBroadcast`
verbatim (same `[TEST]` markers, same test delivery record).
No new send machinery. Web: seed management + a per-seed
"🧪 টেস্ট পাঠান" against a chosen broadcast in the
Governance section.

### 5. Approval workflow — default OFF (owner decision D2)
`MessagingSetting.approvalEnabled` (default **false**; the
settings UI copy RECOMMENDS ON for AGENCY plans and never
forces it). Approver = an ACTIVE OWNER/ADMIN member
(`isBroadcastApprover`, fail-closed). When ON:
- Create by a non-approver ⇒ status `pending_approval`,
  `approvalStatus "pending"` (a planned `scheduledAt` is kept
  on the row). Create by an approver ⇒ ordinary draft/scheduled,
  ungated. A/B pairs and WhatsApp creates share the same base
  objects, so both variants gate together. Recurrence chaining
  re-evaluates: a non-approver creator's next instance is born
  `pending_approval`, never inheriting approval.
- The gate is enforced at `sendBroadcast`, `scheduleBroadcast`
  AND `prepareBroadcast` (the choke point the sweep, manual
  sends and retries share) via `assertApprovalAllowsSend` —
  a pending/rejected broadcast cannot be queued, scheduled or
  sent by any path (the sweep only ever picks `scheduled`
  rows, and a pending row is never `scheduled`). Editing a
  pending broadcast is allowed, and editing its planned time
  can never flip it to `scheduled` (guarded in updateBroadcast).
- `POST …/broadcasts/:id/approve|reject` (controller
  OWNER/ADMIN + service re-check): **four-eyes — the creator
  can never approve/reject their own**, even when the creator
  is themselves an approver (spec-proven by re-stamping the
  row's creator). Approve ⇒ `approved` + approver id/time +
  note, status restores to `scheduled` when the planned time
  is still future, else `draft`. Reject ⇒ `rejected` + note,
  back to `draft` with the schedule cleared and the send gate
  STILL closed; the creator edits and re-submits via
  `POST …/submit-approval`. Every transition lands in the
  existing audit log (`broadcast.approve / .reject /
  .submit_approval`). Queue: `GET …/approvals` + the
  Governance section + inline actions on the broadcast list.
- When OFF: **byte-identical to before** — create stores no
  approval fields at all, no gate runs, and the MX15 spec's
  OFF test sends a MARKETING_MANAGER broadcast end-to-end.

### 6. Budget governance — spend caps only (no invented balance)
Per audit §4 there is no messaging balance figure, so both
caps are spend-based and labelled spend-based in the API
errors and the UI copy:
- **Per-broadcast cap:** `Broadcast.budgetCapMinor` (composer
  input, taka→minor) overriding `MessagingSetting
  .broadcastCostCapMinor`. **Monthly cap:**
  `MessagingSetting.monthlySpendCapMinor` — the month's spend
  is the sum over this calendar month's REAL sent broadcasts
  of `sentCount × org rate` (the same `buildCostEstimate`).
- Enforcement is at the ONE send choke point: `processBroadcast`,
  on a FRESH send only (nothing sent/failed/skipped yet), before
  any provider call — estimate = org rate × planned recipients
  (the recipient total prepare stamped). Over a cap ⇒
  BadRequest with both figures (manual send) or the sweep's
  per-broadcast error record. A partially-sent broadcast
  (resume/retry/stale recovery) is never re-gated — its spend
  already partially happened.
- **Cannot-estimate default (decision, recorded):** when no
  org-entered rate exists for the channel (estimate null —
  always the case for push/telegram/onsite), the check reports
  "cannot estimate" and **ALLOWS with a visible warning**
  (`decideBudget` → `allow_with_warning`, the warning text
  naming the missing rate). Rationale: blocking every send for
  a rate the org was never asked to set would break channels
  that are genuinely free/provider-less; the warning keeps the
  gap visible instead of silently passing. The same default
  covers a monthly figure that is incomplete because some
  sent broadcast this month had no rate.
- Settings PATCH validates caps strictly (null clears, else a
  positive integer of minor units; 0 is refused, spec-proven)
  and the settings view returns the governance fields.

### Migration
`20261019070000_mx15_governance` (additive, no backfill):
`MessagingSetting.approvalEnabled/broadcastCostCapMinor/
monthlySpendCapMinor`, `Broadcast.approvalStatus/approvalNote/
approvedById/approvedAt/budgetCapMinor`, new
`MessagingSeedRecipient` table. `prisma validate`: valid. The
migration has NOT run on any real DB.

## Scoped gates (this item only; batch gates are the coordinator's)

- `mx15-governance.spec.ts`: **22/22 pass** — pure health
  aggregation (null stages), hard-failure classifier,
  decideBudget (allow / cannot-estimate warning / per-broadcast
  block / monthly block / incomplete-month warning), checklist
  v2 pure (URL fail/pass/not_run, tracking-off warn, variables
  not_run/warn/pass, image not_run + metadata warn, spam
  heuristic + v1 warnings verbatim), service health window,
  WhatsApp hard-failure auto-suppression (+ template-failure
  non-suppression), approval OFF byte-identical send, approval
  ON create/send/schedule refusal, approver-create ungated,
  four-eyes (non-approver, self-approval, different approver),
  reject → gate stays closed → re-submit → approve restores
  `scheduled`, settings persistence + zero-cap refusal, budget
  per-broadcast/org-default/monthly blocks with zero deliveries
  on block, cannot-estimate allows + sends, seed CRUD/dedupe/
  validation/channel-match/existing-path test send, checklist
  v2 over a real resolved sample.
- **Messaging jest group (scoped): 29 suites / 488 tests, all
  pass** (MB5 baseline 28/466 + exactly MX15's 22). No existing
  messaging spec changed.
- API `tsc --noEmit`: clean. Web `tsc --noEmit`: clean.
  Prisma validate: valid.

## NOT BUILT (with evidence)

- **Low-balance warning / any balance-based governance** — no
  messaging balance or credit figure exists for an org (audit
  §4: the CC10 WalletAccount is platform-payment money,
  unconnected to messaging). Inventing one was refused; caps
  are spend-based and labelled so.
- **Email bounce/complaint auto-suppression** — there is no
  email bounce/complaint webhook anywhere in this system
  (send-only SMTP provider; no receiver endpoint exists to
  hook). Only the WhatsApp hard-failure path existed, and it
  is the one closed. SMS likewise has no DLR path (MS-package
  evidence, unchanged).
- **Bounce/complaint RATES on the health dashboard** — no
  record carries such a signal, so the rates are `null` with
  the reason stated, on the API and in the UI. (WhatsApp
  post-send failures ARE visible — as failure rate/reasons.)
- **Per-sender health rates** — `MessageDelivery` stores no
  sender identity (tenant-vs-platform path is chosen per send
  and not recorded), so no per-sender figure can be honestly
  computed; the health response carries `perSender: null` with
  the reason plus the SPF/DKIM domain view instead.
- **Image-size verification from real assets** — no asset
  store in this codebase records image byte sizes (product
  rows carry only `imageUrl`), so the check reports itself
  not_run in production today rather than fetching images
  (a network claim it does not make). The metadata-present
  branch is built and spec-proven for when metadata exists.
- **URL reachability checking** — deliberately not run: the
  checklist verifies URL FORMAT and tracked-set membership
  only, and says so; fetching merchant links at compose time
  would be a new network behaviour with its own failure modes.
- **Approval for workflow/journey sends** — the workflow is a
  BROADCAST governance feature (the MX15 brief); workflow
  `send_email/send_sms` steps are a different, already-running
  automation surface and were not gated.
- **MX16** — untouched, per the batch split; the Step-0 audit
  above (points 5–7 especially) is its starting evidence.

## Deviations / decisions

- **Approver definition:** OWNER/ADMIN active members (the
  roles that already own sender/settings writes). The brief
  said "authorised user" without naming roles; a separate
  approver-role system was not invented.
- **Cannot-estimate default = ALLOW with warning** (recorded
  in §6 above, per the brief's instruction to choose and
  record it).
- **Budget gate placement:** `processBroadcast`'s fresh-send
  branch rather than only `sendBroadcast`, so the sweep path
  is governed by the same check; partially-sent broadcasts are
  exempt by design (documented in §6).
- **A blocked scheduled broadcast** stays `sending` after
  prepare (recipients materialized, nothing sent) and the
  sweep records the budget error per run until the cap/rate
  changes — it is never sent silently and never marked sent.
- One migration was needed (approval state, caps, seed table)
  in the assigned slot `20261019070000_mx15_*`.
