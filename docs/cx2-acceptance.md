# CX2 — AI Instructions Desk: Acceptance

Date: 2026-10-12. Package: Customer Experience Advanced (CX1–CX12), item CX2.
One local commit on `master`; nothing pushed.

## What was built

**Versioned draft → test → publish → rollback for the owner's AI instructions.**

- **Schema + migration** `20261012090000_cx2_ai_instructions_desk` (hand-written SQL in the repo's style):
  - `BusinessProfile.aiInstructionsDraft String?` — the persistent draft working copy.
  - New model `AiInstructionVersion` (org-scoped, `@@unique([organizationId, version])`) — immutable publish history with the reply language and note captured at publish time.
  - New model `AiUnansweredQuestion` (org-scoped) — the questions the autopilot could not answer, with 24h dedupe by normalized question.
  - **Consumers are unchanged**: autopilot (`buildFactPack`) and chat keep reading `BusinessProfile.aiInstructions` — the published text only. The draft reaches customers solely through an explicit publish.

- **Desk API** (`apps/api/src/inbox/ai-instructions.{service,controller}.ts`, registered in `InboxModule`; prefix `organizations/:organizationId/ai-instructions`; TenantGuard + RolesGuard + `@PermissionArea("inbox")`, mirroring `InboxController`):
  - `GET ""` (any member): `{ published, replyLanguage, draft (effective = draft ?? published), hasUnpublishedChanges, latestVersion }`.
  - `PATCH draft` (OWNER/ADMIN/MARKETING_MANAGER, ≤2000 chars): upserts `aiInstructionsDraft`, creating the profile row when missing; never touches the published column.
  - `POST publish` (OWNER/ADMIN): effective draft → `aiInstructions` + new `AiInstructionVersion` (version = max+1, language snapshot, optional note ≤200) + audit `ai_instructions.published`.
  - `GET versions`: newest first, take 50.
  - `POST rollback` (OWNER/ADMIN): org-scoped lookup (cross-org id → 404); restores the version's instructions **and** reply language into both `aiInstructions` and `aiInstructionsDraft`, and records the rollback itself as a NEW version (`v<n> সংস্করণে রোলব্যাক`) — history rows are never rewritten. Audit `ai_instructions.rollback`.
  - `POST test` (OWNER/ADMIN/MARKETING_MANAGER): kill-switch (403) + `aiDaily` cap counting today's `feature = "instructions_test"` usage rows (429), mirroring `CreativeStudioService.checkDailyLimit`, enforced **before** any compose; then composes under the draft or the published text via the override (see seam below). Returns the compose result plus `model` (evidence provider, null for deterministic answers).
  - `GET unanswered` (status filter, take ≤ 100) + `PATCH unanswered/:id` (OWNER/ADMIN/MARKETING_MANAGER; status enum open|resolved|ignored validated → 400, cross-org → 404; audit `ai_instructions.unanswered_status`).

- **Unanswered capture in the autopilot** (`InboxService.recordUnansweredQuestion`, fully failure-isolated — every prisma call guarded, whole body wrapped, `.catch(() => undefined)` like its neighbours):
  - `buildFactPack` returns null (no verified facts) → reason `knowledge_gap`.
  - Provider replies `NO_ANSWER` → reason `no_answer`.
  - The whitelisted-intent low-confidence early return in `maybeAutoReply` → reason `low_confidence`.
  - The number-guard rejection is deliberately **not** captured (already audit-logged as `inbox.autopilot.guard_rejected`; it is a guard event, not an unanswered question).
  - Dedupe: same normalized question (trim/lowercase/whitespace-collapsed, ≤300 chars) with an OPEN row created within 24h → `count + 1`, `lastSeenAt` updated; otherwise a new row (question capped at 500 chars).

- **Web** (`apps/web/src/app/dashboard/ai-instructions/page.tsx` + nav entry `🤖 AI Instructions` after Inbox):
  - Live-version status header (preview + `অপ্রকাশিত পরিবর্তন আছে` amber badge), draft editor (helper text states plainly that a saved draft does not reach customers until publish), test panel (Draft/Live selector; no-answer state shows the red "AI এই প্রশ্নের উত্তর দিতে পারবে না" box with guidance; note that a test may make a real AI call counted in daily usage), publish row with optional note + version history with per-version rollback (confirm first; publish/rollback hidden for non-OWNER/ADMIN via the org list's `myRole`), and the "❓ AI উত্তর দিতে পারেনি" triage list (reason badges, ×N counts, resolve/ignore/reopen, and "✎ Instruction-এ যোগ করুন" which appends `প্রশ্ন: …\nউত্তর: ` to the draft textarea state).
  - **Settings page hand-off**: the settings form no longer loads or submits `aiInstructions` (a stale settings save can no longer clobber the Desk's published text); the textarea is replaced by an info card linking to the Desk. `aiReplyLanguage` stays editable there as before.

## The test-desk seam (design decision)

`InboxService.testComposeReply(organizationId, question, override)` reuses the **real** compose pipeline — `composeGroundedReply` (deterministic tier) first, then `composeLlmGroundedReply` — so a Desk test answer is the same answer the autopilot would compose, not a parallel implementation. Two seams make that possible without touching stored state:

- `buildFactPack(..., override?)` and `composeLlmGroundedReply(..., opts?)`: when an override is provided, the pack's `ownerInstructions`/`replyLanguage` come from the override instead of the profile — the stored profile is never mutated by a test.
- `opts.usageFeature: "instructions_test"` labels the usage row so the Desk test's kill-switch/cap accounting and its ledger agree; `opts.captureUnanswered: false` keeps desk tests out of the customer's unanswered list.

By design the seam bypasses routing rules (mode, escalation, paused threads, rate limit): it answers "what would the AI compose under these instructions", sends nothing, and the Desk endpoint layers the owner-facing enforcement (kill switch + daily cap) on top.

## Evidence

- New spec file `apps/api/src/inbox/cx2-ai-instructions.spec.ts` — **19 tests, all passing**: publish flow v1→v2, draft-creates-profile, published-only consumption (fact pack + override + LLM prompt capture for useDraft false/true), rollback (text + language restore, new v3, history untouched), `@Roles` metadata (draft/test/triage include MARKETING_MANAGER; publish/rollback are OWNER/ADMIN only), Desk test (deterministic answer, LLM answer + model + `instructions_test` usage row, NO_ANSWER → noAnswer with **no** unanswered capture, kill switch 403, cap 429 counting only `instructions_test`), unanswered capture (knowledge_gap, no_answer, 24h dedupe to count 2, >24h row not deduped, guard rejection not captured, low-confidence capture, capture-failure isolation), triage (enum 400, audit) and tenant isolation (cross-org rollback/status → 404).
- Full gates on a clean tree of HEAD (ab090d0) + this commit's changes only (see ceiling note): **API jest 1544 passed / 186 suites** (all green; HEAD's own total was 1525, so +19 new CX2 tests, zero regressions), **web vitest 72 passed / 8 files**, **monorepo build green** (`pnpm -r build` exit 0, including the new `/dashboard/ai-instructions` route).
- `pnpm --filter @repo/db generate` succeeds (with `CHECKPOINT_DISABLE=1` in the sandbox; the generated client includes `aiInstructionVersion`, `aiUnansweredQuestion`, `aiInstructionsDraft`). The migration SQL is hand-written and validated by schema/client generation, not applied to a live database.

## Ceiling — stated plainly

- The sandbox has **no Postgres**: the migration was not applied and no live DB was exercised. Evidence is specs with fake prisma + a stubbed LLM at the established seams, the full test suites, and builds.
- **No live AI reply happened.** Every LLM in the specs is a stub returning canned text (including `NO_ANSWER`); the Desk test path's real-provider behaviour awaits the owner's M30 live verification with a real key.
- The working tree also contains another track's uncommitted AG1 changes (courier/customers/risk/webchat + `inbox/courier-card.ts`), which are mid-flight: `webchat.service.ts` references `parseCourierCard` without importing it, so suites that import it (m66, nextgen-p2/p3, phase-f, a2-shipment-di) and the courier/customers specs fail in the shared working tree for reasons unrelated to CX2. Those files were left completely untouched; CX2's gates were verified on a clean HEAD + CX2-only tree (a filtered patch of `inbox.service.ts` containing only the CX2 hunks — the AG1 hunks in that file were neither staged nor committed).
