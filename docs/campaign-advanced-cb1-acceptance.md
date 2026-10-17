# Campaign Builder Advanced — Batch CB1 (CA1–CA5) Acceptance

Date: 2026-10-17 · Branch: `campaign-advanced` · Base: GitHub main `5b3d4030`
Plan: `~/workspace/goals/ai-marketing-saas-platform-build/files/Campaign-Builder-Advanced-Plan-2026-10-17.md`
Status: **code-complete, all gates green. NOT pushed, NOT deployed** (push/deploy are owner-gated as always).

Commits (one per item, in order):

| Item | Commit | Subject |
|---|---|---|
| CA1 | `61d73dfa` | AI image generation inside the campaign builder |
| CA2 | `6e5546b9` | AI slideshow video ads from product photos |
| CA3 | `42787394` | Google RSA assembly from CN5 textOptions + TikTok spike verdict |
| CA4 | `f98916bc` | Per-ad copy localization bn↔en |
| CA5 | `8b5a253d` | Creative scoring depth (migration 20261030000000) |

## Final gates (all run serially, 2026-10-17)

- API jest, campaigns module: **37 suites / 270 tests, all pass**
- API jest, creatives + ai + publishing modules: **29 suites / 216 tests, all pass**
- Web vitest (full): **109 files / 893 tests, all pass**
- tsc: api **0**, web **0**
- Monorepo build (`pnpm -r build`): **exit 0**
- Prisma validate: **valid** (schema at packages/db)
- Fresh Postgres 16, throwaway instance: **217/217 migrations applied clean** (216 base + CA5), `CreativeAsset.width/height` verified present; instance destroyed after the run.
- Known pre-existing items (not chased, per instructions): `cx3-debounce` flake; `cc26-payout-automation` deterministic failure on base (documented in `docs/campaign-release-2026-10-16.md`) — the connections suite was not part of this batch's gate set; nothing in CB1 touches connections/payout code.

## CA1 — AI image generation inside the builder ✅

- Endpoint: `POST /organizations/:orgId/campaign-plans/:planId/generate-image` (WRITE roles), `GenerateImageDto { prompt, productId?, adAccountId? }`. `CampaignsService.generateImage` enforces the plan gate (exists + editable) and delegates to the new `CreativesService.generateAiImage`.
- `CreativesService.generateAiImage` discipline, in order: `creative_library` feature flag → kill-switch + daily AI cap (feature `ad_image`) → `resolveImageProvider()` (the same `ai/images/image.factory` resolver the Social SP4 flow uses) → **no provider = honest Bengali refusal** → local-storage mode = refusal **before** the provider is called (no quota spent on an image Meta could never fetch) → product enrichment = name + category only (never price or any claim) → provider bytes magic-sniffed (`detectMediaKind`); non-image = refusal, nothing persisted → stored via `StorageService.put("public", {orgId}/creative/{uuid}.{ext})` → CreativeAsset created through the **existing by-URL `upload()`** (Meta `/adimages` ingest decides ready/failed) → StorageRegistry register (surface `creative`, best-effort) → `AIUsageRecord` (feature `ad_image`) only after persist → audit `creative.ai_image_created`.
- **Provenance:** CreativeAsset has no origin column. Smallest honest mechanism, documented here: AI assets carry the name prefix **"AI ছবি — "** plus the audit row and the `ad_image` usage feature. No schema change was made for CA1.
- Builder UI: "AI দিয়ে ছবি বানান" block beside AI Copy in the creative step (per-ad-set prompt state, reuses the AI Copy product selection); success refreshes the `/creatives` list through `asList()` and reports ready vs ingest-incomplete honestly.
- Spec: `apps/api/src/campaigns/ca1-ai-image.spec.ts` — **10/10 pass** (provider-absent refusal, success-path asset correctness, enrichment-without-price, non-image refusal, local-storage pre-provider refusal, plan gate + delegation).

## CA2 — AI video ad generation (slideshow) ✅

