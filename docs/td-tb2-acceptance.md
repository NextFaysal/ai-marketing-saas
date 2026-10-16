# TD Batch TB2 — Acceptance (TD4 Host Classification + TD5 Surface Separation + TD3 Ops Runbook)

তারিখ: 2026-10-15 · Worktree: `~/workspace/ai-marketing-saas-td`, branch `tenant-domain`, base `fb7222a` (TB1 complete)। এই batch-এ কোনো migration নেই, API স্পর্শ করা হয়নি। Local commits only — কোনো push হয়নি।

## যা বানানো হলো

### TD4 — Host শ্রেণিবিভাগ (মূল কোড)
- **Commit `a8ae1ff`** — `apps/web/src/lib/custom-domain.ts`-এ `classifyHost(host)`:
  - ফেরত: `{kind:"platform"}` | `{kind:"shop-subdomain", slug}` | `{kind:"shop-custom-candidate"}` | `{kind:"unknown"}`।
  - নিয়ম: apex (`qosprey.com`) → platform; apex-এর নিচে ঠিক এক স্তরের label + TD1 local slug check পাস (`checkSlugLocally` — format বৈধ + reserved নয়) → shop-subdomain (slug = label); **যেকোনো শ্রেণির reserved নাম (system/misleading/future + substring নিয়ম) → platform** — প্ল্যাটফর্মের নিজের namespace, কখনো দোকান নয় (মালিকের উদাহরণ `dashboard`, `fake`, `orgnail` সবই এই নিয়মে platform); format-অবৈধ label (reserved-ও নয়) → unknown; **বহু-স্তরের নাম (`a.b.qosprey.com`) → unknown** — কোড মন্তব্যে স্পষ্ট সিদ্ধান্ত লেখা আছে: v1-এ sub-subdomain নেই, এটা platform-ও নয়, shop-ও নয়, custom-domain lookup-এর জন্যও প্রার্থী নয়; apex-এর বাইরের host → shop-custom-candidate (EC8 by-domain lookup দিয়ে যাচাই বাকি থাকে); খালি/localhost/`.local` → unknown (middleware আগের মতোই `shouldSkipHost` দিয়ে আগেই বাদ দেয়)।
  - **TD1 contracts পুনঃব্যবহার, দ্বিতীয় কপি নয়:** তালিকা ও নিয়ম `@repo/contracts` থেকে import (`PLATFORM_APEX_DOMAIN`, `checkSlugLocally`, `isReservedSlug`) — web lib-এ contracts import TB1-এ onboarding/shop-slug ইতিমধ্যে করেছে, এখানে তা lib স্তরে নামানো হলো; middleware edge bundle-এ contracts+ zod ঢুকলেও build সবুজ (নিচের গেট)।
  - একই commit-এ TD5-এর খাঁটি ফাংশন দুটো: `isPanelPath()` (প্রথম segment ঠিক মিললে — `/dashboard`, `/login`, `/register`, `/onboarding`, `/accept-invite` ও তাদের subpath; `/dashboardx`-এর মতো look-alike মেলে না) ও `panelAppRedirectUrl()` (`https://app.` + contracts apex ধ্রুবক — কোনো নতুন env নয়; path + query হুবহু রাখে)।
- **Commit `d105deb`** — `apps/web/src/middleware.ts` পুনর্গঠন:
  - শ্রেণি অনুযায়ী প্রবাহ: platform/unknown → `NextResponse.next()` (আগের internals/assets early-skip ও skip-host আচরণ অপরিবর্তিত); **shop-subdomain → DB lookup ছাড়াই** `rewritePathForShop(pathname, slug)` rewrite; shop-custom-candidate → বিদ্যমান EC8 lookup হুবহু (VERIFIED ডোমেইনই শুধু shop host, fail-open, ৬০ সেকেন্ড cache)।
  - **অস্তিত্বহীন slug-এর আচরণ (এই tree-তে পড়ে যাচাই করা):** middleware কিছু করে না — rewrite `/shop/{slug}`-তেই যায়; এই tree-র shop পেজ (`apps/web/src/app/shop/[orgSlug]/page.tsx`) `fetchShopHome()` null পেলে নিজে `notFound()` ডাকে, layout-ও home না থাকলে children হাতে ছেড়ে দেয় পেজের 404-এর জন্য (layout-এর নিজের মন্তব্যেই লেখা)। **প্ল্যান বনাম বাস্তবতার অমিল:** প্ল্যান §TD4-এ "দোকানের branded 404 (GB1)" বলা ছিল — **এই tree-তে shop-নির্দিষ্ট `not-found.tsx` নেই** (GB1 storefront completion এই base-এ নেই, TB1-এও নথিভুক্ত); তাই অস্তিত্বহীন দোকানে Next.js-এর ডিফল্ট 404 পেজ দেখাবে। Branded 404 চাইলে GB1 লাইন integrate হওয়ার পরের বিষয় — এই batch-এ বানানো হয়নি, অনুমান করে দাবিও করা হচ্ছে না।
  - কারিগরি নোট: middleware-এর custom-domain import `@/lib/...` থেকে **relative** করা হয়েছে — web-এর vitest সেটআপে `@/` alias resolution নেই (বিদ্যমান কোনো test-ই `@/` import করে না; সব testable মডিউল relative import-এই পরীক্ষিত), তাই routing table testable রাখতে এই পরিবর্তন; Next build-এ কোনো প্রভাব নেই (গেট সবুজ)।

