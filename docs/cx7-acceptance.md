# CX7 — "To Chase": Acceptance

Stalled order-bot sessions get gentle, bounded follow-up nudges.
LOCAL ONLY (no push). Built on HEAD ef11d26 (CX Batch 3).

## What was built

**Settings** (InboxSetting + `UpdateInboxSettingsDto` + service
validation + a Bengali settings section in the inbox page, placed
right after the CX12b review-request section):

| Field | Default | Bounds (DTO + service) |
|---|---|---|
| `chaseEnabled` | `false` (opt-in — this messages customers) | boolean |
| `chaseFirstDelayMinutes` | 60 | int 15..1440 |
| `chaseIntervalMinutes` | 240 | int 60..2880 |
| `chaseMaxAttempts` | 3 | int 1..5 |
| `chaseQuietHoursRespect` | `true` | boolean |
| `chaseQuietStartHour` | 22 | int 0..23 |
| `chaseQuietEndHour` | 8 | int 0..23 |

**Model `OrderChase`** (migration `20261012150000_cx7_order_chase`):
`{ id, organizationId, sessionId @unique, conversationId, attempts,
lastChasedAt, lastFailedAt, stoppedReason, lastEvent, createdAt,
updatedAt, @@index([organizationId, stoppedReason]) }`.

Shape justification: one chain per **BotSession**, because the
session is the unit of stalling — it owns the collected
product/quantity/contact data and its `status` is the lifecycle
signal. Not per-conversation (a conversation can host several
sessions over time) and not per-order (by definition there is no
order yet; an order appearing is a stop condition). `sessionId`
UNIQUE is the dedupe guard: a session can never grow two chains.
The row is created lazily by the sweep on first consideration.

**Sweep** — `OrderChaseService.runOrderChaseSweep(organizationId,
sender)` in `apps/api/src/orders/order-chase.service.ts`, wired
exactly like CX12b: `JOB_TYPES += "order_chase_sweep"`, an org
`JOB_TEMPLATES` entry (60 min, Bengali description stating the
opt-in requirement), an `executeJob` case passing
AutomationService's InboxService as the structural
`ChaseChatSender` (no import cycle), the service + controller
registered in OrdersModule, and one line added to the web
Automations page job-type list the same way CX12b added
`review_request_sweep`.

Candidates: BotSessions of the org with `status = "active"` and
`updatedAt` older than `chaseFirstDelayMinutes` (the bot bumps
`updatedAt` whenever it processes a customer reply, so it is the
session-quiet clock), oldest first, `take 100`.

**Surface** — `GET /organizations/:organizationId/order-chases`
(TenantGuard, mirrors reviews.controller.ts) feeding a
"🎯 To Chase" card on the orders dashboard page (after the CX12b
reviews card): product name (resolved from the Product table),
Bengali status (stopped reason / attempts so far / waiting),
last chase time, and a failed-send marker. The list contains
**chase records only** — sessions that are eligible but have
never been considered by a sweep have no row and are not listed;
the sweep creates the row on first consideration. Inventing rows
at read time would misstate each chain's history.

## Semantics

Stop conditions are checked **before any send, in this order**
(first hit wins, recorded on the row):

1. `session_ended` — fresh re-read shows the session is no
   longer `active` (completed / handed_off / expired), or the
   conversation row is gone.
