# SN Batch 3 (SN5 + SN9) — Acceptance

**সুযোগ:** SN5 (Stock media — Pexels, org-এর নিজের key + brand overlay) ও SN9 (সাপ্তাহিক AI performance coach)।
**ভিত্তি:** Batch N2 HEAD `04589f6`। **Migration:** একটি — `20261015110000_sn5_sn9_stock_coach` (additive)।
**Commits:** `03010cc` (schema/migration) · `cf62572` (SN5 API) · `9019f32` (SN5 web) · `789a088` (SN9 API + job) · `2770853` (SN9 web) · এই docs commit।

> Commit ভাগ সম্পর্কে সৎ নোট: পরিকল্পনার ভাগ (schema / SN5 API / SN5 web / SN9 API+job / SN9 web / docs) হুবহু রাখা গেছে একটিমাত্র ব্যতিক্রমে — `social.controller.ts` ও `social.module.ts`-এ SN5 ও SN9 দুটোরই wiring থাকে বলে controller/module-এর SN9 অংশটা SN9 API commit-এ গেছে (SN5 অংশ SN5 API commit-এ), এবং web-এর shared ctx plumbing (page.tsx/shared.tsx) SN5 web commit-এ গেছে কারণ ctx একটাই object; Coach card নিজে আলাদা SN9 web commit-এ।

---

## আগে যা দেখা হলো (বিদ্যমান প্যাটার্ন)

| প্রশ্ন | যা পাওয়া গেল | সিদ্ধান্ত |
|---|---|---|
| Org-level provider key কোথায় থাকে? | `OrgLlmConfig` — sealed JSON (`encryptedData`, AES-256-GCM `encryptJson`/`decryptJson`, `integrations/crypto.ts`), পাঠক `resolveOrgLlmConfig` defensive | নতুন `OrgStockConfig` হুবহু একই ধাঁচে; নতুন কোনো encryption বানানো হয়নি |
| Verify-before-save ধাঁচ? | SP4/CC8: আসল provider call সফল হলেই save | SN5-এ Pexels probe সফল হলেই sealed row লেখা হয় |
| URL → media-র একমাত্র পথ? | PP3 `SocialImportService.fetchGuardedImage` (https-only, DNS public-IP check প্রতি hop, ≤৩ redirect, ~10s abort, streamed cap) | `fetchGuardedBytes(url, maxBytes, msg)`-এ generalize; image/PP3 caller হুবহু আগের আচরণে (PP3+SU3 spec পুনঃচালিয়ে যাচাই) |
| Derived asset ধাঁচ? | SU3 `createDerivedAsset` (derivedFromId, folder/tags copy, মূল অপরিবর্তিত) | Overlay একই পথে; attribution-ও copy হয় (নিচে) |
| Coach-এর data উৎস? | SU7 `SocialInsightsService` — `engagementScore`, `aggregateHashtagPerformance`, `contentTypes`, `getInsightsSummary().bestTime` | Coach নতুন কোনো হিসাব উদ্ভাবন করেনি — সব SU7 |
| Job template ধাঁচ? | `social_follower_snapshot` (JOB_TYPES + JOB_TEMPLATES + executeJob case + @Optional service, ctor-এর শেষে) | `social_coach_weekly` একইভাবে, ctor param সবার শেষে append |

## SN5 — Stock media + brand overlay

### Pexels key (org নিজের)
- `OrgStockConfig`: org-unique row, `encryptedData`-তে sealed `{apiKey}`, `status` (verified), `lastVerifiedAt`, `lastError`। Plaintext কখনো DB column/log/response-এ নয়।
- **Verify-before-save:** `saveStockKey` আগে নতুন key দিয়ে আসল Pexels call করে (`GET /v1/curated?per_page=1`, `Authorization: <key>`)। Non-200/network error → Pexels-এর নিজের error-সহ Bengali BadRequest, **কোনো row লেখা হয় না** — আগের সংরক্ষিত key থাকলে সেটা অপরিবর্তিত থাকে (spec-এ pinned)।
- **Status shape:** `{configured, provider, status, lastVerifiedAt, keyLast4}` — শুধু শেষ ৪ অক্ষর। Routes: `GET/PUT/DELETE media/stock/config` (PUT/DELETE শুধু OWNER/ADMIN)।
- Audit: `social.stock_key_saved` / `social.stock_key_deleted` — metadata-তে শুধু provider নাম, key কখনো নয়।

