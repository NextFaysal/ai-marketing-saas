# TD Batch TB1 — Acceptance (TD1 Reserved Slugs + TD2 Subdomain Picker)

তারিখ: 2026-10-15 · Worktree: `~/workspace/ai-marketing-saas-td`, branch `tenant-domain`, base `cf3efd5` (GitHub main, tree clean, 194 migrations — এই batch-এ কোনো migration নেই)।
সূত্র পরিকল্পনা: `Tenant-Domain-Plan-2026-10-15.md` §৪ Batch TB1। Local commits only — কোনো push হয়নি।

## যা বানানো হলো

### TD1 — Reserved slug ব্যবস্থা
- **Commit `3f9fddd`** — contracts-এ একটাই source of truth (`packages/contracts/src/index.ts`):
  - `RESERVED_SYSTEM_SLUGS` (প্ল্যানের তালিকা: app, admin, api, media, www, mail, dashboard, login, register, logout, shop, store, support, help, pricing, blog, docs, status, cdn, assets, static, webhook(s), oauth, auth, account, billing, settings, platform, system, root, home, official-site)
  - `RESERVED_MISLEADING_SLUGS` (qosprey, fake, official, verified, original, orgnail, genuine, authentic + প্রাথমিক profanity তালিকা: porn, porno, sex, xxx, adult, casino, gambling)
  - `RESERVED_FUTURE_SLUGS` (pay, wallet, ads, ai, inbox, crm)
  - শব্দাংশ-নিয়ম `RESERVED_SLUG_SUBSTRINGS = [admin, support, official]` — slug-এ এই শব্দাংশ থাকলেই সংরক্ষিত (my-admin-shop, supportbd, officialstore আটকায়)। নথিভুক্ত trade-off: "administerial"-ধাঁচের নির্দোষ নামও আটকাবে; "ai" শুধু exact — substring নয়, তাই "said-shop" পাস করে।
  - `SLUG_FORMAT_REGEX = /^[a-z0-9]+(-[a-z0-9]+)*$/` (শুরু/শেষে hyphen নয়, পরপর hyphen নয়) + দৈর্ঘ্য ৩–৬০; `createOrganizationSchema` এই regex ব্যবহার করে (আগে ছিল `/^[a-z0-9-]+$/`)। `checkSlugLocally` / `isReservedSlug` (caller-supplied extras সহ) / `slugFormatInvalid` / `PLATFORM_APEX_DOMAIN = "qosprey.com"` / `shopSubdomainHost()`।
- **Commit `faed25f`** — API প্রয়োগ:
  - `apps/api/src/common/slug-availability.ts` — একটাই সিদ্ধান্ত ফাংশন `slugAvailability(prisma, slug)`: contracts-এর local যাচাই + platform setting **`reservedSlugsExtra`** থেকে SUPER-যোগ করা অতিরিক্ত নাম (array বা `{slugs:[...]}` আকার; M33 `platformSetting` পাঠ-পথ, ত্রুটিপূর্ণ মান = "extras নেই") + DB-তে taken যাচাই। ফেরত: `{ slug, available, reason: ok|taken|reserved|invalid, message (বাংলা) }`।
  - `OrganizationsService.create` এখন এই সিদ্ধান্তই প্রয়োগ করে: reserved/invalid → বাংলায় কারণসহ `BadRequestException`; taken → আগের আচরণই (`ConflictException`, "This slug is already taken")। `CreateOrganizationDto`-এর `@Matches` একই কঠোর regex-এ মেলানো।
  - **TD2 endpoint:** `GET /organizations/slug-available?slug=` (controller-এ `:organizationId`-এর আগে ঘোষিত, যাতে literal segment ধরা না পড়ে) — create-এর হুবহু একই ফাংশন, দ্বিতীয় যাচাই নয়।
- **Commit `14969ad`** — বিদ্যমান-slug অডিট script `apps/api/scripts/audit-existing-slugs.mjs`: read-only; DB mode (DATABASE_URL + @repo/db Prisma) ও `--fixtures <json>` sandbox mode; contracts-এর compiled dist থেকে নিয়ম নেয় (কপি নয়); সংঘর্ষ পেলে slug + সমস্যার ধরন (reserved / invalid-format) রিপোর্ট করে, **কিছুই rename করে না**।

