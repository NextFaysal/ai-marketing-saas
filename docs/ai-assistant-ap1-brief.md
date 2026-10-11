# AP1 — AI Assistant Experience: Streaming + Rich Answers + Design v2

Owner go-ahead 2026-10-12 02:10 +06. Parent plan:
`docs/ai-assistant-full-plan.md` §1.2 (design), Tier A1–A3.
Scope in this package: **A1 streaming, A2 in-answer charts/tables,
A3 conversation intelligence, and the AI page Design v2.** Nothing
else from the plan (no file upload, no voice, no new tools, no new
proposal types).

## Current state (code-verified)
- `LlmProvider` has only `complete()` (llm/llm.types.ts). Chat flow in
  `chat.service.ts sendMessage`: planner `complete` (JSON) → sanitize
  → tools → final `complete`. Non-streaming endpoint:
  `POST ai/chat/conversations/:id/messages`.
- Web AI page is 363 lines (`apps/web/src/app/dashboard/ai/page.tsx`)
  — functional but pre-Design-v2; messages already persist which tools
  ran (transparency footer), which A2 builds on.
- Guards that must keep exact parity on the new path: per-org AI kill
  switch, daily message cap (429), `AIUsageRecord` written once per
  answered message, provider errors surfaced verbatim, dev-template
  mode labelled (`isRealLlm=false`), TenantGuard + RBAC unchanged.

## A1 — Streaming (SSE)
- Provider interface gains optional
  `completeStream(messages, opts): AsyncIterable<{ delta?: string;
  result?: LlmResult }>` — implemented for OpenAI, Anthropic, Gemini
  using each vendor's real streaming API (fixture-tested with recorded
  SSE payloads; no live key in sandbox, so vendor-stream is
  fixture-proven, stated in acceptance).
- Dev-template provider implements `completeStream` by chunking its
  template text — it is already labelled dev mode everywhere, and the
  stream is labelled the same way; no fake "real LLM" behaviour.
- New endpoint `POST ai/chat/conversations/:id/messages/stream`
  (SSE). Event contract:
  `step` ({phase: "planning"|"tool", tool?}) → `delta` ({text})* →
  `done` ({messageId, toolsUsed, usage}) | `error` ({message}).
  The planner + tool phase emits `step` events; only the final
  answer streams as deltas. A provider without `completeStream`
  falls back to one `complete()` and a single delta — no simulated
  typing for real providers.
- The old non-streaming POST stays untouched for API consumers/tests.
- Persistence parity: the streamed answer is saved exactly once as a
  normal assistant message (same fields/metadata as today) when the
  stream completes; usage recorded once from the final `LlmResult`.
  Stop button: the client aborts; the server stops generating,
  persists the partial text with a `stopped: true` marker in the
  message metadata if the schema's metadata field allows (verify
  first — no schema change in this package; if there is no metadata
  field, persist nothing partial and document that instead).
- Web: fetch-stream reader, token render with caret, Stop button,
  per-step shimmer rows ("টুল চলছে… get_analytics_overview").

## A2 — Rich answers (deterministic rendering)
- Tools return their structured results already; the web gains a
  renderer keyed by tool name that maps **stored tool results** to:
  stat tiles (analytics overview, period comparison deltas), bar
  rows (campaign performance, product profit, courier performance),
  and tables where the data is tabular. The LLM never supplies the
  numbers for these components — they render from the same tool
  result payload the answer was grounded in.
- To do that, tool results must be available to the web with the
  message. Verify how messages persist tool data today; extend the
  messages API response with the stored tool results if they are
  persisted, or persist a compact `display` payload per tool call
  (data needed for rendering only, capped size) in existing message
  metadata — again, **no schema change**: use existing JSON fields;
  if none exist, stop and document rather than migrating.
- Fallback: tools without a renderer keep today's Markdown text +
  transparency footer. Nothing is rendered that is not in the data.

## A3 — Conversation intelligence (deterministic, no LLM claims)
- **Auto-title:** a conversation still carrying its default title
  gets one derived from the first user message (trimmed, word-boundary
  cut) at first send — owner can rename as today.
- **Topic tags:** chips on the conversation rail derived from the
  tools actually used in that conversation (e.g. "বিজ্ঞাপন", "অর্ডার",
  "কুরিয়ার") via a fixed tool→tag map; stored nowhere, computed on
  read from message metadata (or omitted if metadata is unavailable).
- **Recap card:** opening the page shows "শেষ কথোপকথন" — the most
  recent conversation's title, last exchange preview, and pending
  proposal count (real rows), one tap to continue. No generated
  summary text.

## Design v2 (plan §1.2, applied to /dashboard/ai)
- 3-zone workspace: conversation rail (search/pin/tags, existing
  handlers), chat canvas (streaming bubbles, tool-transparency
  **cards** replacing the text footer, rich-answer components,
  proposal cards stay functional), right context panel: pending
  proposals queue (existing M47 data), proactive briefing card +
  settings state (existing M48 endpoints), usage/cap meter (existing
  data only). Zones collapse: panel → bottom sheet on mobile, rail →
  picker as today.
- Composer v2: floating shell (Inbox v2 language), suggestion chips
  from the existing deterministic suggestions, provider/dev-mode
  badge visible, ≥40px targets, skeleton states on existing loading
  conditions, brand-token primitives only (additive `.ai-*` classes
  in globals.css if needed; check git HEAD before touching
  globals.css — other tracks append there too).
- Reports / recommendations / proposals sections of the page keep
  every existing handler and label; restyle into the same system.

## Tests & gates
- Provider stream unit tests from SSE fixtures per vendor + dev
  provider chunking; chat-stream service tests (step/delta/done
  order, usage once, cap/kill-switch parity, error event verbatim);
  planner/sanitize injection suite stays green; web vitest for the
  rich renderer (renders only supplied data) + stream reader.
- Gates: API jest full, web vitest + build, tsc clean (note any
  pre-existing parallel-track failures separately, as usual).
- Acceptance doc `docs/ai-assistant-ap1-acceptance.md` with the
  honest limit: vendor streaming fixture-proven; live streaming with
  the owner's real key is verified when he runs it (M30 pattern).

## Hard rules
- Local commits only — **no GitHub push/fetch**. Surgical staging
  (other tracks have uncommitted work in the tree; never stage it;
  tsconfig.tsbuildinfo never committed).
- No schema migration. No changes to planner/sanitizePlan semantics,
  tools, reports, proposals, or proactive logic — AP1 is transport +
  rendering + page design only.
- Commits: (1) API streaming + A3, (2) web design v2 + A2 renderer.
