# Social Posts Live Verification Checklist (SU0/SU12) — মালিকের জন্য

**অবস্থা: এই ডকুমেন্টটি শুধু প্রস্তুতি। প্রতিটি আইটেম OPEN / অযাচাইকৃত।**
কোনো আইটেমকে "live-proven" বলা যাবে শুধু তখনই, যখন আসল অ্যাকাউন্টে
সেটি করে দেখা হয়েছে এবং নিচে উল্লেখিত প্রমাণ (evidence) সংরক্ষণ করা
হয়েছে। Stub/fixture/spec টেস্টে পাস করা মানে live প্রমাণ নয় — পুরো
SU প্যাকেজ (এবং তার আগের SP1–SP9 + PP1–PP4-ও) এখন পর্যন্ত শুধু
boundary-প্রমাণিত।

প্রতিটি আইটেমের পাশে যাচাই শেষে লিখুন: তারিখ, কে করলেন, প্রমাণের
লিংক/স্ক্রিনশট, এবং ফলাফল (proven / failed + প্ল্যাটফর্মের verbatim
error)। Session গুলো যেকোনো ক্রমে করা যায়, তবে S1 সবার আগে —
Meta connect বাকি অনেক session-এর ভিত্তি।

---

## ক. Deploy পূর্বশর্ত (সব session-এর আগে)

- [ ] মালিকের স্পষ্ট নির্দেশে su-package push + integration সম্পন্ন
      (final integration tree-তে fresh-Postgres পুরো migration
      sequence আবার যাচাই করা — package summary-র deploy checklist
      দেখুন; parallel CC Advanced `20261013310000+` ও EC Phase 3
      `20261013500000+` লাইনের সাথে union-এ কোনো migration বাদ বা
      renumber হয়নি)
- [ ] SU-র ৫টি migration production DB-তে চলেছে (`prisma migrate
      deploy` সফল, আউটপুট সংরক্ষিত):
      `20261013400000_su1_su2_composer_queue`,
      `20261013410000_su3_su4_media_ai`,
      `20261013420000_su5_su6_commerce_links`,
      `20261013430000_su7_su8_analytics_publishing`,
      `20261013440000_su9_su11_collab_health`
- [ ] API/web/worker নতুন build-এ Dokploy Redeploy (মালিকের হাতে),
      API `/health` ঠিক আছে
- [ ] Env: `API_PUBLIC_URL` API-তে সেট আছে (না থাকলে SU6 tracked
      link তৈরি হবে না — S7-এ ধরা পড়বে)
- [ ] প্রতি org-এ Automations job template চালু (Dashboard →
      Automations): `social_publish_due` (৫ মিনিট),
      `social_evergreen_sweep` (দৈনিক), `social_follower_snapshot`
      (দৈনিক) — যাচাই: একটি run শেষে COMPLETED দেখা

---

## S1. Meta connect + Facebook publish + first comment + story

**আনতে হবে:** মালিকের Meta app (App ID/Secret, Admin → Platform
Config-এ বসানোর জন্য) যাতে `pages_manage_posts` ও
`instagram_content_publish` permission আছে (বা tenant-এর নিজের
app — Connect Center-এর own-app পথ), একটি আসল Facebook Page,
Page-এর সাথে যুক্ত Instagram Business/Creator account।

**করতে হবে:**
- [ ] Social Posts (বা Connect Center) থেকে Page connect —
      verify-before-save সফল, account `connected` অবস্থায় এসেছে
- [ ] Text-only post publish-now → Facebook-এ আসল post দেখা যাচ্ছে
- [ ] Photo post publish → ছবিসহ post live
- [ ] Video post publish → video post live (বড় video হলে PP2
      streaming upload-ও একই সাথে যাচাই হয় — S10-এর সাথে মিলিয়ে
      নিন)
- [ ] First comment সেট করে post → publish সফল হওয়ার পর প্রথম
      comment টি Facebook-এ post-এর নিচে এসেছে; SU পেজে
      `firstCommentStatus = posted` দেখাচ্ছে
