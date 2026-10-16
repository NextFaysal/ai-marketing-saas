# RB5 Acceptance — RM6 (Image Transformations + MediaImage) + RM7 (Unified Media Library)

Batch: **RB5** of the Cloudflare R2 Media Program (plan:
`Cloudflare-R2-Media-Plan-2026-10-15.md`, RM6 + RM7). Built in
the `r2-media` worktree (base `4d81a6f`, the RB4 head). **Local
commits only — NOT pushed**, per the owner's push rule and the
recorded conditional R2-line authorization (push happens once,
after RB6 + the final gate). **No new migration** — `StoredFile`
(RB2) already carries every field this batch reads or writes.

## Commits

| Commit | Content |
|---|---|
| `a4738a8` | API RM7: `MediaLibraryService` + controller (list / presign / complete / trash) wired into StorageModule |
| `2488254` | Spec: `rm7-media-library.spec.ts` (8 tests) |
| `3dc2d49` | Web RM6: `lib/cdn-image.ts` (+ 6 vitest) + shared `components/media-image.tsx` |
| `59e55d9` | Web RM6 swaps: ProductCard, product detail gallery, gallery-dialog thumbs, landing hero/gallery, creative grid preview |
| `da70477` | Web RM7: `/dashboard/media-library` page + nav entry |
| (this doc) | Acceptance |

## What was built

### RM6 — Transformations + the shared MediaImage

- `apps/web/src/lib/cdn-image.ts` — pure helpers. `isCdnImageUrl`
  matches ONLY absolute http(s) URLs whose host is the media CDN
  host (`MEDIA_CDN_BASE_URL` default `https://media.qosprey.com`,
  build-time override `NEXT_PUBLIC_MEDIA_CDN_BASE_URL`).
  `cdnImageUrl(src, w)` builds
  `{base}/cdn-cgi/image/width={w},quality=85,format=auto/{original URL}`
  for CDN srcs and returns any other src byte-for-byte unchanged;
  `cdnSrcSet(src, widths = [320, 640, 960, 1280])` returns the
  preset srcset for CDN srcs and `undefined` otherwise. Suffix
  hosts (`media.qosprey.com.evil.example`), relative paths and
  `blob:` URLs are all pinned as non-CDN by spec.
- `apps/web/src/components/media-image.tsx` — `MediaImage`:
  CDN srcs get the transformed `src` (at the given width) +
  srcset + sizes; other srcs render as a plain img. width/height
  become attributes AND an `aspect-ratio` style; `object-fit:
  cover` default (caller `style` wins); `priority` → eager,
  otherwise lazy. An error on a transformed URL falls back ONCE
  to the original src with no srcset (state flag, reset when the
  src prop changes) — a broken transform can never loop or leave
  a permanently broken image.
- **Swaps (existing behaviour — click, selection, empty-state
  fallback — unchanged in each):**
  - Storefront `ProductCard` image (640², card sizes).
  - Storefront product detail gallery: main image (1200²,
    `priority`) + thumbnail buttons (160²).
  - Dashboard product gallery dialog row thumbnails (96²).
  - Landing page hero image (`priority`, srcset) + hero
    thumbnails (160²) + "পণ্যের ছবি" gallery grid (600²).
  - Creative library grid: **no `<img>` existed there** — the
    cards were text-only. A `MediaImage` preview (640×360) was
    ADDED for image-kind assets; this is an addition, not a
    swap, recorded as such.

### RM7 — Unified media library

