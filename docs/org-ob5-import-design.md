# ORG16 — Org Bundle Import/Restore: নকশা-নোট (build-এর আগে)

তারিখ: 2026-10-17 · প্যাকেজ: Organization Next, Batch OB5 (শুধু ORG16) · Worktree: `ai-marketing-saas-org`, branch `org-next`, base `032cde5f` (OB1–OB4 complete)।
সূত্র: `Organization-Next-Plan-2026-10-16.md` ORG16 — "Export আছে, import নেই। নিজের export করা bundle ফিরিয়ে আনা (নতুন org-তে restore) — ID remap, সংঘর্ষ নীতি, যাচাইসহ। নিরাপত্তা-সংবেদনশীল — আলাদা নকশা লাগবে।"

এই নোটের প্রতিটা সিদ্ধান্তের পেছনের তথ্য কোড পড়ে যাচাই করা; যেখানে brief-এর অনুমান ভুল প্রমাণিত হয়েছে, সেখানে অনুমান নয় — আসল অবস্থা লিখে সিদ্ধান্ত সেভাবে নেওয়া হয়েছে (§২ দেখুন)।

---

## ১. Export ফরম্যাট — যা import-কে গ্রহণ করতে হবে (যাচাইকৃত)

উৎস: `apps/api/src/organizations/org-data-export.ts` (`buildOrgDataBundle`) + `apps/api/src/data-tools/data-exports.service.ts` (ফাইল pipeline)।

- ডাউনলোড ফাইল: **একটাই JSON** — `{ manifest, data }`।
- `manifest` = `{ exportedAt, exportedBy, tables }`; `tables`-এ ঠিক ১৫টা key, প্রতিটা `{ rows: number, truncated: boolean }`: organization, businessProfile, members, products, orders, customers, leads, conversations, campaignPlans, integrations, subscription, payments, supportTickets, orderItems, mediaAssets।
- `data` = legacy bundle + দুটো extension। key গুলো: `exportedAt`, `exportedBy`, `organization` (পুরো Organization row, `creditMinor` string), `businessProfile` (পুরো row অথবা null), `members` (Membership row + `user: {id,email,name,status}` summary), `products`, `orders`, `customers`, `leads`, `conversations`, `campaignPlans`, `integrations` (**শুধু ৬টা key**: id, provider, status, externalAccountId, lastSyncAt, createdAt), `subscription` (row অথবা null), `payments` (SaasPayment row, `amountMinor`/`refundedMinor` string), `supportTickets`, `orderItems`, `mediaAssets` (শুধু metadata: id, kind, name, contentType, sizeBytes, storageKey, origin, createdAt)।
- পুরো bundle-এ একটা `jsonSafe` pass চলে: **সব BigInt → string**। অর্থাৎ টাকার কলামগুলো bundle-এ string আকারে থাকে; import-এ সেগুলো ফের BigInt-এ রূপান্তর করতে হবে।
- Export-এর নিজের সীমা: প্রতি টেবিলে page 1,000 করে hard ceiling **200,000 rows** (`ORG_EXPORT_MAX_ROWS_PER_TABLE`), ceiling ছাড়ালে `truncated: true` — manifest-এ সৎভাবে লেখা থাকে। ফাইল তৈরি inline হয় মোট আনুমানিক **≤ 25,000 rows** হলে (`DATA_EXPORT_INLINE_MAX_ROWS`), বড় হলে queued job।
- Credential **টেবিল** (IntegrationCredential) bundle-এ কখনো থাকে না — builder integrations-কে ওপরের ৬-key subset-এ নামিয়ে দেয়।

## ২. অডিটে পাওয়া যেসব তথ্য নকশা বদলে দিয়েছে (সৎ নোট)

**F1 — Manifest-এ কোনো version/format marker নেই।** `manifest`-এ `exportedAt/exportedBy/tables` ছাড়া কিছু নেই, `data`-তেও format key নেই। অর্থাৎ "এটা আমাদের bundle কিনা" চেনার একমাত্র উপায় **কাঠামোগত যাচাই** (§৩-D5)। ভবিষ্যৎ export-এ version যোগ করা এই batch-এর scope নয় (export builder ছোঁয়া হবে না — admin export-এর byte-স্থিতি ভাঙা যাবে না)।

