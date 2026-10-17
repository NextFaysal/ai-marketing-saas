# SA-B19 Acceptance — G1 AI Social Content Generation

**Date:** 2026-10-17 · **Worktree:** `ai-marketing-saas-sai` (branch `smart-ai`) · **Base:** `72567b6b` (SA-B18) · **Local commits only — not pushed.**

- **Scope:** Smart AI Master Plan Phase 5, item **G1 (Social Content)** — AI post/variant generation grounded on the Brain (brand voice + product + winning angle), filed as real drafts in the existing composer flow. The B18 counter-content promise ("the draft step is Phase 5") is honoured in its recorded shape: generation grounds on Brain-approved facts only (L2), in the org's voice, and files **drafts for humans, not posts**.
- **Migration:** none — drafts are ordinary `SocialPost` rows through the existing creation path, and the attribution tag rides the pre-existing SU5 provenance columns (`autoDraftKind`/`autoDraftRef`). Fresh-PG confirms **229/229**.
- **Laws in force:** L1 (every source read is org-scoped; another org's ids are 404 here), L2 (fact pack = live rows + approved learning only; the shared number guard drops anything ungrounded), L3 (exemplars/voice are the org's own INTERNAL data, server-side only, never in any customer surface), L5 (the generator creates DRAFTS only — no publish, no schedule, no money).

---

## Step 0 — inventory in THIS tree (verified)

