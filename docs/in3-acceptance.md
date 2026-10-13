# IN3 — Macro + Bulk Reply + Quick-Reply Variables — Acceptance

**তারিখ:** ২০২৬-১০-১২ · **প্যাকেজ:** IN প্যাকেজ Batch B2, প্রথম অংশ · **বেস:** `f8af51a` (branch `in-package`) · **প্ল্যান:** `Inbox-Next-Update-Plan-2026-10-12.md` §৩ IN3

## যা বানানো হয়েছে

### IN3a — Macro (নতুন model `InboxMacro` + migration `20261012210000_in3_macros`)
- ধাপের vocabulary: `reply` (Quick Reply দিয়ে) · `assign` (সদস্য id / `"me"` = যিনি চালাচ্ছেন / `null` = অ্যাসাইন তুলে নেওয়া) · `tag` · `pipeline` (stage) · `close` (ঐচ্ছিক outcome) · `snooze` (মিনিট)। ধাপ ১–১০টি।
- **কঠোর validation** (`sanitizeMacroSteps`, exported + tested): saved view-এর মতো নীরবে ধাপ ফেলে দেওয়া হয় না — অজানা/অসম্পূর্ণ ধাপ মানেই 400 (বাংলা বার্তা) এবং কিছুই সেভ হয় না। কারণ: ধাপ হারালে ম্যাক্রো তার সংজ্ঞার চেয়ে কম কাজ করেও "সফল" দেখাত।
- CRUD: `GET/POST /inbox/macros`, `PATCH/DELETE /inbox/macros/:macroId`। দৃশ্যমানতা saved view-এর নীতিতেই: নিজের + shared সবাই দেখে/চালাতে পারে, **বদলাতে/মুছতে পারে শুধু যিনি বানিয়েছেন** (403 বাংলা), জনপ্রতি ৫০টি cap, create/update/delete-এ audit।

### IN3b — চালানোর সততা (`POST /inbox/macros/:macroId/run`)
- প্রতিটি ধাপ **আসল service পথেই** চলে: reply → `sendReply`, assign/tag/pipeline/close → `updateConversation`, snooze → `snoozeConversation`। ফলে validation, CSAT-on-close, assignee notification, quick-reply usage count (শুধু নিশ্চিত পাঠানোয়) — সবই হাতে করা কাজের হুবহু।
- **প্রথম ব্যর্থ ধাপেই রান থামে।** ফলাফলে প্রতিটি ধাপের অবস্থা থাকে (`ok` / ব্যর্থ + আসল error / `skipped`) — পরের ধাপগুলো কখনো "হয়েছে" বলে দেখানো হয় না। Platform প্রত্যাখ্যান (যেমন Meta integration না থাকা) sendReply-এর verbatim `Message was NOT sent: …` error হিসেবেই ফলাফলে আসে, মেসেজ row `failed` থাকে (spec-প্রমাণিত)।
- রান সফল হোক বা ব্যর্থ, audit-এ লেখা হয় (`inbox.macro.run` / `inbox.macro.run_failed` + ব্যর্থ ধাপের index/type)।

### IN3c — Bulk reply (`POST /inbox/conversations/bulk-reply`)
- নির্বাচিত সর্বোচ্চ ২৫টি কথোপকথনে একই Quick Reply **অথবা** WhatsApp Template (ঠিক একটি বাধ্যতামূলক)। Per-item ফলাফল bulk action-এর ধাঁচে; বিদেশি org-এর id = plain "not found"।
- **WhatsApp 24h window:** Quick Reply পাঠানোর আগেই window যাচাই — বন্ধ থাকলে সেই item ব্যর্থ (কারণসহ) এবং **কিছুই পাঠানো হয় না** (spec-প্রমাণিত: window-বন্ধ কথোপকথনে কোনো মেসেজ row-ই তৈরি হয় না)। Template পথ Meta-র বাইরের-window নিয়ম মেনে `sendTemplate` দিয়েই যায়; non-WhatsApp-এ template item ব্যর্থ হয় সৎভাবে।

