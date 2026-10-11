# Platform Hardening Plan — এই Track এর কাজ (M61–M66)

**প্রেক্ষাপট (2026-10-11):** Next-Level Plan (M50–M60) অন্য
track ক্রমানুসারে execute করছে (M50, M51, M55–M58 হয়ে গেছে;
M52/M53 চলমান)। Unified Inbox (U1–U6) ও M57 এই track এর শেষ।
মালিকের নির্দেশ: বসে না থেকে সংঘর্ষ-মুক্ত কাজ এগিয়ে নেওয়া।
এই plan এর প্রতিটি আইটেম যাচাই করা — কোনটা কোন ফাইলে, অন্য
track সেখানে আছে কিনা — তারপর সাজানো। প্রতিটি milestone এ
আগের নিয়ম: build + full test + live sandbox proof +
acceptance doc + **শুধু local commit** (push মালিক বললে)।

## নীতি
- অন্য track এর ফাইল ছোঁব না; প্রতিটি milestone শুরুর আগে
  `git status` দিয়ে পুনঃযাচাই।
- কোনো সংখ্যা/সফলতা platform confirmation ছাড়া দাবি নয়।
- REDIS_URL না থাকলে সব নতুন আচরণের inline/in-memory
  fallback থাকবে — ছোট deployment আগের মতোই চলবে।

## M61 — Public-Surface Rate Limiting ও Abuse Shield
**কেন:** SaaS টা public internet এ live; login/register,
public chat, tracking ingest, webhook, payment callback —
কোথাও rate limit নেই (যাচাই করা: throttler কোডে ০)।
**কী:** নিজস্ব ThrottlerGuard (codebase এর hand-rolled
ধাঁচে) — APP_GUARD হিসেবে AppModule এ; store = REDIS_URL
থাকলে Redis (multi-replica তে একই হিসাব), না থাকলে
in-memory। Route class অনুযায়ী limit: auth (login/register
কঠোর), public chat start/message, tracking ingest,
webhook (উদার — provider retry আটকাবে না), বাকি
authenticated route এ হালকা global সীমা। সীমা env দিয়ে
বদলানো যায়; অতিক্রমে সৎ 429 + Retry-After। Admin System
প্যানেলে শীর্ষ blocked IP-র হিসাব (in-app counter থেকে)।
**Acceptance:** spec (class অনুযায়ী limit, window reset,
Redis/in-memory দুই store), live: login brute-force থামে,
স্বাভাবিক ব্যবহারে কোনো 429 নয়।

## M62 — Multi-Replica Correctness Closeout
**কেন:** M57 dispatch dedupe করেছে, কিন্তু AutomationService
এর ঘণ্টায়-একবার rule evaluation এখনো প্রতি API replica তে
চলে — replica বাড়ালে একই rule বহুবার evaluate হবে।
**কী:** rule evaluation এ leader claim (Redis SET NX + TTL;
না থাকলে DB row claim) — একবারই চলবে; বাকি per-process
state এর audit তালিকা (presence = documented exception);
deployment doc হালনাগাদ: "REDIS_URL সহ API replica N পর্যন্ত
নিরাপদ"। Sandbox এ 2 instance দিয়ে প্রমাণ।
**Acceptance:** দুই instance এ rule evaluation একবার —
log/DB row দিয়ে প্রমাণ; spec claim-এর race নিয়ে।

## M63 — Webhook Async Processing (BullMQ webhook queue)
**কেন:** Meta/Telegram/Woo webhook এখন API request এর
ভেতরেই পুরো intelligence pipeline চালায় — ধীর হলে
provider timeout/retry storm; Meta দ্রুত ack আশা করে।
**কী:** M57 এর callback pattern এই — controller edge এ
শুধু enqueue (payload অপরিবর্তিত, HMAC যাচাই আগের মতোই
synchronous), worker callback API এর বিদ্যমান handler ই
চালায়। Dedupe (delivery id + message unique key) আগেই
আছে, তাই retry নিরাপদ। REDIS_URL না থাকলে inline আগের
মতোই। কোনো service-এর ভেতরের logic বদলাবে না।
**Acceptance:** live: webchat/telegram webhook ack <100ms,
message worker দিয়ে inbox এ পৌঁছায়; ব্যর্থ processing
retry → DLQ তে দেখা যায়।

## M64 — Deploy Smoke ও Backup-Restore Verification Kit
**কেন:** মালিকের সবচেয়ে বড় operational যন্ত্রণা:
Dokploy auto-deploy না-চলা + পুরনো build চুপচাপ live থাকা
(দুবার ঘটেছে)। প্রতিটি redeploy এর পর ২ মিনিটে নিশ্চিত
হওয়ার উপায় দরকার।
**কী:** `scripts/deploy-smoke.mjs` — live domain এর বিরুদ্ধে:
health, public pricing/status, throwaway register→login→
org তৈরির আসল flow, admin login পৃষ্ঠা, worker/DLQ endpoint
উত্তর; প্রতিটি ধাপে PASS/FAIL + কোন build চলছে (version
endpoint)। সাথে M42 backup manifest দিয়ে restore-verify
পদ্ধতি (row count তুলনা) একই script এ `--verify-backup`
মোডে চালানোর ব্যবস্থা + runbook অনুচ্ছেদ।
**Acceptance:** sandbox deployment এর বিরুদ্ধে পুরো PASS;
ইচ্ছাকৃতভাবে পুরনো build এ চালালে সঠিক FAIL দেখায়।

## M65 — Order-Event Completeness (N4 বাকি)
**কেন:** CSV/manual order `order.created` event ছাড়ে না —
তাই ওই order গুলোতে automation rule, CAPI, offline
conversion কিছুই fire হয় না (জানা সীমাবদ্ধতা)।
**কী:** manual/CSV import পথে একই event bus এ event
(দedupe key সহ — re-import এ দ্বিগুণ fire নয়); কোন কোন
consumer চলল তা AutomationRun এ দেখা যাবে।
**Acceptance:** spec + live: CSV order আমদানিতে rule/CAPI
log-এ ঘটনা প্রমাণিত (gateway confirmation ছাড়া "sent"
দাবি নয় — আগের নিয়মেই)।

## M66 — Webchat Visitor Realtime
**কেন:** দোকানের widget এখনো poll করে — agent এর reply
ক্রেতা দেরিতে দেখে; U1/U6 এর SSE/Redis কাঠামো agent পাশে
আছে, ক্রেতা পাশে নেই।
**কী:** widget এর জন্য chat-token যাচাই করা SSE channel
(U6 bus এই publish হবে); widget এ EventSource সংযোগ +
polling fallback আগের মতোই; token ছাড়া অন্যের
conversation শোনা যাবে না (spec এ প্রমাণ)।
**Acceptance:** live: দুই browser context এ agent reply
poll ছাড়াই ক্রেতার widget এ আসে।

## যা এই plan এ নেই (ইচ্ছাকৃত)
- M52–M54, M59, M60 — অন্য track এর sequence।
- GitHub push — মালিকের স্পষ্ট নির্দেশ ছাড়া নয়।
- M30 live verification — মালিকের account ছাড়া অসম্ভব।
- Wallet/Managed Ads — স্থগিত সিদ্ধান্ত অপরিবর্তিত।
