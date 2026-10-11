# SP4 — AI Image: Provider + Template Composer — Acceptance

Scope: AI image generation for social posts (platform-configured
provider, verify-before-save) and a no-provider Template Poster
composer, both producing real `MediaAsset` rows in the tenant's
existing Media Library (SP1). Plan: `docs/social-posts-package-plan.md`
(SP4). Everything below is LOCAL ONLY — nothing committed/pushed by
this batch beyond the working tree the coordinator reviews.

## What was built

### Image provider home (`apps/api/src/ai/images/`)
- `image.types.ts` — `ImageProvider` / `ImageGenResult` /
  `ImageConfigError`, mirroring the LLM provider shapes.
- `gemini-image.provider.ts` — `GeminiImageProvider`: POST
  `:generateContent` with `responseModalities: ["TEXT","IMAGE"]`,
  `x-goog-api-key` header, injectable `fetchFn`. Default model
  `gemini-2.5-flash-image` — model availability is
  account-dependent, and the admin verify-before-save (below)
  catches a bad model with the provider's verbatim error before
  anything is saved. Non-OK → `Gemini image request failed
  (status): <provider message>`; OK-but-no-image-part →
  `Gemini returned no image data` (+ the text part, truncated).
  Tokens come from `usageMetadata`; `tokensEstimated` is true only
  when it is absent.
- `image.factory.ts` — `buildImageProvider` (gemini only; empty →
  `No image provider configured`, unknown → verbatim error) and
  `resolveImageProvider()` over `effectiveImageConfig()`, null
  when provider or key is empty.

### Platform config (`common/platform-config.ts`)
- New `ImageConfig` area stored as SystemSetting key `imageConfig`
  (`provider`, `model`, sealed `apiKeyEncrypted`), loaded into the
  snapshot by `refreshPlatformConfig`, resolved admin → env by
  `effectiveImageConfig()` (env: `IMAGE_PROVIDER` / `IMAGE_API_KEY`
  / `IMAGE_MODEL`). The snapshot's `image` field follows the exact
  sslcommerz/bkash pattern (optional in
  `setPlatformConfigSnapshot`, defaults null), so existing callers
  and tests are untouched.

### Admin (verify-before-save)
- Safe view gains `image: { source, provider, model,
  secretConfigured }` — secret values are never returned.
