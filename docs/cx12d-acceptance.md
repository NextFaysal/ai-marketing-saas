# CX12d Acceptance — Channel-wise AI Schedule

Batch 1 (final item) of the Customer Experience Advanced package.
Migration: `20261012110000_cx12d_ai_schedule` — `InboxSetting.aiScheduleByChannel Json?`
(hand-written SQL, **not applied in the sandbox** — no Postgres here).

## Semantics

The schedule lives on `InboxSetting.aiScheduleByChannel`:

```json
{ "whatsapp": { "enabled": true, "windows": [ { "days": [0,1,2,3,4], "start": "09:00", "end": "22:00" } ] } }
```

- `days`: 0 = Sunday … 6 = Saturday. Times are `"HH:mm"` in the
  **organization's timezone** (`Organization.timezone`, default
  `Asia/Dhaka`), evaluated via `Intl.DateTimeFormat` in
  `apps/api/src/inbox/ai-schedule.ts`.
- No entry for a channel, or `enabled: false` → **no restriction**
  (AI behaves exactly as before CX12d).
- `enabled: true` with **zero valid windows → AI is OFF** for that
  channel at all times (explicitly on, no hours = AI off).
- A window with `end === start` is invalid and is **dropped by the
  parser** (`parseAiSchedule`) — it is not a 24-hour window.
- A window with `end < start` is **overnight**: it starts on each
  listed day and runs past midnight into the next day (e.g. Friday
  22:00–06:00 covers Saturday 03:00, but not Saturday 23:00).
- Multiple windows union. Start is inclusive, end is exclusive.
- Validation (settings update): channel keys ≤ 32 chars,
  `enabled` must be boolean, ≤ 8 windows per channel, days are
  unique ints 0–6 (non-empty), times match `HH:mm` 00:00–23:59.
  Invalid → **400** (Bengali message), nothing persisted; valid
  maps are stored normalized. A corrupt *stored* value reads back
  as `{}` from `getSettings` — it can never crash the autopilot.

## Where the gate applies — interaction order as implemented

**Inbox autopilot (`maybeAutoReply`)** — mode resolution
(perIntent > perChannelModes > autoReplyMode; `off` still wins
over everything, schedule included) → fresh row + `autoReplyPaused`
check → **escalation gate** → **CX12d schedule gate** → intent
whitelist → confidence check → CX3 defer point → compose/send.

- Escalation (complaint / negative sentiment / human-request /
  high-value order / repeated-ununderstood) fires **off-hours too**
  — it sits before the schedule gate.
- Because the schedule gate sits before the CX3 defer point, an
  off-hours message is **never deferred and never retro-answered**
  when the window opens: it simply waits for the team.
- The CX2 low-confidence unanswered-question capture sits after
  the gate, so it also does not fire off-hours (accepted; the
  message is in the inbox for the team regardless).

**Order bot** — gated at its ingest call site in
`processInboundIntelligence`: when the schedule blocks the
conversation's channel, the bot is skipped for that message.
Ingest, COD/CSAT handling, spam detection, assignment and the
autopilot path continue normally (the autopilot applies its own
gate). An already-active bot session is therefore also paused
off-hours at the call site, by construction.

**Social comments (`SocialCommentsService`)** — the schedule is
read from `InboxSetting` + `Organization.timezone` through the
service's own prisma (platform keys `facebook` / `instagram` are
the same channel keys as the inbox).

- `ingestComment`: the effective auto-reply flag is
  `aiAutoReplyEnabled && !scheduleBlocks`. It gates **only** the
  reply plan's application (`replyText` / `repliedAt` /
  `isPrivateDmSent` / `aiReplyDueAt`). Classification/hide,
  Telegram alerts and lead creation are unchanged — a spam comment
  is still HIDDEN while the schedule blocks.
- `runDueCommentReplies`: after the `aiAutoReplyEnabled` check and
  before `applyDueCommentReply`, a blocked platform is skipped.
  **Drop semantics:** the sweep's claim has already cleared
  `aiReplyDueAt`, so the pending AI reply is *cancelled*, not
  postponed — the comment stays `PENDING` for the team and is
  never retro-answered.

**Kill switch (factual note):** CX12d does not change any
kill-switch behaviour. In `InboxService`, the platform AI kill
switch + daily cap (`checkAiAllowed`, importing `killSwitches` /
`effectiveLimits` from `common/platform-settings`) applies to the
**agent-initiated** features (draft, summary, translate,
ghost-complete, tone rewrite) and deliberately **not** to the
autopilot path (`maybeAutoReply` / compose), per the comment at
that helper. The CX12d schedule is an org-level, per-channel
control that sits inside the autopilot/order-bot/comment paths
themselves; the two mechanisms are independent and neither
overrides the other.

## Indicator surface

- API: conversation **list** and **detail** responses carry
  `aiScheduleActive: boolean` (computed once per channel per
  request — one settings + timezone lookup, not per row). `true`
  when no schedule restricts the channel.
- Web: the open conversation's header shows a
  `🌙 AI এখন সময়সূচির বাইরে` chip when `aiScheduleActive === false`,
  with a title explaining AI will not auto-reply now and the team
  can still reply.
- Web settings (Inbox → settings, next to CX3's ⏳ section):
  per-channel (whatsapp / messenger / instagram / webchat)
  enable checkbox, weekday toggle chips (রবি…শনি), start/end time
  inputs, add/remove window, one save button for the whole map.

## Evidence

- New spec `apps/api/src/inbox/cx12d-ai-schedule.spec.ts`:
  **25 tests** — pure-helper matrix (inside/outside, overnight,
  Friday-start overnight, Asia/Dhaka timezone conversion, window
  union, end==start dropped, enabled-no-windows = off), parser
  throws (day 7, `"9am"`, non-object), settings 400 + normalized
  persist + corrupt-read-as-`{}`, autopilot gate (blocked → no
  send, no `autoReplyDueAt` even with CX3 delay on; complaint
  still escalates while blocked; no schedule → unchanged send),
  order-bot gate through the real ingest pipeline
  (`processInboundIntelligence`: blocked → no `BotSession`;
  control → session at `ask_product`), comments (blocked ingest →
  PENDING with null reply/dueAt; spam still HIDDEN; due comment
  blocked at fire time → stays PENDING, reply cancelled),
  precedence (perChannelModes `off` beats an active schedule;
  delay > 0 + active schedule → CX3 defer still happens),
  indicator on list + detail.
- Full gates run in a clean worktree at the CX12d commit (the
  shared tree carries another track's uncommitted work and does
  not compile): API jest, web vitest, monorepo build — see the
  delivery report for the totals.

## Ceiling (honest)

- No Postgres in the sandbox: the migration is hand-written and
  **not applied**; no live DB was touched.
- No live AI reply happened: all specs use fake prisma; the
  grounded compose path is the real one but sends go to the fake
  message store (webchat in-process delivery) only.
- No live Meta/WhatsApp/comment traffic was exercised; the
  schedule's effect on real channels awaits the M30 live
  verification sprint.
