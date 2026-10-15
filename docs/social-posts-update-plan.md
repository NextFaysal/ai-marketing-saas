# Social Posts Update Package (SU1–SU12) — Detailed Plan

**প্রস্তাব:** মালিক, ২০২৬-১০-১৩ ১৮:২২ +06 — "Social Posts-টা কী কী features update করতে হবে, একটা details plan করো"
**অবস্থা:** প্ল্যান মাত্র — অনুমোদন pending। অনুমোদন ছাড়া কোনো কোড শুরু হবে না।
**ভিত্তি:** ২০২৬-১০-১৩-তে deploy clone (`github-ai-marketing-saas`, main `3e24bc1`) নিজে ঘেঁটে করা audit — schema (`SocialPost`/`SocialAccount`/`MediaAsset`), `apps/api/src/social/*` (controller-এর সব route), web পেজ (1,720 লাইন, একটাই ফাইল), SP/PP acceptance doc, Cross-Track Migration Ledger।

---

## ১. Audit — এখন যা আছে (সংক্ষেপে)

SP1–SP9 + PP1–PP4 **code-complete ও live deploy-এ আছে** (release `ad07936`, main `3e24bc1`-এর ancestor):

- Foundation + ৪ platform connect (Meta Page, Instagram, TikTok OAuth, YouTube OAuth)
- Composer + draft, AI copy (grounded), Gemini AI image (verify-before-save) + Template Poster, product ছবি import (PP3)
- Scheduler + calendar + queue view, 5-min `social_publish_due` worker, retry/backoff
- FB Page + IG publishing (carouselসহ), TikTok inbox upload, YouTube resumable upload (Private-labelled)
- Insights (platform যা দেয় হুবহু) + best-time (≥১০ post হলে) + OWNER/ADMIN approval flow
- বড় video streaming upload (256 MB), SVG→PNG rasterizer

## ২. Audit — যা নেই (কোডে grep করে যাচাই করা, ২০২৬-১০-১৩)

| গ্যাপ | যাচাই |
|---|---|
| Per-platform আলাদা caption — একই caption সব account-এ যায়, platform অনুযায়ী বদলানোর উপায় নেই | `platformCaption`/`captionVariant` = 0 hit |
| First comment (hashtag/order link আলাদা করে প্রথম কমেন্টে) | `firstComment` = 0 |
| Post clone/duplicate, evergreen recycle, recurring series | `duplicatePost`/`evergreen` = 0 — SP7 plan-এর evergreen-এর কোনো acceptance প্রমাণও নেই (আগের উত্তরে flag করা) |
| Queue slot (account-প্রতি নির্দিষ্ট posting time, "Add to Queue" দিলেই পরের slot) | `queueSlot`/`timeSlot` = 0 |
| Platform preview (publish-এর আগে FB/IG/TikTok/YT ফ্রেমে পোস্টটা কেমন দেখাবে) | composer-এ preview নেই |
| Media library সাজানো — folder, tag, search, কোন asset কোন post-এ ব্যবহৃত | `mediaFolder`/`assetTag` = 0; MediaAsset-এ folder/tag field নেই |
| Video thumbnail/cover বাছাই (Reels/YT-র জন্য) | `coverImage` = 0; video থেকে thumbnail তোলার কোড নেই |
| Image crop/resize platform aspect অনুযায়ী (1:1, 4:5, 9:16, 16:9) composer-এ | sharp আছে (PP1) কিন্তু editor নেই |
| Social post-এর link tracking — UTM, click count, post থেকে order | social-এ UTM/click tracking নেই (Messaging MS6-এ আছে, Social-এ নেই); `linkUrl` খালি একটা string |
| Commerce event থেকে auto draft (নতুন product, sale শুরু, back-in-stock) | `autoPost` ধরনের কোনো যোগাযোগ নেই; Social আলাদা দ্বীপ |
| Insights-এর গভীরতা — time-series chart, account/platform তুলনা, follower growth, content-type (photo vs reel vs carousel) বিশ্লেষণ, report export | summary শুধু per-metric total + best-time; chart/export/follower snapshot নেই |
| Draft-এ team collaboration — internal note, version history, কে বানাল/কে বদলাল timeline | `versionHistory`/`internalNote` = 0 (approval আছে, কিন্তু note/version নেই) |
| Account health — token কবে মরবে, কোন permission missing, আগাম সতর্কতা | `lastError` আছে শুধু publish ব্যর্থ হওয়ার পর; proactive health check নেই |
| Bulk কাজ — CSV দিয়ে অনেক draft, একসাথে reschedule/delete | list একটানা load হয়, server pagination নেই; bulk endpoint নেই |
| FB/IG Stories, YouTube Shorts-এর আলাদা metadata (tags/playlist), Reels cover | `story` publishing নেই |

