# SP6 Acceptance — Meta Page + Instagram Publishing Adapters

SP6 replaces SP5's `publishToPlatform` stub with the real dispatch:
`SocialPublishService.publishToPlatform` resolves the post's account,
sealed PAGE token and media assets, then hands off to the new
`MetaSocialPublisher` (`apps/api/src/social/meta-publisher.ts`), a pure
Graph-API adapter built on the shared `graphPost`/`graphGet` helpers.
SP5's claim/retry/backoff/notification behaviour is unchanged — there is
still exactly one publish path (`attemptPublish`).

## Coverage by platform and post shape

| Platform | Shape | How it publishes | Status |
|---|---|---|---|
| Facebook Page | Text only (0 media) | `POST /{pageId}/feed` `{message, link?}` | ✅ Covered |
| Facebook Page | 1 image | `POST /{pageId}/photos` `{url, caption}` | ✅ Covered |
| Facebook Page | 2+ images | Each photo `POST /{pageId}/photos` `{url, published:"false"}`, then one `POST /{pageId}/feed` `{message, attached_media[i] = {"media_fbid": …}}` | ✅ Covered |
| Facebook Page | Exactly 1 video | `POST /{pageId}/videos` `{file_url, description}` | ✅ Covered |
| Facebook Page | Video + any other media | — | ⛔ Permanent error (Bengali): videos cannot be combined with other media in one Page post; publish images together or the video alone |
| Instagram | 1 image | Container `POST /{igId}/media` `{image_url, caption}` → poll `status_code` → `POST /{igId}/media_publish` | ✅ Covered |
| Instagram | 1 video | Container `{video_url, caption, media_type:"REELS"}` → poll → publish | ✅ Covered (Reels) |
| Instagram | 0 media (text only) | — | ⛔ Permanent error (Bengali): Instagram has no text-only posts |
| Instagram | 2+ media | — | ⛔ Permanent error (Bengali): **Carousel is NOT in this version** — one media per post, the rest as separate posts |

Meta's own errors propagate **verbatim** everywhere (the Graph helpers
throw `MetaGraphError` with Meta's message; nothing wraps them). A Meta
response with no id is an honest plain `Error` — never a claimed publish.

## platformUrl construction

- **Page:** `https://www.facebook.com/{id}` where `{id}` is, for a single
  photo, the `post_id` Meta returns (the composite page_post id of the
  feed post the photo created; falls back to the photo's own `id` only
  when `post_id` is absent), and for feed/multi-photo/video posts the id
  of the created post/video.
- **Instagram:** the media's **real `permalink`** fetched after publish —
  or `null` when that fetch fails or returns none. A permalink failure is
  NOT a publish failure, and a URL is never fabricated for Instagram.

## Auto public-link decision

Meta fetches media by URL, so every published asset needs its SP1 public
link (`/public/media/<token>`). If an asset has no `publicToken` when a
post using it is published, the service mints one via
`SocialService.createPublicLink` (idempotent) and stores it on the asset
row; an existing token is reused untouched (spec-proven: no write occurs).
Rationale: the tenant chose to publish this exact asset, and the public
link is the SP1 mechanism built for exactly this purpose; it remains
revocable from the media library afterwards. The absolute URL is built as
`${API_PUBLIC_URL ?? "http://localhost:4000"}/public/media/<token>`
(the payments.service convention).

## SVG gate

Template Posters (SP4) are SVG, and Meta/Instagram need raster PNG/JPEG.
The tree has **no rasterizer** (no sharp / resvg / jimp / canvas —
verified by coordinator grep), and SP6 adds no dependency. So any asset
whose `contentType` includes `svg` fails the post **permanently**, before
any platform call and before any public token is minted for it, with
attempts untouched and this exact message:

> এই ছবি SVG ফরম্যাটে — Facebook/Instagram-এ প্রকাশের জন্য PNG/JPEG ছবি লাগবে; Template Poster থেকে PNG আসা পর্যন্ত অন্য ছবি ব্যবহার করুন

The gate lifts the day a rasterizer lands and posters can be exported as
PNG — until then the failure is honest instead of a silent platform-side
rejection.

## Token-dead handling

When the dispatch throws an error matching Meta's token-dead shapes
(`error validating access token`, `invalid oauth`, `oauthException`,
`session has expired`, or HTTP 401 — `isTokenDeadError`), the service
marks the account `status: "error"` with `lastError` = Meta's verbatim
message (the state SP1's account list already surfaces), then **rethrows
the original error**: the post follows SP5's normal retry path rather
than failing permanently on the spot. A fresh connect (SP1) revives the
account to `connected`. Only the dispatch is wrapped — resolution errors
(steps before dispatch) pass through untouched.

## Instagram polling bounds

Container processing is polled at `status_code` up to **10 times, ~3 s
apart** (defaults; injectable for tests). `ERROR` fails with Meta's
verbatim status text, `EXPIRED` fails with a retry message, and running
out of polls throws a deliberately **transient** error (processing may
just be slow) so SP5's backoff retry handles it.

## Idempotency

Unchanged from SP5: claiming is a status-conditioned
`updateMany (draft|scheduled → publishing)`, so a second publish call on
a publishing/published post is refused by the state machine (409) and
can never double-publish through this path.

## Evidence ceiling — read this plainly

**No real publish was, or could be, performed in this sandbox.** There
is no Meta app, no Page token, and no Postgres here. Everything above is
proven at the **client boundary only**: `social-sp6.spec.ts` (20 tests)
injects a stub `fetch` into the real `graphPost`/`graphGet` helpers and
asserts request shapes (paths, params, decrypted PAGE token), response
handling, gates, and state transitions against an in-memory Prisma fake
with credentials sealed by the real `encryptJson`. The live proof — a
real post appearing on a real Page / Instagram account — belongs to the
**M30 sprint with the owner's own Page**, exactly like SP1–SP5's live
ceilings.

## Verification (this run)

- `social-sp6.spec.ts`: **20/20 pass** (Page text/link/photo/multi-photo/
  video/mixed, IG photo/Reels/permalink-failure/container-ERROR/zero/
  multi, SVG gate, token-dead, disconnected, missing credential,
  cross-org, `isTokenDeadError` units).
- Social specs overall: 105/106 — the single failure is SP5's
  *"the SP5 stub adapter error is an ordinary failed attempt"* test,
  which asserts the stub's exact error string; it is obsolete **by
  design** now that SP6 replaced the stub, and `social-sp5.spec.ts` was
  outside SP6's permitted file list, so it was left untouched for the
  coordinator to retire/update.
- Full API suite: **1249 pass / 1250, 158/159 suites** (same single
  obsolete SP5 stub test).
- `tsc -p tsconfig.build.json --noEmit`: **green**.
- The `PermanentPublishError` instanceof discipline across the
  meta-publisher ↔ social-publish.service circular import is exercised
  by every permanent-failure spec (attempts stay 0 only if it holds) —
  no restructuring was needed.
