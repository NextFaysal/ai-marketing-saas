# RB6 Acceptance — RM9 + RM10 + RM11 + RM12 (R2 প্যাকেজের শেষ ব্যাচ)

**তারিখ:** 2026-10-15 · **Branch:** `r2-media` · **Base:** RB5 `b226364`
**কমিট:** `827fa9e` (RM9) · `052c3e1` (RM10) · `234e0d5` (RM11) ·
`ee15435` (RM12) · এই ডক
**Push হয়নি** — মালিকের শর্তাধীন অনুমোদন অনুযায়ী release push
আলাদা ধাপে (সব ব্যাচ + পূর্ণ গেট শেষে)।

## Migration ledger

এই ব্যাচে একটাই নতুন migration: **`20261016100000_rb6_digital_storage_key`**
— সব worktree জুড়ে ledger যাচাই করে দাবি করা (আগের সর্বোচ্চ ছিল
RB2-র `20261016000000`; `20261016100000` মুক্ত ছিল)।

## RM9 — প্রাইভেট ফাইল সার্ভিস (ডিজিটাল প্রোডাক্ট)

- [x] `Product.digitalStorageKey String?` + migration (উপরে)।
- [x] আপলোড: `POST products/:productId/digital-file/presign` +
  `/complete` (ProductsController, WRITE_ROLES, TenantGuard) —
  RB3 প্যাটার্ন, **private** bucket, quarantine key
  `_quarantine/{orgId}/digital/{uuid}`, final key
  `{orgId}/digital/{productId}/{uuid}.{ext}`।
  - গেট: সাইজ ≤ **100 MB** (HEAD দিয়ে যাচাই); executable
    extension ব্লকলিস্ট **exe/bat/sh/js/html** (বাংলা প্রত্যাখ্যান);
    extension-বিহীন নামও প্রত্যাখ্যান।
  - sha256: ≤10 MB হলে complete বাইট পড়ে আসল hash registry-তে
    রাখে; বড় ফাইলে `sha256 = null` (সৎ সীমা — 100 MB API
    মেমরিতে তোলা হয় না, HEAD সাইজ যাচাই তবু হয়)।
  - Complete হলে `digitalStorageKey` সেট + `digital: true`
    (hosted ফাইলই ডিজিটাল পণ্য); পুরনো registry row replacement-এ
    trashed হয়, object ইনলাইন মোছে না (ডাউনলোড-মাঝখানে থাকা
    ক্রেতা কাটা পড়ে না; আসল মোছা RM11-এর)।
  - StoredFile: surface=`digital`, visibility=`private`,
    sourceRef=`product:{id}`। পুরনো `digitalFileUrl`
    (merchant-hosted) পথ অপরিবর্তিত।
- [x] ডেলিভারি: `assertEc24Conditionals` এখন `digitalStorageKey`-কেও
  ফাইল হিসেবে মানে (নইলে R2-backed পণ্যের পরের যেকোনো edit
  আটকে যেত)। Storefront `digitalAccess` reveal-এ R2 ফাইল থাকলে
  **300s presigned GET** ফেরত আসে।
  - **সৎ deviation:** brief "302 redirect → presigned" বলেছিল;
    বাস্তবে বিদ্যমান endpoint কখনো byte-proxy ছিলই না — এটি
    একটি *reveal* endpoint (JSON-এ URL ফেরত দেয়)। তাই redirect-এর
    বদলে revealed URL-টাই এখন স্বল্পমেয়াদি presigned — উদ্দেশ্য
    (স্থায়ী লিংক নয়, মেয়াদসহ অ্যাক্সেস) হুবহু পূরণ, কোনো
    নতুন পাবলিক endpoint বানানো হয়নি। **Access check একটুও
    বদলায়নি:** order+phone match, delivery gate, access-limit
    গণনা — সব EC24b-র মতোই reveal-এর আগে চলে (spec-প্রমাণিত:
    cap=1-এ দ্বিতীয় reveal প্রত্যাখ্যান)।
  - Storage অনুপস্থিত/local মোডে merchant URL আগের মতোই;
    key-only পণ্যে কোনো লিংক বানিয়ে দেওয়া হয় না।
- [x] **RM9-3 NOT APPLICABLE (কোড-প্রমাণে):** Warranty সার্টিফিকেট
  বলে কোনো সারফেসই নেই (warranty শুধু পলিসি-টেক্সট)। Invoice/
  label PDF: print-center হেডারেই লেখা — *"the PDF itself is
  streamed to the caller, never stored"*। Chat export:
  `exportConversation` response-এর body-তে inline content ফেরত
  দেয়। **কিছুই সার্ভারে সংরক্ষিত হয় না — তাই R2-তে সরানোর
  কিছু নেই**, জোর করে storage বানানো হয়নি।