### TD5 — Surface পৃথকীকরণ
- একই commit `d105deb`: shop হোস্টে (subdomain + **VERIFIED** custom — দুটোতেই) প্যানেল পথ rewrite-এর **আগে** যাচাই হয়ে **308 redirect** → `https://app.qosprey.com` + একই পথ + query string অক্ষত (invite token-সহ middleware spec-এ প্রমাণিত)। Platform হোস্টে এই পথগুলো আগের মতোই সার্ভ হয় (spec-এ প্রমাণিত)। UNVERIFIED custom প্রার্থী হোস্টে redirect-ও নয়, rewrite-ও নয় — হোস্টটা shop বলে নিশ্চিত না হলে কিছুই নয়।
- Shop হোস্টে দোকানের পথ ও বিদ্যমান পাবলিক surface-এর আচরণ EC8-এর নিয়মেই অপরিবর্তিত (regression spec-সহ)।

### TD3 — Wildcard ops রানবুক (শুধু নথি)
- **Commit `7bdfe9b`** — `docs/td-tb2-wildcard-runbook.md`: এই repo-র `docs/deployment-dokploy.md`-এর কাঠামোর সাথে মিলিয়ে ধাপে ধাপে — (ক) Cloudflare wildcard `*.qosprey.com` proxied A রেকর্ড (মান = বিদ্যমান app রেকর্ডের হুবহু মান, মালিক প্যানেলে কপি করবেন; নির্দিষ্ট রেকর্ডের প্রাধান্যের নোটসহ); (খ) SSL — edge Universal-এর এক-স্তর আওতা যাচাই + Full (Strict) মোড যাচাই (2026-10-15 থেকে বাকি ছিল), origin-এ Origin CA wildcard অথবা Traefik ACME DNS-01 — দুই পথই, কোনটা নেওয়া হলো বাস্তবায়নে টীকা দেওয়ার নির্দেশসহ; private key কখনো চ্যাট/repo-তে নয়; (গ) Dokploy web সার্ভিসে wildcard domain, না হলে Traefik dynamic config-এ HostRegexp বিকল্প; (ঘ) ৫টি যাচাই probe (এলোমেলো subdomain পৌঁছায় / app·admin·api·media অক্ষত / আসল org-এর দোকান / TD5 redirect / SSL); (ঙ) rollback = wildcard রেকর্ড মোছা (কোড/DB rollback লাগে না — fail-open)।
- প্রতিটা ধাপে দায়িত্ব চিহ্নিত: **[মালিক]** প্যানেলে/সার্ভারে, **[Muse যাচাই]** বাইরে থেকে probe। Dokploy-এর wildcard-domain সমর্থন ও Traefik dynamic config-এর সঠিক অবস্থান জাতীয় অনিশ্চিত জায়গা রানবুকে **"যাচাই সাপেক্ষে"** বলে চিহ্নিত — আত্মবিশ্বাসী ভুয়া ধাপ লেখা হয়নি।

## গেট (সব serially চালানো)

