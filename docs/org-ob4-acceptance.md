# Organization Next — Batch OB4 Acceptance (ORG11 + ORG12 + ORG13)

তারিখ: 2026-10-17 · Worktree: `~/workspace/ai-marketing-saas-org`, branch `org-next`, base `228bd00a` (OB1–OB3 complete, tree clean)।
সূত্র পরিকল্পনা: `Organization-Next-Plan-2026-10-16.md` গুচ্ছ D (শাসন ও নিরাপত্তা)।
Local commits only — **কোনো push হয়নি**।
Migration claim (ledger যাচাই করে): এই tree-তে সর্বশেষ `20261023000000_org_join_request`; **`20261024000000_org_security_policy`** (ORG11) ও **`20261025000000_org_tags`** (ORG13) দুটোই ফাঁকা ছিল — এই ব্যাচে নেওয়া হলো।

## Inventory — এই batch শুরুর আগে পড়ে যাচাই করা

### MFA/TOTP-র অবস্থা ও লগইন প্রবাহ
- অবস্থা থাকে `User` মডেলে: `totpEnabled Boolean @default(false)` + `totpSecretEncrypted String?` (schema ~63–64)।
- লগইন: password ঠিক হলে `totpEnabled` থাকলে TOTP challenge (`POST /auth/totp/verify` — challengeToken + code) পেরিয়ে তবেই session ইস্যু হয়; MFA না থাকলে সরাসরি session। অর্থাৎ "MFA চালু আছে কিনা" প্রতি user-এর একটাই সত্য — org-ভিত্তিক আলাদা MFA নেই, ORG11-র নীতি শুধু **ওই org-এ ঢুকতে ওই সত্যটা দাবি করে**।
- Setup endpoint: `GET /auth/totp/status`, `POST /auth/totp/enroll|confirm|disable` — সব JWT-নির্ভর, **org-scoped নয়**; TenantGuard organizationId না পেলে শুরুতেই ছেড়ে দেয়, তাই org-ব্লকের মধ্যেও MFA setup সবসময় পৌঁছানো যায় (permanent lockout অসম্ভব হওয়ার এক নম্বর কারণ)। Web UI: dashboard Settings-এর `hub-security` অংশ।

### Session মডেল (GB6) — sessionMaxAgeHours-এর ভিত্তি
- `UserSession` টেবিল: login/token-ইস্যুর সময় একটা row, `createdAt`, `lastSeenAt`, `revokedAt`; JWT-তে `sid` claim; `JwtAuthGuard` revoked বা মুছে-যাওয়া session প্রত্যাখ্যান করে এবং `req.user.sid` রাখে।
- **TenantGuard প্রতি অনুরোধে session দেখে না** (শুধু view-as session দেখে)। Session বয়স মাপার একমাত্র নির্ভরযোগ্য উৎস `UserSession.createdAt`।
- Legacy টোকেন (GB6-এর আগের, `sid` ছাড়া) এখনো বৈধ — সেগুলোর বয়স মাপার কোনো উপায় নেই।

### Platform settings পথ (M33) — ORG12-র ভিত্তি
- সংরক্ষণ: `SystemSetting` (key @id, value Json)। পাঠ: `platformSetting(prisma, key)` (`common/platform-settings.ts` — defensive, ত্রুটিতে null = "সেটিং নেই")। slug governance-এর `reservedSlugsExtra` এই পথেই পড়া হয়।
- লেখা: শুধু `AdminService.updateSettings` — `SETTING_KEYS` whitelist + key-ভেদে validation; route `PATCH /admin/settings` (SUPER tier)। পাঠ: `GET /admin/settings` → `getSettings()`।
- **Admin UI ফর্ম আছে**: `apps/admin/src/app/settings/page.tsx` Config Hub — "সাধারণ" (general) বিভাগে প্ল্যাটফর্ম অবস্থার কার্ড; নতুন ঘর সেখানেই যোগ হবে।

### Admin org পৃষ্ঠার গঠন (ORG13-র জায়গা)
- তালিকা `apps/admin/src/app/orgs/page.tsx`: server-পক্ষে শুধু `q/page/take` (`GET /admin/orgs` → `AdminService.listOrgs` — পুরো org row ফেরত দেয়, তাই `tags` row-তেই চড়ে আসবে); status/plan filter client-side। Tag filter brief অনুযায়ী **server query param** হবে (`?tag=`)।
- বিবরণ `apps/admin/src/app/orgs/[id]/page.tsx`: ট্যাব (সারসংক্ষেপ / Billing ও Limit / কার্যকলাপ / নোট); `orgDetail()` org row spread করে — tags স্বয়ংক্রিয়ভাবে payload-এ। Tag সম্পাদক যাবে সারসংক্ষেপ ট্যাবে।

