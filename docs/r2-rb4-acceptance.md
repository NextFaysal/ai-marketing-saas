# RB4 Acceptance — RM5 (existing surfaces onto CDN/presign) + RM8 (Creative upload + Campaign variant)

Batch: **RB4** of the Cloudflare R2 Media Program (plan:
`Cloudflare-R2-Media-Plan-2026-10-15.md`, RM5 + RM8). Built in the
`r2-media` worktree (base `28a67e7`, the RB3 head). **Local
commits only — NOT pushed.** No new migration. No existing
endpoint's behaviour changed; frozen serializer shapes unchanged
(only the `publicUrl` VALUE changes, relative → absolute, in S3
mode).

## Commits

| Commit | Content |
|---|---|
| `d31c7de` | Core: `PublicMediaService` (ensure-public-copy + CDN resolution) + `publicMediaServingEnabled` / `storedAssetPublicUrl` helpers + spec (17) |
| `5a2a77c` | Social: CDN `publicUrl` in all 5 serializers, ensure-copy at link mint + publish, module wiring |
| `04f877d` | Branding API: hash-versioned CDN logos, legacy-route 302 grace, remove→trash hook + spec (9) |
| `ff6b62e` | Web: `mediaSrc` helper at all 6 logo sites + inbox signed-URL-first MediaView |
| `4d7706d` | Creatives: presign/complete direct upload beside by-URL + spec (10) |
| `f049f8f` | Campaigns: variant `imageUrl` prefers CDN + spec (5) |
| (this doc) | Acceptance |

## What was built

### RM5-1 + RM5-4 — Social public media & video delivery (one helper)

- `apps/api/src/storage/public-media.service.ts` —
  `PublicMediaService.resolvePublicMediaUrl(asset, surface)` is
  the ONE async resolution path. Local mode → `null` (callers
  fall back; a CDN URL is never fabricated). S3 mode → HEAD the
  public bucket; copy private→public only when missing; re-HEAD
  (still missing → `null`, never a URL that would 404); register
  the object in StoredFile (surface passed by the caller; the
  social callers pass `"social"`) best-effort — a registry
  failure never blocks resolution.
- `storedAssetPublicUrl(row)` in `media-url.ts` is the
  synchronous serializer twin: no token → `null`; S3 mode +
  storageKey → CDN URL; otherwise the SP1 relative
  `/public/media/{token}`. Its mode check
  (`publicMediaServingEnabled`) replicates StorageService's env
  rule exactly and is pinned against it by spec.
- All five `serializeAsset` copies (social, social-image,
  social-import, social-media-library, social-raster) use it.
- `SocialService.createPublicLink` ensures the bytes are public
  on BOTH paths — fresh mint and pre-existing token — so tokens
  minted before R2 heal the first time the link is re-requested.
- `SocialPublishService.publicUrlForAsset` prefers the CDN URL
  for image AND video publish/delivery (Range is served by
  Cloudflare/R2 on that path) and falls back to the API-stream
  URL on helper null. The `/public/media/:token` route
  (PublicMediaController, streamed bytes + Range) is untouched
  and remains the fallback.
- Known edge, stated plainly: a pre-RB4 token whose bytes were
  never copied, read ONLY through a serializer (never re-minted,
  never published), yields a CDN URL before its bytes are in the
  public bucket. Both heal paths (re-mint, publish) ensure the
  copy; the web UI never renders via `publicUrl` (it uses the
  authenticated file route), so the exposure is API consumers
  of the field between deploy and first heal.

### RM5-2 — Logos

- S3 mode: `uploadLogo` PUTs to the public bucket under
  `branding/{orgId}/logo-{sha256:8}.{ext}` (a replaced logo is a
  NEW object — no stale-CDN risk) and stores the absolute CDN
  URL in `Organization.logoUrl`, with a StoredFile register
  (surface `branding`). Local mode: the M59 fixed-key +
  relative-path behaviour is byte-for-byte unchanged (spec-pinned).
