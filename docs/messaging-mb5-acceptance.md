# Messaging Advanced MB5 (MX12 + MX13 + MX14) — Batch Acceptance

Status: CODE-COMPLETE in worktree `~/workspace/ai-marketing-saas-mx`,
branch `messaging-advanced`, base `2216c8fa` (MB4 head). **Local
commits only — nothing has been pushed.** No live provider proof
anywhere in this batch (M30 still owed); the three MB5 migrations
have NOT been run on any real DB (fresh-Postgres proof only, in the
Gates section below). No real push was sent, no real Telegram bot
was messaged, and no live shop customer has seen an on-site
notification — all three channels are proven at the code/spec/fresh-
DB level only, over mocked provider seams exactly like the rest of
the MX package.

Per-item detail: [messaging-mx12-acceptance.md](messaging-mx12-acceptance.md) ·
[messaging-mx13-acceptance.md](messaging-mx13-acceptance.md) ·
[messaging-mx14-acceptance.md](messaging-mx14-acceptance.md)

## Commits

| Item | Commits |
|---|---|
| MX12 | `497c6e80` API: push channel end-to-end + registered port + migration · `9027b089` web composer + acceptance doc |
| MX13 | `d8e3d096` Telegram broadcast channel — conversation-resolved audiences, registered send port, STOP/START hook, inline URL buttons |
| MX14 | `0c584cd7` API: onsite channel end-to-end + shop customer notification center API + specs + migration · `59ed8f3e` web composer + shop account notification tab + acceptance doc |
| Gate fix | `145379a1` MX14: the 3 shop notification routes registered in the GB9 frozen public-route inventory (see Gates) |
| MB5 | this doc |

## Step 0 — audit findings (before any MB5 code was written)

- **Channel plumbing.** `channel` is a string gated by hardcoded
  `["email","sms","whatsapp"]` checks in ~10 places in
  `messaging.service.ts`; the audience resolver derives per-channel
  addresses from contact rows; `CASCADE_CHANNELS` in `cascade.ts`
  is the MX2 cascade subset. Each MB5 channel extended those gates
  in the same shape; each new channel's identity rides on
  `BroadcastRecipient` (+ the legacy snapshot Json via the shared
  `sendToRecipient` choke point, so the legacy engine came free for
  all three channels).
- **Push base (AX16).** `WebPushSubscription` is org-scoped
  (endpoint/p256dh/auth, `customerId` NULLABLE, status
  active|gone); the VAPID keypair is per-org, generated once,
  private key sealed. BUT `WebPushService.deliverTo()` is private
  and bound to its own `WebPushCampaign`/`WebPushDelivery` simple
  broadcaster — a second, parallel system. Verdict: Messaging does
  NOT write WebPushCampaign rows and does NOT fork the campaign
  system; it consumes a **registered `PushSendPort`** (the MS8/MX6
  port pattern), and deliveries are Messaging `MessageDelivery`
  rows. Anonymous subscriptions exist (no customer link) — the
  resolution rule below is honest about that.
- **Telegram base.** The Inbox owns a real Telegram bot channel
  (`inbox/channels/telegram.service.ts`): sealed Integration
  credentials, `connect/telegram`, a webhook controller (a REAL
  inbound path), and `TelegramClient.sendMessage` returning a
  `message_id` — a send counts only with one. **Correction to the
  plan's wording:** `BotSession` is the order bot's
  per-conversation state machine, NOT a subscriber registry. The
  subscriber base is `ChannelConversation` rows with
  channel="telegram" (Telegram bots cannot initiate contact, so
  every subscriber has a conversation carrying the chat id).
  Social Posts' Telegram posting is a separate feature and was not
  touched.
- **On-site surface.** NO customer-facing notification center
  existed (only `OrderNotification*` transactional records,
  `AgentNotification` for staff, `NotificationPreference`). MX14
  therefore built the smallest real version: a notification store,
  authenticated customer list/read APIs, and a storefront
  account-area tab. Shop customer auth is real (EC25 phone-OTP
  `ShopSession`, org-scoped Customer) — verified before building;
  `OrderNotification*` untouched.
