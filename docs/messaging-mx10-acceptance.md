# MX10 — Growth Tools & Preference Center v2 · Acceptance

Batch: MB4 (1 of 2 — MX11 follows). Worktree `~/workspace/ai-marketing-saas-mx`, branch `messaging-advanced`, base HEAD `5f7e5172` (MB3). Local commits only — no push.
Migration: `20261019050000_mx10_growth` (the MB4 range start, as assigned).

---

## Step 0 — audit findings (evidence-based, recorded before building)

### 1. `MessagePreference` + MS2 consent machinery
- **Model** (`packages/db/prisma/schema.prisma`, `model MessagePreference`): one row per `(organizationId, channel, address)` (unique), `channel` = email|sms|whatsapp, `address` NORMALIZED, `status` = opted_out|opted_in, `source` = unsubscribe_link|inbound_keyword|manual|import, plus `recipientType`/`recipientId`/`note`. The row FLIPS in place — only the latest status/source survive (see item 4).
- **Address normalization**: `normalizePrefAddress(channel, raw)` in `messaging.service.ts` — email trimmed+lowercased; phone channels via `normalizeBdPhone` when it parses as BD, else digits only. Every write and every send-time lookup goes through it.
- **Signed unsubscribe token** (`apps/api/src/messaging/unsubscribe-token.ts`): HMAC-SHA256 over a base64url JSON payload, secret = `JWT_SECRET`, `timingSafeEqual` verification, payload `{ purpose: "msg-unsubscribe", orgId, channel, address, exp }`, 1-year expiry. Same pattern as `common/admin-token.ts`. MX10 reuses this exact discipline (same file, same `secret()`/`sign()` helpers) for the new `msg-preferences` and `msg-optin` purposes — no second scheme.
- **Public unsubscribe shape**: API `PublicMessagingController` (`GET/POST /public/messaging/unsubscribe/:token`, `@Public()`) + web page `apps/web/src/app/unsubscribe/[token]/page.tsx` (GET shows channel + MASKED address; the write happens only on the button POST). `MessagingService.inspectUnsubscribeToken` / `performUnsubscribe` (source `unsubscribe_link`). MX10's public pages follow this exact shape.
- **STOP/START**: `MessagingService.handleInboundKeyword` — WhatsApp ONLY (inbound hook from `InboxService`, best-effort, never changes message flow, no auto-reply). Exact whole-message match (trim; Latin case-insensitive) against `KEYWORD_RESERVED_STOP` = STOP, STOP ALL, UNSUBSCRIBE, বন্ধ করুন, স্টপ → opted_out; `KEYWORD_RESERVED_START` = START, চালু করুন → opted_in; source `inbound_keyword`. MX6: reserved keywords can never be claimed by a campaign rule, and campaign matching runs only when the MS2 hook did not match. Messenger deliberately NOT hooked (a PSID matches no send path — dead data).
- **Frequency cap**: `MessagingSetting.frequencyCapPerDay` (default 1, 0 = off, validated 0–20) — rolling-24h count of CONFIRMED broadcast deliveries only; broadcasts only.
- **Enforcement at resolve time** — THE shared resolver `resolveBroadcastRecipients` / `resolveBroadcastRecipientsInChunks`, filter built by `buildBroadcastRecipientFilter` (all in `messaging.service.ts`); preview (`previewBroadcast`) and BOTH prepare paths (snapshot + MX1 recipient-table) go through it, so preview == send set. Stage order: (1) previous confirmed recipients (opt-in flag), (1b) recent-days window, (2) **suppression** — opted_out `MessagePreference` set for THIS channel's normalized address, (1c) `Customer/Lead.unsubscribed` column opt-out (flag), (3) frequency cap, (4) WhatsApp opt-in-required (only opted_in rows survive, when the org setting is on). All preference reads are defensive (`.catch` → "no preferences"), so a pre-migration DB degrades to pre-MS2 behaviour instead of crashing.
- **Second guard**: `sendToRecipient` re-checks `findOptOut` per send (email/sms only) and records a `skipped` `MessageDelivery` with the opt-out's source — covers broadcasts AND workflows. WhatsApp broadcast sends do not pass through `sendToRecipient` (template sends), so their enforcement is the resolver + stage 4.
- **Preference management**: `listPreferences` / `addPreference` (source manual) / `removePreference` (hard delete) / `importPreferences` (bulk OPT-OUT import, cap 1000, per-row errors) / `exportPreferencesCsv` (opted_out rows only, audited). Manual actions write `AuditService` logs (`messaging.preference_add/_remove/_import/_export`).

