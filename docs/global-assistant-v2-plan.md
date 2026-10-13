# Global Assistant v2 — Details Plan (G1–G5)

Status: PLAN ONLY (owner chose "আগে Global v2-এর details plan করো",
2026-10-12 22:57 +06). No build started. Base: Global Assistant v1
(commit db6b002, docs/global-assistant-acceptance.md) on dev master.
All findings below are code-audited at HEAD db6b002, not assumed.

## 0. Where v1 stands (audit recap)

Shipped in v1: floating FAB + Cmd/Ctrl+J panel (bottom sheet on
mobile) on every dashboard page; resumes the most recent
conversation from the shared chat store; SSE streaming with steps/
caret/Stop; `AiRichAnswer` rich blocks; follow-up chips; per-section
starter suggestions; section-path `pageContext` (validated,
compose-only, never stored); proposal *notice* with a link to the
AI page. Deliberately thin spots this plan closes: the panel cannot
switch conversations, shows no tool transparency, cannot decide a
proposal, has no prompt library, and the FAB/panel surface nothing
proactive (no pending count, no briefing).

## G1 — Conversation history switcher (web-only)

**Audit:** everything needed already exists and is used by the AI
page — `GET ai/chat/conversations?search=` (updatedAt desc, carries
computed `tags`), `GET …/:id/messages`, `POST …` (create),
`PATCH …/:id` (title/pinned). Zero API change.

**Build:**
- Panel gains a two-view state: `chat` (default) and `history`.
  Header gains a 🕘 "ইতিহাস" button; history view has a back button,
  the existing debounced search input pattern (300ms, same as the
  AI page rail), and rows: title (📌 when pinned), date, tag chips
  (reuse `.ai-tag-chip`).
- Row click → set active conversation, load its messages, back to
  chat view. Pin toggle on the row (PATCH, same semantics as the AI
  page). Rename/delete/export stay on the full AI page — the panel
  links there instead of duplicating destructive flows (documented
  scope line in the history view footer).
- "+ নতুন" in history view = the existing create flow.
- Boot behaviour unchanged: first open still resumes the latest
  conversation; history is one tap away.

**Tests:** web — pure view-state/reducer tests if state is factored
into `lib/global-assistant.ts` helpers (row mapping incl. pinned
ordering is server-side; client keeps server order verbatim — a
test asserts no client re-sorting). Gates: vitest, build.

## G2 — Tool transparency in the panel (web-only)

**Audit:** the renderer is a page-local function
(`toolTransparency`) inside `apps/web/src/app/dashboard/ai/page.tsx`,
built on `visibleToolCalls` / `hasStoppedMarker` from
`components/ai-rich.tsx`. The panel currently renders rich blocks
only — a real parity gap vs the page.

**Build:**
- Extract the renderer into `ai-rich.tsx` as a shared component
  `AiToolTransparency({ toolCalls })` (same markup/classes:
  `.ai-tool-card`, chips, "থামানো হয়েছে" stopped chip). The AI page
  deletes its local copy and imports the shared one — one
  implementation, both surfaces, no visual change on the page.
- Panel renders it under each assistant message, exactly like the
  page. Streaming bubble keeps step rows (already there).

**Tests:** extend `ai-rich.test.tsx` — shared component renders the
same chips/stopped state for fixture toolCalls; page test surface
unchanged (existing 9 tests keep passing).

## G3 — In-panel proposal approval (web-only)

**Audit:** `GET ai/proposals?status=proposed` (service `list`
supports the status filter, orderBy desc, take 50),
`POST ai/proposals/:id/approve|reject` behind RolesGuard
**OWNER / ADMIN / MARKETING_MANAGER**, atomic claim in the service
so double-decisions cannot execute twice; approve returns the
updated proposal (`executed` or `failed` + verbatim `error`). The AI
page's flow (exact-preview `window.confirm`, failed → notice with
the verbatim error) is the behaviour to mirror. Zero API change.

