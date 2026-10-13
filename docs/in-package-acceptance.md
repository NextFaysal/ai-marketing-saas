# IN Package (IN1–IN10) — সমাপনী Acceptance

**তারিখ:** ২০২৬-১০-১৩ · **Branch:** `in-package` (worktree `ai-marketing-saas-in`), base `a8980d6`
**অনুমোদন:** মালিক, ২০২৬-১০-১২ ২২:১৬ +06 — "পুরো IN1–IN10 প্যাকেজ অনুমোদন দিলাম, B1–B5 ধারাবাহিকভাবে করো"
**প্ল্যান:** `~/workspace/goals/ai-marketing-saas-platform-build/files/Inbox-Next-Update-Plan-2026-10-12.md`
**অবস্থা:** B1–B5 সব শেষ। **GitHub push হয়নি** (মালিকের স্থায়ী নিয়ম), master-এ merge/rebase হয়নি — integration আলাদা ধাপ (§৫)।

---

## ১. Final gate (coordinator নিজে চালিয়েছে, HEAD `b795b18`-এ)

| Gate | ফলাফল | B4 baseline |
|---|---|---|
| API jest (full) | **2012/2012 pass, 219 suites** | 1982/1982, 217 |
| API tsc | clean | clean |
| Web vitest | **156/156, 22 files** | 149/149 |
| Web tsc | clean | clean |
| Web next build | green | green |
| Prisma validate | valid 🚀 | valid |

হিসাব মেলে: 1982 + IN8 19 + IN9 (API 11) = 2012; suites 217 + in8 + in9 = 219; web 149 + IN9 7 = 156। Coordinator-এর এই full run-এ **zero regression, কোনো flake আসেনি** (B3-র মাঝের run-এর অশনাক্ত tail failure ও cx3 flake-এর ইতিহাস নিজ নিজ batch acceptance-এ নথিবদ্ধ; এবার পুনরাবৃত্তি হয়নি)।

## ২. Package মানচিত্র — IN1–IN10 প্রতিটির commit

| Item | Commit(s) | Acceptance doc | Migration |
|---|---|---|---|
| IN1 Search + Saved Views | `528d7e4` | in1 / in-b1 | `20261012200000` |
| IN5a Voice transcoding | `4023150` | in5a / in-b1 | — |
| IN3 Macros + bulk reply | `4f85528` | in3 / in-b2 | `20261012210000` |
| IN4 Layered SLA + escalation chain | `6e656ad` | in4 / in-b2 | `20261012220000` |
| IN6 Message lifecycle (read/quote/reaction/pin) | `ef816bf` + fix `2413e77` | in6 / in-b3 | `20261012230000` |
| IN7 AI next steps | `9f72380` | in7 / in-b3 | — |
| IN2 Identity merge (reversible) | `69efed7` | in-b4 | `20261012240000` |
| IN10 Block + Analytics v2 | `126a142` | in-b4 | `20261012250000` |
| IN8 Comment + DM unified (Graph-verified) | `f647211` | in8 | `20261012260000` |
| IN9 Cursor pagination + drafts + refactor | `b795b18` | in9 | — |

Batch docs commit: B1 `f8af51a` · B2 `2f6a019` · B3 `c8e6752` · B4 `ca7be22` · এই সমাপনী doc আলাদা commit-এ।

### B5-এর বিশেষ রায়
- **IN8 verify-first:** audit-এ প্রমাণিত হয়েছিল comment hide/reply আগে **শুধু DB status বদলাতো** — Graph call ছিলই না, আর `isPrivateDmSent` AI plan থেকে না-পাঠিয়েই বসত (সফল সাজানো হতো)। এখন চারটি Graph endpoint-ই (hide/reply/delete/private_replies) confirmation body ছাড়া সফল ধরে না; সব comment action সেই layer দিয়ে যায়। Comment-কে conversation model-এ জোর করে মেশানো হয়নি (queue = Comments page + assign); SLA/snooze comment-এ সৎভাবে প্রয়োগ হয়নি। Live Meta প্রমাণ নেই — fixture HTTP স্তরে প্রমাণিত, M30 বাকি।
- **IN9 refactor:** page.tsx 3,919 → 3,852 লাইন (pure helper → `lib/inbox-format.ts`, props-only component → `components/inbox-extras.tsx`)। Stateful মূল component (~3,700 লাইন) ছোঁয়া হয়নি — পরস্পর-জড়ানো state-র ঝুঁকি বিবেচনায় সৎভাবে বাকি। সত্যিকারের list virtualization-ও বাদ (নতুন dependency ছাড়া নিরাপদ পথ ছিল না; progressive cap + এখন cursor-backed sentinel আছে)। **কোনো performance সংখ্যা দাবি করা হয়নি** — sandbox-এ আসল DB নেই।

