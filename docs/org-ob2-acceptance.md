# Organization Next — Batch OB2 Acceptance (ORG5 + ORG6 + ORG7 + ORG8)

তারিখ: 2026-10-16 · Worktree: `~/workspace/ai-marketing-saas-org`, branch `org-next`, base `b8ca6c7c` (OB1 complete, tree clean)।
সূত্র পরিকল্পনা: `Organization-Next-Plan-2026-10-16.md` গুচ্ছ B (পরিচিতি ও সেটিংস সম্পূর্ণতা)।
Local commits only — **কোনো push হয়নি**। এই ব্যাচে migration প্রত্যাশিত নয়।

## Inventory — এই batch শুরুর আগে পড়ে যাচাই করা

### Create পথে name/currency/timezone/country
- `POST /organizations` → `OrganizationsService.create()` (service:48)। `CreateOrganizationDto`: `name` (2–120), `slug` (TD1 regex), `country?` (`@Length(2,2)`), `timezone?` (**মুক্ত স্ট্রিং — আকার যাচাই নেই**), `currency?` (`@Length(3,3)`)। Service default: country `BD`, timezone `Asia/Dhaka`, currency `BDT` (schema default-ও তাই)। Create-এ IANA/currency আকারের কঠোর যাচাই নেই — OB2-র কঠোর যাচাই নতুন PATCH-এই থাকছে; create পথ এই batch-এ ছোঁয়া হয়নি (scope-এর বাইরে, নিচে NOT BUILT দ্রষ্টব্য)।
- `GET /organizations/:id` পুরো org row ফেরত দেয় — name/currency/timezone/country/slug সবই আছে; identity ফর্মের পড়ার উৎস এটাই।

### বিদ্যমান PATCH-গুলোর আকৃতি
- `PATCH :id/business-profile` — `UpdateBusinessProfileDto`: description/industry/যোগাযোগ/ডেলিভারি/AI আচরণ/tradeLicense/billing — **name/currency/timezone/country নেই** (শুধু `aiReplyLanguage` আছে, যেটা org language default নয়)।
- `PATCH :id/branding` — `UpdateBrandingDto`: brandName/primaryColor/`customDomain` — সবই **Organization** row-র ফিল্ড (M59)।
- Controller ধাঁচ: `@UseGuards(TenantGuard, RolesGuard)` + `@Roles("OWNER","ADMIN")`; service-এ `memberOrThrow` + `this.audit.log({ organizationId, userId, action, entityType: "Organization", entityId, metadata, ipAddress })`।
- Timezone যাচাইয়ের বিদ্যমান helper: `isValidTimezone` (`apps/api/src/inbox/working-hours.ts`) — `Intl.DateTimeFormat` দিয়ে IANA যাচাই করে; ORG5 দ্বিতীয় কপি না বানিয়ে সেটাই ব্যবহার করবে (organizations.service ইতিমধ্যে import করে)।

### Usage endpoint-গুলোর আসল ফেরত
- `GET :id/billing` (OWNER/ADMIN): `{ subscription {plan, status, currentPeriodEnd, …}, limits {aiDaily, broadcastCap, seats (null = অসীম), plan}, usage {seatsUsed (শুধু ACTIVE সদস্য), aiCallsToday, broadcasts30d}, resourceUsage {products {used, limit}, ordersThisMonth {used, limit}, storage {usedBytes, assetCount, limitMb}, apiToday {used, limit}}, plans[], creditMinor, nextInvoice, gateways }`।
- `GET :id/members/usage` (TenantGuard — যেকোনো সদস্য): `seatUsage` → `{ limit, activeMembers, suspendedMembers, pendingInvites, available }` — **pending invitation seat ধরে রাখে** (available = limit − active − pending)।
- `GET :id/storage-usage` (যেকোনো সদস্য): `{ storageBytes (string), assetCount, meteredFrom }` — MediaAsset registry-ভিত্তিক recorded usage।
- সতর্কতা: billing-র `broadcastCap` হলো **প্রতি broadcast পাঠানোর প্রাপক-সীমা**, 30-দিনের কোটা নয় — ORG6 পেজে লেবেল সেভাবেই লিখতে হবে।

### Switcher (ORG8-এর ভিত্তি)
- `apps/web/src/app/dashboard/OrgSwitcher.tsx` + `lib/org-switcher.ts` (খাঁটি helper: resolveCurrentOrgId/isSwitchNeeded/roleLabel/switcherMode + ORG3/ORG4 state helper) + `lib/org-switcher.test.ts` (14টা test — OU1 describe + OB1 describe)।
- বর্তমানে search/pin/recent **নেই** — তালিকা listMine ক্রমেই (পুরনো আগে) দেখায়। User-পরিচয় web-এ: `localStorage.accessToken` (JWT, payload-এ `sub` = user id — auth.service signAsync থেকে যাচাই করা)। Pin/recent সংরক্ষণের key এই `sub` দিয়েই হবে।

