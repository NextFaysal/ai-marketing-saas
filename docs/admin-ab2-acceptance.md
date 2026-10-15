# Admin Next AB2 Acceptance — AN9 + AN10 + AN11 (2026-10-15)

Base: branch `integration-5`, HEAD `ead9cfe` (Integration-5) থেকে শুরু।
Scope: **শুধু `apps/admin`** + এই doc ও QA checklist। কোনো API, schema,
logic, handler, state বা endpoint বদল হয়নি। Local commits only —
**push হয়নি, deploy হয়নি।**

Commits:
- `ef4b81b` AN11 (date helper + lang)
- `fcd80fc` AN9 responsive + AN11 wallet note
- `e2123d4` AN10 checklist
- (এই acceptance doc-এর commit)

---

## AN9 — Responsive completion (৯টা শূন্য-responsive page)

Audit-এর ৯টা page-এর প্রতিটিতে prefixed responsive utility ছিল **০**।
এখন প্রতিটিতেই আছে; মোট **০ → ২৩**। সব বদল শুধু `className` —
presentation class যোগ/বদল। Page ধরে:

| Page | বদল (শুধু class) | আগে → পরে |
|---|---|---|
| `admins` | Email cell-এ `break-all sm:break-normal` — লম্বা email mobile-এ cell ভেঙে বাইরে যাবে না। (Page-টি একটিমাত্র table; table scroll globals.css-এর নিয়মে আগেই ছিল।) | 0 → 1 |
| `alerts` | Alert card `flex-col sm:flex-row` (mobile-এ column স্তূপ), ৩টি action-ই `w-full sm:w-auto` | 0 → 4 |
| `audit` | Filter select/input `w-full sm:w-48` / `sm:w-40`, From/To label `w-full sm:w-auto` + input `w-full sm:w-40`, CSV button `w-full sm:w-auto` | 0 → 8 |
| `orgs` (list) | Search সারি `flex-col sm:flex-row` — mobile-এ input ও button স্তূপ | 0 → 1 |
| `payouts` | Status select `w-full sm:!w-auto`, Adjustment submit `w-full sm:w-auto` (form field গুলো আগেই full-width; header সারি আগেই flex-wrap ছিল) | 0 → 2 |
| `tickets` | নিচের **কাঠামোগত নোট** দেখুন + reply সারি `flex-col sm:flex-row`, পাঠান button `w-full sm:w-auto` | 0 → 3 |
| `usage` | AI filter input-এর fixed `!w-64` উঠিয়ে `sm:!w-64` — mobile-এ ainput-এর full width, desktop-এ আগের 256px-ই | 0 → 1 |
| `users` (list) | Search সারি `flex-col sm:flex-row` (orgs-এর একই ধাঁচ) | 0 → 1 |
| `login/totp` | Container `sm:p-6`, শিরোনাম `sm:text-2xl` (form আগেই `w-full max-w-sm`, button আগেই full-width) | 0 → 2 |

**কাঠামোগত নোট (tickets):** তালিকা/detail-এর wrapper-এ `className="grid2"`
ছিল — কিন্তু `.grid2` পুরো admin app-এর কোথাও **defined-ই ছিল না**
(grep-যাচাইকৃত), অর্থাৎ দুই-কলাম layout আসলে কখনোই কার্যকর ছিল না;
detail সবসময় তালিকার নিচে block হিসেবে পড়ত। সেটি বদলে আসল
responsive grid দেওয়া হয়েছে: `grid grid-cols-1 items-start gap-3
lg:grid-cols-2`। এটিই এই batch-এর একমাত্র class-নামের বদল যা শুধু
যোগ নয় — প্রতিস্থাপন; আচরণে বদল বলতে শুধু এই যে ≥lg-তে এবার সত্যিই
দুই কলাম হবে (যা মূল নকশার উদ্দেশ্য ছিল)। Inline `style` prop
(alignItems) অপরিবর্তিত রাখা হয়েছে। QA checklist-এ এই page-টির
দুই-কলাম বিশেষভাবে যাচাইয়ের জন্য চিহ্নিত।

বাকি page গুলো (যেগুলোতে আগেই responsive utility ছিল — analytics,
billing, growth, settings, system ইত্যাদি) ছোঁয়া হয়নি — scope creep নয়।

## AN11 — Polish (৩টি item)

1. **`lang="bn"`:** `apps/admin/src/app/layout.tsx`-এ `<html lang="en">`
   → `lang="bn"` (UI বাংলা)।
