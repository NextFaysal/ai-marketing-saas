# Milestone 17 — Phase F (Scale & Teamwork): Acceptance

Completed 2026-10-10 on the owner's explicit go-ahead, following
`docs/customers-automation-review-2.md` Phase F. Schema: 70 models
(+WidgetSite, +LiveChatSession, +AgentPresence, +AgentNotification;
Customer.mergedIntoId; Broadcast audienceSegment/abVariant/abGroupId),
migration `20261010170000_m17_phase_f` applied. This completes the
Customers & Automation roadmap (Phases A-F).

## Delivered

1. **Instagram DM** — the webhook parser now routes `object:
   "instagram"` payloads to an `instagram` channel (same messaging
   shape, IGSID senders); connect verifies the token before save and
   requires the linked Page ID (sends go through the Page endpoint,
   exactly like Messenger); inbox filters, intelligence, bot and
   workflows apply unchanged.
2. **Website live chat** — WidgetSite + embeddable `chat-widget.js`
   (bubble, polling, localStorage visitor id). Public API under
   `/public/chat/:key` (site key + per-visitor session token; only
   the token's SHA-256 is stored). Visitors become inbox
   conversations (channel `webchat`) + leads; the full intelligence
   pipeline runs; agent replies are delivered as rows the widget
   polls — our own channel, so no external confirmation is faked.
   Sites are managed from the Integrations page with a copy-paste
   embed snippet and an enable switch.
3. **Customer 360 + merge** — new Customers page: searchable list
   with order counts and lifetime spend; detail with orders,
   shipments, conversations, lead link; merge moves orders and
   conversations to the surviving record, fills contact gaps without
   overwriting, keeps the source as a marked hidden shell (never
   deleted), and audits the move.
4. **RFM + A/B broadcasts** — RFM computed from real orders
   (cancelled excluded), quintile scores relative to the org's own
   base, 7 segments; segment as a broadcast audience; A/B creation
   makes two variant drafts sharing a group id and sends partition
   the audience deterministically (each recipient in exactly one
   variant), with per-variant delivery records for comparison.
5. **Agent alerts + collision detection** — notifications for
   assignment (never self-assignment), @mentions in internal notes
   (matched by first name or email prefix), and urgent
   (negative-sentiment) conversations (assignee, else owners/admins);
   bell with unread count in the topbar. Presence heartbeats (20s UI,
   45s freshness window) show who else is viewing/typing in the open
   conversation, with a typing signal from the reply box.

## Verification

- API tests: 233 passed (7 new): IG parser routing; webchat E2E
  (site -> session -> visitor message -> agent reply -> polling,
  forged-token refusal, raw token never stored); merge semantics;
  RFM quintiles/segments; segment audience; A/B partition (union =
  audience, intersection empty, delivery-level proof); presence
  freshness + assignment/mention notifications.
- LIVE E2E in the sandbox: created a widget site, started a public
  session without auth, posted a visitor message ("আপনাদের ডেলিভারি
  চার্জ কত?") and saw the conversation land in the inbox. This live
  run caught a real bug unit tests missed — the global JWT guard
  blocked the public controller; fixed with the codebase's @Public
  marker and re-verified. RFM + notification endpoints live-checked
  (honest zeros on the empty demo org).
- All builds pass; migration applied; servers restarted.

## Known limitations

- Instagram sends use the Page-linked flow; standalone Instagram
  Login (graph.instagram.com tokens) is not wired.
- The widget polls every 4s (no websockets); presence is
  heartbeat-based, not realtime sockets.
- RFM loads up to 2,000 customers / 1,000 orders each in-process;
  very large bases will want the BullMQ aggregation move noted in
  the roadmap.