### TD2 — Subdomain বাছাই UI
- **Commit `f9b8e17`** — `apps/web/src/lib/shop-slug.ts` (slugify + contracts-ভিত্তিক local verdict + `SHOP_ADDRESS_SUFFIX`) এবং onboarding পরিবর্তন:
  - ধাপ-১-এ "আপনার দোকানের ঠিকানা" ক্ষেত্র: নাম টাইপ করলেই প্রস্তাবিত slug (হাতে বদলালে আর auto-follow করে না), পাশে `.qosprey.com` suffix, debounce (400ms) দিয়ে `slug-available` API-তে লাইভ যাচাই; স্থানীয় contracts verdict দিয়ে format/reserved ত্রুটি সঙ্গে সঙ্গে। অবস্থা বাংলায়: যাচাই হচ্ছে / ✓ খালি আছে / নেওয়া / সংরক্ষিত / নিয়ম মেলেনি / যাচাই ব্যর্থ। **available নিশ্চিত না হলে submit বাটন নিষ্ক্রিয়।**
  - ধাপ-২-এর ওপরে ঠিকানা ব্যানার: `{slug}.qosprey.com` + কপি বোতাম + বর্তমান `/shop/{slug}` পেজের লিংক + স্পষ্ট লেখা **"এই ঠিকানা পরে বদলানো যাবে না"** (একই সতর্কতা ধাপ-১-এর ক্ষেত্রের নিচেও)। ধাপ-২-এর বাকি আচরণ অপরিবর্তিত।

## গেট (সব serially চালানো)

| গেট | ফলাফল |
|---|---|
| Contracts tests (`@repo/contracts`) | **15/15 পাস** (আগে 7; TD1-এর 8টি নতুন) |
| Contracts tsc (`--noEmit`) | পরিষ্কার |
| নতুন API spec `organizations/td1-slug.spec.ts` | **13/13 পাস** |
| Organizations suites (সব 10টি) | **78/78 পাস** |
| API tsc (`--noEmit`) | পরিষ্কার |
| Prisma validate | Schema valid (শুধু validate-এর জন্য placeholder `DATABASE_URL` লেগেছে; validate কোনো DB-তে connect করে না) |
| API build (`tsc -p tsconfig.build.json`) | সবুজ; compiled dist-এ `slug-available` route ও create-এ `slugAvailability` প্রয়োগ যাচাই করা হয়েছে |
| Web tsc (`lint`) | পরিষ্কার |
| Web build (`next build`) | সবুজ |
| Web vitest (পুরো) | **56 ফাইল, 449/449 পাস** (নতুন `shop-slug.test.ts` 3/3 সহ) |
| API পুরো suite | নিচে দ্রষ্টব্য — chunk পদ্ধতিতে **417/417 suite হিসাব মিলেছে, 4,330 tests-এর মধ্যে 4,328 পাস** |

**API পুরো suite-এর সৎ বিবরণ:** একক রান দুবার পরিকাঠামোতে মারা গেছে — (১) `jest --runInBand` একক প্রসেসে ~2GB heap OOM (sandbox সীমা, কোনো test ফলাফল নয়); (২) `--maxWorkers=2` রান exec-session aborted, কোনো summary ছাড়া (পরে দেখা গেছে aborted exec তার jest worker-গুলোকে অনাথ রেখে গিয়েছিল — শুধু এই worktree-র worker চিহ্নিত করে পরিষ্কার করার পর মেমরি 6.5GB-used থেকে 2.0GB-used-এ নেমে আসে; একই VM-এ সমান্তরালে অন্য worktree-র ভারী রানও চলছিল)। এরপর suite 9টি chunk-এ ভাগ করে serially চালানো হয়েছে (প্রতিটি `--maxWorkers=2`, লগ `/tmp/td-gates/`):

| Chunk | Suites | Tests |
|---|---|---|
| inbox | 53/54 | 563/564 |
| campaigns + ai | 54/54 | 411/411 |
| social + orders | 48/48 | 784/784 |
| connections + admin | 41/42 | 495/496 |
| commerce + storefront + automation | 43/43 | 451/451 |
| workflows + messaging + courier + organizations | 47/47 | 460/460 |
| integrations + reports + fulfillment + customers | 37/37 | 218/218 |
| ads + products + crm + common + storage + payments | 51/51 (নিচে টীকা) | 411/411 |
| বাকি ছোট ডিরেক্টরি (27টি) | 41/41 | 535/535 |
| **মোট** | **415/417 suite সরাসরি; 417/417 হিসাব মিলেছে** | **4,328/4,330** |

