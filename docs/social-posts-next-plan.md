# Social Posts Next — আরো ফিচারের পরিকল্পনা (SN প্যাকেজ)

তারিখ: 2026-10-15 · মালিকের জিজ্ঞাসা: "এখন এই system-এ কী কী features add করা যায়, একটা plan করো।"
ভিত্তি: GitHub main `49dac3e`-তে বর্তমান Social Posts-এর কোড অডিট (SP1–SP9 + PP1–PP4 + SU1–SU12 + SD1–SD8 design + CC20-এর LinkedIn — সব main-এ আছে)।

---

## ১. এখন যা আছে (অডিটে নিশ্চিত)

Platform: **Facebook Page, Instagram, TikTok (inbox), YouTube, LinkedIn Page** (CC20 দিয়ে এসেছে)।
Composer v2 (per-platform variant, first comment শুধু Meta-তে, pre-flight, preview, clone), queue slot/recurring/evergreen, Media Library v2 (folder/tag/aspect/cover), AI copy/content plan/script, commerce auto-draft, tracked link + order association, Analytics v2 (timeseries/follower/report), collaboration (note/version/two-step approval), health + failure center, ৫-tab modern design (SD)।

## ২. কোথায় ফাঁক — অডিটের প্রমাণ

| ফাঁক | প্রমাণ |
|---|---|
| FB video cover এখনো নেই | SU8 spike-এ document করা যায়নি বলে বাদ — প্যাকেজের একমাত্র অর্ধেক publishing ফিচার |
| YouTube playlist বাছাই নেই | SU8-তে deferred |
| First comment শুধু Meta-তে | YouTube (comments API) ও LinkedIn-এ সম্ভব, বসেনি |
| TikTok photo post নেই | direct post-এর মতো audit gate-এর পেছনে রাখা |
| Client-কে draft দেখিয়ে approval নেওয়ার উপায় নেই | approval শুধু ভেতরের team-এর; agency (Qosprey) ক্লায়েন্টের জন্য share link নেই — কোডে share/approval-link কিছুই নেই |
| Board view / drag নেই | calendar ও list আছে, কিন্তু pipeline board নেই; drag (`draggable`) পুরো পেজে ০ |
| Caption এক ভাষা থেকে অন্য ভাষায় / platform অনুযায়ী AI variant হাতে লিখতে হয় | variant system আছে, AI দিয়ে variant/অনুবাদ generation নেই |
| Stock ছবি/ভিডিওর কোনো উৎস নেই | library-তে শুধু নিজের upload/AI image/product import; Pexels/stock কিছুই নেই |
| Watermark/brand overlay শুধু Template Poster-এ | যেকোনো ছবিতে brand frame বসানোর সাধারণ action নেই |
| নতুন channel নেই | Telegram/Threads কোথাও নেই (grep: ০) |
| বাইরের content থেকে auto-draft নেই | commerce trigger (SU5) আছে; RSS/নিজের YouTube-এর নতুন ভিডিও থেকে draft নেই |
| Analytics দেখায়, পরামর্শ দেয় না | SU7 data আছে; weekly digest/coach ধরনের কিছু নেই |
| Caption A/B test নেই | একই পোস্টের দুই caption তুলনা করার কাঠামো নেই |

## ৩. পূর্বশর্ত (SN0 — সৎ কথা)

SU/SD কোড main-এ গেলেও **live হয়নি**: আজকের probe-এ live API-তে SU route 404 (আগের build চলছে)। নতুন ফিচারের আগে ক্রমটা হওয়া উচিত:
1. মালিকের **Dokploy Redeploy** → SU/SD live।
2. **SU0 live verification (S1–S10)** — আসল অ্যাকাউন্টে অন্তত Meta + YouTube + Gemini প্রমাণ।
SN প্যাকেজের কোড এই দুটোর ওপর নির্ভর করে না, কিন্তু live প্রমাণ ছাড়া ফিচার জমাতেই থাকলে ঝুঁকি বাড়ে — তাই SN0-কে gate হিসেবে রাখা হলো (blocks শুধু SN-এর live দাবি, কোড নয়)।

## ৪. প্যাকেজ — SN1–SN10, ৫ Batch

### Batch N1 — Publishing-এর বাকি ফাঁক + Client Approval

