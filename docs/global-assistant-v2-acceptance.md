# Global Assistant v2 (G1–G5) — Acceptance

Owner: plan chosen 2026-10-12 22:57 +06 ("আগে Global v2-এর details
plan করো"), plan committed d8baa96 (docs/global-assistant-v2-plan.md),
build go-ahead 23:00 +06 ("Global v2 build শুরু করো (GV1 থেকে
ধারাবাহিকভাবে)"). Built strictly in the plan's batch order.

## Commits (local only, not pushed)

1. **GV1 `53a136d`** — G1 + G2 (web-only, 4 files).
2. **GV2 `957d5fd`** — G3 + G5 (web-only, 4 files).
3. **GV3** (this batch) — G4 (API + schema/migration + web).

## GV1 — History switcher (G1) + shared tool transparency (G2)

- Panel gains a chat/history two-view state. History view: header
  🕘 toggle (chat view) / ← চ্যাট (history view), debounced
  server-side search (300ms, same pattern as the AI page), rows in
  **server order verbatim** (title, 📌, date, computed tag chips),
  pin toggle via the existing PATCH, row click switches the active
  conversation and loads its messages (switching is ignored while a
  stream is running). Rename/delete/export deliberately stay on
  the full AI page — the history footer says so and links there.
  Boot behaviour unchanged (first open resumes the latest).
- `AiToolTransparency` extracted from the AI page into
  `components/ai-rich.tsx`; the page imports the shared component
  (identical markup — no visual change) and the panel now renders
  it under every assistant message, closing the v1 parity gap.
  2 new render tests (chips + statuses, __ markers hidden, stopped
  chip, empty → nothing).

## GV2 — In-panel proposal approval (G3) + badge & briefing (G5)

- Pending strip at the top of the panel: every `status=proposed`
  proposal (existing `GET ai/proposals?status=proposed`) as a card
  with title, exact preview, status badge and **অনুমোদন দিন /
  প্রত্যাখ্যান** — the same exact-preview `confirm` dialog as the AI
  page; `failed` executions show the verbatim error, approvals and
  rejections confirm in a notice, and a **403 shows an honest
  Bengali role notice** (the server's RolesGuard OWNER/ADMIN/
  MARKETING_MANAGER still decides — the panel adds no authority).
  A stream-created proposal refreshes the strip immediately.
- FAB badge: pending count, 60s poll (NotificationBell pattern) +
  refresh on open/decision; label is cap-honest — the list endpoint
  returns at most 50, so 50 displays as **"50+"** (`pendingBadgeLabel`,
  unit-tested); failure or zero → no badge.
- Briefing card: latest `ai_briefing` notification of the user's
  local today (`pickTodaysBriefing`, unit-tested: type filter,
  local-day, latest wins, yesterday ignored) at the top of the
  panel — verbatim 220-char excerpt, **mark-read fires only on
  expand**, full body renders as Markdown. No briefing today → no
  card; nothing is composed client-side.

## GV3 — Prompt library + "/" picker (G4)

- **API:** `PromptsService` (`apps/api/src/ai/prompts.service.ts`) —
  per-user saved prompts; every query scoped `organizationId +
  userId` (foreign ids → 404, existence never leaked); cap **50**
  (51st → 400 with the cap message); empty title/body → 400.
  Endpoints `GET/POST/PATCH/DELETE ai/prompts[/:id]` with fully
  decorated DTOs (the M40 decorator lesson). 5 service specs:
  scoping, empties, cap (and cap isolation between users),
  update/delete ownership, empty-update rejection.
- **Schema/migration:** `AiSavedPrompt` (scalar org/user ids, the
  AgentNotification pattern) + migration
  **`20261012220000_ga2_saved_prompts`** — one number later than the
  plan's 20261012210000, because the IN branch used …210000 for
  IN3's InboxMacro in the meantime; the folders are distinct and
  touch different tables either way. `prisma validate` passes.
  NOT run on any real database — deploy must run migrations as
  usual, or the prompts endpoints will 500 (same caveat as IN1's
  saved views).
- **Web:** `lib/ai-prompts.ts` — canonical `STARTER_PROMPTS` (the
  nine proven suggestions; the AI page now imports them and pairs
  local icons by position — single source), pure `filterPrompts`
  (tested), `useSavedPrompts` hook. Shared `PromptPicker` component
  in **both** composers (panel + AI page): "/" opens it, query =
  text after "/", capture-phase keyboard ownership (↑↓/Enter pick —
  inserts, never sends; Esc dismisses the picker only, never the
  panel), saved items carry rename/delete, starters are badged.
  "＋ Prompt হিসেবে save" beside each composer saves the current
  text under a user-given title (server cap/errors surface in the
  surface's own error area).
- **Starter guarantee, proven:** the API planner spec now asserts
  each of the nine starter strings plans ≥1 real tool via
  keywordPlan (mirror list, keep-in-sync comment on both sides).
  No separate "report prompts" were added — the nine are the pack,
  exactly as the plan's guarantee required.

## Gates

- GV1: web vitest 107/107, tsc clean (touched files).
- GV2: web vitest 110/110, tsc clean.
- GV3: API `jest src/ai/` **114/114** (13 suites + prompts 5 +
  planner starters), API tsc clean in `src/ai/`, prisma validate
  OK, web vitest **114/114**, `next build` green (compiled; run
  with the established AG temporary-restore procedure, after which
  `git status` verified **identical** — the AG uncommitted tree and
  the IN worktree are untouched).

## Honest limits

- No live visual QA (no running app in the sandbox) — build +
  tests + markup review, as with v1/Design v3/AP1.
- The AiSavedPrompt migration has not run anywhere; the picker
  library loads best-effort and simply shows starters until the
  migration is deployed.
- In-panel approval is only as available as the M47 execution
  paths themselves (real Meta confirmation still needs the owner's
  live accounts, M30).
- NOT pushed (owner push gate unchanged). Next in the wider plan:
  G6 entity context (security-first) and AP2 inputs — separate
  packages, not started.
