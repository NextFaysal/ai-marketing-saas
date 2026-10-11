# AP1 Acceptance — AI Assistant: Streaming + Rich Answers + Design v2

Package: AP1 (parent plan `docs/ai-assistant-full-plan.md` Tier A1–A3 +
§1.2 design; brief `docs/ai-assistant-ap1-brief.md`).
Commits (local only, not pushed):

1. API — `AP1 (API): AI chat streaming (SSE) + provider completeStream
   + A3 conversation intelligence` (originally c2ecc1c, **amended to
   d506301** — see "Micro-amend" below).
2. Web — `AP1 (web): AI Assistant Design v2 + streaming UI + A2 rich
   answers` (this package's second commit).

## Micro-amend (conditional, done)

The brief requires dev-mode badge parity on the stream path, but the
original API commit's `done` event carried no provider identity. HEAD
was still exactly c2ecc1c when the web work started, so the API commit
was amended with only:

- `ChatStreamEvent` `done` gains `provider: string; isRealLlm: boolean`;
- `sendMessageStream`'s `done` yield now sends
  `provider: provider.name, isRealLlm: provider.isRealLlm` (the same
  values the non-streaming POST returns);
- one assertion pair in `chat-stream.spec.ts`
  (`done.provider === "fake-real"`, `done.isRealLlm === true`).

Verified after the amend: `chat-stream.spec.ts` 12/12 pass. Nothing
else in the API commit changed. With this, the web sets its provider /
dev-template badge from the `done` event exactly as it previously did
from the non-streaming response — no badge behaviour was lost or
invented.

## A1 — Streaming

API (commit 1):

- `LlmProvider.completeStream` (optional) implemented for OpenAI,
  Anthropic and Gemini from each vendor's real streaming API, plus the
  dev-template provider chunking its template text by words. A provider
  without `completeStream` falls back to one `complete()` and a single
  delta — no simulated typing for real providers.
- `POST /organizations/:orgId/ai/chat/conversations/:id/messages/stream`
  emits SSE frames `event: step|delta|done|error`, data JSON:
  `step {phase:"planning"|"tool", tool?}`, `delta {text}`,
  `done {messageId, toolsUsed, usage {inputTokens, outputTokens,
  estimated}, suggestions, proposal, provider, isRealLlm}`,
  `error {message}`.
- Guard parity: kill switch (403) and daily cap (429) run before the
  first yield, so the controller answers them as ordinary JSON HTTP
  errors with the status preserved. RBAC/TenantGuard unchanged; the
  old non-streaming POST is untouched.
- Persistence parity: a completed answer is saved exactly once as a
  normal assistant message; `AIUsageRecord` is written exactly once.
  A provider compose error yields a terminal `error` event with the
  verbatim message and persists nothing. A client abort
  (generator.return()) persists a non-empty partial once with a
  trailing `{tool:"__stopped", status:"stopped"}` marker entry in the
  message's toolCalls summary and one estimated usage record; an
  empty partial persists nothing.

Web (commit 2):

- `apps/web/src/lib/ai-stream.ts` — `streamAiMessage()` does a raw
  `fetch` with the `getToken()` bearer token against the same
  `API_URL` base `apiFetch` uses, parses SSE with
  `createAiStreamParser` (chunk-split safe: frames, event lines and
  JSON payloads may split anywhere, including one character at a
  time), dispatches `onStep/onDelta/onDone/onError`, and returns the
  `AbortController` for the Stop button. A pre-stream HTTP error
  (403/429 JSON) is surfaced through `onError` with the server's
  message. An abort fires neither callback.
- The page's `send()` now uses only the stream path (the non-streaming
  endpoint is no longer called from the page; it remains in the API):
  optimistic user bubble → streaming assistant bubble (delta append +
  blinking caret, step shimmer rows `পরিকল্পনা চলছে…` /
  `টুল চলছে… <tool>`) → `done` finalizes from its own payload
  (messageId, toolsUsed, usage, suggestions, proposal notice) without
  a `loadMessages` round-trip. An `error` event drops the streaming
  bubble (nothing was persisted) and shows the verbatim message in
  the error banner. Stop aborts the fetch, then reloads messages via
  `loadMessages(convId)` to show the actual persisted state (including
  a stopped partial when the server saved one).

## A2 — Rich answers

Metadata decision (no schema migration): tool results ride on the
assistant message's existing `toolCalls` JSON field. On success, each
summary entry `{tool, args, status}` gains a compact `display`
projection of the tool result (arrays capped at 10 items, strings at
240 chars, depth capped, whole entry ≲3000 JSON chars; oversized
payloads become `{truncated: true, preview}`). Error entries never
carry `display`. The stopped marker is an extra trailing entry
`{tool:"__stopped", status:"stopped"}` in the same JSON — hidden from
tool lists everywhere (UI, exports) and surfaced only as a
"থামানো হয়েছে" chip.

Web renderer — `apps/web/src/components/ai-rich.tsx`
(`buildRichBlocks` pure mapping + `AiRichAnswer` presentational
component), keyed by tool:

- `get_analytics_overview` → stat tiles for the known fields actually
  present in `display` (orders, revenue, ad spend, average order
  value, contribution profit, margin %, MER, platform ROAS, COGS
  coverage %, platform conversions).
- `compare_periods` → delta tiles (current vs previous values, plus
  the supplied % only when `deltasPercent` carries a number for that
  metric — a null delta renders no percentage).