- [ ] FB Page photo story (SU8): একটি ছবি দিয়ে story post →
      Facebook-এ story দেখা যাচ্ছে, post row-তে documented
      stories URL আকারে `platformUrl` এসেছে
- [ ] Settings → Health & Failures-এ এই account-এ check-health
      চালান → `ok` এসেছে, `healthCheckedAt` stamp বসেছে

**Pass evidence:** প্রতিটি post-এর আসল `platformPostId` /
platform URL + Facebook-এ live post/story-র স্ক্রিনশট; first
comment-এর স্ক্রিনশট।

## S2. Instagram publish

**আনতে হবে:** S1-এর Page-যুক্ত IG Business/Creator account;
ছবি public URL-এ পৌঁছানো যায় এমন অবস্থা (API public media route
deploy-এ চলছে কিনা এই session-এই প্রমাণ হবে)।

**করতে হবে:**
- [ ] Single photo post publish → Instagram-এ live
- [ ] Reels (video) post publish → Reels live, container polling
      সফলভাবে শেষ হয়েছে
- [ ] Carousel (২–১০টি ছবি) publish → carousel live (PP4)
- [ ] Template Poster (SVG → PP1 PNG rasterize) দিয়ে post →
      Instagram-এ ছবি ঠিকভাবে এসেছে (বাংলা লেখা poster হলে
      production font-ও যাচাই হয় — S10)
- [ ] First comment IG post-এও এসেছে

**Pass evidence:** IG permalink + স্ক্রিনশট; carousel-এর সব
ছবি দেখা যাচ্ছে এমন প্রমাণ।

## S3. AI — Gemini image + AI copy / content plan / reel script

**আনতে হবে:** আসল Gemini (বা org-এর নিজের, CC8 OrgLlmConfig)
API key — Admin/Connect Center-এর verify-before-save ফর্মে
বসানোর জন্য; key কখনো chat-এ পেস্ট নয়।

**করতে হবে:**
- [ ] Image provider config: verify-before-save-এ আসল ছোট্ট test
      generation সফল হয়ে তবেই config save হয়েছে (ব্যর্থ হলে
      save হয় না — সেই আচরণটাও একবার ভুল key দিয়ে দেখে নিন)
- [ ] AI image দিয়ে একটি আসল ছবি তৈরি → MediaAsset হিসেবে এসেছে
      → সেই ছবি দিয়ে S1/S2-তে একটি আসল post publish
- [ ] AI copy (SP3): একটি আসল product দিয়ে caption variant তৈরি
      — দাম/তথ্য product-এর আসল data-র সাথে মিলেছে, বানানো সংখ্যা
      নেই (number guard)
- [ ] SU4 content plan: একটি আসল plan generate → পছন্দের item
      materialize করে draft → মানুষ schedule করে publish
- [ ] SU4 reel script: একটি script তৈরি — script টি RETURN ONLY
      (কিছু publish হয়নি), সেটাই প্রত্যাশিত আচরণ

**Pass evidence:** তৈরি ছবি/plan/script-এর স্ক্রিনশট + publish
হওয়া post-এর platform URL; ভুল key-তে save না হওয়ার verbatim
error নোট।

## S4. TikTok inbox upload

**আনতে হবে:** TikTok app (client key/secret — Admin → Platform
Config; app audit pass না হলে এটাই v1-এর সৎ সীমা), একটি আসল
TikTok creator account।

**করতে হবে:**
- [ ] TikTok connect (OAuth) — config না থাকলে সৎ বাংলা 400 আসে,
      ভাঙা redirect নয় (সেই অবস্থাটাও নোট করুন)
- [ ] একটি আসল video scheduled/publish → video টি creator-এর
      TikTok **inbox/draft**-এ পৌঁছেছে; SU-তে status
      `sent_to_creator`, `publishedAt` খালি, publishNote-এ
      app-এ গিয়ে post শেষ করার কথা লেখা — **"published" দাবি
      করা হয়নি**