- `PATCH /admin/platform-config/image` (SUPER): provider must be
  `gemini` or `""`. **Verify-before-save semantics:**
  - Verify RUNS when: area is `image`, the save is not a full
    `clear` (handled before), `clearSecret` is not true, and the
    MERGED config (patch over stored row) has provider `gemini`
    AND a key (the patch's new key, or the stored sealed key).
  - Verify = ONE minimal real generation ("A simple red circle
    centered on a plain white background.") raced against 30s.
  - On FAILURE: an `admin.platform_config_verify_failed` audit row
    is written (field names + provider error only), then
    `BadRequestException("Image provider verification FAILED — the
    setting was NOT saved: <verbatim provider error>")` is thrown.
    NOTHING is upserted and the snapshot is NOT refreshed — a
    broken key/model can never silently become live.
  - On SUCCESS: the normal upsert + snapshot refresh + audit run,
    and the response adds `imageVerification: { ok: true, model,
    latencyMs }`.
  - Verify is SKIPPED for disable/clear-style saves (merged
    provider `""` or no key) — turning the feature off must never
    require a working provider.
- `POST /admin/platform-config/test-image` (SUPER) mirrors
  `testLlm`: refuses honestly when nothing is configured, else a
  real 30s-raced generation returning `{ ok, provider, model,
  source, latencyMs, bytes, contentType }`.
- Admin web card "🖼️ AI Image Generation" mirrors the LLM card
  (provider select, model, sealed key, save/test/clear) and states
  the verify-before-save behaviour in its helper text.

### Schema
- `MediaAsset.origin String @default("upload")` (upload |
  ai_generated | template) + `prompt String?`; migration
  `20261010930000_sp4_media_origin`. `serializeAsset` now returns
  `origin` (defaulting `"upload"` for pre-SP4 rows) and `prompt`.

### Social image service (`social/social-image.service.ts`)
- Routes (declared before `media/:id`): `POST media/ai-image`,
  `POST media/template-image` (WRITE_ROLES), `GET
  media/image-status` (area guard only).
- `generateAiImage`: prompt required (Bengali 400) →
  kill-switch/daily-cap enforcement FIRST (feature
  `social_image`, SP3/M55 shapes: 403 disabled org, 429 cap) →
  provider resolution (unconfigured → the exact Bengali 400
  pointing at Admin Panel / Template Poster) → optional org-scoped
  product (404 otherwise). Provider errors surface verbatim as
  400 with NO usage row and NO asset. Returned bytes must pass
  magic-byte sniffing as an image, else an honest Bengali 400 —
  again no asset, no usage (nothing usable was produced). On
  success: bytes in MediaStore at `<org>/social/<id>.<ext>`,
  asset `origin: "ai_generated"` with the final prompt recorded,
  usage row AFTER the persist, audit `social.ai_image_created`
  (provider/model/sizeBytes only — never the prompt, never a key).
- **Enrichment honesty:** a linked product enriches the prompt
  with its NAME and CATEGORY only — never its price, discounts or
  any claim — so no marketing fact is baked into pixels that the
  tenant did not write. (A spec asserts the formatted price is
  absent from the recorded prompt.)
- `createTemplateImage`: headline required, >120 chars is a
  Bengali 400 (never silently sliced). The base photo must be an
  org-owned image asset (foreign → 404, video → Bengali 400).

## Template rendering DECISION

The audit found NO raster library anywhere in the repo — no
sharp/canvas/jimp in any `package.json`. The poster is therefore
a **composed SVG** (`composePosterSvg`, pure + unit-tested):
1080×1080, the tenant's photo embedded byte-for-byte as a data
URI (so no decode step is needed at all), an optional brand
header (org logo from the M59 branding key + brand name over a
subtle dark band), and a bottom band in the org's `primaryColor`
(validated `#RRGGBB`, fallback `#111827`) carrying the wrapped
headline (≤2 lines, ellipsis on overflow, all text XML-escaped)
and the subtext. Subtext defaults to the product's REAL formatted
price (`formatMinor`) only when the caller did not pass one — an
explicit `""` means no subtext, and the web UI therefore omits an
empty subtext rather than sending `""`.

Honest limits, stated plainly:
- Browsers render the SVG (including Bengali, via system fonts)
  and it can be viewed/downloaded — the UI says exactly this.
- Meta/Instagram publishing (SP6) requires raster PNG/JPEG, so
  SVG posters are view/download assets until a rasterizer is
  added; they are NOT claimed publish-ready.
- Adding `sharp` was deliberately NOT done: a new native
  dependency + lockfile churn while parallel tracks are
  mid-flight is the wrong trade for a composer whose SVG output
  is real and usable today.

Template renders write a visibility-only usage row under a
SEPARATE feature (`social_template`, provider
`template-composer`, model `svg-template-v1`, 0 tokens, estimated)
so they never consume the `social_image` AI cap, and audit
`social.template_image_created`.

## Product-image deferral (unchanged from SP2)

Product images exist only as external `imageUrl`s — there is no
product → MediaAsset link and no URL-import endpoint. A template
request with a `productId` but no `mediaAssetId` therefore fails
with a Bengali 400 that says exactly that and tells the tenant to
upload the photo to the Media Library first. Nothing is faked.

## Web
- Tenant social-posts page: Media Library section gains a
  "🤖 AI ছবি" block (image-status driven — unconfigured shows the
  honest Admin-Panel note verbatim; success reloads media and
  auto-selects the new asset into the composer, respecting
  MAX_MEDIA) and a "🎨 Template Poster" block (image-asset select,
  headline, subtext with the price-default placeholder, created
  poster preview via the existing MediaThumb + "Post-এ ব্যবহার
  করুন"). Both product selects REUSE the SP3 products state — one
  fetch shared by all panels.

## Tests
- NEW `apps/api/src/social/social-image.spec.ts` (22 tests):
  Gemini provider vs stubbed fetch (bytes/tokens, verbatim error,
  no-image-part), factory errors; generateAiImage (not-configured
  exact message, enrichment-without-price, provider failure →
  nothing, non-image bytes → nothing, kill-switch 403, cap 429,
  cross-org 404); SVG/wrap units (escaping, colour, ≤2 lines +
  ellipsis); template (origin/contentType, real-price default,
  explicit/empty subtext, deferral 400, video 400, foreign 404,
  headline rules); admin verify-before-save against the existing
  fake-prisma harness (failure → NO row + verbatim error;
  success → sealed row + `imageVerification`; disable-save skips
  verification).

## EVIDENCE CEILING

The sandbox has no Postgres and no real Gemini key: **no real
provider image was generated in this batch.** The provider is
proven against stubbed fetch responses shaped like the real API,
the verify path is unit-proven (failure writes nothing, success
writes sealed), and the template composer is proven end-to-end
against the in-spec MediaStore stub. Real generation awaits the
owner's key in Admin → Platform Config (whose verify-before-save
will itself prove the key+model with a real generation at save
time). The SP4 migration applies via `migrate deploy` on the
owner's server, like every prior batch.