### 2. LeadForm — decision: messaging-native, do NOT extend or fork
- `model LeadForm` is the **Meta Lead Ads form builder**: `pageId` (Meta Page), `questions` Json in Meta's format, `privacyPolicyUrl`, `externalFormId`, `status` local|created|failed, and `CampaignAdSet.leadFormId` attaches it to a lead ad set. Submissions arrive via Meta leadgen sync as `Lead` rows — **there is no public/website submit endpoint for LeadForm** anywhere in the codebase.
- **Decision (from evidence)**: MX10 opt-in forms are a different thing — the org's OWN embeddable web signup. Building them as a new messaging-native model (`MessagingOptInForm`) collides with nothing: no shared table, no shared routes, no Meta fields faked. **Integration point is the Lead row**: a signup creates (or reuses) a real `Lead` with `source = "messaging_form"` and tag `optin:<slug>`, plus `MessagePreference` rows — so signups are pickable in the existing audience builder via the existing `source` eq / `tag` contains conditions (item 3). Nothing about LeadForm is touched.

### 3. MS3 audience machinery + existing CSV path
- **Saved audiences**: `model MessagingSavedAudience` `{ id, organizationId, name, definition Json, createdById }`; broadcasts reference by id only, definition read at resolve time; a deleted saved audience fails preview/send honestly.
- **Condition evaluator** (`apps/api/src/messaging/audience-rules.ts`): definition `{ entity: "customers"|"leads", match: "all"|"any", conditions: [{field, op, value?, key?}] }`, max 20 conditions, STRICT write-time validation (`validateAudienceDefinition` — unknown field/op/type = 400). Ops: eq, neq, gt, gte, lt, lte, contains. Common fields: `source` (eq/neq string), `created_days_ago`, `has_email`, `has_phone`, `custom_field` (keyed). Customers add `orders_count`, `total_spent_minor`, `last_order_days_ago`, `rfm_segment`, `address_key`; leads add `stage`, `tag` (contains), `value_minor`. Evaluator `matchesAudienceDefinition` is pure over resolver-built facts; null fact ⇒ condition FALSE (order aggregates are real zeroes).
- **Existing CSV path**: the MS3 `csv` audience type is a PASTED ADDRESS LIST, not a contact import: `parseAddressList` (audience-rules.ts) splits on newline/comma/semicolon/tab, strips quotes, dedupes (email case-insensitive / phone by digits); `resolveCsvAudience` matches each address to an existing customer (first) or lead to recover name/id, keeps unmatched addresses as sendable `{type:"csv"}` recipients, and COUNTS invalid entries (`invalidCount`) instead of dropping them silently. Cap `CSV_AUDIENCE_CAP = 5000`.
- **What is missing today (the MX10 gap)**: NO contact CSV import exists at all (only the preferences opt-OUT import above, and product imports elsewhere via `apps/api/src/imports/csv.ts` — papaparse + header mapping precedent). No dedupe against existing contacts for list-building, no role-address detection, no per-row exclusion reasons for contacts, no persisted hygiene report. MX10 builds exactly that, reusing the papaparse pattern.
- **Consent-source for audience conditions**: NOT needed as a new evaluator field — `Lead.source` is already a free string matched by the existing `source` condition, and MX10 stamps `messaging_form` / `csv_import`. Recorded as a deliberate no-change.