**Build:**
- When a stream `done` carries a proposal, the panel notice becomes
  a compact proposal card (title + exact preview + status) with
  **অনুমোদন দিন / প্রত্যাখ্যান** buttons — same confirm dialog text
  as the page ("<preview>\n\nআপনি কি সত্যিই অনুমোদন দিচ্ছেন?").
- A "pending প্রস্তাব" strip at the top of the panel body lists all
  currently-proposed items (fetched on open + after each decision +
  after a proposal-creating reply), each decidable the same way;
  `executed` shows a green result line, `failed` shows the verbatim
  error — never a paraphrase.
- Role failure is honest: a 403 from the decide endpoints (e.g.
  ANALYST) shows an "আপনার রোলে অনুমোদন দেওয়ার অধিকার নেই" style Bengali
  notice (pointing to an OWNER/ADMIN) and keeps the
  link fallback. (Exact copy finalized in the build; the point is:
  surface the server's refusal, never hide the buttons' outcome.)
- No proposal *creation form* in the panel: chat detection already
  creates proposals from conversation; the form stays on the AI
  page (scope line).

**Tests:** web component/logic tests with a mocked apiFetch —
proposed list rendering, approve success → status line, approve
failed → verbatim error shown, 403 → role notice. API untouched
(existing proposals specs cover the endpoints).

## G4 — Prompt library + "/" picker (API + web; one migration)

**Audit:** no prompt library exists anywhere (schema, API and web
greps are empty). This is the only G-item needing new backend.

**Design decisions (documented, reversible):**
- Scope v1 = **per-user** saved prompts (personal productivity).
  Org-shared prompts need a role/sharing policy — deferred, not
  silently built.
- New model **`AiSavedPrompt`**: `id, organizationId, userId,
  title (≤80), body (≤2000), createdAt, updatedAt`;
  `@@index([organizationId, userId])`. Migration
  `20261012210000_ga2_saved_prompts` (timestamp after IN1's
  20261012200000 — the IN branch is unmerged; numbering must not
  collide when the branches integrate).
