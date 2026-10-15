# TD Batch TB4 — Acceptance (TD9 Custom Domain এক-জায়গায় + TD10 SSL Spike ও রায়)

তারিখ: 2026-10-16 · Worktree: `~/workspace/ai-marketing-saas-td`, branch `tenant-domain`, base `be61124` (TB1–TB3 complete, tree clean)।
সূত্র পরিকল্পনা: `Tenant-Domain-Plan-2026-10-15.md` §৪ Batch TB4। এই batch-এ কোনো migration নেই। Local commits only — কোনো push হয়নি।
কাজের ধরন: coordinator (এই সেশন) + ৩টি সমান্তরাল worker (SSL spike গবেষণা / API / web) — প্রত্যেকে শুধু নিজের ফাইল-এলাকা ছুঁয়েছে, ছোট commit-এ; পূর্ণ গেট coordinator serially চালিয়েছে।

## Inventory — custom domain-এর আসল অবস্থা (এই batch শুরুর আগে পড়ে যাচাই করা)

| বিষয় | অবস্থা (প্রমাণ) |
|---|---|
| ডোমেইন কোথা থেকে সেট হয় | **একটাই লেখার পথ:** `OrganizationsService.updateBranding` (PATCH `/organizations/:id/branding`, OWNER/ADMIN) — web-এ `/dashboard/settings`-এর BrandingCard (brandName/primaryColor-র সাথে গোছা করে পাঠানো হতো)। Normalize (trim/lowercase/protocol+path ছাঁটা) + format regex + অন্য org-এর সাথে uniqueness Conflict — সব এখানেই ছিল। Storefront-এর নিজের কোনো domain-set endpoint ছিল না। |
| Storefront domain flow | `StorefrontService`: `issueDomainVerifyToken` (customDomain না থাকলে BadRequest "আগে … সেট করুন"; নতুন টোকেন ইস্যুতে `domainVerifiedAt` null — টোকেন বদলেই যাচাই রিসেট), `verifyDomain` (`_qosprey-verify.<domain>`-এ আসল TXT lookup, টোকেন হুবহু মিললেই `domainVerifiedAt` বসে), `checkDomainRouting` (https/http ধরে `/shop/<slug>` fetch, দোকানের চিহ্ন মিললেই active; never throw, diagnostic মাত্র), `byDomain` (**হুবহু** `Organization.customDomain` মিল + `domainVerifiedAt` থাকলেই slug; নইলে NotFound)। Staff endpoints: `domain/verify-token`, `domain/verify`, `domain/check-routing` (সব ADMIN_ROLES)। |
| **ডোমেইন বদলালে যাচাই রিসেট হয় কিনা** | **হয় না — আসল বাগ:** `updateBranding` দিয়ে `customDomain` বদলালে/সরালে StorefrontSetting-এর `domainVerifyToken` ও `domainVerifiedAt` অপরিবর্তিত থেকে যেত — অর্থাৎ পুরনো ডোমেইনের TXT প্রমাণ নতুন ডোমেইনকে "verified" বানিয়ে রাখত, আর `byDomain` নতুন ডোমেইনকে প্রমাণ ছাড়াই resolve করত। এই batch-এ ঠিক করা হয়েছে (TD9 পয়েন্ট ২) — দুই লেখার পথেই। |
| www ↔ apex | কোথাও মিল ছিল না: `byDomain` হুবহু host মিল; TB3-এর CORS lookup-ও হুবহু মিল (TB3 acceptance-এ NOT BUILT হিসেবে এই batch-এর বিষয় বলে নথিভুক্ত)। Middleware শুধু API-র byDomain-কেই ডাকে — আলাদা web নিয়ম নেই। |
| Settings UI (batch-পূর্ব) | Storefront পেজে TD8 ঠিকানা কার্ড + "কাস্টম ডোমেইন" section (৩-ধাপ অবস্থা, টোকেন/যাচাই/routing বোতাম) ছিল, কিন্তু ডোমেইন **লেখা যেত না** — ব্যবহারকারীকে branding পেজে পাঠানো হতো; routing নির্দেশনা (কোন DNS রেকর্ড, কী মান) ছিল না; SSL-র কোনো অবস্থা-সারি ছিল না। BrandingCard-এই customDomain input ছিল (দ্বৈত surface)। |