### Search + import
- `GET media/stock/search?q=&kind=photo|video&page=` — Pexels photos (`/v1/search`, ফাঁকা q-তে `/v1/curated`) ও videos (`/videos/search`, ফাঁকা q-তে `/videos/popular`), per_page 15। Return: `{stockId, kind, thumbUrl, width, height, duration, photographer, pageUrl, alt}`। Key না থাকলে সৎ Bengali 400।
- `POST media/stock/import {stockId, kind}` — client শুধু id দেয়; service Pexels থেকে item আবার পড়ে (`/v1/photos/:id` / `/videos/videos/:id`) canonical file URL নেয় (photo: large2x; video: video cap-এর মধ্যে সবচেয়ে বড় MP4)। তারপর **সেই একই SSRF-guarded importer** (`importExternalMedia`): dedupe (org, sourceUrl=Pexels page URL) → guarded fetch (cap = `socialVideoMaxBytes()`) → magic-byte sniff (image/video ছাড়া refuse; image হলে 2.1 MB image cap-ও প্রযোজ্য) → MediaStore + MediaAsset (`origin: "pexels"`)।
- **Attribution:** নতুন ছোট column `MediaAsset.attribution`-তে `"Photo by {name} on Pexels"` / `"Video by {name} on Pexels"` সংরক্ষিত; library serializer `sourceUrl` + `attribution` ফেরত দেয়; `createDerivedAsset` attribution copy করে — crop/overlay/cover-এ credit হারায় না। Audit `social.stock_media_imported` (metadata-তে শুধু source host)।

### Brand overlay
- `POST media/:id/brand-overlay {logoAssetId?, position?, barColor?}` (WRITE_ROLES) — sharp composite → **derived asset** (নাম `… (Brand)`), মূল asset/bytes অপরিবর্তিত (spec-এ byte-সমান assert)।
- Positions: `bottom`/`top` = brand bar (SVG layer, PP1 poster ধাঁচে org নামের text) + logo থাকলে bar-এর ভেতরে logo; `corner` = শুধু logo watermark (bottom-right, ~18% প্রস্থ)। Defaults: bar রং = dto → `org.primaryColor` → `#111827`; নাম = `org.brandName || org.name`; logo = logoAssetId → branding logo (`branding/<orgId>/logo`, `org.logoContentType` থাকলে)।
- **সৎ refuse:** video asset → 400 ("শুধু ছবিতে"); corner + কোথাও logo নেই → 400 (নীরব no-op বানানো হয়নি)। Audit `social.media_brand_overlay`।
- Web (Library tab): Stock section (key form/status/search grid/import), tile-এ credit line + Pexels link, image tile-এ position select + "🎨 Brand overlay" বোতাম; video tile-এ লেখা থাকে overlay শুধু ছবির জন্য।

### Specs (social-sn5.spec.ts, 16)
Verify সফল save (sealed + decrypt roundtrip + leak scan — কোনো returned shape-এ পূর্ণ key নেই) / ব্যর্থ save (verbatim error, row 0; পুরনো key অপরিবর্তিত) / delete / key ছাড়া search refuse / photo+video mapping / import-এ canonical URL + attribution (fake importer) ও **আসল importer দিয়ে** asset তৈরি + dedupe (দ্বিতীয় import-এ fetch একবারই) / overlay derived + source untouched + credit copy / corner-logo-ছাড়া refuse / video refuse।

## SN9 — Performance coach

