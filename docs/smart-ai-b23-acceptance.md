# SA-B23 Acceptance — Phase 6 (Admin Training & Full Control), Batch 2: Per-org Brain View & Fix (SUPER admin, audited)

**Date:** 2026-10-17 · **Line:** `ai-marketing-saas-sai` (branch `smart-ai`) · **Base HEAD:** `62039dc6` · **Final HEAD:** see Item 4 commit · **Local commits only — not pushed, not deployed, nothing live-proven (M30 owed).**

> Scope note: the Master Plan's Phase-6 T1 row bundles "per-org Brain দেখা/ঠিক করা (কারণ+auditসহ)" into the Admin Training Console family. SA-B22 shipped T1's teaching core + plan-T2's Sources Registry; this batch ships the per-org view/fix half of T1. Plan-T3 (AI Oversight) is SA-B24 and plan-T4 (full Control Center + AI Activity) is SA-B25 — neither is in this batch.

## The surface (all under the SA-B22 `AdminAiController`, `/admin/ai/*`, `SuperAdminGuard` + class-level `@AdminTier("SUPER")`)

| Route | Act |
|---|---|
| `GET /admin/ai/orgs/:organizationId/brain` | The per-org Brain VIEW (`AdminBrainService.viewBrain`) |
| `POST /admin/ai/orgs/:organizationId/answer-store/:answerId/invalidate` | Fix (a): invalidate a stored answer |
| `POST /admin/ai/orgs/:organizationId/learned-items/:itemId/review` | Fix (b): approve/reject a pending LearnedItem (`decision` in body) |
| `POST /admin/ai/orgs/:organizationId/customer-memories/forget` | Fix (c): forget one customer's memory by key (`customerKey` in body) |
| `POST /admin/ai/orgs/:organizationId/answer-store-toggle` | Fix (d): set the org's Answer Store switch (`enabled` in body) |

Every fix body carries a **non-empty `reason`**. SUPER-only exactly as SA-B22: even reads refuse other admin tiers, a tenant OWNER is refused by the guard's live-row check (403), and the guard's TOTP rule applies (a SUPER without two-factor may read, never mutate).

## The contents line drawn for the view

