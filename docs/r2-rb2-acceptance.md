# R2 RB2 (RM2 + RM3) — Acceptance

**তারিখ:** 2026-10-15 · **Worktree:** `~/workspace/ai-marketing-saas-r2`, branch `r2-media` (base 49dac3e + RB1 `1bfcf92`)
**কমিট:** `88cf608` (StoredFile মডেল + migration) · `439de8b` (StorageService) · `cd9b927` (registry + module wiring + env passthrough) · এই acceptance-এর কমিট (আলাদা)
**নোট:** মূল বাস্তবায়ন একজন background worker করেছিল; worker-টি daemon restart-এ মারা যায় acceptance লেখার আগেই। কোডের ৩টি কমিট অক্ষত ছিল (tree clean)। এই ডকুমেন্টের সব গেট **পরে মূল সেশন থেকে পুনরায় চালিয়ে** যাচাই করা — worker-এর নিজের দাবি নয়।

---

## RM2 — StorageService (নতুন `apps/api/src/storage/`)

- **`s3-object-store.ts`** — এক-bucket S3 surface, বিদ্যমান হাতে-লেখা SigV4-এরই সম্প্রসারণ (কোনো SDK/dependency যোগ হয়নি): generalized presign (GET/PUT, multipart part URLসহ), query stringসহ header-signed request, multipart create/complete/abort, CopyObject, DeleteObjects (batch), HEAD metadata, ListObjectsV2।
- **`s3-xml.ts`** — ওই অপারেশনগুলোর জন্য ন্যূনতম হাতে-লেখা XML builder/parser (entity handlingসহ), নিজস্ব specসহ।
- **`storage.service.ts`** — visibility-ভিত্তিক facade: `MEDIA_R2_PUBLIC_BUCKET`/`MEDIA_R2_PRIVATE_BUCKET` জোড়া থাকলে তাই জেতে; না থাকলে পুরনো `MEDIA_S3_BUCKET`-ই private/default — **RB1-এর আচরণ হুবহু অপরিবর্তিত** (public সেক্ষেত্রে একই bucket-এ fallback)। Local মোডে MediaStore-এর সঙ্গে সামঞ্জস্য: একই local folder, presigned = null, visibility শুধু recorded metadata; **ব্যতিক্রম:** multipart local মোডে নেই — স্পষ্ট ত্রুটি দিয়ে প্রত্যাখ্যান করে (নীরব ভুয়া সাফল্য নয়)।
- **Health probe** মেথড আছে: আসল ছোট object দিয়ে PUT→HEAD→DELETE; local মোডে ফলাফলে তা স্পষ্ট লেখা থাকে। Admin-এ wiring এই ব্যাচে নয় (RM12)।
- MediaStore ও তার সব বিদ্যমান call-site (inbox/social/organizations) **অপরিবর্তিত** — regression suite দিয়ে প্রমাণিত (নিচে)।

## RM3 — StoredFile রেজিস্ট্রি

- **মডেল `StoredFile`** (schema.prisma): bucket, key `@unique` (registration = idempotent upsert), visibility, surface (product|social|inbox|branding|creative|review|digital|document), contentType, **sizeBytes BigInt** (MediaAsset-এর Int ~2 GB-তেই overflow করত — multipart যে বড় ফাইলের জন্য, ঠিক সেখানেই; কমিট মেসেজে কারণ লেখা), width/height/sha256 nullable, status `quarantine|active|trashed` (default active), createdById/sourceRef, org index।
- **Migration `20261016000000_rb2_stored_file`** — ledger-check: দাবির সময় জ্ঞাত সর্বোচ্চ ছিল SN-এর 20261015110000; 20261016000000 সব worktree-তে ফাঁকা ছিল।
- **`StorageRegistryService`**: `register` (বাইট সফলভাবে নামার পরেই কেবল ডাকা হয়), org-guarded `markTrashed` (শুধু status বদল; আসল object মোছা RM11 lifecycle-এর কাজ), `findByKey`, `usageForOrg` — **শুধু পরিমাপ; quota enforcement নেই** (tier-এর মান মালিকের সিদ্ধান্ত)। BigInt শেষ পর্যন্ত, সীমানায় decimal string-এ serialize।
- **StorageModule** AppModule-এ যুক্ত (controller নেই — surface-গুলো RM4 থেকে ব্যবহার করবে, admin wiring RM12)।
- Dokploy compose + env উদাহরণে `MEDIA_R2_PUBLIC_BUCKET` / `MEDIA_R2_PRIVATE_BUCKET` passthrough (RB1-এর `${VAR:-}` ধরনে)।

## গেট (মূল সেশনে পুনরায় চালানো, 2026-10-15 সন্ধ্যা)

| পরীক্ষা | ফল |
|---------|-----|
| `prisma generate` (নতুন মডেলসহ) | ✅ exit 0 |
| `pnpm --filter @repo/api... build` | ✅ db/contracts/api — লগে সবকটিতে Done (চালানোর সেশনটি মাঝপথে interrupt হয়েছিল, কিন্তু বিল্ড লগ সম্পূর্ণ ও `dist/storage/*` তৈরি) |
| Jest — নতুন storage suite (s3-xml, storage.service, storage-registry) | ✅ **3 suite / 35 test pass** |
| Jest — media regression (u6-scale, nextgen-media, social-pp2) | ✅ **3 suite / 31 test pass** — MediaStore আচরণ অপরিবর্তিত |
| Fresh-Postgres: স্ক্র্যাচ DB-তে পুরো sequence | ✅ **193/193 migration পরিষ্কারভাবে applied**, `StoredFile` টেবিল প্রত্যাশিত কলামসহ (sizeBytes bigint) |

## যা হয়নি / সৎ সীমাবদ্ধতা

- **আসল R2 bucket-এ কোনো পরীক্ষা হয়নি** — multipart, CopyObject, presigned PUT-এর R2-আচরণ unit-স্তরে সাইনিং/XML দিয়ে প্রমাণিত, live নয়। RB1-এর verify script চালু হওয়ার পর (মালিকের env + Redeploy) StorageService-এর জন্যও একই ধরনের লাইভ probe দরকার হবে — RB4-এর আগে একবার চালানো বাকি থাকল।
- কোনো বিদ্যমান surface এখনো StorageService ব্যবহার করে না (ইচ্ছাকৃত — RB3/RB4-এর কাজ)। এখনকার মূল্য: ভিত্তি + রেজিস্ট্রি প্রস্তুত।
- StoredFile-এ পুরনো row-গুলোর backfill হয়নি (RM10-এর কাজ, প্ল্যান অনুযায়ী)।
- পূর্ণ API test suite (~400 suite) এই ব্যাচে চালানো হয়নি; storage + media-সংলগ্ন suite-ই গেট। AppModule wiring build দিয়ে যাচাই হয়েছে, আলাদা boot-test হয়নি।