## RM10 — পুরনো লোকাল মিডিয়ার মাইগ্রেশন টুল

- [x] `MediaMigrationService` + `POST admin/media-migration/scan|run`
  (SuperAdminGuard + `@AdminTier("SUPER")`)।
- [x] Inventory **শুধু আসল DB row থেকে**: MediaAsset keys,
  ChannelMessage media keys (org conversation দিয়ে resolve;
  না মিললে org=null), Organization লোগো (CDN URL থেকে key অথবা
  legacy `branding/{id}/logo`), local-মোড StoredFile rows।
  Key দিয়ে dedupe। Scan: surface-ভিত্তিক গণনা + জানা বাইট
  (string) + অজানা-সাইজের গণনা — অনুমান শূন্য।
- [x] Run: batchSize (default 100, cap 500) — প্রতিটা key:
  target HEAD থাকলে skip + register; না থাকলে local bytes →
  **একই key**-তে put → read-back sha256 মিলিয়ে যাচাই (না
  মিললে কপি মোছা + failed) → register (idempotent upsert)।
  ফলাফল `{copied, skipped, failed:[{key, reason}], processed,
  remaining, totalKnown}`। Local original **মোছা হয় না**
  (প্ল্যান: অন্তত এক রিলিজ-চক্র রাখা)।
- [x] **Dual-read বানানো হয়নি — সৎ যুক্তিসহ:** MediaStore local
  ও S3 দুই মোডেই একই key দিয়ে পড়ে, তাই কপি হয়ে যাওয়া key
  কোনো reader-পরিবর্তন ছাড়াই bucket থেকে পড়া যায়। কিন্তু
  dual-read (আগে bucket, না পেলে local) কোডে নেই, আর run()
  নিজেই s3 মোড ছাড়া চলে না — তাই বাস্তব ক্রম হলো: **env চালু
  + Redeploy-এর পরপরই, অন্য কাজের আগে, scan/run সম্পূর্ণ করা**।
  সেই জানালায় অনুলিপি-না-হওয়া পুরনো মিডিয়া সাময়িকভাবে
  দেখা যাবে না — এই সীমা লুকানো হয়নি; RM0 চেকলিস্ট §৮-এ
  সতর্কতা লেখা আছে। (আজকের লাইভে local-মোড ফাইলের পরিমাণ
  অজানা — scan-এর সংখ্যাই প্রথম আসল চিত্র দেবে।)
- [x] Product **external** URL মিরর এখানে পুনরাবৃত্তি নয় —
  RB3/RM4-এর `products/images/mirror-external` endpoint-ই
  তার মালিক (scan-এর note-এ রেফারেন্স আছে)।
- [ ] **Scheduled/automatic মিরর wiring — NOT BUILT:** RB3
  acceptance-এ "RM10-এ আসবে" লেখা ছিল; এই ব্যাচের brief
  RM10-কে local-ফাইল টুলে সীমাবদ্ধ রেখেছে, তাই auto-mirror
  job/sync-hook এখনো নেই — মিরর এখনো endpoint-triggered
  (ম্যানুয়াল)। প্যাকেজ summary-তে খোলাখুলি তালিকাভুক্ত।

## RM11 — Lifecycle, trash, backup

- [x] `MediaLifecycleService.runSweep()` + job type
  **`media_lifecycle_sweep`** — বিদ্যমান প্যাটার্নে: JOB_TYPES-এ
  এন্ট্রি, template (org, দৈনিক), AutomationService-তে
  @Optional injection + executeJob case (platform-level কাজ,
  audit_retention-এর মতোই org শুধু scheduler tenant)।
  per-org enable মালিকের হাতে (বাকি sweep-গুলোর মতোই)।
  - (ক) status=`trashed` ও trash-flip (updatedAt) retention-এর
    (**30 দিন**, `MEDIA_TRASH_RETENTION_DAYS`) বেশি পুরনো →
    object delete + row hard-delete। Object delete ব্যর্থ হলে
    **row থাকে** (পরের sweep আবার চেষ্টা করবে)।
  - (খ) `_quarantine/` prefix-এ **24 ঘণ্টার** (`MEDIA_QUARANTINE_RETENTION_HOURS`)
    পুরনো object দুই bucket-এই মোছা (complete না-করা আপলোডের
    অবশিষ্ট)। Pagination bounded (20 পেজ × 1000)।
  - (গ) Orphan **রিপোর্ট** (auto-delete কখনো নয়): bounded
    sample (200)-এ missing object গণনা + `product:{id}` /
    `creative:{id}` sourceRef-এর dangling গণনা।