**আরেকটা কাঠামোগত সত্য:** web পেজটা এক ফাইলে 1,720 লাইন — Messaging redesign-এর (MS-পরবর্তী) মতো component-এ ভাঙা হয়নি; নতুন feature যোগ করলেই এটা আরও ভারী হবে। তাই UX পুনর্গঠন এই প্যাকেজের ভেতরেই রাখা হয়েছে (SU11)।

## ৩. শুরু করার আগের শর্ত (গুরুত্বপূর্ণ)

1. **SU0 — Live Verification Gate (কোড নয়, প্রমাণ):** SP/PP-র একটা feature-ও আসল অ্যাকাউন্টে প্রমাণিত হয়নি। নতুন feature বানানোর আগে অন্তত Meta publish পথটা live প্রমাণ করা উচিত — নইলে অপ্রমাণিত ভিতের ওপর তলা উঠবে। SU0 = আগের উত্তরে বলা session-গুলো: Meta (permission + আসল FB/IG post), Gemini key, TikTok inbox, YouTube Studio, আসল insights। **এটা মালিকের অ্যাকাউন্ট ছাড়া আটকে থাকে** — বাকি batch-গুলো এর জন্য আটকাবে না, কিন্তু SU12-র আগে SU0 বন্ধ করা বাধ্যতামূলক।
2. **Base ও migration range:** Connect Center track SocialAccount-এ হাত দিচ্ছে (CC3-তে `SocialAccount.appSource`) আর EC Phase 2 code-complete হয়ে integration বাকি। তাই SU-র worktree হবে সর্বশেষ integrated main থেকে, আর প্রথম migration-এর আগেই Cross-Track Migration Ledger-এ SU-র জন্য **`20261013400000` থেকে range claim** করতে হবে (CC-র জন্য 310000+ reserved-এর পরের ফাঁকা range)। প্রতিটা batch-এর gate-এ **fresh Postgres-এ পুরো migration sequence** চালানো বাধ্যতামূলক — cx7 outage-এর শিক্ষা (২০২৬-১০-১৩)।
3. **নিয়ম (আগের মতোই):** নতুন clean worktree (`ai-marketing-saas-su`, branch `su-package`), local commit only, GitHub push মালিকের সেই মুহূর্তের স্পষ্ট নির্দেশ ছাড়া নয়; platform post id ছাড়া "published" দাবি নয়; AI যা বানাবে তা draft — publish সবসময় মানুষের schedule/approval দিয়ে।

---

## ৪. প্যাকেজ — SU1–SU12

### Batch 1 — Composer-এর আসল শক্তি