## TD9 — যা বানানো হলো

### API (৬ commit: `6fd43a5`, `5de757c`, `80e1f95`, `7bc3e0d`, `d4b9554`, `ac117d5`)
- **Shared নিয়ম এক জায়গায়** — নতুন `apps/api/src/common/custom-domain.ts`: `normalizeCustomDomainInput` (বিদ্যমান semantics), `customDomainVariants` (www টগল, deduped `[host, toggled]`), `customDomainCandidates`, `isPlatformHostedDomain` (apex অথবা `.qosprey.com`-এ শেষ), আর দুই write-path-এর অভিন্ন বাংলা প্রত্যাখ্যান-বার্তা `PLATFORM_CUSTOM_DOMAIN_MESSAGE`। Pure spec `custom-domain.spec.ts` **39 tests**। StorefrontService-এর private `normalizeDomain` এখন এই shared ফাংশনকেই ডাকে (দ্বিতীয় কপি নয়)।
- **`StorefrontService.setCustomDomain(orgId, actorId, raw)`** + staff endpoint `POST /organizations/:id/storefront/domain/set` (ADMIN_ROLES; DTO `SetCustomDomainDto`):
  - null/খালি = সরানো; নইলে normalize → branding-এর হুবহু format regex (BadRequest) → **প্ল্যাটফর্ম ডোমেইন প্রত্যাখ্যান** (`qosprey.com` বা যেকোনো `*.qosprey.com` — BadRequest, দুই পথে একই বার্তা) → অন্য org ওই ডোমেইন **বা তার www-রূপ** ধরে থাকলে Conflict।
  - বদল (পুরনো normalized ≠ নতুন) হলেই organization update-এর পাশাপাশি StorefrontSetting থাকলে `domainVerifyToken = null`, `domainVerifiedAt = null` — **inventory-র বাগের মূল সংশোধন**। একই মান আবার সেট করলে রিসেট হয় না।
  - Audit: `storefront.custom_domain_set` / `storefront.custom_domain_removed`, metadata `{domain, previousDomain, verificationReset}`। ফেরত একই তিন ফিল্ড।
- **Branding পথেও একই নিয়ম** (`7bc3e0d`): `updateBranding`-এ customDomain উপস্থিত থাকলে বর্তমান org পড়ে তুলনা, বদল হলে একই রিসেট; প্ল্যাটফর্ম প্রত্যাখ্যানও প্রযোজ্য। Defensive: `storefrontSetting` টেবিল না থাকা fake-এও ভাঙে না (`?.` + failure isolation; m59 spec অক্ষত)। **সচেতন অসাম্য (নথিভুক্ত):** branding পথে conflict যাচাই আগের হুবহু exact-match-ই আছে — www-variant conflict শুধু নতুন setCustomDomain পথে (brief এখানে শুধু reset + platform-refusal চেয়েছিল; branding পথ এখন UI থেকে অব্যবহৃত — নিচে দেখুন)।
- **www ↔ apex মিল (একটাই নিয়ম, দুই ভোক্তা):** ভেতরে `resolveVerifiedDomain()` helper বের করা হয়েছে; `byDomain` এখন candidates (`customDomain IN [...]`) দিয়ে খোঁজে, ফেরতের `domain` = সংরক্ষিত মান। CORS-এর `prismaVerifiedCustomDomainLookup`-ও একই shared variants দিয়ে খোঁজে — TB3-র হুবহু-মিল সীমা এখানে শেষ। Spec প্রমাণ: সংরক্ষিত apex → www resolve ও CORS-allow; সংরক্ষিত www → apex resolve ও CORS-allow; অবেরিফাইড কোনো রূপই নয়। Middleware অপরিবর্তিত (সে শুধু API-কেই ডাকে — আচরণ API স্তরেই বদলেছে)।
- **Spec:** নতুন `storefront/td9-domain.spec.ts` (setCustomDomain পূর্ণ সারণি — www conflict দুই দিকেই, নিজের ডোমেইন রাখা যায়, platform প্রত্যাখ্যান ×৩, format ×৪, রিসেট/অ-রিসেট/সরালে রিসেট, audit, NotFound; byDomain চার রূপ; domainAllowed) ও `organizations/td9-branding-domain.spec.ts` (বদলে রিসেট, সরালে রিসেট, অবদলে নয়, ফিল্ড না পাঠালে ছোঁয়া হয় না, platform প্রত্যাখ্যান, টেবিল-ছাড়া prisma-তেও সফল)।

