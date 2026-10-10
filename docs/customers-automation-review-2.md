# Customers & Automation — Review #2: What Advanced Features Come Next

Written 2026-10-10, after Milestones 12-14 delivered Phases A, B and C
of the first review (`docs/customers-automation-review.md`). Every
claim below was checked against the current codebase, not the old
plan.

## 1. Where the section stands now (verified)

- **Inbox**: WhatsApp + Messenger only; 3-pane UI, context panel,
  assignment/search/tags/notes, media, templates + 24h window, intent
  chips, grounded auto-reply (off/draft/auto), COD confirmation,
  chat orders with WooCommerce push, CSAT, spam flags, translation,
  summaries, SLA + team report.
- **Leads/CRM**: pipeline, activities, conversion, duplicate
  detection + lead merge (phone-based).
- **Messaging**: email (SMTP) + SMS (SSL Wireless) + WhatsApp
  template broadcasts, per-recipient delivery proof, caps.
- **Workflows**: event triggers (order, lead, inbox message,
  inbox unanswered) with conditions; steps send email/SMS and add
  notes/activities. No wait/delay steps, no branching.
- **Automations**: scheduled jobs + metric guard rules (CPA/ROAS).

## 2. Leftovers from the first plan (honest list)

1. **Chatbot flow builder** — was Phase C item 7; NOT built in
   Milestone 14. Visual menu/keyword flows with human handoff are
   still missing.
2. **Customer 360 + customer merge** — Milestone 14 merged *leads*;
   customer records still cannot be merged, and there is no single
   customer page uniting orders + conversations + broadcasts.
3. **Workflow wait/branch steps** — deferred since Milestone 11.
   Without waits, no drip/recovery sequences are possible.
4. **Rich product cards** — the chat picker inserts a text snippet;
   WhatsApp interactive/catalog messages with images are not used.

## 3. New advanced candidates

### A. AI depth (needs the owner's LLM key for best quality)
5. **Order-taking bot** — a guided conversation that collects
   product, quantity, name, phone, address step by step and creates
   the order through the existing chat-order pipeline (real prices,
   human handoff at any step, COD confirmation at the end). This is
   the single biggest time sink for BD Facebook sellers today.
6. **Payment screenshot verification** — customers send bKash/Nagad
   screenshots in chat; vision extraction pulls TrxID/amount/time
   and flags mismatches or likely-edited screenshots for a human.
   Fake payment screenshots are a real, costly BD problem.
7. **Voice-note transcription (Bengali)** — voice messages are
   currently playable only; transcription makes them searchable,
   classifiable by intent, and answerable by auto-reply.
8. **LLM intent/sentiment upgrade + reply mining** — replace/augment
   the keyword classifier with the configured LLM, and mine resolved
   conversations to suggest new quick replies from real answers.

### B. More channels in the same inbox
9. **Instagram DM** — same Meta app family, same webhook discipline.
10. **Website live-chat widget** — reuses the tracking identity;
    website visitors land in the same inbox and pipeline.
11. **Email as an inbox channel** — support@ threads beside chats.

### C. Commerce & delivery depth
12. **Courier integration (Steadfast / Pathao / RedX)** — book the
    parcel from a chat order, sync courier status back into the
    conversation, auto-notify the customer on status changes. Today
    the order leaves the chat and the tracking conversation begins;
    this closes that loop.
13. **Recovery sequences** — scheduled template follow-ups for
    unanswered/abandoned conversations (1h / 24h / 3d), built on
    workflow wait steps (#3) with opt-out on any reply.
14. **Return/exchange flow** — return request from the order, pickup
    booking, refund status tracked in the same thread.

### D. Team operations & quality
15. **Agent alerts + collision detection** — web-push on new
    high-priority messages and SLA breaches; "another agent is
    replying" indicator so two people never answer the same chat.
16. **QA & coaching** — per-conversation quality checks (grounding:
    did the agent quote the real price?), weekly coaching report per
    agent on top of the existing SLA report.
17. **@mentions + tasks from notes** — internal notes that notify a
    teammate and can carry a due reminder.

### E. Broadcast & CRM intelligence
18. **RFM segments** — recency/frequency/monetary segments computed
    from real orders, usable as broadcast audiences.
19. **Broadcast A/B tests + template analytics** — split audiences
    across two templates; measure replies and attributed orders per
    template (hooks into the existing attribution engine).
20. **Win-back automation** — customers idle 60+ days get a scheduled
    template campaign; results measured in orders, not opens.

### F. Platform
21. **Outbound webhooks + public API** — let the merchant's other
    tools subscribe to order/conversation events.
22. **Scheduler to BullMQ** — required before multi-instance hosting.

## 4. Recommended sequencing

- **Phase D (Milestone 15) — Revenue automation**: workflow wait +
  branch steps (#3), order-taking bot (#5), recovery sequences (#13),
  flow builder basics (#1, keyword/menu flows on the same engine).
- **Phase E (Milestone 16) — Trust & delivery**: courier integration
  (#12), payment screenshot verification (#6), voice transcription
  (#7). Needs: courier merchant account + LLM key.
- **Phase F (Milestone 17) — Scale**: Instagram DM (#9), live-chat
  widget (#10), Customer 360 + customer merge (#2), RFM + A/B
  broadcasts (#18, #19), agent alerts (#15).

Each phase keeps the house rules: nothing is "sent" or "done"
without platform confirmation, AI answers only from verified data,
and every automation is visible in run logs.
