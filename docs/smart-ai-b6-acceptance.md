# Smart AI Phase 0 — Batch SA-B6 Acceptance (P9: Tenant Learn Dashboard + Management APIs + Phase-0 Close-Out)

Date: 2026-10-17. Branch `smart-ai`, base `7ee8fc36` (SA-B5).
Local commits only; nothing pushed.

Commits:
- `b8656f26` — Item 1: BrainAdminService + BrainAdminController + DTO (management APIs), registered in OrgBrainModule.
- `22adb188` — Item 2: Learn Dashboard UI (`ai-learning-section.tsx` + HUB_NAV + settings render) and the pure label/role helpers (`lib/ai-learning.ts`).
- `6538cd52` — Item 3: specs (API 11 + web lib 8 + web component 5).
- (this doc + the Phase-0 summary follow in the Item 4 commit)

## Step 0 — reality check in this tree (brief vs code)

1. **Settings shell**: `apps/web/src/app/dashboard/settings/
   page.tsx` composes section cards (`<section id="hub-*"
   className="card scroll-mt-24 …">`) under a `HUB_NAV` rail
   (sidebar on desktop, chip rail on mobile). Business
   Knowledge is its own component file
   (`knowledge-section.tsx`) using `apiFetch` + `getOrganizationId`,
   Bengali-first labels, border-button actions, inline
   error/notice lines — the new section mirrors it exactly and
   sits right after it in both nav and render order.
2. **Roles in the UI**: neighbouring cards fetch
   `GET /organizations` and read `myRole` for the current org
   (OrgIdentityCard / OrgSecurityPolicyCard pattern) — the new
   section does the same; mutation visibility mirrors the API
   (writes OWNER/ADMIN/MARKETING_MANAGER, deletes OWNER/ADMIN).
3. **Unanswered questions**: a full API + triage ALREADY exists
   — `GET organizations/:organizationId/ai-instructions/
   unanswered` (+ PATCH status) from the CX2 Instructions Desk.
   The dashboard reuses it directly; no new endpoint was built.
4. **Toggles**: ride `GET/PATCH organizations/:id/
   business-profile` (SA-B4), whose PATCH roles are
   OWNER/ADMIN/MARKETING_MANAGER — matching the learning
   write roles, so UI gating is uniform.
5. **Embeddings availability**: `EmbeddingsService.
   resolveConfig(orgId)` returns the typed `{ok} | {ok:false,
   reason}` (SA-B2) — the overview's retrieval label comes from
   exactly that resolution, so the dashboard can never claim
   hybrid search the backend would not actually perform.
6. **LearningState** carries website + conversation (SA-B4)
   and performance (SA-B5) rows; **AiUnansweredQuestion** is
   directly countable; **BrandVoiceController** GET returns the
   profile row or null.

## Item 1 — Management APIs (commit b8656f26)

`BrainAdminService` + `BrainAdminController`
(`@PermissionArea("ai")`, TenantGuard + RolesGuard — the
LearningController discipline; reads open to members, status
writes OWNER/ADMIN/MARKETING_MANAGER, deletes OWNER/ADMIN per
the KnowledgeController delete precedent):

- **`GET organizations/:organizationId/brain-overview`** —
  real-row aggregates for this org only: knowledge totals with
  the public/internal split + website-page count; embedding
  rows + distinct indexed products; stored answers by status
  (active/invalidated/disabled) + total hits (`_sum hitCount`);
  pending LearnedItem count; open unanswered count; latest
  LearningState per source (website/conversation/performance:
  lastRunAt/lastStatus/reason); brand-voice status +
  pending flag; customer-memory count; latest performance
  snapshot stamp; the embeddings label (available/provider/
  model or the typed unavailable reason → `retrievalMode`
  "hybrid" | "keyword"); and a **coverage** block — an
  8-area setup checklist (profile, policies, knowledge,
  products, website, answers, brandVoice, customerMemory) with
  a percent and the gap list. The percent is coverage of
  knowledge AREAS, computed from presence only — documented
  in the service and labelled as such in the UI; it is not a
  quality score.
- **`GET …/answer-store`** — paginated, status filter,
  case-insensitive question search; rows carry the preview
  (240 chars + truncated flag), channel, origin, status,
  invalidReason, hitCount, grounded/updated stamps.