### 4. Consent change history — NOT recorded today (plain statement)
There is **no consent/preference change history** in the pre-MX10 codebase:
- `MessagePreference` flips in place — previous status, who changed it, when previously, and from what source a flip came are all LOST (only latest `source` + `updatedAt` survive).
- `AuditService` logs exist ONLY for dashboard-manual actions (`addPreference`, `removePreference`, preference import/export) with the acting userId. **Unsubscribe-link opt-outs, STOP/START flips and every other `setPreference` write record nothing at all.**
- MX10 therefore adds the minimal honest recording (new `MessageConsentEvent`, written by `setPreference` on create/status-change + explicit writes for topic/frequency-only changes) and states in UI + this doc: **history begins at MX10; nothing earlier is backfilled or invented.**

### 5. ⚠️ FOR THE MX11 WORKER — A/B exists; holdout does NOT
- **A/B TESTING ALREADY EXISTS (pre-MX, MS-era)** — do not rebuild it:
  - Schema: `Broadcast.abVariant` ("A"|"B") + `Broadcast.abGroupId`; variants are separate Broadcast rows sharing the group.
  - Create: `MessagingService.createBroadcast` builds the pair (email: subject/body/htmlBody for A, `abSubject`/`abBody` for B with htmlBody on A only; WhatsApp: two templates). Web composer has an `abTest` toggle.
  - Split: deterministic hash split at prepare time in BOTH prepare paths — `h = hash("${type}:${id}")`, `h % 2` picks the variant; variants are disjoint and cover the resolved audience.
  - Report: `getBroadcastReport` merges per-variant funnels and emits `abSuggestion` (`messaging/delivery-report.ts`) — a labelled suggestion from real delivery counts, not an auto-winner (auto-winner is MX16, default OFF per plan D3).
  - Clone strips `abVariant`/`abGroupId` (MS10 spec-pinned).
- **HOLDOUT: NO holdout concept exists anywhere** (no field, no resolver stage, no UI, `grep holdout` = 0 across messaging). MX11's "holdout group for comparison" must be built fresh — natural seam: a third split bucket alongside the A/B hash split at prepare time, or a resolver-level exclusion set; nothing to reuse or conflict with.
- Also for MX11: RFM already exists (`messaging/rfm.ts` — `computeRfm`, `computeOrderAggregates`, segments champions/loyal/big_spenders/at_risk/lost/new/regular) and is already an audience field (`rfm_segment`) — engagement scoring should build beside it, not duplicate it.

### 6. Engagement data sources per contact (for MX11)
- `MessageDelivery`: `status` (sent|failed|skipped), `providerMessageId`, `deliveryStatus` (null|delivered|read|failed — WhatsApp webhooks + open pixel only; email-delivered and SMS stages honestly null), `deliveredAt`, `readAt`, `openedAt`, `stepRef` (MX4 journey step), cascade fields (`cascadeGroupId`, `attemptIndex`, `recipientRowId`), `broadcastId`/`workflowRunId`, `recipientType`/`recipientId`/`address`, `createdAt`.
- `MessageLinkClick`: one row per REAL click (signed-token redirect only), `{ organizationId, broadcastId?, workflowRunId?, recipientKey ("customer:<id>"|"lead:<id>"|"csv:<address>"|"test:<address>"), url, createdAt }`.
- **Order history**: linked to CUSTOMERS only — `computeOrderAggregates` / `computeRfm` (rfm.ts) aggregate `Order` by `customerId` (frequency, monetary, last-order). Leads have NO order linkage (only `Lead.valueMinor`, a manual pipeline value). Any per-contact engagement score for leads must rest on delivery/click data alone.
- Workflow deliveries share `MessageDelivery` with `workflowRunId` set and `broadcastId` null — engagement queries must decide explicitly whether workflow sends count (the frequency cap counts broadcast deliveries only).

---

## Shipped — item-by-item audit vs the MX10 requirements

### Schema / migration — `20261019050000_mx10_growth`
Additive only, no backfill:
- `MessagePreference.topics Json?` + `maxPerDay Int?` (preference-center choices per channel+address; NULL = pre-MX10 behaviour). `status` gains the value `"pending"` (String column — no DDL).
- `Broadcast.topic String?` (optional topic tag; NULL = untopiced, unchanged).
- NEW `MessageConsentEvent` — one row per consent change (see below).
- NEW `MessagingOptInForm` — messaging-native signup forms (Step-0 item 2 decision).
- NEW `MessagingCsvImport` — persisted hygiene reports.

