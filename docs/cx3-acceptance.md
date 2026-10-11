# CX3 — Wait-before-answering (debounce): Acceptance

Date: 2026-10-12. Package: Customer Experience Advanced (CX1–CX12), item CX3.
One local commit on `master`; nothing pushed.

## What was built

**A customer who sends several messages in a burst now gets ONE AI reply,
composed from the whole burst — on both the inbox and the comments paths.**

- **Schema + migration** `20261012100000_cx3_reply_debounce` (hand-written SQL, repo style):
  - `InboxSetting.aiReplyDelaySeconds Int @default(0)` and `aiReplyDelayByChannel Json?` — the per-org wait, with optional per-channel overrides.
  - `ChannelConversation.autoReplyDueAt DateTime?` + `autoReplyBatchSince DateTime?` — the pending deferred reply and the start of the batch it must cover.
  - `SocialComment.aiReplyDueAt DateTime?` + `aiReplyBatchOf String?` — the due time of a deferred comment reply, and (on covered comments) the `externalCommentId` of the comment whose batched reply covered it.

- **Inbox debounce** (`InboxService`):
  - `getSettings` returns `aiReplyDelaySeconds ?? 0` and `aiReplyDelayByChannel ?? {}`. `updateSettings` (and `UpdateInboxSettingsDto`) accept both: `aiReplyDelaySeconds` must be an integer 0..600 and each per-channel value likewise (unknown channel / bad shape / out-of-range → 400), persisted on the `InboxSetting` upsert like sibling fields.
  - `maybeAutoReply(..., opts?: { firedFromDebounce })` gains the **defer point**: immediately after the confidence check and before any compose. Everything before it — mode resolution, the fresh-row re-read, the paused check, the **escalation gate**, the intent whitelist — runs exactly as before and immediately. Only composing waits. The effective delay is `aiReplyDelayByChannel[channel] ?? aiReplyDelaySeconds`, clamped 0..600. Deferring sets `autoReplyDueAt = now + delay` and `autoReplyBatchSince = existing ?? now` (a follow-up message extends the due time but never moves the batch start). Mode `draft` defers too — the draft is composed at fire time from the full batch.
  - `runDueAutoReplies(organizationId)` (public, sweep entry): due rows (≤25, oldest due first), each failure-isolated — see claim semantics below.

- **Comments debounce** (`SocialCommentsService`):
  - The plan computation was extracted from `ingestComment` into `buildReplyPlan(organizationId, settings, { authorName, commentText, postTitle })` → `{ classification, matchedProduct, isNightOwl, aiPlan }`, used by both ingest and the sweep. Ingest's side effects (Telegram urgent alert, lead creation) stay in ingest, immediate and unchanged.
  - Ingest create path: when `aiAutoReplyEnabled` and the comment is not HIDDEN and `replyDelaySeconds > 0`, the row is created with `replyText: null`, `repliedAt: null`, `isPrivateDmSent: false`, the plan retained (`privateDmText` + `metadata.aiPlanned` as before), and `aiReplyDueAt = now + replyDelaySeconds`. Otherwise the pre-CX3 values are written exactly (delay 0 = instant reply at ingest, as before).
  - `runDueCommentReplies(organizationId)` (public, sweep entry): due PENDING rows (≤25) taken **newest first**, so the latest comment of a burst claims first and batches the earlier ones. The reply application lives in the private `applyDueCommentReply(organizationId, settings, fresh)` — a clean seam where a later package item will add a channel AI-schedule gate immediately before it.

- **Jobs** (`AutomationService` + Automations web page):
  - `JOB_TYPES` += `inbox_autoreply_sweep`, `comment_autoreply_sweep`; `JOB_TEMPLATES` += both (org target, 1-minute interval), and `executeJob` dispatches to `InboxService.runDueAutoReplies` / `SocialCommentsService.runDueCommentReplies`. `SocialCommentsService` is injected the way `SocialPublishService` is — it is exported by `InboxModule`, which `AutomationModule` already imports, so there is no module cycle. The web Automations org job-type list gains both types with Bengali labels.
  - **Deviation, with reason:** a 1-minute template cannot be installed through the existing job machinery, whose minimum interval was 5 minutes everywhere (`createJob`/`updateJob` guards, `CreateJobDto`/`UpdateJobDto` `@Min(5)`, the A4 catalogue test, and an `automation.service.spec` assertion that interval 1 is rejected). The minimum is therefore lowered 5 → 1 in the service guards, the DTOs, and the web form (`min={1}`), and the two existing spec assertions were updated to the new floor (templates ≥ 1; interval 0 still rejected). Without this, the templates in the brief would have been listed but uninstallable.

- **Web settings UI**:
  - Inbox settings panel: a "⏳ উত্তরের আগে অপেক্ষা" section — an org seconds input (0..600, saved via `saveSettings({ aiReplyDelaySeconds })`) with the brief's helper text verbatim in substance (0 = immediate / previous behaviour; 30–60s batches a burst into one reply; the Inbox Auto-Reply Sweep job must be enabled; complaints/human requests escalate immediately), plus compact per-channel second inputs rendered from the same channel list as `perChannelModes` (merged into `aiReplyDelayByChannel`; empty/0 = the org value).
  - Comments settings: the `replyDelaySeconds` helper text now states the delay is effective, that same-author/same-post batching applies, that hide/spam is still immediate, and that the Comment Auto-Reply Sweep job must be enabled.

