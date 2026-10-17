# MX13 — Telegram Broadcast Channel: Acceptance

Branch `messaging-advanced`, base HEAD `9027b089` (MB1–MB4 + MX12).
Local commits only — nothing pushed.

Telegram joins Email/SMS/WhatsApp/Push as a fifth broadcast channel on
the MX1 recipient-table engine (and, free via the shared send choke
point, on the legacy snapshot engine too). Sends go through a
registered port owned by the Inbox module's TelegramService; the
subscriber base is the org's Telegram Inbox conversations; STOP/START
in a Telegram chat writes the same MS2 preference store the WhatsApp
hook uses.

## Step-0 audit (verified against the tree before building)

- The Inbox Telegram channel is real: `apps/api/src/inbox/channels/telegram.service.ts`
  — `TelegramClient` (Bot API via fetch; a send counts only with a
  `message_id`), `TelegramAdapter implements ChannelAdapter`
  (verifyCredentials via getMe), credentials sealed (encryptJson) in
  Integration rows, connect endpoint `POST /inbox/connect/telegram`
  (OWNER/ADMIN), and `telegram-webhook.controller.ts` is a real
  inbound path: webhook → `TelegramService.handleWebhook` →
  `InboxService.ingestExternalMessage` → `processInboundIntelligence`,
  the SAME dispatch WhatsApp flows through. Social Posts' Telegram
  posting is a different feature and was not touched.
- **Correction to the plan's wording (recorded as instructed):**
  `BotSession` is the order bot's per-conversation state machine
  (ask_product / ask_quantity / …, keyed by unique conversationId).
  It is NOT a subscriber registry and MX13 resolves nothing from it.
  The real subscriber base is Inbox `Conversation`
  (`ChannelConversation`) rows with channel="telegram" — Telegram
  bots cannot initiate contact, so every subscriber has messaged the
  org's bot and has such a row; the row carries the chat id as
  `externalContactId` plus `customerId`/`leadId` linkage where the
  inbox identified the sender. The schema even enforces
  `@@unique([organizationId, channel, externalContactId])` — one
  conversation per chat id per org.
- The MX6 WhatsApp hook lives in `processInboundIntelligence`
  (inbox.service.ts): STOP/START match is exclusive of keyword
  campaign matching and writes the MS2 preference store via
  `MessagingService.handleInboundKeyword` (which returned
  `{ matched, action }` and was whatsapp-only). MX10's opt-in
  keyword hook sits in the same block. Telegram inbound reaches
  this exact dispatch, so the hook CAN be carried — see the
  STOP/START verdict below.
- `TelegramClient.sendMessage` was text-only; the Bot API's
  `reply_markup.inline_keyboard` with URL buttons is documented,
  real behaviour — the client call was extended with an optional
  third parameter (existing callers byte-identical).

## Shipped

### 1. Channel `telegram` end-to-end (recipient-table + legacy snapshot engines)

- Every hardcoded channel gate in `messaging.service.ts` that MX12
  extended for push now also accepts `telegram`: compose-check,
  preview, create, preference-address validation, preference import.
- Create rules (all honest 400s at create, never discovered
  mid-send): no message templates, no WhatsApp template inputs, no
  subject (Telegram messages have none — a non-empty subject is
  refused, not silently dropped), body required and ≤ 4096 chars
  (the Bot API's own hard cap), personalization refused (MX8
  dynamic blocks could silently overflow the 4096 cap — the MX12
  push precedent), audience must be one the conversation resolver
  can express.
- Content: message text + optional inline URL buttons
  (`telegramButtons`: ≤ 4 buttons, label 1–64 chars, https URL
  ≤ 2048 chars — `validateTelegramButtons`, one shared rule for
  create + edit, DTO shape-only like the cascade precedent).
- Edit (PATCH) supports telegramButtons + the merged-row
  invariants (body ≤ 4096, no subject); clone and recurrence
  chaining copy telegramButtons (content, like pushUrl in MX12).
- The legacy snapshot path comes free exactly as push did: the
  chat id rides in the snapshot Json (`telegramChatId`) and both
  process loops pass it + the broadcast's buttons into the shared
  `sendToRecipient` choke point.

### 2. The telegram send port (registered-port pattern, MX12 precedent)

- `TelegramSendPort` in messaging: `sendTelegram(orgId, { chatId,
  text, buttons? }) → { outcome: "sent", messageId } | { outcome:
  "failed", error }`. Messaging imports no inbox code and never
  touches the sealed bot credentials.
- Registered by `TelegramService.onModuleInit` (it gained an
  optional 4th constructor argument, `@Optional() MessagingService`
  — existing 3-arg constructions in specs keep working; InboxModule
  already imports MessagingModule, so no cycle).