- Script: `CampaignsService.generateVideo` builds the script via the org LLM under the `suggestPlan` fact discipline — every number in the script must already exist in the product fact pack (price, in either digit script; Bengali digits normalized before comparison). A violation, invalid JSON, or **no real LLM** falls back to a template script built from the same real facts, **labelled `scriptSource: "template"`** in the response (the generateCopy dev-template precedent — a fallback is never dressed as an LLM result). `AIUsageRecord` feature `ad_video_script` is recorded when a real LLM call returns.
- Assembly: new `apps/api/src/creatives/video-slides.ts` — `renderSlidePng` (sharp cover-crop + SVG bottom band with XML-escaped Bengali text; the Social PP1 raster path already proves Bengali renders in this stack) and `assembleSlideshowMp4` (per-frame ffmpeg zoompan Ken Burns segments → concat demuxer, libx264/yuv420p, 25fps). Source photos are the product's own images whose URLs resolve to our CDN keys (`mediaKeyFromCdnUrl`) with bytes read through StorageService — **external URLs are never fetched**. No CDN-resolvable product photo = honest refusal. The last frame carries the real formatted price (from the product row, not the script). Three variants — **1:1 1080×1080, 4:5 1080×1350, 9:16 1080×1920** — each stored and created through the existing by-URL `upload()` (Meta `/advideos`; status `processing` until Meta's verdict via the existing `refreshVideo`). ffmpeg unavailable on the host = honest refusal before anything is produced. Output over the 50MB direct-upload cap = honest refusal. All variants are assembled in memory before any object/row exists; on a mid-run failure only the in-flight variant's object is removed.
- This is slideshow video from the product's own photos — never presented as filmed footage, in code comments, UI copy and this doc.
- Builder UI: "AI দিয়ে ভিডিও বানান" block under the AI image block; the notice states the aspect count, frames used, and labels a template script as template.
- Specs: `apps/api/src/creatives/ca2-video-slides.spec.ts` (REAL sharp + REAL ffmpeg: 2 tiny frames → ffprobe-verified h264 MP4 at the exact size/duration; the ffmpeg test is a labelled `it.skip` with a printed reason ONLY when ffmpeg/ffprobe are absent on the host — in this sandbox ffmpeg 8.1.2 is present and the test **ran and passed**) and `apps/api/src/campaigns/ca2-ai-video.spec.ts` (video-slides module stubbed, labelled, tests only: 3 aspect assets through storage+registry+ingest, ffmpeg-missing refusal, external-photo refusal, template labelling, invented-number LLM script falling back to template). **11/11 pass** across both files.

## CA3 — Google RSA assembly + TikTok spike ✅ (Google) / spike verdict recorded (TikTok)

- Google Search drafts now assemble `headlines[]`/`descriptions[]` via `CampaignsService.assembleGoogleRsa` from the ads' **CN5 textOptions** merged with the legacy fields (per ad: textOptions headlines → legacy headline → ad name; descriptions: textOptions descriptions → textOptions primaryTexts → legacy description → legacy primaryText; deduped, plan name first). Google's hard limits (15 headlines ≤30 chars, 4 descriptions ≤90) are enforced by **listing** over-limit options and cap overflow in the draft's `notCarried` with reasons — the pre-CA3 code silently sliced strings to the limit and silently capped the arrays; that no longer happens. RSA pinning is not sent (CN5 has no pin model) and the draft's transformation note says so. `PublishingService.publishGoogle` is unchanged — it already validates and sends the arrays; readiness (`validateCrossPlatformFields`) already renders them in the preview.
- **TikTok spike verdict (2026-10-17):** TikTok's standard `/ad/create/` carries exactly **one** `ad_text` — confirmed against TikTok's official SDK endpoint documentation. Multiple ad texts exist only in TikTok's separate **ACO (Automated Creative Optimization) product** — `POST /ad/aco/create/`, `GET /ad/aco/get/` (materials include multiple texts) — a distinct ad product with its own create contract. That full contract could not be verified to the standard this codebase requires for a publish path (and no live account proof exists), so **ACO was NOT built**. The existing single-text path stays, and extra CN5 variants are now listed in the TikTok draft's `notCarried` with the ACO reason — never dropped silently, never claimed as sent.
- Spec: `apps/api/src/campaigns/ca3-rsa-assembly.spec.ts` — **5/5 pass** (textOptions assembly reaches publishGoogle verbatim; over-limit → notCarried, no truncated prefix sent; cap overflow listed; draft persistence; TikTok single-text + ACO notCarried). Regression: cn9/cb6/cn17 cross-platform suites pass in the final gate.

## CA4 — Copy localization ✅