**SN1 · Publishing gaps closure**
- **FB video cover**: নতুন করে spike (বর্তমান Meta docs ধরে) — `file_url` flow-এর বাইরে resumable/chunked upload-এ thumb বসানোর documented পথ পেলে তবেই বাস্তবায়ন; না পেলে সৎভাবে আবার NOT BUILT লিখে কোন পথে আটকালো তা নথিভুক্ত। অনুমান করে parameter পাঠানো যাবে না।
- **YouTube playlist**: composer-এ playlist বাছাই (নিজের channel-এর playlist তালিকা API থেকে) + upload-এর পর `playlistItems.insert`; ব্যর্থ হলে পোস্ট published থাকে, verbatim note (cover-এর ধাঁচে)।
- **First comment সম্প্রসারণ**: YouTube-এ upload সফল হলে `commentThreads.insert` দিয়ে top-level comment; LinkedIn-এ post-এর পর comment create। Meta-র নিয়মই প্রযোজ্য — publish ব্যর্থ নয়, comment ব্যর্থ হলে পোস্ট published + verbatim error note।
- **TikTok photo posts**: direct post-এর একই audit gate-এর পেছনে (flag OFF default) — photo mode API documented হলে adapter; gate না খুললে কোড dormant।

**SN2 · Client approval share link (agency workflow)**
- Draft/group-এর জন্য **unguessable token public preview page** (SP1-এর public media token ধাঁচ): ক্লায়েন্ট লগইন ছাড়া caption/media/platform preview দেখবে, **Approve / Request changes** + নিজের নাম ও মন্তব্য দিতে পারবে।
- প্রতিটা action পোস্টের timeline-এ (SU9) ও AuditLog-এ রেকর্ড; link-এর expiry (ডিফল্ট ৭ দিন) ও revoke যেকোনো সময়; token একবারই দেখানো।
- সৎ সীমানা: বাইরের approval অভ্যন্তরীণ two-step gate-কে bypass করবে না — org চাইলে "client approval ছাড়া publish নয়" এমন **optional তৃতীয় ধাপ** হিসেবে settings toggle (default OFF)।

### Batch N2 — Workflow ও AI সম্প্রসারণ

**SN3 · Content pipeline board + calendar drag**
- **Board view** (Posts tab-এ তৃতীয় view): column = Draft → Pending → Approved → Scheduled → Published/Failed; card drag করে column বদলালে বিদ্যমান endpoint-ই call হবে (approve/schedule/publish-now) — অবৈধ transition-এ card ফিরে যাবে + কারণ দেখাবে। Schedule column-এ ফেললে সময় বাছাই modal।
- **Calendar drag-reschedule**: scheduled post drag করে অন্য দিনে — বিদ্যমান reschedule পথে (bulk reschedule-এর একক রূপ); approval gate আগের মতোই।

**SN4 · AI repurpose + variant generation**
- **এক caption → সব platform variant**: AI দিয়ে per-platform সংস্করণ (দৈর্ঘ্য/স্বর platform অনুযায়ী) — SU1 variant field-এ বসবে, মানুষ edit করে নেবে; number guard (SU4-এর) প্রযোজ্য, provider না থাকলে refuse।
- **বাংলা ⇄ English অনুবাদ** caption + variant-এর (একই guard)।
- **Repurpose menu** যেকোনো draft/published পোস্টে: → Reel script (SU4 আছে, এখানে যুক্ত), → carousel outline (লম্বা caption থেকে slide ভাগ), → Messaging draft হ্যান্ডঅফ (prefill নিয়ে Messaging tab-এ deep-link — পাঠানো হবে না, শুধু draft তৈরি)।

### Batch N3 — Media ও Intelligence

**SN5 · Stock media + brand overlay**
- **Pexels stock search** library-তে: org-এর নিজের Pexels API key (verify-before-save, Connect Center ধাঁচ) দিয়ে ছবি/ভিডিও খুঁজে বিদ্যমান SSRF-safe import দিয়ে library-তে আনা (attribution লেখা asset-এ সংরক্ষিত)।
- **Brand overlay**: যেকোনো image asset-এ logo + brand bar/frame বসিয়ে derived asset (sharp; Template Poster-এর rendering seam reuse) — মূল ছবি অপরিবর্তিত।

