# Customers & Automation — Status Review and Roadmap

Prepared 2026-10-10 at the owner's request: what the "গ্রাহক ও অটোমেশন"
(Customers & Automation) section already does, which real inbox problems
of ecommerce businesses it does not solve yet, and the feature plan to
close those gaps. Grouping = Inbox, Leads & CRM, Messaging, Workflows,
Automations (the sidebar group of the same name).

## 1. What is already built (verified against the code)

### Inbox (Milestone 7)
- WhatsApp Cloud API and Messenger connect through Meta Graph: token
  verified before saving, secrets AES-256-GCM encrypted, never returned
  in API responses.
- Webhooks: GET verification + X-Hub-Signature-256 HMAC check,
  idempotent inbound messages (unique conversation + external id),
  forward-only delivery status updates.
- One honest send path: a message is `sent` ONLY when the platform
  returns a message id; a 200 without an id is treated as failure.
- Conversation list with unread counts, open/pending/closed status,
  read marking, reply box, conversation assignment API
  (`assignedUserId`, validated against org membership).
- AI reply drafts: grounded in real product price/stock or an honest
  "will confirm" template; a human must approve/edit before sending;
  `sentByAiDraft` is recorded. AI never sends on its own.
- New contacts auto-create Leads; phone numbers (last-10-digit match)
  link conversations to existing Customers and their orders.
- Roles: only OWNER/ADMIN can connect channels; support roles can reply.

### Leads & CRM (Milestone 7)
- 6-stage pipeline with stage values; lost leads excluded from open
  pipeline value; activity timeline; idempotent convert-to-customer.
- Leads are created manually, by CSV-era customer flows, and
  automatically from first inbox contact.

### Messaging (Milestone 11)
- Message templates with {{variables}} rendered from real data.
- Broadcasts over Email (real SMTP, sent only with an SMTP message id)
  and SMS (SSL Wireless BD, sent only on gateway SUCCESS), audiences
  from real Customer/Lead tables, per-send cap (default 1000) that
  refuses oversize sends instead of truncating, double-send blocked,
  and a per-recipient MessageDelivery row with provider id/error as
  proof. Final status is computed from actual deliveries.

### Workflows (Milestone 11)
- In-process event bus: `order.created` (24h freshness guard against
  backfill storms), `lead.created`, `lead.stage_changed`.
- Conditions (all must pass: eq/neq/gt/gte/lt/lte/contains) and steps:
  send email, send SMS (template-driven), add lead activity. Every
  trigger writes a WorkflowRun with a per-step log.

### Automations (Milestone 10)
- In-API scheduler (60s tick): WooCommerce/Shopify syncs, Meta/Google/
  TikTok insights syncs, daily AI report, competitor sync/scan — every
  run logged to AutomationRun; failures advance the schedule (no
  hot-loop).
- Automation rules on platform CPA/ROAS/spend-without-conversions over
  a window: pause goes through the campaign service so Meta must
  confirm; alerts rate-limited to 1 per rule+plan per 24h.

## 2. The inbox problems businesses actually have (our market)

From the BD/international Facebook-commerce reality this product serves:

1. Message floods during boosts/Eid campaigns; owners and agents miss
   messages, reply late, and lose sales. Nobody knows who is handling
   which customer, so two agents reply to the same person — or nobody
   does.
2. The same five questions arrive hundreds of times: price, delivery
   charge/time, stock, "cash on delivery hobe?", order status. Agents
   retype the same answers all day.
3. Orders are confirmed inside chat (COD culture): the agent must check
   whether the product is in stock, take name/phone/address, create
   the order, and later confirm again before dispatch. Today that lives
   in the agent's head and in Messenger, disconnected from the store.
4. Customers send photos, screenshots and voice notes (a large share of
   BD customers prefer voice). Agents also need to send product photos.
5. Follow-up money leaks: carts abandoned in chat, "bhaia pore janabo"
   (will tell later) customers never re-contacted, unpaid COD orders
   never confirmed, delivered customers never asked for review/repeat.
6. No measurement: first-response time, resolution, agent workload and
   chat-driven revenue are invisible, so owners cannot manage a team.
7. Spam, abuse and fake orders waste agent time; angry customers are
   discovered too late.
8. WhatsApp's 24h window: after it closes, only approved template
   messages can be sent — businesses get blocked accounts by ignoring
   this.

## 3. Gaps in the current build (verified)

- Assignment exists in the API but there is NO assignee picker in the
  web inbox, no "assigned to me" filter, no unassigned queue.