2. **Date helper:** নতুন `apps/admin/src/lib/dates.ts` —
   `fmtDateTime(value, kind = "datetime" | "date" | "time", options?)`।
   এটি প্রতিটি call site-এর **হুবহু একই** পদ্ধতি ডাকে
   (`toLocaleString` / `toLocaleDateString` / `toLocaleTimeString`,
   locale `"bn-BD"`, options pass-through) — তাই কোনো page-এর দেখানো
   ফরম্যাট এক অক্ষরও বদলায়নি। **৪২টি date call site** ১৬টি page থেকে
   helper-এ routed: admins 1 (স্থানীয় `fmt` wrapper-এর ভেতর দিয়ে),
   audit 1, billing 2, growth 4, health 2, orgs/[id] 3, orgs 1,
   overview 2 (এর একটি weekday/day/month/year options-সহ — options
   হুবহু রাখা), payouts 1, security 5, settings 3, social-ops 1
   (স্থানীয় `fmt` helper-এর ভেতর), system 9, tickets 2,
   users/[id] 3, users 2। যাচাই: `new Date(...).toLocale*` pattern
   এখন app-এ **শূন্য**। ইচ্ছা করে ছোঁয়া হয়নি: সংখ্যার ফরম্যাট
   (growth-এর `taka()`, social-ops-এর সংখ্যা `toLocaleString("bn-BD")`,
   analytics/system-এর locale-ছাড়া সংখ্যা) — সেগুলো date নয়, আর
   locale বদলালে দেখানো সংখ্যা বদলে যেত।
3. **Wallet ব্যাখ্যা-লাইন:** Settings-এর Wallet card-এ fee/four-eyes
   ঘরের ঠিক নিচে এক লাইন যোগ: "💡 সেভ করার পর থেকে কার্যকর: নতুন ফি
   শুধু সেভ করার পরের যাচাইকৃত (verified) প্ল্যাটফর্ম পেমেন্টে কাটা
   হবে — আগের পেমেন্ট বা জমা হওয়া ব্যালেন্সে কোনো পরিবর্তন হবে না।"
   শুধু লেখা; কোনো আচরণ বদল নয়। (Card-এর নিচের বড় অনুচ্ছেদে
   হিসাবের নিয়ম আগেই ছিল — এই লাইনটি ঘরের পাশে কার্যকর-হওয়ার
   মুহূর্তটা স্পষ্ট করে।)

## AN10 — Screenshot QA checklist (শুধু প্রস্তুতি)

`docs/admin-screenshot-qa-checklist.md` — ২২ page × (Desktop 1440 +
Mobile 390) + ৫টি সাধারণ box = **৪৯টি checkbox, সব UNCHECKED**।
প্রতিটি page-এ তার আসল content অনুযায়ী "যা দেখতে হবে" লেখা।
Header-এ স্পষ্ট বলা আছে: **কোনো screenshot তোলা হয়নি**; আসল QA
চলবে এই build deploy হওয়ার পরেই (মালিকের push + Dokploy Redeploy)।

## Zero-loss যাচাই (SD-batch পদ্ধতি)

শুরু করার আগে ও পরে একই extraction script দিয়ে set-diff
(quoted string literal থেকে endpoint pattern ও বাংলা-label set):

- **Scope set** (AN9-এর ৯ page + settings + layout):
  endpoint **২৭ → ২৭ identical**; label **১২০ → ১২০, lost ০, added ০**।
  (Wallet ব্যাখ্যা-লাইনটি JSX text, quoted literal নয় — তাই set-এ
  ধরা পড়ে না; তার অস্তিত্ব git diff-এ যাচাইকৃত: settings-এ ঠিক
  +১ লাইন। `lang` attribute label নয়।)
- **All-pages set** (সমগ্র admin src, অতিরিক্ত যাচাই): endpoint
  **৮৬ → ৮৬ identical**; label **৩১০ → ৩১০** — মাত্র ২টি template
  fragment-এ পার্থক্য, দুটোতেই শুধু ভিতরের date-expression বদলেছে
  (`new Date(...).toLocale...("bn-BD")` → `fmtDateTime(...)`);
  দেখানো লেখা হুবহু এক।
- AN9 diff পুরোটা পড়ে যাচাই: বদল শুধু className string-এর ভেতরে
  (tickets-এর grid প্রতিস্থাপনসহ) — handler/state/API call একটিও নয়।

## Gates

- Admin `tsc --noEmit`: **০ error**
- Admin `next build`: **green** — ২২ route সব (build trace যাচাইকৃত)
- Admin vitest: **কোনো test file নেই** admin app-এ (`--passWithNoTests`-এ
  exit 0) — তাই "spec pass" দাবি করা হয়নি
- API/Web tsc চালানো হয়নি — shared code ছোঁয়া হয়নি (বদল শুধু
  `apps/admin`-এর ভেতরে; নতুন `lib/dates.ts` admin-এর নিজের)
- Prisma/schema: অপরিবর্তিত

## সৎ সীমা

- **Screenshot QA হয়নি** — AB2 নিজে deploy ছাড়া তা সম্ভব নয়;
  checklist তৈরি শুধু। Responsive বদলগুলো code-স্তরে যাচাইকৃত
  (build + diff), চোখে দেখা নয়।
- Tickets-এর message bubble-গুলোর পাশের ফাঁক inline style (32px) —
  class-only scope-এ ছোঁয়া হয়নি; mobile-এ চাপ লাগলে QA-তেই ধরা
  পড়বে, checklist-এ নোট আছে।
- এই tree **push হয়নি**; AB2 live হবে মালিকের push নির্দেশ +
  Dokploy Redeploy-এর পর।