- [x] Backup: StorageService-তে backup seam (`MEDIA_R2_BACKUP_BUCKET`;
  local মোডে null — ভুয়া backup নয়)। Sweep-এর শেষে:
  (i) registry JSON snapshot `backup/registry-{yyyy-mm-dd}.json`,
  (ii) গত 24 ঘণ্টার private object একই key-তে backup bucket-এ
  copy। Env না থাকলে result-এ `backup: "not-configured"`।
  Compose + দুই env example-এ passthrough যোগ।

## RM12 — Admin Storage কার্ড + RM0 চেকলিস্ট

- [x] `GET admin/storage-overview` (SuperAdminGuard) —
  AdminService-তে registry groupBy aggregation (AA6 প্যাটার্নে
  capped findMany fallback সহ): মোট object/বাইট, bucket ও
  visibility ভাগ, surface ভাগ, শীর্ষ 10 org (নামসহ), trashed
  আলাদা, mode (StorageService-র একই env নিয়মে — RB4-র
  `publicMediaServingEnabled`)। BigInt → string সর্বত্র।
  Registry অনুপস্থিত হলে `registryAvailable: false` —
  সংখ্যা বানানো হয় না।
- [x] Admin Command Center-এ Storage কার্ড (বিদ্যমান `acard`
  ধরনে): mode badge (R2 সবুজ / Local Disk সতর্ক হলুদ), মোট,
  public/private ভাগ, শীর্ষ 5 org, trash নোট। Overview লোড
  না হলে কার্ডই দেখায় না।
- [x] `docs/r2-live-verification-checklist.md` (RM0) — ধাপে ধাপে
  মালিকের লাইভ যাচাই, **সব বাক্স অচিহ্নিত**।
- [x] `docs/r2-package-summary.md` — RM1–RM12 আইটেম-ধরে নিরীক্ষা।

## গেট (সব এই worktree-তে চালানো)

| Gate | Result |
|---|---|
| RM9 spec (presign/complete/delivery/ec24) | 13 tests ✅ (+ ec24-digital ও rm4 regression একসঙ্গে 37/37) |
| RM10 spec | 7/7 ✅ |
| RM11 spec + storage.service spec | 27/27 ✅ |
| RM12 spec | 4/4 ✅ |
| Regression: admin + storage | 27 suites / 290 ✅ |
| Regression: products + storefront + commerce | 37 suites / 443 ✅ |
| Regression: automation (job wiring) | 13 suites / 79 ✅ |
| Fresh-Postgres migration sequence | **194/194** ✅ (scratch DB, শেষে drop; `Product.digitalStorageKey` text যাচাই) |
| Builds | API ✅ · Web ✅ · Admin ✅ (আলাদা আলাদা, sequential) · Admin `tsc --noEmit` 0 ✅ |
| Boot smoke (compiled, dummy DB) | **1,351 routes** mapped (RB5-র 1,346 + নতুন 5), DI error 0; থেমেছে শুধু ইচ্ছাকৃত dummy DB-তে (P1003) |

## সৎ সীমাবদ্ধতা

- **Live R2 proof নেই** — এই ব্যাচেরও সব spec fake seam-এ।
  আসল bucket-এ digital upload/download, migration run, sweep
  ও backup-এর প্রমাণ RM0 চেকলিস্টে, deploy-এর পর মালিকের হাতে।
- Trash-হওয়ার সময় = StoredFile.updatedAt (markTrashed-ই তার
  একমাত্র লেখক); register() দিয়ে একই key আবার লিখলে updatedAt
  বদলায় — trashed row register হওয়ার কথা নয়, তবু এই
  নির্ভরতা এখানে লিখে রাখা হলো।
- Lifecycle sweep-এর trashed purge এক রানে সর্বোচ্চ 1000 row;
  বড় জমা থাকলে পরের রানগুলোতে শেষ হবে (job result-এ সংখ্যা
  দেখা যাবে)।
- Digital ফাইলের sha256 শুধু ≤10 MB-এ; বড় ফাইলে registry row
  `sha256: null` — ভবিষ্যতে চাইলে multipart-ETag ছাড়া streaming
  hash আলাদা কাজ।
- Admin কার্ডের mode হলো env-নিয়মের হিসাব, লাইভ probe নয়;
  আসল bucket health RM2-র `StorageService.health()` probe ও
  RB1 verify স্ক্রিপ্টেই প্রমাণ হয় (RM0 §১)।