**SU1 — Composer v2: Per-platform variant + First Comment + Preview + Clone**
- একটা post group (`SocialPostGroup` বা `postGroupId`) — একই content-এর প্রতি platform-এর আলাদা caption/link/media-order; group হিসেবে edit/schedule, row হিসেবে publish (বর্তমান per-account row মডেল অপরিবর্তিত ভিত্তি)
- **First comment:** প্রতি variant-এ আলাদা first-comment text (hashtag set/order link সেখানে রাখার চলতি practice); publish সফল হওয়ার পরেই platform-এ first comment পোস্ট — ব্যর্থ হলে post published-ই থাকে, first comment-এর ব্যর্থতা আলাদা field-এ হুবহু লেখা থাকে (post-কে failed বানানো নয়)। TikTok inbox/YouTube-তে first comment প্রযোজ্য নয় — UI-তে সৎভাবে অনুপস্থিত
- **Platform preview:** FB/IG/TikTok/YT ফ্রেমে আসল caption/media দিয়ে publish-পূর্ব preview (কোনো platform call নয়, খাঁটি UI)
- **Pre-flight validation:** platform-প্রতি নিয়ম (media সংখ্যা/aspect/text দৈর্ঘ্য/YouTube title দৈর্ঘ্য) schedule চাপার আগেই যাচাই — worker-এ গিয়ে ব্যর্থ হওয়ার বদলে composer-এই সতর্কতা
- **Clone:** যেকোনো post (publishedসহ) এক ক্লিকে নতুন draft — এটাই SP7 plan-এর evergreen প্রতিশ্রুতির ভিত্তি (SU2 তাতে recycle যোগ করবে)

**SU2 — Queue Slot + Recurring + Evergreen**
- Account-প্রতি **posting slot** (যেমন প্রতিদিন ১০টা ও রাত ৮টা, সাপ্তাহিক ছুটির দিন বাদ) — "Add to Queue" দিলে পরের খালি slot-এ নিজে থেকে বসে; calendar-এ slot দেখা যায়
- **Recurring series:** একই post-এর daily/weekly/monthly পুনরাবৃত্তি (যেমন প্রতি শুক্রবারের offer) — MS8 recurrence-এর ধাঁচে single finalize point, drift নেই, series থামানো/বিরতি দেওয়া যায়
- **Evergreen library:** post-কে evergreen হিসেবে mark করা; recycle নিয়ম tenant নিজে ঠিক করে (সর্বনিম্ন ব্যবধান, সর্বোচ্চ কতবার, শেষ প্রকাশের পর কতদিন) — নিয়ম ভেঙে কখনো নিজে থেকে publish নয়, queue-তে draft/scheduled হয়ে মানুষের চোখে পড়ে। Performance খারাপ হলে (SU7-এর data) recycle বন্ধের পরামর্শ, জোর করে নয়
- **Best-time one-click:** SP7 best-time এখন শুধু দেখায় — এবার "সেরা সময়ে schedule করো" বাটন সরাসরি ওই slot-এ বসাবে (data না থাকলে বাটনই থাকবে না, আগের সৎ নিয়মে)

### Batch 2 — Media ও AI

**SU3 — Media Library v2 + Editor**
- Folder + tag + নাম দিয়ে search, কোন asset কোন কোন post-এ ব্যবহৃত হয়েছে (usage), bulk select/delete (ব্যবহৃত asset মুছতে গেলে সতর্কতা)
- **Image editor (sharp দিয়ে, PP1-এর ভিত্তিতেই):** platform aspect-এ crop/resize (1:1, 4:5, 9:16, 16:9), derived asset হিসেবে সংরক্ষণ (মূল অপরিবর্তিত — PP1-এর derivedFrom ধাঁচ)
- **Video thumbnail/cover:** video থেকে frame তুলে cover বানানো (ffmpeg — production host-এ ffmpeg আছে কিনা SU0/SU12-তে যাচাই বাধ্যতামূলক; না থাকলে feature সৎভাবে unavailable দেখাবে, ভাঙবে না), Reels/YouTube upload-এ cover ব্যবহার যেখানে platform API দেয়

**SU4 — AI Content Engine v2**
- **Content pillars + মাসের content plan:** Business Brain + product catalog থেকে pillar (যেমন product showcase, offer, review, tips) ধরে এক মাসের post-এর খসড়া সূচি AI বানিয়ে দেয় — সবই draft, মানুষ বেছে schedule করে; কোনো সংখ্যা/দাম বানানো নয় (SP3-এর grounded নিয়মই)
- **Reel/Short script:** product থেকে hook + on-screen text + caption-এর script খসড়া (video বানানো নয় — script ও shot list); বাংলা/ইংরেজি
- **নিজের data থেকে hashtag পরামর্শ:** SU7-এর hashtag performance থেকে — কোন hashtag-এ নিজের post ভালো করেছে তা-ই পরামর্শে আসবে, বাইরের বানানো trend নয়; data না থাকলে পরামর্শ নেই
- Kill switch/daily cap/usage record — SP3-এর parity বজায় (নতুন feature key `social_content_plan`, `social_script`)

