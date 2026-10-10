# Milestone 43 — Unified Inbox U1: Realtime Command-Center Inbox (Acceptance)

Built 2026-10-10 from `docs/unified-inbox-plan.md` Phase U1.
**No schema change.**

## What was built

- **Realtime transport** (`apps/api/src/inbox/realtime.service.ts`):
  per-organization Server-Sent Events fan-out
  (`GET /organizations/:id/inbox/conversations/stream`, behind
  TenantGuard) with a 25s heartbeat. Events: `message.created`,
  `conversation.updated`, `presence`. Emitted from every real
  send/receive path — Meta webhook ingest, human replies,
  automated/bot messages, template + image sends, assignment /
  status / read changes, and website live-chat posts (via an
  InboxService hook the WebchatService calls). Realtime failures
  can never break messaging (every emit is guarded).
- **Ephemeral thread presence**: the existing presence heartbeat
  now also fans out through the stream, so teammates see
  "viewing / typing" instantly; presence entries expire after
  15s and are never persisted as truth (the DB heartbeat stays
  the fallback record).
- **Web stream client** (`apps/web/src/lib/inbox-stream.ts`):
  fetch + ReadableStream SSE (EventSource cannot send the
  Authorization header), frame parser, reconnect with backoff.
  The inbox page upserts streamed messages into the open thread
  (dedupe by id), refreshes the list debounced, and keeps a 60s
  safety poll in case a stream drops silently.
- **Command-center UI v2** on the inbox page:
  - Channel identity chips (WhatsApp / Messenger / Instagram /
    Live Chat, with TikTok/Telegram/Email identities defined for
    U4) in the list and the thread header.
  - Date separators (আজ / গতকাল / date) in the thread timeline.
  - Keyboard-first operation: J/K navigate, Enter open,
    / search, R reply, E assign-to-me, ? shortcut help,
    Esc closes panels — inert while typing (⌘K excepted).
  - ⌘K command palette: jump to unread conversations, toggle
    unread-only, per-channel filters, assign current to me,
    shortcut help.
  - Progressive list rendering (40 at a time, IntersectionObserver
    sentinel) so very large inboxes stay smooth.
  - Mobile action bar in the thread (assign-to-me, tel: call,
    close/reopen, palette) — thumb-reachable.
  - Presence banner merges polled + streamed viewers/typers
    (collision warning: "…উত্তর লিখছেন ✍️").

## Verification
- **API tests: 417 pass (63 suites)** incl. 3 new realtime tests
  (org-isolated fan-out, no-subscriber no-op, presence record +
  broadcast + per-thread isolation). All pre-existing inbox
  suites pass unchanged — the service gained an optional 5th
  constructor dependency, so no spec rewiring was needed.
- **Live on the sandbox**: an SSE stream was opened with a real
  tenant token; a website live-chat session was started through
  the public widget API and a real visitor message posted —
  the stream delivered a `message.created` event carrying the
  message within seconds. Tenant inbox + dashboard serve 200
  on the new build.

## Not claimed / still open
- Single-API-instance fan-out (in-process). Multi-replica
  fan-out via Redis is U6, matching the standing
  one-replica deployment rule.
- Pixel-level browser QA of the v2 inbox was not performed —
  layout builds on the proven M12 three-pane structure.
- Typing presence from the CUSTOMER side depends on each
  platform (WhatsApp/Meta do not offer it to businesses); the
  presence here is agent-side, as labeled.
