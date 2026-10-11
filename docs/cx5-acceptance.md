# CX5 Acceptance — One-row Action Bar + Snooze

Batch 2 of the Customer Experience Advanced Package
(docs/cx-package-plan.md), built on CX4 (2d8dc1a). **Migration:
none** — `ChannelConversation.snoozedUntil` already exists in the
schema, carried by CX4's migration `20261012120000_cx4_handover_queue`.

## API semantics shipped

### Snooze / unsnooze
- `POST conversations/:conversationId/snooze` —
  `snoozeConversation(org, actor, id, { minutes? , until? })`:
  exactly one of `minutes` / `until` is required (both or neither
  → Bengali BadRequest). `minutes` must be an integer 5..10080;
  `until` must parse to a future time (> now + 60s). Sets
  `snoozedUntil`, audits `inbox.conversation.snoozed` with
  `{ snoozedUntil: ISO }`, realtime-patches `{ snoozedUntil }`.
- `POST conversations/:conversationId/unsnooze` — clears
  `snoozedUntil`, audits `inbox.conversation.unsnoozed`, realtime.
- Snoozing does **not** touch `autoReplyPaused` or the assignment —
  it is purely "show me this later", and the UI says so in the
  snooze menu itself.

### Visibility rule (one rule, lists + counts)
An actively-snoozed conversation (`snoozedUntil > now`) is hidden
from **every** list view and **every** folder count **except** the
snoozed folder. Implemented as one shared clause,
`notSnoozed = { OR: [{ snoozedUntil: null }, { snoozedUntil: { lte: now } }] }`,
AND-merged in `listConversations` for all folders except
`"snoozed"` (and when no folder is set), and spread into the
all / mine / unassigned / slaBreach / vip / handover counts in
`conversationFolderCounts`. The unread **total** (tab badge) is
deliberately unchanged — it is a message-attention signal, not a
folder count.
- Folder `"snoozed"`: `snoozedUntil > now` AND status open/pending,
  rows sorted by `snoozedUntil` ascending (earliest wake first).
- `counts.snoozed`: same clause as the folder.

### Wake behaviour
`runHandoverSweeps` (CX4's sweep; the one home for timed
conversation states) now also wakes: rows with
`snoozedUntil <= now`, not null, status not closed (take 100) get
`snoozedUntil` cleared + a realtime patch. Return shape is now
`{ returned, lapsed, woken }`. **Wake is quiet**: the sweep clears
the field and realtime refreshes open clients — the conversation
simply reappears in the lists. No fake message row is created and
nothing is sent to the customer. Closed conversations are never
woken by the sweep (and see below, resolving already cleared
their snooze).

### Resolving clears snooze
`updateConversation` with `status: "closed"` now also sets
`snoozedUntil = null` (alongside `resolvedAt`).

### Take over / back to AI
- `POST conversations/:conversationId/take-over` — ONE update:
  `assignedUserId = actor`, `assignedAt = now`,
  `assignedUntil = null`, `assignmentKind = "normal"`,
  `autoReplyPaused = true`, `handoverReason = "manual_takeover"`,
  `handoverAt = now`. Audit `inbox.conversation.take_over`,
  realtime with the same fields. Reuses CX4's fields — no schema
  change.
- `POST conversations/:conversationId/back-to-ai` — update
  `autoReplyPaused = false`, `assignedUntil = null`,
  `assignmentKind = null`. The **assignee and the handover history
  (reason / time) are kept**. Audit
  `inbox.conversation.back_to_ai`, realtime.
- All four routes use the conversation-write roles
  (OWNER / ADMIN / MARKETING_MANAGER / SUPPORT_AGENT). Body DTO:
  `SnoozeConversationDto` in inbox.dto.ts.

## Web: the one-row action bar
Directly under the thread header title row, exactly seven
segments in order:
1. **✓ Done** — the existing close/reopen button, relocated from
   the mobile quick row (same `patchConversation({ status })`;
   label toggles "↩️ আবার খুলুন" when closed).
2. **😴 Later** — dropdown (tone-menu pattern): presets
   ১ ঘণ্টা (60) / ৪ ঘণ্টা (240) / ২৪ ঘণ্টা (1440), a custom
   `datetime-local` input + "Snooze করুন", and the footer note
   "Snooze AI বন্ধ করে না — কথোপকথন শুধু তালিকা থেকে সরে থাকে।"
   When the open conversation is currently snoozed the segment
   instead shows "😴 {time} পর্যন্ত snoozed" + an "এখনই জাগান"
   (unsnooze) button.