### Batch 3 — Commerce ও টাকার হিসাব

**SU5 — Commerce-Connected Auto Draft**
- Event থেকে **draft** (কখনোই সরাসরি publish নয়): নতুন product যোগ, sale/promotion শুরু (EC16), back-in-stock, price drop, review মাইলফলক (EC15 — যেমন ১০০তম review বা নতুন 5-star review দিয়ে poster draft), landing page প্রকাশ (EC13)
- Trigger নিয়ম org নিজে চালু/বন্ধ করে (Organization Settings-এ), প্রতি event-ধরনে সর্বোচ্চ draft সংখ্যার সীমা — draft জমে inbox ভরে যাবে না
- Draft-এ product-এর আসল ছবি (PP3 import), দাম, checkout/storefront link নিজে থেকে বসে — অনুমোদন দিয়ে schedule করা মানুষের কাজ

**SU6 — Link Tracking ও Revenue Association**
- Post-এর link-এ **UTM auto-build** (source=platform, medium=social, campaign=post-এর নাম/id) — MS6-এর pattern reuse
- নিজের domain-এ **tracked short link** (`/s/:code`, MS-এর HMAC click-redirect-এর ধাঁচ) — click count প্রতি post-এ, bot click বাদ দেওয়ার সৎ নিয়ম যা MS-এ আছে তা-ই
- Post → click → order এক পর্দায়: order সংখ্যা/টাকা **"association, attribution নয়"** labelসহ (MS7-এর সৎ ভাষাই) — last-click window org setting (default ৭ দিন)

### Batch 4 — Analytics ও Platform গভীরতা

**SU7 — Insights & Analytics v2**
- Time-series chart (দিন/সপ্তাহ ধরে reach/engagement), account ও platform পাশাপাশি তুলনা, content-type বিশ্লেষণ (photo vs carousel vs reels vs video — নিজের post-এর আসল insights থেকে)
- **Follower growth snapshot:** প্রতিদিন একবার Graph যা দেয় (Page fans/IG followers) তা snapshot — platform না দিলে graph-এ ফাঁক, বানানো সংখ্যা নয়
- Hashtag performance aggregation (SU4-এর ভিত্তি)
- **Monthly social report export:** CSV + PDF (tenant তার client/নিজের জন্য) — শুধু আসল সংখ্যা, basis countসহ (SP7-এর নিয়ম)

**SU8 — Publishing Depth (spike-first)**
- **FB/IG Stories:** আগে spike — Graph API বর্তমানে কোন account ধরনে story publishing দেয় তা যাচাই; প্রমাণ না মিললে item বাদ, জোর করে নয়
- **YouTube metadata পুরো:** title/description/tags/category/playlist বাছাই + Shorts চিহ্নিতকরণ (আলাদা কিছু নয়, vertical video + metadata-তেই); scheduled publish YouTube-এর নিজের নিয়মে যেখানে verification আছে
- **Cross-post derive:** একটা vertical video থেকে IG Reels + YouTube Shorts + TikTok inbox — তিনটে আলাদা variant এক ক্লিকে (SU1 group-এর ওপর)
- TikTok photo post ও direct post — **শুধু মালিকের app audit pass হলে** (SU0-র গেট), নইলে আগের অবস্থাই

### Batch 5 — Team, Reliability, UX

**SU9 — Collaboration v2**
- Draft-এ **internal note ও আলোচনা** (team comment — platform-এ যায় না), কে বানাল/কে বদলাল/কে approve করল তার **activity timeline**, **version history** (caption/media বদলালে আগের version, এক ক্লিকে restore — restore করলে approval reset, SP7 নিয়মে)
- Draft অন্য team member-কে assign করা; approval-এ optional দ্বিতীয় ধাপ (Manager → Owner) org setting-এ