### Web (২ commit: `1b6d2ed`, `908fbae`; SSL সারির হালনাগাদ `b9a7dc4`)
- Storefront settings-এর পুরনো "কাস্টম ডোমেইন" section বদলে **একটাই "নিজের ডোমেইন" বিভাগ, ৫ ধাপ** (TD8 ঠিকানা কার্ডের নিচে, একই পর্দায়):
  ১. **লেখা ও সেভ** — input (বর্তমান ডোমেইন prefill) → `POST domain/set`; সফলতায় reload; `verificationReset` হলে স্পষ্ট notice ("আগের যাচাই বাতিল হয়েছে — আবার TXT যাচাই করুন") + tokenOut/routing স্থানীয় state পরিষ্কার; সার্ভারের error verbatim।
  ২. **TXT যাচাই** — বিদ্যমান টোকেন তৈরি/যাচাই বোতাম + host ও value **কপি বোতামসহ** হুবহু; ডোমেইন না থাকলে ব্যাখ্যাসহ নিষ্ক্রিয়।
  ৩. **Routing নির্দেশনা** — মান বানানো হয়নি: subdomain-ধাঁচের ডোমেইনে `CNAME → app.qosprey.com` (Host ঘরের registrar-ভেদ টীকাসহ); apex-এ (ক) ALIAS/ANAME/CNAME flattening → `app.qosprey.com`, (খ) না থাকলে A রেকর্ড — মানের জায়গায় হুবহু লেখা **"সার্ভারের IP (Dokploy প্যানেলে app ডোমেইনের A রেকর্ডের মান)"**, কোনো সংখ্যা নয়; www রূপের CNAME → apex, টীকাসহ যে যাচাই করা ডোমেইন ও তার www রূপ দুটোতেই দোকান খুলবে (API-র নতুন মিলের সাথে সঙ্গতিপূর্ণ)। সব নির্দেশের মানেই কপি বোতাম।
  ৪. **অবস্থা তালিকা (৪ সারি)** — টোকেন দেওয়া হয়েছে (`setting.hasDomainVerifyToken` থেকে), যাচাই হয়েছে (আসল `verifiedAt`), routing ঠিক আছে (বিদ্যমান **আসল** `checkDomainRouting` diagnostic + Check now বোতাম; পরীক্ষা না হলে "এখনো পরীক্ষা করা হয়নি"), SSL (নিচে TD10 অংশ দেখুন)। প্রতিটা সারিতে ✓/… ।
  ৫. **বদলানো/সরানো** — ব্যাখ্যা (বদলালে যাচাই রিসেট; সরালে সাবডোমেইন ঠিকানাই থাকে, আসল slug দিয়ে দেখানো) + confirm-সহ "ডোমেইন সরিয়ে ফেলুন" (`domain/set {domain: null}`)। দ্বিতীয় input নেই — বদলানো ধাপ ১ দিয়েই।
