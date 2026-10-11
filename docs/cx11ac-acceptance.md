# CX11ac Acceptance — Attribution completion + Reply Quality Analytics

Batch 2 of the Customer Experience Advanced Package
(`docs/cx-package-plan.md`). CX4 landed as `2d8dc1a`, CX5 as
`a645e64`. Local commit only — nothing pushed.

## What shipped

### Attribution (API + composer)

- `InboxService.sendReply` opts gained `aiAssisted?: boolean`,
  `quickReplyId?: string`, `draftEdited?: boolean`:
  - The message row is created with
    `sentWithAiAssist: Boolean(opts.aiAssisted)` and
    `quickReplyId: opts.quickReplyId ?? null`.
  - On a **confirmed send only**: a `quickReplyId` increments
    `QuickReply.timesUsed` by 1 (failure-isolated
    `.catch(() => undefined)`); a failed delivery never
    increments. The existing via-draft update becomes
    `{ status: "sent", ...(draftEdited !== undefined ? { sentEdited } : {}) }`.
- `sendDraft`: `edited = content !== String(draft.content ?? "").trim()`
  (the final content is already trimmed by the existing path),
  and it now calls `sendReply` with
  `{ viaDraftId, signature: true, aiAssisted: true, draftEdited: edited }`
  — every draft send is AI-assisted, and `MessageDraft.sentEdited`
  records whether the agent changed the text.
- Controller `POST conversations/:conversationId/messages`:
  `SendMessageDto` gained optional `aiAssisted` (boolean) and
  `quickReplyId` (string, ≤120), passed straight into `sendReply`.
- Web composer (`apps/web/src/app/dashboard/inbox/page.tsx`,
  component-local state, no `globals.css` change):
  - `aiAssistUsed` is set by the ghost Tab-accept handler and by
    a successful tone-rewrite apply. It is **not** cleared by
    typing.
  - `usedQuickReplyId` is set by the quick-reply picker item
    click; the textarea's real `onChange` (user typing) clears
    it — the picker's programmatic `setReply` does not fire
    `onChange`, so the distinction is preserved.
  - The text send handler posts
    `aiAssisted: aiAssistUsed || undefined` and
    `quickReplyId: usedQuickReplyId ?? undefined`; both flags
    reset on success, and both reset in the conversation-switch
    path (`openConversation`, where ghost state is cleared).
  - Picker items append ` · N বার ব্যবহৃত` when
    `q.timesUsed > 0` (`QuickReply` type gained `timesUsed?: number`).
  - Thread meta line: after the existing `AI Draft থেকে` /
    `🤖 অটো-রিপ্লাই` labels, a message with
    `!autoReply && !sentByAiDraft && sentWithAiAssist` shows
    ` · AI-সহায়তায়` (`Message` type gained
    `sentWithAiAssist?: boolean`, `quickReplyId?: string | null`).

### Attribution trust scope (READ THIS)

`sentWithAiAssist` is **reported by our own composer UI**: the
flag attests the UI path the text came through (ghost accept /
tone rewrite / draft send), **not** cryptographic proof of
authorship. `quickReplyId` likewise attests the picker path.
Any client that posts to the messages endpoint can set these
fields; they are honest bookkeeping for the shop's own team
analytics, not a verified provenance claim, and must not be
presented to customers or third parties as proof.

### Reply Quality analytics (as shipped)