- Endpoint: `POST /organizations/:orgId/campaign-plans/:planId/ads/:adId/localize` (WRITE roles), body `{ targetLocale: "bn" | "en" }`. Translates primaryText/headline/description and all textOptions via the org's **real LLM only — no template fallback** (no real LLM = honest Bengali unavailable message).
- **Number lock:** the union of numbers across the whole ad (Bengali digits normalized) must be identical after translation; an invented or dropped number — or a changed option count — refuses the whole operation and **nothing is saved**. The refusal message names the source vs translated number sets.
- Storage: translations live under `textOptions.locales.<locale>` ({primaryTexts, headlines, descriptions}); the canonical fields are untouched. `normalizeTextOptions` and `resyncTextOptions` were taught to preserve the `locales` key so later edits don't silently drop translations. Source locale is a script-detection heuristic (Bengali Unicode block) and same-locale requests are refused with the message labelled as a script-based guess.
- `AIUsageRecord` feature `ad_copy_localization` recorded for every completed LLM call, including refused ones (the tokens were spent).
- Builder UI: per-ad "🌐 EN অনুবাদ" / "🌐 বাংলা অনুবাদ" buttons + a saved-locales indicator line on the ad row.
- Spec: `apps/api/src/campaigns/ca4-localization.spec.ts` — **7/7 pass** (no-LLM refusal, faithful translation saved with canonical fields untouched, invented-number refusal, dropped-price refusal, count-change refusal, same-locale refusal, 404).

## CA5 — Creative scoring depth ✅

- **Migration `20261030000000_ca5_creative_dimensions`** (the CB1 range claim `20261030000000+` was recorded in `Cross-Track-Migration-Ledger-2026-10-13.md` before creation; verified no `2026103*` folder existed on this tree): adds nullable `width`/`height` (Int) to `CreativeAsset`. Nullability is deliberate — legacy assets and direct video uploads honestly report dimension checks as not_checked.
- Population, always from real bytes or exact render size: direct **image** upload completion (sharp metadata on the uploaded bytes), CA1 AI image (sharp on generated bytes), CA2 AI video (the exact render size per aspect). Direct **video** upload bytes are not probed — their dimensions stay null (documented limit).
- creative-health additions (same findings shape; new level `not_checked`, rendered grey 🔍 in the builder):
  - Deterministic dimension checks: smallest side < 500px → resolution warning; aspect taller than 9:16 → crop warning; landscape image (≥1.5) with no vertical placement override → Stories/Reels warning. Asset without dimensions → `not_checked` finding.
  - Text-in-image: VisionService estimate (new feature key `vision_ad_creative_scan`, added to `VISION_FEATURES`; VisionService is provided in CampaignsModule directly — the LlmFactory precedent, since AiModule imports CampaignsModule). Coverage > 20% → warning **labelled "Vision Estimate"** in the message, with the honest note that Meta's current rules do not ban text in images. Bytes are read via the new `CreativesService.creativeImageBytes` (CDN-key URLs only; external URLs → not_checked). Vision unavailable / unparseable / the per-run cap of 5 scanned ads reached → `not_checked` **with the reason**, never a silent pass.
  - 9:16 safe-zone: **built** — the vision prompt also returns `contentAtEdges`; a vertical asset with content at the top/bottom edge gets the safe-zone warning, labelled as a vision estimate.
- Spec: `apps/api/src/campaigns/ca5-creative-scoring.spec.ts` — **7/7 pass** (dims populated at all three sources; resolution + landscape warnings; missing dims → not_checked; vision unavailable → not_checked with reason; heavy-text + safe-zone estimate warnings). Regression: cb3 creative-health and ca1 suites pass.

## NOT BUILT / honest limits

- **TikTok ACO multi-text publish path — NOT BUILT** (spike verdict above). TikTok drafts remain single-text; extra variants are listed in `notCarried`.
- **Google PMax asset-group assembly still uses the legacy-field pools** (CN17 contract untouched) — CA3's textOptions assembly covers the Search RSA path, which is what the item specified; PMax's `slice()` behaviour is unchanged and its transformation notes still record truncations.
- **Direct video upload dimensions are not probed** (no ffprobe pass in `completeCreativeUpload`) — those assets report dimension checks as not_checked until a probe is added.
- **CreativeAsset origin column — NOT added.** AI provenance for CA1/CA2 assets is the name prefix ("AI ছবি — " / "AI ভিডিও — ") + audit rows + AIUsageRecord features; a dedicated column was judged unnecessary schema churn for CB1.
- **No live-platform proof:** everything above is proven with the codebase's mocked platform seams and local media tooling only. No real Meta/Google/TikTok call was made; M30-style live verification remains owner-gated, as does push and the Dokploy redeploy. ffmpeg must exist on the API host for CA2 (it does in this sandbox; the production image is the owner's deploy concern — the service refuses honestly where it is absent).