### Compute (deterministic core)
- `computeCoachDigest(posts, {now})` — pure: window current [now−7d, now) বনাম previous [now−14d, now−7d), publishedAt অনুযায়ী। প্রতি window `{posts, scoredPosts, engagement}` (SU7 `engagementScore`), `engagementDeltaPct` (আগের window-তে scored post না থাকলে **null** — বানানো হয় না), top-3 post, hashtag movers (SU7 aggregation দুই window-তে; আগের window-তে না থাকা tag-এ `previousAvg: null` = নতুন)।
- Service `compute()`: SU7 থেকে enrichment — best content type (`contentTypes`-এর সর্বোচ্চ engagementAvg) ও best time (`getInsightsSummary().bestTime`, SU7 shape `{weekday, hour, score, postsConsidered}` ম্যাপ করে)। Enrichment best-effort; core compute একা দাঁড়ায়।
- **Thin data:** current window-তে scored post < 3 হলে `dataSufficient: false` এবং summary পরামর্শের বদলে সৎভাবে বলে data কম।

### Narration
- Real LLM থাকলে compute-এর JSON দিয়ে ছোট বাংলা সারসংক্ষেপ; **number guard** (SU4-এর `ungroundedNumbers` পুনঃব্যবহার) — compute-এ নেই এমন যেকোনো সংখ্যা এলে পুরো narration বাদ, deterministic লেখাই থাকে (spec: invented "৯৯৯৯" বাদ পড়েছে, কিন্তু usage row তৈরি হয়েছে — provider call হয়েছিল, কথাগুলো বাদ গেছে)।
- SN4 শৃঙ্খলা: আগে daily cap/kill-switch check (feature `social_coach`), usage row provider success-এর পরে। Cap/provider ব্যর্থতা/job path-এর যেকোনো error → deterministic fallback, কখনো throw নয়।
- LLM না থাকলে deterministic টেমপ্লেট সারসংক্ষেপ — response-এ `narrationSource: "llm" | "deterministic"` থাকে, deterministic লেখা "সারসংক্ষেপ" হিসেবেই থাকে, AI বলে দাবি করা হয় না। Web-এর pill-ও একই কথা বলে।
- `GET insights/coach` — `{latest: digest | null, preview: {data, summary}}`; **preview কখনো LLM call করে না** (spec-এ call-count 0 pinned)।

### Delivery
- `SocialCoachDigest` table: `(organizationId, weekStart)` unique; weekStart = org timezone-এ সপ্তাহের সোমবার (YYYY-MM-DD)। `runWeeklyDigest`: digest থাকলে `{created: false}` ফেরত — **নতুন row নয়, নতুন notification নয়** (race-এ unique violation হলেও winner-এর digest-ই ফেরত)। Spec-এ দুইবার run পিন করা।
- Job template `social_coach_weekly` (interval 10080 মিনিট, **opt-in install — default OFF**, বাকি সব template-এর মতোই): JOB_TYPES + JOB_TEMPLATES (সৎ descriptionBn: "নিজে থেকে কোনো পোস্ট তৈরি বা Publish করে না") + executeJob case + AutomationService ctor-এ সবার শেষে `@Optional() socialCoach`।
- Notification: `AgentNotification` type `social_coach_weekly`, শুধু **active OWNER/ADMIN** membership-দের (SU10 notifyFailed ধাঁচ, failure-isolated)। Audit `social.coach_digest_created`।
- **Job কখনো post তৈরি/publish করে না** — spec-এ digest run-এর পর SocialPost row সংখ্যা অপরিবর্তিত assert করা।
- Web (Analytics tab): Coach card — latest digest থাকলে সেটা (source pill-সহ), না থাকলে preview + সৎ note (template চালু করলে সাপ্তাহিক digest আসবে); সংখ্যার সারি, সেরা ধরন/সময়, top post, hashtag mover chips, thin-data note।