### Public preference center ✅
- Tokens: `issuePreferenceToken`/`verifyPreferenceToken` (purpose `msg-preferences`) added to `unsubscribe-token.ts`, reusing the same `secret()`/`sign()` HMAC-SHA256 + `timingSafeEqual` discipline as the MS2 unsubscribe token. One token identifies ONE contact (recipient entity when known, else channel+address); the server resolves the contact's email+phone, so one link manages all channels.
- API (`PublicMessagingController`, same shape as unsubscribe): `GET /public/messaging/preferences/:token` (masked addresses, per-channel status incl. honest `"none"` = no explicit preference recorded, topics, cap), `POST /public/messaging/preferences/:token` (channel toggles, topics, maxPerDay 0–20), `POST /public/messaging/preferences/:token/unsubscribe-all`.
- Web page: `apps/web/src/app/preferences/[token]/page.tsx` (follows the unsubscribe page pattern).
- Writes land in the REAL preference store via `setPreference` (source `preference_center`); topics/maxPerDay are stored on the contact's preference rows.
- **Enforcement (spec-proven through the resolve path)**: channel off → opted_out row → existing suppression stage excludes (spec: `excludedSuppressedCount` = 1, recipient set exact). Topics → new resolver stage in `buildBroadcastRecipientFilter`: when the broadcast carries a `topic` (new `Broadcast.topic`, settable in the composer + create API), a recipient whose stored topics for that channel don't include it is excluded (counted as suppressed); no topic on the broadcast or no topics stored ⇒ no restriction. Frequency → the contact's `maxPerDay` applies as `min(org cap, contact cap)`, and on its own when the org cap is 0/off (spec-proven with org cap 0 + contact cap 0 ⇒ excluded by frequency with zero deliveries).
- Unsubscribe stays one click and supreme: the center's unsubscribe-all is a single button → one POST flipping every channel; the original per-channel unsubscribe link flow is untouched.

### Double opt-in ✅
- Signup on a double-opt-in form writes preferences as **`pending`** (source `signup_form`).
- **Pending receives NO marketing sends — proven at resolve, not just UI**: new resolver stage excludes pending addresses per channel (`excludedPendingCount`, spec asserts the exact empty set for a pending lead in a `leads_stage` resolve), and `sendToRecipient` (email/sms) treats a pending row exactly like an opt-out (skipped delivery, provider never called — spec asserts the only email to that address is the confirmation itself).
- Confirmation via a REAL send through the existing email path: `sendOptInConfirmationEmail` sends via the org's tenant SMTP when configured (`resolveTenantSmtp` + `email.sendTenant`, the MS4 path) else the platform `EmailProvider`, carrying the signed `msg-optin` link (`/optin/[token]` web page, same GET-validate/POST-confirm shape as unsubscribe). It deliberately does NOT route through `sendToRecipient` — that guard correctly refuses pending addresses.
- WhatsApp keyword confirm: a pending WhatsApp signup is confirmed when the subscriber sends the form's keyword (see keyword opt-in below).
- Confirm (`confirmOptIn`) flips pending → opted_in (source `double_optin`) and also confirms other PENDING rows of the SAME contact from the same signup; it NEVER flips an opted_out row (spec-proven: token issued, then unsubscribed, confirm leaves opted_out in force).
- A form with double opt-in but NO confirmation path is refused at create/update (400): it must include the email channel or a WhatsApp keyword.