### ORG7 — `BusinessProfile.customDomain` অনুসন্ধান (grep প্রমাণ)
- Schema-তে দুটো ফিল্ড: `Organization.customDomain` (schema:111, M59 — **সক্রিয় পথ**) ও `BusinessProfile.customDomain` (schema:425, "SaaS Multi-Tenant Merchant Growth Settings" অংশে metaPixelId-র পাশে)।
- Repo-জুড়ে (API src + web src + scripts + packages, spec বাদেও) প্রতিটি `customDomain` ব্যবহার Organization-র ফিল্ডের দিকে যায়: `UpdateBrandingDto.customDomain` → `updateBranding` organization row আপডেট করে (service:1523–1557, uniqueness যাচাইও `prisma.organization`-এ); storefront (`storefront.service`), CORS lookup (`common/cors-origins.ts` — `organization.findFirst`), web-এর storefront/settings পেজ — সবই org-স্তরের মান পড়ে।
- `businessProfile` create/update/upsert-এর কোনো লেখায় `customDomain` **নেই**; `UpdateBusinessProfileDto`-তে ফিল্ডটা **নেই**; কোনো select/include-এ BP-র customDomain পড়া হয় **না**; seed/fixture/script-এও কোনো ব্যবহার পাওয়া যায়নি (grep শূন্য)।
- সিদ্ধান্ত: ফিল্ডটা কার্যত মৃত — ORG7-তে schema-তে deprecation মন্তব্য বসবে, কলাম মোছা হবে না (আসল DB-তে ডেটা আছে কিনা sandbox থেকে জানা যায় না — শর্ত acceptance-এ লেখা থাকবে)।

## কমিট তালিকা (base `b8ca6c7c`-এর ওপরে ৬টা)

| Commit | বিষয় |
|---|---|
| `9bbddd96` | Acceptance skeleton + inventory |
| `dc252722` | ORG5 API — `PATCH /organizations/:id/identity` + spec |
| `07d534d2` | ORG5 web — settings hub-এ "Organization তথ্য" কার্ড |
| `47a710d6` | ORG6 web — standalone "ব্যবহার ও সীমা" পেজ + billing cross-link |
| `05585c47` | ORG7 — schema-তে `BusinessProfile.customDomain` deprecation মন্তব্য |
| `0ba59070` | ORG8 web — switcher search/pin/recent + lib helper ও test |
| (এই নথি) | OB2 acceptance |

## যা বানানো হলো — আইটেম ধরে

### ORG5 — Org পরিচিতি ও আঞ্চলিক default সম্পাদনা
- **Endpoint:** `PATCH /organizations/:id/identity` (TenantGuard + RolesGuard, `@Roles("OWNER","ADMIN")`, `@PermissionArea("settings")` — branding PATCH-এর হুবহু ধাঁচ)। DTO `UpdateOrgIdentityDto` — সব ফিল্ড optional (আংশিক update)।
- **Service `updateIdentity`:** actor-এর membership যাচাই + service-স্তরেও OWNER/ADMIN পরীক্ষা (controller guard-এর ওপর দ্বিতীয় স্তর)। যাচাই: name trim-এর পর অ-খালি; currency — trim + বড় হাতের normalize করে `/^[A-Z]{3}$/` (অর্থাৎ `bdt` গৃহীত হয়ে `BDT` জমা হয়, `B1T`/`EU`/`USDD` প্রত্যাখ্যান — পণ্যের কণ্ঠে বাংলা ভুল-বার্তা); timezone — বিদ্যমান `isValidTimezone` (Intl-ভিত্তিক IANA যাচাই, দ্বিতীয় কপি বানানো হয়নি); country — একই normalize-তে `/^[A-Z]{2}$/`। কোনো ফিল্ডই না পাঠালে 400।
- **Semantics:** বদল শুধু Organization row-তে — spec দিয়ে প্রমাণিত যে subscription row-তে হাত পড়ে না (currency বদল = শুধু নতুন default; ঐতিহাসিক রেকর্ড অপরিবর্তিত)। সব মান বর্তমানের সমান হলে **কোনো write ও কোনো audit হয় না** (`unchanged: true` ফেরত)।
- **Audit:** `org.identity_updated`, metadata `{ fields: [...] }` — **শুধু ফিল্ডের নাম**, পুরনো/নতুন কোনো মানই নয় (spec-এ metadata-র JSON-এ পুরনো মানের অনুপস্থিতি assert করা)।
- **Web:** settings hub-এ নতুন কার্ড **"Organization তথ্য"** (HUB_NAV-এও যুক্ত) — name/currency/timezone/country ফর্ম; currency তালিকা সাধারণ মুদ্রা + বর্তমান মান সবসময়; timezone তালিকা `Intl.supportedValuesOf("timeZone")` থেকে (না থাকলে ছোট fallback তালিকা + বর্তমান মান); slug **শুধু পড়ার** ঘরে `{slug}.qosprey.com` ব্যাখ্যাসহ (TD সিদ্ধান্ত — বদলানোর কোনো affordance নেই); currency-বদলের সতর্কতা কার্ডের ভেতরে amber বাক্সে লেখা। কার্ড শুধু OWNER/ADMIN দেখে।
- **Spec:** `org-ob2-identity.spec.ts` **10/10** — আংশিক update, বহু-ফিল্ড update + trim, case-normalize, খারাপ currency/timezone/country/name প্রত্যাখ্যান (write/audit ছাড়া), খালি submission, non-admin 403, non-member 404, unchanged-এ no-write/no-audit, subscription অক্ষত।

