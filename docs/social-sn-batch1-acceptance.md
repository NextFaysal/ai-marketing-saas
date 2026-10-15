# Social Posts Next — Batch N1 (SN1 + SN2) Acceptance

তারিখ: 2026-10-15 · Worktree `~/workspace/ai-marketing-saas-sn`, branch `social-next`, base GitHub main `49dac3e` · **Local commits only — push হয়নি।**

## Commit তালিকা

| Commit | বিষয় |
|---|---|
| `8e96e60` | docs: SN plan copy (`docs/social-posts-next-plan.md`) |
| `1bdb1e0` | SN1+SN2 schema + migration `20261015100000_sn1_sn2_publishing_client` |
| `cc3ae38` | SN1 API: YouTube playlists + playlistItems, YouTube/LinkedIn first comment, TikTok photo (audit gate) |
| `b3571c6` | docs: FB video cover spike — verdict BUILD (`docs/social-sn1-fb-cover-spike.md`) |
| `f0dfeb9` | SN1 API: FB video cover via post-publish thumbnails edge |
| `5430769` | SN2 API: share links + public review + publish gate + timeline |
| `3b56e9d` | SN1 web: composer playlist select (+ FB cover section label) |
| `cad46e2` | SN2 web: share section + settings toggle + public `/share/social/[token]` page |

## SN1 — Publishing gaps

- **FB video cover: BUILT** (spike verdict BUILD, `docs/social-sn1-fb-cover-spike.md`)। SU8-এর বাধা ছিল creation-time `thumb` + `file_url`-এর documented সংযোগ না থাকা — সেটা আজও নেই এবং ওই পথে কিছু পাঠানো হয়নি। বাস্তবায়ন publish-পরবর্তী documented edge দিয়ে: `POST /{video_id}/thumbnails`-এ multipart `source` + `is_preferred=true` (নতুন `graphPostMultipart` helper `common/meta-graph.ts`-এ; `MetaPublisher.setVideoThumbnail`)। শর্ত: শুধু meta_page + ঠিক ১টি video asset + coverAssetId থাকলে; SU8 YouTube semantics হুবহু — ব্যর্থ হলে পোস্ট published-ই থাকে, `publishNote`-এ verbatim error; cover 10 MB-এর বেশি হলে attempt-ই হয় না; cover asset image না হলে attempt নয়, note-এ সৎ কারণ। সফল/ব্যর্থ audit: `social.fb_video_cover_set` / `social.fb_video_cover_failed`। Composer-এ cover বাছাই আগে থেকেই ছিল (SU3/SU8); সেকশনের লেখা হালনাগাদ করে FB video cover-ও যে ওখান থেকে হয় তা স্পষ্ট করা হয়েছে।
- **YouTube playlist**: `SocialPost.youtubePlaylistId`; endpoint `GET accounts/:id/youtube/playlists` (non-YouTube-তে সৎ বাংলা 400; `YouTubeClient.listPlaylists` seam)। Publish-এ upload → cover → `playlistItems.insert`; ব্যর্থতায় published + verbatim note। Composer-এ YouTube target থাকলে playlist select (লোড/খালি অবস্থার সৎ লেখা; তালিকায় না থাকা সংরক্ষিত মান "বর্তমান playlist" হিসেবে দেখা যায় যাতে edit-এ হারিয়ে না যায়)।
- **First comment সম্প্রসারণ**: YouTube → `commentThreads.insert`; LinkedIn → `POST /v2/socialActions/{postUrn}/comments` (নতুন `LinkedInClient.createComment`)। দুটোতেই Meta semantics: পোস্ট published থাকে, comment ব্যর্থ হলে verbatim note + audit। **TikTok-এ এমন API নেই — ছোঁয়া হয়নি।**
- **TikTok photo posts**: `directPhotoInit` (DIRECT_POST + PHOTO, PULL_FROM_URL) + `publishPhoto` — direct-post-এর **একই audit gate**-এর পেছনে। Gate OFF: preflight-এ সৎ বাংলা refuse (`TIKTOK_PHOTO_GATE_MSG`) — publish attempt-ই হয় না, schedule/bulk/derive পথেও gate প্রযোজ্য; video পথ অপরিবর্তিত। (৩টি পুরনো spec assertion নতুন gate message-এ হালনাগাদ — invariant গুলো: permanent fail, attempts 0, কোনো platform call নয় — অপরিবর্তিত।)