**F2 — BusinessProfile bundle-এ পুরো row যায় — `metaCapiToken`সহ।** Builder profile-টা select ছাড়াই নেয়, তাই profile-এর `metaCapiToken` (আসল secret), `bkashNumber`, `nagadNumber` bundle-এ থাকে। brief-এর ধারণা "credential bundle-এ থাকলেই bundle অন্য উৎসের" হুবহু নিলে **আমাদের নিজের export-ই import করা যাবে না** (round-trip অসম্ভব)। সমাধান D4/D5-এ: পরিচিত অবস্থানের sensitive ফিল্ড (শুধু `businessProfile.metaCapiToken`) → **কখনো import নয়, strip + report**; অন্য যেকোনো জায়গায় credential-জাতীয় ফিল্ড → **পুরো bundle প্রত্যাখ্যান**। `bkashNumber`/`nagadNumber` হলো ক্রেতাকে দেখানো receive-only নম্বর (payment নির্দেশনা) — secret নয়, profile settings হিসেবে restore হবে।

**F3 — তিনটা টেবিলের সন্তান bundle-এ নেই।** Conversations-এর `ChannelMessage`, CampaignPlan-এর ad set/publish log, SupportTicket-এর message — কোনোটাই export হয় না। শুধু header restore করলে ফাঁপা, বিভ্রান্তিকর রেকর্ড তৈরি হয়। তাই এই তিনটে v1-এ import হবে না (D2) — কারণসহ report-এ থাকবে।

**F4 — Bundle-এর বাইরের টেবিলে FK আছে।** Product.`categoryId`→Category, Product.`brandId`→Brand, Customer.`groupId`→CustomerGroup, Order.`storeId`→Store — কোনোটাই bundle-এ নেই। Restore-এ এগুলো null হবে (D4), report-এ গণনা থাকবে। একইভাবে Product.`digitalStorageKey` হলো উৎস org-এর R2 object-এর key — অন্য org-তে সেই key বসালে storage মালিকানা গুলিয়ে যায়; null হবে।

**F5 — Upload দরজার আসল সীমা।** API-র JSON body limit **3 MB** (`main.ts`: M59 logo-র জন্য বসানো)। এই codebase-এর import ধাঁচ JSON body-তে content string (CSV DTO: `csvText` MaxLength 2,000,000; XLSX DTO: `fileBase64` MaxLength 2,800,000)। Bundle import একই ধাঁচ নেবে (D6) — ফলে কার্যকর upload ceiling ~2.8M অক্ষর; এর বড় bundle এই দরজায় আসবে না (সৎ সীমা, NOT BUILT-এ থাকবে)।

**F6 — FTS search vectorের পুনর্গঠন সম্ভব।** Product.`searchVector` (tsvector) Prisma দিয়ে লেখা যায় না, raw SQL-এ maintained। তবে `products/search-vector.ts`-এ `refreshOrgSearchVectors(prisma, orgId)` org-জোড়া rebuild helper আছে — import-এর পর ওটা চালালে restored product-গুলো shop search-এ ফিরে আসে (D7)।

## ৩. সিদ্ধান্ত

### D1 — লক্ষ্য org: শুধু অনুরোধকারীর নিজের একেবারে নতুন/খালি org
- Import শুধু সেই org-এই হবে যার OWNER অনুরোধকারী নিজে (endpoint OWNER-only; TenantGuard membership যাচাইয়ের ওপরে role OWNER)।
- "খালি"র সংজ্ঞা (validate ও import — **দুই endpoint-এই একই যাচাই**): `products = 0`, `orders = 0`, `customers = 0`, `leads = 0` (orderItems orders-এর অধীন, আলাদা গণনা লাগে না) **এবং** BusinessProfile-এ অর্থবহ বিষয়বস্তু নেই (org তৈরিতে auto-created ফাঁকা profile থাকে — সেটা খালিই ধরা হবে; `description/industry/contactEmail/contactPhone/tradeLicenseNo/bkashNumber/nagadNumber`-এর যেকোনো একটা ভরা থাকলে org খালি নয়)।
- ডেটাওয়ালা org-তে import **কখনো নয়** — merge/restore-into-existing এই প্যাকেজের scope-এর বাইরে (plan-এর ORG16 "নতুন org-তে restore" কথাটাই ভিত্তি)। অ-খালি হলে 409-জাতীয় স্পষ্ট বার্তা, report-এ কোন টেবিলে কত row
...[truncated 13556 chars]