- [ ] Creator app থেকে post টি শেষ করে দেখুন

**Pass evidence:** TikTok inbox-এ video-র স্ক্রিনশট + SU পেজে
`sent_to_creator` অবস্থার স্ক্রিনশট। (Direct public post শুধু
মালিকের app audit pass হলেই — না হলে এই session এখানেই সৎভাবে
শেষ।)

## S5. YouTube upload + metadata + cover

**আনতে হবে:** Google OAuth client (Admin → Platform Config),
একটি আসল YouTube channel। Redirect URI:
`https://api.qosprey.com/social/oauth/youtube/callback`
(deploy domain অনুযায়ী মিলিয়ে নিন)।

**করতে হবে:**
- [ ] YouTube connect (OAuth) → channel বেছে নেওয়া সম্পন্ন
- [ ] একটি আসল video upload → YouTube Studio-তে video দেখা
      যাচ্ছে, privacy **Private** হিসেবেই labelled (unverified
      app-এর YouTube lock — Public দাবি নয়)
- [ ] SU8 metadata: `youtubeTitle`, tags, category, `#Shorts`
      (isShort) দিয়ে upload → Studio-তে metadata হুবহু এসেছে
- [ ] Cover: library থেকে cover frame বানিয়ে (S10-এর ffmpeg
      যাচাইয়ের সাথে যুক্ত) `coverAssetId` দিয়ে upload →
      Studio-তে thumbnail সেট হয়েছে; cover ব্যর্থ হলে post
      published-ই থাকে ও `publishNote`-এ verbatim error থাকে —
      সম্ভব হলে সেই পথটাও দেখুন

**Pass evidence:** YouTube Studio-র স্ক্রিনশট (video + metadata +
thumbnail) + watch URL।

## S6. Insights / follower snapshot / best-time

**আনতে হবে:** S1/S2/S5-তে publish হওয়া আসল post গুলোই এই
session-এর উপকরণ — আলাদা কিছু লাগে না, তবে সময় লাগবে (data
জমতে হয়)।

**করতে হবে:**
- [ ] একটি published post-এ insights refresh → Graph যা ফেরত
      দিয়েছে হুবহু সংরক্ষিত; platform যা দেয়নি তা absent
      (0 নয়)
- [ ] Bulk refresh (শেষ ৩০ দিন) চালান — ১ ঘণ্টার কম বয়সী post
      skip হওয়ার নিয়মটা মিলিয়ে দেখুন
- [ ] `social_follower_snapshot` job এক চক্র চলার পর Analytics-এ
      follower snapshot এসেছে (platform সংখ্যা না দিলে snapshot
      হয় না — সেটাই সৎ আচরণ)
- [ ] Analytics v2: timeseries / content-type / account তুলনার
      সংখ্যা platform-এর আসল সংখ্যার সাথে মিলেছে; monthly
      report CSV + PDF download হয়েছে (PDF-তে বাংলা caption
      থাকে না — WinAnsi সীমা, CSV-তে পূর্ণ record)
- [ ] Best-time: অন্তত ১০টি scored post জমলে best-time দেখাচ্ছে
      ও one-click schedule সেই সময়েই বসছে; তার আগে "পর্যাপ্ত
      data নেই" — দুটো অবস্থাই নোট করুন

**Pass evidence:** Analytics পেজের স্ক্রিনশট + platform-এর
নিজের analytics-এর সাথে অন্তত একটি সংখ্যা মিলিয়ে দেখার নোট।

## S7. Tracked link click + order association

**আনতে হবে:** S1-তে connect করা Page, org-এর আসল
store/checkout (যেখানে tracker + attribution চলছে), একটি
test order দেওয়ার সুযোগ।

