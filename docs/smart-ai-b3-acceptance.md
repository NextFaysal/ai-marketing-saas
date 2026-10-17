# Smart AI Phase 0 — Batch SA-B3 Acceptance (P4: Smart Answer Store)

Date: 2026-10-17. Branch `smart-ai`, base `05b86e0c` (SA-B2). Local
commits only; nothing pushed.

Commits:
- `004abbdf` — Item 1: AiStoredAnswer schema + migration.
- `74e1e173` — Item 2: AnswerStoreService (+ shared number extraction).
- `083abe1e` — Item 3: inbox integration.
- `dd01eefb` — Item 4: specs.
- (this doc's commit follows)

## Step 0 — reality check in this tree (brief vs code)

Verified before designing:

1. **Autopilot flow end-to-end.** Ingest → `maybeAutoReply`:
   mode → fresh-row paused check → CC27 deny gate → escalation
   gate → CX12d schedule gate → intent whitelist (**price,
   stock, delivery, order_status, payment**) → confidence gate →
   CX3 debounce → `composeGroundedReply` (deterministic tier:
   live-data templates, no LLM) → `composeLlmGroundedReply` (the
   LLM tier) → draft mode writes a `MessageDraft`, otherwise a
   `channelMessage` (`autoReply: true`, `autoReplyEvidence` JSON
   `{via: "autopilot", ...evidence}`) → `deliverText` → status
   update → audit `inbox.auto_reply.sent`. U3 analytics count
   `llmSent` only when `evidence.tier === "llm"`, so a store hit
   (tier `"answer_store"`) raises `autoSent` but never inflates
   the LLM figure — honest by construction.
2. **The LLM tier** (`composeLlmGroundedReply`): `buildFactPack`
   → `providerForOrg` → real-LLM check → `provider.complete` →
   `AIUsageRecord` (feature `"autopilot"`, `userId "system"`) →
   **the deterministic number guard**: every number in the reply
   must appear in `pack.factsText` (extraction:
   `InboxService.extractNumbers` — Bengali digits normalized,
   separators stripped), else audit `inbox.autopilot.guard_rejected`
   and silence. Returns `{content, evidence: {tier: "llm",
   provider, sources: pack.sources}}`.
3. **Fact-pack sources** (`pack.sources`): `{type: "product",
   productId}` · `{type: "business_profile", area}` (area =
   delivery | payment | contact_hours) · `{type:
   "business_policy", policyId}` · `{type: "order_status",
   orderId, status}` · `{type: "knowledge", docId, kind}` — the
   store's `sourceRefs` are normalized from exactly this list.
4. **Staff-edit hook — EXISTS and is clean** (so staff-edit
   capture is BUILT, not deferred): `POST
   conversations/:id/drafts/:draftId/send` → `sendDraft(orgId,
   actorId, convId, draftId, editedContent?)` already computes
   `edited = content !== draft.content.trim()` and sends via
   `sendReply` with `{viaDraftId, aiAssisted, draftEdited}`.
   Autopilot drafts are distinguishable: draft-mode rows carry
   `provider: "auto-reply"`, while the staff compose-suggest
   path (CX1) stores the LLM provider's name. The question a
   draft answered is the conversation's latest inbound
   `channelMessage` (which also carries its `intent`).
5. **SA-B2 APIs**: `EmbeddingsService.embedOne/embed` return the
   typed `EmbedResult` (never a fabricated vector);
   `PgVectorStore` implements the `VectorStore` port over the
   `KnowledgeEmbedding` table ONLY — its contract is
   knowledge-shaped, so the Answer Store runs its own raw SQL
   over its own table with the identical discipline (bound
   parameters via `Prisma.sql`, org/provider/model/dimension
   filters in the query, `vectorLiteral` guard). The embedding
   column pattern (`Unsupported("vector")`, per-row
   provider/model/dimension, raw-SQL-only access) follows the
   KnowledgeEmbedding precedent exactly, as the brief required.
6. **Product live reads**: `prisma.product` org-scoped;
   `priceMinor` (BigInt), `currency`, `stockQuantity` (nullable),
   `name`, `status` (`ACTIVE`…). The fact pack formats them as
   `দাম: ${formatMinor(...)} (${currency})` and `স্টক: ${n}টি` —
   the re-verification rebuilds the same lines from live rows.

## Item 1 — Schema (commit 004abbdf)

- `AiStoredAnswer` model + migration `20261028000000_sai_answer_store`
  (additive; one new table): org-scoped rows with
  `normalizedQuestion`, `questionText`, `answerText`, `channel`
  (default `"inbox"`), `language` (nullable), `sourceRefs` Json
  (`{docIds, products: [{id, name}], policyIds, profileAreas}`),
  `containsLiveFacts`, `status` (`active` | `invalidated` |
  `disabled`), `invalidReason`, `origin` (`autopilot_grounded` |
  `staff_approved` | `staff_edited`), `hitCount`, `lastHitAt`,
  **`groundedAt`** (the freshness stamp — set at store/replace,
  never touched by hit writes, because `updatedAt` moves on
  every hit), `provider`/`model`/`dimension` (nullable) and the
  untyped `embedding Unsupported("vector")?`.
- `@@unique([organizationId, normalizedQuestion, channel])`
  backs the replace semantics in the database (proven live in
  the gate below: a hand-written duplicate insert is rejected
  by this constraint); indexes on `(organizationId, status)`
  and `(organizationId, model)`.

## Item 2 — AnswerStoreService (commit 74e1e173)

`apps/api/src/ai/answer-store.service.ts`, registered in
`OrgBrainModule` (InboxModule already imports it — no new
wiring). The service never throws into callers.

- **`normalizeQuestion`** (exported): lowercase; every run of
  characters outside `\p{L}\p{M}\p{N}` collapses to one space —
  Bengali letters and their vowel-sign marks survive intact,
  the danda "।" separates — then whitespace-collapsed, trimmed,
  capped at 500 chars.
- **`store(orgId, input)`** — typed refusals, in order:
  `audience_internal`, `customer_own`, `personalized` (caller
  flags), then the **PII screen** over the answer text
  (patterns mirror `inbox/pii-mask.ts`: BD mobile
  `(\+?880|0)1[3-9]…`, card-like 13–19 digit runs, TrxID-shaped
  alphanumeric tokens) → `pii_phone_in_answer` /
  `pii_card_like_in_answer` / `pii_trxid_in_answer`, and order
  references (`#<digits>`, অর্ডার নম্বর…, `order #…`) →
  `order_reference_in_answer`. **One deliberate exception**: a
  BD phone that IS the org's own published number
  (BusinessProfile `bkashNumber` / `nagadNumber` /
  `contactPhone`, digit-canonicalized) is PUBLIC-class data —
  the fact pack itself serves it — so an answer quoting the
  shop's own payment number is storable; a customer's number
  can never equal the shop's, so the exception cannot launder
  personal data. Source refs are normalized org-scoped
  (product ids enriched with the live product NAME; profile
  areas closed to delivery | payment | contact_hours).
  `containsLiveFacts` defaults to "the answer states any
  number" (conservative). **Replace semantics**: upsert on the
  unique key — one row per question, `hitCount`/`lastHitAt`
  preserved, an invalidated entry is revived by re-grounding,
  a **disabled entry is never revived** (disable is a human
  act; only a human re-enables). The vector is written via raw
  SQL after the metadata upsert; a re-store without a fresh
  vector clears the old one.
- **Embeddings-unavailable choice (recorded)**: when
  `EmbeddingsService` returns its typed unavailable (Anthropic,
  dev, kill switch, failure), the entry is stored WITHOUT a
  vector (provider/model/dimension NULL) and is reachable only
  by exact normalized-question match; the vector search filters
  on provider+model+dimension in SQL, so vectorless rows are
  invisible to it by construction. A repeat exact question —
  the dominant reuse case — therefore works for every org,
  including providers with no embeddings API.
- **`lookup(orgId, question, {channel, language})`**: exact
  normalized match first, then vector search (LIMIT 5, best
  candidate at/above the threshold). **Threshold:
  `ANSWER_STORE_SIMILARITY_THRESHOLD = 0.86`**, a named
  constant in `answer-store.service.ts`, overridable via the
  `AI_ANSWER_STORE_SIMILARITY_THRESHOLD` env var. A stale best
  candidate invalidates and misses — the list is not
  second-guessed. Language gate: an entry stored from a `bn`
  question is not served to an `en` asker or vice versa
  (`mixed`/undetected = no constraint); a mismatch is a miss,
  never an invalidation.
- **Live re-verification** (`verifySources`, before any serve):
  knowledge docs / policies / business profile are
  timestamp-checked against `groundedAt` (deliberate-edit rows;
  an edit after grounding retires the answer) →
  `source_doc_changed`, `source_doc_removed`,
  `source_doc_reclassified` (visibility flipped to internal),
  `source_policy_changed`, `source_policy_removed`,
  `source_profile_changed`. Products are **value-checked** —
  existence, `ACTIVE`, the store-time name snapshot
  (`product_unavailable`, `product_changed`) and the number
  set from the live formatted price/stock lines — because
  product rows mutate on every order (stock), where a
  timestamp check would retire price answers on the first
  unrelated order, while the value check retires exactly the
  answers whose quoted numbers no longer hold. When
  `containsLiveFacts`, **every** number the answer states must
  still be supported by the live sources (docs, policies,
  profile fact lines for the recorded areas, product lines),
  compared with the guard's own extraction →
  `live_facts_changed`. A passing candidate increments
  `hitCount` + `lastHitAt`.
- **`invalidate(orgId, entryId, reason)`** (public): records
  `status "invalidated"` + the reason on the row — the audit
  trail the P9 Learn Dashboard will read. Full reason
  vocabulary: the eight above + `number_guard_failed` (Item 3).
- **Shared extraction**: the guard's number logic moved to
  `extractGuardNumbers` in `inbox/business-brain.ts` (the pure
  module both sides already import); `InboxService.extractNumbers`
  now delegates to it — byte-identical logic, so a stored answer
  is judged by precisely the rule that admitted it.

## Item 3 — Inbox integration (commit 083abe1e)

`AnswerStoreService` is injected into `InboxService` as an
`@Optional()` LAST constructor parameter with the orgBrain
lazy-fallback discipline (positional spec constructions are
unaffected; the fallback builds a same-prisma instance whose
exact-match path works standalone).

- **Lookup (before the LLM)**: inside `composeLlmGroundedReply`,
  after the fact pack is built and the real-LLM check passes,
  and only when no `override` is present (the Instructions Desk
  test path never consults the store — a test must show what
  the AI would compose). On a lookup hit, the stored answer is
  run through the **existing number guard against the fresh
  fact pack** anyway (belt-and-braces, per brief): pass →
  returned as `{content, evidence: {tier: "answer_store",
  answerStoreHit: true, answerStoreId, sources: pack.sources}}`
  with **no LLM call**, and a zero-token `AIUsageRecord`
  `{feature: "answer_store_hit", provider: "answer_store",
  inputTokens: 0, outputTokens: 0, estimated: false}` is
  recorded so the saving stays visible in the same ledger;
  fail → the entry is invalidated with reason
  `number_guard_failed` and the LLM tier proceeds exactly as
  before. The send itself uses the unchanged autopilot send
  path (same `channelMessage`, same `autoReplyEvidence`
  envelope with `via: "autopilot"`). Lookup placement after
  the provider check keeps enablement semantics identical to
  today: dev-template orgs never autopilot, stored answers
  included; kill-switch/plan enforcement upstream is untouched.
  If no fact pack exists, the store is not consulted (there is
  nothing to guard against) and the existing knowledge-gap
  path runs.
- **Store (after a successful send)**: in `maybeAutoReply`,
  after `deliverText` succeeds, an LLM-tier composition
  (`evidence.tier === "llm"`) is captured fire-and-forget via
  `captureAutopilotAnswer` with the fact pack's own sources
  normalized into the store's shape, `origin
  "autopilot_grounded"`, and `customerOwn: intent ===
  "order_status"` — **order-status answers are refused by the
  store and never stored**, though the reply itself is sent
  normally. The deterministic tier is never stored (it is
  recomputed from live data on every message already), and
  draft-mode compositions never reach the capture (they return
  before any send — "actually sent" is literal).
- **Staff-edit capture (BUILT — the Step-0 hook is clean)**:
  `sendDraft` now awaits `sendReply`; when the send succeeded,
  the draft was edited, and `draft.provider === "auto-reply"`
  (autopilot drafts only — compose-suggest drafts carry the
  provider's name), `captureStaffEditedAnswer` runs
  fire-and-forget: the question is the conversation's latest
  inbound message (an `order_status` thread is flagged
  customer-own and refused), sources are harvested with the
  fact pack's own helpers (the Brain's customer context for
  the question — knowledge matches + policy sources; when the
  profile contributed any facts, all three profile areas are
  recorded, since the correction may rest on any of them and
  recording more areas only makes later verification stricter)
  plus a live `matchProduct` hit, and the edited text is
  stored with `origin "staff_edited"` — replacing any stored
  entry for that question. Unedited sends capture nothing (the
  autopilot's own capture already records what it composed).

## Item 4 — Specs (commit dd01eefb)

- `ai/answer-store.spec.ts` — 18 tests: normalization +
  live-facts helpers; exact store/serve + hit counting;
  **cross-org isolation on the exact AND vector paths** (org
  B's entry never serves org A, never counts a hit); replace
  semantics (one row, hitCount preserved); disabled never
  served/revived; language mismatch = miss, not invalidation;
  **refusals** (all three flags; customer phone refused vs the
  shop's OWN bkash allowed; order reference; card-like);
  **threshold** (cosine 0.90 hits via vector, 0.50 misses);
  vectorless storage when embeddings are unavailable (exact
  hits, paraphrase misses); the **staleness matrix** (doc
  changed / reclassified / removed, profile changed, price
  changed → `live_facts_changed` + row invalidated, stock
  quoted vs unquoted, product archived / renamed).
- `inbox/sa-b3-answer-store.spec.ts` — 5 tests over the real
  autopilot loop (U3-style harness + the pgvector simulation):
  LLM answer sent → captured; **the repeat is served with the
  provider's `complete` spy proving ZERO LLM calls**, evidence
  tier `answer_store` + `answerStoreHit`, hit counted, and the
  zero-token `answer_store_hit` usage row present; a
  below-threshold paraphrase takes the LLM path (spy called,
  tier `llm`, stored entry unserved); **order_status is sent
  but never stored**; staff-edited autopilot draft captured as
  `staff_edited` and served by lookup, while unedited sends
  and edited non-autopilot drafts capture nothing.
- The fake `$queryRaw` in both specs is a pgvector SIMULATION
  (it applies the SQL's bound filters and computes real cosine
  over stored vectors); the real-SQL proof is the round-trip
  in the gate below — the same two-layer proof as SA-B2.

## Gates (run strictly serially; results recorded as each finished)

| Gate | Result |
|---|---|
| New specs (`answer-store.spec` + `sa-b3-answer-store.spec`, `--runInBand`) | **2 suites, 23/23 tests pass** |
| Targeted jest: `src/inbox src/ai src/knowledge --runInBand` | **88 suites, 853/853 tests pass** (SA-B2 baseline 86/830; +2 suites / +23 tests, all SA-B3) |
| Constructor-touch jest: `src/automation src/connections src/messaging --runInBand` | **55/56 suites, 678/679 tests** — the one failure is `cc26-payout-automation` (wallet payout sweep: expected `already_created_for_slot`, got `below_threshold`), **proven pre-existing**: the identical run on the pristine base `05b86e0c` fails the same way (1 failed / 8 passed solo; rerun solo on this branch too). cc26 touches no SA-B3 code path (the batch diff contains no connections/automation/messaging/wallet file). |
| API tsc (`tsc --noEmit -p tsconfig.json`) | **exit 0** |
| API build (`tsc -p tsconfig.build.json`, the `pnpm build` script body) | **exit 0** |
| Fresh-PG (throwaway PG 16.15 + pgvector 0.6.0, empty DB, `prisma migrate deploy`) | **225/225 migrations applied, 0 unfinished** (base 224 + `20261028000000_sai_answer_store`); `AiStoredAnswer` verified in `information_schema`/`pg_indexes`: `embedding` is a real `vector` column; unique key `(organizationId, normalizedQuestion, channel)` + `(organizationId, status)` + `(organizationId, model)` indexes all present; extension `vector 0.6.0` present |
| Real pgvector round-trip on the migrated DB (the lookup SQL's verbatim shape, hand-run) | 7 planted rows: the org-A/active/inbox/same-model query returned ONLY `a1` (similarity **1.0000**) and `a7` (**0.9000**) in cosine order — org B's IDENTICAL vector excluded by the org filter, the comment-channel row by the channel filter, the invalidated row by the status filter, the other-model row by the model filter, and the NULL-embedding row by `IS NOT NULL`. The service's embedding UPDATE shape then set the vectorless row's vector successfully. A first hand-insert attempt also proved the unique key live: duplicate `(org, normalizedQuestion, channel)` inserts are rejected by the constraint. |

## NOT BUILT (later batches / owner-gated — named, not implied)

- **Answer Store management UI** (list / edit / pin / disable /
  delete stored answers, hit counts, labelled savings) — P9
  Learn Dashboard batch, per the plan. The `disabled` status
  and `invalidReason` audit fields are already in place for it;
  `origin "staff_approved"` is reserved for that surface (no
  code path writes it in this batch).
- **Comment-channel store use** — Phase 1 (R2). The `channel`
  column and lookup filter already support it; no comment code
  consults or writes the store in this batch.
- **Store use by other compose paths**: the CX1 staff draft
  suggestions, ghost-complete/tone-rewrite, the order bot and
  the deterministic tier neither read nor write the store —
  the store sits inside the autopilot LLM tier only, exactly
  as scoped.
- **A store-specific enable/disable setting**: the store rides
  the existing autopilot gates (mode, schedule, kill switch,
  provider liveness) and adds no new always-on behaviour; a
  dedicated per-org toggle belongs with the P9 dashboard /
  Phase 2 Control Center work.
- **Held-out evaluation of the 0.86 threshold against real
  traffic** — the constant is env-tunable, but tuning it
  against real question pairs needs real usage (M30).
- **Live verification of any kind**: no migration has run on
  the real database, no embedding or LLM call has been made
  against a real account, and the pgvector compose image swap
  from SA-B2 still takes effect only on the owner's manual
  Dokploy redeploy (M30 still owed). Until then production
  keeps keyword retrieval and per-question LLM composes,
  labelled as such.
