# Unified Inbox Master Plan — One Inbox for Every Channel

Written 2026-10-10 at the owner's request: every customer message —
Facebook Page, Instagram, TikTok, WhatsApp, website live chat and
more — in ONE place, with a powerful super-responsive design, an
agent system, AI auto-reply, and full business control from the
same screen.

## Where we already are (verified inventory, not a wishlist)

The foundation is largely built (Milestones 7, 12–17):

- `ChannelConversation` is already channel-agnostic: WhatsApp,
  Messenger, Instagram DM and website live chat all land in the
  same model, the same thread UI, the same assignment/SLA/bot/
  workflow machinery.
- 3-pane responsive inbox, customer context panel (orders, spend,
  lead stage), assignees + filters, quick replies, internal
  notes, tags, media via authenticated proxy, WhatsApp 24h
  window + template sending.
- Rule-based grounded auto-reply (real price/stock/policy/order
  status only), intent classification, smart assignment, SLA
  clocks, CSAT, spam flags, order-taking bot (COD), chat order
  creation + WooCommerce push, courier booking from chat,
  payment-screenshot assist, voice-note transcription, Customer
  360 + cross-channel identity merge, agent presence (polling).

**What is genuinely missing for the owner's vision:**
1. It is not realtime (20s polling) — no typing indicators, no
   collision warnings, no instant delivery.
2. TikTok (and a few more channels) are not connected.
3. The agent system is basic (assign + presence) — no teams,
   capacity, round-robin policies, or agent analytics.
4. Auto-reply is rule-first; the LLM autopilot tier (with strict
   grounding + confidence gates) is designed but not built.
5. The design is functional, not the "command center" grade
   experience the owner asks for.

## Channel reality check (verified 2026-10-10)

| Channel | API | Access path | Status |
|---|---|---|---|
| Facebook Messenger | Meta Graph | Own Meta app + App Review (pages_messaging) | ✅ built |
| Instagram DM | Meta Graph (Page-linked) | Same Meta app | ✅ built |
| WhatsApp | WhatsApp Cloud API | Own Meta app, number registration | ✅ built |
| Website live chat | Own widget | None needed | ✅ built |
| TikTok DM | TikTok Business Messaging API | **Partner-gated**: Business Account + TikTok partner/provider approval; region restrictions (no EEA/UK/US/IN DMs). NOT a self-serve app review. | ⏳ adapter + application (U4) |
| TikTok ad → chat | Messaging Ads "instant messaging" routes users to WhatsApp/Messenger | TikTok Ads account | ✅ works today via WhatsApp/Messenger |
| Telegram | Bot API (official) | Bot only — customers must start the bot; no access to personal accounts | 🔜 U4 (bot channel) |
| Email threads | IMAP/SMTP | Store mailbox credentials | 🔜 U4 (inbox lane) |
| YouTube comments | YouTube Data API | Own Google project + quota | 🔜 U4 (engagement lane, comments ≠ DMs) |
| Personal profiles / groups scraping | — | No official API | ❌ never (policy + honesty rule) |

Rule that stays in force: **no channel is claimed connected until
a real message round-trips through it.** Partner-gated channels
ship behind a clearly labeled development adapter until approval
lands.

## Phases

### U1 — Realtime Command-Center Inbox (design + transport)
- Server-Sent Events stream per org: new message, assignment,
  status, presence — the inbox updates instantly, no polling.
- Inbox Design v2: denser command-center layout, channel-colored
  identity chips, unified timeline (messages + internal events +
  order events in one stream), keyboard-first operation
  (j/k navigation, e assign, r reply, / search, ⌘K command
  palette), virtualized conversation list (10k+ conversations),
  dark glass theme matching Admin Design v2, fully responsive
  (mobile = list→thread swipe flow with bottom action bar).
- Collision detection: "Rahim is typing / viewing" presence on
  the thread; soft lock warning before two agents reply.
- Unread/command badges in the tenant shell (live count).

### U2 — Agent System Pro
- Teams & queues: named teams (Sales, Support), per-team channel
  routing, business hours per team.
- Assignment engine v2: round-robin within team, capacity caps
  per agent, skill/tag routing (e.g. "complaint" → senior team),
  offline queue + auto-reassign on timeout; the current smart
  assignment becomes one policy among several.