### Web gate (ORG11-র পর্দার জায়গা)
- `apps/web/src/app/dashboard/layout.tsx`-এর `OrgStateGate`: `listMine` (org-scoped নয়) পড়ে suspended/archived পূর্ণ-পর্দা দেখায়; fail-open। ORG11-র দুটো অবস্থা (MFA লাগবে / session পুরনো) এখানেই যোগ হবে — probe হবে `GET /organizations/:id/security-policy` (TenantGuard-এর allowlist-এ, নিচে দ্রষ্টব্য), তাই ব্লক থাকা অবস্থাতেও gate আসল অবস্থা জানতে পারে।

## নকশা সিদ্ধান্ত (বাস্তবায়নের আগে স্থির)

1. **ORG11 enforcement-এর জায়গা = TenantGuard** (প্রতি org-scoped অনুরোধে)। কারণ: নীতি org-ভিত্তিক — একই user এক org-এ ব্লক, অন্য org-এ অবাধ; লগইন-সময়ের enforcement এটা প্রকাশই করতে পারে না (session global, org-ভিত্তিক নয়)। Guard-এর বিদ্যমান org-status/archived ব্লকের ধাঁচেই নতুন ব্লক, একই defensive নীতি (lookup ব্যর্থ হলে fail-open — codebase-এর প্রতিষ্ঠিত দর্শন: infra বিভ্রাটে সবাইকে আটকে দেওয়া নয়)।
2. **Session cap-এর পথ = UserSession.createdAt থেকে বয়স** (guard-এ মাপা)। sid-বিহীন legacy টোকেনের বয়স মাপা যায় না বলে cap-চালু org-এ সেগুলো `ORG_SESSION_EXPIRED` দিয়ে প্রত্যাখ্যাত হবে — প্রতিকার সবসময় হাতে আছে (আবার লগইন করলেই নতুন session তৈরি হয়)। Login-time-only enforcement বানানো হয়নি — তা হলে lenient org-এর জন্য তৈরি session নীরবে strict org-এ ঢুকে যেত, অর্থাৎ নীতিটাই মিথ্যা হতো।
3. **Allowlist (MFA ও session-cap দুই ব্লকের জন্যই একই)**: `GET /organizations/:id` (org চেনা), `GET /organizations/:id/security-policy` (gate/settings-এর probe), `POST /organizations/:id/leave` (বেরিয়ে যাওয়ার পথ)। এছাড়া যা যা লাগে (MFA setup, logout/login, listMine) সবই org-scoped নয় — guard সেখানে পৌঁছায়ই না। **PATCH security-policy allowlist-এ নেই** — নইলে পাসওয়ার্ড-চুরি হওয়া OWNER অ্যাকাউন্ট (ঠিক যে হুমকির বিরুদ্ধে এই নীতি) নীতি বন্ধ করে ঢুকে পড়তে পারত; বৈধ OWNER MFA setup (global endpoint) করে ফিরলেই সব খুলে যায়, তাই স্থায়ী lockout নয়।
4. **OWNER self-lockout প্রতিরোধ সক্রিয় করার মুহূর্তে**: `requireMfa` false→true করতে হলে আবেদনকারী OWNER-এর নিজের `totpEnabled` থাকতে হবে — নইলে স্পষ্ট BadRequest ("আগে নিজের MFA চালু করুন")। চালু থাকা নীতি বন্ধ করা বা session cap বদলাতে এই শর্ত নেই।
5. **স্থিতিশীল error code**: GB9 email-verification gate-এর ধাঁচে structured Forbidden — `code: "ORG_MFA_REQUIRED"` / `code: "ORG_SESSION_EXPIRED"`, বাংলা message-সহ। Web gate message না পড়ে code/status-ভিত্তিক probe (security-policy GET-এর `myMfaBlocked`/`mySessionBlocked`) দিয়ে পর্দা ঠিক করে।
6. **ORG12 গণনার নিয়ম**: সীমা শুধু **OWNER হিসেবে থাকা** org গোনে (membership.role = OWNER, যেকোনো status — suspended সদস্যপদও মালিকানা ছাড়ে না); আমন্ত্রিত/অন্য ভূমিকার membership গোনে না। **Archived org-ও গোনে** — org বেঁচে আছে, restore করা যায়, মালিকানা অক্ষত। সীমা মান `SystemSetting "maxOrgsPerUser"`; অনুপস্থিত/অবৈধ মান = সীমাহীন (**কোড কোনো default সংখ্যা ধরে না** — D1 মালিকের সিদ্ধান্ত)। মান বসানো/তোলা: null (তুলে নেওয়া) অথবা পূর্ণসংখ্যা ≥ 1; 0 অবৈধ (সীমাহীনের জন্য null — অস্পষ্টতা এড়াতে)।
7. **ORG13 tags semantics**: পুরো তালিকা পাঠিয়ে বদলানো (replace)। Normalize: trim; খালি বাদ; হুবহু একই tag পুনরাবৃত্তি একবার; case যেমন লেখা হবে তেমনই থাকবে (lowercase চাপানো হবে না)। সীমা: সর্বোচ্চ 20টি tag, প্রতিটি ≤ 40 অক্ষর। শুধু SUPER (`@AdminTier("SUPER")`)। **Tenant পক্ষে tags দেখানো হবে না**: tenant-মুখী প্রধান পাঠ-পথগুলো (listMine, getOne, create, identity update-এর ফেরত) থেকে `tags` ছেঁটে দেওয়া হয় (helper `tenantOrgView`), এবং কোনো tenant UI রেন্ডার করে না — tags শুধু admin API/UI-তেই থাকে।