## ৩. সৎভাবে বাকি থাকা (package দাবির সীমা)

| অংশ | অবস্থা |
|---|---|
| IN5b (video thumbnail/PDF preview), IN5c (media zip download), IN5d (2MB cap পর্যালোচনা) | কোনো batch-এ বরাদ্দ ছিল না (B1-এ শুধু IN5a); হয়নি — পরের ছোট প্যাকেজের কাজ |
| IN9b পূর্ণ virtualization, IN9c stateful core refactor, IN9e mobile swipe/screenshot QA | ওপরে §২ দ্রষ্টব্য; QA-র জন্য আসল browser/DB লাগবে |
| IN1 search গতি | Plain `contains` scan (index নয়) — বড় org-এ FTS/trigram পরের ধাপ |
| সব live প্রমাণ | Meta/LLM/courier আসল credential দিয়ে একটিও item live যাচাই হয়নি — **M30 sprint বাকি** |

## ৪. Deploy checklist (integration-এর পর, live-এ তোলার সময়)

1. **সব migration চালাতে হবে + `prisma generate`:** in-package-র ৭টি — `20261012200000` (saved views), `20261012210000` (macros), `20261012220000` (SLA chain), `20261012230000` (message lifecycle), `20261012240000` (merge record), `20261012250000` (conversation block), `20261012260000` (comment graph queue)। একটিও কোনো আসল DB-তে চলেনি; না চালালে সংশ্লিষ্ট endpoint 500 দেবে (প্রতিটি batch acceptance-এ পুনরুল্লেখ আছে)।
2. **Production হোস্টে ffmpeg যাচাই** (`ffmpeg -version`, libopus) — না থাকলে IN5a সৎ fallback-এ চলে, ভাঙে না, তবে transcoding হবে না।
3. **প্রতিটি org-এর Automations-এ "Inbox SLA Sweep" job চালু** — না হলে IN4 chain চলবে না।
4. **M30 live verification:** আসল Meta app/Page token দিয়ে IN6 read/quote/reaction ও IN8 hide/reply/delete/private-reply অন্তত একবার করে; আসল LLM key দিয়ে IN7; Dokploy-তে manual Redeploy (স্থায়ী নিয়ম অনুযায়ী)।

## ৫. Integration নোট (master-এ তোলার সময়)

- `in-package` base `a8980d6`; master এর মধ্যে অনেক এগিয়েছে (Global Assistant, G6+AP2, AP3–AP7 ইত্যাদি)। Merge-এর সময় inbox ফাইলে conflict প্রত্যাশিত — ধাপে ধাপে মেলাতে হবে, একপাক্ষিক overwrite নয়।
- **Migration prefix সংঘর্ষ তিনটি** — একই timestamp prefix, **আলাদা folder ও আলাদা table, দুটোই রাখতে হবে, কোনোটা drop/renumber অন্ধভাবে নয়:**
  - `20261012220000` — master: GA `AiSavedPrompt` ↔ in-package: IN4 SLA chain
  - `20261012230000` — master: AP2 `AIMessage` attachment text ↔ in-package: IN6 message lifecycle
  - `20261012240000` — master: AP6 Telegram brief ↔ in-package: IN2 merge record
- Main working tree-র uncommitted AG/Group-B entry IN package ছোঁয়নি — সেগুলোর সিদ্ধান্ত আলাদা, অপরিবর্তিত।
