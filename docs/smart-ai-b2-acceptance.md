# Smart AI Phase 0 — Batch SA-B2 Acceptance (P2: pgvector + Embeddings + Hybrid Search)

Date: 2026-10-17. Branch `smart-ai`, base `a78457b1` (SA-B1). Local
commits only; nothing pushed.

Commits:
- `ed5d082b` — Item 1: KnowledgeEmbedding schema + pgvector migration + compose swap.
- `2cee03ba` — Item 2: EmbeddingsService.
- `efe50b69` — Item 3: VectorStore port + PgVectorStore.
- `2c806c41` — Item 4: indexing pipeline + triggers + backfill sweep.
- `779b504e` — Item 5: hybrid retrieval in OrgBrainService.
- (this doc's commit follows)

## Step 0 — reality check in this tree (brief vs code)

1. **There is no `KnowledgeChunk` model.** Knowledge content lives
   in `KnowledgeDocument` rows themselves: the two file paths
   pre-chunk (upload = `chunkKnowledgeText`, 8000 chars; ingest =
   1500-char chunks carrying `chunkIndex`/`totalChunks`/
   `sourceFile`), while paste documents (`createDoc`) are stored
   whole and can be long. Consequence: embedding chunks are
   derived at INDEX time from document content (Item 4 chunking),
   with `sourceType "knowledge_chunk"`, `sourceId` = the
   document id, `chunkIndex` = the derived sub-chunk index.
2. **Providers are openai | anthropic | gemini | dev** — there is
   NO custom-baseUrl provider in the chat layer (the OpenAI
   provider hardcodes `api.openai.com`), so the brief's "custom
   baseUrl" case does not exist to support; the embeddings
   endpoints cover the two real providers that have one. Config
   resolution is exactly the chat path and is REUSED, not forked:
   `resolveOrgLlmConfig` (per-org, decrypted) →
   `effectiveLlmConfig()` (admin JSON → `LLM_*` env). The admin
   `llmConfig` JSON shape is a fixed `{provider, model, apiKey}`
   — it carries NO embedding-model field, and the org config's
   `model` is the CHAT model (never reused for embeddings).
   Embedding model override therefore lives in the
   `LLM_EMBEDDING_MODEL` env var; per-provider defaults otherwise.
3. **AIUsageRecord fits embeddings natively**: `feature` is a
   free string, `model` is a plain column, `estimated` flags
   non-exact counts. Embeddings record `feature: "embedding"`,
   `model` = the embedding model, `outputTokens: 0`.
4. **Kill switches**: there is no global `aiEnabled` flag; the
   real switch is `killSwitches().aiDisabledOrgIds` (the same one
   chat enforces). A listed org gets NO embedding calls, for
   indexing or for query embedding.
5. **Job pattern**: job types are a string union (`JOB_TYPES`) +
   a dispatch switch in `AutomationService`, services
   `@Optional`-injected from imported modules, executed by the
   worker through `InternalJobsController`. The backfill follows
   it exactly (`knowledge_index_sweep`).
6. **Unsupported-column precedent exists**: `Product.searchVector`
   (`Unsupported("tsvector")`, maintained by raw SQL in
   `products/search-vector.ts`). `KnowledgeEmbedding.embedding`
   follows the same pattern.
7. **Products**: a clean text source exists (name / nameEn /
   description / descriptionEn / legacy `category` string), so
   `sourceType "product"` is INCLUDED per the brief's condition.
   Products are never hard-deleted through the API — DELETE maps
   to `archive()` (status → ARCHIVED).
8. **Fresh-PG environment**: this machine has no docker; the gate
   ran on a throwaway local PG 16.15 cluster with the pgvector
   extension package installed (`vector 0.6.0`) — the same
   PostgreSQL 16 + pgvector combination the `pgvector/pgvector:
   pg16` image provides.

## Item 1 — Schema + pgvector (commit ed5d082b)

- `KnowledgeEmbedding` model: org-scoped rows with `sourceType`
  (`knowledge_chunk` | `product`), `sourceId`, `chunkIndex`,
  `content`, `contentHash`, `provider`, `model`, `dimension`,
  `visibility` (snapshot of the source's disclosure class at
  index time), and `embedding Unsupported("vector")?` — UNTYPED
  dimension by design: providers return different dimensions,
  each row records its own, and search filters to the query
  vector's provider + model + dimension. Indexes on
  `(organizationId, sourceType, sourceId)`, `(organizationId,
  contentHash)`, `(organizationId, model)`. Migration
  `20261027000000_sai_vector`: `CREATE EXTENSION IF NOT EXISTS
  vector` + the table. On a stock `postgres:16-alpine` the
  migration would fail at `CREATE EXTENSION` — deliberate: no
  silent half-state where hybrid search pretends to run.
- `docker-compose.dokploy.yml`: postgres image
  `postgres:16-alpine` → `pgvector/pgvector:pg16`, with a comment
  recording same PG16 / same data volume. **This changes nothing
  until the owner's manual Dokploy redeploy.** The local-dev
  `docker-compose.yml` still names `postgres:16-alpine` (left
  untouched per the brief's one-line scope; local development
  without pgvector simply keeps keyword retrieval, labelled).

## Item 2 — EmbeddingsService (commit 2cee03ba)

`apps/api/src/ai/embeddings.service.ts`. Resolves the effective
config through the chat path's own helpers (Item 0.2), then:
OpenAI-compatible `POST /v1/embeddings` (model default
`text-embedding-3-small`; response rows re-ordered by `index`;
real `usage.prompt_tokens`), Gemini `batchEmbedContents`
(model default `gemini-embedding-001`, `outputDimensionality`
1536 requested; the endpoint reports no usage, so counts are the
codebase `estimateTokens` heuristic recorded with
`estimated: true` — labelled, never presented as exact).
Batches of 100. **Anthropic returns the typed unavailable
`provider_has_no_embeddings_api`; dev/no provider returns
`no_real_llm_provider`; a kill-switched org returns
`ai_disabled_for_org`; HTTP failures return `request_failed`.**
No code path fabricates, pads or derives a vector — when the
result is not `ok`, callers store nothing and the source stays
keyword-only. The service never throws into callers. Spec:
`embeddings.spec.ts` — 7 tests (endpoint/model/auth shape for
both providers, env override, both unavailable paths, kill
switch, HTTP-failure degradation, usage-record shape).

## Item 3 — VectorStore port + PgVectorStore (commit efe50b69)

`ai/vector-store.ts` (port + `VECTOR_STORE` DI token +
`vectorLiteral`, which THROWS on a non-finite component rather
than emitting malformed SQL) and `ai/pgvector-store.ts`. The
port's contract carries the laws: `organizationId` is a
mandatory argument on every method; `search` takes the audience
and the implementation must filter visibility IN THE QUERY.
PgVectorStore: metadata via the Prisma client (the vector
column is never selected through it), inserts and search via
raw SQL (`Prisma.sql`, every value a bound parameter). Search =
cosine distance `<=>`, `similarity = 1 − d`, WHERE
`organizationId + provider + model + dimension` always, plus
`visibility = 'public'` for a customer audience, `ORDER BY`
distance, `LIMIT`. **Exact scan, no HNSW** — HNSW cannot be
built over an untyped vector column, and per-tenant row counts
are small; this is the recorded trade-off, with Qdrant behind
the port as the scale path. Spec: `pgvector-store.spec.ts` —
7 tests proving the filters exist as bound parameters in the
generated SQL, org-scoped deletes, and the vectorLiteral guard.
(The real round-trip against actual pgvector is in the gate
below — the unit spec proves the SQL SHAPE, the gate proves
PostgreSQL executes it with the promised semantics.)

## Item 4 — Indexing pipeline (commit 2c806c41)

- **Chunking** (`ai/brain-chunking.ts`): `@langchain/textsplitters`
  **1.0.2, pinned exact**, `RecursiveCharacterTextSplitter`,
  2400 chars ≈ 600 tokens at the codebase's own ~4 chars/token
  heuristic (the plan's ~500–1000 token band), 240 chars overlap,
  Bengali danda `।` among the separators. This file is the ONLY
  import of any `@langchain` package in `apps/api/src` (verified
  by grep — see gates). A leading-separator remnant the splitter
  can leave at a chunk start is stripped, since stored chunks
  are what matches later quote.
- **KnowledgeIndexingService** (`ai/knowledge-indexing.service.ts`):
  `indexDocument` / `indexProduct` / `removeSource` /
  `backfillOrg`, all self-guarding (never throw). The refresh
  diffs desired chunks against stored rows — same chunkIndex +
  same SHA-256 content hash (over title + chunk for documents)
  + same provider/model + same visibility snapshot ⇒ kept
  untouched; anything else re-embeds alone; vanished chunks are
  deleted. **The provider call happens before any mutation**, so
  a provider failure leaves the previous index fully intact.
  Products index name/nameEn/category/description/descriptionEn
  ONLY — never price or stock (live facts, L4) — and only while
  ACTIVE; a non-ACTIVE product's rows are removed. Product rows
  are always `visibility "public"` (public catalog copy). Known
  limit: relational category/brand NAMES (Category/Brand tables)
  are not in the embed text — the legacy `category` string is;
  the AX11 FTS vector already covers relational names for
  keyword search.
- **Triggers** (all fire-and-forget; a save can never fail or
  block on indexing): knowledge `createDoc`, `updateDoc`,
  `uploadDocFile` (per created chunk-doc), `ingestFile` (per
  created chunk-doc), `deleteDoc` (row cleanup); product
  `create`, `update`, `archive` (via an `@Optional` LAST
  constructor slot — the ProductsService positional discipline —
  with the lazy same-prisma fallback). Knowledge/Product modules
  import `OrgBrainModule` for DI.
- **Backfill**: job type `knowledge_index_sweep` in `JOB_TYPES`
  + dispatch case → `backfillOrg(orgId)`: every document + every
  ACTIVE product, hash-skipped where current; per-source
  failures are collected and RETURNED in the job result (and
  logged), never swallowed; a kill-switched/provider-less org
  returns `status "unavailable"` with the typed reason. Like
  every sweep it runs only where an operator enables the job.
- **No `indexStatus` column was added** to KnowledgeDocument:
  the model carries no processing-state fields, so — per the
  brief's fallback — index state is the embedding rows
  themselves (present = indexed), and failures surface via the
  service log + sweep result.
- Spec: `knowledge-indexing.spec.ts` — 10 tests (hash-skip keeps
  the same row ids with ZERO provider calls; a changed chunk
  re-embeds only itself; unavailable stores nothing; visibility
  flip re-embeds under the new snapshot; empty content clears
  rows; product text excludes the price; backfill counts +
  failure collection + idempotency).

## Item 5 — Hybrid search in OrgBrainService (commit 779b504e)

`getContext` knowledge matching is now hybrid when both
collaborators are wired (the running app wires them via
OrgBrainModule; positional spec constructions without them keep
SA-B1 behaviour exactly):

- **Merge rule (deterministic)**: keyword matches are computed
  exactly as SA-B1. Then, when a query embedding succeeds,
  vector hits (sourceType `knowledge_chunk`, similarity ≥
  `MIN_VECTOR_SIMILARITY` = 0.35, best first, at most one per
  document) come FIRST, keyword hits for documents not already
  covered fill the remainder, and the union is capped at
  `matchLimit`. A vector-only paraphrase hit and a keyword-only
  hit (document never indexed) therefore both surface; below
  the similarity floor a "nearest" row counts as NO match —
  grounding a reply on a weak neighbour would violate L2.
- **Honest label**: the context now carries `retrievalMode` —
  `"hybrid"` only after a query embedding AND a store search
  actually ran for that call; `"keyword"` whenever embeddings
  are unavailable, unwired, or the vector path throws (the
  keyword result is then byte-identical to SA-B1's).
- **Defence in depth (L3/L4)**: a vector hit is admitted only
  through its LIVE document row — fetched org-scoped and
  audience-filtered at context-build time, on top of the SQL
  visibility-snapshot filter — so a stale row (source deleted,
  or reclassified internal after indexing) can never reach a
  customer context. Matches carry `via` ("vector" | "keyword")
  and `chunkIndex`; sources entries carry `via` too. Consumers
  (inbox fact pack, AI tools) needed no changes.
- Spec: `org-brain-hybrid.spec.ts` — 6 tests (paraphrase with
  zero shared tokens surfaces via vector alone, with a
  keyword-only control proving the miss; merge order + cap;
  internal chunk invisible to customers on BOTH paths, visible
  labelled to internal; cross-org isolation on the vector path
  in both directions; fallback results deep-equal to SA-B1).

## LangChain evaluation (recorded per brief)

**`@langchain/community` PGVectorStore — evaluated, NOT used.**
It owns its table schema (its own table with a fixed-dimension
`vector` column, content + JSON metadata columns), connects
through its own `pg` Pool, and filters through LangChain's
metadata-filter DSL. Our table must instead hold mixed provider
dimensions per row with first-class `organizationId` /
`visibility` columns filtered in plain SQL under OUR laws —
expressing that through PGVectorStore would mean adopting its
schema and giving up the per-row model/dimension discipline
(the thing that makes the Anthropic→OpenAI provider switch and
the audience filter safe). Direct pgvector SQL behind our own
port (Item 3) is strictly simpler and keeps the Qdrant swap
point identical. **`@langchain/textsplitters` — used**, for
chunking only, pinned exact (1.0.2), imported in exactly one
Brain file; if it ever needs to go, the house char-chunkers in
`knowledge/extract.ts` are the drop-in fallback and nothing else
in the system has seen the dependency.

## Gates (run strictly serially; results recorded as each finished)

| Gate | Result |
|---|---|
| Embeddings spec | **7/7 pass** |
| PgVectorStore spec | **7/7 pass** |
| KnowledgeIndexing spec | **10/10 pass** |
| Hybrid + SA-B1 OrgBrain specs | **13/13 pass** (6 new + 7 regression) |
| Knowledge suites (trigger wiring regression) | **2 suites, 36/36 pass** |
| Targeted jest: `src/inbox src/ai src/knowledge --runInBand` | **86 suites, 830/830 tests pass** (SA-B1: 82/800; +4 suites / +30 tests, all new SA-B2 specs) |
| Constructor-touch suites: `src/automation src/products src/catalogs` | **25 suites, 209/209 pass** |
| Constructor-touch suites: `src/commerce` (positional ProductsService constructions) | **24 suites, 394/394 pass** |
| API tsc (`tsc --noEmit -p tsconfig.json`) | **exit 0** |
| API build (`pnpm build`) | **exit 0** |
| Fresh-PG (throwaway PG 16.15 + pgvector 0.6.0, empty DB, `prisma migrate deploy`) | **224/224 migrations applied, 0 unfinished** (base 223 + `20261027000000_sai_vector`) |
| Real pgvector round-trip on the migrated DB (the PgVectorStore.search SQL shape, hand-run) | Extension `vector 0.6.0` present; `KnowledgeEmbedding` structure + 3 indexes + FK verified. Customer-audience query for org A returned ONLY org A's public row (similarity 1.0000): org B's IDENTICAL vector excluded by the org filter, org A's internal row excluded by the visibility filter, the other-model row excluded by the model filter — all in SQL. Internal-audience query returned both org A rows ordered by cosine distance. |
| LangChain confinement (`grep -rn "@langchain" apps/api/src`) | The only import in the codebase is `ai/brain-chunking.ts` |

No pre-existing failures were encountered in the targeted scope,
so no base-comparison was needed.

## NOT BUILT (later batches / owner-gated — named, not implied)

- **Answer Store (AL15 / SM3b)** — SA-B3.
- **Learning items** (website learning — P5's suggestion half,
  conversation mining — P6, performance learning — P7, brand
  voice + customer memory — P8). Product TEXT indexing shipped
  here as a retrieval source; P5's product/website *learning*
  behaviour (suggested knowledge from the catalog/site) is not
  part of this batch.
- **Learn Dashboard UI** and any web surface for retrieval mode
  or index state — API-only batch, same as SA-B1.
- **Comment/social Brain consumers, Reply Engine, Action
  Engine, Control Center** — Phases 1–2, untouched.
- **Qdrant** — deliberately not built; the VectorStore port is
  the swap point when total vectors reach ~2–5M (plan §3).
- **An admin UI field for the embedding model** — the override
  is the `LLM_EMBEDDING_MODEL` env var in this batch (the admin
  llmConfig JSON has no embedding field; adding one is an
  admin-console change for a later batch).
- **Redis query-embedding cache** (the plan's P2 line mentions a
  Redis cache): not built — query embeddings are one small call
  per grounded reply and the Answer Store (SA-B3) is the
  plan's actual repeat-cost killer; a cache can be added behind
  EmbeddingsService if usage data ever justifies it.
- **Live verification of any kind**: the compose image swap
  takes effect only on the owner's manual Dokploy redeploy; no
  migration has run on the real database; no provider embedding
  call has been made against a real account (M30 still owed).
  Until the redeploy, production keeps keyword retrieval —
  labelled as such by `retrievalMode`.
