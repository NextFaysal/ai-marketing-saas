# IN B2 (IN3 + IN4) — Combined Acceptance

Worktree `~/workspace/ai-marketing-saas-in`, branch `in-package`, B1
(`f8af51a`) থেকে এগিয়ে। মালিকের অনুমোদন: পুরো IN1–IN10 প্যাকেজ
(2026-10-12 22:16 +06), B1–B5 ধারাবাহিকভাবে। Main repo
(`~/workspace/ai-marketing-saas`, master `db6b002`) এই ব্যাচে
একদমই ছোঁয়া হয়নি; push/fetch হয়নি।

## Commit

| Item | Commit | সারসংক্ষেপ |
|---|---|---|
| IN3 | `4f85528` | Macros (InboxMacro + migration) — same-code-path ধাপ-নির্বাহ, প্রথম ব্যর্থতায় থামা + ধাপভিত্তিক ফলাফল; bulk reply (WhatsApp window pre-check); quick-reply variable সম্প্রসারণ (orderId/trackingLink/deliveryCharge, আসল data ছাড়া খালি) |
| IN4 | `6e656ad` | স্তরভিত্তিক SLA (VIP → channel → default, layered না থাকলে legacy clause হুবহু) + সক্রিয় chain: ৭৫% সতর্কতা → lead alert → opt-in auto-reassign (`inbox_sla_sweep` job, প্রতিটি ধাপ audited) + handover queue-তে sla_risk sort |

Item-ভিত্তিক বিবরণ: `docs/in3-acceptance.md`, `docs/in4-acceptance.md`।

## Full gate (B2 শেষে, HEAD `6e656ad`)

| Gate | ফলাফল | B1 baseline | মন্তব্য |
|---|---|---|---|
| API jest (full) | **1913/1913 pass, 212 suites** | 1881/1881, 210 suites | +32 = IN3 13 + IN4 19; কোনো failure নেই — এবার social-pp1 flake-টিও আসেনি, পুরো run একবারেই সবুজ |
| API tsc | clean (exit 0) | clean | — |
| Web vitest | **133/133 pass, 19 files** | 125/125 | +8 = IN3 4 + IN4 4 |
| Web tsc | clean (exit 0) | clean | — |
| Web next build | green (exit 0) | green | — |
| Prisma validate | schema valid 🚀 | valid | IN3 + IN4 ক্ষেত্রসহ |

**Regression: নেই।** কোনো বিদ্যমান spec ভাঙেনি; folder counts-এর
একটি আসল বাগ IN4 spec ধরেছে (layered `OR` বনাম notSnoozed `OR`
spread-সংঘর্ষ) এবং একই commit-এ ঠিক হয়েছে — এটি নতুন আচরণের বাগ,
পুরনো আচরণের regression নয় (layered সেটিংস ছাড়া পথটি অপরিবর্তিত)।
cx3-debounce flake এই ব্যাচের কোনো run-এ আসেনি (sweep spec-গুলো
fake clock + fake prisma, timer-নির্ভর নয়); flake-টির root cause
আগের মতোই অজানা রয়ে গেল।

## Environment নোট
- Node modules: B1-এর symlink farm অপরিবর্তিত; কোনো নতুন dependency
  যোগ হয়নি (IN3/IN4 সম্পূর্ণ বিদ্যমান stack-এ)।
- কোনো live DB / live Meta / live সাইট এই ব্যাচে ছোঁয়া হয়নি।

## সৎ সীমা (deploy-এর আগে জানা জরুরি)
1. **Migration দুটি কোনো আসল DB-তে চালানো হয়নি:**
   `20261012210000_in3_macros` ও `20261012220000_in4_sla_chain`।
   Deploy-এ দুটোই চালাতে হবে + `prisma generate` — না হলে macros
   endpoint 500 দেবে এবং SLA settings/sweep নতুন কলামে ব্যর্থ হবে।
2. **Live প্রমাণ নেই (M30 pending):** macro-র success path webchat
   দিয়ে প্রমাণিত; WhatsApp পথে সৎ ব্যর্থতা + window pre-check
   প্রমাণিত, আসল Meta send নয়। SLA chain fake clock + fake
   prisma-তে প্রমাণিত; আসল DB-তে sweep একবারও চলেনি। Sweep তখনই
   চলবে যখন org Automations-এ "Inbox SLA Sweep" job চালু করবে।
3. **Composer-এর client-side variable তালিকা** আগের তিনটিই
   (firstName/contactName/phone) — পুরো সম্প্রসারণ শুধু server
   path-এ (macro/bulk)। Help text-এ সেটা লেখা আছে।
4. Team report-এর পুরনো `currentBreaches` (status "open" মাত্র,
   default সীমা) layered করা হয়নি — folder count-এর সঙ্গে হুবহু
   মিলবে না; ইচ্ছাকৃতভাবে scope-এর বাইরে রাখা।
5. `sla_risk` sort saved view-তে persist হয় না (session toggle)।
6. VIP SLA স্তর `escalationThresholdMinor` সেট থাকার ওপর নির্ভরশীল।

## Branch অবস্থা
- `in-package` HEAD: এই docs commit-এর আগ পর্যন্ত `6e656ad`;
  working tree clean; B1 থেকে ৩ commit এগিয়ে (IN3, IN4, এই docs)।
- GitHub-এ **push হয়নি** (মালিকের push-গেট অপরিবর্তিত); in-package
  main/master-এ merge/rebase হয়নি — integration পরের ধাপ।
