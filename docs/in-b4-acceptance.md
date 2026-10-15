# IN B4 — সম্মিলিত Acceptance (IN2 + IN10)

Branch `in-package`, B3 docs commit `c8e6752`-এর ওপর। সব local commit, **push হয়নি**; main repo-তে হাত দেওয়া হয়নি, merge/rebase হয়নি।

## Commits
| Commit | বিষয় |
|---|---|
| `69efed7` | IN2: reversible customer merge (CustomerMergeRecord + unmerge), CustomersController unmerge, inbox identity-র module wiring, migration `20261012240000` |
| `126a142` | IN10: conversation block + spam queue wiring, view/export audit + note masking, Analytics v2, CSAT ≤3 lead alert, migration `20261012250000` |
| (এই commit) | এই acceptance গুচ্ছ |

বিস্তারিত: `docs/in2-acceptance.md`, `docs/in10-acceptance.md`।
নোট: `inbox.service.ts / inbox.controller.ts / inbox.dto.ts / schema.prisma / web inbox page` — এই shared ফাইলগুলোতে IN2 ও IN10-র পরিবর্তন একই অঞ্চলে interleaved থাকায় সেগুলো IN10 commit-এ একসাথে গেছে; IN2-র নিজস্ব logic (customers merge/unmerge + দুটো spec + migration + module) IN2 commit-এ আলাদা।

## Gate (আসল সংখ্যা)
| Gate | B3 baseline | B4 |
|---|---|---|
| API jest (full) | 1955/1955, 214 suites | **1982/1982, 217 suites** (+27 নতুন: IN2 14, IN10 13) |
| API tsc | clean | clean |
| Web vitest | 149/149 | 149/149 (web-এ নতুন test নেই — UI পরিবর্তন typecheck + build দিয়ে যাচাই) |
| Web tsc | clean | clean |
| Web build (next) | green | green |
| Prisma validate | OK | OK |

Regression: **শূন্য**। Flake: এই batch-এ একটিও দেখা যায়নি (cx3-debounce-ও না)।

Gate-এর বাইরে spec নিজে একটি **আসল bug** ধরেছে (IN10 analytics-এ DB direction `"inbound"` বনাম builder-এর `"in"` — fix একই batch-এ, regression assertion সহ)। বিস্তারিত in10-acceptance-এ।

## প্রমাণের সারসংক্ষেপ
- **Merge/unmerge:** record-এ হুবহু moved id + field snapshot; unmerge পূর্ণ restore, তবে পরে হাতে সরানো row / বদলানো field কখনো clobber হয় না; pre-IN2 (record-ছাড়া) merge সৎভাবে refuse। CX1 courier % merge-এর আগে 0% → পরে 50% (দুই channel মিলিয়ে, আসল RiskService) → unmerge-এ আবার 0%-এর হিসাবে ফেরে।
- **Duplicate সততা:** মিল শুধু phone (শেষ ১০) / email-এ; PSID-only thread-এ তালিকা খালি — spec-proven।
- **Block:** ingest gate spec-এ control twin দিয়ে প্রমাণিত — blocked thread-এ intent stamp-ও হয় না, unblocked যমজে হয়।
- **Analytics হিসাব:** হাতে-হিসাব করা fixture-এর প্রতিটি সংখ্যা (heatmap/peak/conversion/trend average/intent %) pure-builder spec-এ হুবহু assert।

## সৎ সীমা
- দুটো migration-ই (`20261012240000`, `20261012250000`) **কোনো আসল DB-তে চলেনি** — deploy-এ migration + `prisma generate` বাধ্যতামূলক। Master-এর AP6-ও `20261012240000` prefix নিয়েছে (আলাদা folder/table) — integration-এ দুটোই রাখতে হবে।
- Live Meta/LLM প্রমাণ নেই (M30 বাকি) — block/merge/analytics সব fixture/fake-prisma স্তরে প্রমাণিত, production DB-তে নয়।
- IN1 search-এর মতোই identity scan-ও bounded plain scan (customer 500 / conversation 500 cap) — খুব বড় org-এ cap-এর বাইরের duplicate ধরা পড়বে না; UI-তে তা দাবি করা হয়নি।
- Analytics scan caps (2000/10000/5000) — তার বেশি row থাকলে হিসাব cap পর্যন্তই; builder `scan` field-এ আসল দেখা row সংখ্যা জানায়।
- Block আমাদের স্তরের — প্ল্যাটফর্মে মেসেজ আসা থামে না (UI-তে স্পষ্ট); spam queue থেকেই তা সামলাতে হয়।

## পরের ধাপ (parent-এর হাতে)
- **B5:** IN8 (comment+DM unified, verify-first) + IN9 (pagination/refactor/mobile) + পুরো IN প্যাকেজের final gate।
- in-package → master integration (migration prefix সংঘর্ষগুলোসহ) আলাদা ধাপে, মালিকের নির্দেশে।
