# NF2 Spike — Short Video Studio: ভিডিও প্রোভাইডার সিদ্ধান্ত

**তারিখ:** ২০২৬-১০-১৭ · **প্যাকেজ:** New Features Frontier, Batch FB1 (NF2) · **ধাপ:** Step-0 design notes
**সিদ্ধান্তের অবস্থা:** External AI video provider **এখনো বেছে নেওয়া হয়নি** —
owner decision D3 pending। এই নথি সেই অবস্থাটাই রেকর্ড করে এবং v1-এর
port + local rendering পথটা নির্দিষ্ট করে।

---

## ১. সিদ্ধান্ত: provider অ-নির্বাচিত, port-first design

- কোনো external AI video-generation provider (Runway / Pika /
  Kling / Luma ইত্যাদির কোনোটাই) এই spike-এ বেছে নেওয়া হয়নি।
  Provider বাছাই খরচ ও গুণমানের সিদ্ধান্ত — সেটা owner-এর D3;
  D3 না এলে কোনো provider-এর API ধরে কোড লেখা হবে না।
- তাই NF2 একটা **VideoRenderProvider PORT** দিয়ে শুরু হবে:
  service layer শুধু port-টাকেই চেনে; provider বাছাই হলে নতুন
  implementation port-এর পেছনে বসবে, service বদলাবে না।
- **v1 implementation = local ffmpeg template rendering** —
  পণ্যের ছবি + টেক্সট overlay + সাইজ/ফরম্যাট টেমপ্লেট থেকে
  ffmpeg দিয়ে short video render। কোনো AI generation দাবি
  করা হচ্ছে না: v1 যা বানায় তা template render, AI-generated
  video নয় — UI/doc-এ সেভাবেই লেবেল থাকবে।

## ২. ffmpeg প্রাপ্যতা — যাচাইকৃত তথ্য

| পরিবেশ | ffmpeg আছে? | প্রমাণ |
|---|---|---|
| এই dev machine | **হ্যাঁ — 8.1.2** | `ffmpeg -version` → `ffmpeg version 8.1.2` (2026-10-17-এ চালিয়ে দেখা) |
| Production runtime image | **না (বর্তমানে)** | Repo root `Dockerfile`-এর runtime stage-এর একমাত্র apt line: `openssl ca-certificates fontconfig fonts-noto-core` — ffmpeg নেই। একই image api / web / admin / worker — চার সার্ভিসেই চলে (`docker-compose.dokploy.yml`)। |

অর্থাৎ dev machine-এ render চললেও, বর্তমান production image-এ
render job চালালে ffmpeg binary পাওয়া যাবে না।

## ৩. Design consequence

1. **FB1-এ Dockerfile বদল:** root `Dockerfile`-এর runtime stage-এর
   apt line-এ `ffmpeg` যোগ হবে (একই `apt-get install` লাইনে)।
   বদলটা কার্যকর হবে শুধু owner-এর পরবর্তী **Dokploy redeploy**-এর
   পর — ততদিন production-এ ffmpeg নেই, এটা লুকানো হবে না।
2. **Honest runtime failure:** render job শুরুর আগে binary-এর
   অস্তিত্ব যাচাই করবে। Binary না থাকলে job **labelled error**
   দিয়ে fail করবে (কারণসহ: ffmpeg অনুপস্থিত) এবং **কোনো asset
   তৈরি হবে না** — খালি/ভুয়া video asset কখনো সফল হিসেবে
   রেকর্ড হবে না।
3. Template rendering-এর ইনপুট শুধু org-এর নিজের media/product
   ডেটা; বাইরের কোনো সার্ভিসে কিছু পাঠানো হয় না v1-এ। External
   provider পরে এলে (D3) সেই পাঠানো হবে port-এর নতুন
   implementation-এর ভিতরে, আলাদা সিদ্ধান্ত ও acceptance সহ।

## ৪. যা এই spike সিদ্ধান্ত নেয়নি

- External provider-এর নাম, pricing, API shape — সবই D3 পর্যন্ত
  স্থগিত। কোনো provider-এর ডক এই নথিতে "যাচাইকৃত" বলে দাবি
  করা হয়নি।
- Render job-এর queue/worker বিন্যাস NF2 implementation batch-এর
  কাজ — এই নথি শুধু port, ffmpeg শর্ত আর honest-failure নিয়মটা
  নির্দিষ্ট করে।
