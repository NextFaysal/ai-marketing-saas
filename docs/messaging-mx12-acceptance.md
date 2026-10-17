# MX12 — Web Push Channel: Acceptance

Item: MX12 (Messaging Advanced, batch MB5). Base HEAD `2216c8fa`
(MB4 close). Worktree `~/workspace/ai-marketing-saas-mx`, branch
`messaging-advanced`. Local commits only — nothing pushed.

Commits:
- `497c6e80` — MX12 API: channel end-to-end on the recipient-table
  engine + registered push port in the webpush module + migration.
- (web + this doc — see git log)

## Step-0 audit (verified against the tree before building)

- Channel gates were hardcoded `["email","sms","whatsapp"]` in
  ~10 places in `messaging.service.ts`. No spec pins the exact
  error text (only `/channel must be/` in ms5-composer.spec.ts),
  so the broadcast-facing gates were extended to
  `"channel must be email, sms, whatsapp or push"`; gates that
  are NOT broadcast channels (templates email|sms, AI drafts
  email|sms, keyword/opt-in channel sets, journey steps) were
  deliberately left unchanged.
- The shop service worker (`apps/web/src/app/shop-push-sw/route.ts`)
  renders EXACTLY `{ title, body, url }` — `showNotification(title,
  { body, data: { url } })`. No icon, no image, no action buttons.
  The base system's own payload (`WebPushService.deliverTo`) is
  the same `{ title, body, url }`. The MX12 payload therefore
  carries title/body/url only.
- `WebPushService.deliverTo()` is private and bound to
  `WebPushCampaign`/`WebPushDelivery`. Messaging creates NO
  parallel campaign system and writes NO webpush rows (see the
  port below).
- `BroadcastRecipient` had no subscription identity and
  `Broadcast` no click-URL field → one additive migration was
  genuinely needed (below).

## Shipped

### 1. Channel `push` on the recipient-table engine (and the legacy snapshot engine)
- `createBroadcast` accepts `push` with honest create-time 400s:
  title required (`subject` carries the notification title),
  title ≤ 120 / body ≤ 300 (the base push system's own caps from
  `webpush.service.ts validateSend`), `pushUrl` shop-relative
  only (the base system's rule, via the new pure
  `validatePushUrl`), templates refused (title/body are written
  directly), WhatsApp fields refused, MX8 personalization
  refused (dynamic blocks could silently overflow the capped
  payload), any enabled cascade refused (verdict below).
- `pushUrl` on non-push broadcasts is a 400; `htmlBody` on push
  is a 400 (existing rule, message extended).
- Prepare writes `BroadcastRecipient` rows with
  `pushSubscriptionId` stamped and the endpoint in `address`;
  process sends each pending row through `sendToRecipient`'s new
  push branch; per-recipient `MessageDelivery` rows carry
  channel `push`, the endpoint as address, and the real outcome.
  The legacy snapshot path carries the same identity in the
  snapshot Json (`SnapshotEntry.pushSubscriptionId/pushEndpoint`)
  and sends identically — it came free via the shared
  `sendToRecipient` choke point, so both engines are supported.
- Resume/retry semantics are MX1's unchanged: a row no longer
  `pending` is never selected again (spec-proven: a second
  process run makes zero repeat port calls).
- Plan cap: recipients are recipient rows, counted by the exact
  MX1 prepare path — nothing new invented.

### 2. The push-send port (registered-port pattern, MS8/MX6 precedent)
- `MessagingService.registerPushSendPort(port)` + `PushSendPort`
  interface (`messaging.service.ts`). Messaging imports no
  webpush code and writes no webpush tables.
- `WebPushService` now implements `OnModuleInit`, injects
  `MessagingService` (@Optional, last arg) and registers
  `{ sendPush }` → its new public `sendForMessaging()`.
  `WebpushModule` imports `MessagingModule` (which imports
  nothing — no cycle).