### ORG6 — Standalone usage পেজ
- **পেজ:** `/dashboard/settings/usage` (build manifest-এ route যাচাই করা) — **নতুন backend শূন্য**; ডেটা তিনটি বিদ্যমান endpoint থেকে: `GET :id/billing` (plan + effective limits + usage + GC22 resourceUsage), `GET :id/members/usage` (seat চিত্র), `GET :id/storage-usage`।
- **Seats:** ব্যবহৃত = সক্রিয় সদস্য + **pending আমন্ত্রণ** (আমন্ত্রণ seat ধরে রাখে — পেজে কথায় ব্যাখ্যা করা: মেয়াদ শেষ/প্রত্যাহার হলে সিট ফেরে; স্থগিত সদস্য seat নেয় না; খালি seat সংখ্যাও দেখায়)।
- **বাকি মিটার:** আজকের AI (দৈনিক সীমা), API কল আজ, পণ্য, এই মাসের অর্ডার, স্টোরেজ (bytes → পাঠযোগ্য আকার + ফাইল সংখ্যা + MB সীমা)। **Broadcast:** ৩০-দিনের সংখ্যা শুধু count হিসেবে — per-send cap-কে মাসিক কোটা সাজানো হয়নি (billing পেজের একই সৎ লেবেল)।
- **Degrade:** billing payload OWNER/ADMIN-only — অন্য ভূমিকার ব্যবহারকারী পেজ খুললে amber নোটসহ সদস্য-স্তরের সংখ্যা (seat/storage) দেখায়, কোনো সীমা বানিয়ে দেখায় না।
- **Cross-link:** billing পেজের "ব্যবহার ও সীমা" অংশ থেকে এই পেজে লিংক; এই পেজ থেকে billing ও settings দুই দিকেই লিংক।

### ORG7 — `BusinessProfile.customDomain` অবসর
- Inventory-র grep প্রমাণের ভিত্তিতে (ওপরে) schema-তে ফিল্ডের ওপরে **deprecation মন্তব্য**: কোনটা সক্রিয় পথ (`Organization.customDomain`), কেন এটা মৃত, আর ভবিষ্যতে কলাম ফেলার **শর্ত** — আসল DB-তে `customDomain IS NOT NULL` row-সংখ্যা 0 যাচাই না করে কোনো drop migration নয়। ফিল্ড/কলাম অপরিবর্তিত, **migration নেই**, `prisma validate` সবুজ। কোনো কোড পথ এই ফিল্ড পড়ে/লেখে না — audit-এর পর নতুন করেও কিছু যোগ হয়নি।

