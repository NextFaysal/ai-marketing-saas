# Smart AI — Phase 0 (Brain) Close-Out Summary

Date: 2026-10-17. Branch `smart-ai` (worktree
`ai-marketing-saas-sai`), base `8ce43eb3` (org-next, 222
migrations) → Phase-0 final HEAD at SA-B6. Local commits only;
nothing pushed. Plan of record:
`Smart-AI-Full-Master-Plan-2026-10-17.md` §6 Phase 0 (P1–P9),
laws L1–L5 (§2).

Phase 0 gave every organization its own Brain: one context
service that knows the difference between a customer, that same
customer asking about themselves, and the org's own team (L3);
semantic + keyword retrieval over the org's own data only (L1);
a verified-answer store that never outranks live data (L4);
learning pipelines whose output is a suggestion until a human
approves it (D3); and a tenant Learn Dashboard where the owner
sees and controls all of it (P9).

## P1–P9 audit

| # | Item | Status | Batch | Evidence |
|---|---|---|---|---|
| P1 | OrgBrainService — one audience-aware context service | **Shipped** | SA-B1 (+`own_customer` audience SA-B5) | `docs/smart-ai-b1-acceptance.md`, `docs/smart-ai-b5-acceptance.md` |
| P2 | pgvector + hybrid search | **Partial** — core shipped; the plan line's Redis query-embedding cache deliberately not built (B2 rationale: a query embedding is one small call; the Answer Store is the real repeat-cost killer; a cache can be added behind the existing labels) | SA-B2 | `docs/smart-ai-b2-acceptance.md` |
| P3 | Visibility classes (KnowledgeDocument + profile fields) | **Shipped** | SA-B1 | `docs/smart-ai-b1-acceptance.md` |
| P4 | Answer Store (verified answers, live re-verification, auto-invalidation) | **Shipped** | SA-B3 (management surface SA-B6) | `docs/smart-ai-b3-acceptance.md` |
| P5 | Product / website learning | **Shipped with named limits** — catalog auto-knowledge + own-website learning shipped; storefront-slug source not built (no stored storefront domain exists; content would duplicate catalog/profile); product-derived FAQ candidates deliberately not built (catalog copy is already fully indexed) | SA-B4 | `docs/smart-ai-b4-acceptance.md` |
| P6 | Conversation learning (staff corrections, unanswered→FAQ, repeated questions; PII-free) | **Shipped with named limits** — Unified Inbox only; comment-thread mining not built (Phase 1 R2 is its home) | SA-B4 | `docs/smart-ai-b4-acceptance.md` |
| P7 | Performance learning (INTERNAL, evidence-based) | **Shipped with named limits** — every figure computed from real rows; per-broadcast reply attribution, structured order-cancel reasons and a CX score table do not exist in the product data, so they were recorded, never fabricated | SA-B5 | `docs/smart-ai-b5-acceptance.md` |
| P8 | Brand voice + customer memory (erasable) | **Shipped** — voice SA-B5; the per-customer forget endpoint deferred by SA-B5 landed in SA-B6 | SA-B5 + SA-B6 | `docs/smart-ai-b5-acceptance.md`, `docs/smart-ai-b6-acceptance.md` |
| P9 | Learn Dashboard (tenant) — what it knows, coverage %, gaps, answer store, source list | **Shipped** | SA-B6 | `docs/smart-ai-b6-acceptance.md` |

**Audit outcome: 8 shipped (3 with named limits), 1 partial
(P2 — Redis cache element), 0 not built, 0 silently dropped.**

## Cumulative gates across Phase 0

| Batch | New specs | Targeted jest | Fresh-PG |
|---|---|---|---|
| SA-B1 | knowledge 36/36 · org-brain 7/7 | 82 suites / 800 tests | 223/223 |
| SA-B2 | embeddings 7/7 · pgvector 7/7 · indexing 10/10 · hybrid 13/13 | 86 suites / 830 tests (+ constructor-touch 49 suites / 603) | 224/224 + real pgvector round-trip |
| SA-B3 | answer store 23/23 | 88 suites / 853 tests | 225/225 + real pgvector round-trip |
| SA-B4 | learning 17/17 | 89 suites / 870 tests (+ constructor-touch 64 / 732) | 226/226 + live unique/default proof |
| SA-B5 | performance/voice/memory 17/17 | 104 suites / 970 tests | 227/227 + live unique proof |
| SA-B6 | brain-admin 11/11 · web lib 8/8 · web section 5/5 | API 107 suites / 1059 tests · web 112 files / 924 tests | 227/227 (no new migration — unchanged, re-verified) |