## কমিট তালিকা

| Commit | বিষয় |
|---|---|
| `13a6092d` | Acceptance skeleton — inventory + নকশা সিদ্ধান্ত |
| `544ae6a4` | ORG11 schema — `requireMfa` + `sessionMaxAgeHours` + migration `20261024000000_org_security_policy` |
| `d39d196d` | ORG11+ORG12 API — security-policy GET/PATCH, TenantGuard enforcement, maxOrgsPerUser setting + create-এ যাচাই |
| `cadfa5a4` | ORG13 schema — `Organization.tags String[]` + migration `20261025000000_org_tags` |
| `ebe6f9f7` | ORG13 API — updateOrgTags + listOrgs tag filter + SUPER PATCH route + tenant read থেকে tags ছাঁটাই |
| `d90e56e2` | Specs — org-ob4-security 15 + tenant.guard ORG11 +9 + org-ob4-admin 10 |
| `8171da46` | ORG11 web — settings নিরাপত্তা-নীতি কার্ড + OrgStateGate mfa/session পর্দা |
| `8ce43eb3` | ORG12/ORG13 admin UI — settings-এ maxOrgsPerUser ঘর; org তালিকায় tag filter + চিপ; org detail-এ tag সম্পাদক |
| (এই doc-এর চূড়ান্ত commit) | Acceptance পূরণ |

Migration ledger যাচাই: OB3-র শেষ `20261023000000` — এই ব্যাচের দাবি `20261024000000` + `20261025000000` দুটোই ফাঁকা ছিল, দুটোই নেওয়া হয়েছে।

## যা বানানো হলো — আইটেম ধরে

### ORG11 — Org নিরাপত্তা নীতি ✅

