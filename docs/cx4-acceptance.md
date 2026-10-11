# CX4 — Handover Queue Polish: Acceptance

Batch 2 of the Customer Experience Advanced Package
(`docs/cx-package-plan.md`). Local commit only — nothing pushed.

## What shipped

### 1. Schema + migration (the whole Batch 2 field set)

Migration `20261012120000_cx4_handover_queue` (hand-written additive
SQL, same style as the CX3/CX12d migrations). This one migration
carries the fields for CX4 **and** the two sibling Batch 2 items
that ride along, so the batch needs no second migration:

- CX4 — `ChannelConversation`: `handoverReason` TEXT,
  `handoverAt` TIMESTAMP(3), `assignedUntil` TIMESTAMP(3),
  `assignmentKind` TEXT, `assignedAt` TIMESTAMP(3)
- CX5 (rides along) — `ChannelConversation`: `snoozedUntil`
  TIMESTAMP(3)
- CX11ac (rides along) — `ChannelMessage`: `sentWithAiAssist`
  BOOLEAN NOT NULL DEFAULT false, `quickReplyId` TEXT;
  `QuickReply`: `timesUsed` INTEGER NOT NULL DEFAULT 0;
  `MessageDraft`: `sentEdited` BOOLEAN NOT NULL DEFAULT false

All fields are mirrored in `packages/db/prisma/schema.prisma` with
house-style comments labelled CX4 / CX5 / CX11ac.

**The migration was NOT applied** — there is no Postgres in the
sandbox. It must be applied on the deployment (`prisma migrate
deploy`) before the new code paths hit a real database; until then
the new columns simply do not exist there. All verification here
is fake-prisma (specs) + type/build level.

### 2. Escalation fields

`escalateAutopilot` (the only place `autoReplyPaused: true` is
written) now also writes `handoverReason: reason` and
`handoverAt: new Date()` in the same update, and includes both in
the `rtConversation` realtime payload. The audit entry
(`inbox.autopilot.escalated`, metadata `{ reason }`) is unchanged —
the reason is now a real field *and* stays in audit.

Note: the order bot's `botFail` only writes an internal note and
hands the bot session off — it does **not** pause the autopilot —
so it deliberately does not set the handover fields. It was left
alone.

### 3. Timed assignment

`updateConversation` (service DTO type, `UpdateConversationDto`,
controller pass-through unchanged — it forwards the DTO) accepts
optional `assignForMinutes`:

- Only meaningful together with `assignedUserId` in the same call.
  Must be an integer 5..480, otherwise `BadRequestException` with a
  Bengali message; an `assignForMinutes` without an assignee is
  also a 400.
- Whenever `dto.assignedUserId !== undefined` (an assignment change
  in this call): assigning sets `assignedAt = now`; with minutes,
  `assignedUntil = now + minutes` and `assignmentKind = "timed"`;
  without minutes, `assignedUntil = null`,
  `assignmentKind = "normal"`. Unassigning (`assignedUserId: null`)
  clears `assignedAt` / `assignedUntil` / `assignmentKind`.
- Calls without `assignedUserId` leave all four fields untouched.

**`assignedAt` rationale:** the sweep must decide "did the assignee
reply *since this assignment began*?" A deadline alone cannot
answer that — a reply from before the assignment would look like
activity. `assignedAt` is the reference point for that check, and
it is refreshed on every assignment change (and cleared on
unassign / timer return).

### 4. Handover timer sweep + job

New `InboxService.runHandoverSweeps(organizationId)`:

- Finds timed assignments with `assignedUntil <= now`, status not
  closed (take 100).
- Assignee replied (outbound message by `assignedUserId` with
  `createdAt > assignedAt ?? epoch`) → **lapse**: timer dropped
  (`assignedUntil: null`, `assignmentKind: "normal"`), assignment
  and `autoReplyPaused` untouched.