- **`PATCH …/answer-store/:answerId`** — the only transitions
  are active ↔ disabled (DTO `@IsIn(["active","disabled"])`).
  An **invalidated row refuses every transition with a 400
  carrying its recorded invalidReason** (L4: a stale-grounded
  answer returns only via a fresh store through
  AnswerStoreService, or is deleted). Transitions are audited
  (`answer_store.enable` / `answer_store.disable`).
- **`DELETE …/answer-store/:answerId`** — hard delete, audited
  (`answer_store.delete`, with question/status/hitCount in the
  metadata).
- **`GET …/customer-memories`** — paginated, latest
  interaction first (nulls last): customerKey, displayName,
  languagePref, orderCount, lastOrderAt, lastInteractionAt.
- **`DELETE …/customer-memories/:memoryId`** — the
  per-customer forget endpoint SA-B5 deferred to P9; audited
  (`customer_memory.forget`).
- Every query is org-scoped in SQL; another org's id is a 404
  (spec-proven for status change, delete, and forget).

## Item 2 — Learn Dashboard UI (commit 22adb188)

`AiLearningSection` in Organization Settings (nav entry
"🧠 AI শিখন" after Business Knowledge; section id
`hub-ai-learning`), built on the Item 1 APIs plus the existing
learning-items / brand-voice / knowledge-documents /
ai-instructions / business-profile APIs:

- **"AI কী জানে"** — the overview aggregates as stat tiles
  (documents with the public/internal split, indexed chunks
  with the honest hybrid-vs-keyword label, active stored
  answers with the total no-LLM hit count, pending
  suggestions, open unanswered, memory count) and the
  coverage block with per-area ✓/✗ chips and the gap list.
- **শেখার উৎস** — profile/policies (links to their sections),
  products (indexed count; prices/stock are always live —
  stated), website (toggle + URL + last-run state),
  conversations (toggle, default-off state, and the plain
  explanation: opt-in only, PII scrubbed first, approval
  always required), performance (last snapshot date; INTERNAL
  — stated), brand voice (status). Later-phase sources are
  ONE muted "পরের ধাপে আসছে" line — named as planned, given
  no fake status.
- **জ্ঞান ডকুমেন্ট — কে দেখতে পাবে** — every doc with its
  kind + public/internal badge and a toggle wired to the
  SA-B1 PATCH; the note-kind default is stated honestly.
- **শেখার প্রস্তাব** — the suggested LearnedItem queue with
  kind/source chips, content preview, the approval-target
  line (mirrors the SA-B4 mapping), a visibility select ONLY
  where the API accepts one (plain non-performance facts),
  approve/reject. A refusal (e.g. the Answer Store PII 400)
  surfaces in the section's error line — never a silent
  success.
- **উত্তর ভান্ডার** — search + status filter; per-row origin,
  hit count, status badge; disable/enable for healthy rows;
  invalidated rows show the plain-language reason and an
  explicit "cannot be re-enabled" note with NO enable button;
  delete (OWNER/ADMIN) behind an inline two-step confirm.
- **ব্র্যান্ড ভয়েস** — status, trait lines in plain language
  (pure helpers over the SA-B5 closed vocabularies), a pending
  proposal block, activate/dismiss, and the precedence note
  (the owner's own brandVoice text wins; voice shapes wording
  only, never facts).
- **উত্তর-না-পাওয়া প্রশ্ন** — the CX2 list with reason labels
  and ask counts; সমাধান হয়েছে / উপেক্ষা করুন triage for
  write roles.
- **কাস্টমার স্মৃতি** — count + recent list (name/key,
  language, orders, last interaction) with per-row "ভুলে যান"
  (OWNER/ADMIN, two-step confirm) and the plain note that a
  memory is used only inside that customer's own conversation.
- Loading/empty/error states per block; all labels Bengali-
  first, following the sibling section. Pure label/role logic
  lives in `lib/ai-learning.ts` (no invented data; unknown
  API values fall back to the raw value so a new state can
  never be silently hidden).

## Item 3 — Specs (commit 6538cd52)

