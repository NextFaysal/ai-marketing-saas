# Inbox Next-Gen — Priority 3 (Team & AI) Acceptance

Status: **DELIVERED** (local commits only — nothing pushed; push waits for the
owner's explicit word, per the standing rule).

Scope source: `docs/inbox-nextgen-audit.md` items 6, 10, 11. Priority 1
(`9603f2d`) and Priority 2 (`c51127d` + `126a6fe`) are the predecessors.
Payment links remain **postponed by the owner's explicit decision**
(2026-10-11) and are not part of this phase.

## Item 1 — Inline internal whispers (audit item 11)

- The thread now renders ONE merged timeline: messages + internal notes
  interleaved by `createdAt` (`apps/web/src/lib/timeline.ts`,
  `mergeTimeline`, unit-tested; ties put messages before notes). Notes render
  as centered amber cards marked **"🔒 প্রাইভেট নোট · শুধু টিম দেখবে"** with
  author + time. The old side-panel notes card is **removed** — the timeline
  is the single home for notes; `noteText` state is gone.
- The composer gained a mode toggle **[💬 উত্তর] [🔒 নোট]**. In note mode the
  composer turns amber ("টিমের জন্য প্রাইভেট নোট লিখুন — গ্রাহক কখনোই দেখবে
  না…"), the send action calls **only** the existing notes endpoint, and the
  member @mention chips (moved here from the side panel) keep working so
  `notifyMentions` keeps firing.
- **Structural safety, not just convention:** in note mode the media / file /
  voice / product / image buttons, AI Draft, ghost and tone controls are not
  rendered at all; `sendReply()` and the media send path both hard-return when
  `composerMode === "note"`; the "/" quick-reply panel is disabled; the agent
  typing heartbeat is forced off (`setIAmTyping(false)`), so a whisper never
  shows the customer "typing…" either. There is no code path from note mode
  to any channel-send endpoint.

### No-leak proof (notes can never reach a customer)

1. Notes are `ConversationNote` rows — a separate table. They are never
   written as `ChannelMessage` rows (`createNoteInternal` touches only the
   note table + mention notifications).
2. Every customer-facing read/send path reads `ChannelMessage` only: the
   webchat visitor projection (`WebchatService.listMessages`, the SSE
   `deliverToVisitor` projection) and all channel send paths
   (Meta/Telegram/Email/Webchat) are built from message rows.
3. Evidence: `nextgen-p3.spec.ts` seeds a note + a message and asserts the
   visitor projection contains neither the note text nor a note shape, while
   `listNotes` still returns it for agents. The live check repeated this over
   real HTTP (see Verification): a note posted via the agent API is absent
   from `GET /public/chat/:key/messages` while the real customer message is
   present.

## Item 2 — AI enforcement parity (audit item 10 gap, promised fix)

`InboxService.checkAiAllowed(orgId, feature)` mirrors
`ai/creative-studio.service.ts` exactly: per-org kill switch from
`killSwitches()` → **403** `"AI features are temporarily disabled for this
organization by the platform team."`; plan daily cap from `effectiveLimits()`
counted on `AIUsageRecord` for that feature (UTC day) → **429**
`"Daily AI limit reached for this organization (N). …"`.

Applied to every **agent-initiated** inbox LLM feature:
`draft` (suggestDraft), `summary` (summarizeConversation), `translate`
(translateMessage), and the two new features `ghost_complete` /
`tone_rewrite`. Usage rows were already recorded for the existing features
and are recorded per call for the new ones.

**Boundary (deliberate): the autopilot is NOT gated.** It is not
agent-initiated — it runs per inbound customer message under its own
mode/confidence/escalation controls — and charging it against the
agent-facing daily cap would let a busy inbox silently disable drafting for
the whole day. Its own usage rows (`feature: "autopilot"`) are still
recorded. The boundary is also documented in the code at `checkAiAllowed`.

Existing spec fakes were extended to honour `count` (2 files, +3 lines each)
so enforcement runs against realistic fakes; **no enforcement was weakened
to fit a test.**

## Item 3 — AI ghost text (audit item 10)

`POST …/conversations/:id/ghost {partial}` → `{completion}`.

- Grounded exactly like drafts: recent thread + business profile/policies +
  product matched from the last inbound message. The prompt demands ONE
  short continuation (≤ ~14 words, same language), ONLY grounded facts.
- **Number guard:** any number in the completion (via the existing
  `extractNumbers`, Bengali-digit aware) that does not already appear in the
  partial, the thread or the grounded knowledge → the whole completion is
  dropped and `""` is returned. A repeated partial prefix is stripped; the
  completion is capped at 160 chars.
- **Honesty rules:** partial < 2 chars → `""` without any LLM call; the dev
  template provider → `""` silently with **no usage row** (a template cannot
  complete a sentence honestly); any provider exception → `""`. A ghost must
  never break the composer — only enforcement failures (403/429) throw,
  because those are policy, not flakiness.
- Web: debounced (600 ms) fetch in reply mode only, in-flight requests
  cancelled via AbortController + sequence guard, failures silent. The
  suggestion renders as grey text in a mirror overlay behind the textarea;
  **Tab** accepts, **Esc** / further typing / send / conversation switch
  dismisses; it never auto-sends. Caption while visible: "✨ AI সাজেশন — Tab
  চাপলে বসবে · Esc চাপলে যাবে".

## Item 4 — AI tone rewriter (audit item 10)

`POST …/conversations/:id/tone-rewrite {text, tone}`,
`tone ∈ polite | professional | sales` (UI: মার্জিত / পেশাদার / সেলস-বান্ধব).

- The rewrite preserves meaning and facts; a **post-check requires every
  number in the output to be a subset of the numbers in the input** — on any
  violation the rewrite is refused with
  `"AI সংখ্যা বদলে ফেলেছে, তাই এই রিরাইটটি প্রয়োগ করা হয়নি। আবার চেষ্টা করুন।"`
  instead of being silently applied.
- Dev provider → honest refusal (Bengali `BadRequest`, same style as
  translate's): no fake rewrite is ever produced. Empty text / >2000 chars /
  invalid tone → `BadRequest`. Enforcement per Item 2; usage recorded after
  the provider call.
- Web: "✨ টোন বদলান" in reply mode only; applying is a deliberate click and
  replaces the composer text only then, with an undo affordance ("↩ আগের
  লেখায় ফিরুন") that survives until the next manual edit.

## Item 5 — Mood meter (audit item 10) — with a documented deviation

- The deterministic classifier (`intent.ts`) is widened from binary to
  three-valued sentiment: a curated BN+EN **POSITIVE_WORDS** set is added,
  **strictly additive — negative always wins**; complaint precedence and all
  ingest/escalation behaviour are unchanged (the full pre-existing
  `inbox-intelligence.spec.ts` passes unmodified; new tests prove positive
  detection, negative-wins, and mixed aggregation).
- **Deviation from the original brief, with reason:** the brief assumed a
  per-message sentiment column existed. It does not — `ChannelMessage` has
  no sentiment field and per-message sentiment was never persisted (only
  `ChannelConversation.sentimentFlag` exists). Rather than add a schema
  change in this phase, mood is **computed at read time** from the stored
  message text with the same deterministic classifier, which yields identical
  results for historical and new messages alike. `getConversation` messages
  gain a computed `sentiment` field (inbound only); list + detail payloads
  gain `mood` = aggregate over the **last 5 inbound** messages
  (`moodFromMessages`: majority sign → positive/negative, tie → neutral, no
  inbound texts → null). The list path uses ONE batch query for the whole
  page (plus one for webchat last-seen), guarded so a partial schema can
  never break the list.
- Display: header chip 😃 ইতিবাচক / 😐 স্বাভাবিক / 😡 অসন্তুষ্টির সংকেত and a
  list marker replacing the old 😡-only snippet. All mood UI carries the
  honest tooltip: **"কীওয়ার্ড-ভিত্তিক আনুমানিক সংকেত — সাম্প্রতিক
  গ্রাহক-বার্তার শব্দ দেখে হিসাব করা, মনের অবস্থা নয়"** (keyword-based
  approximate signal, not mind reading). No inbound messages → no meter.

## Item 6 — Webchat presence + typing (audit item 6, the one buildable channel)

- `POST /public/chat/:key/presence {token, typing?}` in the M66 pattern:
  session resolved by SHA-256 token hash (`sessionByToken`); **bad token →
  401 before anything is recorded**. `LiveChatSession.lastSeenAt` is bumped
  with a **30 s write throttle**; the presence event is always emitted to the
  org agent stream (`visitor.presence` + `visitorTyping`).
- Agent side: webchat list cards show a green "অনলাইন" dot when last-seen
  < 60 s (or a fresh presence event arrived); the thread header shows
  "✍️ গ্রাহক টাইপ করছেন…" on a fresh (< 8 s) typing event, else "🟢 অনলাইন".
  Presence is ephemeral — everything ages out by timestamp; a 5 s UI tick
  re-evaluates while a conversation is open. No persistent "online" claim is
  stored anywhere.
- Visitor side: when an agent's presence heartbeat reports typing on a
  **webchat** conversation, `RealtimeService.notifyVisitorTyping` forwards a
  `{type:"typing"}` frame through the M66 visitor stream; the widget shows
  "টাইপ করছেন…" (4 s safety auto-hide). The widget also heartbeats every
  25 s while open and reports its own typing (2.5 s debounce, cleared on
  send).
- WhatsApp / Telegram / Messenger / Email are **explicitly untouched** — the
  platforms expose no customer presence/typing signal; the audit stands.

## Verification

- **API tests:** 683 passed / 98 suites (`npx jest --runInBand`), `tsc
  --noEmit` clean. New: `nextgen-p3.spec.ts` (24 tests — ghost grounding +
  usage row, invented-number drop, dev honesty, kill-switch 403 across
  ghost/draft/summary/translate, FREE-cap 429, tone number preservation +
  refusal + dev refusal + invalid tone, notes no-leak, mood payloads,
  presence token discipline + throttle) and 3 classifier tests in
  `inbox-intelligence.spec.ts`.
- **Web:** `tsc --noEmit` clean, `next build` green, vitest 38/38 (5 new
  `timeline.test.ts` merge tests).
- **Live check (sandbox stack, rebuilt API on :4000): 22/22 checks passed**
  over real HTTP against Postgres/Redis: register + org create; list mood
  positive (BN praise) + negative (EN "angry/fraud" — both from the curated
  word sets) + detail mood + per-message sentiment; `visitorLastSeenAt`
  null → set after a real presence heartbeat; ghost on the dev provider →
  empty completion; tone on the dev provider → honest Bengali 400; kill
  switch on → ghost **403** and draft-suggest **403**, off → ghost works
  again; 20 seeded `ghost_complete` rows → **429** with the cap message;
  presence bad token → **401**, good token → `{ok:true}` with `lastSeenAt`
  bumped; note posted by the agent is **absent** from the visitor message
  projection while the real message is present (no-leak, live).
  - One harness artifact found and understood during the live check: rows
    seeded via psql `now()` carry Dhaka wall-clock in a UTC-typed column,
    which makes the 30 s throttle compare against a "future" timestamp.
    Real sessions are written by Node (`new Date()`, true UTC) end-to-end,
    so production data is unaffected; the check was re-run with UTC-seeded
    values and passed.
  - **Not live-proven:** ghost/tone with a *real* LLM provider (the sandbox
    has no real provider key — the dev provider paths are live-proven and
    the real-provider paths are covered by fake-LLM service tests), and the
    two SSE typing fan-outs in a live browser/widget session (covered by the
    realtime + nextgen-p3 service tests).

## Working-tree note

The Team track's M74 commit (`417ac85`) landed while this phase was in
flight. Verified by inspection: it contains only Team-track work — **no P3
hunk was swept into it**, and its previously-uncommitted `rebalanceWorkload`
block was never modified by this phase. P3's commits stage only P3 files;
`apps/web/tsconfig.tsbuildinfo` remains untracked and uncommitted, as
always. **Nothing was pushed.**