- `get_campaign_performance` / `get_product_profit` /
  `get_courier_performance` → bar rows (name + supplied value; bar
  width relative to the largest supplied value in the same payload —
  spend / gross-profit-or-revenue / shipment totals respectively).
- `list_products` → a table with only the columns (নাম/SKU/দাম/স্টক)
  that at least one supplied row actually carries.

Hard rule, enforced and tested: nothing renders that is not in
`display`. Unknown tools, missing displays, error entries and
truncated displays render nothing — Markdown text + the transparency
card remain the fallback. Tests assert the rendered output / blocks
contain exactly the fixture's numbers and no others.

Tool transparency: the old text footer ("ব্যবহৃত টুল: …") is replaced
by cards — one chip per visible tool with a status chip
(success/error); a `__stopped` entry never appears as a tool and
instead shows the "থামানো হয়েছে" chip.

## A3 — Conversation intelligence

API (commit 1): auto-title from the first user message (word-boundary
cut at 60 chars) when a conversation still has no title; topic tags
computed on read from stored toolCalls via the fixed tool→tag map
(max 3, `__*` markers skipped), returned as `tags: string[]` on each
conversation-list item; exports hide the `__stopped` marker but note
the stop.

Web (commit 2): tag chips on each rail row from the API's `tags`
(pinned-first order unchanged, exactly as the API returns it). Recap
card above the canvas once conversations load: the most recent
conversation's title (by `updatedAt`), the real pending-proposal
count from the loaded proposals, and a "চালিয়ে যান" button that
activates that conversation. No generated summary text.

## Design v2 — /dashboard/ai

3-zone workspace:

- **Left rail** — conversation list with every existing handler
  untouched (search, pin/unpin, rename, MD/JSON export, delete), tag
  chips per row, skeleton rows while the first load is in flight.
  On mobile it collapses to the existing select picker (unchanged).
- **Centre canvas** — header + provider/dev badge (unchanged
  conditions), recap card, message canvas (streaming bubble, step
  rows, A2 rich components, tool-transparency cards), follow-up chips
  above the composer, and the full proposals section (id
  `ai-proposals`) with every existing handler and label. Skeleton
  rows while messages load.
- **Right context panel** — (ক) Pending proposals queue: the
  `status === "proposed"` proposals with title/preview and the same
  `decideProposal` approve/reject calls as the main panel, plus a link
  down to the proposals section; (খ) Briefing card: the proactive
  settings state (both toggles) and the run-now button with the
  existing handlers and copy, moved here from below the canvas;
  (গ) Usage meter: provider badge plus this page-session's totals —
  the count of streamed answers and the sum of their `done` usage
  (input/output tokens, with a "~আনুমানিক" label when any summed
  usage was estimated). **No cap/limit number is shown**: the page
  holds no such data and none was invented.
- **Composer v2** — floating shell (`ai-composer-shell`, Inbox v2
  language: rounded, shadow), suggestion chips above it (existing
  `SUGGESTIONS` empty-state + follow-ups), provider/dev badge visible
  beside the composer, send button ≥40px, Enter-to-submit unchanged.
  While sending, the send button is replaced by a Stop button
  (থামান).
- **Mobile** — rail → existing select picker; context panel → stacked
  sections below the canvas (no zone is dropped; no handler or label
  lost).
- Styling: brand-token primitives only; `globals.css` gained a purely
  additive `.ai-*` block at the end of the file (35 insertions, 0
  deletions — no existing rule changed).

The page has never had separate reports/recommendations sections —
only proposals + proactive existed, and both are kept in full; no new
section was invented.

## Tests & gates

- API (commit 1, incl. amend): `chat-stream.spec.ts` 12/12 —
  step→delta→done order, persist-once, usage-once, display payload,
  cap 429 / kill-switch 403 before first yield, verbatim error event,
  abort partial + `__stopped` marker, provider/isRealLlm on `done`.
  (Provider stream fixture tests per vendor + dev chunking shipped in
  commit 1; in this web package only `chat-stream.spec.ts` was re-run,
  for the amend — the full API suite was not re-run here.)
- Web (commit 2): vitest **96/96 pass** (11 files) — new:
  `ai-stream.test.ts` (9: parser dispatch/order, one-char chunk
  splits, partial-frame holding, error frames, heartbeat/malformed
  tolerance, flush; stream client endpoint/token, pre-stream 429
  surfacing, abort silence) and `ai-rich.test.tsx` (9: per-tool
  blocks from fixtures only, null-delta handling, bar relativity,
  column presence, unknown/error/truncated → nothing, `__stopped`
  exclusion, rendered-markup exactness). `tsc --noEmit` clean.
  `next build` green.

## Honest limits

- Vendor streaming is **fixture-proven only**: no live LLM key exists
  in the sandbox, so OpenAI/Anthropic/Gemini streaming was verified
  against recorded SSE payloads, not a live vendor connection. Live
  streaming verification with the owner's real key remains, in the
  M30 pattern (owner runs it on the deployment).
- No live visual QA of the chat page was possible in the sandbox (no
  app database / running deployment here): the Design v2 page is
  verified by build + typecheck + unit tests + markup review, not by
  screenshots of a live session.
- The usage card is deliberately session-scoped: it sums only the
  `done` usages this page instance received. It is not an
  account-wide usage report and shows no cap, because no endpoint
  available to this page provides one.
- Stopped-partial reload races the server's abort persistence by
  nature: Stop reloads messages immediately; if the server's partial
  save lands a moment later, switching conversations (or any reload)
  shows it — the client never fabricates the partial itself.