- **একমাত্র লেখার জায়গা (brief পয়েন্ট ৪-এর সিদ্ধান্ত):** `/dashboard/settings`-এর BrandingCard থেকে customDomain input **তুলে দেওয়া হয়েছে**; জায়গায় read-only সারি (বর্তমান ডোমেইন বা "সেট করা নেই") + storefront ডোমেইন বিভাগের লিংক। Save payload এখন শুধু `{brandName, primaryColor}`। অর্থাৎ UI থেকে ডোমেইন লেখার জায়গা এখন **একটাই** (storefront বিভাগ → setCustomDomain পথ)। সার্ভিস স্তরেও একটাই যাচাই-নিয়মের সেট বাধ্যতামূলক রাখা হয়েছে: পুরনো branding endpoint API হিসেবে থাকলেও সেখানে এখন একই platform-প্রত্যাখ্যান + একই রিসেট নিয়ম চলে (ওপরের API অংশ) — কোন পথেই যাচাই ফাঁকি দিয়ে বহন করা যায় না।

## TD10 — Spike, রায় ও অ্যাপ-পার্শ্ব অংশ

- **Spike নথি** (`737d713`): `docs/td-tb4-ssl-spike.md` — তিন পথই অফিসিয়াল সূত্র (URL) দিয়ে যাচাই করা। মূল আবিষ্কারগুলো:
  - **Traefik-এ Caddy-ধাঁচের on-demand/`ask` ব্যবস্থা নেই** — ACME resolver শুধু router-এ থাকা নামের জন্যই সার্টিফিকেট চায়; অচেনা SNI-তে default সার্টিফিকেট দেখায়, ইস্যুর চেষ্টাই হয় না। Traefik পথ মানেই verified-হওয়ার মুহূর্তে dynamic-config router তৈরি করে দেওয়া (config-driven ACME) — acme.json/rate-limit (যৌথ 300 order/৩ ঘণ্টা)/config-sync-এর পুরো ops বোঝাসহ, আর HTTP-01 Cloudflare পেরিয়ে পৌঁছায় কিনা অপ্রমাণিত।
  - **Cloudflare for SaaS-ই এই কাজের তৈরি ব্যবস্থা:** প্রথম 100 hostname অন্তর্ভুক্ত, তারপর Plans পেজ অনুযায়ী $0.10/নাম/মাস; API দিয়ে EC8 যাচাইয়ের সাথে জোড়া যায়; edge সার্টিফিকেটের ইস্যু/নবায়ন পুরোপুরি Cloudflare-এর। সীমা: apex proxying শুধু Enterprise add-on (v1-এ flattening/www পথ), আর **origin leg-এর খোলা প্রশ্ন** — default-এ Cloudflare origin-এর দিকে SNI হিসেবে custom hostname-টাই পাঠায় বলে Full (Strict) রেখে চলবে কিনা ডক দিয়ে প্রমাণ করা যায়নি; স্পেয়ার ডোমেইনের লাইভ টেস্ট-ম্যাট্রিক্স spike-এ দেওয়া আছে।
  - **Dokploy হাতে যোগ** স্কেল না করার কারণসহ বাতিল (প্রতি ডোমেইনে প্যানেল-হাত + redeploy চক্র + registry অসামঞ্জস্য) — শুধু জরুরি সাময়িক বিকল্প।