**SU10 — Account Health ও Failure Center**
- **Health center:** প্রতি account-এ token অবস্থা, কোন permission আছে/নেই (Graph permissions endpoint দিয়ে যাচাই), মেয়াদ ফুরানোর আগাম ধারণা platform যা দেয় তা-ই; সমস্যা থাকলে reconnect-এর সরাসরি পথ (Connect Center track-এর সাথে সংঘাত নয় — ওখানকার connection row-ই ব্যবহার, আলাদা connect UI নয়)
- **Failure center:** সব failed post এক জায়গায়, error হুবহু + বাংলায় সরল ব্যাখ্যা, one-click retry (attempts নিয়ম মেনে), একই কারণে বারবার ব্যর্থ হলে Telegram/email alert (org setting)
- Publish-এর পূর্ণ audit trail প্রতি post-এ (কে schedule করল, worker কখন চালাল, platform কী ফেরত দিল)

**SU11 — Social Posts Page Redesign**
- Messaging redesign-এর ধাঁচে **tabbed workspace:** Composer / Calendar-Queue / Library / Analytics / Accounts & Settings — সব panel mounted, composer-এর লেখা tab বদলালে হারায় না
- Page-টা 1,720 লাইনের এক ফাইল থেকে component-এ ভাঙা; **server-side pagination + search/filter** post list-এ; bulk action (draft মুছা, একসাথে schedule বদল); **CSV bulk draft import**; mobile responsive যাচাই (আসল screenshot QA live app-এ, SU12-তে)

### Batch 6 — বন্ধ করা

**SU12 — Live Verification ও Hardening (SU0-র বাকি অংশসহ)**
- SU0-র সব session শেষ করা ও checklist-এ evidenceসহ tick
- পুরো migration sequence fresh Postgres-এ (cx7 পাঠ), production-এ ffmpeg/font যাচাই, S3 streaming live প্রমাণ (PP2-র বাকি সীমা বন্ধ করা)
- Live app-এ desktop + mobile screenshot QA, acceptance doc + deploy checklist

---

## ৫. যা এই প্যাকেজে নেই (মালিকের সিদ্ধান্ত ছাড়া হবে না)

- **X (Twitter)** — paid API, আগের plan-এর সিদ্ধান্তই বহাল
- **Facebook Group-এ post** — Meta Group API কার্যত বন্ধ; প্রতিশ্রুতি দেওয়া হবে না
- **Boost/Ad করা Social Posts পেজ থেকে** — ওটা Advertising-এর কাজ, এখানে মেশানো হবে না
- **Commerce trigger থেকে সরাসরি auto-publish** — SU5 ইচ্ছা করেই draft পর্যন্ত; auto-publish চাইলে মালিকের আলাদা সিদ্ধান্ত লাগবে (ব্র্যান্ড ঝুঁকি)
- **AI দিয়ে পুরো video তৈরি** — SU4 script পর্যন্ত; video generation provider-এর খরচ/মান আলাদা সিদ্ধান্ত
- **অন্যের (competitor) social data টানা** — Competitors module-এর এলাকা, এখানে নয়

## ৬. Batch ও Gate সারসংক্ষেপ

| Batch | Item | মূল নির্ভরতা |
|---|---|---|
| B0 | SU0 live verification (মালিকের অ্যাকাউন্ট) | Meta/TikTok/Google app — মালিক |
| B1 | SU1 + SU2 | SU1-এর group মডেল |
| B2 | SU3 + SU4 | sharp/ffmpeg (SU3), SU7-এর data ছাড়া SU4 hashtag অংশ সীমিত |
| B3 | SU5 + SU6 | EC15/EC16 (integrated main-এ থাকতে হবে), MS6/MS7 pattern |
| B4 | SU7 + SU8 | SU8 stories = spike ফলাফলের ওপর |
| B5 | SU9 + SU10 + SU11 | Connect Center-এর connection মডেল |
| B6 | SU12 | SU0-র সব session |

প্রতি batch-এর gate: API jest full + web vitest + tsc 0/0 + build green + fresh-Postgres migration sequence + acceptance doc। কোনো batch-ই push নয় — push মালিকের স্পষ্ট নির্দেশে, আগের নিয়মে।
