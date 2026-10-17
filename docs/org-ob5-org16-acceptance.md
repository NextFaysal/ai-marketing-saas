# OB5 · ORG16 Acceptance — Org Bundle Import / Restore

**তারিখ:** 2026-10-17 · **Branch:** `org-next` (LOCAL ONLY — push হয়নি)
**Base:** `032cde5f` (OB4) · **Migration claim:** `20261026000000_org_data_import`
**নকশা-নোট:** `docs/org-ob5-import-design.md` (build-এর আগে commit হয়েছে)

> **এক-লাইনে:** Data-tools এক্সপোর্ট bundle (JSON) এখন OWNER একটি **একদম নতুন, খালি** org-তে
> ফিরিয়ে আনতে (restore) পারেন — আগে শুধু validation report (কিছুই লেখা হয় না), তারপর
> নিশ্চিতকরণে একটি all-or-nothing transaction-এ আসল import, job record ও audit সহ।
> যা ফেরানো যায় না, তা report-এ কারণসহ নাম ধরে বলা হয় — চুপচাপ বাদ যায় না।

## যা আবিষ্কার হলো (inventory-র সৎ ফল)

- এক্সপোর্টের **কোনো version/format ক্ষেত্র নেই** (manifest = `{ organizationId, exportedAt, exportedBy, tables: {rows, truncated} }`) — bundle চেনা তাই কাঠামোগত মিল দিয়ে: ঠিক 15টি manifest table + ঠিক 17টি data key (15 + `orderItems` + `summary`)।
- **গুরুতর পাওয়া (F2):** ডিজাইন-ব্রিফের ধারণা "এক্সপোর্টে credential থাকে না" আংশিক ভুল — `IntegrationCredential` সত্যিই বাদ, কিন্তু **BusinessProfile পুরোটা এক্সপোর্ট হয়, `metaCapiToken` সহ**। নিয়ম: profile-এর ঐ token (+ deprecated `customDomain`) import-এ **ফেলে দিয়ে report-এ নাম বলা হয়**; অন্য যেকোনো credential-নামীয় ক্ষেত্র bundle-এ থাকলেই **পুরো bundle প্রত্যাখ্যান**।
- এক্সপোর্ট JSON ডাউনলোড সবসময় **inline** (25,000 সারি cap) — বড় org-এর bundle নিজে থেকেই `truncated` চিহ্নিত হয়; truncated bundle import হয় না।
- CSV এক্সপোর্ট প্রতি-টেবিল summary মাত্র (আসল সারি নেই) — import শুধু JSON bundle থেকে।

## সিদ্ধান্তের সারাংশ (D1–D10, যুক্তিসহ নকশা-নোটে)

1. **লক্ষ্য:** নিজের একদম-নতুন/খালি org-ই শুধু (products/orders/customers/leads = 0 **এবং** প্রোফাইলে অর্থবহ কিছু নেই; সদ্য-তৈরি org-এর খালি auto-profile import-এর পথে বাধা নয় — সেখানেই profile update হয়)। অ-খালি org-তে validate error / create 409 — **কোনো merge নেই**।
2. **ফেরে (6):** businessProfile (in-place), customers, products, leads, orders, orderItems। **ফেরে না (9, কারণ-কোডসহ):** organization (`target_identity_kept`), members (`people_not_restored`), subscription (`billing_state_not_transferred`), payments (`billing_ledger_not_transferred`), integrations (`connections_not_restored`), conversations (`transcripts_not_in_bundle`), campaignPlans (`ad_children_not_in_bundle`), supportTickets (`messages_not_in_bundle`), mediaAssets (`bytes_not_in_bundle`)।
3. **ID remap:** সব নতুন id transaction-এর আগেই তৈরি; bundle-এর ভেতরের সম্পর্ক (order↔customer, item↔order/product, merged/split/referrer শৃঙ্খল) নতুন id দিয়ে অক্ষত। যেসব FK bundle-এর বাইরের (category, brand, store, conversation, owner user…) সেগুলো **null + report-এ গণনা**। `loyaltyBalanceCache` 0 — loyalty ledger bundle-এ নেই, cache ফেরালে ভুতুড়ে points তৈরি হতো।
4. **যাচাই:** truncated প্রত্যাখ্যান; manifest↔data সারি-সংখ্যা মিল বাধ্যতামূলক; অজানা/অতিরিক্ত টেবিল প্রত্যাখ্যান; bundle-ভেতরের ডুপ্লিকেট unique (sku, (source, externalId), invoiceNumber, referralCode) প্রত্যাখ্যান; ঝুলন্ত FK প্রত্যাখ্যান; প্রতি-টেবিল field whitelist (relation/searchVector কখনো bundle থেকে আসে না); BigInt/Date পুনঃ-টাইপ, ভুল হলে প্রত্যাখ্যান। slug schema-unique নয় — ডুপ্লিকেট slug-এ প্রত্যাখ্যান নয়, **warning**।
5. **ব্যর্থতা:** job row আগে তৈরি (`running`), একটি মাত্র `$transaction` — ব্যর্থ হলে rollback-এ org হুবহু আগের মতো, job `failed` + আসল error, audit নেই।
6. **সীমা — সবই পুনঃব্যবহৃত, নতুন সংখ্যা শূন্য:** মোট ফেরানো সারি ≤ 25,000 (এক্সপোর্টের নিজের cap); `bundleJson` ≤ 2,800,000 অক্ষর (imports মডিউলের XLSX precedent; API body limit 3MB)।
7. **Search vector:** import-এর পর platform-এর নিজের `refreshOrgSearchVectors` best-effort — ফলাফল report-এ (`searchVectorRefreshed`), ব্যর্থ হলেও import সফল থাকে, শুধু log হয়।