- **রায়: Cloudflare for SaaS (শর্তসাপেক্ষে)** — শর্ত হলো রানবুকের origin-leg লাইভ টেস্টের যেকোনো এক বিন্যাস Full (Strict) রেখে চলা; না চললে Traefik config-driven ACME origin-মুখী পরিপূরক হিসেবে জুড়তে হতে পারে (spike §৩.৪/§৬)।
- **রানবুক** (`b9a7dc4`): `docs/td-tb4-ssl-runbook.md` — [মালিক] ধাপ: SaaS enable + fallback origin মনোনয়ন + CNAME target, API token (এখনই জরুরি নয় — নিচে দেখুন), তারপর origin-leg টেস্ট-ম্যাট্রিক্স (৩ বিন্যাস) ও apex পরীক্ষা; [Muse যাচাই] probes; rollback। **কোনো ধাপই চালানো হয়নি।**
- **অ্যাপ-পার্শ্ব বাস্তবায়ন — ask endpoint** (`80e1f95`): `GET /public/shop/domain-allowed?domain=` (@Public, `:orgSlug`-এর আগে ঘোষিত) — শুধু VERIFIED ডোমেইনে (www রূপসহ, একই shared resolve) 200 `{allowed: true}`, বাকি সবতে Logger.warn + 404। **সৎ অবস্থান:** spike প্রমাণ করেছে Traefik এই endpoint ডাকেই না, আর বেছে নেওয়া Cloudflare পথেরও এটা লাগে না — endpointটা রাখা হয়েছে (ক) ভবিষ্যৎ যেকোনো on-demand/config-sync অনুমোদন-যাচাইয়ের তৈরি seam হিসেবে, (খ) verified-ডোমেইনের হালকা probe হিসেবে। এটা কোনো নতুন তথ্য ফাঁস করে না: একই শর্তে byDomain ইতিমধ্যেই slug ফেরত দেয়। কোনো লাইভ পথে এটি **ব্যবহৃত হচ্ছে না** বলে acceptance-এ স্পষ্ট লেখা থাকল।
- **Cloudflare API integration বানানো হয়নি — সচেতনভাবে:** custom hostname তৈরি/status/delete-এর অ্যাপ-integration-এর পূর্বশর্ত মালিকের প্যানেল ধাপ (SaaS enable + zone-সীমিত API token, যা verify-before-save ধাঁচে মালিক নিজে বসাবেন — অ্যাপে সেই সেটিংসের জায়গাই এখন নেই)। রানবুকের ধাপ ১–৩ শেষ হওয়ার আগে integration বানালে তা অনুমানের ওপর দাঁড়াত। ফলে এই batch-এ TD10-র অ্যাপ-পার্শ্ব = ask endpoint + UI-র সৎ অবস্থা + রানবুক; integration টেস্ট-পরবর্তী follow-up।
- **TD9 অবস্থা তালিকার SSL সারি** (brief পয়েন্ট ৭ অনুযায়ী রায়ের ভাষায়, `b9a7dc4`): "স্বয়ংক্রিয় SSL-এর পথ বেছে নেওয়া হয়েছে: Cloudflare for SaaS (TD10 spike রায়) — তবে প্ল্যাটফর্ম-মালিকের প্যানেল ধাপ (SaaS enable + লাইভ টেস্ট) বাকি থাকায় এই মুহূর্তে HTTPS নিশ্চিত নয়; routing ঠিক থাকলেও ব্রাউজারে সার্টিফিকেট সতর্কতা দেখাতে পারে"। ভুয়া ✓ নেই।

## গেট (সব serially, coordinator চালিয়েছে)

| গেট | ফলাফল |
|---|---|
| API scoped spec (worker-চালিত) | 6 suites, **111/111** — custom-domain 39 + cors-origins + td9-domain + ec8 + td9-branding-domain + m59 |
| API suites `storefront + organizations + common` | **37 suites, 372/372 পাস** (TB3-র 34/305 থেকে +3 suite: custom-domain, td9-domain, td9-branding-domain; +67 tests) |
| API tsc (`--noEmit`) | পরিষ্কার (exit 0) |
| API build | সবুজ (exit 0); compiled `dist/storefront/storefront.controller.js`-এ domain-allowed/set wiring grep-প্রমাণিত (controller ×5, service setCustomDomain ×1) |
| Web vitest পুরো | **57 ফাইল, 479/479 পাস** (TB3-র সমান — এই batch-এ নতুন web spec নেই; পেজ-স্তরের বদল tsc/build দিয়ে ধরা) |
| Web tsc (`--noEmit`) | পরিষ্কার (exit 0) |
| Web build (`next build`) | সবুজ (exit 0), `ƒ Middleware` 50.6 kB সহ (অপরিবর্তিত — middleware এই batch-এ ছোঁয়া হয়নি) |

