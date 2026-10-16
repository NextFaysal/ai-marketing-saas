# SN1 Spike — Facebook Page Video Cover (Custom Thumbnail)

**Verdict: BUILD — publish-পরবর্তী আলাদা thumbnail edge দিয়ে (`POST /{video_id}/thumbnails`); creation-time `thumb` বা resumable পথে নয়।**

**তারিখ:** ২০২৬-১০-১৫ · **প্রসঙ্গ:** SN1-এর spike-first শর্ত — SN প্যাকেজ প্ল্যানের
(`docs/social-posts-next-plan.md` §৪, Batch N1) নির্দেশনা: documented পথ পেলে
তবেই বাস্তবায়ন, অনুমান করে parameter পাঠানো যাবে না। এই doc শুধু research —
কোনো production code বদলায়নি।
**উৎস:** Meta-র অফিসিয়াল developer documentation, ২০২৬-১০-১৫-তে যাচাই করা
(Graph API Reference v26.0; codebase-এর runtime default v21.0 —
`apps/api/src/common/meta-graph.ts`-এর `META_GRAPH_VERSION`)।

---

## ১. SU8-তে কেন NOT BUILT হয়েছিল (পুনরাবৃত্তি)

`docs/social-su8-stories-spike.md`-এর শেষ অংশের সিদ্ধান্ত ছিল: Page videos
edge-এ `thumb` parameter তালিকাভুক্ত থাকলেও —

1. এই codebase-এর `file_url`-ভিত্তিক publish call-এ raw thumb data পাঠানোর
   documented সংযোগ নিশ্চিত করা যায়নি, এবং
2. প্রকাশের পরে `/{video-id}/thumbnails`-এ POST করে cover বসানোর অফিসিয়াল
   পথও সেই spike-তে নিশ্চিত করা যায়নি।

তাই SU8-তে FB video cover বাস্তবায়ন হয়নি; `coverAssetId` শুধু YouTube-এ
ব্যবহৃত হয়েছে। এই spike-এর কাজ ছিল দুটো প্রশ্নই বর্তমান docs ধরে আবার
যাচাই করা। ফল: **(১) এখনও নিশ্চিত নয় (নিচে পথ ক), কিন্তু (২) এখন
documented হিসেবে নিশ্চিত — আর সেটাই BUILD-এর ভিত্তি (নিচে পথ খ)।**

## ২. Codebase অডিট — বিদ্যমান flow ঠিক কী

### ২.১ Meta Page video publish: এক ধাপের `file_url` flow

`apps/api/src/social/meta-publisher.ts`-এর `MetaSocialPublisher.publishToPage()`:

- ঠিক ১টি video (আর কিছু নয়) হলে একটাই call:
  `graphPost(token, /{pageId}/videos, { file_url: videos[0].publicUrl, description: caption })`
  → উত্তরের `id`-ই `platformPostId`।
- Meta-র কোনো resumable/chunked (`upload_phase`) flow এই codebase-এ **নেই**
  — `upload_phase` শব্দটা social কোডে কোথাও ব্যবহৃত হয় না। (Resumable
  যন্ত্র আছে শুধু YouTube-এ, `youtube.client.ts`-এ — Google-এর প্রোটোকল।)

### ২.২ Transport সীমা: `graphPost` শুধু string পাঠাতে পারে

`apps/api/src/common/meta-graph.ts`-এর `graphPost(token, path, params: Record<string, string>)`
body বানায় `URLSearchParams` দিয়ে (অর্থাৎ `application/x-www-form-urlencoded`),
host `https://graph.facebook.com/{version}`। Raw image bytes / multipart
body পাঠানোর কোনো ক্ষমতা এই helper-এ নেই — এটাই SU8-এর (১) নম্বর বাধার
প্রযুক্তিগত মূল।

তবে multipart যন্ত্র codebase-এ একেবারে নতুন নয়: Inbox-এর
`apps/api/src/inbox/meta-messaging.client.ts` (`uploadWhatsAppMedia`,
`uploadMessengerAttachment`) ও Telegram adapter ইতিমধ্যে `FormData` +
`Blob` দিয়ে Meta-তে file upload করে — একই ধাঁচ reuse করা যায় (§৫)।