- **Cascade verdict (all three channels): NONE joins
  `CASCADE_CHANNELS` in v1**, each for evidenced reasons recorded
  per item: push identity is per-subscription, not a per-person
  contact address, and the cascade content model has no push
  payload slot (MX12); the cascade attempt runner's Recipient /
  hasAddress model has no telegram identity and its content slots
  are sms/email/whatsapp only (MX13); the cascade model is
  spec-pinned to contact-address attempts and an on-site attempt
  is a DB write into the customer's own center, not a
  fallback-able address attempt (MX14). An enabled cascade on a
  push/telegram/onsite broadcast is refused at create by
  `parseCascadeConfig`.
- **Costs.** None of the three channels has an org-entered rate;
  all three follow the package convention — cost `null` with the
  standard note, never an invented figure. On-site's report
  wording is "no provider cost" (genuinely zero, not a 0 rate).

## MX12 — Web Push Channel (migration `20261019060000_mx12_push_channel`)

- Channel `push` end-to-end on the recipient-table engine (+legacy
  snapshot path free via the shared choke point). Recipients
  resolve ONLY from ACTIVE `WebPushSubscription` rows: audience
  `push_subscribers` (all active, incl. anonymous), `customers`
  (identified only, one recipient per subscription — dedupe key
  `push:<subscriptionId>`), `segment` (RFM via customerId). Gone
  rows never resolve. A push subscription is treated as consent
  for PUSH ONLY.
- Sends go through the registered `PushSendPort`
  (`WebPushService.onModuleInit`); the payload is exactly
  `{title, body, url}` — all the shop service worker renders (the
  base system's own title ≤120 / body ≤300 caps enforced at
  create; `pushUrl` shop-relative only). 404/410 marks the
  subscription `gone` inside the port; no WebPushCampaign rows are
  created; absent port → per-recipient honest failure, never a
  fake sent.
- Funnel: sent/failed real; delivered/read/opened/clicked all
  `null` (browser push has no reliable signal — clicked was fixed
  from a would-be 0 to `null`). All resolver stages (suppression,
  pending, topic, frequency) apply with the endpoint as the push
  address; the MX3 quiet-hours gate covers push (spec-proven).
  Specs: mx12 16/16 + port 5/5.

## MX13 — Telegram Broadcast Channel (migration `20261019060100_mx13_telegram_channel`)

- Channel `telegram` end-to-end (+legacy path free). Recipients
  resolve from telegram `ChannelConversation` rows only — never
  from contact fields, never from BotSession; dedupe per chat id.
  Audiences: `telegram_subscribers`, `customers`, `leads_stage`,
  `segment`; `custom`/`saved`/`csv` refused honestly.
- Sends go through the registered `TelegramSendPort` (org's
  earliest CONNECTED telegram Integration, sealed token); the
  client's `sendMessage` was extended with optional
  `reply_markup.inline_keyboard` for URL buttons (validated:
  ≤4 buttons, label 1–64, https URL ≤2048; existing callers
  byte-identical). A delivery is `sent` ONLY with a real
  message_id (stored as providerMessageId); failures carry
  Telegram's real description verbatim (403 blocked, 400 chat not
  found). Delivered/read `null`; cost `null`.
- **STOP/START is hooked end-to-end:** `handleInboundKeyword`
  generalized to whatsapp+telegram over the same MS2 store
  (source `inbound_keyword`); Telegram's `/start` also counts as
  START (telegram-only; WhatsApp unchanged, spec-pinned). Specs
  prove STOP → preference row → resolve excludes → port never
  called; START reverses. One honest difference: no
  campaign-exclusivity on telegram (keyword campaigns are
  WhatsApp-only, and `/start` must still reach the order bot).
  Specs: mx13 16/16 + hook 8/8.