## Machinery choice + claim semantics

The machinery is the established **sweep pattern** (the same shape as `social_publish_due`): due timestamps in the DB, fired by a 1-minute scheduled job per org, installed from the template gallery. No timers are held in process memory, so a restart loses nothing and any replica can fire a due reply.

The claim is SP5-style: a conditional `updateMany` whose `where` includes the **exact due timestamp** read in the scan (`{ id, organizationId, autoReplyDueAt: <the exact value> }` for conversations; `{ id, aiReplyDueAt: <exact> }` for comments), setting it to null. If the count is 0, another sweep already claimed that row and this one skips it — **a double fire cannot double-send**. The batch markers are cleared conditionally afterwards (`autoReplyBatchSince` is cleared only when `autoReplyDueAt` is still null), so a newer message that re-armed the debounce while the sweep was composing is never clobbered.

**Effective delay = the configured setting + up to one sweep interval (1 minute).** A 45-second inbox delay therefore fires between 45 and ~105 seconds after the last message of a burst; each new message in the window re-arms the due time.

## Comment batch semantics

- Earlier still-PENDING comments by the **same author** (`authorSocialId` when present, else `authorName`) on the **same post**, created before the firing comment and still carrying an `aiReplyDueAt`, are claimed into the firing comment's reply (same exact-timestamp claim), in creation order.
- The single reply is composed by `buildReplyPlan` from the combined text (`[...covered, fresh]` joined with `\n`, capped at 1200 chars) and applied to the latest comment: status `AUTO_REPLIED`, `replyText`, `repliedAt`, DM flags from the fresh plan.
- **Covered-comment discharge rule:** a covered comment is marked `AUTO_REPLIED` with **no reply of its own** (`replyText` stays null); its `aiReplyBatchOf` is set to the firing comment's `externalCommentId` and its metadata gains `aiReplyBatch: { coveredBy: <externalCommentId> }`, so the discharge is auditable and traceable to the one reply that covered it.
- A comment an agent already handled (status no longer PENDING at fire time) is never replied to by the sweep, and if the org has since disabled `aiAutoReplyEnabled`, nothing fires.

## Safety actions stay immediate

The delay applies only to composing an AI reply. Unchanged and immediate:

- **Inbox escalation** (complaint / negative sentiment, human-request words, high-value open order, repeated-ununderstood) — it runs *before* the defer point, pauses the autopilot and notifies at ingest; no due timestamp is ever set for an escalated message.
- **Comment hide/spam** (`HIDDEN` at ingest when `autoHideSpam`), the **Telegram urgent alert**, and **lead creation** — all at ingest, exactly as before.
- At fire time, a **human reply** inside the batch window (an outbound message with `sentByUserId` set, at/after `autoReplyBatchSince`) or a **paused** conversation discharges the batch with no AI send.

## Delay = 0 regression evidence

Delay 0 is the pre-CX3 behaviour, pinned by specs: the inbox spec asserts an immediate `sent` auto-reply with `autoReplyDueAt`/`autoReplyBatchSince` never set, and the comments spec asserts the reply is applied at ingest (reply text, `repliedAt`, DM flag) with no due timestamp. The full suite (below) passes with no other behaviour changes.

## Evidence

- New specs: `apps/api/src/inbox/cx3-debounce.spec.ts` (**18 tests**) — settings round-trip + 400 validation, per-channel override, delay-0 regression, defer/extend with unchanged batch start, fire = exactly one batched reply (content proven to derive from the combined text) + idempotent re-run, human-reply discharge, paused discharge, immediate escalation, draft-mode deferral, tenant isolation; comments: delay-25 ingest (null reply + due ≈ +25s + retained plan), spam HIDDEN with no due, delay-0 instant, auto-reply-off schedules nothing, single fire, 2-comment batch (expected reply computed in-test by calling `CommentHumanizer` on the combined text; covered comment's `aiReplyBatchOf` + `metadata.aiReplyBatch.coveredBy`), already-manually-replied skip, disabled-at-fire skip, tenant isolation. Plus `apps/api/src/automation/cx3-jobs.spec.ts` (**5 tests**) — JOB_TYPES/JOB_TEMPLATES membership, both templates install as real 1-minute jobs, executeJob dispatch to the right service methods, and honest failure when a sweep service is unwired.
- Full gates are run on a clean worktree at the CX3 commit (the shared tree does not compile — see ceiling): API jest, web vitest, and the monorepo build. Exact counts are reported with the commit.

## Ceiling — stated plainly

- The sandbox has **no Postgres**: the migration is hand-written SQL in the repo's style, validated by `pnpm --filter @repo/db generate` (the generated client includes the new fields), **not applied** to a live database.
- **No live AI reply happened** and no live send of any kind was performed. Evidence is specs with fake prisma (the inbox replies in specs go through the real compose + webchat-local delivery path of the service; comment replies are the real `CommentHumanizer` plans), the full suites, and builds. Live verification awaits the owner's M30 sprint (a real org with the sweep jobs installed).
- The shared working tree contains another track's (AG1) uncommitted changes, including a broken `webchat.service.ts` (it calls `parseCourierCard` without importing it). Those files and hunks — including the AG1 hunks inside `inbox.service.ts` — were left completely untouched; CX3's `inbox.service.ts` changes were staged via a hunk-filtered patch containing only the CX3 hunks, and the full gates were verified in a clean worktree at the CX3 commit.
