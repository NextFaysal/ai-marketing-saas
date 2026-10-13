# AP7 (Frontier) — Acceptance

Owner: "Hmmm ae ta o start koro to" (2026-10-13 00:13 +06) —
start AP7 too. These were the plan's individually-gated frontier
items; the owner's instruction opened the gate. Built in four
local commits; nothing here widens any existing safety boundary.

## Commits (local only, not pushed)

1. **AP7a/b `5b73021`** — personas + assistant identity + autonomy L2.
2. **AP7c `7b1b9f4`** — Assistant API keys + public chat endpoint.
3. **AP7d `c91c008`** — signed one-time approval links.
4. **AP7e `f8e5226`** — voice-first read-aloud.

One migration: `20261013000000_ap7_frontier` (AIConversation
.persona, AIProactiveSetting.autonomyLevel + assistantName,
AssistantApiKey table) — additive, NOT run on any real DB yet.

## AP7a — Specialist personas + per-tenant identity

- Personas are a per-conversation mode (`AIConversation.persona`):
  **general** (everything), **ads_analyst** (ads/analytics/
  competitors/catalog), **inbox_coach** (inbox/crm/customers/
  knowledge/orders), **finance_analyst** (analytics/billing/
  courier/orders/catalog). The registry lives in `personas.ts`;
  the web picker mirrors it.
- Enforcement is server-side and identical in spirit to RBAC:
  the planner prompt only lists in-scope tools, keyword plans are
  filtered, and `executeToolLogged` refuses out-of-scope tools
  with a visible Bengali note + an audited `persona_restricted`
  AIAction (spec-proven: ads_analyst cannot run a team tool;
  general can). A persona focus paragraph steers the system
  prompt — the grounded rules always win. Personas only ever
  NARROW the tool universe, never widen it.
- **Assistant identity**: `AIProactiveSetting.assistantName` —
  the name is injected into the system prompt ("introduce yourself
  by that name"), shown in the AI page hero and the panel header,
  and edited in the Proactive panel. Tone continues to come from
  the existing Business Profile brand voice / AI instructions.

## AP7b — Autonomy level 2 (the owner's gate, narrow by design)

- Setting `autonomyLevel` (0 = approve everything, the default;
  2 = auto-execute). At level 2, only **internal, reversible,
  non-money, never-sending** proposal types execute without a
  second click: `create_quick_reply` and `create_followup_task`.
  Execution happens inside `ProposalsService.propose()` through
  the **same `approve()` path** (atomic claim, confirmed service
  write, audit) and is marked `autonomous: true` in both the
  stored result and the approval audit metadata.
- Meta pause/resume and broadcast drafts **always** wait for a
  human at every level (spec-proven). Turning level 2 on in the UI
  requires an explicit confirm that names the two auto types.

## AP7c — Assistant API

- `AssistantApiKey`: only the SHA-256 hash is stored; the
  plaintext (`qos_ai_…`) is returned exactly once at creation.
  OWNER/ADMIN manage keys (create/list/revoke) on the AI page;
  the list shows prefix + last-used, never a secret.
- `POST /assistant-api/chat` (header `x-api-key`) runs the
  **ordinary ChatService pipeline** as the key's creator: kill
  switch, daily caps, usage accounting, planner/sanitize
  boundary, and tool RBAC from the creator's *live* membership
  role all apply. Spec-proven: hash-only storage, wrong/foreign/
  revoked keys never authenticate, cross-org revoke impossible.

## AP7d — Signed approval links (Telegram-ready)

Security design (the plan required a review before building):
- Token = HMAC-SHA256 over `proposalId.expiresAt` with a
  server-only secret (`ASSISTANT_LINK_SECRET`, falling back to
  `INTERNAL_JOB_SECRET`). **No secret configured → the feature is
  disabled** and minting returns an honest 400.
- 48-hour expiry; constant-time verification; tampered,
  wrong-proposal and expired tokens all fail (spec-proven).
- The **GET never decides** — it renders the proposal preview and
  a confirm form, so Telegram link-preview fetches are harmless.
  The POST verifies and decides **as the org OWNER** through the
  ordinary approve()/reject() path; the atomic claim makes every
  link effectively one-time (a replay just shows "already
  decided" with the recorded error verbatim).
- Minting endpoint + a 🔗 copy button on the AI page proposal
  cards (roles OWNER/ADMIN/MARKETING_MANAGER).

## AP7e — Voice-first read-aloud

- Browser speech-synthesis toggle on both surfaces (persisted in
  localStorage): when on, each completed answer is spoken once —
  markdown stripped, language by script (bn-BD/en-US), capped at
  1,800 chars. Toggling off stops speech immediately; browsers
  without synthesis simply don't render the toggle.

## Gates

- API `jest src/ai/`: **164/164** (21 suites — +personas,
  +assistant-api, +approval-links, autonomy in proposals,
  persona scoping in chat-stream). API tsc clean in `src/ai/`.
  Prisma valid.
- Web vitest **128/128** (17 files, +voice-output 4). `next build`
  green (AG temporary-restore procedure; `git status` verified
  **identical** afterwards).

## Honest limits

- No live visual QA (no running app in the sandbox).
- Migrations `20261012220000`, `20261012230000`,
  `20261012240000`, `20261013000000` have not run on any real
  database — deploy must run migrations.
- Approval links execute as the OWNER by design; anyone holding a
  live link can decide that one proposal — links should be shared
  only with the owner (the UI notice says so), and they die on
  first decision or after 48h.
- The Assistant API is chat-only (no streaming, no file upload);
  keys inherit their creator's access — revoke when a member
  leaves (a removed member's conversations also stop resolving).
- Browser TTS quality/voices vary by device; BN voices are not
  present on every platform.
- NOT pushed (owner push gate unchanged).

**The AI Assistant plan (AP1–AP7) is now fully built**, with the
only deferrals being the ones recorded along the way: scheduled
custom reports (AP6 note) and coupon proposals (no tenant
discount store exists yet — see the EC plan).