- No reply → **return to AI**: assignee + all timer fields
  cleared, `autoReplyPaused: false`, a system `ConversationNote`
  ("⏱️ নির্ধারিত সময় শেষ — কথোপকথনটি AI-এর কাছে ফেরত দেওয়া
  হয়েছে"), an audit entry `inbox.handover.timer_returned` with
  metadata `{ previousAssignee }`, and an `rtConversation` payload
  with the cleared fields.
- Per-conversation failures are isolated; returns
  `{ returned, lapsed }`.

Job registration, mirroring `inbox_autoreply_sweep` exactly:
`JOB_TYPES` gains `"handover_timer_sweep"`; `JOB_TEMPLATES` gains
`{ key: "handover_timer_sweep", name: "Handover Timer Sweep
(টেমপ্লেট)", type: "handover_timer_sweep", targetKind: "org",
intervalMinutes: 1, descriptionBn: … }`; `executeJob` case
`"handover_timer_sweep"` → `this.inbox.runHandoverSweeps(orgId)`
with the same not-available guard; the web Automations form's org
job-type list gains the matching entry.

### 5. Handover queue API

- `listConversations` folder `"handover"`: AND clause
  `{ autoReplyPaused: true, status: { in: ["open", "pending"] } }`,
  composed with the other filters exactly like sla/vip. When the
  folder is handover, fetched rows are sorted by waiting start
  ascending (longest wait first), where
  **waitingSince = `handoverAt ?? updatedAt`** — rows escalated
  before CX4 have no `handoverAt`, and `updatedAt` is the honest
  fallback (it is the last time anything touched the thread).
- `conversationFolderCounts` gains `handover` with the same clause.

### 6. Handover queue web (inbox page, component-local only)

- `Conversation` interface gains `handoverReason`, `handoverAt`,
  `assignedUntil`, `assignmentKind`, `snoozedUntil` (typed for CX5;
  unused by CX4 UI) and `updatedAt` (the waiting fallback).
- `folderCounts` type gains `handover: number`; `smartFolder` /
  `applyFolder` types widened with `"handover"`.
- Folder chip after VIP: "🤝 Handover কিউ" with the server count.
- In the handover folder, each conversation row shows: a reason
  chip (light map: complaint / human_requested /
  negative_sentiment / high_value_order / manual_takeover /
  order_bot; fallback = the raw value), a waiting chip
  ("⏳ {n} মিনিট অপেক্ষা", or "⏳ {h} ঘণ্টা {m} মিনিট" past an
  hour) computed from `handoverAt ?? updatedAt`, and — while a
  timed assignment is still running — "⏱️ আরও {n} মিনিট (timed)".
  A 30-second interval tick in the page component keeps the
  numbers moving; an honest empty state was added for the folder.

## Tests

New `apps/api/src/inbox/cx4-handover.spec.ts` — 13 tests, all
passing (fake prisma, following `cx3-debounce.spec.ts` patterns):
escalation writes both fields + audit reason; timed assign /
manual assign clears timer / unassign clears all; minutes 4 and
481 (and 30.5) → 400; updates without `assignedUserId` leave the
assignment fields untouched; sweep return-to-AI (exact note text,
audit action + `previousAssignee`, counters), lapse-on-reply
(autopilot untouched), replies from others / before `assignedAt`
do not count, not-yet-expired and closed untouched; folder filter
+ longest-wait-first sort (incl. the `updatedAt` fallback row) +
counts; tenant isolation on both the sweep and the counts; job
registration + `executeJob` dispatch.

## Gates (this run, combined worktree)

- CX4 spec: **13/13 pass**.
- API jest (full): 1550 pass / 2 fail of 1552 tests; the 2 failing
  tests and the suites that fail to compile are all in **parallel
  tracks' uncommitted work**, not CX4 — see Overlap notes.
  CX4-adjacent suites (cx3-debounce, cx3-jobs, a4-job-templates,
  inbox-power, u5-control, …) pass.
- Web vitest: **72/72 pass**.
- Monorepo build (`npx pnpm@9.15.0 -r build`): contracts / db / ui
  / worker / admin green; web green (also verified standalone,
  exit 0, incl. type checking); apps/api `tsc` reports exactly one
  error — in the parallel track's `webchat.service.ts` (see
  below). No CX4 file produces a build or type error.

## Overlap notes (parallel tracks)

Other tracks had uncommitted work in the tree throughout, and two
of them were actively editing during the gate runs:

- `apps/api/src/inbox/webchat.service.ts` (parallel) calls
  `parseCourierCard(m)` without importing it — the export exists
  in their untracked `courier-card.ts`. This one TS error blocks
  `apps/api` tsc and the jest suites that import the webchat chain
  (nextgen-p2, nextgen-p3, phase-f, m66-visitor-stream). Not a CX4
  file; left for its owners.
- The 2 failing API tests are the parallel AG1 changes:
  `courier.spec.ts` (courier-card notify behaviour in their
  `courier.service.ts`) and `c3-customers-export.spec.ts` (their
  `customers.service.ts` adds risk columns to the CSV header).
- A competitors honesty-fix track was mid-edit on
  `rules-engine.ts` during one full run, transiently breaking
  additional suites' compilation; a later state compiled further.
- `inbox.service.ts` staging used the merge-file technique: the
  committed version is HEAD + CX4 hunks only, and the parallel
  AG1 hunks (courier card / risk) remain uncommitted in the
  worktree where they belong. HEAD moved during the build (the
  UX1 Q2 commit `2848898` landed the previously-uncommitted
  `unreadTotal` counts change), so the merge was redone against
  the new HEAD — clean, no conflicts, zero AG1 leakage verified
  by diff. The worktree file still contains both tracks' changes.

No pre-existing test was changed by CX4.

## Honest limits

- No live verification: no Postgres (migration unapplied), no Meta
  token — the sweep, queue and timed assign are proven against
  fake prisma and types only, not against a running deployment.
- The handover folder's waiting sort happens after the list's
  100-row fetch (same pattern as the existing unread sort), so in
  an org with >100 paused+open threads the longest-waiting row
  could sit outside the fetched page. The folder **count** is
  server-side and exact.
