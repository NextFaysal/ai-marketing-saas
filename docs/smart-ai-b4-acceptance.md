# Smart AI Phase 0 — Batch SA-B4 Acceptance (P5: Product/Website Learning + P6: Conversation Learning)

Date: 2026-10-17. Branch `smart-ai`, base `3560b337` (SA-B3). Local
commits only; nothing pushed.

Commits:
- `b5132f8c` — Item 1: learning core schema + toggles + LearningService + LearningController.
- `4262a226` — Item 2 (P5a): product indexing coverage completed.
- `f031417e` — Item 3 (P5b): WebsiteLearningService.
- `461d7360` — Item 4 (P6): ConversationMiningService + job wiring + module registration.
- `534428d9` — Item 5: specs (17 tests).
- (this doc's commit follows)

## Step 0 — reality check in this tree (brief vs code)

Verified before designing:

1. **SA-B2 product indexing** covered name / nameEn / legacy
   `category` string / description / descriptionEn, triggered
   fire-and-forget from product create/update/archive plus the
   `knowledge_index_sweep` backfill (which passes full product
   rows, so `categoryId`/`brandId` are available). Missing —
   the P5a gap: structured `Category.name`, `Brand.name`,
   `ProductTag` names (via `ProductTagAssignment`),
   `ProductVariant` names + `attributes` Json values, and
   `seoDescription`.
2. **Website URL sources**: `BusinessProfile.websiteUrl` is the
   org's own-site URL. The Organization also carries a `slug`
   for its platform storefront, but there is NO stored
   storefront base domain in the API layer to build an absolute
   URL from, and the storefront's content duplicates catalog /
   profile data the Brain already has — so the seed source is
   `websiteUrl` only (recorded under NOT BUILT).
3. **Safe-fetch reality (honest gap)**: the competitor
   scanner's discipline exists and is reused —
   `competitors/site-audit.ts` exports `fetchText`,
   `loadRobotsDisallows`, `pageAllowed`, `stripTags`,
   `extractSameHostLinks`, `pageTitle`, on top of
   `website-scanner.ts`'s robots parser — but NO utility in the
   codebase performs a DNS/private-IP (SSRF) check. Item 3
   therefore adds that guard as new code inside
   WebsiteLearningService instead of pretending it was reused.
4. **Conversations**: `ChannelConversation` (status
   `open | pending | closed`, `resolvedAt`, `isPractice`) +
   `ChannelMessage` (direction in/out; staff authorship =
   `sentByUserId`, AI = `autoReply`; outbound counts as an
   answer only at status sent/delivered/read). "Resolved" for
   mining = status `closed` (falling back to `updatedAt` when
   `resolvedAt` is null).
5. **Toggle home**: there is no OrganizationSettings model.
   The org's AI settings already live on `BusinessProfile`
   (`aiInstructions`, `aiReplyLanguage`), updated through the
   existing `PATCH :organizationId/business-profile` (the
   service spreads the DTO) — so the two learning toggles are
   BusinessProfile columns + DTO fields, riding that exact API.
6. **AiUnansweredQuestion** is already clustered:
   `normalizedQuestion` + `count` + nullable `conversationId`,
   status open/resolved/ignored — mining needs no new grouping.
7. **Job pattern**: string-union `JOB_TYPES` + dispatch switch
   in AutomationService, Brain services `@Optional`-injected
   LAST (positional discipline) from OrgBrainModule, which is
   `@Global`-adjacent via Prisma/Audit being global.
   `AuditService.log({organizationId, userId, action,
   entityType, entityId, metadata})` is the audit precedent
   (knowledge module). `providerForOrg`/`LlmFactory` live in
   AiModule, so the miner resolves providers via the shared
   helpers — `resolveOrgLlmConfig` → `effectiveLlmConfig` →
   `buildLlmProvider` — exactly as EmbeddingsService does; no
   config logic is forked.

## Item 1 — Learning core (commit b5132f8c)

- **Migration** `20261029000000_sai_learning` (additive only):
  `LearnedItem` (kind `faq_pair | fact | product_note`,
  title, content Json — faq_pair `{question, answer}`, fact
  `{text}`, product_note `{text, productId?}`, sourceType
  `conversation | unanswered | website | product`, sourceRef
  Json id list, status `suggested | approved | rejected`,
  reviewedById/reviewedAt, appliedRef, dedupeKey) with
  `@@unique([organizationId, dedupeKey])` as the dedupe wall
  and indexes on (organizationId, status) + (organizationId,
  sourceType); `LearningState` (per-org per-source watermark +
  last-run status/detail, `@@unique([organizationId,
  source])`); `BusinessProfile.conversationLearningEnabled`
  **default FALSE** (D4) + `websiteLearningEnabled` default
  TRUE (it only ever fetches the org's own public websiteUrl,
  and only when one is set) — the deliberate toggle decision.
- **LearningService** (`ai/learning.service.ts`, OrgBrainModule):
  `createSuggestion` (dedupe wall — a rejected suggestion is
  not re-mined back; cross-org same content is a different
  row, L1), `listItems`, `getToggles`, `getState`/`saveState`,
  and the human transitions with audit (`learning.approve` /
  `learning.reject`). Approval application mapping (recorded
  choice): **faq_pair → `AnswerStoreService.store(origin
  "staff_approved")`** — and a store REFUSAL is surfaced as a
  400 with the item left `suggested`, never silently rerouted
  into a knowledge doc (a refusal is a safety signal, and
  SA-B3's store works without embeddings, so "no vector" is
  not a refusal); **fact → KnowledgeDocument kind "note"**,
  visibility = approver's choice, defaulting public for
  website/product sources, **internal for conversation/
  unanswered**; **product_note → kind "note", internal
  (fixed)**. Applied docs are indexed fire-and-forget through
  the existing pipeline. An item is stamped approved only
  AFTER its application actually landed.
- **LearningController**: `GET/POST organizations/
  :organizationId/learning-items[/:itemId/approve|reject]`,
  KnowledgeController guard discipline (TenantGuard +
  RolesGuard, `@PermissionArea("ai")`, writes OWNER/ADMIN/
  MARKETING_MANAGER). Toggles ride the existing
  business-profile GET/PATCH (DTO gained the two booleans).
  Knowledge kind enum gained `"website"` for Item 3.

## Item 2 — P5a product learning completion (commit 4262a226)

`KnowledgeIndexingService.indexProduct` now builds the embed
text from: name, nameEn, legacy category string, **structured
Category name, Brand name, ProductTag names, variant names +
scalar attribute values**, description, descriptionEn,
seoDescription. Relations are used pre-loaded when the caller
passes them, otherwise read org-scoped from Prisma;
enrichment failure degrades to fewer lines and never fails
indexing. Attribute keys matching /price|stock|cost|sku/i are
skipped by name. **The B2 rule is unchanged and absolute**:
no price/compare-at/bump/wholesale/stock value from product
OR variant ever enters the text — those facts stay live-read
(spec proves five sentinel values absent). **Product-derived
FAQ candidates: NOT BUILT** (see below) — P5a's honest scope
is indexing coverage: the catalog itself is the auto-knowledge,
read semantically through hybrid search.

## Item 3 — P5b website learning (commit f031417e)

`WebsiteLearningService.learnOrgWebsite(orgId)`:
- Seed = the org's own `websiteUrl` (https assumed when the
  scheme is missing); skipped honestly when the toggle is off
  (`website_learning_disabled`) or no URL exists
  (`no_website_url`). Links: seed host only, depth 1, via
  `extractSameHostLinks`; asset extensions skipped; **cap 10
  pages** per run.