3. **🙋 Take over** — POST take-over; the returned row is merged
   into `active` and the list reloads (patchConversation's
   post-action refresh pattern).
4. **🤖 Back to AI** — visible only when `autoReplyPaused`; POST
   back-to-ai, same refresh.
5. **⏱️ Timer** — dropdown: ১৫/৩০/৬০/১২০/২৪০ মিনিটের জন্য আমার
   কাছে → `patchConversation({ assignedUserId: myId, assignForMinutes: n })`
   (CX4 semantics; `myId` is the page's existing /auth/me id, the
   same one the mobile assign row and ⌘K use). While a timed
   assignment runs, the button shows the remaining minutes and
   the menu offers "টাইমার বাতিল" → re-assign without minutes.
6. **👤 Assign** — the assignee `<select>` relocated from the
   context panel (same options + onChange). Removed from the
   panel; the panel's other content is untouched.
7. **🎯 Lead** — the pipeline-stage select relocated from the
   toolbar row into the bar (same onChange).

- **Banner**: the autopilot-paused banner is now a passive strip —
  the "▶️ আবার চালু করুন" button was removed (resuming lives in
  the bar as 🤖 Back to AI) — and it additionally shows the
  handover reason label (shared CX4 reason-label mapping) when
  `handoverReason` is present.
- **Snoozed folder**: folder chip "😴 Snoozed" after Handover,
  fed by `folderCounts.snoozed` (type extended); rows in the
  folder show a "😴 {wake time}-এ জাগবে" chip; honest empty state.
- **Mobile**: the bar wraps; on small screens Done / Take over /
  Back to AI (and the snoozed chip + wake button) stay visible,
  Later / Timer / Assign / Lead collapse into a "⋯ আরও" dropdown
  reusing the same segment controls.
- Pure helpers live in `apps/web/src/lib/snooze.ts`
  (`SNOOZE_PRESETS`, `snoozeBodyForMinutes`, `snoozeBodyForCustom`,
  `isActivelySnoozed`) with `snooze.test.ts` (6 tests). No
  globals.css change.

## Tests
- New `apps/api/src/inbox/cx5-snooze-actions.spec.ts` — 16 tests:
  minutes + until paths, both/neither → 400, range + past-until →
  400, unsnooze + audit, list exclusion (default + handover
  folder), snoozed folder contents + wake-time sort, counts
  exclusion + snoozed count, wake via runHandoverSweeps (woken
  count, field cleared, future + closed + foreign untouched),
  resolving clears snooze, take-over's single-update field set +
  audit, back-to-ai field effects (assignee + history kept),
  tenant isolation.
- Pre-existing spec edit: `cx4-handover.spec.ts` — the four
  `runHandoverSweeps` return-shape assertions gained `woken: 0`
  with a CX5 comment (the CX5 wake extension changed the shape;
  CX4 behaviour assertions are unchanged). The automation
  dispatch test's stub was left alone — it asserts pass-through,
  not the real shape.

## Gates (vs baseline)
Baseline at start: API jest 1550 pass / 2 fail (courier.spec.ts,
c3-customers-export.spec.ts — parallel AG tracks' uncommitted
work); monorepo build exactly 1 tsc error
(webchat.service.ts:195 `parseCourierCard`, parallel track).

- API jest full: **1580 pass / 2 fail** — the same two baseline
  failures, nothing new. (Five suites that import WebchatService —
  nextgen-p2/p3, phase-f, m66-visitor-stream, a2-shipment-di —
  fail to *compile* on the same pre-existing webchat error; 0
  tests in them ran or failed. CX5 16/16, CX4 13/13 pass.)
- Web vitest: **78/78** (72 baseline + 6 new snooze tests).
- Monorepo build: web ✓, admin ✓, all packages ✓; API fails with
  exactly the one baseline webchat error — no new error.

## Honest ceiling
No Postgres in the sandbox: the sweep, lists and counts are
verified against fake-prisma specs only; no live snooze → wake
cycle was run against a real DB or a real Meta/WhatsApp
conversation, and there is no screenshot QA of the action bar
with real data.