API tsc + API build exit 0 at every batch; web build exit 0 at
SA-B6. Migrations: 222 (base) → **227** (5 additive SA
migrations: visibility, vector, answer store, learning,
perf/voice). Every gate ran strictly serially; the one
pre-existing failure encountered (cc26 wallet sweep, SA-B3)
was base-proven on the pristine base and is unrelated to
Phase 0.

## Permanent-gate evidence (plan §6, all phases)

- **Cross-org leak specs (L1)** — B1 org-brain isolation (both
  directions); B2 pgvector round-trip proving the org filter in
  SQL against an identical foreign vector; B3 answer-store
  isolation; B4 mining isolation with org-B sentinels; B5
  customer-memory isolation matrix (own ✓ / other ✗ / plain ✗ /
  internal-no-key ✗ / cross-org ✗); B6 management-surface
  cross-org 404s.
- **Customer-audience leak specs (L3)** — B1 sentinel scan over
  the serialized customer context; B2 visibility filter in the
  vector SQL; B5 performance sentinels absent from
  customer-class contexts (performance facts are forced
  INTERNAL even when an approver asks for public).
- **Number guard** — untouched by every batch and re-verified
  by the inbox suites each time; SA-B3 additionally routes
  stored-answer hits THROUGH the guard against the fresh fact
  pack (a guard failure invalidates the entry).
- **Fresh-PG migration check** — run at every batch (table
  above), each time on an empty database with the pgvector
  image.

## Honest limits — what Phase 0 does NOT prove

- **Nothing here is live-proven.** No SA migration has run on
  the real database; no real LLM/embedding call, website fetch
  or conversation mining run has happened against a real
  account. Live proof is M30's, and it is still owed.
- **The pgvector compose image swap (SA-B2) takes effect only
  on the owner's manual Dokploy Redeploy.** Until then the
  production Postgres has no `vector` extension and the SA
  migrations must not be deployed ahead of it.
- **Full-app boot on the sai line is blocked by a pre-existing
  bug outside Phase 0**: `TelegramClient`/`ThreadsClient`
  undecorated constructor params (SocialModule) — the same
  cross-line bug previously found and fixed on the nf line
  only. Proven again at SA-B6: boot dies naming TelegramClient;
  with the known one-line `@Optional()` fix temporarily
  applied, the whole app — including SA-B6's new routes
  (401 unauthenticated, vs 404 for a nonexistent route) — boots
  and serves. The fix was NOT committed in this batch; it
  remains owed to the sai line at integration, exactly as
  recorded for main/ou/org.
- **Learning quality is unproven against real traffic**: the
  mining/voice pipelines skip honestly without a real LLM
  config; the Answer Store's 0.86 threshold is a conservative
  default awaiting real-traffic tuning.
- **Embeddings depend on the provider**: Anthropic has no
  embeddings API, so those orgs run keyword-only retrieval —
  labelled as such in the Learn Dashboard (SA-B6), never
  papered over.
- **Customer memory identity is per channel**
  (`channel:externalContactId`); no cross-channel identity
  exists in the product today, so one human on two channels is
  two memories (SA-B5).

## What Phase 1 (R1–R3) starts from

- The Brain is complete and already consumed where Phase 0
  wired it: the inbox fact pack (with `own_customer` memory),
  the autopilot's Answer Store lookup/capture, and the AI
  tools' knowledge path all read through OrgBrainService.
- R1 (Inbox Reply v2) is therefore mostly consolidation +
  quality: the semantic knowledge, customer memory and brand
  voice already reach the inbox prompt; what remains is the
  v2 pass over draft/order-bot surfaces that still compose
  outside the Brain path.
- R2 (Comment Reply v2) starts from: comment AI exists but is
  NOT Brain-grounded (product match only) — the Brain, the
  channel-aware Answer Store schema and the voice/memory
  readers are ready for it; the CX3 debounce bug fix is a
  stated precondition in the plan; comment-thread mining was
  deliberately left to this phase (SA-B4).
- R3 (Reply Quality) starts from the SA-B5 style block +
  language detection the inbox already carries; Phase 1
  extends the same rules to every channel instead of
  inventing per-channel behaviour.
