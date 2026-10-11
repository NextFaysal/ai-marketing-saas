# SP3 — AI Copy for Social Posts: Acceptance

**Package:** Social Media Post Scheduler, SP3 (docs/social-posts-package-plan.md)
**Status:** Delivered locally. **Not pushed** — GitHub push waits for the owner's explicit in-the-moment instruction.

## What was built

### AI caption generation (M55-mirrored)

- New `SocialAiService` (`apps/api/src/social/social-ai.service.ts`) with
  `generateCopy(organizationId, userId, dto)`, exposed as
  `POST /organizations/:organizationId/social/posts/ai-copy`
  (`@PermissionArea("social")`, WRITE_ROLES = OWNER / ADMIN / MARKETING_MANAGER).
- Input: optional `productId`, `topic` (≤500), `tone` (≤120), `language`
  (`bn` | `en`, default `bn`), `count` (1–5, default 3), `platform`
  (`meta_page` | `instagram`).
- Output: `{ provider, isRealLlm, product: { id, name, price, currency } | null,
  variants: [{ caption, policy: { status, findings } }], hashtags, notice? }`.
- With neither a product nor a topic: Bengali 400
  ("Product বেছে নিন অথবা একটা বিষয় (Topic) লিখুন।"). A product from
  another org (or a missing product) is a 404 with M55's exact message
  ("Product not found in this organization").
- `AiModule` now exports `LlmFactory`; `SocialModule` imports `AiModule`
  and registers `SocialAiService` (verified: nothing in AiModule's import
  graph imports SocialModule, so there is no cycle).

### M55-mirroring statement

SP3 mirrors M55 Creative Studio (`apps/api/src/ai/creative-studio.service.ts`)
exactly for enforcement, grounding and post-processing:

- **Enforcement first**, before any product/topic load: platform kill
  switch (`killSwitches` / `effectiveLimits` from
  `common/platform-settings`) → 403 with M55's exact message; daily cap
  counted from `AIUsageRecord` for the feature — here `social_copy`
  (M55 uses `creative_studio`) — → 429 with M55's exact message.
- **Grounding facts only**: product name, price formatted with
  `formatMinor(BigInt(priceMinor), currency)` from `@repo/contracts`,
  compare-at price, category, description, stock quantity, plus Business
  Brain lines from the shared `businessProfile` model (`Brand voice:`,
  `Business industry:`, `About the business:`, `Unique selling points:`),
  plus the user's own `Topic:`, `Tone:`, and a platform style hint
  (Facebook Page → longer/link-friendly; Instagram → concise,
  hashtag-friendly). No other facts are ever supplied.
- **Prompt prohibition**: the system prompt instructs the model to use
  ONLY the given facts and to never invent prices, discounts, stock,
  delivery promises, features or results — and, when no price is among the
  facts, to not mention any price at all. Output is JSON-only:
  `{"variants":[{"caption":string}]}` with exactly `count` variants,
  caption at most 2000 characters (`complete(..., { jsonMode: true, maxTokens: 1400 })`).
- **Usage accounting**: on the real path an `AIUsageRecord`
  (feature `social_copy`, provider/model/tokens from the provider result)
  is written AFTER provider success and BEFORE parsing — exactly as in
  M55. A provider throw becomes `BadRequestException` with the provider's
  message verbatim and writes NO usage row. Unparseable/empty captions are
  skipped; zero usable captions →
  `BadRequestException("The AI provider returned no usable caption variants. Nothing was saved.")`.
- **Policy**: every variant carries the M24 policy pre-flight
  (`policyFindingsForText` from `campaigns/policy-check`) as
  `{ status: "flagged" | "pass", findings }`.

**Verified fact about M55 (checked in the source before mirroring):**
M55 has **no numeric post-check** that drops variants containing invented
prices. Its guards are exactly: prompt prohibition + grounded facts +
policy findings attached. SP3 mirrors that — no more, no less.

### Dev path (no real LLM configured)

- When the provider is not a real LLM, exactly 3 grounded template
  captions are produced (sliced to `count`) from the same facts, in
  Bengali or English, reusing M55's exact dev notices naming the
  "Dev Template Adapter". A usage row is written with provider
  `dev-template`, model `dev-template-v1`, `estimated: true`, and tokens
  from `estimateTokens`.
