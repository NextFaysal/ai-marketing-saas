# UX0 — Inbox Visual QA Baseline (2026-10)

**রোডম্যাপ:** `docs/ux-roadmap-plan.md` Phase UX0 · **তারিখ:** ২০২৬-১০-১২

## যা করা গেল, যা গেল না (সৎ অবস্থা)

- **চেষ্টা করা হয়েছে:** sandbox Postgres cluster (PG16) চালু করা গেছে — কিন্তু তাতে **কোনো app
  database নেই** (আগের sandbox ডেটা VM বদলের সময় মুছে গেছে; repo tree-তে কোনো `.env`-ও নেই)।
  পূর্ণ stack (DB তৈরি + ~১২০ migration + demo seed + API + web) এই সেশনে দাঁড় করানো হয়নি —
  জোর করে আংশিক stack বানিয়ে তার screenshot নেওয়া হয়নি। **কোনো ভুয়া screenshot নেই।**
- **পরিবর্তে যা করা হয়েছে:** (ক) নিচের static markup QA — বর্তমান page.tsx/globals.css-এর আসল
  class/breakpoint ধরে যাচাই; (খ) screenshot-এর জন্য seed script তৈরি
  (`packages/db/prisma/seed-inbox-qa.ts`, demo-org গার্ডসহ — stack থাকলেই চালানো যাবে);
  (গ) নিচের screenshot checklist — stack দাঁড়ালেই হুবহু অনুসরণ করে ছবি তোলা যাবে।
- UX1-এর Q1/Q5 screenshot পুনঃযাচাইও তাই এই সেশনে হয়নি (একই সীমা UX1 acceptance-এও লেখা আছে)।

## Static markup QA — ফলাফল

| # | এলাকা | যাচাই | তীব্রতা |
|---|-------|-------|---------|
| 1 | বাংলা rendering | পুরো অ্যাপে শুধু Inter; বাংলা glyph ডিভাইস-fallback — দীর্ঘদিনের সবচেয়ে বড় চোখে-দেখা ঘাটতি | 🔴 গুরুতর → **UX1 Q1-এ ঠিক হচ্ছে** |
| 2 | Conversation কার্ড | পুরো কার্ডটাই button (tap target বড়), নাম `truncate`, preview ১ লাইন — ভালো | ✅ ঠিক আছে |
| 3 | Thread header | `min-w-0` + নামে `truncate`, chips wrap হয় — লম্বা নামে ভাঙে না | ✅ ঠিক আছে |
| 4 | Thread bubble | `max-w-[80%]` সব পর্দায়; মোবাইলে 80% যুক্তিসংগত | ✅ ঠিক আছে |
| 5 | Media মেসেজ | ছবি `max-h-56`, `object-fit` নেই — লম্বা ছবি aspect বিকৃত না হলেও জায়গা বেশি খেতে পারে | 🟡 ছোট — ভবিষ্যৎ পলিশ |
| 6 | Composer (ছোট পর্দা) | textarea `rows=2` + toolbar wrap হয়; Send বোতাম ~36px — 44px নির্দেশিকার নিচে | 🟡 ছোট — ভবিষ্যৎ পলিশ |
| 7 | Manage sub-nav chip | ট্যাপ টার্গেট উচ্চতা ~32–36px ধাঁচের — ডেস্কটপে ঠিক, টাচে ছোট | 🟡 ছোট |
| 8 | Board (মোবাইল) | ৬ stage উল্লম্বে স্তূপ — লম্বা scroll; horizontal snap-rail হলে ভালো হতো | 🟡 ছোট — UX3 প্রার্থী |
| 9 | Context drawer | `w-[340px] max-w-[94vw]` + backdrop — ছোট পর্দায় নিরাপদ | ✅ ঠিক আছে |
| 10 | Stat chip সারি (header) | `flex-wrap` আছে — 360px-এ ভেঙে দুই সারি হয়, overflow হয় না | ✅ ঠিক আছে |
| 11 | Skeleton/loading | v3-তে skeleton এসেছে; Media Library-তে আলাদা loading অবস্থা নেই (v3 acceptance-এ নথিভুক্ত) | ℹ️ জানা সীমা |
| 12 | Contrast | tinted chip/badge-গুলোর পূর্ণ contrast অডিট screenshot ছাড়া করা যায়নি | ⏳ UX3 a11y pass-এ |

**গুরুতর defect তালিকা:** একটাই — #1 (বাংলা ফন্ট), যা UX1 Q1-এর অংশ হিসেবে এই প্যাকেজেই ঠিক হচ্ছে।
বাকিগুলো ছোট/ভবিষ্যতের; UX1-এর scope-এ জোর করে ঢোকানো হয়নি।

## Screenshot checklist (stack দাঁড়ালে হুবহু এই ক্রমে)

1. Seed চালাও: `INBOX_QA_CONFIRM=demo-only INBOX_QA_ORG_ID=<demo org> pnpm --filter @repo/db exec tsx prisma/seed-inbox-qa.ts`
   (VIP ফোল্ডারের জন্য Inbox settings-এ escalation threshold ≤ ৳2,500 বসাও।)
2. Desktop 1440×900: list (সব ফোল্ডার chip), thread — sla / vip / media (ছবি+ভয়েস) / failed / long প্রতিটা,
   board, media, manage (ওপর-নিচ দুই স্ক্রল অবস্থান)।
3. Mobile 390×844: list, thread + composer (কীবোর্ড ছাড়া), context drawer খোলা অবস্থা, board।
4. প্রতিটা ছবিতে খেয়াল: overflow, বাংলা wrap, লম্বা নাম truncation, failed bubble, drawer-এর বাইরে ফাঁক।
5. ছবি রাখো: `docs/ux-qa-shots/` (git-এ বড় ছবি না রাখতে চাইলে workspace-এর goal files-এ) —
   এই ডকের টেবিলে পথ ধরে reference যোগ করো।

## Seed matrix (script যা বানায়)

| key | চ্যানেল | বিশেষত্ব |
|-----|---------|----------|
| sla | WhatsApp | লম্বা বাংলা নাম, ৫ ঘণ্টা পুরনো, উত্তরহীন, unread 3 → SLA breach + লম্বা preview |
| vip | Messenger | ইংরেজি নাম, linked order ৳2,500 (সর্বশেষ) → VIP প্রার্থী |
| media | Instagram | খুব লম্বা username, ছবি (tall) + ভয়েস মেসেজ |
| failed | WhatsApp | failed outbound মেসেজ (error লেখাসহ — QA চিহ্নিত) |
| long | Webchat | অত্যন্ত লম্বা ইংরেজি নাম + লম্বা এক-লাইন preview, pending |