## Build (commit অনুযায়ী)

| Commit | বিষয় |
|---|---|
| `f8d9b4c0` | নকশা-নোট `docs/org-ob5-import-design.md` (inventory + F1–F6 + D1–D10 + NOT BUILT) |
| `4a837842` | `DataImport` মডেল + migration `20261026000000_org_data_import` (DataExport-এর ধাঁচে হাতে-লেখা SQL) |
| `1514ec64` | TenantGuard archived-OWNER allowlist-এ `/data-imports` |
| `1321f464` | API: `org-data-import.ts` (pure checker) + `DataImportsService` + OWNER-only 3 endpoint (`validate` / create / get) + audit `org.data_imported` |
| `d25bf1a5` | Spec `org16-data-import.spec.ts` — 12 test |
| `cad47373` | Web: settings DataToolsCard-এ Restore অংশ (OWNER-only controls, report render, confirm → job) + `lib/ab8` labels + 3 test |
| `487df725` | Fix: schema comment syntax (`/** */` → `//`) — fresh-PG গেটে ধরা (নিচে দেখুন) |

## Spec প্রমাণ (org16-data-import.spec.ts, 12/12)

- **Round-trip:** আসল `buildOrgDataBundle` দিয়ে org A ("Dhaka Fashion") থেকে bundle → JSON → org B-তে restore: 11টি সারি (profile 1 + customers 2 + products 2 + leads 1 + orders 2 + items 3); সব id নতুন; item→order/product, order→customer/referrer/splitFrom, customer mergedInto শৃঙ্খল অক্ষত; টাকা BigInt হয়ে ফিরেছে; profile row in-place update, token null; skipped টেবিলগুলো B-তে খালি; B-এর নিজের FREE সাবস্ক্রিপশন অক্ষত; ঠিক একটি `org.data_imported` audit (`rows: 11`)।
- **Validate কিছুই লেখে না** (সব টেবিল + job + audit count অপরিবর্তিত)।
- **প্রত্যাখ্যান battery:** non-JSON, foreign format, অজানা টেবিল, row-count মিথ্যা, truncated উৎস, credential ক্ষেত্র (`credential_field_present:products.accessToken`), integrations-এ অতিরিক্ত key, যোগ-করা credential টেবিল, ডুপ্লিকেট sku, ঝুলন্ত item→product, ডুপ্লিকেট (source, externalId) — প্রতিটিতে নির্দিষ্ট error code।
- **Rollback:** মাঝপথে ব্যর্থতা সাজিয়ে job `failed`, org B হুবহু খালি, audit নেই।
- **Non-owner:** route metadata OWNER-only যাচাই + RolesGuard সরাসরি চালিয়ে ADMIN/ANALYST প্রত্যাখ্যাত, OWNER গৃহীত; অন্য org-এর job পড়লে 404। দ্বিতীয় import → 409।

## গেট (সব SERIALLY)

