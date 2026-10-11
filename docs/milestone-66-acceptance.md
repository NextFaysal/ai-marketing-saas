# Milestone 66 — Webchat Visitor Realtime (Acceptance)

Built 2026-10-11 from `docs/platform-hardening-plan.md`.
**No schema change.** The Platform Hardening track
(M61–M66) is complete with this milestone.

## Before
The storefront live-chat widget learned about agent replies
by polling `GET /public/chat/:key/messages` every 4 seconds —
up to 4s of latency on every reply, plus a constant request
load per open widget.

## What was built
- **Visitor stream registry** in `RealtimeService`
  (`streamVisitor(conversationId)`): a per-conversation SSE
  fan-out that rides the SAME delivery path as the U1/U6 org
  stream, so the U6 Redis bus carries visitor events across
  API replicas with no extra machinery. Only
  `message.created` is forwarded, and only as a
  **visitor-safe projection** — exactly the fields the
  polling endpoint returns (`id, direction, content, type,
  createdAt`); internal metadata (sender user ids, media
  storage keys, notes) can never leak to a storefront.
- **Endpoint**: `GET /public/chat/:key/stream?token=...`
  (Nest `@Sse`). The conversation is derived from the
  session token alone (`WebchatService.streamFor` →
  `sessionByToken`, SHA-256 hash lookup) — there is no
  client-supplied conversation id, so one visitor cannot
  subscribe to another's thread. A bad token is a 401
  before any stream opens.
- **Throttler**: the SSE skip now covers any path ending in
  `/stream` (was only the agent inbox stream).
- **Widget** (`chat-widget.js`): opens an `EventSource`
  after the session starts; a live stream stops the 4s
  polling, and ANY failure — old server, blocked
  EventSource, stream closed — quietly restarts polling.
  Incoming stream frames go through the same `bubble()`
  renderer, which dedupes by message id, so a message can
  never render twice when both paths deliver it. Closing
  the panel closes the stream.

## Verification
- **API tests: 609 pass (88 suites)** incl. 4 new M66 tests:
  projection carries only the 5 safe fields (a message
  seeded with internal fields arrives clean), another
  conversation's messages never reach a subscriber,
  conversation.updated is not forwarded, valid token binds
  to its own conversation, invalid token is refused.
- **Live end-to-end** on the sandbox stack: started a real
  webchat session, opened the stream with curl, posted a
  visitor message and an agent reply through the real APIs —
  BOTH arrived on the stream within ~1s with the exact
  projected shape; a wrong token got 401.
- Widget passes `node --check`; API build green.

## Notes
- Agent *typing* indicators for visitors were deliberately
  NOT built (documented in the plan): presence stays an
  agent-side concept; the visitor stream carries messages
  only.
- Committed locally only; GitHub push waits for the owner's
  explicit instruction (rule of 2026-10-10 22:49 +06).
