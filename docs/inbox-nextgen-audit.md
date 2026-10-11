# Inbox Next-Gen — Evidence-Based Audit (Phase A)

Written 2026-10-11 against the owner's 5-step Inbox upgrade plan.
Every verdict below was checked in the real code (file paths +
function/endpoint names), not assumed. Verdicts: **EXISTS** /
**PARTIAL** (what exists + what is missing) / **MISSING** /
**BLOCKED** (platform API limit or standing policy).

Code anchors: web inbox = `apps/web/src/app/dashboard/inbox/page.tsx`
(single 1,506-line page), agent stream client =
`apps/web/src/lib/inbox-stream.ts`; API = `apps/api/src/inbox/`
(`inbox.service.ts`, `inbox.controller.ts`, `inbox.dto.ts`,
`meta-messaging.client.ts`, `channels/`, `webchat.service.ts`,
`realtime.service.ts`, `intent.ts`); schema =
`packages/db/prisma/schema.prisma`.

Central dispatch fact: all agent text sends go through
`InboxService.deliverText()` (`inbox.service.ts:2557`) → WhatsApp =
`MetaMessagingClient.sendWhatsAppText`, Messenger **and Instagram**
= `sendMessengerText` (no IG-specific send function), Telegram /
Email = `ChannelSendService.sendText()` (`channels/channel-send.service.ts:30`),
Webchat = local synthetic id (the row itself is the delivery).
A send counts only when the platform returns a message id;
otherwise the row is marked `failed` and the API throws.

---

## 1. Fixed-height split workspace, per-pane scrolling — **MISSING**

- The page root is a normal document flow (`<div className="space-y-6">`,
  `page.tsx` return). The whole page scrolls.
- The only internal scroll regions are capped boxes: the message
  list is `max-h-[28rem] overflow-y-auto` inside the thread card;
  the notes list is `max-h-44 overflow-y-auto`. The conversation
  list itself has **no** scroll region (progressive rendering via
  IntersectionObserver sentinel, `visibleCount` +40).
- Layout grid: `lg:grid-cols-[300px_minmax(0,1fr)]` /
  `2xl:grid-cols-[300px_minmax(0,1fr)_320px]`; the context column
  drops to a full-width row below the thread on `lg`
  (`lg:col-span-2 2xl:col-span-1`). Mobile uses a `mobileChat`
  list↔thread toggle. Dashboard shell (`dashboard/layout.tsx`):
  sticky 60px topbar, `<main>` `py-5 sm:py-7`, 64px mobile spacer
  above the fixed M60 bottom nav.

## 2. Resizable panels — **MISSING**

- Column widths are hard-coded Tailwind templates (300px list /
  320px context, see item 1). No splitter, no drag logic, no
  persisted widths anywhere in `page.tsx` (grep: no
  `localStorage` width keys, no pointer-drag handlers).

## 3. Composer capabilities

Composer today (`page.tsx` ~line 888): a single-line `<input
id="inbox-reply">`, Enter sends via `POST …/conversations/:id/messages`
(`sendReply`), buttons: ⚡ quick replies, 🛍️ product picker,
🖼️ image-by-URL form, "AI Draft", send.