### ২.৩ `coverAssetId` কোথায় কোথায়

- Schema: `packages/db/prisma/schema.prisma`-তে `SocialPost.coverAssetId String?`
  (SU8-তে যোগ; migration লাগবে না — field ইতিমধ্যে আছে)।
- লেখা/পড়া: `social.dto.ts` (create/update-তে optional), `social.service.ts`
  (`su8CreateFields`, update, clone/group-derive-তে pass-through), সিরিয়ালাইজেশনে
  ফেরত আসে।
- **ব্যবহার (consume) একটাই জায়গায়:** `social-publish.service.ts`-এর
  `publishToOAuthPlatform()`-এর YouTube branch-এ। Upload সফল হওয়ার **পরে**
  cover asset-এর bytes `MediaStore` থেকে `size()` + `readRange()` দিয়ে পড়ে
  `YouTubePublisher.setThumbnail()` call হয়
  (`youtube.client.ts`: `thumbnails.set` endpoint-এ raw bytes POST)।
  Semantics: **thumbnail ব্যর্থ হলে video published-ই থাকে**, verbatim কারণ
  `publishNote`-এ যোগ হয় ("Cover (thumbnail) সেট করা যায়নি: …")।
- Meta branch-এ (`publishToPlatform()`-এর Meta Page/Instagram পথে)
  `coverAssetId` **কোথাও পড়াই হয় না** — Page video post-এ cover সেট করলেও
  আজ তা নীরবে উপেক্ষিত হয়। Pre-flight-এও (`social-preflight.ts`) cover নিয়ে
  কোনো নিয়ম নেই।

অর্থাৎ ঘাটতি শুধু Meta publisher-এর একটা post-publish ধাপের — data model,
DTO, UI field, bytes পড়ার যন্ত্র সবই আগে থেকে আছে।

## ৩. Meta docs যাচাই — তিনটি পথ

যাচাইয়ের তারিখ ২০২৬-১০-১৫। Page Videos reference সরাসরি fetch করে পড়া
হয়েছে; Video Thumbnails reference পেজটি এই পরিবেশের fetcher-এ সরাসরি
খোলা যায়নি (HTTP 403), তাই সেই edge-এর প্রমাণ নেওয়া হয়েছে Meta-র নিজের
search-indexed reference content, Graph API changelog (অফিসিয়াল) এবং
অফিসিয়াল reference-এর mirror copy থেকে — নিচে প্রতিটা দাবির পাশে উৎস
আলাদা করে লেখা আছে, যাতে কোনটা সরাসরি পড়া আর কোনটা indexed/mirror তা
পরিষ্কার থাকে। ব্লগ পোস্ট কোনো দাবির প্রমাণ হিসেবে ব্যবহৃত হয়নি।

### পথ ক — Creation-এর সময় `thumb` (একই call-এ)

- **Documented parameter:** Graph API Reference v26.0, Page Videos —
  Creating (`POST /{page_id}/videos`)-এর parameter তালিকায় `thumb`,
  type `image`, অর্থাৎ video-র সঙ্গে যুক্ত করার জন্য raw thumbnail data।
  একই তালিকায় `file_url` (type `string`) ও আছে।
  উৎস (সরাসরি fetch): https://developers.facebook.com/docs/graph-api/reference/page/videos/
- **কিন্তু সংযোগ documented নয়:** Reference কোথাও বলে না `thumb`
  `file_url`-এর সঙ্গে একসাথে ব্যবহার করা যায়। একমাত্র স্পষ্ট নিষেধাজ্ঞা
  `file_url` সম্পর্কে হলো এটি `upload_phase`-এর সঙ্গে ব্যবহার করা যায় না —
  `thumb` সম্পর্কে এমন কোনো compatibility বিবৃতি নেই। `thumb` raw data
  হওয়ায় পাঠাতে multipart লাগে; আমাদের `file_url` call url-encoded —
  দুটো এক call-এ মেশানোর documented রূপ docs-এ পাওয়া যায়নি।