| গেট | ফলাফল |
|---|---|
| নতুন lib spec `lib/custom-domain.test.ts` | **18/18 পাস** (আগে 7; TD4 শ্রেণিবিভাগ সারণি 8টি + TD5 panel/redirect 3টি নতুন) — সারণিতে: apex/www/app/admin/api/media/mail, reserved (dashboard/fake/orgnail/pay/wallet/substring), বৈধ slug, বড় হাতের/পোর্ট/trailing-dot host, বহু-স্তর, malformed label, খালি/localhost, custom প্রার্থী |
| নতুন middleware spec `middleware.test.ts` | **7/7 পাস** — subdomain rewrite (lookup ছাড়া), platform/unknown pass-through, subdomain-এ panel 308 (query + invite token অক্ষত), verified custom-এ 308, unverified custom-এ কিছুই নয়, EC8 rewrite regression |
| Web vitest পুরো | **57 ফাইল, 467/467 পাস** (TB1-এর 56 ফাইল/449 থেকে +1 ফাইল, +18 test) |
| Web tsc (`tsc --noEmit`) | পরিষ্কার (exit 0) |
| Web build (`next build`) | সবুজ (exit 0) — route তালিকায় `ƒ Middleware` সহ |
| Compiled middleware প্রমাণ | build-এর bundle `.next/server/src/middleware.js`-এ (middleware-manifest অনুযায়ী এটাই compiled middleware ফাইল; BUILD_ID `3lRXuCH2XULEafQ-xc0TX`) grep: `shop-subdomain` ×২, `"unknown"` ×৫, `accept-invite` ×২, `public/shop/by-domain` ×১ (EC8 lookup অক্ষত), আর redirect ডাকটা হুবহু — `` https://app.${…} `` template + `, 308)` + `nextUrl.search` (query preservation) একই expression-এ। দ্রষ্টব্য: `classifyHost` নামটি production bundle-এ minify হয়ে যায় বলে নাম ধরে grep 0 — শাখাগুলোর string literal ও 308 ডাকই প্রমাণ |
| Contracts / API | **স্পর্শ করা হয়নি** — contracts শুধু import করা হয়েছে (TB1-এ তৈরি dist-ই ব্যবহৃত), তাই contracts/API suite এই batch-এ প্রযোজ্য নয় (batch নির্দেশ অনুযায়ী) |

## NOT BUILT (সচেতনভাবে বানানো হয়নি)

- **আসল wildcard DNS রেকর্ড বসানো** — মালিকের Cloudflare প্যানেলের ধাপ (রানবুক ধাপ ১); Muse কিছু বদলায়নি।
- **SSL সার্টিফিকেট ইস্যু** — edge Universal আওতা যাচাই ও origin wildcard (Origin CA / ACME DNS-01) দুটোই রানবুকের ধাপ, এখনো চালানো হয়নি; Full (Strict) মোডের প্যানেল যাচাইও মালিকের হাতে বাকি।
- **Dokploy/Traefik-এ wildcard routing** — Domains tab-এ wildcard domain যোগ বা HostRegexp dynamic config — সার্ভারের ধাপ, হয়নি।
- **Subdomain-এর লাইভ resolve** — ফলত `{slug}.qosprey.com` এখনো লাইভে খোলে না; কোনো লাইভ দাবি এই acceptance-এ নেই। লাইভ প্রমাণ **TD12**-তে (আসল org + রানবুকের ৫ probe)।
- **দোকানের header-এ "দোকান পরিচালনা করুন" লিংক** (প্ল্যান §TD5-এর তৃতীয় বুলেট) — এই batch-এর নির্দিষ্ট scope-এর (redirect + spec) বাইরে ছিল; এই tree-র `ShopHeader`-এ এমন লিংক নেই — বানানো হয়নি।
- **Branded shop 404** — GB1 লাইনের জিনিস, এই tree-তে নেই (ওপরে অমিল দ্রষ্টব্য)।
- **TB3–TB5-এর সবকিছু:** CORS pattern (TD6), canonical/301 (TD7), ঠিকানা কার্ড (TD8), custom-domain ধাপ-UI (TD9), custom-domain SSL spike (TD10), slug tombstone (TD11), লাইভ যাচাই (TD12)।

## সৎ সীমানা

- এই batch-এর সব প্রমাণ unit/spec/build স্তরের; লাইভে কিছুই বদলায়নি — DNS, সার্টিফিকেট, Dokploy সব মালিকের রানবুক ধাপে বাকি।
- শ্রেণিবিভাগের সচেতন trade-off: reserved নাম platform শ্রেণিতে পড়ে — অর্থাৎ `fake.qosprey.com`-এ অনুরোধ এলে middleware পাশ কাটিয়ে যাবে এবং প্ল্যাটফর্মের ডিফল্ট আচরণ (ওই হোস্টে কোনো সার্ভিস বসানো না থাকলে 404) হবে; ওই নামে দোকান কখনোই খুলবে না — এটাই উদ্দেশ্য।
- Push হয়নি; deploy মালিকের নির্দেশে।
