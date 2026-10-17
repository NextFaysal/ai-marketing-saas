# Smart AI — SA-B13 Acceptance (Phase 2, W4: Control Center + Answer Store Toggle + Phase-2 Close-Out)

Date: 2026-10-17. Branch `smart-ai`, base HEAD `dff685c4`
(SA-B12). Local commits only — nothing pushed. Plan of
record: `Smart-AI-Full-Master-Plan-2026-10-17.md` §6 Phase 2
item W4 + the Phase 6 note (the FULL Control Center + AI
Activity lands in T4; this batch is the tenant-basic
version). **This batch closes Phase 2** — the audit lives in
`docs/smart-ai-phase2-summary.md`.

## Step-0 findings (verified before any code)

1. **Settings shell.** `apps/web/src/app/dashboard/settings/page.tsx`
   registers sections in the `HUB_NAV` const (the `hub-ai-learning`
   entry from SA-B6) and renders `<AiLearningSection />` right
   after `<BusinessKnowledgeSection />`. The B6 patterns were
   followed exactly: section component in the settings dir,
   pure helpers in `apps/web/src/lib/`, roles read from
   `GET /organizations` → `myRole`, an `act()`-style
   busy/error/notice flow, Bengali-first labels.
2. **Engine API (SA-B10, unchanged).** `ActionEngineController`
   at `organizations/:organizationId/ai/actions`: GET catalog
   + GET autonomy (member-level), PUT autonomy/:actionId
   (OWNER/ADMIN), GET proposals?status= (member),
   POST proposals/:id/approve|reject (OWNER/ADMIN/
   MARKETING_MANAGER). `listProposals` returns engine rows,
   newest first, **take 50** — so the activity strip computes
   from that window and labels it, per the brief.
   **Approve returns the proposal row**: an execution failure
   is HTTP 200 with status `failed`, so the UI outcome message
   is derived from the returned row, never assumed.
3. **Profile wiring.** The SA-B4 learning toggles ride
   `BusinessProfile` + `UpdateBusinessProfileDto` + the
   service's DTO spread (and `profileJson` passes fields
   through) — so the new toggle needed exactly a schema
   column + a DTO field. No `OrganizationSettings` model
   exists (SA-B4 finding, still true).
4. **Every Answer Store serve/capture path flows through
   `AnswerStoreService.store()/lookup()`** — inbox autopilot
   lookup + `suggestDraft` lookup, inbox autopilot/staff-edit
   captures, comment lookup + capture, and the LearningService
   approval store. One gate inside the service therefore
   covers all channels with no call-site edits.
   `screenAnswerPii()` is borrowed by conversation mining and
   customer memory, and `invalidate()` is bookkeeping — both
   deliberately left ungated.
5. **Traps avoided.** `LearningService.getToggles` is asserted
   exactly (`toEqual`) in two specs — NOT extended; the switch
   state reaches the Learn Dashboard through the BrainAdmin
   overview instead (its `answers` block), with exactly one
   spec expectation evolved (recorded below).

## Item 1 — Per-org Answer Store toggle (commit `b54e07d4`)

- **Schema/DTO.** `BusinessProfile.answerStoreEnabled Boolean
  @default(true)`; migration `20261101000000_sai_control`
  (additive `ADD COLUMN ... NOT NULL DEFAULT true`);
  `@IsOptional() @IsBoolean()` on the profile DTO. Rides the
  existing business-profile GET/PATCH unchanged.
- **Enforcement — one gate in `AnswerStoreService`.** A
  private `storeEnabled(orgId)` reads the profile flag (only
  an explicit `false` disables; a missing profile/field reads
  as enabled, matching the schema default and the SA-B4 read
  pattern). `lookup()` misses for **everyone** while off
  (`{ hit: false, reason: "answer_store_disabled" }`, before
  any candidate work; stored rows untouched, hit counts
  frozen). `store()` refuses the **automatic captures**
  (`autopilot_grounded`, `staff_edited`) with the same named
  reason. **Recorded judgement:** a `staff_approved` store is
  a deliberate human act in the Learn Dashboard review queue,
  so it may still LAND while off — but it cannot SERVE,
  because lookup is gated for all. The brief's enforcement
  text names lookup + capture; approval is neither, and the
  dashboard shows the switch state one scroll away from the
  approve button.
- **Dashboard.** BrainAdmin overview's `answers` block gains
  `storeEnabled` (read from the same profile row as the
  coverage check). The Learn Dashboard's উত্তর ভান্ডার area
  gains the switch (same `toggleProfileFlag` + PATCH path as
  the learning toggles, write-role gated), an off-state
  explanation banner, and a notice that says plainly that
  stored answers are NOT deleted.

## Item 2 — AI Control Center, basic (commit `30185258`)

New Organization Settings section **"AI নিয়ন্ত্রণ"**
(`hub-ai-control`, 🎛️), sibling after AI শিখন; helpers in
`apps/web/src/lib/ai-control.ts`, component
`ai-control-section.tsx`. No admin (platform) UI.

- **Proposal queue.** Pending first (its own
  `?status=proposed` fetch, so decided volume can never push
  pending work out of the window): title, preview, surface +
  action chips in plain Bengali, proposer (AI/টিম), relative
  age. Approve/reject call the SA-B10 endpoints; the notice
  reads the RETURNED row — executed = verified-success
  wording, failed = the recorded reason verbatim (shown as
  an error), proposal_only = the money explanation. Roles
  mirror the API (decide: OWNER/ADMIN/MARKETING_MANAGER);
  other roles see the queue read-only with the reason stated.