**Composer contract (the social posts module).** `SocialService.createPost(organizationId, actorId, CreateSocialPostDto)` is the ONE creation path: it validates the variant (`validatePostVariant` — the account must exist **in this org** or 404, and the actor must have account access), then `createPostRow` writes the row with `status: "draft"`, `scheduledAt` null, no publish fields, plus the org's approval-flow fields when that setting is on. Every draft therefore lands exactly where the tenant already works (the composer's draft list), and scheduling/publishing stay the existing human flows (`SocialPublishService`, queue, approval). A draft **requires** a `socialAccountId` — that is a caller input, not a session problem, so service-level draft creation is fully possible (SU4's `materializePlan` already proved it); the generate API takes the account id in its body. `SocialPost` insights are stored per post (SP7, `SocialPost.insights` Json) — relevant to Item 2 below.

**Existing AI draft helpers (not rebuilt, not touched).**
- **SP3 `SocialAiService.generateCopy`** — product/topic → caption variants, **returned only**, with an honestly-labelled dev-template fallback and **no numeric post-check** (its own doc comment says so). It predates the Brain: no LearnedItem sources, no exemplars, no learned voice.
- **SU4 `generateContentPlan` + `materializePlan`** — monthly plan persisted as `SocialContentPlan`, real-LLM-only, number guard drops plan items (`extractSocialNumbers`/`ungroundedNumbers` from the same file), drafts materialized later through `createPost`.
- **SN4 helpers** (`generateVariants`/`generateScript`/`translateText`/`generateCarouselOutline`) — real-LLM-only, returned only.
- **MS9 (messaging)** — AI drafts returned only; the honest pattern for "no real LLM" is a refusal, never a template dressed as AI.

**G1's delta over SP3** is precisely the Brain: topic sources include **approved LearnedItems**, the prompt carries the **SA-B16 exemplars** and the **SA-B5 voice** (owner text + learned profile via the one precedence builder), the **shared number guard drops** ungrounded variants post-generation, survivors are **persisted as drafts in the same call**, and a non-real provider is a **typed 503** (no dev-template path at all).

**Creative exemplar read API (SA-B16).** `CreativeLearningService.computeReport(orgId)` → `exemplars` (top-5 qualifying `CreativeUnit`s, read-through from `CampaignAd` rows). Consumed as-is; this batch takes the top 3 (`CONTENT_GENERATION_EXEMPLAR_LIMIT`).

**Brand voice (SA-B5).** `buildStyleInstructions(ownerBrandVoice, voiceRow)` in `org-brain.service.ts` — the one precedence builder: owner text leads, learned style applies only where it does not conflict, and the block is **null unless an ACTIVE learned profile exists** (a merely-suggested profile changes nothing — B5's recorded rule, inherited unchanged). `SocialModule` imports `OrgBrainModule` (a leaf module — global Prisma only — so no import cycle) for `CreativeLearningService`.

**Language.** Neither `BusinessProfile` nor `Organization` carries a language/locale field on this line, so there is no org language setting to read: an explicit `language: "bn" | "en"` in the request wins, default `bn` (SP3's house default). Recorded, not invented.

**Where a tenant triggers generation.** API-first per brief: `POST organizations/:organizationId/content/generate`. The composer UI (web) has its own SP3 ai-copy hook already; **no web UI was built in this batch** (see NOT BUILT).

---

## Item 1 — ContentGenerationService + API

`apps/api/src/social/content-generation.service.ts` + `content-generation.controller.ts` + `content-generation.dto.ts`, registered in `SocialModule`.

**Inputs — one topic source per call, all Brain-grounded:**
- **`product`** — the org's LIVE product row (org-scoped `findFirst`; another org's id is a 404). Facts: name, category, description. The **live price (and compare-at) joins the fact pack ONLY when the caller passes `includePrice: true`** — a product post is not automatically a price post.
- **`learned_item`** — an **APPROVED** LearnedItem of this org (creative pattern / competitor counter-idea / performance fact — any approved kind, read shape-aware: `fact`/`product_note` → `content.text`, `faq_pair` → question + answer). A suggested or rejected item is **refused with a 400** naming the review queue: generating public content from unapproved learning would launder an unreviewed claim into a post (D3/L2). The LLM is never called on this path (spec-proven).
- **`topic`** — a free topic string from staff.

Plus, always: the business facts SP3 carried (industry, description, unique selling points), the brand voice block (Step 0), the language, and the SA-B16 top exemplars as **style references** — the prompt states their role explicitly ("match their style… take NO facts and NO numbers from them"), and the guard enforces it (below).

**Generation.** Real LLM via `providerForOrg` (the org's own provider config, CC8). A non-real provider throws **`LlmNotConfiguredError`** — an `HttpException` 503 with the stable machine-readable body `{ code: "LLM_NOT_CONFIGURED", message: … }` (the MS9/SU4 honest pattern: a month of planning or a post from a template would be fabrication dressed as AI). Enforcement mirrors SP3 before any load: platform kill switch + the org's daily AI cap, under this generator's own usage bucket (`feature: "content_generation"`); the `AIUsageRecord` is written after provider success, before parsing — so it stands even when every variant is dropped (the provider did the work; SP3 accounting parity). Variant count is clamped to the named constant **`CONTENT_GENERATION_MAX_VARIANTS = 5`** (default 3) in both the prompt and what gets filed — no background generation, no storms.

**Number guard (the shared one).** The allowed set is `extractGuardNumbers(factPack)` — the SA-B3 extraction (`inbox/business-brain.ts`) the inbox guard, the Answer Store and the B14 narration all run. Every variant's caption **and** image brief are checked against it: an ungrounded number drops the whole variant (`droppedCount` reported), numbers are never silently edited into compliance. **Exemplar texts are deliberately NOT in the allowed set** — a caption echoing a stale discount out of an old winning ad is dropped like any invented number (spec-proven). If all variants drop, the call fails with a Bengali `BadRequestException` stating how many were dropped and why; nothing is saved. M24 policy findings are attached per surviving draft in the response, exactly as SP3 attaches them (a flagged draft is still a draft — the human reviewer decides).

**Output + persistence.** Each variant is `{ caption, hashtags, imageBrief }`: hashtags are the existing deterministic `suggestSocialHashtags` (grounded fields only — product category/name, industry, topic — no trending tags invented) and are appended to the stored caption so the draft is review-ready; `imageBrief` is a one-line **text** photo idea returned as response metadata — **no image is generated and none is claimed**. Every surviving variant is filed as a **real draft post through `SocialService.createPost`** — status `draft`, no `scheduledAt` ever passed, no publish path called anywhere in the service — tagged with its generation source (Item 2). An audit row (`social.content_generated`, counts + source ref) mirrors SU4's materialize discipline.

**API.** `POST organizations/:organizationId/content/generate` — `TenantGuard` + `RolesGuard`, `@PermissionArea("ai")` (the Smart AI tenant-surface convention of B14/B16/B17), write roles OWNER / ADMIN / MARKETING_MANAGER. Body: `{ sourceType, productId?, includePrice?, learnedItemId?, topic?, socialAccountId, language?, count? }`. Response: `{ provider, source: { type, ref }, exemplarsUsed, droppedCount, drafts: [{ postId, caption, hashtags, imageBrief, policy }] }`.

## Item 2 — Attribution hook (minimal, honest)

`SocialPost` already carries SU5 provenance columns — `autoDraftKind` / `autoDraftRef` — and `serializePost` already surfaces both, but the ONE creation path could not set them. This batch adds the smallest enabling change: `CreateSocialPostDto` gains the two **optional** fields and `validatePostVariant` → `createPostRow` passes them through **only when stamped** (commit `cce350bd`). Human composer calls send neither field and are byte-identical to before (the full social suite is the regression proof). The generator stamps every draft `autoDraftKind: "ai_content"` with `autoDraftRef` = `product:<id>` | `learned:<id>` | `topic`.

What this buys, honestly stated: per-post insights already exist (SP7 stores the platform's returned metrics on the post row), so a future SA-B5-style comparison of generated-vs-manual post performance **can** group published posts by this tag. **No such analytics are built in this batch** — the tag is forward-looking metadata, and no generated-vs-manual claim is made anywhere.

## Item 3 — Specs (`apps/api/src/social/content-generation.spec.ts`, 13 tests, all passing)

- **Grounding:** product facts (name/category/description) in the prompt; the price line is **absent** without `includePrice` and **present** with it; an approved creative-pattern LearnedItem's text grounds the prompt and stamps `learned:<id>`.
- **Suggested-item refusal:** an unapproved LearnedItem → 400, the provider's `complete` is never called, no draft is created.
- **Number guard:** an invented-price variant (Bengali digits) is dropped while the clean variant is drafted; an all-invented run → honest 400, zero drafts, the usage row stands; a caption echoing the **exemplar's** discount is dropped (exemplar numbers not admitted).
- **Exemplars:** present in the prompt (with the style-reference framing) when the report returns them, `exemplarsUsed` reported; absent cleanly (`exemplarsUsed: 0`, generation succeeds) when none qualify.
- **Language:** `en` → the English directive; default → the Bengali directive.
- **Voice precedence:** an ACTIVE learned profile's signature phrase reaches the system prompt; a merely-**suggested** profile changes nothing (owner `brandVoice` text rides as a plain fact, the learned phrase is absent).
- **Draft-only persistence (SocialService spy):** one `createPost` per survivor with the org, account, caption (hashtags appended) and provenance — and **no `scheduledAt`, no `status`** in what the generator passes (status is the creation path's own `draft`).
- **No-LLM org:** the typed `LlmNotConfiguredError` (503, `code: "LLM_NOT_CONFIGURED"`), no usage row, no drafts.
- **Cross-org isolation:** org B's product id and org B's approved learned-item id are both 404 under org A; the provider is never called; nothing is created.
- **Variant cap:** `count: 99` is clamped to `CONTENT_GENERATION_MAX_VARIANTS` in the prompt text and in the number of drafts filed, even when the provider returns more.

## Gates (run strictly serially, recorded as each finished)

| Gate | Result |
|---|---|
| Targeted jest (ai + social + inbox + knowledge + organizations, `--runInBand`, 4096 heap) | **160 suites / 1,952 tests — all passed** (includes the new `content-generation.spec.ts`, 13 tests, and the full SP3/SU4/SN social suites as regression for the Item 2 passthrough) |
| API typecheck (`tsc --noEmit`) | **exit 0** |
| API build (`npm run build`) | **exit 0** |
| Fresh-PG (throwaway local PG 16 + pgvector, empty DB, `prisma migrate deploy`) | **229/229 applied, 0 unfinished** — no new migration, as expected. Throwaway cluster dropped afterwards |

Pre-existing issues **not** touched (per brief): the `cc26-payout-automation` wallet-sweep spec failure (outside the targeted folders; base-proven pre-existing since SA-B3); the TelegramClient/ThreadsClient undecorated-param boot bug on this line (proven fix on the nf line, `b6dcc457`, owed at integration).

## NOT BUILT (G1)

- **Image/video generation** — the `imageBrief` is a one-line TEXT photo idea returned with the draft. No image is generated, attached or claimed; `CreativeAsset`/media pipelines are untouched.
- **Auto-publish / auto-schedule** — forbidden by design (L5 + the standing draft-only rule). The generator has no publish or schedule call; both stay human acts in the composer.
- **Web composer UI button** — no trivial existing hook was used: the composer's AI entry point is the SP3 ai-copy panel (a different, returned-only surface), and bolting G1 onto it is a web change with its own review surface. The G1 API is complete and tenant-reachable; the UI wiring is a follow-up, not silently half-done here.
- **Generated-vs-manual performance analytics** — only the attribution tag (Item 2) is built; no comparison numbers exist or are claimed.
- **A weekly coach on G1's own numbers** — the plan's G1 line mentions the weekly coach; the existing `SocialCoachService` (SN package) is untouched by this batch, and no coach change was needed for the generation scope. Recorded as not part of this batch rather than silently absorbed.
- **Live verification** — nothing in G1 (or the Smart AI line) is proven against real accounts, a real LLM key or real social accounts; M30 remains owed line-wide.

## Commits

| Commit | Item |
|---|---|
| `cce350bd` | Item 2 (enabling) — provenance passthrough on the ONE post-creation path (`autoDraftKind`/`autoDraftRef`), human calls byte-identical |
| `11db3ed7` | Item 1 — ContentGenerationService + `POST organizations/:id/content/generate` + SocialModule wiring (OrgBrainModule import for the exemplar read) |
| `8a179e88` | Item 3 — specs (13 tests) |
| _(this doc's commit)_ | Item 4 — SA-B19 acceptance |