### ORG8 — Switcher পরিপূর্ণতা
- **Lib (`lib/org-switcher.ts`):** খাঁটি ফাংশন — `orderSwitcherOrgs` (pin ক্রম → recent ক্রম → আগের listMine ক্রম; stale id উপেক্ষা, duplicate অসম্ভব), `filterSwitcherOrgs` (name+slug, case-insensitive substring; খালি query = অপরিবর্তিত), `touchRecentOrg` (সামনে আনা + dedupe + cap 10), `togglePinnedOrg`/`isPinnedOrg`, `parseOrgListPrefs` (সহনশীল — নষ্ট blob → খালি prefs), `orgSwitcherPrefsKey` (user id দিয়ে keyed), `userIdFromAccessToken` (JWT `sub` — শুধু preference key-র namespace হিসেবে, auth-এর জন্য নয়, কোডে সতর্কতা লেখা)।
- **Component:** তালিকা **৫-এর বেশি হলে search ঘর**; **১-এর বেশি org থাকলে** প্রতি সারিতে pin বোতাম (pin করা ওপরে; সারির ভেতরে nested-button এড়াতে pin আলাদা absolute বোতাম); recent — dashboard খোলার মুহূর্তে বর্তমান org recent-এর সামনে বসে (seed), switch-এর সময় target সামনে যায় ও reload-এর আগেই persist হয়; menu খুললেই search query reset।
- **সংরক্ষণ v1: localStorage-ই** — key `orgSwitcherPrefs:<userId>` (একই ব্রাউজারে অন্য user-এর pin দেখা যাবে না; token পড়া না গেলে `anon` fallback)। **সীমা: pin/recent ডিভাইস-ভিত্তিক** — অন্য ডিভাইস/ব্রাউজারে পাওয়া যাবে না; সার্ভার-ভিত্তিক preference ভবিষ্যতের কাজ (নিচে NOT BUILT)।
- **Test:** `org-switcher.test.ts` **16/16** — আগের 9টা (OU1 + ORG3/ORG4) অক্ষত + নতুন 7টা (ক্রম, search, recent cap/dedupe, pin toggle, key, parse সহনশীলতা, JWT sub)।

## গেট (সব serially চালানো, আসল সংখ্যা)

| গেট | ফলাফল |
|---|---|
| API suites — organizations (jest --runInBand) | **14 suites, 127/127 pass** — নতুন `org-ob2-identity.spec.ts` 10/10-সহ; OB1 lifecycle spec-ও সবুজ |
| API `tsc --noEmit` | পরিষ্কার |
| API build (`tsc -p tsconfig.build.json`) | সবুজ — `dist`-এ `updateIdentity` service+controller দুই জায়গায় grep-প্রমাণিত |
| Web vitest (পুরো) | **110 ফাইল, 911/911 pass** (OB1-এর 904 + ORG8-এর নতুন 7) |
| Web `tsc --noEmit` | পরিষ্কার |
| Web `next build` | সবুজ (exit 0) — build manifest-এ `/dashboard/settings/usage/page` route উপস্থিত |
| `prisma validate` | সবুজ ("The schema … is valid") — প্রথম চেষ্টায় শুধু shell-এ DATABASE_URL না থাকায় থেমেছিল, dummy env দিয়ে পুনঃচালনায় পাস; schema-জনিত কোনো ত্রুটি নয় |

Migration: এই batch-এ **নেই** — claim range (`20261021000000+`) ছোঁয়া হয়নি।

## NOT BUILT (স্পষ্ট)

- **Create পথের যাচাই কঠোর করা হয়নি** — `POST /organizations`-এ timezone এখনো মুক্ত স্ট্রিং ও currency শুধু দৈর্ঘ্য-যাচাইয়ে পাস হয়; কঠোর যাচাই আপাতত শুধু ORG5-র PATCH-এ। Create-এ একই নিয়ম বসানো ছোট follow-up হতে পারে, এই batch-এর scope-এ ছিল না।
- **ORG6-তে সময়-ধারার (history/trend) গ্রাফ নেই** — কোনো বিদ্যমান endpoint ঐতিহাসিক usage series দেয় না; নতুন backend বানানো এই batch-এর শর্ত ছিল না। পেজ বর্তমান counters-ই দেখায়।
- **ORG7-র কলাম drop করা হয়নি** — সচেতনভাবে: আসল DB-তে ডেটা আছে কিনা sandbox থেকে জানা যায় না; শর্ত schema মন্তব্য ও এই নথিতে লিপিবদ্ধ (production count যাচাইয়ের পর আলাদা migration)।
- **সার্ভার-ভিত্তিক switcher preference নেই** — pin/recent অন্য ডিভাইসে sync হয় না (v1 localStorage-ই, ওপরে সীমা লেখা)।
- **Org-স্তরের language default বানানো হয়নি** — প্ল্যানে ORG5-র পাশে ঐচ্ছিক ছিল; `BusinessProfile.aiReplyLanguage` আগের মতোই শুধু AI উত্তরের ভাষা। Org-জুড়ে ভাষা default চাইলে আলাদা সিদ্ধান্ত লাগবে (কোন কোন surface তা মানবে তা নির্ধারণসহ)।
- **লাইভ প্রমাণ: সবই বাকি** — identity PATCH, usage পেজ, switcher pin/search কোনোটাই আসল org/ব্যবহারকারী দিয়ে চালিয়ে দেখা হয়নি; deploy-এর পর M30 ধাঁচের লাইভ যাচাই বাকি থাকবে।