| গেট | ফল |
|---|---|
| ORG16 spec | **12/12 pass** |
| API সংশ্লিষ্ট suites (data-tools + organizations) | 18 suites, **194/194 pass** |
| Common suites (TenantGuard ছোঁয়া হয়েছে) | 14 suites, **160/160 pass** |
| চূড়ান্ত combined (data-tools + organizations + common) | **354/354 pass** |
| API `tsc --noEmit` + build (`tsconfig.build.json`) | **0 error**, dist-এ নতুন service যাচাই |
| Web tsc | **0 error** |
| Web vitest (full) | 110 files, **914/914 pass** (নতুন 3টি ab8 import-label test সহ) |
| Web build (`next build`) | **সবুজ** |
| Fresh scratch PG — পুরো migration sequence | **223/223 applied** (আগের 222 + `20261026000000_org_data_import`); `\d "DataImport"`-এ column/index/FK হুবহু যাচাই; cluster গেট শেষে stop + মোছা |
| **Real-DB round-trip** (অস্থায়ী spec, চালিয়ে মুছে দেওয়া হয়েছে) | **1/1 pass** — আসল Postgres + আসল generated client: remap করা FK আসল constraint-এ গৃহীত, BigInt column round-trip, আসল `refreshOrgSearchVectors` চলেছে (`searchVectorRefreshed: true`), profile token DB-তেই null |

**গেটে ধরা পড়া আসল ভুল (সৎ নোট):** প্রথম fresh-PG চেষ্টায় `prisma validate` ব্যর্থ হয় — schema-তে DataImport-এর doc comment `/** */` আকারে লেখা হয়েছিল, Prisma parser তা নেয় না (`//` লাগে)। tsc/jest কেউই schema parse করে না বলে আগের ধাপে ধরা পড়েনি; comment ঠিক করে (`487df725`) পুরো sequence আবার চালিয়ে 223/223 + real-DB round-trip পুনঃযাচাই করা হয়েছে। Migration SQL-এ কোনো বদল লাগেনি।

## NOT BUILT (স্পষ্ট তালিকা)

- **অ-খালি org-তে import/merge নেই** — নকশা অনুযায়ীই; আংশিক restore বা conflict-resolution UI-ও নেই।
- **সীমার বাইরের bundle-এর পথ নেই:** 25,000 সারির বেশি বা ~2.8MB-র বড় bundle-এর জন্য async/queued import, chunked upload বা storage-ভিত্তিক upload বানানো হয়নি — এই দরজা দিয়ে সেগুলো প্রত্যাখ্যাত হয়, সীমাটা UI-তে বলা আছে।
- **ফেরে না:** সদস্য/membership, সাবস্ক্রিপশন ও billing অবস্থা, পেমেন্ট লেজার, integration সংযোগ/credential, কথোপকথনের বার্তা, campaign-এর ad set/ad, টিকিটের বার্তা, মিডিয়া ফাইলের বাইট — report-এ কারণ-কোডসহ নাম থাকে, কিন্তু restore হয় না।
- **Loyalty পয়েন্টের ইতিহাস ফেরে না** — শুধু balance cache 0 থেকে শুরু; gift card/loyalty ledger bundle-এর অংশই নয়।
- **Provenance যাচাই সীমিত:** manifest-এ signature/version নেই বলে একটি হাতে-বানানো, কাঠামোগতভাবে নিখুঁত ও credential-মুক্ত bundle গৃহীত হবে — সত্যতা যাচাইের এর বেশি উপায় এক্সপোর্ট ফরম্যাটে নেই।
- **Dry-run সংরক্ষিত হয় না** — validate stateless (কিছু লেখে না-ই এর উদ্দেশ্য); আগের report পরে দেখতে হলে আবার validate করতে হয়।
- **OU12-সংযোগ:** OU12-তে backup RESTORE "NOT BUILT" ছিল ঠিক এই import engine-এর অভাবে। এই engine এখন আছে, কিন্তু OU12-এর `restoreSupported` পতাকা উল্টে দেওয়া বা backup-verify পথ থেকে সরাসরি restore চালু করা **এই ব্যাচে করা হয়নি** — ওটা OU-লাইনের পৃথক follow-up।
- **ORG14 (cross-org team view) ও ORG15 (org clone) এই রিপোর্টের আওতায় নয়** — OB5-এর বাকি অংশ, আলাদা সিদ্ধান্তের (D2/D3) অপেক্ষায়।

## Live প্রমাণ বাকি (owner-gated)

- কোনো migration live DB-তে চলেনি; পুরো ফিচার live-এ অপ্রমাণিত — আসল org-এর আসল এক্সপোর্ট ফাইল দিয়ে deploy-করা পরিবেশে একটি round-trip-ই প্রথম live প্রমাণ হবে।
- Push ও Dokploy Redeploy যথারীতি owner-এর স্পষ্ট নির্দেশের অপেক্ষায়।