**SN9 · AI performance coach**
- সাপ্তাহিক **per-org digest**: সেরা পোস্ট, সেরা সময়ের হালনাগাদ, content-type পরামর্শ, hashtag movers — সব SU7-এর আসল data থেকে compute; LLM narration থাকলে শুধু ওই সংখ্যাগুলো দিয়েই (number guard), না থাকলে deterministic লেখা। Analytics tab-এ coach card + AgentNotification; per-org job template (weekly), default OFF।

### Batch N4 — নতুন Channel

**SN6 · Telegram channel publishing**
- Bot token (verify: `getMe` + channel-এ `getChat`) দিয়ে channel connect — SocialAccount-এ নতুন platform `telegram`; text/photo/video publish Bot API দিয়ে, scheduler/worker আগের পথেই।
- সৎ সীমানা: bot-কে channel admin হতে হবে; Telegram Bot API post-এর view সংখ্যা দেয় না — insights এই platform-এ "পাওয়া যায় না" হিসেবেই দেখাবে, invented কিছু নয়।

**SN7 · Threads publishing**
- Threads API (আলাদা app config — TikTok/YouTube-এর মতো Admin Platform Config-এ; নিজের app/platform app দুই পথ Connect Center ধাঁচে বিবেচনা করে): text/image/video/carousel publish (container → publish দুই ধাপ), insights যতটা API দেয়।
- Spike-first: বর্তমান Threads API-র documented scope যাচাই করে তারপর বাস্তবায়ন; যা documented নয় তা বাদ।

### Batch N5 — Syndication ও Test

**SN8 · Syndication auto-draft (SU5-এর সম্প্রসারণ)**
- **RSS feed → draft**: org-এর দেওয়া feed (SSRF guard-সহ fetch) নতুন item এলে SU5-এর একই draft engine দিয়ে খসড়া (cap ও toggle একই ধাঁচে, default OFF, guid দিয়ে dedupe)।
- **নিজের YouTube channel-এ নতুন ভিডিও → FB/IG draft ঘোষণা** (channel RSS/playlist থেকে; একই dedupe)। সবই DRAFT ONLY — কখনো সরাসরি publish নয়।

**SN10 · Caption test (সৎ A/B)**
- একই media-তে দুই caption-এর **paired post** (আলাদা সময়ে schedule), দুটো published হলে Analytics-তে পাশাপাশি তুলনা (engagement basis count-সহ)। Platform-এর native A/B নয় — UI-তে নামই হবে "Caption Test (জোড়া পোস্ট তুলনা)"।

## ৫. যা রাখা হলো না / মালিকের আলাদা সিদ্ধান্ত

- **X/Twitter** — আগের মতোই: paid API; চাইলে আলাদা সিদ্ধান্তে Tier-এ উঠবে।
- **Google Business Profile posts** — স্থানীয় ব্যবসার জন্য মূল্যবান, কিন্তু Google-এর API access approval/quota আলাদা প্রক্রিয়া; সিদ্ধান্ত দিলে spike দিয়ে শুরু হবে।
- **Pinterest** — publishing API approval-নির্ভর; একই অবস্থা।
- **Stories scheduling** — Meta API দিয়ে story schedule করা যায় না (শুধু এখনই publish); প্রতিশ্রুতি দেওয়া হবে না।
- **Boosting/ads** — Ads মডিউলের এলাকা, Social Posts-এ নয় (আগের সিদ্ধান্ত বহাল)।

## ৬. Execution

- Worktree: বর্তমান main (`49dac3e`) থেকে নতুন worktree, branch `social-next` (su-package ইতিমধ্যে integrated — ওখানে আর কাজ নয়)। Migration range build শুরুর আগে cross-track ledger যাচাই করে claim (প্রস্তাবিত `20261015100000+`; সর্বশেষ ব্যবহৃত `20261015030000`)।
- ৫ batch পরপর, প্রতিটায় full gate (API/web test, tsc, build, fresh-PG migration sequence) + acceptance doc; শেষে package summary + live-verification checklist হালনাগাদ (SN-এর নতুন session যোগ হবে)।
- Local commit only — push মালিকের আলাদা নির্দেশে। কোনো platform-এর live দাবি SU0/SN live session ছাড়া করা হবে না।
