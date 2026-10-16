# RB6b Acceptance — Auto-Mirror Wiring (D3) + Review Image Mirror

ছোট ফলো-আপ ব্যাচ: RB6 acceptance-এ ধরা পড়া প্ল্যানের দুটো বাকি
অংশ বন্ধ করা — (১) scheduled/auto প্রোডাক্ট-ছবি মিরর wiring,
(২) `ExternalReview` ছবির মিরর। Worktree
`~/workspace/ai-marketing-saas-r2`, branch `r2-media`, base
`03a5da8` (RB6 head)। **লোকাল কমিট শুধু — push হয়নি।**

## Commits

| Commit | বিষয় |
|---|---|
| `799d472` | Mirror service: review pass + D3 opt-out + runAutoMirror; setting endpoints; ProductsModule export; specs |
| `b2bb683` | Job wiring: `product_image_mirror_sweep` (JOB_TYPES + template + executeJob + module import); dispatch spec |
| `61740ca` | Web: products পেজে অটো-মিরর টগল + রিভিউ গণনা notice-এ |
| (এই ডক) | Acceptance + package summary হালনাগাদ |

## ১. Org opt-out সেটিং (plan D3)

- সংরক্ষণ: **OrgFeatureFlag** — কোডবেসের বিদ্যমান per-org
  opt-out key-value প্যাটার্ন (নতুন মডেল নয়, তাই **নতুন
  migration লাগেনি**)। Key: `product_image_auto_mirror`।
  Row না থাকলে **ON** (D3-র ডিফল্ট); `enabled=false` row-ই
  opt-out। পড়া `orgFlagEnabled` দিয়ে (explicit row জেতে;
  lookup ব্যর্থ হলে enabled ধরা হয় — flag যাচাই কখনো
  নীরবে ফিচার বন্ধ করতে পারে না)।
- Endpoint (products controller-এ, mirror-external-এর পাশে,
  OWNER/ADMIN, static segment — `:productId`-এর আগে):
  - `GET organizations/:orgId/products/images/mirror-setting`
    → `{ productImageAutoMirror: boolean }`
  - `PATCH organizations/:orgId/products/images/mirror-setting`
    body `{ productImageAutoMirror: boolean }` (@IsBoolean DTO)
    → OrgFeatureFlag upsert + audit
    (`product.images.auto_mirror_setting`) → একই আকারে ফেরত।
- **সিদ্ধান্ত-নোট:** key-টি `KNOWN_FLAG_KEYS`-এ যোগ করা হয়নি
  — ওই তালিকা platform-এর plan-default গেটিং ও Admin Console
  flag editor-এর জন্য; এই opt-out org-র নিজের সেটিং, plan দিয়ে
  গেট করার বিষয় নয়। `orgFlagEnabled` অচেনা key-র explicit
  row ঠিকই পড়ে (plan layer শুধু known key-তে লাগে)।

## ২. Scheduled sweep job — `product_image_mirror_sweep`

- বিদ্যমান প্যাটার্ন হুবহু: `JOB_TYPES`-এ এন্ট্রি,
  `JOB_TEMPLATES`-এ টেমপ্লেট (targetKind `org`, দৈনিক
  1440 মিনিট), AutomationService-তে `@Optional` injection
  (constructor-এর **একদম শেষে** যোগ — positional spec
  construction-গুলোর অর্থ বদলায়নি), `executeJob` case
  `(orgId, actor)` পাস-থ্রু।
- AutomationModule এখন ProductsModule import করে —
  ProductsModule-এর import closure AutomationModule-এ
  পৌঁছায় না বলে যাচাই করা (module graph walk), **নতুন
  cycle নেই**; boot smoke-ও DI-clean (নিচে)।
- আচরণ: opt-out org → result `{ skipped: "opted-out" }`
  (ব্যর্থতা নয়)। চালু org → RB3-র একই run; result flat
  counts `{ scanned, mirrored, deduped, failed, reviews }`।
- **Job কোনো org-এ নিজে থেকে enable হয় না** — বাকি
  sweep-গুলোর মতোই মালিক Automations থেকে per-org enable
  করবেন। ম্যানুয়াল endpoint আগের মতোই, এবং সেটি opt-out
  দিয়ে **গেট করা নয়** (স্পষ্ট owner-ক্লিক automatic নয়)।

## ৩. ExternalReview ছবির মিরর

- `ProductImageMirrorService.mirrorExternalImages` এখন
  প্রোডাক্ট pass-এর পর review pass চালায়: org-র
  `ExternalReview.imageUrls`-এর বাইরের URL-গুলো **একই**
  guarded-fetch + sha256 dedupe পাইপলাইনে (প্রোডাক্ট ও
  রিভিউ pass এখন একটাই shared `resolveUrlOutcomes` ব্যবহার
  করে — নীতি দুই জায়গায় দুই রকম হওয়ার সুযোগ নেই)।
  StoredFile surface = `review`, key
  `{orgId}/review/{reviewId}/{uuid}.{ext}`, sourceRef =
  মূল URL।
