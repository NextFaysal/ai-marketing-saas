# FB1 Acceptance — NF1 Live Commerce + NF2 Short Video Studio

**Batch:** New Features Frontier FB1 (NF package approved in full by the owner 2026-10-17)
**Worktree/branch:** `~/workspace/ai-marketing-saas-nf`, `new-frontier` · **Base:** `05b86e0c` (Smart AI line, SA-B2 code-complete, 224 migrations)
**Local commits only — nothing pushed.** Migration claim used: `20261028000000` + `20261029000000`.

## Per-item record

| # | Commit | Item |
|---|---|---|
| 1 | `0822fee0` | Step-0 spikes: `docs/nf1-meta-live-spike.md` + `docs/nf2-video-provider-spike.md` |
| 2 | `50d4d720` | NF1 data model + migration `20261028000000_nf_live_commerce` (LiveSession, LiveSessionProduct, LiveComment, LiveSessionOrder — no columns added to Order) |
| 3 | `11c22133` | NF1 API module `apps/api/src/live-commerce/` + specs (detail: `docs/nf1-fb1-part-a-acceptance.md`) |
| 4 | `443fa01c` | Dockerfile: `ffmpeg` added to the runtime image apt line (takes effect on the owner's Dokploy redeploy) |
| 5 | `f9b2cacd` | NF2 VideoProject model + migration `20261029000000_nf_video_projects` |
| 6 | `7e591beb` | NF2 provider port + ffmpeg template renderer + `video_render_sweep` job |
| 7 | `e652ad2e` | NF2 API + publish via existing `SocialService.createPost` (detail: `docs/nf2-fb1-part-b-acceptance.md`) |
| 8 | `75481f88` | NF1 web UI — `/dashboard/live-commerce` (sessions, cockpit, comment→order, recap, follow-up) |
| 9 | `30fcf565` | NF2 web UI — `/dashboard/video-studio` (create, preview, publish) + nav entries for both pages |
| 10 | `b6dcc457` | Boot-smoke fix: `@Optional()` on three injectable constructor params (see "Boot smoke" below) |

## Step-0 evidence (NF1)

Official Meta docs fetched by the coordinator (summarised in `docs/nf1-meta-live-spike.md`, not copied):

- Streaming guide — https://developers.facebook.com/docs/live-video-api/guides/streaming/?locale=en_US — Page broadcast creation `POST /{page-id}/live_videos?status=LIVE_NOW`, Page access token, `pages_read_engagement` + `pages_manage_posts`; response `{id, stream_url, secure_stream_url}`.
- Interacting with viewers — https://developers.facebook.com/documentation/live-video-api/interact-with-viewers — comments polling `GET /{live-video-id}/comments` → `{data:[{id, created_time, from:{id,name}, message}], paging:{cursors}}`; SSE alternative on `streaming-graph.facebook.com` (not used in v1).
- Comments edge reference — https://developers.facebook.com/docs/graph-api/reference/live-video/comments/ — params `filter`, `live_filter`, `order`, `since`; `summary.total_count`; errors 100/190/200.
- Getting started — https://developers.facebook.com/docs/live-video-api/getting-started/?locale=en_US — `publish_video`, App Review required.

**Proved:** the comments-polling request/response shape and fields, the live_videos creation shape, the permission names. **Not proved:** any live call (none was ever made — needs the owner's real Page, token, and App Review). Consequence, as built: a `LiveCommentsProvider` port; the Meta implementation uses only the evidenced shape; sessions without a usable connected account run in **manual mode, labelled `mode:"manual"` + `providerStatus:"unavailable"` + a Bengali reason in every API response and in the UI** — no Meta data is ever fabricated. Broadcast creation is NOT called in v1 (staff supplies the live video id).

## Step-0 evidence (NF2)

Owner decision D3 (paid AI video provider) is not taken → provider port with v1 = local ffmpeg template rendering (product images → 1080×1920 mp4, Ken Burns slides, name/price band). ffmpeg 8.1.2 verified present on the dev machine; it was **absent from the production runtime image** — commit `443fa01c` adds it to the root Dockerfile runtime apt line. If the binary is absent at runtime the render fails honestly with the labelled Bengali error and creates no asset (spec-proven with an injected bogus binary path).

## Gates (run serially, recorded as they finished)

| Gate | Result |
|---|---|
| NF1 targeted jest `live-commerce.spec.ts` | **16/16 PASS** (org isolation on every endpoint, comment→order exactly-once with createManual call-count = 1, recap counts attributed orders only, provider-unavailable honesty, now-showing exclusivity, follow-up matched/unmatched) |
| NF2 targeted jest `video-studio.spec.ts` | **12/12 PASS** — real ffmpeg render; the STORED mp4 probed with ffprobe (1080×1920, h264, ~6s for 2 images); corrupt-source and missing-binary failures create no asset; render + publish idempotency; org isolation. Re-run after the boot fix: **12/12 PASS** |
| Regression (Part B): automation suites | 24/24 PASS |
| Regression (Part B): social-import suites | 82/82 PASS |
| Regression (Part C): web lib specs (live-commerce 13 + video-studio 11 + nav-commerce 6) | 30/30 PASS |
| API typecheck (`tsc --noEmit`) + API build | PASS (workers, per item) · coordinator rebuild after boot fix PASS |
| Web full vitest | **112 files / 935 tests PASS** |
| Web build | PASS — routes `/dashboard/live-commerce` and `/dashboard/video-studio` present in the build output |
| Fresh-PG (throwaway local PG16 + pgvector, empty DB, `prisma migrate deploy`) | **226/226 migrations applied, 0 unfinished** (224 base + `20261028000000` + `20261029000000`); new tables verified present: LiveSession, LiveSessionProduct, LiveComment, LiveSessionOrder, VideoProject |
| Social folder jest (regression for the two base-bug fixes) | Run 1: 665/666 (one intermittent failure, test not identified — output not captured); runs 2 and 3: **36/36 suites, 666/666 PASS**. Recorded as a known intermittent with root cause open, not silently dropped. |
| **Boot smoke** (API dist booted against the fresh-PG DB) | See below — found 3 real DI bugs, fixed, then **API boots, `GET /health` → `{status:"ok"}`, both new route sets RouterExplorer-mapped** |

## Boot smoke — the gate that earned its keep

No previous batch ever instantiated the real Nest module graph (jest uses hand-wired providers; tsc/build/fresh-PG never boot the app). The first boot attempt failed: `Nest can't resolve dependencies of the FfmpegTemplateVideoProvider (?)` — an undecorated `string` constructor param. Fixing it surfaced the identical latent bug in **`TelegramClient` and `ThreadsClient`** — pre-existing base code, untouched since SN6 (`git diff` vs base: the social tree differs only by Part B's +12-line guarded-fetch wrapper). The interim release containing SN was never recorded as redeployed, so this may never have booted in production either. All three got the one-line `@Optional()` fix in commit `b6dcc457` (specs construct these classes directly, so behaviour is unchanged; social 666/666 + video-studio 12/12 re-verified after). **The same fix is owed to every other line that carries SocialModule (main / sai / ou / org) when they next integrate — FB1's tree contains it; the others do not yet.**

## Honest limitations inside what shipped

- **Follow-up segment precision:** the Messaging saved-audience vocabulary has no id-list condition, so the created audience's definition is empty-condition (which by that vocabulary's own rules matches the whole customer entity). The matched customer IDs ride the API response + audit metadata, unmatched commenters are reported as `unmatchedCount`, and the response carries a Bengali `note` saying exactly this. No evaluator was forked.
- **Video is silent, template-only.** Bengali drawtext shaping can be limited (system Noto fonts). Nothing is labelled "AI-generated" anywhere.
- **Product link on publish** follows the existing MS5 rule: `${webBaseUrl}/checkout/${slug}` only when the product has a slug; slug-less products publish without a link. No URL is ever fabricated.
- **`video_render_sweep` is registered but not enabled for any org** — per-org job enablement is the owner's, as with every other sweep.
- **Publish** creates the post through the existing Social engine only; the platform publish itself remains that engine's own flow.

## NOT BUILT

- External AI image-to-video provider — awaits owner decision D3 (named candidates and per-video cost still owed to the owner).
- Any Meta live capability beyond the evidenced comments-polling shape: broadcast creation/start from the hub, reactions, SSE streaming, viewer counts — not evidenced as usable without the owner's app review + real Page.
- Live proof of EVERYTHING in FB1: no Meta call has ever been made, no migration has run on a real database, production ffmpeg arrives only with the owner's Dokploy redeploy of an image containing commit `443fa01c`. **Nothing in FB1 is live-proven** (M30-style verification owed, owner's real accounts).
- The `@Optional` boot fix on the other worktree lines (see above).
- Full API jest suite was not run as a single gate (brief gates = targeted suites + regressions, all recorded above).

## Owner decisions / actions still owed

1. **D3** — external AI video provider + per-video cost (blocks only the AI-provider upgrade; the ffmpeg template path works without it).
2. Meta App Review + a real Facebook Page session for the NF1 live checklist (M30-style).
3. Push instruction for this line (union release with the other lines) + manual Dokploy Redeploy (which also activates production ffmpeg).
4. Per-org enable of `video_render_sweep` after deploy, if wanted (create also triggers a render attempt directly, so the studio works without the sweep).