- `GET /public/branding/:organizationId/logo` stays for one
  release: CDN-era rows get a **302 redirect** to the stored
  URL; legacy relative rows stream bytes as before.
  `publicLogo` can also read the versioned key from the public
  bucket; `removeLogo` best-effort `markTrashed`s the registry
  row (object deletion remains RM11's job).
- Web: `apps/web/src/lib/media-src.ts` — absolute http(s) URLs
  pass through untouched, relative paths get the API base —
  applied at all six `${API_URL}${…logoUrl}` render sites
  (dashboard layout ×2, settings, public report / review /
  tracking pages), so CDN URLs can no longer double-prefix.

### RM5-3 — Inbox private serving (minimal, as briefed)

- API: **NOT CHANGED** — the existing `media-url` endpoint
  already returns a MediaStore presigned URL (900 s) in S3 mode
  and `url: null` in local mode.
- Web: `MediaView` (inbox-extras) now asks that endpoint first
  and uses the presigned URL directly when one comes back; on
  `url: null` or any failure it runs today's authenticated
  byte-proxy flow unchanged. So in S3 mode inbox media no longer
  streams through the API; in local mode nothing changed.
- Webchat visitor media: **NOT CHANGED** — its route is guarded
  by the visitor's session token, which is the per-request
  authorization AND conversation-binding boundary; handing the
  browser a presigned URL would outlive and outscope that
  check. Left for a deliberate future decision, not a refactor
  side-effect.

### RM8-5 — Creative Library file upload

- New `POST organizations/:organizationId/creatives/upload/presign`
  and `/upload/complete` (same roles as the by-URL endpoint),
  following the RB3 pattern without generalizing it: the
  `creative_library` flag is checked at both steps; quarantine
  key `_quarantine/{orgId}/creative/{uuid}`; HEAD size check;
  magic-byte sniff (declared type must match; container formats
  resolve by the declared tie-break inside the sniff); copy to
  `{orgId}/creative/{uuid}.{ext}` in the public bucket; then the
  asset is created through the EXISTING `upload()` with
  `sourceUrl = publicMediaUrl(finalKey)`, so Meta ingests from
  the CDN and flag/audit/status semantics are the old path's.
  StoredFile register (surface `creative`,
  `sourceRef = creative:{assetId}`) after the row exists,
  best-effort. Failures before the row exists remove the
  objects they created — no partial state.
- Caps: images 10 MB (png/jpeg/webp); video 50 MB
  (mp4/quicktime/webm). The video cap exists because complete()
  reads the landed bytes once for sniff + sha256 (the RB3
  pattern); larger videos stay on the by-URL path, which is
  untouched. Local mode: honest Bengali 400, no fabricated URL.

### RM8-6 — Campaign variant

- `createAdVariant`'s MediaAsset branch: the existing
  `publicToken` refusal still fires FIRST (the token remains the
  tenant's deliberate public-exposure gate — the helper is never
  consulted for tokenless assets, spec-pinned). With a token,
  the helper's CDN URL wins when it resolves; on null the CN5
  behaviour (API_PUBLIC_URL requirement + its refusal + the
  token URL) stands exactly.

## NOT BUILT / NOT CHANGED (honest list)

- **RM8-7 competitor ad image mirror — NOT BUILT.** Evidence
  from the code, not effort: `CompetitorAd` stores NO image URL.
  The only media-ish field is `snapshotUrl`, which is Meta's
  `ad_snapshot_url` — an HTML snapshot *page*, not image bytes —
  and the Ad Library client's requested fields do not include
  creative image URLs at all (they exist, if anywhere,
  unextracted inside the verbatim `raw` payload). Mirroring
  would mean fetching HTML as if it were media or mining an
  undocumented payload shape; per the brief's own escape hatch
  this item is recorded NOT BUILT rather than left partial. A
  future item could extend the client's field list first, then
  mirror — that is a scanner change, not a storage change.
- **Browser-multipart / upload-path rewrite for social video —
  NOT BUILT** (explicitly out of scope in the brief; the
  server-side putStream upload is unchanged; only the DELIVERY
  URL moved to the CDN).
- Webchat media — NOT CHANGED (reason above).
- Inbox API — NOT CHANGED (endpoint already correct).
- StoredFile has no `competitor` surface and none was invented;
  no quota enforcement was added (values remain the owner's).
- **No live R2 proof.** Every storage seam in the specs is a
  fake, exactly like RB2/RB3. The live round-trip (real buckets,
  real copy, real presigned PUT) is still owed after the push +
  the owner's Dokploy Redeploy, alongside the RB1 verify script.

## Gates (all run in this worktree, chunked)

| Gate | Result |
|---|---|
| New spec: storage `rb4-public-media` | 17/17 |
| New spec: organizations `rb4-branding` (+ m59 regression) | 18/18 |
| New spec: creatives `rb4-creatives` | 10/10 |
| New spec: campaigns `rb4-campaign-variant` (+ cn5 regression) | 19/19 |
| Social chunk (`src/social`) | 26 suites / 464 tests green* |
| Inbox + storage chunk | 58 suites / 616 tests green |
| Organizations + campaigns chunk | 39 suites / 289 tests green |
| Products chunk (media-url consumer regression) | 7 suites / 62 tests green |
| Web vitest (all) | 54 files / 440 tests green |
| API build (`pnpm --filter api build`) | green (exit 0) |
| Web build (`pnpm --filter web build`) | green |
| Boot smoke (compiled app, dummy DATABASE_URL) | DI fully resolved — 1,342 routes mapped incl. both new creative endpoints, 0 dependency errors; process stopped only at the deliberately unreachable database |

\* The social chunk's first run showed 2 failures in
`social-pp2.spec.ts` — both `ENOSPC` writes: the sandbox's
512 MB `/tmp` tmpfs was 100% full of stale media-test dirs from
earlier suites. After removing the stale scratch the spec
passes 11/11. Environment, not code — recorded here so the
number is never quoted without its context.

## Deploy notes (owner-side, unchanged from RB1–RB3)

Nothing in this batch changes the env contract. The surfaces go
live with the already-documented Dokploy env (both bucket vars
+ the single credential pair) once the whole R2 line is pushed
on the owner's instruction and redeployed. Until then every new
path sits behind the storage-mode check and production behaves
exactly as before.