- No conversation search or filters (channel/status/unread/assignee).
- No customer context panel inside a conversation: the agent cannot
  see the customer's orders, lifetime value, or lead stage without
  leaving the inbox — even though all that data already exists.
- No quick replies / snippet library; agents retype everything.
- No internal notes or @mentions on a conversation.
- No tags/labels on conversations or leads.
- Media: message type is stored, but images/voice/files are not
  viewable or sendable from the inbox UI.
- No intent/sentiment detection, no priority routing, no spam filter.
- No SLA or response-time metrics anywhere.
- Workflows cannot trigger from inbox events (new message, keyword,
  conversation unanswered for X minutes), and have no wait/branch
  steps.
- Broadcasts do not include WhatsApp template messages yet, and the
  inbox cannot send a WhatsApp template when the 24h window is closed.
- No product picker in chat (send a real product card with live
  price/stock), no order creation from chat, no COD confirmation flow.
- No CSAT, no team performance report, no cross-channel customer merge
  (same person on WhatsApp and Messenger is two contacts).

## 4. Proposed feature plan

### Phase A — Inbox Power Pack (recommended as Milestone 12)
Daily-pain removal; everything uses data the system already has.
1. Three-pane responsive inbox: list / conversation / customer panel.
2. Customer context panel: linked Customer + Lead stage, order
   history, lifetime value, attribution source — inside the chat.
3. Assignee picker UI (team members), "Mine / Unassigned / All"
   filters, unread-first sorting.
4. Conversation search + filters (channel, status, unread, assignee,
   tag).
5. Quick replies library (org-level snippets with variables like
   {{firstName}}, {{productPrice}}) with `/` picker in the reply box.
6. Internal notes per conversation (never sent to the customer),
   with activity trail.
7. Tags on conversations and leads, filterable.
8. Media viewing for inbound images/voice/files; send image replies.
9. WhatsApp 24h-window awareness: countdown on the conversation, and
   template-message sending from the inbox when the window is closed
   (approved templates only, honest failure states).

Acceptance: an agent can work a full day without leaving the inbox;
every send still requires platform confirmation; tests cover RBAC,
tenant isolation and the window rule.

### Phase B — AI & Automation Depth (Milestone 13)
1. Intent classification for inbound messages (price, stock, delivery,
   order status, complaint, other) stored on the message, shown as a
   chip, usable as a workflow trigger and filter.
2. Grounded auto-reply for FAQ intents with a per-org confidence
   threshold and an OFF / draft-only / auto-send mode per intent;
   every auto-send logged with its evidence (same honesty rules as
   AI drafts today — no invented price/stock, ever).
3. Order-status auto-answer from real order data; COD confirmation
   flow: one tap sends a confirmation message, customer reply updates
   the order/lead, all inside the existing order pipeline.
4. Smart assignment: round-robin or least-busy among online agents,
   with manual override.
5. SLA: first-response and resolution timers per conversation,
   breach badges, and a daily team report (response times, resolved
   count, chat-attributed orders/revenue via existing attribution).
6. Inbox workflow triggers (new message, keyword contains, unanswered
   > X min, intent = complaint) + wait steps, so follow-ups like
   "no reply in 2 hours -> send template / notify owner" are possible.
7. Sentiment flag for angry customers -> priority queue + owner alert.

### Phase C — Scale & Revenue (Milestone 14)
1. WhatsApp template broadcasts added to Messaging (same delivery
   proof discipline as email/SMS: per-recipient rows, caps, statuses).
2. Product picker in chat: send a product card (image, live price,
   stock) from the real catalog; create an order draft from chat and
   hand it to the existing order pipeline.
3. Cross-channel identity merge: same phone on WhatsApp + Messenger =
   one customer timeline.
4. CSAT one-tap survey after conversation close; results in Analytics.
5. Spam/abuse filter (rules + AI score) with a quarantine queue.
6. Agent assist: Bangla<->English translation of the draft,
   summarize-long-thread button, suggested next action.
7. Chatbot flow builder (visual, extends Workflows): menu/keyword
   flows for the top FAQs with human handoff.

## 5. Recommendation

Build Phase A first (Milestone 12): it removes the daily friction for
the exact users we already serve, needs no new external approvals, and
makes Phase B's AI measurable (intents and SLAs need the assignment,
tags and context plumbing from A). Phase B turns the inbox from a cost
center into a sales channel (COD confirmation + follow-ups). Phase C
is scale/revenue polish once teams are using it daily.

Guardrails that stay in force for all phases: no send is claimed
without platform confirmation; AI answers only from verified business
data; WhatsApp template/window rules respected; tenant isolation and
RBAC tested for every new endpoint.
