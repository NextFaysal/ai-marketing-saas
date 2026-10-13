# Global Assistant — AI help from every dashboard page (Acceptance)

Owner instruction (2026-10-12 22:28 +06): "এমন একটা global chat
option করে দাও যাতে user যেকোনো location থেকে AI help পাবে।"
This is the global-assistant item from docs/ai-assistant-full-plan.md
§Design (floating button + Cmd/Ctrl+J, page-aware context, mobile
bottom sheet) — planned there, not built in AP1; built now.

## What shipped

**Web**
- `apps/web/src/components/global-assistant.tsx` — mounted in the
  dashboard layout, so it exists on EVERY dashboard page:
  - Floating brand-gradient button ("✦ AI সাহায্য"), bottom-right;
    on mobile it sits above the fixed MobileBottomNav so the two
    never overlap.
  - **Cmd/Ctrl+J** toggles the panel from anywhere; **Esc** closes.
  - Panel: right-docked card on desktop, bottom sheet on mobile.
    Gradient header (Design v3 language) showing the current page
    ("📍 এখন: <label>") and the provider / Dev-Template state once
    known; actions: + নতুন কথোপকথন, পূর্ণ পেজ ↗ (the full AI page),
    ✕.
  - It is a shell over the SAME chat store + SSE stream endpoint as
    the AI page: opening it resumes the user's most recent
    conversation (list API is updatedAt-desc), messages stream in
    with step rows, caret and Stop, rich answers render via the
    existing `AiRichAnswer` (stored `display` projection only), and
    follow-up chips come from the stream's `done` event. Anything
    said here is visible on the AI page and vice versa.
  - If a chat reply creates a proposal, the panel shows the notice
    and links to the AI page's approval panel — nothing is approved
    or executed from the global panel.
  - On `/dashboard/ai` itself the component renders nothing (the
    full workspace is already there).
- `apps/web/src/lib/global-assistant.ts` (pure, tested) —
  `pageContextFor` reduces a pathname to its section path
  ("/dashboard/orders/123" → "/dashboard/orders") or undefined
  outside plain dashboard sections; `pageLabelFor` resolves the
  nav-registry label (root matches exactly, like the layout title);
  `suggestionsFor` serves curated per-section starter suggestions
  (orders/campaigns/inbox/products/customers/analytics/profit/
  campaign-builder) with the AI page's proven defaults elsewhere —
  every suggestion text maps to a real tool, as on the AI page.
- `apps/web/src/lib/ai-stream.ts` — `streamAiMessage` gains an
  optional `pageContext` argument, included in the request body
  only when present (the AI page's calls are unchanged).
- `apps/web/src/app/globals.css` — additive `.ga-*` block (FAB,
  backdrop, panel, head, body, composer) on the brand tokens.
- `apps/web/src/app/dashboard/layout.tsx` — import + mount only.

**API — page-aware context, honestly scoped**
- `SendMessageDto.pageContext` (both POST + stream endpoints):
  optional, `@Matches(/^\/dashboard(\/[a-z0-9-]+)*$/)`, ≤120 chars —
  a route path only, never free text.
- `ChatService.sanitizePageContext` re-validates the shape in the
  service (section paths only; deeper/free-text/external values are
  silently dropped) and threads it into `composeMessages`, which
  appends one hint line: the user is viewing that page; if the
  question is ambiguous, interpret it in that page's context; the
  context never changes which data is true.
- The hint is NEVER stored: the persisted user message is the typed
  content verbatim (spec-proven). It does not affect the planner,
  tool execution, proposals detection, usage or guards — kill
  switch / daily cap / RBAC are untouched. Dev-template mode does
  not use composeMessages, so the hint affects real-LLM answers
  only; the panel still labels dev-template mode honestly.

## Verification

- API: `npx jest src/ai/` — 13 suites, **108/108** pass, incl. 3 new
  pageContext specs (sanitize accepts section paths only; context
  reaches the compose prompt but is not stored; injected free text
  is dropped). API tsc: no errors in `src/ai/`.
- Web: vitest **105/105** (13 files; +5 new global-assistant helper
  tests — one initially caught a real bug: unknown dashboard paths
  were labelled "Overview"; fixed with exact-match root rule).
  tsc: no errors in the touched files (the only tree errors remain
  the pre-existing uncommitted AG ones in automations).
- `next build`: green, route table printed (`/dashboard/ai`
  present; the assistant ships inside the shared dashboard layout).
  As with Design v3, the build ran with the AG tree's deleted libs
  + `packages/ui` temporarily restored (backed up first) because
  the uncommitted AG state itself does not build; afterwards
  `git status` was verified identical to the pre-build state.
- No live visual QA (no running app in the sandbox) — verification
  is build + tests + markup review, same honest limit as AP1/v3.

## Scope / gates

- Local commit only — NOT pushed.
- Only the 11 files of this package were staged/committed; the
  uncommitted AG working tree and the parallel IN-package worktree
  (`in-package` branch) are untouched.