- **Counts and status only** — org identity (name/slug/country/currency/timezone/verification status), the SA-B6 overview (knowledge totals by visibility, embedding/index counts, Answer Store counts + hits + switch state, learning toggles + per-source run states, brand-voice status, coverage), the learned-item breakdown by status and sourceType, configured autonomy overrides (rows only; unconfigured actions ride the engine default L1, stated in the payload), and digest **present/absent flags** (performance snapshot exists / ad-metric rows exist / competitor rows exist).
- **No customer data.** Customer memory appears as a COUNT. Its contents — names, per-customer facts — stay invisible even to the platform admin here; the forget fix is **keyed, never browsed** (the admin names the exact `channel:externalContactId` key, e.g. from the org's own report of a problem).
- **No digest contents.** Performance/ads/competitor digests are the org's internal business intelligence; the board records only whether each exists, not what it says. The org's own staff read the digests in their own surfaces.
- **Reuse, not recompute:** the overview block is `BrainAdminService.getOverview` called verbatim, so the admin view can never drift from what the tenant's own Learn Dashboard reports about the same Brain.

## Item 1 — the view (commit `3b8a6048`)

`AdminBrainService.viewBrain` 404s an unknown org (no fabricated empty Brain, and no audit row for a view that never happened), composes the payload above, then writes **exactly one** audit row — `admin.ai_brain_view`, org-scoped, `userId` = the live admin row, with the request ip — before returning. Viewing is itself the recorded act. Wiring: `AdminModule` imports `OrgBrainModule` (which exports the Brain services) — the house pattern, no cycle (OrgBrainModule imports nothing beyond the global PrismaModule).

## Item 2 — the fixes (commit `fa70a73e`)

`AdminBrainFixService` — structural rules, enforced in the service (not left to DTO discipline):

- **Reason first.** `requireReason` runs before ANY read or mutation in every fix: trimmed-empty is a 400 with zero state change and zero fix-audit rows (spec-pinned for all four fixes). The reason is stored verbatim in the admin audit row's metadata; for learned-item reviews the row it decided carries the decision provenance (below); for answer invalidation the admin's reason becomes the row's `invalidReason` itself (the store's own field for exactly this).
- **Same paths as the tenant.** (a) goes through `AnswerStoreService.invalidate` (the store's own org-scoped path); (b) through `LearningService.approve/reject` — including their application semantics (a faq_pair approval still faces the Answer Store's PII screen, a performance/ads/creative/competitor fact still lands INTERNAL); (c) through `BrainAdminService.deleteCustomerMemory` (the SA-B6 forget) after resolving the row by `(organizationId, customerKey)`; (d) writes the same `BusinessProfile` row the tenant's settings PATCH writes, with the tenant path's upsert shape (an org with no profile row gets one created carrying just the switch — the schema default made it effectively ON, recorded as `previousEnabled: true`). **No parallel admin mutation logic exists.**
- **The actor is the admin, never a forged staff member.** The services receive the admin's own user id as the actor, so their stamps and tenant-side audit rows truthfully name the admin. On top of that, each fix writes its own org-scoped admin audit row (`admin.ai_brain_fix_answer_invalidate` / `_learned_approve` / `_learned_reject` / `_memory_forget` / `_answer_store_toggle`) carrying the reason verbatim, and the response payload echoes `decidedVia: "admin_console"` (fix (d): the toggle's origin is that audit row + payload — no staff actor is stamped anywhere).
- **Provenance on the row — the batch's one migration.** `LearningService` gained an explicit `via` option (tenant callers pass nothing and default to `"org"`), stamping the new **`LearnedItem.reviewedVia`** column and the tenant audit metadata. A console decision stamps `reviewedVia: "admin_console"`. `reviewedById` alone could not carry this distinction: the same person can be both org staff and platform admin (one User row), so the via is stamped structurally at decision time.
- **A failed fix leaves no fix-audit.** If the tenant path refuses (already-decided item, the store's PII refusal, a 404), the error surfaces unchanged and this service records nothing — an audit row claims a fix that happened, never one that was attempted.

## Item 3 — Specs (commit `6a99b738`, `apps/api/src/admin/sa-b23-admin-brain.spec.ts`, 21 tests)

Against an in-memory Prisma stub with two full orgs (A/B) plus a profile-less org C, running the REAL services and the REAL AnswerStore lookup: SUPER-only guard (class tier metadata; tenant OWNER 403; SUPPORT refused; SUPER admitted) · view fidelity (every block equals the fixtures; org B's view carries B's numbers and all-absent digest flags; no B sentinel leaks into A's payload; exactly one `admin.ai_brain_view` row per call, org-scoped with the admin as actor; unknown org = 404 + zero audit) · invalidate (lookup **hit → miss** across the fix; reason becomes the row's `invalidReason` verbatim; the other org's same-shaped answer untouched and still serving; cross-org id on the path = 404) · learned review (console approve applies through LearningService — the knowledge doc actually lands — and stamps `reviewedVia "admin_console"` + `reviewedById` = the admin, with the tenant audit row carrying `via` too; console reject likewise; a **staff** decision on the same service stamps `"org"` — the distinction is pinned on the row itself; bad decision = 400) · forget by key (only the path org's row for that key is removed — org B's row under the **same key** survives; both audit trails exist; unknown key = 404) · toggle (the switch flips and the store's own gate then refuses to serve org A with `answer_store_disabled` while B still serves; the profile-less org gets its row by upsert; audit metadata records `from`/`to`/reason) · **empty reason = 400 with zero mutation and zero audit rows, for every fix**.

One spec-driven code fix is inside the Item-3 commit: `invalidateAnswer` now snapshots `previousStatus`/`question` into locals BEFORE mutating — the audit must record what the row WAS, whatever the ORM does with the fetched object afterwards.

## Migration verdict

**One migration, justified:** `20261104000000_sai_learned_review_via` — a single nullable `reviewedVia TEXT` column on `LearnedItem`. It is the only schema need in the batch (the view is reads; fixes (a)/(c)/(d) write existing columns), and it exists because admin-vs-staff provenance on a learned-item decision is a stated Item-3 guarantee that `reviewedById` structurally cannot provide (one User row can be both staff and admin). Nullable: rows decided before this migration honestly have no recorded via.

## Gates (strictly serial; numbers copied from real output only, exit codes unmasked)

| Gate | Result |
|---|---|
| New spec (`sa-b23-admin-brain.spec.ts`, solo) | **1 suite / 21 tests, all pass** |
| Targeted jest (`src/ai src/admin src/inbox src/knowledge src/organizations`, `--runInBand`, 4096 heap) | **150 suites / 1,580 tests — 149 suites + 1,579 tests passed; 1 suite / 1 test failed: `admin/adx3-nav-counts.spec.ts` — PROVEN PRE-EXISTING on the pristine base (below).** SA-B23's own 21-test spec passed inside the run; SA-B6 BrainAdmin and SA-B22 teaching/registry suites green. |
| api tsc (`tsc --noEmit -p tsconfig.json`) | **exit 0**, empty output |
| api build (`npm run build`) | **exit 0** |
| Fresh-PG (`prisma migrate deploy`, empty DB) | **232/232 finished, 0 unfinished; `migrate status` = "Database schema is up to date!"** — with the environment deviation below. `LearnedItem.reviewedVia` verified present (nullable TEXT). |

**The one jest failure — base-proven pre-existing, not SA-B23.** `adx3-nav-counts` expects `overdueSubscriptions` = 1 and receives 2 — the calendar time-bomb SA-B22 recorded (the spec pins `NOW = 2026-10-15` but `billingSummary()` reads the wall clock; a fixture period ended 2026-10-16 and is now past). Proof per the standing rule: the suite was run solo on a pristine worktree of this batch's base `62039dc6` (node_modules symlinked in) — **identical failure** (1 failed / 6 passed, same assertion, jest exit 1). SA-B23's diff touches no admin-service or subscription code. The known `cc26` wallet-sweep failure sits outside this batch's targeted folders and was not re-chased; the TelegramClient/ThreadsClient boot fix (`b6dcc457`, nf line) remains owed at integration — neither is this batch's.

**Fresh-PG environment deviation (recorded honestly — the SA-B20/B21/B22 deviation, persisting, with one wrinkle).** This VM still has **no pgvector and no system PostgreSQL**. The documented procedure was repeated: a throwaway self-contained PostgreSQL cluster (scratch OS user, dropped after) ran the untouched real chain, which applied 223 migrations and stopped exactly at `20261027000000_sai_vector`'s `CREATE EXTENSION vector` — `extension "vector" is not available` (error captured; deploy exit 1) — environmental, proven by the error's identity with SA-B20/B21/B22. On the THROWAWAY DB ONLY: a `vector` TEXT-domain stand-in, sai_vector's remaining DDL applied verbatim from the shipped file (via `prisma db execute` — this binary set ships no psql), `migrate resolve --applied`, then `migrate deploy` — the remaining 9 migrations (incl. this batch's `20261104000000_sai_learned_review_via`) applied cleanly; final verification in `_prisma_migrations`: **232 finished / 0 unfinished** (233 rows total — the extra row is the rolled-back sai_vector attempt the recovery path leaves on a disposable DB, rolled_back_at set, as in SA-B21/B22). Wrinkle vs SA-B22: the Zonky Maven artifact path fetched in earlier batches returns 404 today, so the cluster used the embedded-postgres **18.4.0-beta.17** linux-x64 binaries already present on this VM (extracted fresh from the on-disk tarball into the scratch dir). Shipped migration files were never modified; on the deployment's `pgvector/pgvector:pg16` image the chain runs untouched, as it did for SA-B2…B22.

