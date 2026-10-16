# RB3 Acceptance — RM4: Product Image Upload (presign) + External-URL Mirror + Gallery Upload UI

Batch: **RB3** of the Cloudflare R2 Media Program (plan:
`Cloudflare-R2-Media-Plan-2026-10-15.md`, RM4). Built in the
`r2-media` worktree (base `4444bf5`, the RB2 head). **Local
commits only — NOT pushed**, per the owner's push rule.

> Worker note: the first RB3 worker died in a daemon restart
> before submitting anything; this batch was restarted from a
> clean `4444bf5` tree and committed in small increments
> (API → specs → web → this doc) so no daemon restart can lose
> more than one increment.

## Commits

| Commit | Content |
|---|---|
| `badba40` | API: media-url helper + presign/complete endpoints + delete→trash hook + ProductImageMirrorService + module/env wiring |
| `1c09a0a` | Specs: `rm4-product-images.spec.ts` (16 tests) |
| `d3275cb` | Web: gallery file upload (drag-drop + picker) + products-page mirror button |
| (this doc) | Acceptance |

## What RM4 delivers

### 1. The one CDN helper (plan §১.১)

`apps/api/src/storage/media-url.ts`:
- `publicMediaUrl(key)` — the ONLY place a stored-media public
  URL is built. Base = env `MEDIA_CDN_BASE_URL`, default
  `https://media.qosprey.com`, trailing slashes stripped.
- `mediaCdnHost()`, `mediaKeyFromCdnUrl(url)` (CDN URL → key, or
  null for external URLs), `imageExtForContentType(...)`.
- Env passthrough added in the RB1/RB2 pattern:
  `docker-compose.dokploy.yml` (`MEDIA_CDN_BASE_URL:
  ${MEDIA_CDN_BASE_URL:-}`), `.env.example`,
  `.env.dokploy.example`. Empty value = the code default.

### 2. Presign upload flow (plan §১.৩, adapted — see "Honest deviations")

Products controller, existing guards/roles (`WRITE_ROLES` =
OWNER/ADMIN/MARKETING_MANAGER):

- `POST organizations/:orgId/products/:productId/images/presign`
  — body `{fileName, contentType, sizeBytes}`. Verifies
  org+product ownership (`getProductOr404`), contentType ∈
  {image/png, image/jpeg, image/webp}, size 1..10 MB
  (`PRODUCT_IMAGE_UPLOAD_MAX_BYTES = 10 * 1024 * 1024`, stated
  constant). Returns `{uploadUrl, key, contentType, sizeBytes,
  expiresInSeconds: 600}` where the key is
  `_quarantine/{orgId}/product/{uuid}` and the URL is a
  StorageService presigned PUT (public visibility). In local
  mode (no R2 configured) it refuses with a clear Bengali 400 —
  **no fake URL is ever handed out**.
- `POST organizations/:orgId/products/:productId/images/complete`
  — body `{key, contentType, sizeBytes}`. The key must belong to
  this org's quarantine prefix (path-traversal shapes refused).
  Then, in order: HEAD size check → full read → **magic-byte
  sniff** (the inbox's `detectMediaKind`, reused) must be an
  image whose type EQUALS the declared type → sha256 → **copy**
  to the immutable final key
  `{orgId}/product/{productId}/{uuid}.{ext}` (public bucket) →
  `StoredFile` register (surface `product`, visibility `public`,
  sha256, sourceRef `product:{productId}`) → gallery row created
  through the **existing `addImage`** (same position = last rule,
  same position-0 → `Product.imageUrl` cover mirror, same audit)
  with `url = publicMediaUrl(finalKey)` → quarantine object
  deleted. **Any failure deletes the objects it created and
  creates no row** — size mismatch and sniff mismatch both remove
  the quarantine copy too; there is no partial state.

### 3. Delete → registry trash (plan RM11 boundary)

`deleteImage` now, after the row delete, derives the key from a
CDN-backed row's URL and flips its `StoredFile` registry row to
`trashed` (best-effort — registry bookkeeping never fails a user
delete). **The object itself is NOT deleted here** — actual
object deletion belongs to RM11's lifecycle job; the code says
so in a comment. All other gallery behaviour (re-index, cover
follow-through, audit, catalog push hook) is unchanged.

### 4. External-URL mirror — `ProductImageMirrorService`

New file `apps/api/src/products/product-image-mirror.service.ts`;
trigger `POST organizations/:orgId/products/images/mirror-external`
(**OWNER/ADMIN only** — it rewrites catalog data org-wide;
declared as a static segment before the `:productId` routes).
Response: `{scanned, mirrored, deduped, failed: [{productId,
host, reason}]}`. Failures live only in this response — no new
table.

- **External** = a `ProductImage.url` or `Product.imageUrl`
  whose host is not the CDN host and is http(s). The cover counts
  once per product (a cover equal to a gallery row's URL rides
  the row's candidate; a cover-only URL is its own candidate and
  no gallery row is invented for it).
- **Bounds (stated constants):** `MIRROR_BATCH_LIMIT = 25`
  candidates per run; `MIRROR_PER_HOST_CONCURRENCY = 2`
  simultaneous fetches per host; `MIRROR_MAX_BYTES = 10 MB`.
- **Guarded fetch = the PP3 policy** (`SocialImportService`):
  https only, no URL credentials, port 443 only, host resolved
  first and EVERY address must pass the shared `isPublicAddress`
  check, redirects followed manually (≤3) with full revalidation
  per hop, one ~10 s timeout over the chain, body cap enforced
  DURING the read, and a magic-byte sniff over the bytes. The one
  deliberate difference: the cap is 10 MB (product photos), not
  PP3's 2.1 MB social cap. PP3's known resolve-then-fetch TOCTOU
  note applies identically and is carried in the class doc.
  Implementation note: PP3's own hop-validation/read helpers are
  private to its class, so the mirror implements the same policy
  in its own code (reusing the exported `isPublicAddress` and
  the same public `fetchFn`/`resolveHost` spec seams) rather
  than refactoring PP3's internals in this batch.
- **Dedupe by content:** repeated URLs share ONE fetch; the
  sha256 of fetched bytes is checked against `StoredFile`
  (same org, surface `product`, not trashed) BEFORE any upload —
  a hit rewrites the row to the existing object's CDN URL and
  uploads nothing (`deduped`). Survivors are PUT to the public
  bucket under the same key pattern, registered with
  `sourceRef` = the original external URL.
- **Failure = row untouched.** Fetch errors, non-image bytes,
  private-IP hosts and http URLs all land in `failed[]` with the
  product id, host and a Bengali reason. A storage outage
  (local mode) fails every candidate with one honest reason
  instead of reporting a fake zero-mirror run.
- An audit entry (`product.images.mirror_external`) records the
  run counts and the distinct failed hosts (never full URLs).

### 5. Web

- `EcGalleryDialog` (`ec-product-dialogs.tsx`): a drag-drop zone
  + multi-file picker (PNG/JPEG/WebP). Per file: presign → raw
  `fetch` PUT to the presigned URL → complete → list refresh.
  Client-side type/size prechecks mirror the API's; failures are
  reported per file by name in Bengali. The URL-add form, delete,
  and reorder behaviour are untouched; no redesign.
- Products page: a small header button "🪞 ছবি নিজের স্টোরেজে
  নিন" runs the mirror endpoint; the summary (scanned / new
  copies / deduped / failed count + failed hosts + first reason)
  renders through the page's existing notice/error banners.

