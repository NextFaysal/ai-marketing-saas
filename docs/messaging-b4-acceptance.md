# Messaging Power — Batch B4 Acceptance (MS7 Delivery Lifecycle + Reports, MS8 Automation Bridge)

Date: 2026-10-13 · Worktree: `~/workspace/ai-marketing-saas-ms` (branch `ms-package`) · Base: B3 HEAD `19185eb`
Commits: `7d5be17` (MS7 schema) · `2cd87c3` (MS7 lifecycle + report + deliveries v2) · `c054ca2` (MS8 schema) · `f2c4297` (MS8 bridge) · `817aa86` (MS7+MS8 specs) · `51ed5d7` (web)
Local commits only — **not pushed** (owner-only push rule).

## Gate (B3 baseline → B4 final)

| Check | B3 baseline | B4 final |
|---|---|---|
| API jest | 220 suites / 2054 tests | **222 suites / 2091 tests** (+37: MS7 22, MS8 15) |
| API `tsc --noEmit` | clean | clean |
| Web vitest | 148/148 | **148/148** (no web-test changes this batch) |
| Web `tsc --noEmit` | clean | clean |
| Next build | green | green |
| Prisma validate | valid | valid |

Flake record (not hidden): the baseline run of this batch showed 2 failures in
`inbox/cx3-debounce.spec.ts` — the known pre-existing timing flake whose root cause is
still open since the CX package; standalone re-runs failed twice then passed 18/18.
The first B4 final full run showed 1 failure whose suite name was not captured
(tail-only output); the two subsequent full runs are both completely green
(222/222 suites, 2091/2091 tests), and the neighbouring-area run
(messaging + workflows + inbox + automation: 71 suites / 674 tests) is green.

## MS7 — Delivery lifecycle

1. **Schema (migration `20261013160000_ms7_delivery_lifecycle`).** `MessageDelivery`
   gains `deliveryStatus` (null | delivered | read | failed), `deliveredAt`, `readAt`,
   `openedAt`, plus an index on `(organizationId, providerMessageId)`. The columns are
   deliberately SEPARATE from the send-outcome `status` (sent | failed | skipped):
   B1's final-status math reads `status` and is untouched (spec-pinned: a webhook
   update never changes `status`).