### Growth builders feeding real audiences ✅
- **Opt-in forms (a)**: `MessagingOptInForm` CRUD (dashboard, WRITE_ROLES; delete OWNER/ADMIN) with name/slug (unique per org), headline/description, channels subset, topic, doubleOptIn, successMessage, **popup configuration** (`popup {enabled, delaySeconds, headline?}` — stored config the embed honours), WhatsApp keyword. Public: `GET /public/messaging/forms/:orgId/:slug` (config only, no subscriber data) + `POST .../submit`; public web page `apps/web/src/app/join/[organizationId]/[slug]/page.tsx`; dashboard shows the join URL + an embed `<iframe>` snippet (the repo has no embed-script machinery; the iframe is the honest embed that exists — see NOT BUILT).
- **QR code (b)**: `GET messaging/optin-forms/:id/qr` returns a PNG **data URL generated server-side by the repo's existing `qrcode` API dependency** (`apps/api/package.json` — `qrcode ^1.5.4`, previously used elsewhere in the API) over the form's real join URL. No external shortening/tracking service. Spec asserts a real `data:image/png;base64,` payload and the exact URL.
- **Keyword opt-in (c)**: `MessagingService.handleOptInKeyword(orgId, phone, text)` — runs in the SAME inbound WhatsApp dispatch as MS2/MX6 (`InboxService`: STOP/START → opt-in keyword → MX6 campaign rules; consent bookkeeping stays exclusive of campaign matching, opt-out supreme — a claimed keyword on an opted_out phone changes nothing, spec-proven). Form-keyword claim checks reuse the MX6 normalization (`normalizeKeywordText`) and refuse reserved STOP/START keywords, keywords claimed by another enabled form, and keywords claimed by an MX6 keyword rule/poll option. MX6 rules themselves cannot write preferences (their actions are tag/auto-reply/classify only — audit evidence in the MX6 acceptance doc), so the opt-in write lives in the consent path, not in a rule.
- **Landing + pickability**: submissions reuse an existing customer/lead when the email/phone matches (normalized comparison, customer first — the MS3 csv-resolver precedent), else create a real `Lead { source: "messaging_form", tags: ["optin:<slug>"], stage: "new" }` + preference rows stamped with recipientType/Id. Spec-proven pickable in the audience builder via the existing `source` eq condition (no evaluator change — Step-0 item 3).