- Port implementation (`TelegramService.sendForMessaging`): finds
  the org's earliest CONNECTED telegram Integration, decrypts its
  sealed token, builds `reply_markup.inline_keyboard` (one button
  per row) when buttons exist, and calls the extended
  `TelegramClient.sendMessage`. It NEVER throws: no connected bot →
  failed "No connected Telegram bot for this organization…";
  Telegram rejections → failed with Telegram's real description
  verbatim (the client throws `Telegram: <description>`, e.g.
  "Telegram: Forbidden: bot was blocked by the user", "Telegram:
  Bad Request: chat not found"); a response without a message_id →
  failed. Messaging additionally refuses to record "sent" if a
  port ever claims sent without a messageId.
- Absent port (InboxModule never booted) → every telegram send
  fails per-recipient with "Telegram send port is not available in
  this deployment…" — never a fake success. Spec-proven.
- Delivery `sent` ONLY with the real message_id, stored as the
  delivery's `providerMessageId`.

### 3. Audience resolution rule (THE rule, as shipped)

Recipients resolve from `ChannelConversation` rows with
`organizationId = org` and `channel = "telegram"` — never from
contact address fields, never from BotSession:

- chat id = trimmed `externalContactId`; blank ⇒ skipped.
- Dedupe per chat id (resolver-side Set; the schema unique is the
  backstop). Dedupe key `telegram:<chatId>` — one customer who
  talked to the bot from two chats is two reachable chats.
- Audiences honestly limited to what conversation linkage
  supports: `telegram_subscribers` (all — anonymous conversations
  as recipient type `telegram`, id = conversation id, name =
  contactName ?? "Telegram subscriber"; linked ones upgraded to
  their real customer/lead), `customers` (customerId → a real
  Customer row), `leads_stage` (leadId → a real Lead whose stage
  equals audienceStage; audienceStage REQUIRED — telegram has
  leadId linkage, unlike push), `segment` (linked customer in the
  computeRfm segment). `custom` / `saved` / `csv` are REFUSED:
  their definitions are keyed on email/phone addresses and a chat
  id is neither — resolving them against chats would fabricate an
  audience.
- All resolver stages apply unchanged with channel `telegram`,
  address = chat id: suppression (incl. the new Telegram STOP),
  pending exclusion, topic choices, per-contact + org frequency
  caps, previous-recipient and recent-days exclusions (the
  recent-days stage's address pick now reads telegramChatId).

### 4. STOP/START verdict — HOOKED, end-to-end (evidence below)

- `MessagingService.handleInboundKeyword` now serves whatsapp AND
  telegram (same preference store; channel = the inbound channel;
  address = phone for WhatsApp, chat id for Telegram; source
  `inbound_keyword`). Telegram's own `/start` command ALSO counts
  as START → opted_in: it is the message every subscriber sends to
  open the bot, so a (re)start is a real opt-in signal. `/start`
  is telegram-only — NOT added to the shared reserved set, so
  WhatsApp behaviour is unchanged (spec-pinned both ways).
- The inbox dispatch gained a telegram block right after the
  WhatsApp block: best-effort `.catch(() => undefined)`, never
  changes the message flow, never sends a reply.
- **One honest difference from WhatsApp, by design:** on WhatsApp
  a STOP/START match is exclusive of campaign matching; on
  Telegram there is no campaign matching to exclude (MX6 keyword
  campaigns are WhatsApp-only, and the opt-in keyword hook is
  WhatsApp-shaped), and `/start` must NOT consume the message —
  it is the order bot's first contact. So the telegram hook's
  only effect is the preference write; the order bot / auto-reply
  downstream still see the message, exactly as they do for every
  non-keyword WhatsApp message. Recorded here rather than
  pretending the exclusivity is identical.
- Spec-proven end-to-end (`mx13-telegram-channel.spec.ts`): STOP
  via the hook → preference row (telegram, chat id, opted_out) →
  resolve excludes the chat (excludedSuppressedCount) → a sent
  broadcast never calls the port for it and records no delivery
  for it; START reverses; STOP then `/start` reverses too; the
  dispatch wiring itself is pinned in
  `mx13-telegram-hook.spec.ts` (hook called with
  `("org-1", "telegram", chatId, text)`; campaign handler never
  invoked for telegram; a throwing hook cannot break ingest).

### 5. Report

- Funnel: sent/failed real; delivered/read null (the Bot API has
  no read receipts for bot messages — the pre-existing
  non-whatsapp rule already yielded null; MX13 extends the same
  null discipline to clickedRecipients/totalClicks, which are
  null for telegram exactly like whatsapp/push); cost null (no
  org-entered telegram rate exists anywhere — buildCostEstimate
  returns null with the standard reasoning, never an invented
  figure). Replies stay whatsapp-only (null for telegram).
- The report's broadcast object carries `telegramButtons`
  (additive, like MX12's pushUrl).
- Preview samples mask chat ids (never a full id); preview shows
  no cost figure for telegram.

### 6. Quiet hours + resume (MX3/MX1) cover telegram — spec-proven

- The MX3 quiet-hours gate lives in `processBroadcast` before
  either engine, so telegram defers identically: spec proves
  `deferred: "quiet_hours"`, zero port calls, all rows pending.
- Resume: spec proves a partial run (maxEntries) followed by a
  second process touches only pending rows — exactly one port
  call and one delivery per chat, confirmed recipients never
  re-sent.

### 7. Test send — supported, stated honestly

Unlike push, telegram CAN be test-sent to a typed address: the
compos
...[truncated 6638 chars]