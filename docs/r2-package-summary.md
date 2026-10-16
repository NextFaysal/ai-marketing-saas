# R2 Media Program — Package Summary (RM1–RM12 নিরীক্ষা)

**তারিখ:** 2026-10-15 · **Branch:** `r2-media` (base: GitHub main
`49dac3e`) · **ব্যাচ:** RB1–RB6 + RB6b (ফলো-আপ), সব code-complete,
লোকাল কমিট শুধু — **push হয়নি** (মালিকের শর্তাধীন অনুমোদন
অনুযায়ী release push এই প্যাকেজের বাইরের ধাপ)।

**এক-লাইনের অবস্থা:** কোড সম্পূর্ণ; **লাইভ প্রমাণ সম্পূর্ণ বাকি**
— কোনো আসল R2 round-trip আজ পর্যন্ত হয়নি। Deploy + মালিকের
RM0 যাচাই (`docs/r2-live-verification-checklist.md`) ছাড়া এই
প্যাকেজ "লাইভ সম্পূর্ণ" বলা যাবে না।

## আইটেম-ধরে নিরীক্ষা

| # | আইটেম | অবস্থা | কোথায় / মন্তব্য |
|---|--------|--------|-------------------|
| RM1 | env দিয়ে R2 চালু + verify স্ক্রিপ্ট | ✅ BUILT (কোড/পরিবেশ) | RB1 `1bfcf92`; compose passthrough + `verify-media-store.mjs`। আসল round-trip **লাইভ-বাকি** (মালিকের env+Redeploy-এর পর) |
| RM2 | StorageService (multipart, presign PUT/GET, copy, list, দুই bucket) | ✅ BUILT | RB2 `439de8b`; SDK শূন্য, হাতে-লেখা SigV4-ই প্রসারিত। আসল bucket-এ multipart/copy **লাইভ-বাকি** |
| RM3 | StoredFile registry + per-org পরিমাপ | ✅ BUILT | RB2 `88cf608`/`cd9b927`; migration `20261016000000`। **Quota enforcement NOT BUILT — ইচ্ছাকৃত:** মান মালিকের সিদ্ধান্ত (D4), পরিমাপই চালু |
| RM4 | প্রোডাক্ট ছবি আসল আপলোড + বাইরের URL মিরর | ✅ BUILT | RB3 `badba40`…`28a67e7`; presign→quarantine→sniff→CDN। **Scheduled/auto মিরর wiring RB6b-তে BUILT** (`product_image_mirror_sweep` job + D3 opt-out; `docs/r2-rb6b-acceptance.md`) |
| RM5 | Social/লোগো/Inbox/ভিডিও CDN-presign ফ্লোতে | ✅ BUILT (একটি ব্যতিক্রমসহ) | RB4 `d31c7de`…`4d81a6f`; serializer shape অপরিবর্তিত। **ব্যতিক্রম:** browser-multipart ভিডিও আপলোড পুনর্লেখা NOT BUILT (সার্ভার putStream-ই আছে; delivery CDN) |
| RM6 | Transformations + shared MediaImage | ✅ BUILT | RB5 `3dc2d49`/`59e55d9`; **Transformations লাইভ-বাকি** (zone-এ চালু করা মালিকের; ততদিন MediaImage fallback) |
| RM7 | একীভূত Media Library | ✅ BUILT (extras ছাড়া) | RB5 `a4738a8`/`da70477`; **NOT BUILT:** per-file usage গণনা, orphan চিহ্নিতকরণ UI, folder/tag (brief-scope-এর বাইরে ছিল) |
| RM8 | Creative আপলোড + Campaign CDN URL | ⚠️ আংশিক | Creative presign/complete + variant CDN ✅; **Competitor ad ছবি মিরর NOT BUILT** — CompetitorAd-তে ছবির URL-ই সংরক্ষিত হয় না (snapshotUrl = HTML পেজ); আগে scanner-এর field তালিকা বাড়াতে হবে, সেটা storage-এর কাজ নয় |
| RM9 | প্রাইভেট ফাইল: ডিজিটাল প্রোডাক্ট | ✅ BUILT | RB6 `827fa9e`; migration `20261016100000`; reveal = 300s presigned, EC24b gate অপরিবর্তিত। Warranty/invoice PDF ও chat export **NOT APPLICABLE** — কিছুই সার্ভারে সংরক্ষিত হয় না (on-the-fly)। **Knowledge ডকুমেন্টের মূল ফাইল সংরক্ষণ NOT BUILT** (প্ল্যানে ঐচ্ছিক ছিল; এই প্যাকেজে সিদ্ধান্ত: করা হয়নি) |
| RM10 | পুরনো লোকাল ডেটা মাইগ্রেশন | ✅ BUILT (একটি ঘাটতিসহ) | RB6 `052c3e1`; scan/run টুল, একই-key কপি + sha যাচাই + idempotent। **Dual-read NOT BUILT** — যুক্তি ও সাময়িক-জানালার সতর্কতা acceptance-এ। (auto-মিরর wiring-এর ঘাটতি RB6b-তে বন্ধ হয়েছে — RM4-এর সারি দেখুন) |
| RM11 | Lifecycle, trash, backup | ✅ BUILT | RB6 `234e0d5`; `media_lifecycle_sweep` job (per-org enable মালিকের), trash 30d, quarantine 24h, orphan রিপোর্ট, backup bucket (env থাকলে)। **R2 dashboard-এর lifecycle rule NOT BUILT — ইচ্ছাকৃত:** sweep-ই গ্যারান্টি রাখে, ড্যাশবোর্ড-নির্ভর নয়। Backup পুনরুদ্ধার মহড়া **লাইভ-বাকি** (RM0 §৯) |
| RM12 | Admin Storage কার্ড + RM0 | ✅ BUILT | RB6 `ee15435`; overview API + কার্ড + `docs/r2-live-verification-checklist.md` (সব বাক্স অচিহ্নিত)। **পারফরম্যান্স আগে/পরে সংখ্যা NOT BUILT** — deploy-এর আগে মাপা সম্ভব নয়; RM0-তেই মাপতে হবে |
| RM0 | লাইভ যাচাই গেট | ⏳ মালিকের হাতে | চেকলিস্ট তৈরি; একটাও ধাপ Muse টিক দেয়নি/দেবে না |