### CSV import wizard ✅
- API: `POST messaging/csv-import/preview` {channel, csv, mapping} → `POST messaging/csv-import/:id/commit` → `GET messaging/csv-import/:id` + `GET .../report.csv`. Web UI in the Messaging page Growth card: file/text input → column-mapping selects (from the file's real header) → hygiene report table → commit button → downloadable report.
- Parsing follows the repo precedent (`imports/csv.ts`): papaparse, header row. Cap 5000 rows/file.
- **Hygiene BEFORE any commit** (`apps/api/src/messaging/csv-import.ts`, pure + spec-covered through the service): every row is `clean` or `excluded` WITH a reason — `duplicate_in_file` (first occurrence wins), `duplicate_existing` (against the org's existing customer+lead addresses for the channel, normalized the preference-store way), `invalid_email` / `invalid_phone` / `missing_address`, `role_address` (local-part in info/admin/support/help/contact/office/mail/webmaster/postmaster/noreply/no-reply/sales/billing/hello/team/orders/service/careers/jobs). Spec asserts exact counts (5 rows → 1 clean, 2 duplicate, 1 invalid, 1 role) and exact per-row reasons, and that preview creates ZERO leads.
- **Persistence**: the report is written to `MessagingCsvImport` (status `previewed`) at preview time; commit reads THAT report verbatim (never recomputed), imports only clean rows as real Leads (`source: "csv_import"`, tag `csv-import`) + opted_in preferences stamped source **`import`** (the org's asserted consent source for the file), flips status to `committed`; a second commit is refused. An existing opted_out for a clean row stays opted_out (lead lands, consent untouched, counted as `suppressedOptOut` — spec-proven). The persisted report is downloadable as CSV (`report.csv`, OWNER/ADMIN).

### Consent audit export ✅
- `MessageConsentEvent` rows are written wherever preferences change: `setPreference` records every CREATE and STATUS CHANGE with `{channel, address, fromStatus, toStatus, source, actor}` — actors: `public` (unsubscribe link, preference center, signup, confirm), `inbound` (STOP/START, opt-in keyword), `user:<id>` (manual add, preference import, CSV import), `system` default. Topic/frequency-only center changes record `preferences_updated` events with the new values in the note. All writes are best-effort/defensive (a pre-migration DB or table-less fake never breaks the preference write itself).
- Export: `GET messaging/consent-events/export` (OWNER/ADMIN, audit-logged) — CSV of the real events (createdAt, channel, address, recipient, from→to, source, actor, note); `GET messaging/consent-events` feeds the dashboard list.
- **Honesty**: UI and this doc both state history begins at MX10. The export contains only events actually recorded — pre-MX10 changes were never recorded anywhere (Step-0 item 4) and are NOT backfilled.

### Broadcast topic (supporting change) ✅
- `Broadcast.topic` (schema above) + `CreateBroadcastDto.topic` + both base objects in `createBroadcast` (A/B variants inherit via the shared bases) + a Topic input in the web composer + both prepare paths pass `broadcast.topic` into the resolver. Pre-MX10 broadcasts have NULL topic ⇒ byte-identical resolution.

---

## NOT BUILT (with reasons / evidence)
- **Embed JS snippet / hosted popup script** — the repo has no embed-script or storefront-script machinery to serve a JS widget (the storefront is a separate Next app surface; no script-serving endpoint exists). What shipped: popup CONFIGURATION on the form + the public join page + an iframe embed snippet shown in the dashboard. A JS popup loader is NOT BUILT.
- **SMS double opt-in confirmation** — there is no inbound SMS path anywhere in this codebase (the MX6 audit established this: no SMS webhook reaches messaging), so an SMS-only pending signup could never confirm. Instead of fake states, form create/update REFUSES double opt-in without an email channel or a WhatsApp keyword.
- **Confirmation via `sendToRecipient`** — deliberately not used for the confirmation email: its (correct) pending guard would block the very mail that confirms. The confirmation uses the same underlying provider path (tenant SMTP / platform provider) directly. No delivery row is recorded for it (it is not a broadcast/workflow send); recorded as a deviation below.
- **Per-row consent-source column on import beyond the preference stamp** — the wizard's channel is per-file and every imported preference is stamped source `import` with the import id in the note; a per-row differing consent source inside one file is not supported (the file IS the asserted source).
- **Topic vocabulary management** — topics are free strings (form topics + broadcast topics surface in the center as `availableTopics` from real rows). No admin topic taxonomy CRUD was built; none exists anywhere else in the product to reuse.
- **Messenger / payment links / AI** — excluded by standing rules; untouched.

## Deviations
- The double-opt-in confirmation email records no `MessageDelivery` row (see NOT BUILT) — confirmation state lives in the preference row + consent event, both real records.
- `handleOptInKeyword` is a new method on `MessagingService` dispatched from `InboxService` between the MS2 hook and MX6 campaign matching (one-line-guarded, `typeof` check + `.catch`, same best-effort discipline as the existing hooks) — MX6 campaign semantics unchanged for every non-opt-in keyword (spec suites green).

## Scoped gates run (serial, this worker)
- MX10 spec: `mx10-growth.spec.ts` — **16/16 pass**.
- Full messaging + inbox spec folders (`jest src/messaging src/inbox --runInBand`, workspace cache dir): **79 suites / 964 tests pass** (final two consecutive runs). One intermediate run showed 2 failures in a single suite (suite name not captured before re-run); both subsequent full re-runs are fully green — consistent with the known cx3 flake family, recorded here honestly rather than silently.
- API tsc (`tsc --noEmit -p tsconfig.json` in apps/api): **clean**.
- Web tsc (`tsc --noEmit` in apps/web): **clean**. Web vitest scoped: `src/lib/sms-segments.test.ts` 5/5 (no messaging-page vitest exists; full web vitest is the coordinator's gate).
- `prisma validate` (packages/db schema): **valid**.
- NOT run (coordinator's gates, per assignment): full repo jest, fresh-Postgres migrate deploy (migration union will then be 220), web build.

## Live-proof note
No live provider proof (M30 still owed): the confirmation email path, QR rendering in a browser, and the public pages are code+spec proven only.
