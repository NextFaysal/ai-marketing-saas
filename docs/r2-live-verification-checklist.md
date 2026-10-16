# RM0 — R2 Live Verification Checklist (deploy-পরবর্তী, মালিকের হাতে)

**নিয়ম:** এই তালিকার একটা বাক্সও কোড/স্পেক দিয়ে টিক দেওয়া যাবে
না — প্রতিটা ধাপ আসল Cloudflare bucket, আসল ডোমেইন আর আসল
অ্যাকাউন্টে হাতে করে যাচাই করতে হবে (M30-এর ধরনেই)। Sandbox-এ
সব storage seam fake ছিল; লাইভ প্রমাণ শুধু এখানেই তৈরি হবে।
সব বাক্স বর্তমানে **অচিহ্নিত**।

## ০. পূর্বশর্ত

- [ ] GitHub-এ R2 release push হয়েছে এবং Dokploy Redeploy সম্পন্ন
  (migration `20261016000000_rb2_stored_file` ও
  `20261016100000_rb6_digital_storage_key` লাইভ DB-তে চলেছে —
  API health/boot লগে ত্রুটি নেই)।
- [ ] Dokploy env-এ আছে: `MEDIA_S3_BUCKET` (বা `MEDIA_R2_PRIVATE_BUCKET`),
  `MEDIA_S3_ENDPOINT`, `MEDIA_S3_REGION=auto`,
  `MEDIA_S3_ACCESS_KEY_ID`, `MEDIA_S3_SECRET_ACCESS_KEY`,
  `MEDIA_R2_PUBLIC_BUCKET` (এবং চাইলে `MEDIA_R2_BACKUP_BUCKET`)।
- [ ] Cloudflare-এ bucket দুটোই আছে: public bucket-এ
  `media.qosprey.com` custom domain Active; private bucket-এ
  কোনো custom domain/r2.dev public access **নেই**।

## ১. Round-trip প্রমাণ (RB1)

- [ ] API কন্টেইনারের ভেতর থেকে চালান:
  `node apps/api/scripts/verify-media-store.mjs`
  — সব ধাপ (PUT → GET sha মিল → HEAD → stream → presigned GET
  → DELETE → gone-check) PASS, exit 0।
- [ ] R2 dashboard-এ `_probe/` object আর অবশিষ্ট নেই (স্ক্রিপ্ট
  নিজেই পরিষ্কার করে)।

## ২. প্রোডাক্ট ছবি (RM4)

- [ ] Dashboard-এ একটা আসল প্রোডাক্টে ছবি আপলোড করুন (drag-drop)
  — গ্যালারিতে ছবি দেখা যাচ্ছে।
- [ ] ছবির URL `https://media.qosprey.com/{org}/product/…` —
  ব্রাউজারে সরাসরি খুললে লোড হয়; R2 dashboard-এ public
  bucket-এ একই key-র object আছে।
- [ ] Shop পেজে সেই প্রোডাক্টের ছবি CDN ডোমেইন থেকে লোড হচ্ছে
  (DevTools Network-এ host = media.qosprey.com)।
- [ ] বাইরের URL-ওয়ালা প্রোডাক্টে "ছবি নিজের স্টোরেজে নিন"
  (mirror) চালান — সারাংশে mirrored সংখ্যা; প্রোডাক্টের ছবির
  URL CDN ডোমেইনে বদলে গেছে; মূল হোস্টের ছবি মুছে/বন্ধ
  থাকলেও দোকানের ছবি অক্ষত।

## ৩. Social / লোগো / Creative (RM5 + RM8)

- [ ] Social লাইব্রেরিতে ছবি আপলোড → public link নিন — URL
  CDN ডোমেইনের; লিংকটি লগআউট অবস্থায়/অন্য ব্রাউজারে খোলে।
- [ ] একটা আসল পোস্ট publish (M30/SU0 session-এর সঙ্গে মিলিয়ে)
  — Meta/IG সরাসরি CDN URL থেকে ছবি/ভিডিও টেনে publish সফল।
- [ ] Organization লোগো বদলান — নতুন লোগো CDN URL-এ লোড;
  পুরনো লোগোর ক্যাশ সমস্যা নেই (hash-versioned key)।
- [ ] Creative Library-তে ফাইল আপলোড — asset তৈরি হয় CDN
  sourceUrl দিয়ে।

## ৪. Inbox প্রাইভেট মিডিয়া (RM5)

- [ ] আসল চ্যানেলে (WhatsApp/Messenger) ছবি পাঠিয়ে ইনবক্সে
  দেখুন — অ্যাপের ভেতরে ছবি দেখা যাচ্ছে (presigned পথে)।
- [ ] সেই ছবির presigned URL মেয়াদ শেষের পর খুললে অ্যাক্সেস
  মেলে না; private bucket-এর object কোনো পাবলিক URL-এ
  কোনোভাবেই খোলে না।