## NOT BUILT (সচেতনভাবে বানানো হয়নি)

- **লাইভ SSL-এর কোনো প্রমাণ** — Cloudflare for SaaS enable, fallback origin, API token, origin-leg টেস্ট: সবই রানবুকের মালিক-ধাপ, একটাও চালানো হয়নি। নতুন verified ডোমেইন হাত ছাড়া HTTPS-এ চলার **সাফল্যের মাপকাঠি TD12-তেই প্রমাণ হবে**, এই acceptance-এ তার কোনো দাবি নেই।
- **সার্ভার/Traefik config-এর কোনো পরিবর্তন** — রায়ের পথে সার্ভারে বদল প্রায় লাগেই না (fallback origin Cloudflare প্যানেলে); Traefik config-driven বিকল্পের কোনো config লেখা হয়নি।
- **Cloudflare API integration** (verified হলে স্বয়ংক্রিয় custom hostname create/status/delete) — ওপরে TD10 অংশে কারণসহ: মালিকের enable+token ধাপের পরের follow-up।
- **TD9 UI routing নির্দেশনার CfS-মুখী হালনাগাদ** (CNAME target বদলে SaaS target; apex-এর A-রেকর্ড পরামর্শ তোলা; delegated-DCV ধাপ যোগ) — রানবুক ধাপ ৪-এ বিস্তারিত তালিকাসহ রাখা; CfS টেস্ট পাসের **আগে** বদলালে বর্তমান চালু (manual) পথের নির্দেশ ভাঙত বলে এই batch-এ সচেতনভাবে করা হয়নি। ফলে টেস্টের আগে পর্যন্ত UI নির্দেশনা বর্তমান জগতেরই — এই টানাপোড়েন লুকানো হয়নি।
- **Ask endpoint-এর কোনো ভোক্তা** — ওপরে সৎ অবস্থান দ্রষ্টব্য; endpoint আছে, কেউ ডাকে না (এখনো)।
- **Branding পথে www-variant conflict** — API endpoint হিসেবে branding থাকলেও সেখানে conflict যাচাই exact-match-ই (সচেতন অসাম্য, ওপরে নথিভুক্ত); UI পথ একটাই বলে ব্যবহারকারীর জন্য ফাঁক নেই।
- **TB5-এর সবকিছু:** TD11 (slug tombstone), TD12 (লাইভ যাচাই)। Push হয়নি; deploy মালিকের নির্দেশে।

## সৎ সীমানা

- এই batch-এর সব কোড-প্রমাণ spec/build স্তরের; ডোমেইন-সংক্রান্ত কোনো লাইভ আচরণ (আসল DNS, আসল Cloudflare, আসল সার্টিফিকেট) যাচাই হয়নি।
- Spike-এর খরচের সংখ্যা ($0.10/নাম/মাস, 100 অন্তর্ভুক্ত) Cloudflare-এর Plans পেজ থেকে নেওয়া (spike-এ সূত্রসহ); enable পর্দায় ভিন্ন কিছু দেখালে মালিকের প্যানেল-দেখা মানই চূড়ান্ত — রানবুক ধাপ ০-তে সেই যাচাই রাখা আছে।
- ডোমেইন সরালে Cloudflare custom hostname (ভবিষ্যতে তৈরি হলে) মোছা আপাতত মালিকের হাতে dashboard থেকে — রানবুক ধাপ ৫-এ টীকা আছে; অ্যাপ-integration এলে তবেই স্বয়ংক্রিয় হবে।