### Specs (social-sn9.spec.ts, 10)
Fixture থেকে হুবহু compute (window totals 41/7, delta 486%, top-3 order, movers current/previous avg) / thin-data আচরণ / আগের window ফাঁকা হলে delta null / digest run → row + OWNER/ADMIN-only notification / একই সপ্তাহে পুনঃrun no-op / guard-এ narration বাদ / grounded narration গৃহীত + usage row / getCoach latest+preview, preview-তে LLM call 0 / digest path-এ post তৈরি 0।

---

## Gates (final tree)

- **API jest FULL:** test-list ৬ chunk-এ `--runInBand`: 71/624 + 66/614 + 68/708 + 67/660 + 66/812 + 68/851 = **406 suites / 4269 tests** (N2: 404/4243; +২ suite = social-sn5 + social-sn9, +২৬ test)। একটিমাত্র ব্যতিক্রম নিচের সৎ সীমায়।
- **Web vitest FULL:** 56 files / **465/465 PASS** (N2: 462; +৩ lib test)।
- **tsc:** API 0 · web 0 · admin 0।
- **Build:** `pnpm -r build` — 7/7 project Done (ui, contracts, db, worker, api, admin, web)।
- **Fresh Postgres 16:** পুরো sequence **194/194 applied**, 0 unfinished/rolled back, **259 tables** (N2: 193 migration / 257 tables; +১ migration, +২ table — OrgStockConfig + SocialCoachDigest)।

## সৎ সীমা

- **কোনো live Pexels বা live LLM call হয়নি** — সব প্রমাণ stubbed-boundary spec স্তরে (fetch seam / provider stub)। Verify-before-save-এর সফল ও ব্যর্থ দুই পথই spec দিয়ে প্রমাণিত, কিন্তু আসল Pexels key দিয়ে live যাচাই M30/SN0 live verification-এর অংশ, এখনো বাকি।
- **API jest-এর একটিমাত্র failure:** chunked run-এ `inbox/cx3-debounce.spec.ts`-এর একটি timing test fail করেছে (reply-র content batch-এর প্রথম message-এর বদলে শেষেরটা থেকে এসেছে বলে assert)। এটি CX package থেকেই পরিচিত load-sensitive flake (root-cause এখনো open item) — এই batch-এ inbox ছোঁয়া হয়নি; একই suite standalone চালালে **18/18 PASS**। Full-run সংখ্যা তাই 4269-এর মধ্যে 4268 pass + এই 1 flake।
- Sandbox-এর `/tmp` (512 MB tmpfs) gate চলাকালে দুইবার ভরে গিয়েছিল — প্রথমবার কিছু বড়-file suite ENOSPC-তে fail করে (পরিষ্কার করে re-run-এ সব সবুজ), build-টাও একবার abort হয়ে TMPDIR disk-এ সরিয়ে পুনঃচালাতে হয়েছে। এগুলো পরিবেশের সীমা, code-এর নয় — তবু লিখে রাখা হলো।
- Overlay-র bar-এর org-নামের text host-এর font দিয়ে render হয় (PP1 poster-এর একই সীমা) — production host-এ Bengali font না থাকলে text ভাঙা আসতে পারে; logo/bar/রং font-নির্ভর নয়।
- Stock video import `SOCIAL_VIDEO_MAX_BYTES` (default 256 MB) সীমার মধ্যে; Pexels কোনো file-এর size না দিলে সবচেয়ে বড় MP4 বেছে নেওয়া হয় এবং importer-এর streamed cap-ই চূড়ান্ত রক্ষা।
- Coach-এর best-time/content-type SU7-এর all-time হিসাব (window-ভিত্তিক নয়) — digest-এ সেগুলো "হালনাগাদ হিসাব" হিসেবেই উপস্থাপিত; window তুলনা শুধু engagement/post/top/mover-এ।
- Group share-link list-এর মতো এখানেও: stock key একবার মুছলে আগের import করা asset থেকে যায় (Library asset স্বাধীন) — ইচ্ছাকৃত।