- **Schema:** `Organization.requireMfa Boolean @default(false)`, `sessionMaxAgeHours Int?` — migration `20261024000000_org_security_policy` (হাতে লেখা, fresh-PG-তে যাচাই)।
- **API:** `GET /organizations/:id/security-policy` (যেকোনো সক্রিয় সদস্য — নীতি + নিজের অবস্থা: `myTotpEnabled`, `mySessionAgeHours`, `myMfaBlocked`, `mySessionBlocked`) ও `PATCH` (OWNER-only — route-এ RolesGuard + service-এ দ্বিতীয় যাচাই; audit `org.security_policy_updated`, বদলানো ফিল্ডের তালিকাসহ; খালি patch = `unchanged`)। Billing/identity payload-এ নীতি গোঁজা হয়নি — আলাদা endpoint-ই একমাত্র পথ।
- **Self-lockout প্রতিরোধ:** `requireMfa` false→true করতে হলে OWNER-এর নিজের `totpEnabled` আগে থাকতেই হবে, নইলে স্পষ্ট BadRequest ("আগে নিজের অ্যাকাউন্টে MFA (2FA) চালু করুন…") এবং org row অপরিবর্তিত থাকে (spec-প্রমাণিত)। বন্ধ করা বা cap বদলানোয় এই শর্ত নেই।
- **Enforcement (TenantGuard, প্রতি অনুরোধে):** নকশা সিদ্ধান্ত ১–৩ অনুযায়ী। MFA-বিহীন সদস্য → স্থিতিশীল code `ORG_MFA_REQUIRED` সহ 403; cap-এর চেয়ে পুরনো session → `ORG_SESSION_EXPIRED` সহ 403 (পুনঃলগইনের বার্তাসহ)। Session-এর বয়স মাপা হয় `UserSession.createdAt` থেকে (সিদ্ধান্ত ২-র যুক্তি: policy org-ভিত্তিক, session global — লগইন-সময়ের enforcement দিয়ে org-ভিত্তিক নিয়ম প্রকাশই করা যায় না; আর sid-বিহীন legacy token-এর বয়স মাপা অসম্ভব বলে cap-ওয়ালা org সেটি প্রত্যাখ্যান করে — অর্ধেক-enforcement ভান করা হয়নি, remedy সবসময় নতুন লগইন)। Allowlist দুই block-এর জন্যই: `GET /organizations/:id`, `GET …/security-policy`, `POST …/leave` — PATCH security-policy ইচ্ছাকৃতভাবে বাইরে (সিদ্ধান্ত ৩)। Lookup ব্যর্থতায় fail-open — বিদ্যমান block-গুলোর (suspension/archived) একই ধাঁচ।
- **Web:** Settings-এ "Organization-এর নিরাপত্তা নীতি" কার্ড (OWNER সম্পাদনা / অন্য সদস্য read-only সারসংক্ষেপ; OWNER-এর নিজের MFA বন্ধ থাকলে সতর্ক নোট; cap ১–৭২০ বা খালি)। `OrgStateGate`-এ দুটি নতুন পর্দা — MFA-block (2FA setup-এর `#hub-my-security` anchor-সহ বোতাম) ও session-expired (লগআউট→লগইন বোতাম); gate নীতি পড়ে allowlist করা GET দিয়ে, probe ব্যর্থ হলে fail-open।

### ORG12 — Per-user org-সংখ্যা সীমা ✅

- **Setting:** `maxOrgsPerUser` — বিদ্যমান M33 পথেই (AdminService SETTING_KEYS + `updateSettings` যাচাই: null অথবা integer ≥ 1; 0/ভগ্নাংশ/string প্রত্যাখ্যাত — "সীমাহীন"-এর একটাই বানান)। মান না থাকলে/অবৈধ হলে **সীমাহীন** — কোডে কোনো default সংখ্যা নেই (D1 মালিকের সিদ্ধান্তের অপেক্ষায়)।
- **Enforcement:** `OrganizationsService.create`-এ slug যাচাইয়ের পর — আবেদনকারীর **OWNER-role membership-এর সংখ্যা** (যেকোনো membership status; **archived org-ও গোনে**, কারণ org বেঁচে আছে ও restore-যোগ্য — এই নীতি এখানেই নথিভুক্ত) সীমায় পৌঁছালে সীমার মানসহ বাংলা BadRequest। গোনা পড়তে না পারলে create আটকায় না (defensive)।
- **Admin UI:** Platform Settings (general → "প্ল্যাটফর্ম অবস্থা") কার্ডে সংখ্যার ঘর — খালি = সীমা নেই; বিদ্যমান `save()` পথেই PATCH।

### ORG13 — SUPER org tags ✅

- **Schema:** `Organization.tags String[] @default([])` (Postgres `TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[]`) — migration `20261025000000_org_tags`।
- **API (admin-only):** `PATCH /admin/orgs/:id/tags` (@AdminTier SUPER; পুরো তালিকা replace semantics; normalize = trim, খালি বাদ, হুবহু-duplicate বাদ, **case যেমন লেখা তেমনই**; সীমা সর্বোচ্চ ২০টি × প্রতিটি ৪০ অক্ষর; audit `admin.org_tags_updated` before/after-সহ)। `GET /admin/orgs?tag=` — array `has` দিয়ে exact-match filter (fresh-PG-তে আসল Postgres `@>` query দিয়েও যাচাই: শুধু মিল থাকা org ফিরেছে)।
- **Admin UI:** Org detail (সারসংক্ষেপ ট্যাব) — চিপ সম্পাদক (✕ মুছুন, input+Enter/যোগ, পুরো-তালিকা সেভ; সীমা client-পাশেও আয়না)। Org তালিকা — FilterBar-এ tag ঘর (server param), সক্রিয়-ফিল্টার চিপ, SavedViews/last-filters-এ অন্তর্ভুক্ত, সারির নামের নিচে ক্লিকযোগ্য tag চিপ (ক্লিকে ওই tag-এর filter)।
- **Tenant পক্ষে অদৃশ্য:** `tenantOrgView` helper দিয়ে create/listMine/getOne/updateIdentity-র ফেরত থেকে `tags` ছেঁটে ফেলা হয় (spec-প্রমাণিত); tenant UI-তে কোথাও tags রেন্ডার হয় না।