`getTeamReport` returns an additive `replyQuality` block.
Window = the report's existing `days` window (`since = now -
days`); every query is org-scoped. Rates/averages are `null`
(never 0 or invented) when their denominator is 0; raw counts
always ride alongside. Round-to-1-decimal (`round1`) everywhere.

- **drafts** — `messageDraft` rows with
  `organizationId` and `createdAt >= since`:
  - `suggested` = all draft rows created in the window (any
    current status);
  - `sent` = rows with status `sent`; `dismissed` = rows with
    status `dismissed`; `sentEditedCount` = sent rows with
    `sentEdited` true.
  - `acceptanceRatePct = round1(100 * sent / (sent + dismissed))`,
    `null` when `sent + dismissed = 0`. Pending (still
    `suggested`) drafts are in `suggested` but **not** in the
    acceptance denominator.
  - `editedSharePct = round1(100 * sentEditedCount / sent)`,
    `null` when `sent = 0`.
- **csat** — conversations with `organizationId` and
  `csatRating != null` (take 2000), filtered in JS to
  `(csatRatedAt ?? resolvedAt) >= since`. For those conversation
  ids, outbound messages (`direction: "out"`) are fetched and
  each conversation is classified exactly:
  - `hasAuto` = any outbound message with `autoReply` true;
  - `hasHuman` = any outbound message with a truthy
    `sentByUserId`;
  - `aiOnly` = hasAuto && !hasHuman; `humanOnly` = hasHuman &&
    !hasAuto; `mixed` = both; `unclassified` = neither.
  - `aiOnly` / `humanOnly` / `mixed` carry `{ count, avgRating }`
    with `avgRating = round1(mean csatRating)`, `null` when the
    bucket count is 0. `unclassified` is **counted only**
    (`{ count, avgRating: null }`) — excluded from the averages.
- **perAgentAssist** — outbound messages with
  `direction: "out"`, `sentByUserId != null`,
  `createdAt >= since`, and the nested relation filter
  `conversation: { organizationId }`, grouped in JS by
  `sentByUserId`:
  `{ userId, sent, aiDraftCount (sentByAiDraft),
     aiAssistedCount (sentWithAiAssist && !sentByAiDraft),
     quickReplyCount (quickReplyId != null) }`,
  sorted by `sent` desc, capped at 50 agents.
- Each sub-query degrades to its empty shape on failure (the
  same discipline as the report's existing counters), so the
  rest of the team report never breaks.

### Web: Reply Quality section

In the Manage view's team report, a `🤖 Reply Quality` section
renders only when `report.replyQuality` exists (an older API
without the block renders nothing):

- "AI Draft গ্রহণের হার" — `acceptanceRatePct%`, or `তথ্য নেই`
  when null, with `(পাঠানো X · বাতিল Y)` counts and the
  definition: "সাজেস্ট করা ড্রাফটগুলোর মধ্যে যেগুলো আসলে
  পাঠানো হয়েছে; এখনো pending ড্রাফট এই হিসাবে নেই।"
- "পাঠানোর আগে সম্পাদনা" — `editedSharePct%` (or `তথ্য নেই`),
  definition: "পাঠানো ড্রাফটের কতগুলো এজেন্ট বদলে পাঠিয়েছেন।"
- "CSAT ভাগ" — three rows (🤖 শুধু AI / 👤 শুধু মানব / 🤝 মিশ্র)
  with avg (or `তথ্য নেই`) + count each, definition: "বন্ধ
  হওয়া কথোপকথনের CSAT — AI-handled মানে কোনো মানব-উত্তর
  ছাড়াই অটো-রিপ্লাইয়ে শেষ হয়েছে।"
- Per-agent assist mini-table (এজেন্ট / পাঠানো / AI Draft /
  AI-সহায়তা / Quick Reply); the agent name is resolved from
  the page's already-loaded members data, falling back to the
  first 8 characters of the user id — never an invented name.

## Migration

**None.** All four fields rode CX4's migration
`20261012120000_cx4_handover_queue`:
`ChannelMessage.sentWithAiAssist`, `ChannelMessage.quickReplyId`,
`QuickReply.timesUsed`, `MessageDraft.sentEdited`. This package
only wires them.

## Tests

New `apps/api/src/inbox/cx11ac-attribution.spec.ts` — 10 tests,
fake prisma in the cx3/cx4 style (the nested
`conversation: { organizationId }` filter is resolved against
the fake conversation store):

- (a) plain send → `sentWithAiAssist` false, `quickReplyId`
  null, no increment; aiAssisted → true; quickReplyId → set on
  the message + `timesUsed` incremented on success; delivery
  failure → NO increment, row failed.
- (b) sendDraft unedited → `sentEdited` false; edited → true;
  whitespace-only difference → not an edit; the sent message
  has `sentByAiDraft` true AND `sentWithAiAssist` true.
- (c) replyQuality math: draft counts + 66.7% acceptance +
  50% edited share; CSAT buckets aiOnly 5 / humanOnly 4 /
  mixed 3 / unclassified counted with null avg; per-agent
  grouping with the aiAssisted-vs-draft separation.
- (d) zero denominators → all rates/averages null, counts 0.
- (e) tenant isolation: another org's drafts, messages and
  rated conversations are excluded.

No pre-existing spec was edited.

## Gates (vs baseline)

Baseline (pre-existing, parallel tracks' uncommitted work):
API jest 1580 pass / 2 fail (`courier.spec.ts`,
`c3-customers-export.spec.ts`), 5 suites failing to compile on
the webchat `parseCourierCard` error; monorepo build = exactly
1 tsc error (the same webchat line); web vitest 78/78.

This package:

- New spec: **10/10 pass**.
- API jest full: **1590 pass / 2 fail** (1592 total) — the same
  2 baseline failures, the same 5 compile-failing suites
  (`m66-visitor-stream`, `nextgen-p2`, `nextgen-p3`, `phase-f`,
  `a2-shipment-di`, all on the pre-existing webchat error).
  No new failures.
- Web vitest: **78/78**.
- Monorepo build: exactly the same **1 pre-existing tsc error**
  (`webchat.service.ts:195 parseCourierCard`, a parallel
  track's uncommitted work — not touched); web `next build`
  green when run on its own.

## Honest ceiling

No Postgres in the sandbox, so no live-DB verification: the
attribution writes, the `timesUsed` increment and the
replyQuality aggregations are proven against the fake prisma
only, with the real Prisma queries shaped exactly as the
existing report queries are. No live Meta/WhatsApp send was
exercised (webchat delivery is the in-process path the specs
use for a confirmed send, and a WhatsApp conversation with no
integration for the failure path).