## SN2 — Client approval share link

- **Schema**: `SocialPostShareLink` (postId/groupId nullable, token unique — `randomBytes(32)` base64url, SP1 ধাঁচ; expiresAt, revokedAt, createdById) + `SocialPostClientReview` (reviewerName, decision, comment) + `Organization.socialRequireClientApproval` (default false)। Migration একটাই: `20261015100000_sn1_sn2_publishing_client`।
- **Internal API** (org-scoped, WRITE_ROLES): `POST posts/:id/share-link`, `POST post-groups/:id/share-link` (default expiry 7 দিন, range 1–365; `API_PUBLIC_URL` থাকলে সম্পূর্ণ URL, না থাকলে relative path + সৎ `urlNote` — SU6 ধাঁচ), `GET posts/:id/share-links` (token masked `…last4`, status derive — পূর্ণ URL আর ফেরত যায় না), `DELETE share-links/:id` (revoke = revokedAt সেট)। Create/revoke AuditLog-এ (`social.share_link_created` / `social.share_link_revoked`; token কখনো audit-এ নয়)।
- **Public API** (`public/social` controller-এ): `GET share/:token` — unknown 404, revoked 410, expired 410 (আলাদা সৎ message)। Payload **whitelist only**: `{ posts: [{ postId, caption, media: [{kind, publicUrl}], platform, accountDisplayName, status, clientReview|null }] }` — spec-এ explicitly assert করা যে firstCommentText, organizationId, createdById, account id, linkUrl, notes, versions, share token, storageKey কোনোটাই payload-এ নেই। `POST share/:token/review` — reviewerName আবশ্যক, decision শুধু `approved`/`changes_requested`, link-scope-এর বাইরের postId refuse (সব বাংলা 400); dead link-এ 410। Review append-only — **সর্বশেষ review-ই কার্যকর** (supersede; timeline-এ সবগুলোই থাকে)।
- **Publish gate — semantics যা বসল**: `socialRequireClientApproval` ON হলে প্রতিটা post-এর সর্বশেষ client review `approved` না হলে publish/schedule আটকায়, কারণ হুবহু **"ক্লায়েন্ট অনুমোদন বাকি"** (একটাই constant)। Call-site — ঠিক যেখানে SU9 approval gate বসে: (1) `schedulePost`, (2) `bulkPosts` reschedule (per-item error), (3) `publishNow` (claim-এর আগে Conflict), (4) worker `runDuePublishes` (block হলে post draft-এ ফেরত + error-এ হুবহু কারণ)। Queue ও health-retry ওই পথগুলোতে delegate করে বলে আলাদা বসাতে হয়নি। Gate **post-ভিত্তিক** (এক variant-এর approval অন্যটিকে কভার করে না — spec-pin)। OFF হলে আচরণ হুবহু আগের — regression spec আছে। Client approval অভ্যন্তরীণ SP7/SU9 gate-কে bypass করে না — এটি তার ওপরে তৃতীয়, optional ধাপ।
- **Timeline**: SU9 timeline-এ `kind: "client_review"` entry — আসল `SocialPostClientReview` record থেকে (derived নয়)। Share create/revoke timeline-এ নয় (শুধু AuditLog)।
- **Web**: PostsPanel detail-এ Share section (তৈরি → পূর্ণ URL একবার + Copy + urlNote + মেয়াদ; তালিকায় masked token/status pill/Revoke; group post-এ group link তৈরির বোতাম — group link তালিকায় আসে না, UI-তে তা লেখা আছে), Settings-এ toggle (two-step-এর পাশে, সাহায্য-পাঠ্যসহ), public page `/share/social/[token]` (লগইন ছাড়া; preview + প্রতি post-এ নাম/মন্তব্য/Approve/Changes form; 404/410-তে API-র সৎ message)।