- Product templates use only the real (formatted) price / compare-at
  price and the product's own fields. Topic-only templates use ONLY the
  topic text plus generic non-factual scaffolding (e.g. "বিস্তারিত জানতে
  ইনবক্স করুন।") — never a price or discount claim.

### Hashtags

- `suggestSocialHashtags({ product, businessProfile, topic })` is a pure,
  deterministic, exported helper: tokens from product category, product
  name, business industry and topic words; apostrophes removed first
  ("Men's" → "mens"), split on non-alphanumerics, Latin `[a-z0-9]` words
  of length ≥ 3 only, lowercased, deduped in first-seen order, max 8,
  prefixed with `#`. Bengali words yield no tokens — that is the
  documented deterministic behaviour; no trending tags are invented.

### Hashtag sets — model decision

There is **no generic tenant key-value store** in the codebase, so saved
hashtag sets get **one small Prisma model** instead of a faked store:

- `SocialHashtagSet` appended at end-of-file in
  `packages/db/prisma/schema.prisma` (`id`, `organizationId`, `name`,
  `tags Json @default("[]")`, `createdById`, timestamps,
  `@@index([organizationId])`), with migration
  `packages/db/prisma/migrations/20261010920000_sp3_hashtag_sets/migration.sql`
  in SP1's SQL style.
- Endpoints (all org-scoped, `@PermissionArea("social")`):
  `GET hashtag-sets`, `POST hashtag-sets`, `PATCH hashtag-sets/:id`,
  `DELETE hashtag-sets/:id` (writes require WRITE_ROLES).
- `normalizeHashtagTags` (pure, exported): trim, strip leading `#`,
  drop empties, dedupe case-insensitively keeping the first form,
  max 30 tags per set (over → Bengali 400), each tag ≤ 100 chars.
  Duplicate set name in the org (case-insensitive, excluding self on
  update) → `ConflictException`. Missing set →
  `NotFoundException("Hashtag set not found in this organization")`.
  Audits: `social.hashtag_set_created` `{ name, tagCount }`,
  `social.hashtag_set_updated` `{ fields }`, `social.hashtag_set_deleted`.
  Serializers expose only `{ id, name, tags, createdAt, updatedAt }`.

### Web (dashboard/social-posts)

- A collapsible "✨ AI দিয়ে Caption" panel inside the composer:
  product select (products fetched lazily when the panel opens from
  `GET /organizations/{orgId}/products` — the `{ items }` list shape is
  adapted defensively, with a "কোনো Product নয়" empty option), topic
  input, language select (বাংলা / English), count select (1–5), and a
  generate button calling `POST .../social/posts/ai-copy` with the first
  selected composer's account platform when one is selected.
- Variant cards show the caption, a policy badge
  ("✅ Policy Check: Pass" or "⚠️ Flagged" with each finding's
  explanation listed), and the response `notice` verbatim in an amber
  note when present (dev-adapter honesty).
- Suggested hashtags render as toggle chips (none selected by default).
  "এই Caption ব্যবহার করুন" sets the composer caption to the variant,
  appending `"\n\n"` + the selected hashtags joined by spaces when any
  are selected.
- Hashtag sets inside the panel: sets load when the panel opens;
  clicking a set replaces the selected hashtags with the set's tags
  (prefixed `#`); a name input + "💾 Set হিসেবে সংরক্ষণ" saves the
  currently selected hashtags via `POST hashtag-sets` and refreshes
  the list. Errors use the page's existing error/notice mechanism.

## Evidence ceiling (stated plainly)

- The sandbox has **no Postgres** — the SP3 migration has not been
  applied or run against a live database here; it applies via
  `migrate deploy` on the owner's server, like SP1's.
- **No live HTTP was run** for SP3, and **no real LLM key exists in the
  sandbox**: the real-provider path is unit-proven with a stubbed
  provider (JSON parsing, grounding assertions on the captured prompt,
  usage accounting, error paths), and the dev-template path is the
  labelled fallback that would actually run without a key.
- Evidence = the new `social-ai.spec.ts` specs + the existing
  `social.spec.ts` / `creative-studio.spec.ts` suites + the full API
  jest suite + web tests + API build + web typecheck/build (see the
  delivery report for exact totals).
- Nothing in SP3 claims a post was published or scheduled — SP3 only
  generates copy and saves hashtag sets. Publishing/scheduling remain
  SP5/SP6.