## MX14 — On-site Notification Channel (migration `20261019060200_mx14_onsite_channel`)

- Channel `onsite` on both engines. Recipients = the org's
  CUSTOMERS only (a phoneless/emailless customer still resolves —
  the identity is the customer row); leads/custom/saved/csv
  refused at create and resolve. All resolver stages apply with
  address = customer id.
- Send = create `OnsiteNotification` rows: the delivery is written
  first with status `delivered` + `deliveredAt`, the notification
  links it via `deliveryId @unique`; a notification-create failure
  removes the delivery and records honestly. **Delivered-stage
  reasoning:** delivered is REAL here — the record's presence in
  the customer's own notification center inside this system is
  observed, not provider-assumed; read is real (shop open stamps
  the notification AND the linked delivery); opened/clicks stay
  `null`; cost `null` with "no provider cost" wording. Resume is
  proven two ways (partial process; direct choke-point re-send
  returns sent with no second notification/delivery).
- Shop side (behind the real EC25 ShopSession auth):
  `GET /public/shop/:orgSlug/account/notifications` (own only,
  newest-first, unreadCount), `POST …/notifications/read-all`,
  `POST …/notifications/:notificationId/read` (another customer's
  id returns the same 404 as a missing one; idempotent). The shop
  account page gained a Notifications tab with an unread badge;
  click marks read then follows the URL verbatim. Specs:
  mx14 14/14 + shop 5/5.
- **Process note:** the first MX14 worker died in a daemon restart
  mid-item with coherent uncommitted partial work in the tree
  (schema + migration + the service block). The replacement worker
  inspected the diff piece by piece, verified it sound (migration
  hand-checked column-by-column against the final schema), kept
  ALL of it, and built the missing shop side, dashboard, and specs
  on top. Nothing was discarded and no behavioural correction was
  needed; the two honest limits it recorded (segment names not
  pre-validated — unknown segment resolves to zero customers, no
  fabrication; workflow onsite sends carry `broadcastId=null` so
  the unique anchor does not dedupe them, broadcasts always carry
  one) are in the MX14 doc.

## Gates (coordinator-run, serially)

- **API jest (full): 501 suites / 5,649 tests.** Method: grouped
  by `src/` directory, `--runInBand`, 4 GB heap, jest cache +
  `TMPDIR` on the workspace disk (the MB3/MB4-proven driver), the
  machine shared with a parallel track throughout. The main
  grouped run recorded 393 suites / 4,370 tests; four groups were
  OOM-killed under the shared load (`src/ai`, `src/commerce`,
  `src/messaging`, `src/campaigns` — empty summaries, `Killed` in
  the log) and were rerun separately, all green: messaging
  28/466, commerce 24/392, ai 24/187, campaigns 32/234. Suite
  total: 393 + 28 + 24 + 24 + 32 = 501 = every spec file on the
  tree (495 at MB4 + exactly the 6 new MB5 spec files); test
  total 4,370 + 466 + 392 + 187 + 234 = 5,649. Messaging group
  delta vs MB4 (25/420) is exactly MX12's 16 + MX13's 16 + MX14's
  14 new tests.
  - Failures in the main run: 5 tests in 4 suites, adjudicated:
    - `connections/cc26-payout-automation` (1) — the known
      pre-existing failure; solo rerun still fails (1/9), as at
      every prior batch gate.
    - `admin/adx3-nav-counts` (1) — **proven pre-existing, not an
      MB5 regression:** the spec fails identically (1 failed /
      6 passed) on the pristine MB4 base `2216c8fa` run by the
      coordinator at this gate. MB4's gate earlier the same day
      recorded it green, so it is time-/environment-sensitive;
      MB5 touched no admin code. Left as found, recorded here.
    - `inbox/inbox-power` "M12 whatsapp window" (1) — solo rerun
      passes 18/18 (and MX13's scoped inbox run was 578/578 on
      this tree); load flake under the shared machine, not a
      failure of the tree.
    - `public-docs/gb9-public-docs` (2) — a REAL MB5 miss the
      drift guard exists to catch: MX14's three new public shop
      routes were not in the frozen route inventory. Fixed in
      `145379a1` by deliberately extending the inventory per the
      GB9 convention (comment-tagged MB5/MX14); solo rerun 7/7.
  - **Final API jest verdict: GREEN except the two pre-existing,
    adjudicated failures (cc26, adx3-nav-counts).**