- **API** (`apps/api/src/storage/media-library.*`, controller in
  StorageModule — Prisma/Audit are global modules, so no import
  changes were needed):
  - `GET organizations/:organizationId/media-library`
    (TenantGuard) — `StoredFile` rows for the org with
    `status = "active"` only, newest first, in the app's
    standard list shape `{total, page, pageSize, items}`
    (pageSize default 20, cap 100). Filters: `surface` (exact),
    `kind` (`image`/`video`/`file` via contentType prefix —
    `file` = neither image nor video; an unknown kind is a
    Bengali 400), `q` (case-insensitive `contains` on the key).
    DTO: `{id, key, surface, visibility, contentType,
    sizeBytes (decimal string), width, height, createdAt, url}`
    where url = CDN URL for public rows, a 900 s presigned GET
    for private rows, and **null in local mode for both** — no
    URL is ever fabricated. The mode/URL decision reads the
    injected StorageService only, so specs pin all three
    branches through one fake seam.
  - `POST …/media-library/upload/presign` +
    `POST …/media-library/upload/complete` (write roles =
    OWNER/ADMIN/MARKETING_MANAGER) — the RB3 pattern verbatim:
    png/jpeg/webp only, ≤ 10 MB, quarantine key
    `_quarantine/{orgId}/library/{uuid}`, HEAD size check,
    magic-byte sniff must equal the declared type, sha256, copy
    to `{orgId}/library/{uuid}.{ext}`, registry register
    (surface `library`, visibility `public`), quarantine dropped;
    any failure removes the objects it created and registers
    nothing. Local mode refuses with an honest Bengali 400.
  - `DELETE …/media-library/:id` (write roles) — org-guarded
    (unknown id and another org's id are the same 404), flips
    the registry row to `trashed` via `markTrashed` and writes
    an audit entry. **The object is NOT deleted** — that is
    RM11's lifecycle job, as with every other surface.
- **Web** — `/dashboard/media-library` (+ "Media Library" nav
  entry after Creatives): grid over the API with surface chips,
  kind chips, debounced key search, and pagination. Image cards
  render through `MediaImage`; video cards use the presigned
  URL in a `<video controls>`; files without a URL show an
  honest "প্রিভিউ নেই (URL পাওয়া যায়নি)" placeholder. Each
  card shows name (key tail), surface, visibility (private
  cards note the URL lives 15 minutes), size, date, a copy-URL
  button (disabled without a URL) and a confirm-guarded trash
  button. The upload button runs the same presign → direct PUT
  → complete → refresh flow as the product gallery, with
  per-file Bengali errors.

## NOT BUILT / NOT SWAPPED (honest list)

- **Social media library grid — NOT SWAPPED.** Its thumbnails
  (`MediaThumb` in social-posts/shared.tsx, also used by the
  Composer and Posts panels) are NOT direct URLs: the asset
  bytes are fetched through the authenticated API proxy and
  rendered from `blob:` object URLs, because a plain
  `<img src="…/file">` would 401. There is no CDN-addressable
  URL for MediaImage to transform, and forcing the shared
  component into MediaImage would change the auth flow for
  three panels to gain nothing. If social assets later expose
  direct signed/CDN URLs to the dashboard, this becomes a
  one-line swap.
- **Landing page bump + upsell images — NOT SWAPPED** (small
  offer/order-form decorations, outside the card/gallery
  surfaces named for this batch). All other `<img>` sites in
  the app are likewise untouched — RM6's swap scope was the
  high-impact product surfaces only.
- **Landing hero `MediaImage` carries no width/height** on
  purpose: its className owns a responsive aspect ratio
  (`aspect-square sm:aspect-[4/3]`) and an inline aspect-ratio
  style would override the breakpoint. It still gets priority
  loading, the srcset and the error fallback.
- **Plan-RM7's richer library features — NOT BUILT:** per-file
  usage info ("used in N products"), orphan marking, and
  folder/tag organisation (the plan suggested reusing SU3's
  system). This batch's brief scoped RM7 to the registry union
  list + filters + general upload + trash + page; those extras
  need their own design pass and were not smuggled in.
- **Transformations are not live-proven.** The `/cdn-cgi/image/`
  URLs only work once the owner enables Image Transformations
  on the `media.qosprey.com` zone (plan §6 checklist). Until
  then a transformed URL would error in the browser — and
  MediaImage's one-time fallback to the original src is exactly
  the safety net for that window. Verifying real transformed
  bytes belongs to the RM0 live checklist after deploy.
- **No live R2 proof** (unchanged from RB2–RB4): every storage
  seam in the specs is a fake. The live round-trip joins the
  RB1 verify step after the push + the owner's Dokploy
  Redeploy.

## Gates (all run in this worktree, sequentially — no concurrent builds)

| Gate | Result |
|---|---|
| New API spec `rm7-media-library` | **8/8 pass** — org+active-only list, newest-first, pagination; surface/kind/q filters + invalid-kind 400; DTO URL rules (public→CDN, private→presigned, local→null), sizeBytes as string; presign refusals (type/size/local) + quarantine key shape; complete happy path (register surface=library + sha256, quarantine dropped, final object present), sniff-mismatch and size-mismatch full cleanup, foreign-org key refusal; trash org-guard 404s + list exclusion |
| Regression chunk (`src/storage` all + `rm4-product-images`) | **6 suites / 76 tests pass** |
| Web vitest (all) | **55 files / 446 tests pass** (RB4 was 54/440; +1 file, +6 tests = `cdn-image`) |
| API build (`pnpm --filter @repo/api... build`) | **Green** |
| Web build (`pnpm --filter @repo/web build`) | **Green** (exit 0) |
| Boot smoke (compiled app, dummy DATABASE_URL) | **1,346 routes mapped** (RB4's 1,342 + the 4 new media-library routes), DI fully resolved, zero dependency errors; process stopped only at the deliberately unreachable database |
| Fresh-Postgres migration run | Not applicable — **no migration in this batch** |

One environment note: the sandbox `/tmp` (512 MB tmpfs) was at
95% mid-batch from accumulated jest caches; the stale jest cache
was cleared (other tracks' scratch left untouched) — no test
result was affected.

## Deploy notes (owner-side, unchanged from RB1–RB4)

No env contract changes. RM6 goes fully live when (a) this line
is pushed on the owner's instruction and redeployed, and (b)
Image Transformations are enabled on the media zone — until
(b), MediaImage degrades to the original URLs by design.
Next batch: **RB6 (RM9 + RM10 + RM11 + RM12)** — the package's
final batch.
