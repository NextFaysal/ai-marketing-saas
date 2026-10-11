# Social Media Post Scheduler — Detailed Plan (AI Post তৈরি + Image তৈরি + Schedule)

**প্রস্তাব:** মালিক, ২০২৬-১০-১১ ("social media post schedule-এর powerful system — user AI দিয়ে post তৈরি করতে পারবে, schedule করে রাখতে পারবে, image create করতে পারবে; details plan করো")।
**ভিত্তি:** ২০২৬-১০-১১-এর code audit (publishing module, schema, inbox Meta connection, AI infrastructure নিজে ঘেঁটে যাচাই)।
প্যাকেজের নিজস্ব নম্বর: **SP1–SP7**।

## Audit — যা আছে আর যা নেই

**আছে (এর ওপরই দাঁড়াবে):**
- Inbox-এর জন্য **Meta Page + Instagram connection** (Page token, verify-before-save, AES-256-GCM sealed) — তবে ওটা messaging permission-এর; posting permission আলাদা
- **MediaStore** (U6) — upload, magic-byte যাচাই, media serving
- **Scheduler + Worker** (M57 BullMQ + DLQ, A3-তে tenant visibility) — due-time কাজ চালানোর প্রমাণিত যন্ত্র
- **AI infrastructure** — LLM provider factory (Gemini প্রমাণিত), AI kill switch + plan cap + usage record (M45–M48), **Creative Studio (M55)**-এর grounded copy + **M24 policy pre-flight** ধাঁচ, **Business Brain (M76/M77)** — business-এর আসল তথ্য AI-র জন্য
- **M59 white-label branding** (logo, brand colour) — template image-এ ব্যবহারযোগ্য
- M72 permission areas, AuditLog, AgentNotification

**নেই (এই প্যাকেজে হবে):**
- Organic (non-ad) post-এর কোনো model/composer/scheduler-ই নেই — `publishing` module শুধু বিজ্ঞাপন publish করে
- **Image generation provider কোথাও নেই** (M55-তে সৎভাবে অনুপস্থিত লেখা আছে) — Creatives শুধু upload

## Platform সত্য (কোনো ভান নয়)

| Platform | Post করা যায়? | শর্ত |
|---|---|---|
| **Facebook Page** | হ্যাঁ — text/link/photo/video post (Graph API `/{page}/feed`, `/photos`, `/videos`) | Page token-এ `pages_manage_posts` লাগবে; production-এ Meta app review। মালিকের নিজের Page + app role থাকলে test-এ আসল post সম্ভব |
| **Instagram** | হ্যাঁ — ছবি ও Reels (Content Publishing: container → publish, ২ ধাপ) | Business/Creator account Page-এর সাথে যুক্ত; **ছবি public URL-এ থাকা বাধ্যতামূলক** (আমাদের MediaStore-এর public link লাগবে); `instagram_content_publish` permission |
| **TikTok** | আপাতত নয় | Content Posting API-তে app audit বাধ্যতামূলক; unaudited app-এ শুধু private/draft — tenant-কে "published" বলে চালানো যাবে না |
| **YouTube** | পরের ধাপে | Data API upload-এ OAuth + unverified app-এ video private থাকে — M30-র platform ধাপের সাথে |
| **X (Twitter)** | নয় | লেখার API মূলত paid tier; ব্যবসায়িক যুক্তি দুর্বল |

**v1 scope: Facebook Page + Instagram** — দুটোই আসল publish, platform নিশ্চিত করলে তবেই "Published"। বাকিগুলো adapter কাঠামোয় "অনুমোদন বাকি" অবস্থাসহ পরে।

## Image তৈরির কৌশল (৩টি আসল পথ, কোনো mock নয়)

1. **AI Image Provider (Admin-configured):** Platform Config-এ image provider (Gemini image model) — মালিক নিজের key বসাবেন (M30 ধাঁচ); config save-এর সময় **আসল ছোট্ট test generation দিয়ে verify** (verify-before-save)। Model-এর availability account-ভেদে বদলায় — verify ব্যর্থ হলে config save হবে না, কারণ হুবহু দেখিয়ে। Provider না থাকলে AI-image বোতাম সৎ "configure করা নেই" অবস্থা দেখাবে
2. **Template Composer (built-in, provider ছাড়াই চলে):** product-এর আসল ছবি + brand colour/logo (M59) + দাম/offer-এর text overlay দিয়ে server-side-এ পোস্টার তৈরি — অফলাইনেও কাজ করে, এটা আসল generation (অনেক দোকানের দৈনন্দিন পোস্টের জন্য এটাই যথেষ্ট)
3. **নিজের ছবি upload** (বিদ্যমান MediaStore) — AI শুধু caption লিখে দেবে

## প্যাকেজ (৪ batch)

### Batch 1 — ভিত্তি ও Composer
- **SP1 Foundation:** `SocialAccount` (org, platform meta_page/instagram, external id, নাম, sealed credential, status — inbox connection থেকে আলাদা, কারণ posting permission আলাদা; verify-before-save connect, Page বেছে নেওয়া) + `SocialPost` model (caption, media refs, link, status: draft/scheduled/publishing/published/failed/cancelled, scheduledAt, platformPostId, error verbatim, per-account) + **MediaStore public URL** (Instagram-এর শর্ত পূরণে; unguessable token-যুক্ত public media route, ReportShare-এর ধাঁচে)
- **SP2 Composer + Drafts:** নতুন "📣 Social Posts" পেজ — composer (caption editor, media picker: upload/product ছবি, একাধিক account বেছে নেওয়া — প্রতি account-এ আলাদা SocialPost row), draft সংরক্ষণ, তালিকা + status filter। M72 `social` permission area (নতুন) — কে draft করতে পারে, কে publish/schedule পারে

