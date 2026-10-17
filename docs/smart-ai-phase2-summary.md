# Smart AI — Phase 2 (AI Worker) Close-Out Summary

Date: 2026-10-17. Branch `smart-ai` (worktree
`ai-marketing-saas-sai`), base `47cf7f55` (SA-B9, Phase 1
closed) → Phase-2 final HEAD at SA-B13. Local commits only;
nothing pushed. Plan of record:
`Smart-AI-Full-Master-Plan-2026-10-17.md` §6 Phase 2
(W1–W4), laws L1–L5 (§2), decision D5 (autonomy).

Phase 2 gave the Brain **hands**: one Action Engine that
turns decisions into real, verified work on the surfaces
Phase 1 taught to talk — first the engine and its law
(SA-B10), then every inbox executor (SA-B11), then every
comment executor, so that **every executable entry in
catalog v1 is wired** (SA-B12), and finally the human
surface: the tenant Control Center and the per-org Answer
Store switch (SA-B13). Two migrations across the phase —
228 → 229 (the engine's autonomy table; the store toggle).

## W1–W4 audit

| # | Item | Status | Batch | Evidence |
|---|---|---|---|---|
| W1 | Action Engine — Action Proposal model, autonomy levels 0–3, verification, audit trail | **Shipped** | SA-B10 | `docs/smart-ai-b10-acceptance.md` |
| W2 | Inbox Actions — assign/tag/close/reopen/spam/block + inbox tools | **Shipped** | SA-B11 | `docs/smart-ai-b11-acceptance.md` |
| W3 | Comment Actions — hide/unhide/delete/reply/DM with re-verification | **Shipped** | SA-B12 | `docs/smart-ai-b12-acceptance.md` |
| W4 | AI Control Center (basic) — proposal approvals, autonomy per module, caps, kill switch | **Shipped (basic, as planned)** | SA-B13 | `docs/smart-ai-b13-acceptance.md` |

**Audit outcome: 4 shipped, 0 partial, 0 not built,
0 silently dropped** — with the plan's own scope note kept
visible: W4 is the *basic* Control Center by design; the
FULL Control Center + AI Activity page is Phase 6 (T4) in
the plan, and is named in the NOT BUILT list below, not
forgotten. Recorded decisions inside the shipped items:

1. **The engine EXTENDS the M47 proposal rails, it does not
   duplicate them** (SA-B10): `AIActionProposal` gained the
   engine columns; the exactly-once conditional-update
   claims, audit and verification ride the rails that already
   existed and were already proven.
2. **`set_conversation_priority` was dropped from the
   catalog before it ever shipped** (SA-B10): no staff
   setter exists — priority is classification-internal, and
   inventing one would break L5. The catalog is 12 typed
   entries, each mapped to a VERIFIED real service path.
3. **Trigger D was decided AGAINST** (SA-B12): a
   guard-blocked comment already sits in the human
   moderation queue, and the only candidate reply text is
   the text the guard rejected — a proposal there is
   designed to fail. Recorded, not silently skipped.
4. **The Answer Store switch gates the store's own
   learning, not a human's deliberate approval** (SA-B13):
   while off, lookups miss on every channel and the
   automatic captures write nothing; a `staff_approved`
   store (the owner pressing approve in the Learn Dashboard)
   may still land but cannot serve until the switch is back
   on. One gate inside `AnswerStoreService` covers inbox,
   draft and comment paths alike.

## What each batch shipped (one line each)

- **SA-B10 (W1)** — catalog v1 (12 actions), `AiAutonomySetting`
  (migration `20261031000000_sai_actions`), propose → approve →
  execute → verify over the M47 rails; D5 enforced (L3 refused
  at the settings API with the reason audited);
  `request_refund` proposal-only forever.
- **SA-B11 (W2)** — all 5 inbox executors + verifiers wired
  through the real staff paths; open-proposal dedupe
  (org+action+conversation, tag-set aware); 3 deterministic
  proposers over the event bus (order-complete → close,
  spam flag → block_sender, suggestNextAction bridge).
- **SA-B12 (W3)** — all comment executors + verifiers wired
  (Graph-first staff paths); the number guard re-runs at
  EXECUTION against fresh facts; triggers E (repeat spam
  author → propose delete) and F (DM-invitation without its
  private reply → propose send_dm) wired; D decided against.
- **SA-B13 (W4)** — `BusinessProfile.answerStoreEnabled`
  (migration `20261101000000_sai_control`, default TRUE) with
  one enforcement gate in `AnswerStoreService`; the tenant
  "🤖 AI নিয়ন্ত্রণ" section in Organization Settings
  (proposal queue, decided outcomes, activity from the
  fetched window, autonomy matrix with L3 disabled and the
  money badge); this close-out.

## Cumulative gates across Phase 2

| Batch | New specs | Targeted jest | tsc / build | Fresh-PG |
|---|---|---|---|---|
| SA-B10 | 18/18 | 210 suites / 2350 tests (sole failure cc26, base-proven) | 0 / 0 | 228/228 |
| SA-B11 | 20/20 (+B10 18/18) | 147 suites / 1711 tests, all pass | 0 / 0 | 228/228 (no migration) |
| SA-B12 | 24/24 (+B10+B11 38/38) | 148 suites / 1735 tests, all pass | 0 / 0 | 228/228 (no migration) |
| SA-B13 | API 7/7, web 18 new tests | 117 suites / 1190 tests, all pass; web full 114 files / 942 tests | 0 / 0 (+ web build OK) | **229/229** |

The one recurring failure across the phase, the cc26
wallet-sweep spec, was proven identical on the pristine
base at SA-B3 and never attributed to this work; in SA-B13's
targeted scope (ai + inbox + knowledge + organizations) it
does not appear and the run is fully green.

## L5 evidence — the action law, as proven

- **Exactly-once.** A second approve throws; a second
  execute returns the recorded outcome instead of acting
  again (conditional-update claims on the proposal row,
  SA-B10 specs). An approval whose execution fails is an
  HTTP-200 `failed` row — the failure is data, not a lost
  exception.
- **Verification before success.** `executed` exists only
  when the verifier re-reads real state and finds the
  action's post-condition (a closed conversation is closed;
  a deleted comment is DELETED locally AND carries the Graph
  deletion marker). A mismatch lands `failed` with
  `verification_mismatch` — never a dressed-up success.