- **API** `ai/sa-b6-brain-admin.spec.ts` — **11/11**: overview
  equals the org-A fixtures exactly (org B never counted,
  incl. aggregates, toggles, states, snapshot); coverage is
  the honest checklist for both orgs; embeddings label both
  ways (hybrid vs keyword + typed reason); answer list
  org-scoped + searchable + preview shape; disable→enable
  round-trip audited; invalidated re-activation = 400 carrying
  the recorded reason with the row untouched (and
  invalidated→disabled + setting "invalidated" by hand also
  refused); cross-org 404 on status/delete/forget; memory
  list order + forget semantics + audit; controller role
  metadata (reads unrestricted, writes
  OWNER/ADMIN/MARKETING_MANAGER, deletes OWNER/ADMIN).
- **Web lib** `lib/ai-learning.test.ts` — **8/8**: role rules,
  kind/source/target/visibility mapping parity with the API,
  the full SA-B3 invalidation vocabulary, trait lines
  (verbatim phrases quoted, unknown values visible), state /
  language / reason labels.
- **Web component** `ai-learning-section.test.tsx` — **5/5**
  (jsdom, mocked API): renders overview + source states +
  the planned-sources honesty line; conversation toggle
  PATCHes the business profile; visibility toggle PATCHes the
  document; faq_pair approve POSTs with no visibility field;
  answer disable PATCHes the store and the invalidated row
  shows its reason with no enable button.

## Gates (run strictly serially; results recorded as each finished)

| Gate | Result |
|---|---|
| New API spec (`sa-b6-brain-admin.spec`, `--runInBand`) | **1 suite, 11/11 tests pass** (first run 10/11 — one assertion shape: Nest wraps the 400 message in `response.message`; the behaviour was correct, the assertion was fixed) |
| API targeted jest: `src/ai src/inbox src/knowledge src/organizations` (repo-standard 4096 heap; the default-heap combined run aborted with OOM, the SA-B1-recorded environment behaviour) | **107 suites, 1059/1059 tests pass** |
| API tsc (`tsc --noEmit -p tsconfig.json`) | **exit 0** |
| API build (`tsc -p tsconfig.build.json`) | **exit 0** |
| Web jest (full, vitest) | **112 files, 924/924 tests pass** (911 baseline + 13 new) |
| Web build (`next build`) | **exit 0** |
| Fresh-PG (throwaway PG 16 + pgvector 0.6.0, empty DB, `prisma migrate deploy`) | **227/227 migrations applied, 0 unfinished — unchanged** (this batch adds NO migration, as briefed); `vector` extension + the Phase-0 tables verified present |
| Boot smoke (extra, beyond the brief's gates) | See the finding below — blocked by a pre-existing cross-line bug; with its known fix TEMPORARILY applied, the full app boots and the three new route families answer **401** unauthenticated vs **404** for a nonexistent route (routes registered, guards live, BrainAdmin DI resolves in the full module graph) |

**Boot-smoke finding (pre-existing, NOT from this batch):**
booting the API on this line dies in SocialModule —
`Nest can't resolve dependencies of the TelegramClient (?)` —
the undecorated-constructor-param bug already recorded for
this codebase (fixed on the nf line only; still owed to
main/sai/ou/org at integration). The batch diff touches no
social file. The proven one-line `@Optional()` fix (telegram +
threads clients) was applied ONLY to run the smoke above and
then reverted uncommitted — landing it belongs with the
line's integration, not with P9. Until then, a full-process
boot of the sai line is blocked by that bug; every other gate
above is green.

Tree clean at the end of the batch (this doc's commit aside).

## NOT BUILT (named, per plan)

- **LearnedItem edit-before-approve** — SA-B4 deferred it to
  this batch's dashboard; it is NOT built here either: the
  review queue approves or rejects as-mined. Editing a
  suggestion (with the PII screen re-run on the edit) remains
  future work — recorded, not hidden.
- **Answer Store entry editing / pinning** — the brief's
  surface is list + status + delete; answer TEXT is never
  hand-editable here by design (an edited answer would be an
  ungrounded one — corrections flow through staff replies,
  which SA-B3 already captures as `staff_edited` replacements).
- **Per-org Answer Store on/off toggle** — SA-B3 deferred it
  to "P9/Control Center"; the store rides the existing
  autopilot gates, and a dedicated toggle belongs with the
  Phase-2 Control Center (W4). Not built here.
- **A "learn now" run button** — the learning sweeps are
  internal jobs; the dashboard shows their state but does not
  trigger runs (no such API exists and none was briefed).
- **Admin-side (platform) views** — Phase 6 (T1–T4).
- **Live verification of any kind** — no migration on the
  real DB, no real account exercised (M30 still owed).