### IN3d — Quick-Reply variable সম্প্রসারণ (server-side)
- আগের তিনটি (`{{firstName}} {{contactName}} {{phone}}`) + নতুন তিনটি: `{{orderId}}` (সর্বশেষ লিংকড অর্ডারের externalNumber/id), `{{trackingLink}}` (সেই অর্ডারের সর্বশেষ shipment-এর লাইভ ট্র্যাকিং লিংক — token না থাকলে shareTracking-এর মতোই lazily mint হয়, কারণ এই context শুধু পাঠানোর মুহূর্তেই তৈরি হয়), `{{deliveryCharge}}` (InboxSetting-এর bot delivery charge, `formatMinor` দিয়ে)।
- **তথ্য না থাকলে variable ফাঁকা বসে — বানানো order id/লিংক/চার্জ কখনো নয়** (spec-প্রমাণিত)। অজানা placeholder আগের মতোই অপরিবর্তিত থাকে।
- সীমা (সৎ): এই সম্প্রসারণ macro ও bulk reply-এর server পথে প্রযোজ্য। Composer-এ হাতে Quick Reply বসালে আগের তিনটি variable-ই বসে (browser-এর কাছে order/shipment-এর পূর্ণ প্রসঙ্গ সবসময় থাকে না) — Manage-এর Quick Replies কার্ডে এই পার্থক্য লিখে দেওয়া আছে।

### Web
- Thread-এর action bar-এ **⚡ ম্যাক্রো** মেনু (ধাপের সারসংক্ষেপসহ তালিকা) → চালালে ধাপভিত্তিক ফলাফলের panel (✓/✗/⏭) thread-এর ওপরে থাকে।
- Manage ট্যাবে **ম্যাক্রো কার্ড**: তালিকা (টিম/অন্যের তৈরি লেবেলসহ, মালিকের জন্য delete) + ধাপ-ভিত্তিক builder (ধরন অনুযায়ী ইনপুট বদলায়, সর্বোচ্চ ১০ ধাপ, share checkbox)।
- Bulk bar-এ দ্বিতীয় সারি: Quick Reply বেছে **বাল্ক রিপ্লাই** / Template বেছে **Template পাঠান**; ব্যর্থ item নির্বাচিত থেকে যায় কারণসহ।
- Pure helper `apps/web/src/lib/inbox-in3.ts` (step summary, run-result formatting, bulk summary) + vitest।

## যাচাই
- API spec নতুন: `apps/api/src/inbox/in3-macros.spec.ts` — **13/13 pass** (strict sanitizer, variable rendering সততা, CRUD/visibility/cap, পূর্ণ run, মাঝপথে থামা + skipped, platform ব্যর্থতার verbatim প্রকাশ, bulk per-item + window pre-check + template WhatsApp-only)।
- Web vitest নতুন: `apps/web/src/lib/inbox-in3.test.ts` — **4/4 pass**।
- API `tsc --noEmit` clean · Web `tsc --noEmit` clean · Prisma schema validate পাস।
- পূর্ণ gate B2-এর শেষে `docs/in-b2-acceptance.md`-তে।

## সৎ সীমা
- **Live Meta পাঠানো প্রমাণিত নয়** (M30 বাকি): সফল পাঠানোর পথ Webchat (নিজেদের channel, row-ই delivery) দিয়ে প্রমাণিত; WhatsApp পথে প্রমাণিত হলো ব্যর্থতার সৎ প্রকাশ ও window pre-check। আসল নম্বরে macro reply পৌঁছানো অযাচাইকৃত।
- **Migration কোনো আসল DB-তে চলেনি** — `20261012210000_in3_macros` deploy-এর সময় লাগবে; তার আগে live সাইটে macros endpoint 500 দিতে পারে (IN1 migration-এর মতোই)। Deploy-তে `prisma generate` নতুন client-ও লাগবে (build-এর স্বাভাবিক অংশ)।
- Macro-র reply ধাপে Quick Reply-এর *লেখা* macro-তে copy হয় না — reference থাকে; Quick Reply মুছে গেলে run সেই ধাপে সৎভাবে ব্যর্থ হয় (উপরে প্রমাণিত)।