2. **WhatsApp webhook → broadcast deliveries.** Broadcast WhatsApp deliveries carry the
   Meta message id (wamid) in `providerMessageId`. The parser
   (`webhook.parser.ts`) now also extracts Meta's `errors[0]` (title +
   `error_data.details`) onto failed WhatsApp status events — other statuses/channels
   produce byte-identical events. In `InboxService.handleWebhook` the existing
   ChannelMessage path runs FIRST and unchanged; only when NO ChannelMessage matches
   does it call, best-effort, `MessagingService.applyWhatsAppDeliveryStatus` through
   the already-injected optional `MessagingService` (the MS2 keyword-hook precedent),
   wrapped so any failure (including a pre-migration database without the MS7
   columns) can never break webhook processing. Broadcast matches deliberately do
   NOT increment `statusesApplied` — that counter still describes the inbox path.
   **Monotonic rule (locked, spec-pinned):** delivered(1) < read(2); an update applies
   only when it strengthens the current state; `read` also stamps `deliveredAt` when
   absent; `failed` applies ONLY from the untouched (null) state — a failed arriving
   after delivered/read never erases their timestamps, and once failed, later
   delivered/read are ignored (Meta's failed is terminal for that message). A failed
   update carries the webhook's error text when present. `sent` statuses are ignored
   (the send outcome already recorded acceptance). Timestamps are server receive
   times; Meta status events carry no per-status timestamp the parser keeps.
   All of this is proven through the REAL signed `handleWebhook` path, including the
   no-match case and the ChannelMessage-wins case.

3. **SSL Wireless DLR — VERIFY-FIRST outcome: (c) no documented API → no polling.**
   Evidence (checked 2026-10-13): the public mirror of SSL Wireless's Push SMS API V3
   guide (github.com/codernayeem/payment-sms-courier-api-docs — the same mirror family
   B2 used for the send API) documents exactly three endpoints (send-sms,
   send-sms/bulk, send-sms/dynamic) and status codes for the SEND response only. The
   send response's `smsinfo[].reference_id` is described as an SSL-generated tracking
   id, but **no endpoint, parameters, or status vocabulary to retrieve a delivery
   report** by csms_id or reference_id is documented anywhere public; the
   django-sslwireless-sms package (built against the ISMS Plus v3 API) likewise
   exposes only send functions. Therefore **no `broadcast_dlr_sweep` job exists** and
   nothing pretends to poll. The SMS funnel honestly ends at sent/clicked;
   `delivered`/`read` for SMS are null (see §4). Tenant gateways (BulkSMS BD /
   AlphaSMS) expose callback-style DLR in their ecosystems, but wiring per-tenant
   callback endpoints is **out of scope** for this batch and is stated as such in
   the UI and here.

4. **Per-broadcast report** — `GET organizations/:id/messaging/broadcasts/:id/report`:
   - **Funnel** (per recipient, never per delivery row — retries write extra rows):
     audience/sent/failed/skipped from the MS1 snapshot progress; delivered/read/
     opened aggregated from delivery rows by recipient key; clicked from
     `MessageLinkClick` (distinct recipientKey + total clicks). **A stage a channel
     cannot produce is `null`, never 0:** delivered/read only exist for WhatsApp
     (webhooks); email has no delivered signal over SMTP and platform SMS has no
     DLR (outcome (c) above), so both are null there; opened exists only for email
     broadcasts WITH an htmlBody (the pixel — text-only mail reports null);
     clicked is null for WhatsApp (template links are Meta-side, never wrapped by
     MS5) and real for email/SMS.
   - **Failure reasons:** failed delivery rows grouped by a pure normalization
     helper (`delivery-report.ts`): emails → `<address>`, UUIDs → `<id>`, long digit
     runs → `<number>`, remaining digits → `<n>`, whitespace collapsed, capped at
     80 chars; top 10 + an `other` bucket.
   - **A/B** (when `abGroupId`): both variants' funnels plus a winner SUGGESTION
     `{ basis: "readRate" | "clickRate" | null, leader: "A" | "B" | null, note }` —
     read rate preferred, click rate as fallback; leader is null when either
     variant sent < 30, when the rates tie, or when no comparable signal exists.
     It is a suggestion only: the report mutates nothing and nothing auto-sends
     (spec-pinned).
   - **Revenue:** `{ windowDays: 7, orders, totalMinor, customerRecipients, method }`
     from REAL Order rows of the snapshot's **customer** recipients created in the
     7 days after `sentAt`; cancelled and practice orders excluded; csv/lead
     recipients excluded by construction. `method` is carried in the payload
     verbatim: "প্রাপক কাস্টমারদের পাঠানোর পর ৭ দিনের অর্ডার (সম্পর্ক, কারণের প্রমাণ নয়)"
     — an association, never a causation claim. Null when never sent.
   - **Replies:** WhatsApp only — conversations (matched by normalized phone
     against `ChannelConversation.externalContactId`) holding ≥1 inbound message
     after `sentAt`, counted per conversation, with `repliesMethod` labelling the
     method in the payload. Other channels get `replies: null`, never an invented
     number.
   - **UI:** a 📊 রিপোর্ট panel per broadcast row renders the funnel with the
     null stages shown as "এই চ্যানেলে পাওয়া যায় না" plus a per-channel honesty
     note (SMTP has no delivery signal / SMS has no documented DLR / WhatsApp
     clicks are Meta-side), failure reasons, the A/B suggestion, and revenue +
     replies WITH their method labels.

5. **Email open tracking.** Broadcast HTML email gains a 1×1 pixel at the end of the
   HTML part: `${apiPublicUrl()}/public/messaging/open/<token>` where the token
   follows the MS5 HMAC pattern (new `open-token.ts`, purpose `"msg-open"`, payload
   { orgId, broadcastId, recipientKey }, recipientKey = the locked MS5 definition).
   **URL rule (locked):** the pixel uses `apiPublicUrl()` — the MS5 redirect
   precedent — i.e. it is inserted with the localhost fallback when
   `API_PUBLIC_URL` is unset, NOT skipped; if the token cannot be signed the mail
   still sends without a pixel. The pixel is independent of the link-tracking
   toggle (that toggle governs link rewriting per B3's locked rule; with the
   toggle OFF authored links stay verbatim AND the pixel still rides — spec
   -pinned). Text-only emails and workflow sends never carry a pixel.
   `GET /public/messaging/open/:token`: a verified token stamps `openedAt` on the
   matching delivery (found by walking the broadcast's deliveries and deriving
   each row's key with the same rule — exact for email, the only pixel channel)
   on FIRST hit only, then serves the transparent GIF with no-cache headers; a
   bad token is a plain 400 — no write, no image.

6. **Deliveries v2 + export.** `GET broadcasts/:id/deliveries` keeps its legacy
   behaviour byte-unchanged when no filter params are present (bare array, take
   200 — the controller passes opts only when a param exists). With
   `?status=&q=&cursor=`: status filter + address substring search + cursor
   pagination (cursor = createdAt + id, page size 50, `{ items, nextCursor }`,
   IN9 precedent; the cursor walk is spec-proven lossless across createdAt ties).
   `GET broadcasts/:id/deliveries/export` (OWNER/ADMIN) returns CSV (address,
   channel, status, deliveryStatus, providerMessageId, error, createdAt) walked
   in chunks, capped at 10000 rows with a `# truncated` first line when more
   exist, and audit-logged (`broadcast.deliveries_export`) — the
   `exportPreferencesCsv` discipline. The UI panel carries the search/filter/
   load-more controls and the export button.

## MS8 — Automation bridge

1. **Schema (migration `20261013170000_ms8_recurring_journeys`).** `Broadcast`
   gains `recurrence Json?` (`{ freq: "daily"|"weekly", interval int 1..52,
   weekdays?: int[] 0–6, endsAt?: ISO }`) and `recurrenceGroupId String?` (+ index).

2. **Recurrence semantics (locked).** Strict validation by the pure
   `messaging/recurrence.ts` (unknown freq/shape/keys ⇒ 400 at create AND at
   schedule; `CreateBroadcastDto` and `ScheduleBroadcastDto` both accept it, the
   schedule endpoint can also clear it with an explicit null; A/B variants share
   one generated `recurrenceGroupId`, the abGroupId precedent). The chain runs
   through the EXISTING engine: `processBroadcast` — the one finalize point every
   path (sweep, manual send, resume, retry) flows through — calls
   `chainRecurrence` best-effort on finalize (status sent | partial | failed).
   The next occurrence is computed from the finalized instance's ORIGINAL
   `scheduledAt` (a manual one-off send of a draft anchors on its `sentAt`), so
   the chain never drifts by processing delay: daily = +interval days; weekly =
   +interval weeks; weekly with `weekdays` = the first listed weekday strictly
   after the anchor inside an occurrence week (occurrence weeks are every
   interval-th week starting with the anchor's week); an occurrence landing
   exactly ON `endsAt` still fires, the first one after ends the chain. The next
   instance is a FRESH broadcast — same name (no suffix), same
   content/audience/settings, NO snapshot (its audience re-resolves at its own
   prepare, so suppression/opt-outs/frequency cap are evaluated fresh), status
   "scheduled", holding the recurrence + the same group id; the finalized row's
   recurrence is cleared — **exactly one pending instance per group, ever**
   (spec-pinned across two chain hops). A PAUSED or CANCELLED instance never
   finalizes, so its chain ends there (documented + spec-pinned). Cancelling a
   schedule does NOT clear a recurrence — the chain waits until the broadcast is
   scheduled or sent again. Weekdays are Asia/Dhaka calendar days (fixed UTC+6,
   no DST; whole-day arithmetic on instants preserves the Dhaka time-of-day).
   **Known interaction (found by this batch's own spec, documented not hidden):**
   the MS2 frequency cap is a rolling-24h rule — a daily chain whose instances
   would fire <24h after a previous send to the same recipients can be fully
   capped at prepare; prepare then refuses with the honest exclusion error, the
   sweep records it, and the instance stays "scheduled" for a later sweep rather
   than dying silently or chaining. That is the locked MS2 behaviour applied
   consistently, not a B4 regression.

3. **Journey presets.** Catalogue in the pure module `messaging/journey-presets.ts`
   (5 presets): `post_purchase_thanks` (order_created → wait 30m → send_email),
   `post_purchase_thanks_sms` (order_created → wait 30m → send_sms),
   `delivered_review_ask` (order_delivered → wait 1440m → send_sms),
   `cart_recovery` (cart_abandoned → wait 60m → send_sms), `lead_followup`
   (lead_created → wait 4320m → send_email). **Preset audit (each checked against
   the producers + the engine):** order events carry an orderId and
   `enrichContext` fills customerId/orderNumber, so `resolveRecipient` finds the
   customer; cart contexts carry contactPhone/contactEmail (+ itemsSummary /
   cartValue) and resolve to a contact-based recipient — the SMS sends when a
   phone exists and fails honestly when it does not; lead contexts carry the
   lead's email/phone. Every template variable used is one the real context
   supplies. **`winback_sweep` was DROPPED and replaced by `lead_followup`**,
   exactly as the brief directs: the `schedule` trigger's context is
   `{ date, scheduledFor, dayOfWeek }` — no recipient at all — so its send step
   could only ever fail with "No recipient could be resolved"; a preset that
   cannot run is worse than none. `delivered_review_ask` carries **no review
   link**: a real link needs a per-order ReviewRequest token
   (`ReviewsService.reviewLinkFor`) that the order_delivered workflow context
   does not supply, so the copy asks for a plain reply instead of inventing a URL.
   **Install path (locked):** `GET messaging/journey-presets` lists the
   catalogue; `POST messaging/journey-presets/:key/install` (WRITE_ROLES) creates
   (a) a REAL `MessageTemplate` row via `createTemplate` (names prefixed
   "Journey: …", editable Bengali starter copy, subjects on email templates) and
   (b) a Workflow through the REAL `WorkflowsService.create` — the engine's own
   validator checks the preset shape and the template's existence — then sets it
   **enabled: false** via `WorkflowsService.update`, mirroring `installPreset`
   (a human reviews before it acts). The install is audit-logged
   (`messaging.journey_preset_install`); installing twice creates a second
   template set + workflow (no silent dedupe) and the response names the created
   workflow id. **DI:** there is no forwardRef in this codebase and the module
   dependency runs one way (workflows → messaging), so `WorkflowsService`
   REGISTERS itself into `MessagingService.registerWorkflowCreator` on module
   init through a `WorkflowCreatorPort` interface — messaging never imports
   workflows. With no engine registered, install refuses honestly:
   "Workflow engine is not available in this deployment" (the AutomationService
   optional-service precedent). MS8's spec registers a REAL WorkflowsService, so
   every preset's shape is proven against the real validator, and one full
   journey run (order.created → wait → resume) proves an opted-out recipient's
   send step is SKIPPED via `sendToRecipient` with the provider never called —
   MS2 suppression applies to journeys end-to-end.
   **UI:** a Journey Presets card section renders the catalogue (Bengali cards
   with the real trigger → wait → send flow), an install button per preset, and
   a result note naming the created workflow id + template and linking to
   `/dashboard/workflows` with the starts-disabled explanation. The broadcast
   form gains recurrence controls (shown when scheduling: freq / interval /
   weekday checkboxes / endsAt) and broadcast rows show the recurrence summary
   + group membership.

## Deviations (with reasons)

1. **Chaining lives in `processBroadcast`, not only in the sweep.** The brief's
   sweep-first framing assumed the sweep is where finalization happens, but
   manual sends / resume / retry finalize outside it, and the brief also
   requires a manual one-off send of a recurring draft to continue the chain.
   `processBroadcast` is the single finalize point all paths share, so the
   chain hook sits there (best-effort, after the finalize write) and the sweep
   inherits it unchanged — its return shape is untouched.
2. **Open pixel is NOT gated on the link-tracking toggle.** The brief asked to
   check MS5's precedent and stay consistent: MS5's locked rule scopes the
   toggle to LINK REWRITING ("OFF ⇒ links go out exactly as authored"). Opens
   are lifecycle, not link rewriting, so the pixel rides whenever a broadcast
   HTML part exists; the pairing is spec-pinned (toggle OFF ⇒ verbatim links
   AND pixel present) and the rule is stated in §5 above.
3. **Replies count = conversations with ≥1 inbound reply** (the brief's wording
   names conversations-of-recipients as the counted unit), not raw message
   count; the payload's `repliesMethod` states the matching method.
4. **`endsAt` boundary:** an occurrence scheduled exactly ON endsAt fires
   (candidate ≤ endsAt). The brief said "before endsAt"; the inclusive reading
   matches what a merchant picking an end date expects, and it is pinned by
   spec + stated in §2.
5. **Legacy deliveries mode is selected by the ABSENCE of the opts argument**
   (the controller passes opts only when a query param is present), so an
   explicit `{ cursor: undefined }` from a service caller is paged mode. HTTP
   behaviour is exactly as briefed either way.

## Honest limits

- **Migrations `20261013160000_ms7_delivery_lifecycle` and
  `20261013170000_ms8_recurring_journeys` have NOT been run on any real
  database.** Deploy = run both migrations + `prisma generate`, enable the
  per-org `broadcast_send_sweep` job (recurrence rides it), manual Dokploy
  Redeploy. The webhook path is deliberately safe pre-migration (best-effort +
  swallowed errors), but lifecycle columns only exist after MS7's migration.
- **No live provider proof (M30 still owed).** WhatsApp delivered/read depends
  on real Meta webhooks against a live WABA; the open pixel depends on real
  mail clients fetching images (many clients block remote images — opens will
  undercount in production and the report cannot fix that); recurrence
  chaining is proven against the sweep with fixture times, not a live
  scheduler over real days.
- **Email delivered/read do not exist by design** (SMTP offers no signal) and
  **SMS delivered/read do not exist** until SSL Wireless documents a DLR API
  (verify-first outcome (c)) or tenant-gateway DLR callbacks are built as a
  separate batch. The funnel shows nulls, never estimates.
- **Revenue is association only** — orders by snapshot customers in a fixed
  7-day window, labelled as such in the payload and the UI; it is not
  attribution and must not be quoted as "this broadcast earned ৳X".
- Recurrence weekdays are Asia/Dhaka calendar days; an org in another
  timezone gets Dhaka weekdays (the platform's standing timezone
  convention). Interval is capped at 52 by validation.
- The `cx3-debounce` flake's root cause remains open (see the gate note);
  it is pre-existing, intermittent, and unrelated to this batch's changes.