**করতে হবে:**
- [ ] Link-সহ একটি post publish → Facebook-এ post-এর link টি
      tracked URL (`<API_PUBLIC_URL>/public/social/r/…`) হয়ে
      এসেছে (`API_PUBLIC_URL` না থাকলে কাঁচা link আসবে — সেটা
      env সমস্যা, এই session-এই ঠিক করুন)
- [ ] আসল browser থেকে link-এ click → আসল landing/checkout
      পেজে redirect হয়েছে; SU-তে click count ১ বেড়েছে
- [ ] Preview/bot ধরনের hit-এ click count বাড়েনি (যাচাই করা
      গেলে)
- [ ] Click-এর পর (association window-এর মধ্যে, default ৭ দিন)
      একটি আসল order → post-এর link stats-এ order টি
      **"association, attribution নয়"** labelসহ দেখা যাচ্ছে

**Pass evidence:** tracked URL-এর স্ক্রিনশট + click/order
সংখ্যার স্ক্রিনশট; order টির ID।

## S8. Commerce auto-draft

**আনতে হবে:** SU deploy হওয়া org-এ আসল product catalog;
auto-draft target হিসেবে connect করা একটি meta_page account।

**করতে হবে:**
- [ ] Settings-এ auto-draft config: একটি toggle (যেমন নতুন
      product) চালু + target account + দৈনিক cap বসান — সব
      toggle default FALSE ছিল তা আগে মিলিয়ে নিন
- [ ] একটি আসল নতুন product তৈরি → একটি **DRAFT** auto-draft
      post এসেছে (নিজে থেকে কিছু publish/schedule হয়নি);
      caption-এ আসল নাম + আসল দাম, `linkUrl` খালি (নথিভুক্ত
      সৎ সীমা)
- [ ] একটি promotion চালু/activate → draft এসেছে (EC16 লাইনের
      event); একই promotion-এ দ্বিতীয়বার draft আসেনি
- [ ] Inventory manual adjust দিয়ে একটি product back-in-stock
      (0 → ধনাত্মক) → draft এসেছে। (Store sync/edit দিয়ে stock
      ফিরলে v1-এ draft আসে না — নথিভুক্ত সীমা, মিলিয়ে নিন)
- [ ] একটি আসল review দিন → review toggle চালু থাকলে নিয়ম
      অনুযায়ী draft (milestone = মোট review-এর ৫০-এর গুণিতক,
      নইলে 5-star)
- [ ] দৈনিক cap ছাড়িয়ে যাওয়ার চেষ্টা → cap-এর বেশি draft
      তৈরি হয়নি

**Pass evidence:** draft গুলোর স্ক্রিনশট (auto-draft badgeসহ) +
audit-এ `social.auto_draft_created` row।

## S9. Queue / evergreen / follower job — এক পূর্ণ চক্র

**আনতে হবে:** S1-এর connect করা account; হাতে সময় (job চক্র
দেখতে অন্তত একদিন, বা job template হাতে চালানোর সুযোগ)।

**করতে হবে:**
- [ ] Posting slot বসান (যেমন আজকের একটি সময়) → একটি draft-এ
      "Add to Queue" → post টি ঠিক ওই slot-এ scheduled হয়েছে;
      একই slot দখল থাকলে পরের খালি slot-এ গেছে
- [ ] Scheduled সময় এলে `social_publish_due` job post টি আসলেই
      publish করেছে (platform URL এসেছে)
- [ ] Recurring: daily series দিয়ে একটি post → publish হওয়ার
      পর ঠিক একটি পরের occurrence scheduled হয়েছে (duplicate
      নয়, সময়ে drift নেই); series থামালে আর আসে না
- [ ] Evergreen: একটি published post evergreen mark করে gap
      পেরোনোর পর `social_evergreen_sweep` এক চক্র → একটি নতুন
      **DRAFT** কপি এসেছে (নিজে থেকে publish হয়নি); max cycles
      ফুরালে আর কপি আসে না