## NOT BUILT — এক জায়গায় পুরো তালিকা (কারণসহ)

1. **Competitor ad ছবি মিরর** — উৎস ডেটাই নেই (CompetitorAd-তে
   image URL সংরক্ষিত হয় না)। Scanner পরিবর্তন আগে দরকার।
2. **Browser-multipart ভিডিও আপলোড** — সার্ভার-side putStream
   পথই রয়ে গেছে; RM2-তে multipart *লেয়ার* আছে, ব্রাউজার
   ফ্লোতে wiring হয়নি।
3. **Webchat presign পরিবেশন** — ইচ্ছাকৃত NOT CHANGED: webchat-র
   session token-ই সেখানকার authorization সীমানা; presigned URL
   সেটা দুর্বল করত (RB4 acceptance-এ যুক্তি)।
4. **RM7 extras** — per-file usage ("Nটি প্রোডাক্টে ব্যবহৃত"),
   library-তে orphan চিহ্ন, folder/tag সংগঠন।
5. ~~**Scheduled/automatic প্রোডাক্ট-ছবি মিরর**~~ — **RB6b-তে
   BUILT:** `product_image_mirror_sweep` job (per-org enable
   মালিকের) + D3 opt-out (OrgFeatureFlag
   `product_image_auto_mirror`, ডিফল্ট ON)।
   `docs/r2-rb6b-acceptance.md`।
6. **Storage quota enforcement** — পরিমাপ আছে, block নেই;
   মান মালিক বসালে তবেই (D4)।
7. **Knowledge ডকুমেন্টের মূল ফাইল R2-তে রাখা** — text extract
   আগের মতোই; মূল ফাইল সংরক্ষণ হয়নি।
8. ~~**Review ছবির মিরর** (`ExternalReview.imageUrls`)~~ —
   **RB6b-তে BUILT:** একই guarded-fetch/dedupe পাইপলাইনে
   (surface `review`), summary-তে আলাদা `reviews` গণনা।
   `docs/r2-rb6b-acceptance.md`।
9. **Dual-read (bucket→local fallback)** — RM10-এ যুক্তিসহ
   বাদ; মাইগ্রেশনের সাময়িক জানালা RM0-তে সতর্ক করা আছে।

## Migration হিসাব

প্যাকেজে মোট **2টি** migration: `20261016000000_rb2_stored_file`
(RB2) ও `20261016100000_rb6_digital_storage_key` (RB6)।
দুটোই additive। Fresh-Postgres পূর্ণ sequence RB6 শেষে:
**194/194** পরিষ্কার। কোনোটাই আসল DB-তে চলেনি।

## লাইভ-প্রমাণ বাকি — পুরো তালিকা

- RB1 verify স্ক্রিপ্টের আসল round-trip (PUT/GET/presign/DELETE)।
- প্রতিটা surface-এর আসল ফ্লো: প্রোডাক্ট আপলোড → CDN লোড,
  মিরর, সোশ্যাল publish-এ CDN টান, ইনবক্স presigned দেখা,
  লোগো, creative আপলোড, ডিজিটাল ডাউনলোড + মেয়াদ শেষে
  প্রত্যাখ্যান, media-library পেজ।
- Transformations আসল transformed bytes।
- RM10 scan/run আসল লাইভ local ফাইলের উপর।
- RM11 sweep আসল job হিসেবে + backup bucket ও পুনরুদ্ধার মহড়া।
- Admin কার্ডের সংখ্যা বনাম R2 dashboard।
- Dokploy Redeploy-এর পর মিডিয়া অক্ষত থাকা।

সবগুলোই `docs/r2-live-verification-checklist.md`-তে ধাপে ধাপে
আছে — মালিকের হাতে, অচিহ্নিত।

## কমিট মানচিত্র

| ব্যাচ | কমিট (শেষ) | Acceptance |
|---|---|---|
| RB1 (RM1) | `1bfcf92` | docs/r2-rb1-acceptance.md |
| RB2 (RM2+RM3) | `4444bf5` | docs/r2-rb2-acceptance.md |
| RB3 (RM4) | `28a67e7` | docs/r2-rb3-acceptance.md |
| RB4 (RM5+RM8) | `4d81a6f` | docs/r2-rb4-acceptance.md |
| RB5 (RM6+RM7) | `b226364` | docs/r2-rb5-acceptance.md |
| RB6 (RM9+RM10+RM11+RM12) | `03a5da8` | docs/r2-rb6-acceptance.md |
| RB6b (auto-mirror + review mirror) | `799d472`…`61740ca` + এই হালনাগাদ | docs/r2-rb6b-acceptance.md |