- Endpoints under the existing AI controller (TenantGuard as the
  rest): `GET ai/prompts` (own prompts, updatedAt desc),
  `POST ai/prompts`, `PATCH ai/prompts/:id`, `DELETE ai/prompts/:id`
  — every query scoped `organizationId + userId` (a user never sees
  another user's prompts, even in the same org). **Cap 50/user**
  (51st create → 400 with a Bengali-capable message). DTO with
  class-validator decorators on every field (the M40 lesson: a
  missing decorator silently 400s under forbidNonWhitelisted).
- **Starter pack** = deterministic constants in
  `lib/global-assistant.ts` (or a shared `lib/ai-prompts.ts`): the
  AI page's nine proven suggestions plus report prompts — every
  starter text must pass the existing discipline (each maps to a
  real tool via the keyword planner; a web test asserts the mapping
  the same way M45's suggestion tests do). Starters are code, not
  DB rows — nothing seeded, nothing fake.
- **Picker UX (panel + AI page composer, shared component):**
  typing `/` at the start of the composer opens the picker listing
  starters + saved prompts, filtered by the text after `/`
  (pure `filterPrompts` helper, tested); ↑/↓ + Enter selects
  (inserts the body into the composer, does NOT auto-send), Esc
  closes the picker without closing the panel (event order handled
  explicitly). A "＋ এই লেখাটি prompt হিসেবে save করুন" action
  saves the current composer text (title = first line, editable
  via prompt() in v1 scope — same pattern as conversation rename);
  saved items get rename/delete in a picker "manage" mode.

**Tests:** API spec — CRUD round-trip, org+user isolation (cross-
user id → 404), cap 50 enforced, validation 400s. Web —
`filterPrompts` unit tests; starter-to-tool mapping test.

## G5 — FAB badge + today's briefing card (web-only)

**Audit:** two existing data sources —
(a) `GET ai/proposals?status=proposed` (take 50 in the service);
(b) `GET inbox/notifications` returns the user's `AgentNotification`
rows; M48 writes the daily briefing as type **`ai_briefing`**
(title + full body) to OWNER/ADMIN users, deduped per day. The
layout's NotificationBell already polls unread-count every 30s —
the established pattern. Zero API change.

**Build:**
- **FAB badge:** pending-proposal count on the FAB, polled every
  60s and refreshed on panel open/close and after any in-panel
  decision (G3). Display rule is honest about the source cap: the
  list endpoint returns at most 50, so a full page shows "50+",
  otherwise the exact number; fetch failure → no badge
  (best-effort UI, like the bell). No badge when 0.
- **Briefing card:** on panel open, fetch notifications, take the
  latest `ai_briefing` whose createdAt is *today* (user's local
  date). Card at the top of the panel body: 🌅 title, body excerpt
  (first ~220 chars), "পুরোটা পড়ুন" expand (full body, in-panel),
  and opening/expanding marks it read via the existing
  `POST inbox/notifications/:id/read`. No briefing today → no card
  — nothing is composed or invented client-side. Roles without a
  briefing (non-OWNER/ADMIN) simply never see the card.
- The card never re-renders a summary of the body; excerpt is a
  verbatim slice.

**Tests:** web logic tests for the two pure pieces — badge label
from a count (0 → hidden, 7 → "7", 50 → "50+") and briefing
selection (filters type + local-today, picks latest, ignores
yesterday's). Polling is best-effort glue, markup-reviewed.

## Sequencing (3 batches, one local commit each)

- **GV1 = G1 + G2** (panel completeness; web-only; shared-component
  extraction touches the AI page but changes no behaviour there).
- **GV2 = G3 + G5** (decisions + awareness; web-only, all endpoints
  pre-existing; depends on nothing in GV1 except shared panel file
  — do sequentially, not in parallel, same file).
- **GV3 = G4** (the only API/schema batch: model + migration +
  endpoints + specs, then the shared picker in panel + AI page).

Gates per batch: API jest (GV3: `src/ai/` full; GV1–GV2: ai suites
as regression), web vitest full, tsc clean for touched areas,
`next build` green — with the standing caveat that the main repo's
uncommitted AG tree does not build by itself, so the build gate
uses the established temporary-restore + status-identical
verification. Local commits only; **no GitHub push** without the
owner's in-the-moment instruction.

## Explicitly NOT in v2 (with where they live instead)

- **Entity-level context** ("এই অর্ডারটা…") — next package (G6),
  security-first: client sends an entity *id* only, server loads
  the record under org scope and composes a factual context block;
  needs its own audit + spec round.
- **Select-to-ask bubble, @-mention picker** — G6 candidates.
- **Voice / file / image input** — AP2 (Input & Knowledge), one
  pipeline for page + panel, not panel-only.
- **Conversation share/hand-off, personas, per-tenant assistant
  name/tone** — Full Plan tiers A/F; personas and white-label
  depth remain owner-decision items.
- **Panel resize/drag, background streaming after close** — v3
  polish candidates; noted, not planned here.

## Risks / notes

- `proposals.list` caps at 50 — badge semantics above handle it;
  the pending strip shows what the endpoint returns, labelled as
  such if the cap is ever hit.
- Notifications list is shared with the bell; briefing selection
  must not mark anything read as a side effect of merely opening
  the panel (read only on expand — see G5).
- Migration numbering vs the unmerged IN branch: IN1 used
  20261012200000; GV3 uses 20261012210000. When IN integrates into
  master, schema merge must keep both models (they touch different
  models; `AiSavedPrompt` is additive).
- Shared-file discipline: GV1–GV3 all touch
  `components/global-assistant.tsx`; batches are strictly
  sequential. The dirty AG tree files are never staged.