## Gate (coordinator নিজে final tree-তে চালানো)

- **API jest FULL**: একক প্রক্রিয়ার run sandbox OOM SIGKILL-এ মারা যায় (~১৩০ suite PASS, FAIL 0 অবস্থায়) — Integration-6 precedent অনুযায়ী ৬ chunk-এ `jest --runInBand`: 59/550 + 92/857 + 91/901 + 74/927 + 69/833 + 18/161 = **403 suites / 4229 tests, সব PASS**। Social suite নিজে: SN1-এর পর 496, SN2-এর পর **518** tests সবুজ।
- **Web vitest FULL**: 54 files, **441/441 PASS** (SN lib test-সহ: নতুন `social-posts-sn.test.ts` 4 + analytics playlist case)।
- **tsc**: API 0, web 0, admin 0 · **Prisma validate**: valid · **Monorepo build**: 7/7 green (নতুন route `/share/social/[token]` build output-এ আছে)।
- **Fresh Postgres 16.15**: পুরো sequence **193/193 applied** (base 192 + এই batch-এর 1), 0 unfinished/rolled back, 257 tables; নতুন column (`SocialPost.youtubePlaylistId`, `Organization.socialRequireClientApproval`) ও table (`SocialPostShareLink`, `SocialPostClientReview`) যাচাই করা।

## সৎ সীমা

- **কোনো live platform call হয়নি** — Meta/YouTube/LinkedIn/TikTok সব প্রমাণ stubbed-boundary spec স্তরে। Live প্রমাণ SN0/SN live session-এর বিষয় (মালিকের আসল অ্যাকাউন্ট)।
- FB thumbnails edge-এর docs প্রমাণে সতর্কতা spike-এই লেখা: thumbnails reference পেজটি fetcher-এ 403 দিয়েছে — প্রমাণ Meta-র search-indexed reference + অফিসিয়াল changelog + Page Videos reference থেকে; আসল Page token-এর permission scope ও publish-এর ঠিক পরপর transcoding timing-এ call সফল হবে কিনা live যাচাই বাকি (ব্যর্থ হলে verbatim error-ই note-এ যাবে)।
- LinkedIn comment live-এ Community Management approval-এর ওপর নির্ভরশীল (CC20-র gate, আগের মতোই)।
- TikTok photo-তে `photo_cover_index: 0`, title = caption (আলাদা description পাঠানো হয় না — video পথের ধাঁচে)।
- Group share link-এর **list endpoint নেই** — dashboard-এ group link শুধু তৈরির মুহূর্তে দেখা যায় (revoke তৈরির response-এর id দিয়েই API-তে সম্ভব, UI তালিকা post-level-ই)।
- Content edit-এ client review reset হয় না — এমন নিয়ম এই batch-এর task-এ ছিল না; internal approval reset আগের মতোই। Client নতুন review দিলে সেটাই supersede করে।
- Web-এর দুজন worker daemon restart-এ পরপর মারা গিয়েছিল (শূন্য আউটপুটে) — web অংশ শেষ পর্যন্ত coordinator নিজে করেছে, ছোট commit-এ (`3b56e9d`, `cad46e2`)। SN1 web commit-এ `tsconfig.tsbuildinfo`-র এক লাইনের cache churn আছে (source নয়)।
- কোনো SU/SN migration আসল DB-তে চলেনি; screenshot QA হয়নি (live app-এ SN build deploy হয়নি) — দুটোই owner-gated ধাপে।