- Agent states (online / busy / away) with automatic away on
  inactivity; per-agent SLA timers and breach alerts.
- Internal collaboration: @mention teammates inside notes,
  mention notifications, thread handoff with context summary.
- Agent analytics: first-response time, resolution time,
  conversations/agent, CSAT per agent, revenue-linked per agent
  (already computed for the team — per-agent completes it).

### U3 — AI Auto-Reply v2 (Autopilot tiers)
- Three modes per org AND per channel: Off · Draft (AI suggests,
  human sends — exists today) · Autopilot (AI sends on its own
  inside guardrails).
- Grounding contract (unchanged, hard): answers come ONLY from
  the business knowledge base, real catalog price/stock, own
  policies, real order/delivery status. No source → no send;
  the conversation is routed to a human with the reason logged.
- Confidence gate: LLM self-score + deterministic checks; below
  threshold → draft instead of send. Every autopilot send is
  labeled in the thread and fully auditable/reversible.
- Escalation triggers: negative sentiment, payment disputes,
  human-request keywords ("এজেন্ট"), repeated misunderstanding
  (2 failed intents), high-value cart — instant handoff + agent
  notification.
- Bot v2: multi-product orders, address field end-to-end (adds
  the long-planned Order address), bKash advance-payment link
  inside chat (existing gateway), courier charge quote before
  confirm, Bengali/English mixed-language handling.
- Autopilot analytics: resolution rate, deflection, handoff
  reasons, grounded-source mix — all from real rows.

### U4 — New Channels (TikTok first, honestly gated)
- Channel adapter interface formalized (connect / verify /
  webhook parse / send / media) — Meta + webchat refactored onto
  it, proving the contract.
- TikTok: Business Messaging adapter (webhook events, send,
  media) shipped behind the partner-approval flag + a labeled
  development adapter for testing; partner application pack
  (business docs checklist) prepared for the owner. Until
  approval: TikTok Messaging Ads → WhatsApp/Messenger routing
  guide in-app (works today).
- Telegram bot channel (official Bot API): connect a bot, chats
  land in the same inbox; clearly labeled "bot channel" limits.
- Email lane: IMAP inbox sync into conversations + SMTP reply,
  so support@ mail sits next to chats.
- YouTube comments lane (engagement, not DM): reply/hide from
  the inbox via the Data API.

### U5 — Business Control Center (everything from the thread)
- Customer Command Profile: one panel combining conversations
  (all channels), orders, courier shipments + live status,
  payments, ad touchpoints (which campaign brought them), RFM
  segment, lifetime value — mostly assembled from existing data.
- One-click actions without leaving the thread: create order
  (exists), book/re-book courier, share tracking, issue coupon,
  request payment (bKash/SSLCommerz link), refund request to
  billing, block/report spam.
- Pipeline board view: conversations as cards by stage
  (New → Talking → Ordered → Delivered → Repeat) with drag
  assignment; the revenue pipeline next to the chat pipeline.
- Conversation outcomes: every closed thread records an outcome
  (sale / no-sale reason / support-resolved) feeding analytics.

### U6 — Scale, Media & Reliability
- Media pipeline to S3-compatible storage (voice, images, video)
  with signed URLs; media search.
- WebSocket fan-out for multi-instance API (Redis pub/sub) when
  the deployment scales past one API replica.
- Conversation export (per customer, per period, CSV/JSON) and
  retention policies per org.
- Inbox health panel (webhook lag, failed sends, channel
  connection state) wired into the Admin A6 reliability board.

## Sequencing & dependencies

U1 → U2 → U3 → U4 → U5 → U6 is the recommended order: realtime
transport first (everything else builds on it), agents before
autopilot (autopilot needs assignment/escalation to land on),
channels once the adapter contract is proven, control center
once bot v2's address/payment pieces exist.

Owner-side unlocks (no code can replace these): Meta App Review
for the messaging permissions (M30 Session 4), TikTok partner
application (U4), an LLM key for autopilot (Admin Console —
already supported since M33).

## Non-goals (restated)

- No scraping of personal profiles/groups; no unofficial
  gateways; no channel claimed live before a real round-trip.
- Autopilot never invents price, stock, discount, or delivery
  promises — the grounding contract is architectural, not a
  prompt suggestion.
- Customer money is never held by the platform (chat payment
  links go through the tenant's own gateways, as today).
