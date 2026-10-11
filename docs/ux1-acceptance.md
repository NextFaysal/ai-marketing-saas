# UX1 — Quick Wins — Acceptance

**তারিখ:** ২০২৬-১০-১২ · **রোডম্যাপ:** `docs/ux-roadmap-plan.md` Phase UX1 (Q1–Q5) · **UX0:** `docs/ux-qa-baseline-2026-10.md`
**কমিট:** API counts `2848898` · UX0 `8bad141` · এই web প্যাকেজ (নিচের হ্যাশ চূড়ান্ত রিপোর্টে)।

## Q1 — বাংলা ফন্ট ✅

- `@fontsource/hind-siliguri@5.3.0` apps/web-এর dependency (package.json + pnpm-lock)।
- `layout.tsx`-তে weight 400/500/600/700 import (Inter Variable-এর পরেই)।
- `globals.css` body-তে font stack: `"Inter Variable", Inter, "Hind Siliguri", …` —
  Latin Inter-এই থাকে, বাংলা glyph per-glyph fallback-এ Hind Siliguri পায়।

## Q2 — নতুন মেসেজে সাড়া ✅

- **API (একমাত্র API ছোঁয়া):** `conversationFolderCounts`-এ `unreadTotal` — stored
  `unreadCount`-এর org-wide Prisma aggregate (`_sum`), `.catch` fallback 0। Loaded list-এর
  আংশিক যোগ কোথাও ব্যবহার হয়নি।
- **Title badge:** `unreadTotal > 0` হলে `document.title = "(n) ইনবক্স"`; শূন্যে ও unmount-এ
  আসল title ("AI Marketing SaaS") ফেরে। Counts payload আলাদা `unreadTotal` state-এ ধরা হয়
  (folderCounts-এর type অপরিবর্তিত রাখা হয়েছে — সমান্তরাল CX4 কাজের সাথে সংঘর্ষ এড়াতে)।
- **Desktop Notification:** stream-এর `message.created`-এ, শুধু inbound + অন্য কথোপকথন +
  `document.hidden` হলে; handler সর্বশেষ render-এর ref দিয়ে ডাকা হয়। অনুমতি শুধু Manage-র
  toggle ক্লিকে (user gesture) — প্রত্যাখ্যাত হলে সৎ error বার্তা, toggle বন্ধই থাকে।
  ক্লিকে window focus + ওই কথোপকথন খোলে।
- **শব্দ:** WebAudio দুই-সুরের হালকা beep; AudioContext suspended থাকলে (autoplay policy)
  resume চেষ্টা করে ওইবার নীরব থাকে — error নয়।
- দুটো পছন্দই **per-agent localStorage** (`inbox.notify` / `inbox.sound`) — org setting নয়;
  Manage কার্ডে লেবেল হুবহু তাই বলে ("এই পছন্দগুলো শুধু আপনার, এই ব্রাউজারেই থাকে")।

## Q3 — পছন্দ মনে রাখা ✅

- filters (defaults-এর ওপর merge করে lazy init), smartFolder, viewMode — `inbox.filters` /
  `inbox.folder` / `inbox.view` localStorage-এ persist (pane width-এর বিদ্যমান ধাঁচে)।
- Palette-তে **"🧹 সব ফিল্টার রিসেট করুন"** — defaults ফেরত + saved মান মুছে + তালিকা reload।
- ⚠️ Staging নোট: staged কমিটে smartFolder initializer শুধু sla/vip যাচাই করে; working tree-তে
  সমান্তরাল CX4-এর `handover` folder-সহ পূর্ণ সংস্করণ আছে (তাদের type union-সহ) — CX4 কমিট
  সেই লাইন নিলে handover-restore-ও সক্রিয় হবে। আচরণগত পার্থক্য শুধু এই restore যাচাইয়ের পরিধি।

## Q4 — ⌘K-তে খোঁজা ✅