- **সিদ্ধান্ত:** এই পথে BUILD নয়। SU8-এর বাধা (১) আজও হুবহু বহাল।
  অনুমান করে `thumb` পাঠানো SN1 প্ল্যানের নিষেধাজ্ঞার সরাসরি লঙ্ঘন হতো।

### পথ খ — Publish-এর পরে আলাদা thumbnails edge ⭐ BUILD-এর ভিত্তি

- **Endpoint:** `POST /{video_id}/thumbnails` — posting-এ একটি
  VideoThumbnail তৈরি হয়।
  অফিসিয়াল reference URL: https://developers.facebook.com/docs/graph-api/reference/video/thumbnails/
  (একই edge-এর অস্তিত্ব Meta-র অফিসিয়াল Graph API v2.3 changelog-এও
  ঘোষিত — custom thumbnail JPEG/PNG `GET|POST /{video_id}/thumbnails`
  দিয়ে manage করা যায়, Video Thumbnail reference দ্রষ্টব্য:
  https://developers.facebook.com/docs/graph-api/changelog/version2.3/?locale=en_US
  এবং https://developers.facebook.com/docs/graph-api/reference/video-thumbnail/)
- **Parameters (reference অনুযায়ী):**
  - `source` — type `image`, **Required** — thumbnail-এর image file নিজেই
    (multipart file upload; reference-এর উদাহরণে `source=@<file>.jpg`
    আকারে পাঠানো)।
  - `is_preferred` — type `boolean`, default `false` — `true` দিলে এই
    thumbnail-টিই video-র preferred (দেখানো) thumbnail হয়। **Cover বসাতে
    হলে এই flag-টাই আসল** — শুধু thumbnail upload করলেই তা cover হয় না,
    preferred হিসেবে চিহ্নিত করতে হয়।
- **সফল উত্তর:** `{ "success": true }` আকারের।
- **সীমা (reference অনুযায়ী):** thumbnail file সর্বোচ্চ 10 MB; শুধু
  Page-এর সঙ্গে যুক্ত video-তেই thumbnail তৈরি করা যায় (আমাদের ক্ষেত্রে
  শর্ত পূরণ হয় — video Page-এই publish হয়); video-র aspect ratio-র সঙ্গে
  মিলিয়ে thumbnail দেওয়ার পরামর্শ আছে।
- **Token/permission (reference অনুযায়ী):** App বা Page access token;
  Page video-র ক্ষেত্রে বর্তমান publish-এ ব্যবহৃত Page token-ই প্রার্থী।
  Mirror/indexed reference-এ এই edge-এর জন্য
  `pages_read_user_content`, `pages_manage_engagement`, `pages_show_list`
  permission-এর উল্লেখ আছে — বিদ্যমান token-এ এগুলো আছে কিনা **live
  যাচাই ছাড়া দাবি করা যাবে না** (M30/SN live session-এর কাজ, §৬)।
- **কেন এই পথ বিদ্যমান flow-এর সঙ্গে মেলে:** video আগের মতোই
  `file_url` দিয়ে publish হবে (কোনো বদল নেই), `id` পাওয়ার পরে দ্বিতীয়
  call-এ cover বসবে — হুবহু YouTube cover-এর বিদ্যমান semantics
  (publish আগে, thumbnail পরে, ব্যর্থতায় post published + verbatim note)।
  Creation flow, retry শ্রেণিবিন্যাস, কোনো কিছুই বদলাতে হয় না।

### পথ গ — Resumable / chunked upload-এর সঙ্গে `thumb`

- **Documented অংশ:** Page Videos reference-এই `upload_phase`
  (enum: `start`, `transfer`, `finish`, `cancel`), `upload_session_id`,
  `video_file_chunk`, `file_size`, `start_offset` parameter আছে — অর্থাৎ
  একই edge-এ chunked upload documented। বর্তমান Video API Publishing
  guide আবার আলাদা Resumable Upload API (`/{app_id}/uploads` → file handle
  → `/{page_id}/videos`-এ `fbuploader_video_file_chunk`) বর্ণনা করে।
  উৎস: https://developers.facebook.com/docs/graph-api/reference/page/videos/
  এবং https://developers.facebook.com/documentation/video-api/guides/publishing
  ও https://developers.facebook.com/docs/graph-api/guides/upload/
- **Undocumented অংশ:** কোন phase-এ `thumb` যাবে — `finish`-এ কিনা — তা
  fetched docs-এর কোথাও বলা নেই; Resumable Upload guide-এ thumbnail-এর
  উল্লেখই নেই। তার ওপর এই পথ নিতে হলে পুরো Meta video publish flow
  `file_url` থেকে chunked/resumable-এ বদলাতে হতো — cover-এর জন্য এত বড়
  বদল অনর্থক, যখন পথ খ একই ফল দেয়।
- **সিদ্ধান্ত:** এই পথে BUILD নয় (প্রয়োজনও নেই, প্রমাণও নেই)।

### সারসংক্ষেপ

| পথ | Documented? | এই codebase-এ মেলে? | সিদ্ধান্ত |
|---|---|---|---|
| ক. Creation call-এ `thumb` + `file_url` | Parameter আছে; সংযোগের বিবৃতি নেই | না — transport url-encoded, raw bytes যায় না | NOT BUILD |
| খ. পরে `POST /{video_id}/thumbnails` (`source` + `is_preferred=true`) | হ্যাঁ — endpoint, parameter, সীমা, success উত্তর | হ্যাঁ — YouTube cover-এর হুবহু ধাঁচে post-publish ধাপ | **BUILD** |
| গ. Resumable/chunked-এর সঙ্গে `thumb` | Upload documented; কোন phase-এ thumb তা নয় | না — পুরো publish flow বদলাতে হতো | NOT BUILD |

## ৪. Verdict-এর সীমানা (যা এই spike নিশ্চিত করতে পারেনি)

1. **Live প্রমাণ নেই** — কোনো আসল Page/token দিয়ে call করা হয়নি
   (SN0/M30 গেট আগের মতোই)। Docs-documented ≠ live-verified; acceptance-এ
   দুটো আলাদা করে লিখতে হবে।
2. **Transcoding timing:** `file_url` publish `id` ফেরত দেওয়ার পরপরই
   thumbnail POST করা যাবে, নাকি video processing শেষ হওয়া পর্যন্ত
   অপেক্ষা/আবার-চেষ্টা লাগবে — fetched docs এ নিয়ে কিছু বলে না।
   Implementation-এ তাই thumbnail ব্যর্থতাকে কখনোই publish ব্যর্থতা বানানো
   যাবে না (§৫-এর semantics), এবং live session-এ timing-টা দেখে নিতে হবে।
3. **Permission scope:** বিদ্যমান Page token-এর scope-এ thumbnails edge
   চলবে কিনা live ছাড়া জানা যাবে না; Meta refuse করলে তার verbatim error-ই
   note-এ যাবে — সেটাই সৎ আচরণ।
4. Video node reference (v26.0, সরাসরি fetch:
   https://developers.facebook.com/docs/graph-api/reference/v26.0/video/)
   — fetched অংশে edges তালিকা কাটা পড়েছে, তাই thumbnails edge-এর
   অস্তিত্বের মূল প্রমাণ হিসেবে উপরের changelog + thumbnails reference-ই
   ধরা হয়েছে।

## ৫. Implementation sketch (BUILD — পথ খ)

কোনো schema/migration/DTO বদল লাগবে না — `coverAssetId` আগেই আছে।
আনুমানিক স্পর্শ: ৩টি ফাইল + ১টি spec।

1. **`apps/api/src/common/meta-graph.ts` — নতুন multipart helper**
   `graphPostMultipart(token, path, fields, file: { bytes, contentType, fileName }, fetchFn?)`:
   `FormData`-তে string field গুলো + file অংশ `Blob` হিসেবে যোগ করে
   `graphBase() + path`-এ POST; `Content-Type` হাতে বসানো যাবে না
   (boundary fetch নিজে বসায়)। Error discipline বিদ্যমান `graphPost`-এর
   হুবহু: `json.error` থাকলে `MetaGraphError` verbatim message-সহ।
   ধাঁচের নজির: `meta-messaging.client.ts`-এর `uploadWhatsAppMedia`।

2. **`apps/api/src/social/meta-publisher.ts` — নতুন method**
   `setVideoThumbnail(token, videoId, bytes, contentType, fileName)`:
   helper দিয়ে `POST /{videoId}/thumbnails` — file field-এর নাম হুবহু
   **`source`**, সঙ্গে `is_preferred: "true"` ও
   `access_token` form field হিসেবে। উত্তরে `success !== true` হলে
   `publishPhotoStory`-র ধাঁচে plain `Error` — id/success ছাড়া cover
   "বসেছে" দাবি করা হবে না। Meta-র error verbatim propagate হবে।

3. **`apps/api/src/social/social-publish.service.ts` — Meta branch-এ post-publish ধাপ**
   `publishToPlatform()`-এ বর্তমানে Meta ফল সরাসরি `return` হয়; video
   ক্ষেত্রে তা ধরে রাখতে হবে: `account.platform === "meta_page"` +
   post-এ ঠিক ১টি video asset + `post.coverAssetId` থাকলেই, publish
   সফল হওয়ার **পরে** YouTube branch-এর হুবহু অনুলিপি ধাঁচে —
   cover asset org-scoped `findFirst`, `MediaStore.size()` +
   `readRange()` দিয়ে bytes, documented 10 MB সীমার ওপরে হলে call-এর
   আগেই note-এ কারণ — তারপর `publisher.setVideoThumbnail(...)`।
   ফলাফলের `publishNote`: সফল হলে Meta পথে বর্তমানে note নেই, তাই
   `null`-ই থাকবে; ব্যর্থ হলে YouTube-এর একই বাক্যরীতি —
   `Cover (thumbnail) সেট করা যায়নি: {verbatim কারণ}` যোগ হবে।
   Token-dead marking এই ধাপে চলবে না (YouTube ধাপেও চলে না) — post
   ইতিমধ্যে published, thumbnail ব্যর্থতা account-এর অবস্থা বদলায় না।
   Cover ছাড়া বা image post-এ আচরণ আগের সঙ্গে byte-identical থাকবে
   (কোনো অতিরিক্ত call/read নয়)। Instagram এই ধাপের বাইরে — এই spike
   শুধু FB Page video-র; IG container flow-তে thumbnails edge প্রযোজ্য নয়।

4. **Spec — `apps/api/src/social/social-sn1.spec.ts`** (stubbed-fetch boundary,
   SU8 spec-এর ধাঁচে):
   - video + cover → call ক্রম: `/{page}/videos` (`file_url`) →
     `/{video}/thumbnails` (multipart-এ `source` blob-এর type/size ও
     `is_preferred=true` যাচাই), `success:true` → note-এ cover-ত্রুটি নেই;
   - thumbnails call ব্যর্থ (Meta verbatim error) → post **published**-ই
     থাকে, note-এ verbatim কারণ;
   - cover নেই → দ্বিতীয় call হয় না; image post + cover → call হয় না;
   - cover 10 MB-এর বেশি → call না করেই note-এ কারণ।

5. **যা করা যাবে না:** creation call-এ `thumb` যোগ করা (পথ ক),
   Meta publish-কে resumable-এ সরানো (পথ গ), বা thumbnail সফল না হলে
   post-কে failed করা — তিনটিই এই spike-এর প্রমাণ/সীমানার বাইরে।

## ৬. Live verification-এ যোগ হবে (SN live checklist)

- আসল Page + token দিয়ে video + cover publish → Facebook-এ preferred
  thumbnail-টাই দেখাচ্ছে কিনা চোখে যাচাই।
- Publish-এর ঠিক পরের মুহূর্তে thumbnails call সফল হয় কিনা (timing, §৪.২)
  — ব্যর্থ হলে Meta-র verbatim error রেকর্ড করা।
- Token-এর permission scope thumbnails edge-এ যথেষ্ট কিনা (§৪.৩)।