2. `completed` — an Order exists for this conversation.
   **Audit note:** the brief asked to verify which model carries
   `conversationId` — it is `Order.conversationId` ("Conversation
   this order was created from (chat / bot orders)"), the
   chat-order pipeline's own linkage, so this is a direct lookup,
   not a proxy via session status.
3. `human_took_over` — conversation `closed`, OR
   `autoReplyPaused` (handover pause), OR an outbound HUMAN
   message after session start. Human = `direction "out"` with
   `autoReply = false`: `sendAutomatedMessage` always sets
   `autoReply = true`, so a non-autoReply outbound is an agent's
   send by construction; bot/automated messages never stop a
   chain by themselves.
4. Customer inbound after max(session start, lastChasedAt):
   - **Stop word → `stop_word`.** Matcher (`matchesChaseStopWord`)
     is conservative / whole-message-ish: after trim + lowercase
     + stripping trailing sentence punctuation (incl. `।`), the
     message must EQUAL a phrase (`থামুন`, `থামান`, `stop`,
     `লাগবে না`, `চাই না`, `দরকার নেই`), or START with it, or END
     with it, with a boundary (end / whitespace / punctuation)
     on the joined side. So `stop please`, `please stop`,
     `আমার লাগবে না` match; `stopwatch`, `আমি চাই`, `লাগবে` do not.
   - **Any other reply → non-terminal.** `lastEvent =
     "customer_replied"` is recorded, nothing is sent, and the
     reply becomes the new activity baseline: the chain is
     eligible again only after a fresh quiet period measured
     from max(session.updatedAt, last inbound time) —
     `chaseFirstDelayMinutes` before the first chase,
     `chaseIntervalMinutes` afterwards. (Verified: the bot bumps
     `session.updatedAt` when it consumes a reply, which mostly
     covers this; the explicit last-inbound term covers replies
     the bot did not consume, e.g. a reply typed while the flow
     was mid-handover.)
5. `max_attempts` — `attempts >= chaseMaxAttempts`.
6. Quiet hours — skip silently, **no state change**, when
   `chaseQuietHoursRespect` and `isChaseQuietHour(now, orgTz,
   start, end)`. The helper is pure: hours are whole hours in
   the org timezone (Intl, Asia/Dhaka→UTC defensive fallback
   like ai-schedule.ts); `start < end` is a same-day window,
   `start > end` is overnight (22→8 = 22:00–07:59), and
   `start == end` means no window.
7. Interval — `now - lastChasedAt < chaseIntervalMinutes` → skip.

**Send:** `sendAutomatedMessage(orgId, conversationId, text,
"order_chase")`. If `session.data.productId` resolves against
the org-scoped Product table, the text names that product
("আপনি “…” অর্ডার করছিলেন — …"); otherwise the generic text.
A price is never mentioned — never invented. Both texts carry
the opt-out hint ("আর মেসেজ না চাইলে “থামুন” লিখুন").

**Failed-send rule:** `sendAutomatedMessage` only resolves on a
platform-confirmed send and throws otherwise. A throw does NOT
increment `attempts`; it stamps `lastFailedAt` and the session
stays eligible for the next sweep. Only a confirmed send does
`attempts += 1, lastChasedAt = now`. Per-session try/catch
isolation; the sweep returns `{ considered, sent, stopped,
skipped, failed }` (early-outs add `skippedReason`).

## Migration

`20261012150000_cx7_order_chase` — hand-written additive SQL in
the CX12b style (new `OrderChase` table + 7 `InboxSetting`
columns). **Written, NOT applied: the sandbox has no Postgres.**
`prisma generate` was run so the client/types know the model.

## Evidence ceiling

Specs + suites + typecheck only. **No live send is claimed** —
all sends are proven through a fake sender at the
`sendAutomatedMessage` seam, exactly like CX12b.

- New spec `apps/api/src/orders/cx7-order-chase.spec.ts`:
  **24/24 pass** — candidate selection (delay respected,
  disabled no-op, closed conversation stopped), every stop
  condition incl. ordering, stop-word matcher matrix (incl.
  lookalike refusals), cap, interval gating, quiet-hours helper
  (overnight + same-day + start==end + respect off/on in the
  sweep), failed-send rule + retry eligibility, product-name vs
  generic fallback, tenant isolation (other org's sessions /
  orders never touched), DTO bounds (decorator level).
- Targeted suites (orders + automation + inbox): **465 tests
  pass**; 4 suites fail to *run* — all four on the same
  pre-existing parallel-track error
  `webchat.service.ts:195 TS2304 parseCourierCard` (AG1
  uncommitted work; untouched by CX7).
- Full API suite: **1666 pass / 2 fail** of 1668. The 2 failures
  are in parallel-track files (courier spec — AG1's courier-card
  text change; customers export spec — AG1's customers.service
  change); 7 failed suites include the 4 webchat ones above and
  the known-flaky `cx3-debounce` suite (passed in the targeted
  run; flakiness documented pre-CX7).
- API `tsc --noEmit`: zero errors in CX7 files; the only error
  in the union tree is the same pre-existing AG1
  `webchat.service.ts` TS2304.
- Web: vitest **96/96 pass**. Web `tsc` shows 3 errors, all in
  `apps/web/src/app/dashboard/automations/page.tsx` and all
  pre-existing in the union tree: the `@/lib/automation-blueprints`
  import (that lib file is deleted in the worktree by a parallel
  track), an `EmptyState onAction` mismatch from the parallel
  `packages/ui` change, and a downstream implicit-any. CX7's own
  one-line addition to that page, plus the inbox and orders
  pages, are error-free.