- Palette-র ওপরে search input: লোড করা conversations থেকে নাম/ফোন/preview মিল, সর্বোচ্চ ৮ ফল;
  Enter-এ প্রথম মিল খোলে, ক্লিকেও। ফলের নিচে সৎ সীমা লেখা আছে ("লোড করা কথোপকথন থেকে —
  সব কথোপকথনে খুঁজতে তালিকার Search ঘর, ওটা সার্ভারে খোঁজে")। বিদ্যমান actionগুলো নিচে হুবহু।

## Q5 — Pending bubble + Retry ✅ (একটি refinementসহ)

- `sendReply`: সঙ্গে সঙ্গে local temp bubble (status `"sending"`, ধূসর/opacity, লেবেল
  **"পাঠানো হচ্ছে…"**) — server-এর আসল row এলে temp বদলে যায়; stream আগে পৌঁছালে dedupe
  (আসল id থাকলে temp শুধু মুছে যায়, duplicate হয় না)।
- ব্যর্থ হলে bubble failed অবস্থায় থাকে + **"↻ আবার পাঠান"** — একই content নতুন send;
  সফল হলে একই dedupe পথে আসল row।
- **Refinement (রোডম্যাপ থেকে সচেতন বিচ্যুতি):** রোডম্যাপে ছিল "ব্যর্থ হলে লেখা composer-এ
  ফেরত আসবে" — বাস্তবায়নে **composer-এ auto-restore হয় না**: bubble-ই content ধরে রাখে ও
  সেখান থেকেই retry হয়। কারণ: restore হলে agent খেয়াল না করে আবার Send চাপলে একই লেখা
  দুইবার যাওয়ার ঝুঁকি থাকে; bubble-retry-তে সেই পথই নেই।
- সততা: pending কখনো "পাঠানো হয়েছে" দেখায় না (statusIcon-এ sending আলাদা লেবেল)।
  Media/product পাঠানোতে এই phase-এ pending নেই — শুধু text reply (আগের আচরণই)।

## যা অপরিবর্তিত

- counts endpoint ছাড়া কোনো handler/endpoint/payload বদল নয়। CX4-এর অকমিটেড page.tsx কাজ
  (handover queue UI) এই কমিটে **ঢোকেনি** — staged page.tsx HEAD-ভিত্তিকে শুধু UX1 হাংক দিয়ে
  গড়া; working tree-তে তাদের সব কাজ অক্ষত।

## যাচাই — আসল আউটপুট

- API jest: `ux1-counts.spec.ts` **2/2 pass** (unreadTotal 7 = org-এর আসল যোগ, অন্য org-এর
  9 বাইরে; খালি aggregate → 0) · `inbox.service.spec.ts` **5/5 pass**।
- ⚠️ `nextgen-p2.spec.ts`-এর counts test-এ unreadTotal expectation যোগ করা আছে, কিন্তু suite-টি
  এই সেশনে **run হয়নি**: সমান্তরাল CX ট্র্যাকের অকমিটেড `webchat.service.ts:195`-এ
  `parseCourierCard` ব্যবহার আছে import ছাড়া (TS2304) — তাদের WIP-এর compile error, এই
  প্যাকেজের কোডে নয়। তাদের কাজ commit/ঠিক হলে suite-টি চলবে; UX1-এর aggregate ততক্ষণে
  dedicated spec দিয়ে যাচাই করা।
- Web: `tsc --noEmit` **clean (exit 0)** · vitest **8 files / 72 tests pass** ·
  `pnpm --filter @repo/web build` **green** (route table সম্পূর্ণ)।
- পরিবেশ নোট: `/tmp` tmpfs পূর্ণ থাকায় সব যাচাই `TMPDIR=/home/hatch/.ux-tmp` দিয়ে চালানো।

## সৎ সীমা

- **Screenshot পুনঃযাচাই হয়নি** — UX0-র সীমাই এখানেও: sandbox-এ app database নেই (UX0 ডকে
  বিস্তারিত), তাই Q1 ফন্টের চোখে-দেখা তুলনা ও Q5-এর live প্রবাহ browser-এ চালানো যায়নি;
  যাচাই build + typecheck + unit test + code পথ ধরে। Notification প্রবাহও live stream দিয়ে
  হাতে-কলমে পরীক্ষা হয়নি (একই কারণ)।
- Sound default চালু (রোডম্যাপ অনুযায়ী) তবে শুধু tab hidden + অন্য কথোপকথনে; AudioContext
  নীতি অনুযায়ী প্রথম user gesture-এর আগে নীরব থাকতে পারে।
- **Local commit only — GitHub push হয়নি** (মালিকের স্থায়ী নিয়ম)।