## NOT BUILT (explicit)

- **Admin web UI pages** — no per-org Brain view/fix screens in the admin app. This batch is API-complete; a UI would consume exactly the five routes in the table above. Nothing in the web tree was touched.
- **Customer-memory CONTENT browsing — refused by design.** No route returns a memory row's contents to the admin; the view exposes the count, the fix is keyed deletion. (The org's own staff DO see their customers' memories in the SA-B6 dashboard — that is the tenant's data in the tenant's surface; the platform console deliberately does not mirror it.)
- **Digest contents in the admin view** — presence flags only, same reasoning.
- **A Test Bench** (plan T1's remaining surface — ask a question, see the answer + its grounding sources) — not built here; its inputs are the teaching-aware Brain contexts (SA-B22) and this batch's per-org surfaces.
- **AI Oversight board + global kill switch (plan T3) = SA-B24; full Control Center + AI Activity (plan T4) = SA-B25** — none of it is in this batch. (Fix (d) is a per-org Answer Store switch, not the T3 global kill switch; the org's broader AI kill switches remain the tenant's own.)
- **Admin fixes beyond the four briefed** — no knowledge-doc editing, no Answer Store text editing (an edited answer would be an ungrounded one — the L4 rule from SA-B6), no autonomy changes, no toggle beyond the Answer Store switch.
- **Live verification = M30** — nothing here is live-proven: no real SUPER session has exercised the view/fix APIs, and no migration has run on the real database.
