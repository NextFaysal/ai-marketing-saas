# IN B3 (IN6 + IN7) — Combined Acceptance

Worktree `~/workspace/ai-marketing-saas-in`, branch `in-package`, B2
(`2f6a019`) থেকে এগিয়ে। Main repo ছোঁয়া হয়নি; push/fetch হয়নি।

## Commit

| Item | Commit | সারসংক্ষেপ |
|---|---|---|
| IN6 | `ef816bf` | Message lifecycle — webhook statuses থেকে monotonic delivery/read (deliveryStatus/deliveredAt/readAt), reply-to/quote (WA context, Messenger reply_to সত্যিকারের পথে; বাকি অভ্যন্তরীণ), reaction ingest + Messenger/IG agent reaction, pin; additive migration `20261012230000_in6_message_lifecycle` |
| IN6 fix | `2413e77` | Webchat read-marking সম্পূর্ণ best-effort — full gate-এ ধরা regression-এর fix (নিচে) |
| IN7 | `9f72380` | Handover summary (number-guardসহ সিস্টেম নোট), next-action + tag/stage প্রস্তাব (কিছু auto নয়, endpoint কিছু লেখে/পাঠায় না), ভাষা-মেলানো autopilot (override জেতে), unanswered→draft প্রস্তাব; schema বদল নেই |

Item-ভিত্তিক বিবরণ: `docs/in6-acceptance.md`, `docs/in7-acceptance.md`।

## Full gate (B3 শেষে, HEAD `2413e77`)

| Gate | ফলাফল | B2 baseline | মন্তব্য |
|---|---|---|---|
| API jest (full) | **1955/1955 pass, 214 suites** | 1913/1913, 212 suites | +42 = IN6 27 + IN7 15; পরপর দুই full run সবুজ |
| API tsc | clean (exit 0) | clean | — |
| Web vitest | **149/149 pass, 21 files** | 133/133 | +16 = IN6 9 + IN7 7 |
| Web tsc | clean (exit 0) | clean | — |
| Web next build | green (exit 0) | green | — |
| Prisma validate | schema valid 🚀 | valid | IN6 কলামসহ |

**Regression — একটি ধরা পড়েছে ও ঠিক হয়েছে:** প্রথম full run-এ
`nextgen-p2` (visitor projection) ১টি test ব্যর্থ হয় — IN6-এর
webchat read-marking `channelMessage.update(...).catch()` লিখেছিল,
কিন্তু পুরোনো fake prisma-তে `update` না থাকায় synchronous
TypeError-এ পুরো `listMessages` ভেঙে যাচ্ছিল। এটি আসল production
ঝুঁকিও ছিল: IN6 migration চালানোর আগে column না থাকলে visitor-এর
thread load-ই 500 দিত। Fix (`2413e77`): read-marking try/catch-এ
সম্পূর্ণ best-effort, এবং row তখনই read চিহ্নিত হয় যখন write
সত্যিই persist হয়েছে। Fix-এর পর p2+in6 একসাথে 46/46 এবং full
gate পরপর দুইবার 1955/1955। মাঝের এক run-এ tail-only output-এ
১টি অশনাক্ত failure দেখা গিয়েছিল (কোন test তা ধরা যায়নি, পরের
দুই full run পরিষ্কার) — সম্ভাব্য flake হিসেবে নথিবদ্ধ রইল,
চাপা দেওয়া হয়নি। cx3-debounce flake এই ব্যাচে আসেনি; root
cause আগের মতোই অজানা।

## চ্যানেলভেদে সততা সারণি (IN6)

| Channel | Read/Delivery | Quote→customer | Reaction পাঠানো | Reaction পাওয়া | Pin |
|---|---|---|---|---|---|
| WhatsApp | ✅ webhook statuses | ✅ context.message_id | ❌ Cloud API-তে endpoint নেই (service সৎভাবে refuse) | ✅ | ✅ |
| Messenger | ✅ mids + read watermark | ✅ reply_to.mid | ✅ sender_action (Meta confirm হলেই সংরক্ষণ) | ✅ | ✅ |
| Instagram | ✅ একই webhook/API | ✅ | ✅ | ✅ | ✅ |
| Webchat | ✅ read (visitor fetch-ই read পথ; stream-only-তে দেরি হতে পারে) | ❌ অভ্যন্তরীণ মাত্র (UI সৎ লেবেল) | ❌ | ❌ | ✅ |
| Telegram | ❌ কিছু দেখানো হয় না | ❌ অভ্যন্তরীণ | ❌ | ❌ | ✅ |
| Email | ❌ কিছু দেখানো হয় না | ❌ অভ্যন্তরীণ | ❌ | ❌ | ✅ |

Status কখনো অনুমানে বসে না: শুধু webhook নিশ্চিত করলেই, এবং
monotonic (read কখনো delivered-এ ফেরে না, failed read-কে মুছে
বাঁচায় না)।

## IN7 AI শৃঙ্খলা

- নতুন feature `handover_summary` / `next_action` /
  `unanswered_draft` — প্রতিটি kill switch (403) ও per-feature
  daily cap (429)-এর আওতায়, প্রতিটি LLM call-এ AIUsageRecord
  (guard-বাতিলেও), dev provider-এ সৎ null/নোট + usage row নয়।
- Handover summary-তে number-guard: thread-এ নেই এমন সংখ্যা এলে
  summary বাতিল + audit + সৎ নোট; ব্যর্থতায় handover নিজে চলে।
- Next-action/tag/stage ও unanswered draft — কোনোটাই কিছু
  পাঠায় না বা লেখে না (spec-প্রমাণিত); গ্রহণ মানুষের ক্লিকে,
  বিদ্যমান পথ দিয়ে। ভাষা শনাক্তকরণ deterministic; বিদ্যমান
  replyLanguage override থাকলে সেটাই জেতে।

## সৎ সীমা (deploy-এর আগে জানা জরুরি)

1. **Migration:** `20261012230000_in6_message_lifecycle` কোনো
   আসল DB-তে চলেনি — deploy-এ চালানো + `prisma generate`
   বাধ্যতামূলক। না চালালে lifecycle কলামের write ব্যর্থ হবে
   (webchat পথ এখন graceful, বাকি পথে endpoint error সম্ভব)।
   IN7-তে migration লাগেনি।
2. **Live প্রমাণ নেই (M30 pending):** Meta endpoint-গুলোর আকার
   docs-যাচাইকৃত, সব পথ fixture/fake-fetch প্রমাণিত; আসল
   WhatsApp/Messenger read/quote/reaction একবারও live দেখা হয়নি।
   LLM পথগুলো stub-fixture প্রমাণিত, live key দিয়ে নয়।
3. Messenger read watermark তুলনা outbound `createdAt` দিয়ে —
   সীমানায় কয়েক সেকেন্ড হেরফের সম্ভব।
4. Quote শুধু text send-এ; media/template পথে নয়। IN7e খসড়ায়
   number-guard নেই (display-only, মানুষের যাচাই বাধ্যতামূলক)।
5. Roman Banglish ("dam koto?") ভাষা detector-এ `en` গণনা হয়;
   override থাকলে অপ্রযোজ্য।

## Branch অবস্থা

- `in-package` HEAD: এই docs commit-এর আগ পর্যন্ত `2413e77`;
  working tree clean; B2 থেকে ৪ commit এগিয়ে (IN6, IN6 fix,
  IN7, এই docs)।
- GitHub-এ **push হয়নি**; master-এ merge/rebase হয়নি —
  integration পরের ধাপ। পরের ব্যাচ: B4 (IN2 + IN10)।