## Honest deviations from the plan draft

- **Copy, not move; no resize variants.** Plan §১.৩ sketched an
  async worker pipeline with server-side variants (800/300 px).
  R2 Image Transformations (plan RM8) generates variants at
  delivery time from the stored master — so RB3 stores ONE
  verified master per upload and creates no resized copies.
  The flow is synchronous per image (a single product photo is
  small; the batch/background variant pipeline is not needed for
  correctness and is not built here).
- **No scheduled mirror wiring** (brief-explicit): the mirror is
  endpoint-triggered only in this batch; job/sync-hook wiring
  lands with the RM10 migration tooling.
- **No new migration** — `StoredFile` (RB2) already carries every
  field this batch writes. Nothing in RM4 needed a schema
  change, so none was made.

## Gates (all re-run in this session)

| Gate | Result |
|---|---|
| New spec `rm4-product-images` | **16/16 pass** — presign type/size/local-mode refusals + org 404 + quarantine key shape; complete happy path (CDN URL, cover mirror adopted, StoredFile sha256/size, quarantine removed), no cover-steal on later uploads, sniff-mismatch and size-mismatch full cleanup (no rows, no objects), missing/foreign-org key refusals; deleteImage → registry `trashed` with the object left in place; mirror happy path + re-run no-op, cross-URL sha256 dedupe with a single upload, pre-existing registry adoption with zero uploads, fetch-failure + non-image per-item reporting with rows untouched, private-IP + http refusal with zero fetches, cover-only candidate |
| Products regression chunk (`ec3-catalog`, `ec-full`, `ec-packages`, `ec-phase2*`) | 2 suites, **38/38 pass** (incl. the RM4 suite re-run) |
| Storage + media regression chunk (`storage*`, `u6-scale`, `nextgen-media`, `social-pp2`, `social-import`, `ec-phase3`) | 6 suites, **66/66 pass** |
| `pnpm --filter @repo/api... build` | **Green** (one first attempt died with exit 137 while a Next build ran concurrently — memory contention; the solo re-run is green, and `tsc --noEmit` had already passed) |
| `pnpm --filter @repo/web build` | **Green** (exit 0) |
| Fresh-Postgres migration run | Not applicable — **no migration in this batch** (the RB2 193/193 result stands) |

All specs fake storage/Prisma/fetch/DNS at the seams — **no live
R2 bucket was touched by this batch**; the live presign→PUT→
complete round-trip joins RB1's owner-run verify step once the
R2 env + a deploy exist.

## NOT done / still owed after RB3

- **Live proof:** presigned PUT + complete + mirror against the
  real buckets (needs the owner's Dokploy env + push + Redeploy;
  the push authorization for the R2 line is recorded with the
  parent — this worker does not push).
- **Orphaned quarantine objects** from uploads where the browser
  never calls complete: they sit under `_quarantine/` until
  RM11's lifecycle sweep adds an expiry rule for that prefix.
- **Scheduled/automatic mirroring** (store-sync hooks, nightly
  job) — RM10 scope, deliberately not here.
- **Screenshot QA** of the gallery upload zone and the mirror
  button — AN10-style checklist, after deploy.
- Next batch: **RB4 (RM5)** — inbox/social/creative media onto
  StorageService per the plan.
