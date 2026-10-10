# Milestone 14 — Phase C (Reach, Orders & Identity): Acceptance

Completed 2026-10-10 on the owner's explicit go-ahead, following
`docs/customers-automation-review.md` Phase C. Schema: 62 models
(fields added, no new models), migration
`20261010140000_m14_phase_c` applied to the sandbox Postgres.

## Delivered

1. **WhatsApp template broadcasts** — the Messaging broadcast flow
   gains a whatsapp channel. Only registered, Meta-approved templates
   may be used (there is deliberately no free-form path: Meta forbids
   marketing messages outside the 24h window). Per-recipient sends go
   through the Meta client with template parameters ({name}
   substitution supported); every recipient gets a MessageDelivery
   row, "sent" only with a Meta message id, and the broadcast status
   (sent/partial/failed) is computed from those rows like email/SMS.
2. **Product picker + order from chat** — the composer can insert a
   grounded product snippet (real catalog price/stock) in one click.
   The customer panel can build an order: catalog prices only, totals
   computed server-side, a real Order + items (source "chat") linked
   to the conversation's customer (created from the contact when
   needed). When a WooCommerce store is connected AND every item came
   from Woo, the order is also pushed to the store via the Woo REST
   API (WooClient gained POST + createOrder); the outcome is recorded
   on the order (synced with the store's own id / failed with the
   store's error / local_only with the reason) and told to the agent
   verbatim - never assumed. A new-order event fires for workflows.
3. **Cross-channel identity (leads)** — duplicate detection groups
   unmerged leads sharing a phone (last-10-digit match). One-click
   merge moves activities and conversations to the surviving lead,
   unions tags, marks the source merged (never deleted; hidden from
   lists/pipeline). Customer-record merging remains a follow-up.
4. **CSAT** — closing a conversation that has customer messages sends
   the 1-5 rating question once, through the confirmed send path; if
   the send fails (e.g. WhatsApp window closed) nothing is marked.
   A short reply (digits or Bengali numerals) is recorded as the
   rating with an internal note; averages appear in the team report.
5. **Spam suspicion** — deterministic flags only: 3+ identical
   messages within 10 minutes, or a promo-link first contact. Flagged
   conversations are labeled (never deleted or auto-closed), can be
   filtered, suppress auto-reply, and an agent can clear the flag.
6. **Translation + thread summary** — per-message translation via the
   configured LLM; without a real LLM the API refuses with an honest
   explanation (templates cannot translate - no fake output). Thread
   summary uses the LLM when configured; otherwise it stores a
   clearly labeled data digest (counts, first message, intents,
   status, CSAT), with the provider recorded either way.

## Verification

- API tests: 203 passed (11 new): template-required + per-recipient
  delivery honesty (partial on a bad phone), spam rules on/off,
  CSAT ask-once + Bengali-digit rating, chat-order totals, Woo push
  synced + failed paths, translation refusal without an LLM, labeled
  dev summary, duplicate grouping + merge semantics (moves, tag
  union, list exclusion, double-merge refusal).
- All package builds pass. Live sandbox: migration applied, servers
  restarted; leads/duplicates 200, template-less WhatsApp broadcast
  correctly refused (400), team report exposes CSAT fields.
- Two build-time escapes were caught and fixed during the milestone:
  a silently missed code insertion (chat-order block) and a CSAT
  hook first inserted against a stale copy of updateConversation;
  both verified present by tests afterwards.

## Known limitations

- Broadcasts to WhatsApp need a connected WhatsApp integration and
  Meta-approved templates with matching parameter counts; Meta's own
  errors surface per recipient.
- Chat orders push to WooCommerce only; Shopify push is a follow-up.
  Orders with any non-Woo item stay local with the reason recorded.
- CSAT relies on the 24h window for WhatsApp (a closed conversation
  outside the window simply gets no survey).
- Spam rules are intentionally conservative; legitimate bulk
  questions from one customer can flag and need a human clear.