- Row rewrite: সফল entry → CDN URL; ব্যর্থ entry → মূল URL
  অপরিবর্তিত; non-external entry (আগের CDN URL, non-string)
  হুবহু থাকে। Row update ব্যর্থ হলে ওই row-র সফলগুলোও
  failed গোনা হয় (পরের run আবার চেষ্টা করবে)।
- Response summary-তে আলাদা ফিল্ড:
  `reviews: { scanned, mirrored, failed }` — বিদ্যমান
  ফিল্ডগুলোর আকার অপরিবর্তিত (শুধু নতুন ফিল্ড যোগ; RM4
  spec-এর exact-match assertion সেই অনুযায়ী হালনাগাদ)।
  Dedupe adoption এখানে `mirrored` গোনা হয় (entry এখন
  নিজের CDN-ই নির্দেশ করে — আলাদা `deduped` ফিল্ড brief-এ
  ছিল না)।
- Bounds: review pass-ও একই per-run cap
  (`MIRROR_BATCH_LIMIT = 25` entry/run); বেশি থাকলে বাকিটা
  পরের run-এর জন্য থাকে। Local মোডে review entry-গুলো
  failed গোনা হয়, কিছুই rewrite হয় না — প্রোডাক্ট pass-এর
  সৎ প্রত্যাখ্যানের ধরনেই।
- Sweep job একই সম্প্রসারিত সার্ভিসই ডাকে — ফলাফলে
  `reviews` counts job result-এও থাকে।

## ৪. Web

Products পেজে মিরর বোতামের পাশে "অটো-মিরর" checkbox
(GET/PATCH mirror-setting; সেটিং পড়া না গেলে টগল লুকানো
থাকে, ভুয়া অবস্থা দেখায় না) এবং মিরর-ফলাফলের notice-এ
রিভিউ ছবির গণনা। কোনো redesign নয়।

## গেট

| Gate | ফল |
|---|---|
| নতুন spec `products/rb6b-auto-mirror` | **8/8** — সেটিং ডিফল্ট ON, setter একটাই row upsert + দুই দিক flip, অন্য org অপ্রভাবিত; runAutoMirror opt-out skip (fetch শূন্য, row অপরিবর্তিত), enabled passthrough (reviewsসহ); ProductsService facade read/write; review mirror সফল rewrite + surface=review registry + পুনঃrun no-op, registry dedupe (upload শূন্য), mixed সফল/ব্যর্থ (ব্যর্থ entry অপরিবর্তিত), local মোডে failed গণনা |
| নতুন spec `automation/rb6b-mirror-job` | **4/4** — JOB_TYPES/template নিবন্ধন, executeJob dispatch (orgId, actor) + summary verbatim, opt-out skip passthrough, সার্ভিস না থাকলে `{skipped: …unavailable}` |
| RM4 spec (হালনাগাদ assertion) | **16/16** — summary-তে reviews ফিল্ডসহ |
| Regression chunk: products + storage | **16 suites / 157 tests** ✅ |
| Regression chunk: automation (পূর্ণ) | **14 suites / 83 tests** ✅ (a4/cx3 positional construction অক্ষত) |
| API build (`@repo/api...`) | ✅ সবুজ (solo) |
| Web build | ✅ সবুজ (solo) |
| Boot smoke (compiled app, dummy DB) | **1,353 route** mapped (RB6-এর 1,351 + নতুন GET/PATCH mirror-setting), DI error শূন্য; থেমেছে শুধু ইচ্ছাকৃত dummy DB-তে (Prisma can't-reach) |
| Migration | **নেই** — OrgFeatureFlag বিদ্যমান টেবিল |

সব spec fake seam-এ — **আসল R2 bucket ছোঁয়া হয়নি**; লাইভ
প্রমাণ আগের মতোই deploy-পরবর্তী RM0 চেকলিস্টে।

## সৎ সীমা

- Job-টি deploy-এর পর মালিককে per-org enable করতে হবে —
  enable না করা পর্যন্ত auto-mirror চলবে না (এটা নকশা
  অনুযায়ী; ম্যানুয়াল মিরর ততদিনের পথ)।
- Import/sync-এর মুহূর্তে তাৎক্ষণিক মিরর (sync-hook) বানানো
  হয়নি — দৈনিক sweep-ই automatic পথ; প্ল্যানের "sync পুনরায়
  চললে একই ছবি দ্বিতীয়বার আসবে না" নীতি sha256/sourceRef
  dedupe দিয়ে sweep-এও বহাল।
- Screenshot QA deploy-এর পর (টগলটি পেজে দেখা যাওয়া)।