- **The money wall is structural.** `request_refund`'s
  executor refuses at every autonomy level; approval records
  the decision with `result.outcome = proposal_only` and
  nothing moves. The Control Center says so on the row
  itself ("শুধু প্রস্তাব — AI নিজে করবে না").
- **Autonomy (D5).** Default L1 (propose + human approve)
  everywhere; L2 auto-executes low-risk only, through the
  same verify pipeline; L3 is rejected at the settings API
  with the D5 reason audited, and rendered as a disabled
  option in the UI — it cannot be enabled without a
  separate owner decision.
- **Honest failure.** Executor errors land on the proposal
  verbatim (a non-member assignee fails with the service's
  own message, never a crash, never a silent retry); the
  Control Center shows the recorded reason plainly.
- **Fresh facts at execution.** An approved comment reply
  re-runs the number guard against LIVE facts before
  posting — stale approved text fails and posts nothing
  (SA-B12).

## Honest limits — what Phase 2 does NOT prove

- **The proposers are deterministic triggers, not an
  LLM planner.** Proposals come from named events (order
  completion, spam flags, repeat offenders, a missed DM) and
  the IN7 suggester bridge. No free-form "AI decides what to
  do" exists anywhere in the phase — by design (L5), and
  the plan's later phases do not change that without new
  decisions.
- **`undoable` is catalog metadata only.** No engine undo
  path exists; nothing in the UI offers or implies an undo.
  Reversal today means a human doing the inverse act through
  the normal staff surfaces.
- **Caps are the autonomy levels themselves.** The plan's
  W4 line mentions "caps, kill switch": in this basic build
  they map to per-action levels (level 0 = that action is
  off entirely — the kill switch at action granularity) and
  the Answer Store switch. There is no numeric rate cap, no
  global all-AI kill switch, and no spend cap — those belong
  to the full Control Center (T4) if the owner wants them.
- **Open-proposal dedupe is check-then-create** (SA-B11):
  correct under the app's single-writer reality, stated
  plainly there; there is no schema-level unique guard.
- **Nothing is live-proven.** All evidence is spec + fresh-PG
  + build, on fakes for Graph/LLM/DB edges — the same M30
  live-verification debt as every prior phase, with real
  Meta accounts, a real LLM key and real merchants still
  owed. A full-process boot of this line also still dies on
  the known TelegramClient/ThreadsClient undecorated-param
  bug (fix proven on the nf line, `b6dcc457`, owed to this
  line at integration) — recorded since SA-B6, unchanged.

## NOT BUILT in Phase 2 (named, with their homes)

- **Full Control Center + AI Activity page** — Phase 6 (T4)
  in the plan: the cross-surface activity feed, the error
  log → learning-queue loop, global caps/kill switch.
- **Admin (platform) views of tenant AI activity** — not in
  W4's scope; the plan's admin training surface is T1–T4.
- **An engine undo path** — no plan item promises one.
- **LLM-freeform action planning** — excluded by L5 as
  shipped; proposers stay deterministic + the IN7 bridge.

## What Phase 3 (Ads Intelligence, A1–A3) starts from

- **A1 — Ads report intelligence** reads the same Brain:
  campaign facts are INTERNAL-class business data, served
  through the audience rules Phase 0 proved; the number
  guard and the no-fabrication law apply to every figure an
  ad report utters (missing data says so, per L2).
- **A2 — Ads actions on the engine**: pause/adjust proposals
  ride THIS catalog + autonomy + verify pipeline — the
  legacy M47 types (`pause_campaign`, `pause_ad_set`,
  `create_broadcast_draft`) are the seam to reconcile, not
  a second engine. Money-adjacent discipline carries over:
  budget changes are the refund wall's sibling — proposal
  and verification discipline first, owner decision before
  any auto-execution level is even discussable.
- **A3 — Creative intelligence** consumes the Phase 0 voice
  profile + performance snapshots (P7/P8) rather than
  re-deriving them.
- Standing gates carry forward unchanged: leak/isolation
  specs, the number-guard spec, exactly-once + honest-failure
  specs, fresh-PG on every migration, one acceptance doc
  per batch, local commits only.