### Batch 2 — AI
- **SP3 AI Copy:** M55-এর ধাঁচে grounded caption — Business Brain-এর আসল তথ্য + product-এর আসল দাম/ছবি; দাম/discount বানানো নিষেধ (prompt + যাচাই); প্রতিটা variant-এ **M24 policy pre-flight**; ভাষা BN/EN; hashtag পরামর্শ + নিজের hashtag set সংরক্ষণ; kill switch/cap/usage parity (feature `social_copy`)
- **SP4 AI Image:** ImageProvider interface + Gemini image adapter (Admin config + verify) + **Template Composer** (product ছবি + branding + text overlay — server-side rendering, generated ছবি MediaStore-এ আসল asset হিসেবে)। Usage record দুটো পথেই; provider error হুবহু

### Batch 3 — Schedule ও Publish
- **SP5 Scheduler + Calendar:** মাস/সপ্তাহ calendar view (drag করে সময় বদলানো = reschedule), queue তালিকা; সময় org-এর timezone-এ; `social_publish` due-scan job (M57 worker পথে) — সময় হলে publish, ব্যর্থ হলে backoff retry (সর্বোচ্চ ৩ বার) তারপর DLQ + AgentNotification (A3-তে দৃশ্যমান); schedule বাতিল/এখনই publish — দুটোই audit-সহ
- **SP6 Publishing Adapters:** Meta Page (text/link/photo/video) + Instagram (photo/Reels — container status poll করে তবেই publish ধাপ; public URL ব্যবহার)। **Published শুধু platform post id ফেরত দিলে**; error হুবহু post-এ সংরক্ষিত + পেজে দৃশ্যমান। Token মরলে AD1-ধাঁচের health/reconnect সংকেত

### Batch 4 — ফলাফল ও পরিপক্বতা
- **SP7 Insights + Approval:** published post-এর প্রতিক্রিয়া টেনে আনা (like/comment/share — Graph API যা দেয় হুবহু, না দিলে null); নিজের post-এর আসল data থেকে "কোন সময়ে response বেশি" — **নিজের data থাকলেই** পরামর্শ, labelled heuristic, data না থাকলে কোনো পরামর্শ নয়; approval flow (draft → অনুমোদনের অপেক্ষা → schedule; OWNER/ADMIN approve, M72); evergreen post পুনরায় schedule (এক ক্লিকে নতুন draft কপি)

## নিয়ম (সব batch-এ)
- Local commit only — GitHub push মালিকের স্পষ্ট নির্দেশ ছাড়া নয় (push-এর আগে remote যাচাই বাধ্যতামূলক)।
- কোনো platform-এ post "হয়েছে" বলা হবে শুধু platform post id ফেরত এলে; AI image "তৈরি" বলা হবে শুধু আসল asset তৈরি হলে।
- প্রতিটি item: build + full tests + acceptance doc + সম্ভব হলে live/boundary যাচাই (আসল publish-এর live প্রমাণ মালিকের Meta app + Page পেলে M30 ধাঁচে — তার আগে verify boundary-ই সিলিং, স্পষ্টভাবে লেখা থাকবে)।

---

## সংশোধনী (মালিকের সিদ্ধান্ত, ২০২৬-১০-১১ ১৮:৫৭ +06): TikTok ও YouTube v1-এই থাকবে

মালিক plan অনুমোদন করেছেন এই শর্তে যে **TikTok/YouTube-ও v1-এ চাই**। দুটো platform-এর app-audit গেট সত্যিই আছে, তাই v1-এ ওদের রূপ হবে আসল কিন্তু সৎভাবে labelled:

### SP8 — TikTok (Batch 5)
- **Connect:** OAuth (video.upload scope) — Admin Platform Config-এ মালিকের TikTok app (client key/secret); config না থাকলে connect সৎভাবে unavailable
- **v1 publish পথ = Inbox Upload:** নির্ধারিত সময়ে video creator-এর TikTok inbox/draft-এ পৌঁছায়; creator app থেকে চূড়ান্ত post করেন। আমাদের status: `sent_to_creator` — কখনোই "published" বলা হবে না যতক্ষণ না TikTok নিশ্চিত করে
- Adapter-এ direct-post-এর কাঠামো থাকবে (creator_info দিয়ে privacy যাচাই করে); মালিকের app audit পাস করলে একই adapter public post করতে পারবে — config-এ audit অবস্থা স্পষ্ট দেখানো হবে
- Video-only পথ: MediaStore-এর video ব্যবহার; photo post TikTok-এ audit-ছাড়া নেই — UI-তে স্পষ্ট

### SP9 — YouTube (Batch 5)
- **Connect:** Google OAuth (youtube.upload scope) — Admin-এ মালিকের Google app; channel বেছে নেওয়া
- **v1 publish পথ = আসল upload (resumable), privacy private:** unverified app-এর সব upload YouTube নিজে private আটকে রাখে — আমরা status দেখাব "YouTube-এ আপলোড হয়েছে (Private — app যাচাই হলে Public করা যাবে)" হুবহু; upload আসল — ভিডিও channel-এ YouTube Studio-তে দেখা যাবে। Public বলে দাবি কখনোই নয়
- ভিডিও metadata (title = caption-এর প্রথম অংশ, description = caption) upload-এর সময়ই যায়

**Batch 5 = SP8 + SP9** (Batch 1–4 অপরিবর্তিত)। দুটোরই live প্রমাণ মালিকের নিজের TikTok/Google app দিলে (M30 প্যাটার্ন); তার আগে OAuth বাউন্ডারি + adapter unit যাচাই-ই সিলিং, লেখা থাকবে।