## ৫. Transformations (RM6)

- [ ] Cloudflare zone-এ Images → Transformations চালু করুন।
- [ ] একটা CDN ছবির URL-এ `/cdn-cgi/image/width=200,quality=85,format=auto/`
  বসিয়ে খুলুন — ছবি সত্যিই 200px প্রস্থে আসছে (bytes মেপে
  প্রমাণ: transformed < original)।
- [ ] Shop পেজে প্রোডাক্ট কার্ডের ছবি transformed URL-এ লোড
  হচ্ছে; Transformations বন্ধ থাকা অবস্থায় MediaImage
  fallback-এ মূল ছবি দেখা গেছে (deploy-এর আগের অবস্থা)।

## ৬. Media Library পেজ (RM7)

- [ ] Dashboard → Media Library খুলুন — product/social/branding/
  creative/library সব surface-এর ফাইল এক গ্রিডে।
- [ ] ফিল্টার (surface/kind) ও সার্চ কাজ করে; private ফাইলের
  URL কপি করলে সেটা presigned (মেয়াদসহ)।
- [ ] লাইব্রেরিতে ছবি আপলোড ও একটা ফাইল trash করে দেখুন —
  তালিকা থেকে সরে যায় (আসল object RM11 retention-এর পর মোছে)।

## ৭. ডিজিটাল প্রোডাক্ট (RM9)

- [ ] একটা প্রোডাক্টে ডিজিটাল ফাইল আপলোড করুন (presign →
  complete); প্রোডাক্টে `digital` চালু ও hosted key সেট।
- [ ] আসল অর্ডার সম্পন্ন (delivered/completed) করে tracking
  পেজ থেকে ডাউনলোড লিংক নিন — ফাইল ডাউনলোড হয়।
- [ ] সেই presigned লিংক ৫ মিনিট পর খুললে কাজ করে না।
- [ ] `digitalAccessLimit` বসিয়ে সীমার বেশি reveal হয় না।

## ৮. মাইগ্রেশন টুল (RM10)

> **ক্রম সতর্কতা:** env চালু হওয়ার পর থেকে অনুলিপি-না-হওয়া
> পুরনো local মিডিয়া সাময়িকভাবে দেখা যাবে না (dual-read নেই)।
> তাই Redeploy-এর পরপরই, অন্য যাচাইয়ের আগে, এই ধাপটা শেষ
> করুন।

- [ ] Admin দিয়ে `POST /admin/media-migration/scan` — সংখ্যা
  বাস্তবসম্মত (লাইভে পুরনো local ফাইল যত ছিল)।
- [ ] `POST /admin/media-migration/run` (ছোট batchSize দিয়ে
  শুরু) — copied/failed রিপোর্ট দেখুন; failed থাকলে কারণ
  মিটিয়ে আবার চালান (idempotent — আগেরগুলো skip হবে)।
- [ ] মাইগ্রেশনের পর পুরনো একটা ইনবক্স ছবি ও একটা সোশ্যাল
  ছবি অ্যাপে খুলে দেখুন — অক্ষত।
- [ ] লোকাল `.media-store` ফোল্ডার এখনই মুছবেন না — অন্তত এক
  রিলিজ-চক্র রাখুন (প্ল্যান RM10)।

## ৯. Lifecycle ও Backup (RM11)

- [ ] একটা ফাইল trash করে `media_lifecycle_sweep` job চালান
  (Automation থেকে enable) — result-এ counts আসে; trash করা
  ফাইল retention-এর আগে মোছে না।
- [ ] `_quarantine/`-এ পুরনো অবশিষ্ট object sweep-এ মুছেছে।
- [ ] `MEDIA_R2_BACKUP_BUCKET` বসিয়ে sweep চালান — backup
  bucket-এ `backup/registry-{তারিখ}.json` এসেছে এবং গত
  ২৪ ঘণ্টার private object কপি হয়েছে।
- [ ] Backup থেকে পুনরুদ্ধার মহড়া: snapshot JSON থেকে একটা
  key নিয়ে আসল bucket-এ object আছে কিনা মিলিয়ে দেখুন।

## ১০. Admin Storage কার্ড (RM12) ও স্থায়িত্ব

- [ ] Admin Command Center-এ Storage কার্ড — mode badge "R2",
  মোট ফাইল/বাইট R2 dashboard-এর মোটের কাছাকাছি (registry
  শুধু নথিভুক্ত ফাইল গোনে — RM10 backfill-এর আগে সংখ্যা
  কম থাকা স্বাভাবিক)।
- [ ] Dokploy Redeploy করুন — সব মিডিয়া (প্রোডাক্ট ছবি,
  লোগো, ইনবক্স) আগের মতোই আছে (আজকের local-মোড ঝুঁকির
  বিপরীত প্রমাণ)।