- **SSRF guard (new — Step 0.3)**: `assertPublicHttpUrl` —
  http/https only; IP literals checked directly; hostnames
  resolved (`node:dns/promises`, the messaging module's
  precedent) and refused when ANY answer is private /
  loopback / link-local / CGNAT / reserved (`blocked_private_
  address`), checked before EVERY fetch, redirects included
  (manual redirect handling, max 3 hops, each re-validated);
  10s timeout; html content-type only. Recorded limit: this
  is resolve-then-fetch — Node's fetch cannot pin the
  connection, so a hostile DNS could theoretically rebind
  between check and connect; the seed is the org's own
  configured URL, which bounds the exposure.
- **robots**: `loadRobotsDisallows` + `pageAllowed` (the
  scanner's own parser); a disallowed seed short-circuits the
  run as skipped; disallowed pages are recorded as skipped,
  never fetched.
- **Storage**: one KnowledgeDocument per page — kind
  `"website"` (the choice: the kind enum gained the value
  rather than disguising site pages as `file_doc`), title =
  page `<title>` or path, `source = "website:<url>"`,
  **visibility public**. Extraction is `stripTags` (scripts/
  styles removed), capped at 20,000 chars; pages under 40
  chars of text are skipped as `thin_content`. Indexing runs
  through the existing pipeline (awaited here so the sweep's
  summary is truthful — a recorded deviation from the
  fire-and-forget CRUD pattern, safe in a background job).
- **Refresh**: the `website_learning_sweep` job walks every
  enabled org with a URL (cap 200). Unchanged content
  (sha256 of extracted text vs stored doc) performs NO
  update and NO re-index; changed pages update in place. A
  page that vanishes is recorded in the run detail — its doc
  is NOT deleted (deleting knowledge is a human act). Every
  run writes `LearningState(source "website")` with per-page
  skipped/errors — never silent, never fatal to the sweep.

## Item 4 — P6 conversation learning (commit 461d7360)

`ConversationMiningService.mineOrg(orgId)` + the
`conversation_learning_sweep` job (only opted-in orgs are even
listed):
- **Opt-in gate first (D4)**: toggle off → `skipped /
  conversation_learning_disabled` BEFORE any provider
  resolution — zero LLM calls, spec-proven with a resolver
  spy. Kill-switched orgs skip (`ai_disabled_for_org`); no
  real LLM → `skipped / no_real_llm_provider` with the state
  row saying so — no fake items, ever.
- **Window/caps**: conversations `closed` since the
  LearningState watermark (stored on LearningState — the
  recorded choice), max 50 per run, max 60 messages each;
  watermark advances to the newest processed stamp.
- **Extraction**: transcript lines (Customer / Staff / AI —
  only outbound messages actually sent) are scrubbed with
  `maskSensitiveText` BEFORE assembly; the org's own provider
  (org config → platform) is called with a strict JSON
  extraction prompt (generic questions only, no personal
  data, never invent), `jsonMode`, and the call is recorded
  as `AIUsageRecord{feature: "conversation_learning"}`.
  `parseExtraction` tolerates fences/garbage and yields
  nothing on malformed output.
- **Post-filters**: candidates pass the Answer Store's OWN
  PII screen — exposed unchanged as `screenAnswerPii` — on
  BOTH question and answer (this is also what catches order
  references, which the masker deliberately leaves alone);
  pairs already in the Answer Store (live or human-disabled)
  are not re-suggested; survivors go through
  `createSuggestion` (dedupe wall) as status **suggested**,
  sourceType `conversation`. Mining writes NOTHING to the
  Answer Store or KnowledgeDocuments (spec-proven).
  Recorded limit: names/free-form addresses have no maskable
  shape; defence in depth is prompt prohibition + shape
  screens + mandatory human review (D3).
- **Unanswered clusters**: `AiUnansweredQuestion` rows
  (open, count ≥ 2) mined WITHOUT the LLM — a `faq_pair`
  suggestion only when a STAFF (human, non-AI) answer exists
  after the question in the linked conversation (masked +
  screened); otherwise a `fact` recording the gap with the
  ask count. An answer is never invented.

## Item 5 — Specs

`ai/sa-b4-learning.spec.ts` — **17/17 pass**: approval mapping
(faq_pair → store `staff_approved` + appliedRef + audit;
refusal surfaced, item stays suggested, no doc written;
fact visibility defaults per source; product_note forced
internal; cross-org approve = 404; double-transition
refusals; dedupe wall; toggle defaults), mining (OFF = zero
resolver/LLM calls; no-LLM honest skip; masked prompt proven
against the provider spy's received messages; poisoned pair
dropped by the REAL PII screen; suggested-only — Answer
Store + KnowledgeDocuments empty after mining; usage row;
watermark second run = 0 conversations; isolation with
org-B sentinel strings; unanswered staff-answer pair vs gap
fact; parseExtraction), website (2 public docs created,
cross-host/asset/robots URLs never fetched, robots skip
recorded, private-IP refused with zero fetch calls,
isPrivateOrReservedIp range table, hash-skip refresh =
0 updates, changed page = exactly 1 update, toggle off),
product (relational lines present; sentinels 777777 /
31337 / 555555 / 22222 / 888888 all absent).

## Gates (run strictly serially; results recorded as each finished)

| Gate | Result |
|---|---|
| New spec (`sa-b4-learning.spec`, `--runInBand`) | **1 suite, 17/17 tests pass** (first run: 5 failures, one root cause — the test fake did not apply the schema's `status` default the real Prisma client applies; fixed in the fake, recorded here honestly) |
| Targeted jest: `src/inbox src/ai src/knowledge --runInBand` | **89 suites, 870/870 tests pass** (SA-B3 baseline 88/853; +1 suite / +17 tests, all SA-B4) |
| Constructor-touch jest: `src/automation src/products src/organizations src/commerce --runInBand` | **64 suites, 732/732 tests pass** |
| API tsc (`tsc --noEmit -p tsconfig.json`) | **exit 0** |
| API build (`tsc -p tsconfig.build.json`) | **exit 0** |
| Fresh-PG (throwaway PG 16.15 + pgvector 0.6.0, empty DB, `prisma migrate deploy`) | **226/226 migrations applied, 0 unfinished** (base 225 + `20261029000000_sai_learning`); `LearnedItem` + `LearningState` tables verified present with all indexes; BusinessProfile toggle defaults verified in `information_schema` (`conversationLearningEnabled` DEFAULT false, `websiteLearningEnabled` DEFAULT true); extension `vector 0.6.0` present |
| Real-DB unique proof on the migrated DB (hand-run) | A duplicate `(organizationId, dedupeKey)` LearnedItem insert is rejected by the constraint; the DB default stamps a fresh row `status = 'suggested'` |

No pre-existing failures were encountered in the targeted
scope, so no base comparison was needed. Tree clean at the
end of the batch (acceptance-doc commit aside).

## NOT BUILT (later batches / owner-gated — named, not implied)

- **Learn Dashboard UI** — P9 batch. The APIs it needs exist
  (learning-items list/approve/reject; toggles on the
  business-profile GET/PATCH); no web surface was added.
- **Product-derived FAQ candidates** (Item 2's optional half):
  NOT BUILT. Generating suggestion pairs from product records
  would need LLM phrasing over catalog copy to produce
  anything beyond the descriptions themselves, which are
  already fully indexed and searchable — the honest P5a
  scope is the indexing coverage that shipped. If suggestion
  generation from the catalog is wanted later, it belongs
  with the P7/P8 learning batch, labelled as LLM-phrased.
- **Storefront-slug website learning**: only
  `BusinessProfile.websiteUrl` is learned (Step 0.2 — no
  stored storefront base domain exists to fetch, and the
  storefront duplicates catalog/profile knowledge).
- **Comment-conversation mining**: P6 mined the Unified
  Inbox (`ChannelConversation`) only. Facebook/Instagram
  comment threads (`SocialComment`) are a different model
  with a different review surface; mining them is NOT built
  in this batch (the plan's Phase 1 R2 comment work is the
  natural home if it is ever wanted).
- **Brand-voice + performance learning (P7/P8)** — SA-B5.
- **LearnedItem edit-before-approve**: an approver can
  approve or reject; editing a suggestion's text first (and
  re-running the PII screen on the edit) belongs with the
  P9 dashboard batch. A refused faq_pair therefore stays
  suggested until then — recorded, not hidden.
- **Website page deletion on disappearance**: vanished pages
  are reported in LearningState detail; their documents are
  never auto-deleted.
- **DNS-rebinding pinning**: the SSRF guard is
  resolve-then-fetch (Item 3's recorded limit).
- **Live verification of any kind**: no migration has run
  on the real database, no website has been fetched, no
  conversation has been mined against a real account
  (M30 still owed).
