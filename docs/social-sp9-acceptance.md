# SP9 Acceptance — YouTube (Google OAuth + Resumable Upload, Privacy Private)

Package: Social Media Post Scheduler, Batch 5 item 2 (plan: `docs/social-posts-package-plan.md`, amendment section). Builds on SP8's shared groundwork (operator-app platform config, DB-backed OAuth state, shared refresh-aware token resolver, `SocialPost.publishNote`) and the SP5/SP7 publish spine — the platform switch in `SocialPublishService.publishToPlatform` gained the YouTube branch; no parallel scheduler exists.

## What shipped

### Connect (Google OAuth, operator app)
- **Step 1**: `GET organizations/:id/social/accounts/youtube/connect-url` (OWNER/ADMIN) → Google authorize URL. Not configured → the honest Bengali 400 ("Google app এখনো configure করা হয়নি — Platform Operator-এর সাথে যোগাযোগ করুন…"), never a broken redirect. Scopes: `youtube.upload` + `youtube.readonly`; `access_type=offline` + `prompt=consent` so a refresh token is issued — including on re-connect, where Google would otherwise withhold it.
- **Step 2**: `GET /social/oauth/youtube/callback` (public) — strictly validated single-use state (SP8 machinery), code exchange, then `GET /youtube/v3/channels?mine=true`:
  - **Exactly one channel** → Integration (provider `youtube_social`) + sealed credential { accessToken, refreshToken, expiresAt, scope, channelId } + SocialAccount { platform `youtube`, externalId = channel id, name = channel title }. Redirect `social_connected=youtube`.
  - **More than one channel** → NOTHING is created. The sealed token bundle + channel list move into a second 10-minute state (purpose `channel_pick`); the browser lands back with `?youtube_pick=<state>` and an authenticated picker finishes: `GET accounts/youtube/pick-info?state=` (org+user-bound; returns ids/titles/thumbnails only — tokens never leave the server) and `POST accounts/youtube/select-channel` (OWNER/ADMIN). An unlisted channelId is refused, the selection consumes the state, replay is refused.
  - **Zero channels** → honest error redirect (that Google account cannot upload).
  - **No refresh token in the exchange** → refused honestly at connect time ("Google refresh token দেয়নি…") instead of connecting an account that would silently die within the hour.
  - Every outcome is a 302 with `social_connected` / `social_error` — never a 500.
- **Refresh**: SP8's shared resolver gained the Google branch — refresh grant via `oauth2.googleapis.com/token`, new access token re-sealed, the ORIGINAL refresh token kept (Google does not rotate it). A failed refresh marks the account `error` + verbatim `lastError` and fails permanently, same as TikTok.

### Publish (resumable upload — bytes, not URL)
- Media gate shared with SP8: exactly one video, else permanent failure (attempts untouched) + Bengali 400 at schedule time.
- The video BYTES are read from MediaStore storage server-side (`MediaStore.get(storageKey)`) — YouTube takes a push; the SP1 public URL is not involved. **v1 size reality, stated plainly**: social media enters MediaStore through the upload endpoint, which caps a file at `SOCIAL_MEDIA_MAX_BYTES` (2.1 MB) — so v1 YouTube (and TikTok) uploads are short clips bounded by that existing cap. Raising the media cap is a separate, deliberate change (the resumable protocol below already handles arbitrary sizes).
- Protocol, followed faithfully: initiate a resumable session (metadata travels here: **title = the caption's first line, ≤100 chars; description = the full caption**) → PUT the bytes in one PUT with a correct `Content-Range` → on a mid-upload failure, **query the session status before resuming** (a zero-byte PUT with `Content-Range: bytes */total`): if YouTube reports the upload complete, that result wins without a second PUT; if it reports a `Range`, the resume PUTs only the remaining slice from that exact offset; a dead session surfaces the ORIGINAL Google error verbatim. Final failure = SP5 semantics (backoff/retry, verbatim error on the post).
- **Privacy is requested as `private` ON PURPOSE** (code comment + this doc): YouTube locks every upload from an app that hasn't passed Google's verification to private regardless of the request, so requesting private is the honest contract rather than requesting public and misreporting the outcome. The result: status `published` (the upload is real — the video is on the channel, visible in YouTube Studio), `platformUrl` = the watch URL, and `publishNote` = "YouTube-এ Private হিসেবে আপলোড হয়েছে — app যাচাই সম্পন্ন হলে Public করা যাবে। (Unverified app-এর upload YouTube নিজে Private আটকে রাখে; ভিডিওটি Channel-এ YouTube Studio-তে দেখা যাবে।)" — shown verbatim on the post card, the post detail, and next to the YouTube account card ("আপলোড YouTube-এ Private হিসেবে যায় — Google app যাচাই সম্পন্ন হলে Public করা যাবে").

### UI
- "▶️ YouTube যুক্ত করুন" button beside TikTok's (disabled with an explanation while the operator hasn't configured the Google app), the multi-channel picker card (10-minute state; channel thumbnails + titles), the YouTube private-lock note on account cards, `publishNote` display (from SP8) carrying the private-upload text, and the composer video-only hint covering YouTube as well.

## Evidence — boundary, NOT live (ceiling stated plainly)

**No real YouTube round-trip happened.** This sandbox has no Postgres binary and no real Google app; OAuth, the channel picker and the resumable protocol are proven at the client boundary with a labelled stub fetch + fake Prisma (+ a real local MediaStore for the bytes path), plus the full suite and builds:

- New spec `apps/api/src/social/social-sp9.spec.ts` — 13 tests: connect URL (not-configured 400; scopes/offline/consent + state binding), callback + picker (single channel immediate; zero channels; missing-refresh-token refusal; multi-channel park → other-user peek refused → unlisted channel refused → selection creates the chosen channel only → replay refused), resumable protocol (private privacy in the initiate body; clean PUT; failure → status query → Range-offset resume with exact Content-Range/Content-Length; status-query-complete wins with no second PUT; dead session surfaces the original verbatim error), publish dispatch (MediaStore bytes → published + watch URL + Private note + first-line title), the shared image gate, and Google refresh (re-seal, refresh token preserved).
- Final gates at this commit: **full API suite 166/166 suites, 1331/1331 tests — fully green** (the 3 `admin/m38.spec.ts` view-as failures seen mid-batch were the parallel AP track's fake gap, fixed by that track's own follow-up `8a4e064` before this commit landed); web tests 72/72; monorepo build green (all 7 packages).

## What the owner must do for the live (M30-style) proof

1. Google Cloud Console: create an OAuth client (Web), enable YouTube Data API v3, add the authorized redirect URI `https://api.qosprey.com/social/oauth/youtube/callback`.
2. Admin Panel → Settings → Dynamic Platform Config → Google App: paste Client ID + Client Secret.
3. Tenant Social Posts page → "▶️ YouTube যুক্ত করুন" → authorize → (pick the channel if several) → schedule a one-video post → confirm the video appears in YouTube Studio (as Private — expected until the app passes Google verification).

Nothing was pushed to GitHub (owner's standing rule).