| Sub-item | Verdict | Evidence |
|---|---|---|
| Drag-and-drop file send | **MISSING** | No `onDrop`/`onPaste`/file input anywhere in `page.tsx`; API has **no upload endpoint at all** — `inbox.controller.ts` outbound routes are only `POST …/messages` (text) and `POST …/messages/image` (`SendImageDto {imageUrl, caption}`, `inbox.dto.ts:45`). `MediaStore.put()` is called only by `captureMessageMedia()` for **inbound** media (`inbox.service.ts:2756`); outbound images are never stored by us — the platform receives the agent's public URL directly. |
| Voice recorder send | **MISSING** | No `MediaRecorder` in web; no audio send in any client (see item 3 truth table below). Inbound voice exists: WhatsApp audio parsed in `webhook.parser.ts`, agent UI plays it (`MediaView`, `page.tsx:101`), transcription via `POST …/messages/:id/transcribe` → `media-intelligence.ts:transcribeAudio()` (providers whisper-1 / Gemini; container assumed `ogg` by default). Telegram inbound voice/photo/document updates are **dropped** (`TelegramService.handleWebhook` ignores non-text); email inbound attachments unhandled. |
| Emoji picker | **MISSING** | No picker component or emoji data anywhere in the web app. |
| Text formatting (bold/italic/bullets) | **MISSING (UI)**; per-channel rendering differs | No formatting buttons; **no conversion code exists in any send path** — no `parse_mode` (Telegram), no `html:` field (email), text passes verbatim everywhere (grep over all send paths: zero hits). WhatsApp renders `*bold*`/`_italic_`/`~strike~`/``` ``` ``` natively on Meta's side; Messenger/Instagram/Telegram/Email/Webchat render the markers **literally**. Webchat widget sets `row.textContent` (`chat-widget.js:bubble()`), so markup is inert there. |
| Canned-response shortcut | **EXISTS** | Quick replies CRUD (`GET/POST/DELETE …/inbox/quick-replies`), composer: typing `/` opens a filter panel and ⚡ toggles the full list (`quickMatches`, `page.tsx`); variables `{{firstName}} {{contactName}} {{phone}}` substituted by `renderQuick()`; insert-then-send-manually semantics. |

**Outbound media truth table (today)** — the only media send is
`InboxService.sendImageReply()` (`inbox.service.ts:2705`), image by
public https URL, and it has **no channel switch**:

| Channel | Image by URL | Audio | File/document |
|---|---|---|---|
| WhatsApp | ✅ `sendWhatsAppImage(link, caption)` | ❌ no client method | ❌ |
| Messenger | ✅ `sendMessengerImage(url)` | ❌ | ❌ |
| Instagram | ✅ (rides the Messenger branch) | ❌ | ❌ |
| Telegram | ❌ — path falls through to Meta credentials and fails with "Messaging integration is not configured"-style errors (no designed unsupported-media error); `TelegramClient` has only `sendMessage` | ❌ | ❌ |
| Email | ❌ (same implicit failure); `ChannelSendService.sendText` is text-only, no attachments | ❌ | ❌ |
| Webchat | ❌ (same implicit failure) | ❌ | ❌ |

## 4. Smart folders (Assigned to Me / SLA breach / VIP / Unassigned) — **PARTIAL**

- List endpoint `GET …/inbox/conversations` → `listConversations`
  (`inbox.service.ts:2246-2276`): filters `status, channel, q,
  unread, assignee, tag, sort` (no DTO class; params read
  individually in the controller). `assignee=me` → own id,
  `assignee=unassigned` → `assignedUserId = null` (`:2255-2257`).
  The web UI already exposes these as a select (সবাই / আমারগুলো /
  অনির্ধারিত) plus unread / spam / tag filters — so **"আমার
  ইনবক্স" and "অনির্ধারিত" exist as filters, not as one-click
  folder views**.
- SLA: **no per-conversation deadline field exists** (grep of
  `schema.prisma` for `slaDueAt|firstResponseDueAt|breached`:
  nothing). `ChannelConversation` stores actuals only
  (`firstResponseAt`, `schema.prisma:918`); the threshold is
  org-level `InboxSetting.slaFirstResponseMinutes` (default 60).
  Breach is computed only as an **aggregate count** in
  `getTeamReport` (`inbox.service.ts:1764-1765`,
  `currentBreaches`), never returned per conversation by the list
  endpoint, and the list has no SLA filter/sort. A breach folder
  is derivable (createdAt + setting + firstResponseAt are in the
  list rows) but does not exist in API or UI.
- VIP / big-ticket: **no value filter or sort in the list**
  (`orderBy lastMessageAt desc`, `take: 100`; only non-default
  sort is in-memory `sort=unread`). Value data exists elsewhere:
  pipeline board cards carry `latestOrderTotalMinor`
  (`getPipelineBoard`, `inbox.service.ts:1451-1504`) and the
  context panel carries lifetime spend — neither is a folder.
  `priority = normal|high` exists on the conversation (set high
  on complaint/negative sentiment) and a manual `vip` tag +
  tag filter is the only current approximation.
- Search `q` matches only `contactName / contactPhone /
  lastMessagePreview`.

## 5. Bulk actions (multi-select close / assign / tag) — **MISSING**

- Grep for `bulk` across `apps/api/src` (excluding specs) finds
  only courier bulk booking (`courier.controller.ts:67`), CSV
  order import, and operator-admin `orgs/bulk-status`. **No
  bulk/multi-conversation endpoint exists** in the inbox, and the
  web list has no selection state/checkboxes.
- A bulk UI would have to loop the single-conversation
  `PATCH …/conversations/:id` → `updateConversation`
  (`inbox.service.ts:2498`; `UpdateConversationDto`,
  `inbox.dto.ts:16-26` — one call covers status, `assignedUserId`,
  `tags[]`, `spamFlag`, `pipelineStage`, `outcome`), plus
  `POST …/read` and `POST …/bot/stop`.

## 6. Live customer presence + typing — **MISSING on every channel** (two platform-blocked, one buildable)

**(a) Customer → us (typing / online):**
- WhatsApp: **BLOCKED by platform** — the Cloud API exposes no
  customer typing or online signal; `webhook.parser.ts` parses
  messages + delivery/read statuses only (read receipts are
  explicitly ignored, parser comment), no typing field exists to
  parse.
- Messenger / Instagram: no typing events parsed (parser above);
  nothing in the client requests them.
- Telegram: **BLOCKED by platform** — Bot API gives bots no user
  typing/presence; webhook is `allowed_updates: ["message"]`
  and non-text updates are dropped.
- Email: no such concept.
- Webchat (our own channel): **substrate PARTIAL, feature
  MISSING** — `LiveChatSession.lastSeenAt` is stored and bumped
  on session start and on each visitor message
  (`webchat.service.ts:71,127`), but nothing surfaces visitor
  online state to agents, the widget emits **no** typing or
  heartbeat events, and the M66 visitor stream is server→visitor
  only (below). Both ends are ours, so this is the one channel
  where presence/typing could honestly be built later.

**(b) Us → customer (agent typing indicator): MISSING everywhere.**
- Meta client has no `sender_action` / `typing_on` (method list:
  `sendWhatsAppText/Template/Image`, `sendMessengerText/Image`,
  `downloadWhatsAppMedia`, `verifyToken`).
- Telegram client has no `sendChatAction`. Email: n/a.
- Webchat: `RealtimeService.deliverToVisitor()` forwards **only**
  `type: "message.created"` — no typing event reaches visitors.

**M66 visitor stream — exact scope** (`realtime.service.ts:136`
`streamVisitor`, `webchat.service.ts:streamFor`): endpoint
`GET /public/chat/:key/stream` (`@Sse`); the conversation is
derived solely from the session-token SHA-256 lookup (bad token →
401 before any stream opens); frames are the visitor-safe
5-field projection `{id, direction, content, type, createdAt}` —
the same projection as `WebchatService.listMessages()`. The
widget stops 4s polling while the stream is open and falls back
on any failure. No visitor→server events exist on this channel.

## 7. Visual product cards in chat — **PARTIAL (text snippet only)**

- There is **no product-message function in the API**. The 🛍️
  picker is web-only: `insertProductSnippet()` (`page.tsx:445`)
  inserts plain text into the reply box — `"নাম" — দাম ৳X, স্টকে
  Nটি আছে` — then sends through the ordinary text path. The
  result is identical plain text on **every** channel: no image,
  no price block, no "অর্ডার করুন" button.
- What each channel *could* render with code that exists today:
  WhatsApp image+caption (`sendWhatsAppImage`), Messenger image
  (`sendMessengerImage`), WhatsApp templates (`sendWhatsAppTemplate`,
  body params only; `sendTemplate` hard-rejects non-WhatsApp).
  **Not present anywhere** (grep, zero send code): Meta generic
  template/cards, WhatsApp interactive/CTA/catalog messages,
  Telegram inline keyboards, HTML email cards.
- Webchat widget renders **no images or cards at all**: `bubble()`
  is text-only and both visitor payloads (polling + stream)
  project no media fields — even an image message would arrive
  as an empty/caption bubble for the visitor.

## 8. Instant payment links (bKash / Nagad / SSLCommerz) — **BLOCKED (standing policy) + MISSING (implementation)**

Verified current state (this confirms the U5 finding, unchanged):
- Grep for `PaymentLink|paymentLink|createPaymentLink` across
  API + schema: **nothing**. No PaymentLink model among the 105
  schema models.
- The only gateway code is `apps/api/src/payments/` (M36/M39):
  `POST …/billing/checkout` creates a **subscription** checkout —
  the tenant paying **the platform**. Credentials are a **single
  platform merchant**: `effectiveSslcommerzConfig()` /
  `effectiveBkashConfig()` (`common/platform-config.ts:176-211`)
  resolve from the Admin-Console snapshot or env. **No per-tenant
  gateway credential storage exists**; the generic
  `Integration`/`IntegrationCredential` provider vocabulary has
  no payment provider.
- **Nagad has no integration at all** — the word appears only in
  `intent.ts` payment keywords and as a `PaymentVerification.provider`
  label.
- Closest inbox-adjacent feature is **not** a link:
  `PaymentVerification` (`schema.prisma:1523-1544`) +
  `POST …/messages/:id/verify-payment` — an AI-vision check of a
  payment **screenshot the customer already sent**. It never
  creates a payable URL and never moves money.
- Classification: **policy-blocked pending an owner decision**,
  same standing postponement as Wallet / Managed Ad Accounts
  (customer money). A tenant-money-instrument phase would need,
  precisely: (1) an explicit owner policy decision that tenants
  may collect customer money through the platform; (2) per-org
  gateway credential storage (SSLCommerz store id/password,
  bKash app credentials, a Nagad integration built from zero)
  with verify-before-save; (3) a PaymentLink model (org, order/
  conversation, amount, gateway, status, expiry) + public pay
  page + per-org IPN/webhook handling with the same
  signature-validation discipline as M36; (4) paid-state
  propagation into the inbox thread + order confirmation;
  (5) refund/dispute ownership and settlement reconciliation
  rules (money lands in the tenant's merchant account, never
  the platform's). None of this is a UI button away.

## 9. Live courier tracking widget (context panel) — **PARTIAL**

- The context panel does show shipment state: `customerContext`
  (`inbox.service.ts:2383-2395`, via `GET …/conversations/:id`)
  returns up to 5 orders, each order's shipment projected to
  exactly `{trackingCode, status, provider}`; the web renders a
  🚚 badge (provider · status · tracking code). No progress
  stepper, no consignment/invoice/COD/recipient data reaches
  the panel.
- Full data lives in the courier module: `CourierShipment`
  (`schema.prisma:1499-1521`) — `consignmentId, trackingCode,
  invoice, status, codAmountMinor, recipient*, lastCheckedAt`.
  Status is a **free-form string in the courier's own words** —
  no normalized enum; only `TERMINAL = ["delivered",
  "partial_delivered", "cancelled", "returned"]`
  (`courier.service.ts:22`).
- Refresh paths are **manual only**: `POST
  courier/shipments/:shipmentId/sync` → `syncShipment`
  (`courier.service.ts:538-559`, per provider: Steadfast
  `statusByTrackingCode`, Pathao `orderStatus`, RedX
  `parcelStatus`; updates `status` + `lastCheckedAt` and posts a
  one-time status message into the originating thread on change)
  and `POST courier/sync-all` (`:562-576`, non-terminal,
  take 200). **No scheduled sync job exists** (automation job
  dispatcher has no courier case) and **no courier webhooks**.
  The inbox panel never triggers a sync — it shows the last
  stored status. One-click share to the customer exists:
  `POST …/conversations/:id/share-tracking` (`inbox.service.ts:1556`).

## 10. AI copilot (ghost text / tone rewriter / mood meter)

| Sub-item | Verdict | Evidence |
|---|---|---|
| AI ghost text (inline autocomplete, Tab-to-complete) | **MISSING** | No inline completion anywhere. What exists is a **panel draft**: `POST …/conversations/:id/drafts/suggest` → `suggestDraft` (`inbox.service.ts:2627-2670`) — grounded prompt (business profile + policies + matched product only), real LLM via `provider.complete()`, or a clearly labelled `templateDraft` fallback when the provider is the dev-template; persists `MessageDraft` (suggested → send via the normal send path / dismiss). |
| AI tone rewriter | **MISSING** | No rewrite endpoint for agent text. Adjacent: inbound-message **translation** exists (`translateMessage`, `inbox.service.ts:2181`, feature `translate`) and conversation **summary** (feature `summary`). |
| Realtime sentiment / mood meter | **PARTIAL** | Deterministic classifier `classifyIntent()` (`intent.ts:27-47`) returns `{intent, confidence, sentiment}` where sentiment is **binary negative-only** (`"negative" | null`, `NEGATIVE_WORDS`); complaint wins ties. Stored per message (`ChannelMessage.intent/intentConfidence`, `schema.prisma:958-959`) and rolled up to `ChannelConversation.sentimentFlag` + `priority=high` on negative (`inbox.service.ts:764-768`). UI: 😡 marker in the conversation list only — **no in-thread mood meter, no positive/neutral gradation**. Autopilot escalation consumes the same signals (`escalateAutopilot`, `inbox.service.ts:1184-1237`: complaint / negative_sentiment / human_requested / high_value_order / repeated_ununderstood → pause + urgent `AgentNotification`). |

LLM substrate for any future copilot: `LlmFactory`
(`apps/api/src/ai/llm/llm.factory.ts:23`; openai | anthropic |
gemini | dev-template) with **platform-level** config
(`effectiveLlmConfig()` — Admin Console else env), already
injected into `InboxService`; inbox LLM calls write
`AIUsageRecord` (`feature: draft | summary | translate |
autopilot`). Important gap: the per-org AI kill switch and plan
daily caps (`common/platform-settings.ts:19-21, 49-83`) are
enforced in `ai/chat.service.ts`, `ai/creative-studio.service.ts`
and `messaging.service.ts` — **grep finds no enforcement in
`inbox.service.ts`**, so inbox LLM features do not check the
kill switch or the daily cap today.

## 11. Internal whispers + @mention notifications — **PARTIAL**

- Internal notes **EXIST** but live **outside the thread
  timeline**: `ConversationNote` model (`schema.prisma:1402-1415`:
  org, conversation, author, content, createdAt; no edits, no
  pinned, no stored mention ids). Separate endpoints only:
  `GET …/conversations/:id/notes` → `listNotes` (asc, take 200)
  and `POST …/notes` → `addNote` (`AddNoteDto`, max 4000).
  `getConversation` returns `{conversation, botSession,
  messages, drafts, context}` — notes are **not** merged into
  `messages`, so the web renders them in a separate right-panel
  card ("Internal Notes — শুধু টিম দেখবে"), never interleaved
  with customer messages by time.
- @mentions **EXIST, heuristically**: the notes UI offers
  member chips that insert `@Name` into the note text;
  `addNote` → `notifyMentions` (`inbox.service.ts:2411-2437`)
  substring-matches lowercased `@<firstName>` or `@<emailPrefix>`
  against up to 50 memberships and creates an
  `AgentNotification` of type `mention`. There is **no mention
  model and no parsed mention ids stored** — matching is
  best-effort string matching (first-name collisions and name
  changes can misfire). System notes are also written to the
  same table via `createNoteInternal` (refund requests,
  chat-order flows).
- `AgentNotification` (`schema.prisma:1590-1604`; types
  `assigned | mention | urgent`, plus `refund_request` which the
  schema comment omits) is created via the private `notify()`
  helper: assignment (smart + manual), urgent (negative
  sentiment at ingest, autopilot escalation), mention, refund
  request. Read side: `GET inbox/notifications`,
  `…/unread-count`, `POST …/:id/read`; the dashboard shell bell
  renders them.

## 12. Collision detection (duplicate-reply protection) — **EXISTS**

Two layers, both live in the current UI:
- **DB heartbeat**: `AgentPresence` model (`schema.prisma:1577-1589`:
  conversation, user, `typing`, `lastSeenAt`; unique per
  conversation+user). `POST …/conversations/:id/presence {typing}`
  → `heartbeatPresence` (`inbox.service.ts:2341-2368`): upserts,
  fans out via realtime, and returns **other agents active
  within 45s** with names. The web heartbeats every 20s while a
  conversation is open and sets `typing` from composer content.
- **Ephemeral realtime room**: `RealtimeService.notePresence /
  presenceFor` (`realtime.service.ts:181-203`, 15s freshness;
  presence travels the U6 Redis `inbox-events` bus when
  `REDIS_URL` is set, so it is cross-replica; the map itself is
  per-instance by design). `presenceFor` currently has **no
  caller** — live data flows via the SSE `presence` event plus
  the heartbeat response. Minor wart: `heartbeatPresence` calls
  `notePresence` without `userName`, so SSE frames from this
  path carry `userName: undefined` (the web resolves names from
  its members list instead).
- **UI**: the thread shows an amber banner — "⚠️ {name} উত্তর
  লিখছেন ✍️ / এই কথোপকথনটি দেখছেন 👁 — ডুপ্লিকেট উত্তর এড়াতে
  সমন্বয় করুন" — merging the heartbeat response with live SSE
  presence. Limits: presence exists only while an agent has the
  conversation open (no list-level viewer indicators), and the
  freshness windows are short (15s stream / 45s DB).

---

## Cross-track overlap note (docs/team-advanced-plan.md, other track)

The other track's Team plan (T1–T5, M67–M71) was read for
work-claims overlapping this program. Findings:

- Its "already complete" list claims *"@mentions, SLA clocks,
  agent notifications + presence"* — consistent with items 11/12
  above (substrate exists; neither plan owns changing them).
- **T4 (M70) includes a per-agent chat signature** "stored on
  the user-in-org profile, appended to inbox sends when
  enabled" — inbox-send-adjacent but **not** one of this plan's
  items; if both tracks proceed, the signature work would touch
  the same send path this program's later phases may touch —
  coordinate before either lands.
- T4 also plans *"'My performance' (own row of the team report
  + my queue counts) in the inbox"* — a future edit to the same
  inbox page this program's Phase B restructures; sequencing
  note only.
- The Team plan claims **nothing** about: fixed/resizable
  workspace, composer media/voice/emoji/formatting, bulk
  actions, smart folders, product cards, payment links, ghost
  text, tone rewriting, or inline whispers. No direct overlap
  with Phase B (Priority 1).
- Their in-flight M68 (Working Hours) currently holds
  uncommitted edits in `inbox.service.ts` / `inbox.controller.ts`
  / `inbox.dto.ts` / `schema.prisma` / `team/page.tsx` and a
  one-line edit in the inbox `page.tsx` (off-shift badge in the
  agent list). Phase B was staged with handcrafted index
  patches so none of that work is included in this program's
  commits.