- [ ] Follower snapshot job-এর একটি COMPLETED run (ক-এর
      পূর্বশর্তের সাথে একই run হলেও চলবে — এখানে ফলাফলটা
      S6-তে গিয়ে মিলিয়ে নিন)

**Pass evidence:** queue/scheduled/published অবস্থার স্ক্রিনশট
+ Automation run তালিকায় তিন job-এর COMPLETED run।

## S10. Production host যাচাই (ffmpeg, fonts, S3, বড় video)

**আনতে হবে:** production host/container-এ shell access
(Dokploy), S3 ব্যবহার করতে চাইলে আসল bucket + credential
(Admin/env-তে বসানোর জন্য — chat-এ নয়)।

**করতে হবে:**
- [ ] API container-এ `ffmpeg -version` চলেছে — SU3 video cover
      ও IN5 transcoding-এর ভিত্তি। না থাকলে cover feature
      সৎভাবে unavailable দেখাবে; ffmpeg বসানো মালিকের deploy
      সিদ্ধান্ত
- [ ] Fonts: container-এ Noto (বাংলাসহ) font আছে কিনা
      (`fc-list | grep -i noto`) — S2-র বাংলা poster publish
      দিয়েও প্রমাণ করা যায়; font না থাকলে poster-এ বাংলা
      লেখা আসবে না
- [ ] S3 (শুধু S3 ব্যবহার হলে): `MEDIA_S3_BUCKET`,
      `MEDIA_S3_ENDPOINT`/`MEDIA_S3_REGION`,
      `MEDIA_S3_ACCESS_KEY_ID`, `MEDIA_S3_SECRET_ACCESS_KEY`
      production env-এ সেট করে API restart → MediaStore S3
      mode-এ এসেছে (log/আচরণে নিশ্চিত হোন)
- [ ] বড় video round-trip: S3 mode-এ একটি বড় video (যেমন
      ৫০–২০০ MB) upload → asset তৈরি হয়েছে → ranged streaming
      দিয়ে video টি চলেছে → সেই asset দিয়ে একটি TikTok inbox
      বা YouTube upload (S4/S5-এর সাথে মিলিয়ে) সম্পন্ন —
      **এটাই PP2 S3 streaming পথের প্রথম আসল প্রমাণ**;
      sandbox-এ কোনো S3 credential না থাকায় আগে এটি করা
      যায়নি
- [ ] Screenshot QA: deploy হওয়া live app-এ Social Posts-এর
      ৫-tab workspace desktop ও mobile-এ খুলে দেখুন — tab
      বদলালে composer-এর লেখা হারায় না, প্রতিটি panel আসে;
      স্ক্রিনশট সংরক্ষণ করুন (sandbox-এ live app না থাকায়
      পুরো SU প্যাকেজে কোনো screenshot QA হয়নি)

**Pass evidence:** `ffmpeg -version` ও `fc-list` আউটপুট, বড়
video asset-এর স্ক্রিনশট/URL, desktop + mobile স্ক্রিনশট।

---

## প্রমাণ সংরক্ষণের নিয়ম

- প্রতিটি proven আইটেমের জন্য অন্তত একটি: স্ক্রিনশট,
  প্ল্যাটফর্মের post/video/order ID বা URL, অথবা AuditLog/
  Automation run-এর row।
- ব্যর্থ আইটেম লুকাবেন না: verbatim error টি হুবহু লিখে রাখুন
  — সেটাই পরের fix-এর ভিত্তি। Platform permission/audit
  আটকে থাকলে (Meta App Review, TikTok audit, YouTube
  verification) আইটেমটি **blocked** হিসেবে রেখে কারণটি
  লিখুন; অনুমান দিয়ে tick নয়।
- এই checklist-এর একটি পূরণকৃত কপি goal ফাইলে সংরক্ষণ করুন
  এবং `docs/social-update-package-summary.md`-এর SU0 অবস্থা
  হালনাগাদ করুন।
