# PP2 — Large Video (TikTok/YouTube usable) — Acceptance

**Status:** delivered (local commit; see repo log). Batch 2 of the Social Posts Completion Package (docs/social-posts-completion-plan.md).

## The problem
Social media entered MediaStore only through a base64-JSON upload capped at `SOCIAL_MEDIA_MAX_BYTES` = 2.1 MB (and the API's 3 MB JSON body limit sits right above it). Real TikTok/YouTube clips could never be uploaded, so SP8/SP9 publishing was limited to tiny clips. Every media read also buffered whole files in memory.

## What the audit found (before building)
- Upload: `POST organizations/:id/social/media` with a `dataBase64` DTO — the whole file was decoded into a Buffer in memory; the cap was enforced on that buffer. No multer anywhere (and `multer` is not resolvable from apps/api under pnpm), so FileInterceptor/diskStorage would have meant a new dependency.
- Storage: `MediaStore` (apps/api/src/inbox/media-store.ts) — S3 (SigV4, hand-signed) or local disk; only Buffer-shaped `put`/`get`.
- YouTube (SP9): the publish path read the whole video via `store.get()` and `YouTubePublisher.upload` PUT it as one Buffer — buffered twice.
- Both file routes (authenticated `media/:id/file`, public `public/media/:token`) returned `StreamableFile(Buffer)` — whole file in memory per request.
- TikTok PULL_FROM_URL is URL-based by design — fine once the public route streams.

## What shipped
1. **Separate video cap, config-driven.** `SOCIAL_VIDEO_MAX_BYTES` env (bytes), default 268,435,456 (256 MB), read at call time (`socialVideoMaxBytes()`). Images keep the existing 2.1 MB cap (the PP3 URL import keeps using it too — unchanged).
2. **Streamed upload — `POST organizations/:id/social/media/upload-file`.** The composer posts the raw File as the request body (Content-Type = the file's type, `fileName` as a query param); no body parser claims that content type, so the controller hands the live request stream to `SocialService.uploadMediaStream`:
   - the stream is piped into a temp file while bytes are counted — the whole file is never in memory;
   - the first bytes are sniffed mid-stream with the existing `detectMediaKind` (magic bytes decide; the declared type only breaks container ties, as before) and the SNIFFED kind picks the cap: images tighten the cap to 2.1 MB, videos keep the video cap, unrecognized content is treated conservatively at the image cap and refused after the stream if the final sniff fails;
   - crossing the applicable cap aborts the stream immediately;
   - only a complete temp file is streamed into MediaStore (`putStream`) and the asset row created; a failed row-create deletes the just-stored object; the temp file is removed on every path — an aborted/invalid upload leaves no asset row, no stored file, no temp file (spec-asserted);
   - the base64 endpoint stays for small files; its over-cap message now points at the file upload.
3. **MediaStore streaming surface** (additive — existing Buffer API untouched): `putStream` (local: pipeline to disk; S3: streamed PUT with SigV4 UNSIGNED-PAYLOAD), `size` (stat / S3 HEAD), `readRange` (positioned file read / S3 Range GET — bounded bytes in memory), `getStream` (fs read stream over a range / S3 Range GET with an in-process slice fallback if a store ignores Range), `delete` (best-effort cleanup).
4. **YouTube no longer buffers.** `YouTubePublisher.uploadFromSource` takes a `YouTubeByteSource` (size + bounded `readRange`) and sends 8 MiB chunks (a multiple of YouTube's 256 KiB granularity) with exact `Content-Range`s. SP9's discipline is preserved: on a mid-upload failure the session is QUERIED before resuming, and the resume continues at the offset YouTube reports. `upload({bytes})` remains as a thin Buffer-backed wrapper (SP9 specs untouched). `SocialPublishService`'s YouTube branch now builds the source from `MediaStore.size`/`readRange` — one chunk in memory at a time.
5. **File routes stream with Range support.** Both `GET media/:id/file` (authenticated) and `GET public/media/:token` now serve `SocialService.getMediaFileStream`/`resolvePublicMediaStream`: a single-range `Range: bytes=...` request (open-ended, suffix, clamped) gets 206 + `Content-Range`; no/invalid/multi-range gets the full 200 stream; `Accept-Ranges: bytes` is always sent. TikTok/Meta pull from the public route — large videos now stream out instead of buffering.
6. **Web.** The composer picker uploads via the streamed endpoint (direct fetch with the File as body — apiFetch is JSON-only) and shows the caps under the picker: "ছবি সর্বোচ্চ ২.১ MB · ভিডিও সর্বোচ্চ ২৫৬ MB", rendered from `GET organizations/:id/social/media/limits` (the API's live values, so an operator's env change shows verbatim; falls back to the defaults if the call fails).

## Evidence (boundary — stated plainly)
- New specs `apps/api/src/social/social-pp2.spec.ts` (11 tests): >2.1 MB synthetic-MP4 upload succeeds end-to-end on the REAL local MediaStore; over-image-cap image refused with no row/file/temp left; over-video-cap (env-lowered) video aborts mid-stream leaving nothing; an MP4 renamed `.jpg` is sniffed as video and takes the video path; non-media refused; MediaStore stream primitives round-trip + range slices; `parseSingleRange` matrix; service-level range serving for both the authenticated and public paths; YouTube chunk PUTs with exact Content-Range headers over a >16 MiB source (no read larger than one chunk) and the query-then-resume sequence at YouTube's reported offset.
- Full API suite: 170 suites / 1406 tests, ALL PASS on the final tree (the run includes the parallel Scale track's just-landed work). Mid-batch, `src/inbox/phase-f.spec.ts` briefly failed while that track's RFM refactor was in flight; its own follow-up fixed its harness and the final tree is fully green — no PP2 file touches that path.
- Web tests: 72/72 pass (8 files). Monorepo build: green, 7/7 packages.
- NOT proven (sandbox ceiling, same as the rest of the package): no live large upload over the network, no real S3 round-trip (the S3 streaming code is written against the existing hand-signed fetch path and is code-reviewed only), no live YouTube/TikTok transfer. No Postgres in the sandbox — specs + suite + build are the evidence, per package discipline.
- No migration. Nothing pushed to GitHub.

## Known limits / notes
- A huge IMAGE streams to the temp file only until the head sniff (16 bytes) tightens its cap — it is aborted at the 2.1 MB crossing like everything else; disk, never memory.
- Multi-range requests are not supported (full body is served instead) — documented simplification in `parseSingleRange`.
- The base64 upload remains capped at 2.1 MB by design (JSON body limit); the composer no longer uses it for picked files.