- `sendForMessaging` (webpush module, the tables' owner):
  validates title/body caps + shop-relative URL; refuses
  (as a `failed` outcome, never a throw, never a fake success)
  when push is disabled for the org, keys are missing, or the
  subscription is missing/not active; sends with the org's
  sealed VAPID keypair via `web-push`, payload exactly
  `{ title, body, url }`; 404/410 → marks the
  `WebPushSubscription` row `gone` **inside the port** and
  returns outcome `gone` with the real error/statusCode;
  other errors → `failed` with the real error. It creates NO
  `WebPushCampaign`/`WebPushDelivery` rows — the broadcast's
  `MessageDelivery` rows are the only record.
- Messaging maps port outcomes: `sent` → delivery `sent`;
  `gone`/`failed` → delivery `failed` with the real reason +
  `(HTTP <statusCode>)` when one came back. Absent port → every
  recipient fails with "Web Push send port is not available in
  this deployment…" (spec-proven; nothing is ever recorded sent).

### 3. Audience resolution rule (THE rule, as shipped)
Recipients resolve **only from ACTIVE `WebPushSubscription`
rows of the org** — `gone` rows are never resolved. A
subscription is consent for **push only**: it never makes a
contact reachable on another channel, and no contact-address
audience ever reaches a subscription. Supported audience types:
- `push_subscribers` (new): every active subscription,
  including anonymous storefront visitors (recipient type
  `push`, id = subscription id, name "Push subscriber") — the
  audience the base AX16 system itself uses.
- `customers`: identified subscriptions only (customerId set
  and the customer row exists), **one recipient per
  subscription** — a customer with two subscribed devices is
  two recipients; the recipient keeps the customer's type/id
  (vars, revenue, frequency keys stay person-level) and carries
  `pushSubscriptionId`/`pushEndpoint` alongside. Dedupe is by
  subscription: `recipientDedupeKey` returns
  `push:<subscriptionId>` for push recipients.
- `segment`: subscriptions whose customerId is in the named
  RFM segment (same `computeRfm` source as the contact path).

All other audience types (`leads_stage`, `custom`, `saved`,
`csv`) are honest 400s at create **and** at resolve:
subscriptions carry a customerId only — there is no lead
linkage to resolve them against (see NOT BUILT).

### 4. Consent / preference / stream enforcement — unchanged stages, push address = endpoint
- The ONE resolver filter (`buildBroadcastRecipientFilter`)
  applies to push exactly as to other channels: previous
  recipients, recent-days window, suppression, pending
  (double opt-in) exclusion, per-contact frequency cap, topic
  preferences. The push channel address everywhere is the
  subscription **endpoint** (`normalizePrefAddress("push")` =
  trimmed as-is; `recipientPrefAddress` reads `pushEndpoint`).
- `sendToRecipient`'s single-send guard (opt-out + pending)
  now covers push too, with the endpoint as address.
- Preference writes for push: dashboard manual add + bulk
  import accept channel `push` with the base system's endpoint
  validation (https URL ≤ 1000) via `validatePrefAddress`.
  The browser-level opt-out already exists in the base system
  (unsubscribe → subscription `gone` → never resolved).
- MX3 quiet hours: the gate lives in `processBroadcast` before
  either engine — push passes through it (spec-proven:
  deferred `quiet_hours`, zero port calls, rows stay pending).
- MX2 cascade: see verdict below.

### 5. Report
- Funnel for push: `sent`/`failed`/`skipped` real (from
  recipient rows); `delivered`/`read` stay `null` (only
  WhatsApp produces them); `opened` stays `null`; **clicked is
  now also `null`** for push (the SW opens the payload URL
  directly — no tracked-link wrap exists), never 0.
- Cost: `buildCostEstimate` returns `null` for push — there is
  no org-entered push rate anywhere, so no figure is shown
  (the existing missing-rate convention), in preview and report.
- Report's broadcast object gains `pushUrl` (additive).
- Preview sample masks endpoints to `origin/***` — a full
  endpoint never appears in a preview.

### 6. Composer (web, tabbed Messaging page kept as-is)
- Channel select gains "🔔 Web Push"; choosing it defaults the
  audience to `push_subscribers`. Push fields: Title
  (maxLength 120), Body (generic field), optional click URL —
  and an honest note that the notification carries ONLY
  title/body/url (no image/buttons — the SW ignores them), who
  the recipients are, that push must be enabled in Web Push
  settings, and that no cost figure exists.
- Cascade section is hidden for push (with a one-line note);
  the create payload never sends a cascade for push. The AI
  draft block is hidden for push (the draft endpoint is
  email/sms-only). A/B stays available (variant B title/body).
- Broadcast edit: push broadcasts edit Title + pushUrl + Body
  (server re-validates the merged row: title required, caps,
  shop-relative URL; explicit null clears pushUrl). Clone and
  recurrence chaining copy `pushUrl` (it is content).
- Report card: push-specific honest note (null stages explained,
  410 behaviour, no rate). Test-send row for push broadcasts
  explains the Web Push panel test-device path instead of an
  address input (server also refuses typed-address test sends
  for push with that explanation).
- Preview: the no-cost note is push-specific; sample rows label
  anonymous recipients "Push Subscriber".

### 7. Migration
`20261019060000_mx12_push_channel` (additive, no backfill):
`Broadcast.pushUrl TEXT`, `BroadcastRecipient.pushSubscriptionId
TEXT`. Channel columns are plain Strings and gain the value
`push` with no DDL. `prisma validate` passes (with a
`DATABASE_URL` present). The migration has NOT run on any real
DB (coordinator's fresh-PG gate covers it).

## Cascade verdict — push does NOT join CASCADE_CHANNELS in MX12
`CASCADE_CHANNELS` stays `email|sms|whatsapp`, and a push
broadcast with any enabled cascade is refused at create by the
existing `parseCascadeConfig` (push is not a cascade channel and
the primary must be included). Reasons, from the code:
- Cascade attempts are per-recipient **contact-address** sends:
  the runner decides an attempt order per person and records a
  chain per recipient row. Push identity is per-**subscription**
  (one person = several independent recipients), so "fall back
  for this recipient" has no single meaning — a failed device
  falling back to the person's email is a different decision
  than the cascade models, and silently treating it as one
  would mis-record the chain.
- The cascade content model has slots for smsBody / email
  subject+body / whatsappTemplateId — there is no push payload
  slot (title/url), and inventing one inside `CascadeConfig`
  would change a spec-pinned pure module's contract for a
  combination no surface can yet author.
MX14's brief revisits cascade for on-site; the batch doc
carries the final verdict.

## NOT BUILT (with evidence)
- **Push image URL / icon / action buttons** — the shop service
  worker renders only title/body/url (`shop-push-sw/route.ts`);
  fields it ignores are not promised anywhere.
- **Push templates** (`MessageTemplate` channel stays
  email|sms) — push broadcasts author title/body directly,
  like the base system's campaigns do; no template surface
  exists for the `{title,body,url}` shape.
- **`leads_stage` / `custom` / `saved` / `csv` audiences for
  push** — `WebPushSubscription` carries `customerId` only;
  there is no lead id or address key to resolve those
  audiences against (schema at `WebPushSubscription`,
  packages/db/prisma/schema.prisma). Refused honestly at
  create + resolve instead of silently widening.
- **Preference-center push toggle** — the MX10 center is
  token-addressed by email/phone and manages those channels'
  rows; a push endpoint is not derivable from that token's
  contact. Push opt-out paths that DO exist: browser
  unsubscribe (subscription → gone) and dashboard manual/import
  preference rows keyed by endpoint, both enforced by the
  resolver.
- **Typed-address test send for push** — push reaches browser
  subscriptions, not addresses; refused with the pointer to
  the base system's test devices (Web Push panel).
- **MX11 suppression-apply / engagement channels for push** —
  those surfaces key contacts by email/phone channels; push
  suppression is available through the preference store above.
  (Unchanged code; recorded here so the gap is explicit.)

## Scoped gates (this item only; full gates are the coordinator's)
- `mx12-push-channel.spec.ts`: **16/16 pass** — create
  validation (title/URL/audience/cascade), validatePushUrl,
  resolution (active-only, gone skipped, per-subscription
  dedupe, customers-only identified, preview masking + null
  cost), preference stages (opted-out + pending excluded by
  endpoint; addPreference endpoint validation), send via port
  (rendered title/body/url, channel-push deliveries), 410 →
  failed + real reason, port absent → all fail honestly,
  resume never re-sends, quiet-hours deferral, funnel nulls,
  test-send refusal.
- `mx12-push-port.spec.ts`: **5/5 pass** — registration,
  payload shape, no campaign/delivery rows, 410 marks the
  subscription gone, 500 leaves it active, disabled/missing/
  gone/external-URL honest failures. `ab7-webpush.spec.ts`
  re-run alongside: still green (23/23 in that file).
- Full messaging suite (scoped): **26 suites / 436 tests,
  all pass** — no existing messaging spec changed.
- API `tsc --noEmit`: clean. Web `tsc --noEmit`: clean.
  Web vitest: no new web helper was added (page changes are
  inline JSX); `shop-push.test.ts` re-run 11/11 pass.
- Prisma schema validate: valid.

## Deviations
- One migration was needed (see §7) — the brief allowed it
  ("only if schema is genuinely needed"); the two columns are
  the minimal honest storage for the push click URL and the
  per-subscription recipient identity.
- The legacy snapshot engine supports push too (it came free
  through the shared `sendToRecipient` choke point once
  `SnapshotEntry` carried the subscription identity) — the
  brief required only the recipient-table engine; the snapshot
  behaviour is additive and covered by the same send-path code.