- **Decided outcomes + activity strip.** The recent list
  (latest 50) shows decided proposals with status chips and
  `proposalOutcomeText`; counts (executed/failed/pending) are
  computed from that fetched list and labelled
  "দেখানো সর্বশেষ ৫০টি প্রস্তাবের ওপর ভিত্তি করে — সব সময়ের
  মোট নয়". No totals are invented anywhere.
- **Autonomy matrix.** Every catalog action with surface +
  risk chips; a level selector (বন্ধ / প্রস্তাব / সীমিত নিজে)
  PUTting per change for OWNER/ADMIN, a read-only badge for
  everyone else. **Level 3 is a disabled option** with the
  D5 explanation in the section text ("মালিকের আলাদা
  সিদ্ধান্ত ছাড়া চালু নয়"). Money-adjacent rows carry the
  **"শুধু প্রস্তাব — AI নিজে করবে না"** badge plus a note
  that approval records the decision and the team does the
  work itself; level-2 rows carry the honest risk note (L2
  auto-executes low-risk only — a medium/high action still
  arrives as a proposal).
- **States.** Loading line, load-error surfacing, empty
  queue/activity/history states — the B6 patterns throughout.

## Item 3 — Specs (commit `42774882`)

- **API `sa-b13-answer-store-toggle.spec.ts` (7 tests).**
  (A) Service gate: on/absent = SA-B3 behaviour; off =
  captures refused with the named reason and nothing written,
  lookup misses with the row untouched, `staff_approved`
  lands but cannot serve, `invalidate()` + the PII screen
  still work. (B) Inbox (SA-B3 harness): on → LLM composes,
  capture, zero-LLM serve; flipped off → the same question
  takes the LLM path, hitCount AND groundedAt frozen (a
  leaked capture would upsert-replace and move groundedAt),
  a staff-edited capture of a *different* question writes no
  second row; back on → the store serves. (C) Comments
  (SA-B8 harness): seeded entry serves with zero LLM calls;
  off → LLM composes, no `answer_store_hit` usage row, no
  capture; on → serves again. (D) Profile PATCH round-trip:
  false persists + reads back through `profileJson`, an
  unrelated PATCH never clobbers it, true restores.
- **Spec evolution (recorded, B11/B12 precedent):**
  `sa-b6-brain-admin.spec.ts` — the `ov.answers` exact
  expectation gains `storeEnabled: true` (the fixture profile
  predates the field; absent = enabled). No assertion was
  weakened; one field was added to an exact shape because the
  API honestly gained that field.
- **Web (18 tests).** `lib/ai-control.test.ts` (10): role
  gates mirror the controller, labels, outcome texts
  (failed-reason verbatim, proposal_only wording), ageText,
  activitySummary. `ai-control-section.test.tsx` (7): queue
  render with chips/proposer/age; approve → POST
  `.../proposals/<id>/approve` + returned-row notice; reject
  → POST `.../reject`; failed row's recorded error verbatim;
  money chip + explanation + window-labelled counts;
  autonomy change → PUT `{level}`; L3 option disabled; money
  badge; SUPPORT_AGENT sees no mutation controls;
  MARKETING_MANAGER decides but cannot change autonomy.
  Plus one test in `ai-learning-section.test.tsx`: the store
  switch PATCHes `{ answerStoreEnabled: false }`.

## Gates (strictly serial, recorded as each finished)

| Gate | Result |
|---|---|
| Focused specs first (B13 API + B3/B4/B6/B8 + answer-store suites; the 3 web files) | API 7/7 new; affected suites green; web 23/23 in the 3 files |
| API targeted jest (ai + inbox + knowledge + organizations, `--runInBand`, 4096 heap) | **117 suites / 1190 tests — ALL PASS** (the known cc26 wallet-sweep failure lives outside this targeted scope and did not appear; it remains base-proven since SA-B3, unchanged) |
| API `tsc --noEmit -p tsconfig.json` | **0 errors** |
| API build `tsc -p tsconfig.build.json` | **OK** |
| Web jest FULL (`vitest run`) | **114 files / 942 tests — ALL PASS** |
| Web build (`next build`) | **OK** |
| Fresh-PG (throwaway local PG 16 + pgvector 0.6.0, empty DB, `prisma migrate deploy`) | **229/229 applied, 0 unfinished** (base 228 + `20261101000000_sai_control`); `BusinessProfile.answerStoreEnabled` verified `boolean NOT NULL DEFAULT true`; `vector` extension 0.6.0 present; cluster dropped afterwards |

## Commits (one per item, local only)

| Item | Commit |
|---|---|
| 1 — Answer Store toggle (schema + migration + DTO + service gate + overview + dashboard switch) | `b54e07d4` |
| 2 — Control Center section + lib + settings wiring | `30185258` |
| 3 — Specs (API 7 + web 18 + B6 evolution) | `42774882` |
| 4 — Phase-2 summary + this acceptance | (this commit) |

## NOT BUILT (named)

- **The FULL Control Center + AI Activity page** — Phase 6
  (T4) by the plan's own sequencing: cross-surface activity
  feed, error log → learning queue, global caps/kill switch.
  In this basic build, "cap / kill switch" maps honestly to
  per-action autonomy level 0 (an action fully off) + the
  Answer Store switch; there is **no numeric rate cap and no
  global all-AI switch**.
- **Admin (platform) UI** for tenant AI activity — out of
  W4 scope (T1–T4 territory).
- **Per-action controls beyond the autonomy levels** (e.g.
  scheduled pauses, per-action budgets) — not in the plan's
  W4 text as shipped.
- **Live verification** — everything above is spec/fresh-PG/
  build evidence on fakes; M30 with the owner's real accounts
  remains owed for the whole Smart AI line, as does the
  TelegramClient/ThreadsClient boot fix at integration
  (nf-line `b6dcc457`).