## গেট (সব serially চালানো)

| গেট | ফল |
|---|---|
| নতুন spec — `org-ob4-security.spec.ts` | **15/15 pass** (policy PATCH/GET, self-lockout, cap যাচাই, standing view, ORG12 create সীমা ×4, tags ছাঁটাই) |
| `tenant.guard.spec.ts` (ORG11 describe যোগ) | **21/21 pass** (আগের 12 + নতুন 9: MFA block + code, allowlist, session cap, sid-less প্রত্যাখ্যান, fail-open) |
| নতুন spec — `org-ob4-admin.spec.ts` | **10/10 pass** (setting যাচাই, tag normalize/সীমা/filter, SUPER tier metadata + guard SUPPORT প্রত্যাখ্যান) |
| সংশ্লিষ্ট suites — `jest src/organizations src/admin src/common` | 53/54 suite, **575/576 test pass** — একমাত্র fail `adx3-nav-counts` (নিচে দ্রষ্টব্য) |
| Fresh scratch PG — পুরো migration sequence | **222/222 applied, unfinished 0** (আগের 220 + নতুন 2); `\d "Organization"`-এ `requireMfa boolean NOT NULL DEFAULT false`, `sessionMaxAgeHours integer NULL`, `tags text[] NOT NULL DEFAULT ARRAY[]` যাচাই; আসল Postgres-এ tags `@>` filter-ও যাচাই; cluster গেট শেষে stop + মোছা হয়েছে |
| API `tsc --noEmit` + `npm run build` | ✅ সবুজ |
| Web vitest + `tsc --noEmit` + `next build` | **911/911 pass** (110 ফাইল) · tsc ✅ · build ✅ |
| Admin `tsc --noEmit` + `next build` | ✅ সবুজ |

**adx3-nav-counts নোট:** এই run-এ fail-টি line 90 (`failedJobs24h`) assertion-এ; OB1-এ একই spec line 91 (`overdueSubscriptions`)-এ fail হয়ে base commit `ca868858`-এ হুবহু পুনরুৎপাদনসহ **pre-existing প্রমাণিত ও নথিভুক্ত** (docs/org-ob1-acceptance.md)। দুটোই 24h-window গোনা-ভিত্তিক assertion — সময়-সংবেদনশীল। এই ব্যাচের diff job/sync গোনার কোনো কোড ছোঁয়নি (পরিবর্তন শুধু organizations/admin-settings/org-tags পথে)। OB4 দিয়ে এটি ঠিক করার চেষ্টা করা হয়নি — scope-এর বাইরে।

## NOT BUILT

- **Org IP allowlist** — প্ল্যানের D6 সিদ্ধান্ত ছাড়া বানানো হয়নি (ভুল নীতিতে tenant নিজেই আটকে যাওয়ার ঝুঁকি বলে OB-পরিকল্পনাতেই বাইরে রাখা)।
- **নীতি বদলের সদস্য-বিজ্ঞপ্তি** — requireMfa চালু হলে বা cap বসলে সদস্যদের কোনো ইমেইল/নোটিফিকেশন যায় না; সদস্য gate-পর্দায় গিয়েই জানতে পারে (পর্দায় করণীয় স্পষ্ট লেখা আছে)। প্ল্যান আইটেমে বিজ্ঞপ্তি ছিল না।
- **Session cap-এর পরিধি** — cap JWT-র মেয়াদ ছোট করে না এবং session বাতিলও করে না; enforcement শুধু ওই org-এর API সীমানায় প্রতি অনুরোধে। অন্য org-এ একই session যথারীতি চলে (এটাই org-ভিত্তিক নীতির অর্থ)।
- **Plan-ভেদে org-সংখ্যা সীমা** — ORG12 একটাই platform-wide setting; plan অনুযায়ী আলাদা সীমা (যেমন FREE-তে কম, AGENCY-তে বেশি) বানানো হয়নি — D1-এ মালিক সংখ্যা/কাঠামো ঠিক করলে পরে বসানো যাবে।
- **লাইভ প্রমাণ** — এই ব্যাচের কিছুই লাইভ সার্ভারে প্রমাণিত নয়; sandbox/unit/fresh-PG যাচাই পর্যন্তই। Push হয়নি (local commits only)।
