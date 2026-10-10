# Milestone 13 — Inbox Intelligence (Phase B): Acceptance

Completed 2026-10-10 under the owner's autonomy grant plus his
go-ahead, following `docs/customers-automation-review.md` Phase B.
Schema: 62 models (+InboxSetting), migration
`20261010130000_m13_inbox_intelligence` applied to the sandbox
Postgres.

## Delivered

1. **Intent + sentiment classification** — a deterministic, transparent
   rule-based classifier (Bengali + English) runs at webhook ingest:
   price / stock / delivery / order_status / payment / complaint /
   greeting / other with a 0-100 confidence, stored on the message and
   shown as a chip. Negative sentiment flags the conversation and
   raises it to high priority. It is a heuristic estimate, never
   presented as fact. (A real bug was caught by tests: the complaint
   tie-break also fired at score 0, classifying unrelated messages as
   complaints; fixed.)
2. **Grounded auto-reply** — per-org settings: global mode off / draft
   / auto, per-intent overrides, confidence threshold. Answers are
   composed ONLY from verified data: the matched product's real price
   and stock, the business's own shipping/payment policy text, or the
   customer's real latest order status. No data -> no reply, in every
   mode. Complaints and unknown questions never auto-reply. Auto sends
   go through the same confirmed path (sent only with a Meta message
   id), are marked `autoReply` with a JSON evidence record, are
   audit-logged, rate-limited to one per conversation per 10 minutes,
   and fall back to a draft when the WhatsApp window is closed (judged
   from the freshly stamped conversation row - a stale-snapshot bug
   was caught and fixed during the build).
3. **Smart assignment** — new conversations auto-assign round-robin or
   to the least-busy support-capable member; manual override unchanged.
4. **SLA + team report** — firstResponseAt / resolvedAt clocks on every
   conversation; report endpoint + UI card: opened/closed, average
   first response, current SLA breaches, per-agent stats, and
   chat-LINKED orders/revenue (honestly labeled as linked customers,
   not platform attribution).
5. **COD confirmation flow** — one click in the customer panel sends
   the confirmation question through the confirmed send path; only
   then is the order marked awaiting. The customer's short
   affirmative/negative reply (হ্যাঁ/না/yes/no...) resolves it:
   order updated, internal note written, lead activity logged, and
   auto-reply suppressed for that message. Long or ambiguous replies
   never resolve an order.
6. **Inbox workflow triggers** — `inbox_message_received` (conditions
   on intent/channel/content, e.g. complaint -> add_conversation_note)
   via the event bus, and time-based `inbox_unanswered` scanned every
   5 minutes (unansweredMinutes condition, agent-reply check, once
   per conversation per workflow per 24h). New step type:
   add_conversation_note.

## Verification

- API tests: 192 passed (17 new): classifier cases incl. the score-0
  regression, COD reply parsing strictness, settings validation,
  draft/auto/no-data/threshold/rate-limit/window behaviors, evidence
  contents, round-robin assignment, COD send->awaiting->confirm/
  decline E2E through the real webhook handler, SLA clocks, team
  report aggregates, both workflow triggers incl. scan dedupe.
- All package builds pass. Live sandbox: migration applied, servers
  restarted, settings GET/PATCH and team-report verified with the
  demo account (demo org now runs auto-reply in draft mode with
  round-robin assignment, ready for a real WhatsApp connection).

## Known limitations

- Intent classification is keyword heuristics (BN+EN); an LLM-based
  classifier can replace it behind the same interface once a provider
  key exists.
- COD reply parsing accepts short replies only by design; customers
  who answer in a full sentence need an agent's manual update.
- Auto-reply order-status answers use the linked customer's latest
  order; unlinked contacts get no auto-reply for that intent.
- Phase C remains as proposed in the review document.