- **API tsc (`npx tsc --noEmit`): clean** — a completed run
  printed zero diagnostics (one repeat run was interrupted by a
  runtime abort and is not counted). The single spec-file error
  the MX14 worker reported mid-work (`customers/ec-cp6-erasure`)
  did not reproduce in the coordinator's completed run.
- **Web vitest: 83 files / 706 tests, all pass** (same totals as
  MB4 — MB5 web work added no new vitest files).
- **Web tsc: clean (exit 0).**
- **Next build (apps/web): green** — compiled in 33.5 s, static
  pages 93/93, `/dashboard/messaging` at 55.7 kB (MB4: 52.8 kB —
  the growth is the three new channel composers).
- **Prisma validate: valid.**
- **Fresh-Postgres migrate deploy: 224/224 migrations applied
  cleanly** (`All migrations have been successfully applied.`) on
  a brand-new empty cluster created for this gate; 325 public
  tables afterwards (324 at MB4 + `OnsiteNotification`); verified
  in the fresh DB: `Broadcast.pushUrl` + `telegramButtons` +
  `onsiteUrl`, `BroadcastRecipient.pushSubscriptionId` +
  `telegramChatId`, and the full `OnsiteNotification` table.
  Environment note: the sandbox has no system Postgres; the gate
  used embedded PostgreSQL 18.4 binaries fetched for this run
  (prior batches used a 16.15 build since removed) — the proof is
  that the full 224-migration chain applies cleanly from empty,
  unchanged in meaning.

**Batch gate verdict: GREEN** — with the two pre-existing,
base-adjudicated failures (cc26, adx3-nav-counts) disclosed above,
the GB9 inventory miss found and fixed in-batch, and no live proof
claimed anywhere.

## NOT BUILT / honest limits (batch-wide; per-item evidence in the per-item docs)

- **Cascade membership for all three new channels** — evidenced
  per item above; cascade-enabled push/telegram/onsite broadcasts
  are refused at create.
- **MX12:** push image/icon/action buttons (the shop service
  worker renders only title/body/url); push templates;
  `leads_stage`/`custom`/`saved`/`csv` audiences for push
  (subscriptions carry customerId only); preference-center push
  toggle (the center is email/phone-token addressed; browser
  unsubscribe → gone and dashboard endpoint preferences are the
  real paths); typed-address test send; MX11 suppression-apply
  for push.
- **MX13:** multiple Telegram bots per org (the port uses the
  earliest CONNECTED integration — the inbox channel's own
  resolution); MX11 suppression-suggestion apply for telegram
  (keyed by email/phone); preference-center link issuance for
  telegram; telegram message templates and AI drafts for telegram
  (drafts are email|sms by design); HTML/parse-mode formatting
  (plain text only).
- **MX14:** onsite in MX10 opt-in forms / preference-center
  surfaces and MX11 suppression suggestions (those surfaces are
  address-channel-shaped; the preference STORE fully enforces
  onsite); onsite as a workflow/journey step channel; a separate
  shop notifications route or header bell (the account tab is the
  surface); a dashboard-side read receipt beyond the funnel's
  real read stage.
- **Package-wide:** no live proof (no real push subscription,
  Telegram bot, or shop customer has been exercised — M30 owed);
  the 3 MB5 migrations have run only on the fresh gate cluster,
  never a real DB; per-org job enablement
  (`broadcast_send_sweep`) still owner-owed.