- Chunk 8-এ 2টি suite (`products/ec29-single-checkout`, `common/ap3-api-key-scopes`) worker SIGKILL-এ মারা গিয়েছিল (test failure শূন্য; ওই chunk-এ 400/400 test পাস) — solo পুনঃচালনায় দুটোই পাস (11/11), তাই কার্যকর ফল 51/51।
- **ব্যর্থ 2টি test — দুটোই এই batch-এর diff-এর বাইরে এবং আগের থেকে জানা:**
  ১. `inbox/cx3-debounce.spec.ts` (1টি test) — CX প্যাকেজ থেকে নথিভুক্ত open flake; solo পুনঃচালনায় হুবহু একই ফল (17/18)। এই batch inbox-এর কোনো ফাইল ছোঁয়নি (`git diff cf3efd5..HEAD`-এ inbox ফাইল 0টি)।
  ২. `connections/cc26-payout-automation.spec.ts` (1টি test — দ্বিতীয় sweep-এর reason `already_created_for_slot`-এর বদলে `below_threshold`) — solo পুনঃচালনায় হুবহু একই ব্যর্থতা; connections/wallet-এর কোনো ফাইল এই batch ছোঁয়নি। Base code-এর এই পরিবেশ/তারিখে আগের থেকেই থাকা অবস্থা; TB1-এর কারণে নয় — তবে root-cause এই batch-এ নির্ণয় করা হয়নি (scope-এর বাইরে)।

## বিদ্যমান-slug অডিটের ফলাফল ও সীমা

- Fixture mode-এ চালানো হয়েছে (এই sandbox-এ আসল DB নেই): ৮টি নমুনা slug-এর মধ্যে **৬টি সংঘর্ষ সঠিকভাবে ধরা পড়েছে** — `app`, `fake`, `orgnail` (reserved), `my-admin-shop` (substring নিয়মে reserved), `brand-xyz` (fixtures-এর reservedSlugsExtra দিয়ে reserved), `bad--slug` (invalid-format)। `demo-store` ও `dhaka-fashion` পাস।
- DATABASE_URL ছাড়া চালালে script setup ত্রুটি দিয়ে exit 2 করে (কিছুই পড়ে না/লেখে না) — যাচাই করা হয়েছে।
- **আসল (live) DB-তে অডিট চালানো বাকি** — মালিকের deploy-পরবর্তী ধাপে DATABASE_URL দিয়ে DB mode-এ চালাতে হবে। ততক্ষণ কোনো বিদ্যমান org-এর slug নিয়ে কোনো দাবি করা হচ্ছে না।

## NOT BUILT (এই batch-এ সচেতনভাবে বানানো হয়নি)

- **Admin UI দিয়ে reserved নাম যোগ/তালিকা দেখা** — শুধু `reservedSlugsExtra` settings key **পড়া** পর্যন্ত বানানো; SUPER অ্যাডমিনের জন্য UI TD1 প্ল্যানের পরের ধাপ (এই batch-এর scope-এর বাইরে বলে আগেই নির্দিষ্ট ছিল)।
- **TB2–TB5-এর সবকিছু:** wildcard DNS/SSL/Traefik routing (TD3), host শ্রেণিবিভাগ middleware (TD4), shop হোস্টে প্যানেল redirect (TD5), CORS pattern (TD6), canonical/SEO (TD7), ঠিকানা কার্ড (TD8), custom domain ধাপ-UI (TD9), custom-domain SSL spike (TD10), slug tombstone/cooldown (TD11), লাইভ যাচাই (TD12)। ফলে `{slug}.qosprey.com` ঠিকানাটি এখনো **লাইভে resolve হয় না** — TB1 শুধু নামের শাসন ও বাছাই পর্যন্ত; UI-তে "দোকান দেখুন" লিংক হিসেবে বর্তমানে চালু `/shop/{slug}` পথটাই দেওয়া হয়েছে, ভুয়া subdomain লিংক নয়।
- **Slug rename** — D2 সিদ্ধান্ত অনুযায়ী v1-এ নেই; UI-তে অপরিবর্তনীয়তার সতর্কতাই বসানো হয়েছে।
- **Custom-domain প্ল্যান gating (D1)** — কোনো gating বসানো হয়নি (সিদ্ধান্ত বাকি থাকা পর্যন্ত প্ল্যানের নির্দেশই তাই)।
- দোকান চালু/বন্ধের (`shopEnabled`) সাথে subdomain বাছাইয়ের কোনো সংযোগ এই batch-এ করা হয়নি — picker সব নতুন org-এর জন্য ঠিকানা ঠিক করে দেয়; দোকান প্রকাশের সুইচ আগের মতোই storefront settings-এ।

## সৎ সীমানা

- কোনো কিছু live নয়: এই batch-এর সব প্রমাণ unit/spec/fixture স্তরের (নিচের গেট দ্রষ্টব্য)। Push হয়নি; Dokploy/Redeploy/DNS মালিকের ধাপ।
- Substring নিয়মের পরিচিত মাশুল: "admin/support/official" শব্দাংশ থাকা নির্দোষ নামও আটকাবে — প্ল্যানের নির্দেশ অনুযায়ী সচেতন trade-off, অডিট report-এও একই নিয়ম প্রযোজ্য।
